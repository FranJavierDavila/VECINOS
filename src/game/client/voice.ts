'use client';

/**
 * VECINOS v1.56 — CANAL DE VOZ del vecindario (WebRTC P2P, malla completa).
 *
 * El servidor de sesión SOLO reenvía la señalización (offer/answer/ICE dirigida por
 * residentId): el audio nunca pasa por él. Cada navegador se conecta directo con el
 * resto de vecinos del canal (topología malla, dimensionada por voice.maxPeers).
 *
 * - Micrófono: getUserMedia({ audio }). Si no hay (permiso denegado, dispositivo
 *   ausente, navegador headless de QA) se cae a una pista SINTÉTICA generada con un
 *   AudioContext (oscilador → MediaStreamDestination): modo escucha con silencio real,
 *   salvo en QA (?qaengine) donde el tono es audible para poder verificar el camino
 *   completo de audio y el detector de habla de extremo a extremo.
 * - Detección de habla: AnalyserNode sobre la pista LOCAL (RMS con histéresis);
 *   el resultado viaja por voice:state para pintar el indicador en los demás.
 * - Anti-glare: quien tiene residentId MENOR crea la oferta; el otro responde.
 */

export interface VoiceChannelOptions {
  /** residentId propio (orden determinista de la oferta). */
  myId: string;
  /** Envía señalización dirigida (voice:signal del transporte NetSession). */
  sendSignal: (to: string, data: unknown) => void;
  /** Publica mi estado de micro (voice:state del transporte). */
  sendState: (muted: boolean, speaking: boolean) => void;
  /** Cambio de mute (el HUD reacciona). */
  onMuteChanged?: (muted: boolean) => void;
}

interface SignalData {
  type?: 'offer' | 'answer';
  sdp?: string;
  ice?: RTCIceCandidateInit | null;
}

/** Umbral RMS del dominio tiempo (0..1) para considerar «hablando». */
const SPEAK_RMS_ON = 0.045;
/** Histéresis: se baja con 2/3 del umbral (evita parpadeo). */
const SPEAK_RMS_OFF = 0.03;
/** Cadencia del analizador y del estado publicado. */
const ANALYSE_MS = 200;
/** En silencio, el indicador se apaga tras 1.2 s sin voz. */
const SPEAK_HOLD_MS = 1200;

export class VoiceChannel {
  private readonly opts: VoiceChannelOptions;
  private readonly peers = new Map<string, RTCPeerConnection>();
  private readonly audios = new Map<string, HTMLAudioElement>();
  private localStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyseTimer: number | null = null;
  private speaking = false;
  private lastSpokeAt = 0;
  private muted = false;
  private synthetic = false;
  private stopped = false;

  constructor(opts: VoiceChannelOptions) {
    this.opts = opts;
  }

  /** true = entramos sin micrófono (pista sintética). */
  isSynthetic(): boolean {
    return this.synthetic;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Estados de conexión por vecino (QA: __vecinosQa.getVoicePeers()). */
  peerStates(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [id, pc] of this.peers) out[id] = pc.connectionState;
    return out;
  }

  /** Abre el canal: micro real si hay, sintético si no. Idempotente. */
  async start(): Promise<void> {
    if (this.localStream) return;
    this.stopped = false;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      stream = null;
    }
    // v1.56 (auditoría H2) — el usuario pudo cerrar el canal mientras llegaba el permiso:
    // si stop() corrió durante el await, NO se resucita el canal (y se sueltan las pistas).
    if (this.stopped) {
      stream?.getTracks().forEach((t) => t.stop());
      return;
    }
    if (!stream) {
      // Pista sintética: el pipeline WebRTC necesita UN track para negociar. En QA suena
      // un tono leve (verificación E2E del audio real); fuera de QA, silencio absoluto.
      const isQa = typeof location !== 'undefined' && new URLSearchParams(location.search).has('qaengine');
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      // 0.08: RMS ≈ 0.057 — por encima del umbral de habla (0.045) para que el QA E2E
      // verifique el camino completo (voz → analizador → voice:state → indicadores).
      gain.gain.value = isQa ? 0.08 : 0;
      const dest = ctx.createMediaStreamDestination();
      osc.connect(gain).connect(dest);
      osc.start();
      // El AudioContext nace SUSPENDIDO (política de autoplay): sin resume() el oscilador
      // no produce muestras y el QA no vería nunca «hablando».
      void ctx.resume().catch(() => undefined);
      stream = dest.stream;
      this.audioCtx = ctx;
      this.synthetic = true;
    }
    if (this.stopped) {
      // Carrera doble: stop() pudo llegar mientras se montaba el AudioContext sintético.
      stream.getTracks().forEach((t) => t.stop());
      void this.audioCtx?.close().catch(() => undefined);
      this.audioCtx = null;
      return;
    }
    this.localStream = stream;
    this.setupAnalyser();
  }

  /** Actualiza la malla al roster del canal (conecta con los nuevos, cierra los que salen). */
  setRoster(members: { id: string }[]): void {
    if (this.stopped || !this.localStream) return;
    const wanted = new Set(members.map((m) => m.id).filter((id) => id !== this.opts.myId));
    // Fuera los que ya no están.
    for (const id of [...this.peers.keys()]) {
      if (!wanted.has(id)) this.closePeer(id);
    }
    // v1.56 (auditoría H3) — peers muertos (flap de red, móvil): se descartan para que
    // ensurePeer los reconstruya desde cero (sin ICE-restart: la malla se repara sola con
    // el próximo roster del servidor, que siempre sigue el rejoin).
    for (const id of wanted) {
      const pc = this.peers.get(id);
      if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) this.closePeer(id);
    }
    // Dentro los nuevos.
    for (const id of wanted) this.ensurePeer(id);
  }

  /** Señalización entrante (offer/answer/ICE) reenviada por el servidor. */
  async handleSignal(from: string, raw: unknown): Promise<void> {
    if (this.stopped || !this.localStream) return;
    const data = (raw ?? {}) as SignalData;
    const pc = this.ensurePeer(from);
    try {
      if (data.type === 'offer' && typeof data.sdp === 'string') {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.opts.sendSignal(from, { type: 'answer', sdp: answer.sdp });
      } else if (data.type === 'answer' && typeof data.sdp === 'string') {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        }
      } else if (data.ice) {
        try {
          await pc.addIceCandidate(data.ice);
        } catch {
          /* candidato tardío tras cerrar: inocuo */
        }
      }
    } catch {
      /* señal corrupta: se descarta (la malla se repara con el próximo roster) */
    }
  }

  /** Silencia mi micrófono (la pista sigue viva: reconectar no cuesta). */
  toggleMute(): boolean {
    this.muted = !this.muted;
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = !this.muted;
    this.opts.onMuteChanged?.(this.muted);
    this.publishState(true); // el estado cambia aunque el RMS no lo diga
    return this.muted;
  }

  /** Cierra todo (peers, audio, pistas, analizador). Idempotente. */
  stop(): void {
    this.stopped = true;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    if (this.analyseTimer !== null) clearInterval(this.analyseTimer);
    this.analyseTimer = null;
    this.analyser = null;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.speaking = false;
    void this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
  }

  // ── Internos ──

  private ensurePeer(id: string): RTCPeerConnection {
    let pc = this.peers.get(id);
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    this.peers.set(id, pc);
    for (const track of this.localStream?.getAudioTracks() ?? []) pc.addTrack(track, this.localStream!);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.opts.sendSignal(id, { ice: ev.candidate.toJSON() });
    };
    pc.ontrack = (ev) => {
      // Audio remoto: elemento oculto con autoplay (la malla lo reusa si ya existía).
      let audio = this.audios.get(id);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.muted = false;
        audio.style.display = 'none';
        document.body.appendChild(audio);
        this.audios.set(id, audio);
      }
      audio.srcObject = ev.streams[0] ?? null;
      void audio.play().catch(() => undefined);
    };
    // Anti-glare determinista: el residentId menor ofrece.
    if (this.opts.myId < id) {
      void this.makeOffer(id, pc);
    }
    return pc;
  }

  private async makeOffer(id: string, pc: RTCPeerConnection): Promise<void> {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.opts.sendSignal(id, { type: 'offer', sdp: offer.sdp });
    } catch {
      /* sin pista local todavía: el próximo roster reintenta */
    }
  }

  private closePeer(id: string): void {
    this.peers.get(id)?.close();
    this.peers.delete(id);
    const audio = this.audios.get(id);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      this.audios.delete(id);
    }
  }

  /** AnalyserNode sobre la pista local → RMS con histéresis → voice:state. */
  private setupAnalyser(): void {
    if (!this.localStream) return;
    try {
      const ctx = this.audioCtx ?? new AudioContext();
      this.audioCtx = ctx;
      const src = ctx.createMediaStreamSource(this.localStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      this.analyser = analyser;
      const buf = new Uint8Array(analyser.fftSize);
      this.analyseTimer = window.setInterval(() => {
        if (this.stopped || !this.analyser) return;
        this.analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i]! - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();
        if (rms > SPEAK_RMS_ON) {
          this.lastSpokeAt = now;
          if (!this.speaking) {
            this.speaking = true;
            this.publishState();
          }
        } else if (this.speaking && rms < SPEAK_RMS_OFF && now - this.lastSpokeAt > SPEAK_HOLD_MS) {
          this.speaking = false;
          this.publishState();
        }
      }, ANALYSE_MS);
    } catch {
      /* sin analizador el canal funciona: solo no hay indicador de habla propio */
    }
  }

  private publishState(force = false): void {
    if (this.stopped) return;
    if (force) this.lastSpokeAt = Date.now(); // evita que el hold apague el mute recién puesto
    this.opts.sendState(this.muted, this.speaking && !this.muted);
  }
}
