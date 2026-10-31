'use client';

import { io, type Socket } from 'socket.io-client';
import type { Command, GameEvent, World } from '@/game/core/types';

// ───────────────────────── Tipos del protocolo de sesión v1 ─────────────────────────

/** Participante de una sesión (forma exacta de session:participants / session:joined). */
export interface MpParticipant {
  id: string;
  name: string;
  home: string;
}

/**
 * Ack de session:create / session:join. Las variantes positivas del contrato difieren
 * (join añade residentName y homeBlock), así que se tipan como opcionales aquí.
 */
export type HostJoinResult =
  | { ok: true; code: string; isHost: boolean; yourResidentId: string; scenarioId: string; residentName?: string; homeBlock?: string }
  | { ok: false; error: string };

/** S→C session:joined. */
export interface SessionJoinedPayload {
  code: string;
  isHost: boolean;
  yourResidentId: string;
  scenarioId: string;
  participants: MpParticipant[];
}

/** S→C session:state. */
export interface SessionStatePayload {
  seq: number;
  world: World;
  events: GameEvent[];
}

/** v1.55 — fila del marcador «Vecino del mes» (forma exacta de session:score.rows). */
export interface MpScoreRow {
  residentId: string;
  name: string;
  points: number;
  /** Mejor marca por minijuego (segundos, 1 decimal). */
  best: Record<string, number>;
  /** true = «Vecino del mes» (máxima puntuación de la sala). */
  top: boolean;
}

// ── v1.56 — misiones cooperativas (coop:state) ──

/** Estado de un rol de la misión co-op activa. */
export interface MpCoopRoleState {
  roleId: string;
  /** Quien lo lleva (null = libre para reclamar). */
  residentId: string | null;
  name: string | null;
  done: boolean;
}

/** Misión co-op activa tal y como la define el catálogo (content.multiplayer.coop). */
export interface MpCoopMissionPayload {
  id: string;
  title: string;
  brief: string;
  roles: { id: string; label: string; hint: string; objective: { type: 'minigame'; id: string } | { type: 'reach'; block: string } }[];
  pointsBonus: number;
  completeToast: string;
}

/** Payload exacto de coop:state. */
export interface MpCoopState {
  active: null | { mission: MpCoopMissionPayload; roles: MpCoopRoleState[] };
  done: string[];
}

// ── v1.56 — canal de voz (WebRTC P2P; el servidor solo reenvía señalización) ──

/** Miembro del canal de voz (forma exacta de voice:roster.members). */
export interface MpVoiceMember {
  id: string;
  name: string;
  muted: boolean;
  speaking: boolean;
}

/** Estado propio en el canal (lo pinta el HUD y el panel). */
export interface MpVoiceState {
  active: boolean;
  /** true = sin micrófono: pista sintética silenciosa (modo escucha). */
  synthetic: boolean;
  muted: boolean;
  members: MpVoiceMember[];
}

/** Transporte puro: 'connecting' (conectando/reconectando) → 'connected' → 'disconnected'. */
export type MpNetStatus = 'connecting' | 'connected' | 'disconnected';

export interface NetCallbacks {
  onState?: (s: SessionStatePayload) => void;
  onParticipants?: (participants: MpParticipant[]) => void;
  onJoined?: (payload: SessionJoinedPayload) => void;
  onScore?: (rows: MpScoreRow[]) => void;
  /** v1.56 — estado de la misión cooperativa (oferta, roles, cierre). */
  onCoopState?: (s: MpCoopState) => void;
  /** v1.56 — roster del canal de voz. */
  onVoiceRoster?: (members: MpVoiceMember[]) => void;
  /** v1.56 — señalización WebRTC reenviada por el servidor (offer/answer/ICE). */
  onVoiceSignal?: (from: string, data: unknown) => void;
  /** v1.56 — estado de micro de un vecino (from ≠ yo). */
  onVoiceState?: (from: string, muted: boolean, speaking: boolean) => void;
  onError?: (message: string) => void;
  onStatus?: (status: MpNetStatus) => void;
}

/** Vencimiento del ack de create/join (patrón timeout de socket.io-client v4). */
const ACK_TIMEOUT_MS = 5000;

/**
 * URL de conexión. IGUAL que examples/websocket/frontend.tsx: el puerto SOLO vive en el
 * parámetro XTransformPort (lo reenvía Caddy); jamás en otra parte de la URL ni path distinto.
 */
const SERVER_URL = '/?XTransformPort=3010';

/** Guardia de forma del ack (el servidor puede responder variante create o join, o un error). */
function isHostJoinResult(v: unknown): v is HostJoinResult {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  if (r.ok === true) {
    return (
      typeof r.code === 'string' &&
      typeof r.isHost === 'boolean' &&
      typeof r.yourResidentId === 'string' &&
      typeof r.scenarioId === 'string'
    );
  }
  return r.ok === false && typeof r.error === 'string';
}

/**
 * Encapsula el socket de la sesión multijugador. SOLO transporte: emite comandos y reparte
 * los mensajes del servidor a los callbacks registrados; no decide nada del juego.
 * Cada instancia abre su propia conexión (forceNew, igual que el ejemplo de websocket).
 */
export class NetSession {
  private readonly socket: Socket;

  constructor(cbs: NetCallbacks = {}) {
    this.socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      forceNew: true,
      // v1.56 — reconexión INDEFINIDA: en segundo plano Chrome ralentiza los timers y
      // cada intento puede tardar ~60 s; con el rejoin del servidor (session:rejoin) la
      // sesión se re-vincula al volver, así que reintentar siempre es lo correcto.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 4000,
      timeout: 10000,
    });
    // Estado de transporte (la UI decide qué pinta con ello).
    cbs.onStatus?.('connecting');
    this.socket.on('connect', () => cbs.onStatus?.('connected'));
    this.socket.io.on('reconnect_attempt', () => cbs.onStatus?.('connecting'));
    this.socket.on('disconnect', () => cbs.onStatus?.('disconnected'));
    // Mensajes de sesión (protocolo v1, formas exactas del contrato).
    this.socket.on('session:joined', (p: SessionJoinedPayload) => cbs.onJoined?.(p));
    this.socket.on('session:participants', (p: { participants: MpParticipant[] }) => cbs.onParticipants?.(p.participants));
    this.socket.on('session:state', (s: SessionStatePayload) => cbs.onState?.(s));
    // v1.55 — marcador «Vecino del mes» (el servidor lo difunde tras cada premio).
    this.socket.on('session:score', (p: { rows: MpScoreRow[] }) => cbs.onScore?.(Array.isArray(p?.rows) ? p.rows : []));
    // v1.56 — co-op + voz.
    this.socket.on('coop:state', (p: MpCoopState) => cbs.onCoopState?.(p && typeof p === 'object' ? { active: p.active ?? null, done: Array.isArray(p.done) ? p.done : [] } : { active: null, done: [] }));
    this.socket.on('voice:roster', (p: { members: MpVoiceMember[] }) => cbs.onVoiceRoster?.(Array.isArray(p?.members) ? p.members : []));
    this.socket.on('voice:signal', (p: { from: string; data: unknown }) => {
      if (typeof p?.from === 'string') cbs.onVoiceSignal?.(p.from, p.data);
    });
    this.socket.on('voice:state', (p: { from: string; muted: boolean; speaking: boolean }) => {
      if (typeof p?.from === 'string') cbs.onVoiceState?.(p.from, p.muted === true, p.speaking === true);
    });
    this.socket.on('session:error', (p: { message: string }) => cbs.onError?.(p.message));
  }

  /** Crea una sesión compartida (el emisor queda como anfitrión). */
  hostSession(scenarioId?: string): Promise<HostJoinResult> {
    return this.request('session:create', { scenarioId });
  }

  /** Se une a una sesión existente por código. */
  joinSession(code: string): Promise<HostJoinResult> {
    return this.request('session:join', { code });
  }

  /** v1.56 — reconexión transparente: re-vincula el MISMO residente tras caída del transporte. */
  rejoin(code: string, residentId: string): Promise<HostJoinResult> {
    return this.request('session:rejoin', { code, residentId });
  }

  /** C→S session:command (sin ack; el servidor impone cmd.actor). */
  command(cmd: Command): void {
    this.socket.emit('session:command', { cmd });
  }

  /** v1.55 — DUELO DE MINIJUEGOS: marca de tiempo (s) de un rearme con éxito reciente. */
  minigameTime(id: string, secs: number): void {
    this.socket.emit('session:minigame_time', { id, secs });
  }

  // ── v1.56 — co-op + voz ──

  /** C→S coop:claim — reclama un rol libre de la misión co-op activa. */
  coopClaim(missionId: string, roleId: string): void {
    this.socket.emit('coop:claim', { missionId, roleId });
  }

  /** C→S coop:progress — el ASIGNADO marca su objetivo completado. */
  coopProgress(missionId: string, roleId: string): void {
    this.socket.emit('coop:progress', { missionId, roleId });
  }

  /** C→S coop:skip — el anfitrión salta la misión activa. */
  coopSkip(): void {
    this.socket.emit('coop:skip');
  }

  /** C→S voice:join — pedir sitio en el canal de voz. */
  voiceJoin(): void {
    this.socket.emit('voice:join');
  }

  /** C→S voice:leave — salir del canal. */
  voiceLeave(): void {
    this.socket.emit('voice:leave');
  }

  /** C→S voice:state — mi micro (mudo / hablando). */
  voiceState(muted: boolean, speaking: boolean): void {
    this.socket.emit('voice:state', { muted, speaking });
  }

  /** C→S voice:signal — señalización WebRTC dirigida a otro vecino del canal. */
  voiceSignal(to: string, data: unknown): void {
    this.socket.emit('voice:signal', { to, data });
  }

  /** C→S session:set_speed (solo surte efecto si el emisor es el anfitrión). */
  setSpeed(speed: 1 | 3 | 10): void {
    this.socket.emit('session:set_speed', { speed });
  }

  /** C→S session:leave (el servidor marca el residente ausente y avisa a la sala). */
  leave(): void {
    this.socket.emit('session:leave');
  }

  /** Cierra la conexión y suelta todos los listeners (no llegan más callbacks). */
  disconnect(): void {
    this.socket.removeAllListeners();
    this.socket.io.off('reconnect_attempt');
    this.socket.disconnect();
  }

  /** emit con ack y vencimiento: { ok:false, error:'timeout' } si el servidor no responde a tiempo. */
  private request(event: 'session:create' | 'session:join' | 'session:rejoin', payload: Record<string, unknown>): Promise<HostJoinResult> {
    return new Promise((resolve) => {
      this.socket.timeout(ACK_TIMEOUT_MS).emit(event, payload, (err: Error | null, res: unknown) => {
        if (err) {
          resolve({ ok: false, error: 'timeout' });
          return;
        }
        resolve(isHostJoinResult(res) ? res : { ok: false, error: 'timeout' });
      });
    });
  }
}
