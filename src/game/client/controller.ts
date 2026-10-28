'use client';

import type { AbstractEngine, Scene } from '@babylonjs/core';
import type { AchievementDef, Command, Content, CutsceneDef, GameEvent, Input, MinigameDef, ScenarioDef, World } from '@/game/core/types';
import type { CommandResult } from '@/game/sim';
import { blockLabel } from '@/game/core/types';
import { loadContent } from '@/game/content';
import { layoutGeometryOf, roomAt } from '@/game/interior';
import { evaluateAchievements, type AchievementSnapshot } from '@/game/support/achievements';
import { syncCampaign } from '@/game/support/campaign';
import { resolveTokens, applyStaticTokens } from '@/game/support/texts';
import { activeObjective, applyEffects, buildCirculation, createWorld, dispatch, drainEvents, migrateRooms, tick, travelMinutes, visibleParams } from '@/game/sim';
import { PlayerLogic } from '@/game/player-logic';
import { createEngine } from './engine';
import { createBuilding } from './building';
import { createActors } from './actors';
import { createElevators, type ElevatorsDirector } from './elevator';
import { createBubbles, type BubblesDirector } from './bubbles';
import { createEcosystem, type EcosystemDirector } from './ecosystem';
import { createBackdrop, type BackdropDirector } from './backdrop';
import { createExterior, type ExteriorDirector } from './exterior';
import { createChats, type ChatsDirector } from './chats';
import { createTraffic, type TrafficDirector } from './traffic';
import { createShadows, type ShadowsDirector } from './shadows';
import { createAmbulanceTheater, type AmbulanceTheater } from './ambulance';
import { createPedestrians, type PedestriansDirector } from './pedestrians';
import { createStreetlife, type StreetlifeDirector } from './streetlife';
import { createVoices, type VoicesDirector } from './voices';
import { CameraRig, type CamMode } from './camera';
import { CutscenePlayer, type CutsceneEventCtx } from './cutscene';
import { B } from './babylon';
import { eventSound, preloadSounds } from './audio';
import { translate } from './i18n';
import { QUALITY_SCALE, loadOptions, type QualityLevel } from './options';
import { startGamepadPolling } from './gamepad';
import { loadUnlocked, saveUnlocked } from './achievements-store';
import { NetSession, type SessionStatePayload } from './net';
import { setController } from './bridge';
import { selectModalOpen, useGameStore, type AchievementUi, type Speed, type Tone } from './store';

const CAM_BY_KEY: Record<string, CamMode> = { Digit1: 'edificio', Digit2: 'planta', Digit3: 'estancia' };

/**
 * Único dueño del mundo en el navegador: engine Babylon, PlayerLogic, bucle de render,
 * reparto de eventos hacia el store de React y órdenes de la interfaz hacia el sim.
 * El sim no sabe que existe Babylon ni React; aquí es donde se tocan.
 * Tampoco contiene datos: TODO (contenido, balance, etiquetas, greybox) viene de /content/.
 */
class GameController {
  private canvas: HTMLCanvasElement | null = null;
  private engine: AbstractEngine | null = null;
  private scene: Scene | null = null;
  private _content: Content | null = null;
  private world: World | null = null;
  private logic: PlayerLogic | null = null;
  private building: ReturnType<typeof createBuilding> | null = null;
  private actors: ReturnType<typeof createActors> | null = null;
  private elevators: ElevatorsDirector | null = null;
  private bubbles: BubblesDirector | null = null;
  private ecosystem: EcosystemDirector | null = null;
  private rig: CameraRig | null = null;
  /** Fondo urbano + calle (v1.20): cielo dinámico, parallax y decorado exterior. */
  private backdrop: BackdropDirector | null = null;
  private exterior: ExteriorDirector | null = null;
  /** Charlas de cruce (v1.20): vecinos que se cruzan y comentan la vida. */
  private chats: ChatsDirector | null = null;
  /** La calle vive (v1.22): tráfico, viandantes, manifestaciones y voces de proximidad. */
  private traffic: TrafficDirector | null = null;
  private shadows: ShadowsDirector | null = null;
  private ambulance: AmbulanceTheater | null = null;
  private pedestrians: PedestriansDirector | null = null;
  private streetlife: StreetlifeDirector | null = null;
  private voices: VoicesDirector | null = null;
  /** Bloom/glow de las luces (v1.28): halo realista sobre materiales emisivos (catálogo). */
  private glowLayer: { dispose(): void } | null = null;
  /** Cuenta atrás del refresco de sombras (v1.32): cazamallas nuevas cada 2 s. */
  private shadowRefreshT = 2;

  private get content(): Content {
    if (!this._content) throw new Error('El catálogo de contenido todavía no se ha cargado');
    return this._content;
  }

  private keys = new Set<string>();
  /** Direcciones mantenidas por los mandos virtuales (se combinan con el teclado). */
  private touch: Input = { left: false, right: false, up: false, down: false, run: false };
  /** Overrides de minijuegos del escenario activo (QA/E2E). */
  private scenarioOverrides: NonNullable<ScenarioDef['minigameOverrides']> = {};
  private clockAcc = 0;
  private lastHudSync = 0;
  private initializing = false;
  /** Cronómetro del "paso adentro" del jugador tras abrirse la puerta de la cabina. */
  private playerBoardT = 0;
  // ── Logros tipo Steam (v1.17): perfil del navegador + cadencia de evaluación ──
  private unlockedAchievements = new Set<string>(loadUnlocked());
  private achAcc = 0;
  /** Tick de la última junta convocada desde el tablón (cooldown del catálogo). */
  private lastConvocaTick = -Infinity;

  private phoneMission = '';
  private phoneLines: { speaker: string; text: string }[] = [];
  private phoneLine = 0;
  /** Cola FIFO de llamadas pendientes: con varias misiones activándose a la vez, ninguna llamada se pisa. */
  private phoneQueue: { mission: string; dialogId: string }[] = [];

  // ── Cutscenes (Fase D): teatro data-driven sobre eventos del sim. ──
  private cutscenePlayer: CutscenePlayer | null = null;
  private cutsceneQueue: { def: CutsceneDef; ctx: CutsceneEventCtx }[] = [];

  // ── Multijugador (protocolo v1): el servidor autoritativo posee el mundo; este cliente lo refleja ──
  private net: NetSession | null = null;
  private myResidentId: string | null = null;
  private isHost = false;
  private appliedSeq = 0;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (this.engine || this.initializing) return;
    this.initializing = true;
    this.canvas = canvas;

    try {
      // 1) Contenido externo + validación (los errores de referencias se avisan, no abortan).
      const { content, issues } = await loadContent();
      this._content = content;
      this.cutscenePlayer = new CutscenePlayer(content);
      preloadSounds();
      useGameStore.setState({ touchHint: content.rules.touch.hint });
      if (issues.length > 0) {
        useGameStore.getState().pushToast(`Contenido inválido: ${issues.length} errores de validación`, 'bad');
      }

      // 2) Motor de render (WebGPU con fallback WebGL2). La calidad la elige el jugador en Opciones.
      const { engine, backend } = await createEngine(canvas);
      this.engine = engine;
      engine.setHardwareScalingLevel(QUALITY_SCALE[loadOptions().quality]);
      window.addEventListener('resize', this.onResize);
      await this.restart();
      useGameStore.getState().markReady(backend);
      startGamepadPolling();
      // Logros (v1.17): si el jugador cambia el idioma de la interfaz, los textos ya
      // resueltos de los logros se re-pintan con el catálogo (los desbloqueos se quedan).
      useGameStore.subscribe((s, prev) => {
        if (s.lang !== prev.lang) this.rebuildAchievementTexts();
      });
      engine.runRenderLoop(this.frame);
      // Gancho de depuración/pruebas E2E (no lo usa la UI).
      (window as unknown as { __vecinos?: unknown }).__vecinos = { store: useGameStore, controller: this };
    } catch (err) {
      console.error('No se pudo arrancar el juego (contenido o motor de render)', err);
      useGameStore.getState().setEngineError(true);
    }
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.net?.disconnect();
    this.net = null;
    this.bubbles?.dispose();
    this.bubbles = null;
    this.chats?.dispose();
    this.chats = null;
    this.voices?.dispose();
    this.voices = null;
    this.streetlife?.dispose();
    this.streetlife = null;
    this.pedestrians?.dispose();
    this.pedestrians = null;
    this.traffic?.dispose();
    this.traffic = null;
    this.ecosystem?.dispose();
    this.ecosystem = null;
    this.backdrop?.dispose();
    this.backdrop = null;
    this.exterior?.dispose();
    this.exterior = null;
    this.engine?.stopRenderLoop(this.frame);
    this.scene?.dispose();
    this.engine?.dispose();
    this.engine = null;
    this.scene = null;
  }

  // ───────────────── Entrada (GameStage la conecta; los mandos virtuales se fusionan) ─────────────────

  onKeyDown(code: string): void {
    // Cutscene en curso: E/Espacio/Enter/Escape saltan el espectáculo; nada más pasa.
    if (this.cutscenePlayer?.active) {
      if (code === 'KeyE' || code === 'Space' || code === 'Enter' || code === 'Escape') this.cutsceneSkip();
      return;
    }
    if (this.keys.has(code)) return;
    this.keys.add(code);
    const store = useGameStore.getState();
    if (selectModalOpen(store)) return; // los modales gestionan sus propias teclas
    if (code === 'KeyE') {
      this.interact();
      return;
    }
    if (code === 'KeyJ') {
      // Presidencia (v1.18): J junto al tablón convoca una junta con la agenda del catálogo.
      if (this.logic?.interactTarget()?.kind === 'noticeboard') this.convocaJunta();
      return;
    }
    const cam = CAM_BY_KEY[code];
    if (cam) this.setCamMode(cam);
  }

  onKeyUp(code: string): void {
    this.keys.delete(code);
  }

  setTouchInput(v: Partial<Input>): void {
    this.touch = { ...this.touch, ...v };
  }

  private readInput(): Input {
    const held = (...codes: string[]) => codes.some((c) => this.keys.has(c));
    return {
      left: held('KeyA', 'ArrowLeft') || this.touch.left,
      right: held('KeyD', 'ArrowRight') || this.touch.right,
      up: held('KeyW', 'ArrowUp') || this.touch.up,
      down: held('KeyS', 'ArrowDown') || this.touch.down,
      run: held('ShiftLeft', 'ShiftRight') || this.touch.run,
    };
  }

  // ───────────────────────── Acciones de la interfaz ─────────────────────────

  togglePause(): void {
    const store = useGameStore.getState();
    store.setPaused(!store.paused);
  }

  setSpeed(speed: Speed): void {
    // En remoto el reloj lo lleva el servidor: solo el anfitrión cambia la velocidad de la sesión.
    if (this.net) {
      if (this.isHost) this.net.setSpeed(speed);
      useGameStore.getState().setSpeed(speed);
      return;
    }
    useGameStore.getState().setSpeed(speed);
  }

  setCamMode(mode: CamMode): void {
    if (this.rig) this.rig.mode = mode;
    useGameStore.getState().setCamMode(mode);
  }

  /** Siguiente cámara de la rueda Edificio → Planta → Estancia (teclado 1/2/3 y mando Y). */
  cycleCam(): void {
    const order: CamMode[] = ['edificio', 'planta', 'estancia'];
    const cur = order.indexOf(useGameStore.getState().camMode);
    this.setCamMode(order[(cur + 1) % order.length]!);
  }

  /** Calidad gráfica (pulido Steam): resolución de render vía hardware scaling. Solo presentación. */
  applyQuality(q: QualityLevel): void {
    this.engine?.setHardwareScalingLevel(QUALITY_SCALE[q]);
  }

  /** Botón "Fiesta demo": datos en rules.demo (residente, bloque y ruido) → canal de ruido en acción. */
  partyDemo(): void {
    if (!this.world) return;
    if (this.net) return; // demo de dev: solo tiene sentido con el mundo en local
    const demo = this.content.rules.demo;
    if (!this.world.residents[demo.resident]!.present) {
      applyEffects(this.world, this.content, [{ op: 'unlock', target: demo.block, resident: demo.resident, arrival: 'mudanza' }]);
    }
    tick(this.world, this.content, { noise: { [demo.block]: demo.noise } });
    useGameStore.getState().pushToast(demo.toast, 'info');
    this.pump();
  }

  skipTime(): void {
    if (!this.world) return;
    if (this.net) {
      useGameStore.getState().pushToast(this.content.rules.multiplayer.texts.remoteSaveDisabled, 'info');
      return;
    }
    for (let i = 0; i < 10; i++) tick(this.world, this.content);
    this.pump();
  }

  /** Interacción (tecla E o botón virtual ✋): usar el objeto cercano, entrar o salir. */
  interact(): void {
    // El ✋ táctil también salta la cutscene (es la única acción habilitada mientras dura).
    if (this.cutscenePlayer?.active) {
      this.cutsceneSkip();
      return;
    }
    if (!this.logic) return;
    // Ascensor (v1.9): si el prompt anuncia ascensor (sin objetivo de E delante), la E abre el
    // panel de destino. Misma condición que promptText → lo que ves es lo que la E ejecuta.
    if (!this.logic.interactTarget()) {
      const panel = this.logic.elevatorPanelTarget();
      if (panel) {
        useGameStore.getState().setElevatorPanel(panel);
        return;
      }
    }
    const r = this.logic.interact();
    // v1.26: el bloqueo en seco (norma de vivienda vacía / candado) AVISA con un bocadillo —
    // antes la E moría en silencio y parecía un botón roto.
    if (r.type === 'locked') {
      const s = useGameStore.getState();
      s.pushToast(translate(s.lang, r.reason === 'vacant' ? 'door.vacant' : 'door.lockedGeneric'), 'info');
    }
    if (r.type === 'rearEnter') {
      // Apilamiento 3D (v1.19): el swap lo ejecuta building.update por fases; aquí solo
      // encuadra la cámara dentro del bloque trasero.
      this.setCamMode('estancia');
      this.pump();
      return;
    }
    if (r.type === 'rearExit') {
      this.setCamMode('planta');
      this.pump();
      return;
    }
    if (r.type === 'entered') this.setCamMode('estancia');
    else if (r.type === 'exited') this.setCamMode('planta');
    else if (r.type === 'used') this.presentInteraction(r.kind);
    this.pump();
  }

  /** Panel del ascensor (v1.9): planta elegida → cierra el panel y pide cabina (la FSM manda). */
  pickElevatorFloor(to: number): void {
    useGameStore.getState().setElevatorPanel(null);
    if (!this.logic) return;
    if (!this.logic.elevatorCall(to)) {
      useGameStore.getState().pushToast(translate(useGameStore.getState().lang, 'elev.unreachable'), 'info');
      return;
    }
    this.pump();
  }

  /** Cierra el panel sin llamar (Escape o botón cancelar). */
  closeElevatorPanel(): void {
    useGameStore.getState().setElevatorPanel(null);
  }

  /** Salta la cutscene en curso (y las encadenadas que quedaban en cola). */
  cutsceneSkip(): void {
    this.cutsceneQueue = [];
    this.cutscenePlayer?.abort();
  }

  /**
   * Lecturas sin estado (buzón/tablón): texto del catálogo aquí; work/sleep/knock llegan como
   * eventos del sim (ui_toast / knock_result) y no se tratan en esta vía.
   */
  private presentInteraction(kind: 'laptop' | 'bed' | 'mailbox' | 'noticeboard' | 'resident'): void {
    if (!this.world) return;
    const ic = this.content.rules.interact;
    if (kind === 'mailbox') {
      const lines = ic.mailbox.lines;
      useGameStore.getState().pushToast(lines[this.world.tick % lines.length]!, 'info');
    } else if (kind === 'noticeboard') {
      const elevatorBlock = Object.values(this.world.blocks).find((b) => b.params.elevator_status !== undefined);
      const status = String(elevatorBlock?.params.elevator_status ?? 'ok');
      let text = ic.noticeboard.template
        .replace('{day}', String(this.world.clock.day))
        .replace('{funds}', String(this.world.community.funds))
        .replace('{elevator}', this.content.rules.labels.elevator[status] ?? status)
        .replace('{weather}', this.content.rules.labels.weather[this.world.weather.state] ?? this.world.weather.state);
      // Presidencia (v1.18): con el mandato activo, el tablón también convoca.
      const cfg = this.content.rules.sim.campaign;
      if (cfg && useGameStore.getState().campaign?.active) text += `\n🗳️ [J] Convocar junta de vecinos (${cfg.presidentLabel.toLowerCase()})`;
      useGameStore.getState().pushToast(text, 'info');
    }
  }

  /**
   * Junta extraordinaria convocada por la presidencia desde el tablón (v1.18): la agenda
   * sale del catálogo (rules.sim.campaign.presetAgenda) y la votación la resuelve el sim
   * (mismo flujo que las juntas de misión). Cooldown del catálogo; solo con mandato activo.
   */
  private convocaJunta(): void {
    const world = this.world;
    const cfg = this.content.rules.sim.campaign;
    if (!world || !cfg || world.junta) return;
    if (!useGameStore.getState().campaign?.active) {
      useGameStore.getState().pushToast('Solo la presidencia convoca juntas. De momento, eres un vecino más (con suerte).', 'info');
      return;
    }
    if (world.tick - this.lastConvocaTick < cfg.convocationCooldownMinutes) {
      const left = Math.ceil(cfg.convocationCooldownMinutes - (world.tick - this.lastConvocaTick));
      useGameStore.getState().pushToast(`Juana dice que la última junta fue hace poco. Próxima disponible en ${left} min. La democracia necesita descansos.`, 'info');
      return;
    }
    this.lastConvocaTick = world.tick;
    world.junta = { agenda: cfg.presetAgenda.map((i) => ({ ...i })), votes: {}, playerVoted: false };
    useGameStore.getState().setJunta(cfg.presetAgenda.map((i) => ({ id: i.id, title: i.title, description: i.description, cost: i.cost })));
    useGameStore.getState().pushLog('🗳️ Junta extraordinaria convocada desde el tablón. Los vecinos, en camino.', 'info');
    this.marchJunta(); // v1.30: igual que las juntas de misión, la sala recibe a los asistentes
  }

  /**
   * v1.30 — ASISTENCIA A LA JUNTA (teatro de presentación): convocada una junta, TODOS los
   * vecinos presentes en el edificio entran en la sala de juntas y se SIENTAN en sus sillas
   * (el local se abre y se ilumina mientras dura la sesión). El sim no cambia: es el mismo
   * teatro del director de cutscenes — al cerrarse la junta, dismissJunta() los suelta.
   * También acoge fiestas: el local queda como punto de encuentro de la comunidad.
   */
  private juntaAttendees: string[] = [];
  private marchJunta(): void {
    const world = this.world;
    if (!world || !this.actors || !this.building) return;
    const hall = this.building.juntaHallInfo();
    if (!hall || hall.seats.length === 0) return;
    this.dismissJunta();
    this.building.setJuntaHall(hall.id);
    const attendees: string[] = [];
    for (const r of Object.values(world.residents)) {
      if (!r.present || r.location === null) continue;
      if (r.id === world.playerId) continue; // el jugador camina solo (es humano)
      attendees.push(r.id);
    }
    // Reparto determinista por orden de id: 1 asistente por silla libre; los que sobran
    // DE PIE dentro del local (puestos del catálogo), nunca apilados sobre una silla.
    attendees.sort((a, z) => (a < z ? -1 : 1));
    const locals = this.content.rules.view.locals;
    const standCells = locals.juntaHall.standSpots ?? [];
    attendees.forEach((id, i) => {
      const seated = i < hall.seats.length;
      const standIdx = i - hall.seats.length;
      const spot = seated ? hall.seats[i]! : hall.stands[standIdx] ?? { x: hall.seats[0]!.x, z: (locals.juntaHall.tableZ ?? 1.5) + 1.0, yaw: Math.PI / 2 };
      if (!this.actors!.director.take(id)) return;
      const ok = this.actors!.director.walkTo(id, {
        x: spot.x,
        z: spot.z,
        floor: 0,
        inside: { block: hall.id, local: { x: spot.x - (world.blocks[hall.id]!.cell.col * (this.content!.rules.view.cellW)), z: spot.z - (this.content!.rules.view.roomZ - this.content!.rules.view.commonDepth / 2) } },
      });
      if (!ok) {
        this.actors!.director.release(id);
        return;
      }
      if (seated) this.actors!.director.seatWhenIdle(id, spot); // los que sobran, de pie detrás
      else if (standCells.length > 0 && standIdx % 3 === 0) this.actors!.director.setGesture(id, 'talk', 6);
    });
    this.juntaAttendees = attendees;
    if (attendees.length > 0) {
      const seatedN = Math.min(attendees.length, hall.seats.length);
      const standingN = attendees.length - seatedN;
      useGameStore.getState().pushLog(
        standingN > 0
          ? `🗳️ Junta convocada: ${seatedN} vecinos toman asiento y ${standingN} se quedan de pie en la sala.`
          : `🗳️ Junta convocada: ${seatedN} vecinos entran en la sala y toman asiento.`,
        'info',
      );
    }
  }

  /** v1.30 — fin de la junta (o cancelación): la sala se vacía y la IA recupera a cada vecino. */
  private dismissJunta(): void {
    this.building?.setJuntaHall(null);
    for (const id of this.juntaAttendees) this.actors?.director.release(id);
    this.juntaAttendees = [];
  }

  /** Editor: desplazarse a una vivienda del jugador (queda delante de su puerta). */
  visitHome(blockId: string): void {
    if (!this.logic || !this.logic.teleportTo(blockId)) return;
    this.setCamMode('planta');
    this.pump();
  }

  // ───────────────────── Multijugador: sesión y modo remoto ─────────────────────

  /** Quien actúa por este cliente (invitado en sesión; si no, el jugador clásico). */
  private actorId(): string {
    return this.myResidentId ?? this.world?.playerId ?? '';
  }

  /** Vía única de comandos: remoto → servidor autoritativo; clásico → dispatch local.
   *  En clásico DEVUELVE el CommandResult del sim (PlayerLogic lo usa para saber si un move
   *  fue rechazado, p. ej. puerta con candado — sin esto la presentación "entraba" igual). */
  private sendCommand(cmd: Command): CommandResult | void {
    if (this.net) {
      this.net.command(cmd);
      return;
    }
    if (!this.world) return;
    const r = dispatch(this.world, this.content, cmd);
    this.pump();
    return r;
  }

  /** Crea una partida compartida (este cliente queda como anfitrión). */
  hostSession(): void {
    if (this.net || !this._content) return;
    const store = useGameStore.getState();
    store.setMpError(null);
    store.setMpStatus('connecting');
    store.setMpPanelOpen(true);
    this.connectNet();
    void this.net!.hostSession(this.activeScenarioId()).then((res) => {
      this.onHostJoinResult(res);
    });
  }

  /** Se une a una partida compartida por código. */
  joinSession(code: string): void {
    if (this.net || !this._content) return;
    const store = useGameStore.getState();
    store.setMpError(null);
    store.setMpStatus('connecting');
    store.setMpPanelOpen(true);
    this.connectNet();
    void this.net!.joinSession(code.trim().toUpperCase()).then((res) => {
      this.onHostJoinResult(res);
    });
  }

  /** Sale de la sesión y vuelve al mundo local en solitario. */
  leaveSession(): void {
    this.net?.leave();
    this.net?.disconnect();
    this.net = null;
    this.myResidentId = null;
    this.isHost = false;
    this.appliedSeq = 0;
    const store = useGameStore.getState();
    store.setMpStatus('off');
    store.setMpSession(null);
    store.setMpParticipants([]);
    store.setMpPanelOpen(false);
    void this.restart();
    store.pushToast('Has vuelto a tu partida en solitario.', 'info');
  }

  private connectNet(): void {
    this.net = new NetSession({
      onState: (s) => this.applyRemoteState(s),
      onParticipants: (p) => useGameStore.getState().setMpParticipants(p),
      onJoined: (j) => {
        this.myResidentId = j.yourResidentId;
        this.isHost = j.isHost;
        useGameStore.getState().setMpSession({ code: j.code, isHost: j.isHost, myResidentId: j.yourResidentId });
        useGameStore.getState().setMpParticipants(j.participants);
      },
      onError: (m) => {
        useGameStore.getState().pushToast(m, 'bad');
      },
      onStatus: (st) => {
        if (!this.net) return;
        if (st === 'connected' && useGameStore.getState().mpStatus === 'connecting') return; // el ack decide
        if (st === 'disconnected' && useGameStore.getState().mpStatus === 'connected') {
          useGameStore.getState().setMpStatus('error');
          useGameStore.getState().setMpError('Conexión perdida con el servidor de la comunidad.');
        }
      },
    });
  }

  private onHostJoinResult(res: { ok: boolean; code?: string; isHost?: boolean; yourResidentId?: string; error?: string }): void {
    const store = useGameStore.getState();
    if (!res.ok) {
      store.setMpStatus('error');
      store.setMpError(res.error === 'timeout' ? 'El servidor no responde. ¿Se habrá ido a comer?' : res.error ?? 'No se pudo abrir la sesión.');
      return;
    }
    store.setMpStatus('connected');
    // onJoined ya habrá fijado myResidentId/isHost/código con session:joined.
  }

  /** Adopta el estado del servidor (autoridad). Primera vez: reinicia la escena con ese mundo. */
  private applyRemoteState(s: SessionStatePayload): void {
    if (s.seq <= this.appliedSeq) return;
    this.appliedSeq = s.seq;
    if (!this.world || this.world.scenarioId !== s.world.scenarioId) {
      void this.restart(s.world).then(() => {
        if (!this.world) return;
        this.world.events = s.events.slice();
        this.handleEvents();
        this.reconcile();
        this.syncHud();
      });
      return;
    }
    // Aplica en sitio conservando la identidad del objeto (PlayerLogic/building/actors referencian el mismo World).
    Object.assign(this.world, s.world);
    this.world.events = s.events.slice();
    this.handleEvents();
    this.paintBuilding();
    this.reconcile();
    this.syncHud();
  }

  /** Corrige desvíos de posición del avatar local respecto al mundo del servidor (autoridad). */
  private reconcile(): void {
    if (!this.logic || !this.world || !this.net) return;
    const me = this.world.residents[this.actorId()];
    if (!me) return;
    const pos = this.logic.position();
    const locBlock = me.location ? this.world.blocks[me.location] : null;
    if (locBlock) {
      const insideOk = pos.mode === 'inside' && pos.insideBlock === locBlock.id;
      const corridorOk = pos.mode === 'corridor' && !pos.insideBlock;
      if (!(locBlock.kind === 'dwelling' ? insideOk : corridorOk) || Math.abs(pos.floor - locBlock.cell.floor) > 0.01) {
        this.logic.forceLocation(locBlock.id);
      }
    } else if (pos.mode === 'inside') {
      this.logic.forceLocation(null);
    }
  }

  /** Siguiente frase del teléfono; al colgar responde la llamada en el sim y saca la siguiente de la cola. */
  phoneNext(): void {
    if (this.phoneLine < this.phoneLines.length - 1) {
      this.phoneLine += 1;
      this.showPhoneLine();
      return;
    }
    const mission = this.phoneMission;
    this.phoneLines = [];
    this.phoneMission = '';
    useGameStore.getState().setPhone(null);
    this.actors?.director.setGesture(this.actorId(), null); // cuelgas: se suelta el teléfono
    if (this.world && mission) {
      this.sendCommand({ type: 'answer_call', mission });
    }
    const next = this.phoneQueue.shift();
    if (next) this.openPhone(next.mission, next.dialogId);
  }

  choose(choiceId: string): void {
    const state = useGameStore.getState();
    const mission = state.choices?.mission;
    state.setChoices(null);
    this.actors?.director.setGesture(this.actorId(), null); // decisión tomada: se deja de hablar
    if (!this.world || !mission) return;
    this.sendCommand({ type: 'choose', mission, choice: choiceId });
  }

  juntaVote(vote: 'yes' | 'no'): void {
    useGameStore.getState().setJunta(null);
    this.actors?.director.setGesture(this.actorId(), null);
    if (!this.world) return;
    this.sendCommand({ type: 'junta_vote', vote });
  }

  finaleClose(): void {
    useGameStore.getState().setFinale(null);
  }

  // ───────────────────────── Editor de interiores y minijuegos ─────────────────────────

  placeFurniture(block: string, room: string, slot: string, item: string): void {
    if (!this.world) return;
    if (this.net) {
      this.net.command({ type: 'place_furniture', block, room, slot, item });
      return;
    }
    const r = dispatch(this.world, this.content, { type: 'place_furniture', block, room, slot, item });
    if (!r.ok) this.furnitureFail(r.reason);
    this.pump();
  }

  removeFurniture(block: string, room: string, slot: string): void {
    if (!this.world) return;
    if (this.net) {
      this.net.command({ type: 'remove_furniture', block, room, slot });
      return;
    }
    const r = dispatch(this.world, this.content, { type: 'remove_furniture', block, room, slot });
    if (!r.ok) this.furnitureFail(r.reason);
    this.pump();
  }

  renovateRoom(block: string, room: string): void {
    if (!this.world) return;
    if (this.net) {
      this.net.command({ type: 'renovate_room', block, room });
      return;
    }
    const r = dispatch(this.world, this.content, { type: 'renovate_room', block, room });
    if (!r.ok) this.furnitureFail(r.reason);
    this.pump();
  }

  completeMinigame(id: string, success: boolean): void {
    if (!this.world) return;
    this.sendCommand({ type: 'complete_minigame', id, success });
    this.pump();
  }

  private furnitureFail(reason: string | undefined): void {
    const text = this.content.rules.furniture.errors[reason ?? ''] ?? 'Gestión inmobiliaria rechazada sin explicación. Como en la junta.';
    useGameStore.getState().pushToast(text, 'bad');
  }

  async save(): Promise<void> {
    if (!this.world) return;
    const store = useGameStore.getState();
    if (this.net) {
      store.pushToast(this.content.rules.multiplayer.texts.remoteSaveDisabled, 'info');
      return;
    }
    store.setSaveState('saving');
    drainEvents(this.world); // la cola de eventos no entra en el guardado
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: 'auto', state: this.world }),
      });
      if (!res.ok) throw new Error(String(res.status));
      store.setSaveState('saved', new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
      store.pushToast('Partida guardada. El acta queda en el tablón (y en SQLite).', 'good');
    } catch {
      store.setSaveState('error');
      store.pushToast('No se pudo guardar la partida. ¿El administrador se habrá ido a comer?', 'bad');
    }
  }

  async load(): Promise<void> {
    const store = useGameStore.getState();
    if (this.net) {
      store.pushToast(this.content.rules.multiplayer.texts.remoteSaveDisabled, 'info');
      return;
    }
    try {
      const res = await fetch('/api/save?slot=auto');
      const json = (await res.json()) as { state?: unknown };
      if (!json.state || typeof json.state !== 'object') {
        store.pushToast('Todavía no hay ninguna partida guardada.', 'info');
        return;
      }
      if (!this._content) {
        store.pushToast('El contenido todavía se está cargando. Espera un momento.', 'info');
        return;
      }
      await this.restart(json.state as World);
      store.pushToast('Partida cargada. El vecindario, exactamente como lo dejaste.', 'good');
    } catch {
      store.pushToast('No se pudo cargar la partida.', 'bad');
    }
  }

  // ───────────────────────── Ciclo de vida del mundo ─────────────────────────

  /** Escenario activo: parámetro ?scenario= (QA/E2E) o el que marca el catálogo. */
  private activeScenarioId(): string {
    try {
      return new URLSearchParams(window.location.search).get('scenario') ?? this.content.rules.startScenario;
    } catch {
      return this.content.rules.startScenario;
    }
  }

  /** (Re)crea el mundo y la escena. Con `state` restaura una partida guardada. */
  private async restart(state?: World): Promise<void> {
    if (!this.engine || !this.canvas || !this._content) return;
    // Ninguna cutscene sobrevive a un cambio de mundo: cola fuera y teatro desmontado.
    this.cutsceneQueue = [];
    this.cutscenePlayer?.abort();
    const { Color3, Color4, DirectionalLight, HemisphericLight, Scene, UniversalCamera, Vector3 } = B();
    const view = this.content.rules.view;
    useGameStore.getState().resetUi();

    this.world = state ?? createWorld(this.content, this.activeScenarioId());
    // v1.34 — TEXTOS 100% DATA-DRIVEN: los catálogos narrativos admiten tokens estructurales
    // ({plantas}, {viviendas}, {blk:id}) que se expanden UNA vez con el mundo real — un
    // título de misión dice la vivienda que existe, un cartel dice las plantas que hay.
    applyStaticTokens(this.content, this.world);
    this.scenarioOverrides = this.content.scenarios[this.world.scenarioId ?? '']?.minigameOverrides ?? {};
    // Guardados antiguos sin `entry`: la entrada es la zona común de planta baja.
    if (!this.world.entry) {
      this.world.entry = Object.values(this.world.blocks).find((b) => b.cell.floor === 0 && b.kind !== 'dwelling')?.id ?? Object.keys(this.world.blocks)[0]!;
    }
    // Migración de estancias de guardados v0.1: params y ranuras de muebles según catálogo.
    for (const b of Object.values(this.world.blocks)) migrateRooms(this.content, b.rooms);
    this.logic = new PlayerLogic(this.world, this.content, {
      actorId: this.myResidentId ?? undefined,
      send: (cmd) => this.sendCommand(cmd),
    });

    this.scene?.dispose();
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(view.sky.r, view.sky.g, view.sky.b, 1);
    // Pase de calidad FPS (v1.22): el puntero no necesita picking por movimiento (la
    // interacción va por zonas/teclado) y los materiales congelables del decorado lo
    // hacen en exterior.ts. Cero impacto visual, menos trabajo por frame.
    this.scene.skipPointerMovePicking = true;
    const hemi = new HemisphericLight('ambient', new Vector3(...view.ambient.dir), this.scene);
    hemi.intensity = view.ambient.intensity;
    // v1.29 — LUZ DE REBOTEO (catálogo): el groundColor de la hemisférica levanta las caras
    // que miran ABAJO (techos de los interiores, forjados) — antes negro puro, ahora un
    // gris cálido que se lee como techo en sombra. Data-driven (view.ambient.ground).
    if (view.ambient.ground) hemi.groundColor = Color3.FromHexString(view.ambient.ground);
    const dirLight = new DirectionalLight('sun', new Vector3(...view.sun.dir), this.scene);
    dirLight.intensity = view.sun.intensity;
    // v1.32 — SOMBRAS DE VERDAD (catálogo): un ShadowGenerator sobre el sol; quién proyecta
    // y quién recibe lo deciden los patrones de nombre del rules.json. Los rigs glTF que
    // llegan tarde y los vehículos nuevos los caza el refresco periódico del pase.
    this.shadows?.dispose();
    this.shadows = createShadows(this.scene, dirLight, view.shadows);

    this.building = createBuilding(this.scene, this.world, this.content);
    // v1.21: los rects de obstáculos del interior del trastero (estanterías/trastos que pinta
    // building) alimentan la colisión del movimiento libre dentro de la celda — UNA verdad.
    this.logic.setCellObstacles(this.building.cellObstacles());
    this.elevators = createElevators(this.scene, this.world, this.content);
    this.actors = createActors(this.scene, this.world, this.content, this.elevators);
    // Fondo urbano (v1.20): cielo dinámico por hora + fachadas parallax; la luz del catálogo
    // evoluciona con el sol (el edificio vive la misma hora que el cielo).
    this.backdrop?.dispose();
    this.backdrop = createBackdrop(this.scene, this.world, this.content, { hemi, dir: dirLight });
    // V1.28 — BLOOM/GLOW (catálogo): los emisivos (apliques de puerta, farolas, ventanas
    // nocturnas del fondo, pantallitas del ascensor, luz del cubo) ganan halo suave. Una
    // capa GlowLayer por escena; intensidad y kernel del catálogo (rules.view.glow).
    const glowCfg = this.content.rules.view.glow;
    this.glowLayer?.dispose();
    this.glowLayer = null;
    if (glowCfg?.enabled) {
      const { GlowLayer } = B();
      const gl = new GlowLayer('luz_bloom', this.scene, { blurKernelSize: glowCfg.blurKernelSize ?? 32 });
      gl.intensity = glowCfg.intensity ?? 0.7;
      // v1.29 — GLOW SUTIL EN LOS INTERIORES: el vecino pidió que la luz simulada de las
      // viviendas (diorama + suelos + lámparas de techo) sea autoiluminada SIN casi halo —
      // «demasiado exagerado». El building entrega sus mallas interiores y la capa las
      // excluye; apliques, farolas, pantallitas y ventanas nocturnas conservan su bloom.
      for (const mesh of this.building.glowExcluded()) gl.addExcludedMesh(mesh);
      this.glowLayer = gl;
    }
    // Calle (v1.20): aceras, carretera y jardines con sus props; las farolas leen la luz
    // de día del fondo para encenderse al anochecer.
    this.exterior?.dispose();
    this.exterior = createExterior(this.scene, this.world, this.content, this.backdrop);
    // La calle vive (v1.22): tráfico y viandantes — solo presentación, solo vista "edificio".
    // (Las manifestaciones se crean más abajo, tras los bocadillos, para poder comentarlas.)
    // v1.31: los vehículos leen la luz de día del cielo para encender y apagar los faros.
    this.traffic?.dispose();
    this.traffic = createTraffic(this.scene, this.world, this.content, () => this.backdrop?.daylight ?? 1);
    // v1.32 — TEATRO DE EMERGENCIAS: la ambulancia (rig del catálogo) que recoge heridos
    // de las peleas de acera. Se crea ANTES que los viandantes (ellos la llaman).
    this.ambulance?.dispose();
    this.ambulance = createAmbulanceTheater(this.scene, this.content, this.traffic);
    this.pedestrians?.dispose();
    this.pedestrians = createPedestrians(this.scene, this.world, this.content, this.ambulance);
    // Ecosistema del edificio (v1.14): cerebro data-driven + teatro de extras. Se recrea con
    // cada mundo (referencia al World vivo) y sigue la posición del jugador para las luces.
    this.ecosystem?.dispose();
    this.ecosystem = createEcosystem(this.scene, this.world, this.content, () => this.logic!.position());
    // Sonda de QA (SOLO dev): escena y controlador accesibles para el E2E automatizado.
    // En producción no se expone nada (la partida queda encapsulada igual que siempre).
    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { __vecinosQA?: { scene: unknown; controller: unknown; elevators: unknown; ecosystem: unknown; toast: (t: string, tone?: 'info' | 'good' | 'bad') => void } }).__vecinosQA = {
        scene: this.scene,
        controller: this,
        elevators: this.elevators,
        ecosystem: this.ecosystem,
        toast: (t, tone) => useGameStore.getState().pushToast(t, tone), // v1.29: QA de los post-its
      };
    }
    // Sonda E2E de la calle y las charlas (v1.20, SOLO dev): acceso indirecto a los directores.
    (window as unknown as { __vecinos20?: unknown }).__vecinos20 = {
      chats: () => this.chats,
      exterior: () => this.exterior,
      backdrop: () => this.backdrop,
    };
    // Sonda E2E de la calle viva (v1.22, SOLO dev).
    (window as unknown as { __vecinos22?: unknown }).__vecinos22 = {
      traffic: () => this.traffic,
      pedestrians: () => this.pedestrians,
      streetlife: () => this.streetlife,
      voices: () => this.voices,
    };
    // Bocadillos de expresión (v1.10): capa DOM sobre el canvas, recreada con el mundo
    // (referencia al World vivo). Sin emotes.json en el catálogo, director nulo sin capa.
    this.bubbles?.dispose();
    const stage = this.canvas?.parentElement;
    this.bubbles = stage && this.actors ? createBubbles(stage, this.scene, this.engine, this.world, this.content, this.actors.director) : null;
    // Charlas de cruce (v1.20): después de actores y bocadillos — son sus dos clientes.
    this.chats?.dispose();
    this.chats = createChats(this.world, this.content, this.actors!.director, this.bubbles);
    // Voces de proximidad (v1.22): después de actores y bocadillos — son sus clientes.
    this.voices?.dispose();
    this.voices = createVoices(this.world, this.content, this.actors!.director, this.bubbles);
    // streetlife necesita los bocadillos para los comentarios: reconstrúyelo con ellos.
    this.streetlife?.dispose();
    this.streetlife = createStreetlife(this.scene, this.world, this.content, this.actors?.director ?? null, this.bubbles);
    const blocks = Object.values(this.world.blocks);
    // El cubo de escalera (v1.4) sobresale spanW−1 celdas por la derecha del edificio:
    // el encuadre lo incluye para que la torre no se corte en cámara.
    const hasStairs = blocks.some((b) => this.content.blocks[b.defId]?.features?.stairs === true);
    const cols = Math.max(...blocks.map((b) => b.cell.col + b.size.w)) + (hasStairs ? this.content.rules.view.stairs.spanW - 1 : 0);
    this.rig = new CameraRig(
      new UniversalCamera('cam', new Vector3(0, 0, -30), this.scene),
      this.engine,
      cols,
      Math.max(...blocks.map((b) => b.cell.floor)) + 1,
      view.cellW,
      view.cellH,
    );
    // v1.36 — alejamiento de la cámara Estancia desde el catálogo (rules.view.camera):
    // factores de encuadre + margen de borde para el extremo del pasillo de planta 0.
    const camTuning = view.camera;
    if (camTuning) {
      this.rig.tuning = {
        estFloorH: camTuning.estanciaFloorH,
        estWidthW: camTuning.estanciaWidthW,
        estMargin: camTuning.estanciaEdgeMargin,
      };
    }
    // v1.20: plano frontal y calado del bloque principal — la cámara encuadra los bloques
    // traseros (apilamiento 3D) a la misma distancia que una estancia exterior.
    this.rig.metric = { frontZ: view.roomZ - view.commonDepth / 2, depth: view.depth };
    // Re-sincronización de vista (v0.6-b): la cámara sigue la posición del mundo (restaurado o
    // nuevo), no la preferencia anterior. Dentro de una vivienda → estancia; en pasillo, la
    // preferencia salvo que fuera 'estancia' (ahí estás en el pasillo, no en una estancia).
    const pos = this.logic.position();
    const store = useGameStore.getState();
    const wanted: CamMode = pos.mode === 'inside' ? 'estancia' : store.camMode === 'estancia' ? 'planta' : store.camMode;
    this.rig.mode = wanted;
    store.setCamMode(wanted);

    this.clockAcc = 0;
    this.keys.clear();
    this.phoneLines = [];
    this.phoneMission = '';
    this.phoneQueue = [];
    this.lastHudSync = 0;

    // Re-llamada (Fase F): si la partida montada tenía pasos de teléfono pendientes, vuelven a
    // sonar. La cola de openPhone ordena el resto sin que ninguna llamada se pierda.
    if (this.world) {
      for (const m of this.world.missions) {
        if (m.state !== 'active') continue;
        const step = this.content.missions[m.id]?.steps[m.step];
        if (step?.type === 'phone_call') this.openPhone(m.id, step.dialog);
      }
    }

    this.pump();
    // Logros (v1.17): primera foto del catálogo para el panel (y desbloqueos de la partida restaurada).
    this.syncAchievements();
    // Campaña (v1.18): primer estado del mandato (sobrevive a Cargar vía localStorage).
    syncCampaign(this.world!, this.content);
  }

  private onResize = (): void => {
    this.engine?.resize();
  };

  // ───────────────────────── Bucle de render ─────────────────────────

  private frame = (): void => {
    if (!this.engine || !this.scene || !this.world || !this.logic || !this.building || !this.actors || !this.rig || !this.elevators) return;
    const dt = Math.min(0.1, this.engine.getDeltaTime() / 1000);
    const store = useGameStore.getState();
    const frozen = selectModalOpen(store) || store.paused;

    let ticked = false;
    if (!frozen) {
      this.logic.update(dt, this.readInput());
      // Ascensor (v1.5): el director mueve cabinas y puertas; el jugador llama con W/S en el
      // núcleo y su escalada EXTERNA la gobierna la cabina (espera → embarco → viaje → salida).
      this.elevators.update(dt);
      const climb = this.logic.climbInfo();
      if (climb) {
        if (!this.logic.externalRequested) {
          const zone = this.logic.zone();
          this.elevators.requestRide(this.actorId(), zone.cell.col, climb.from, climb.to);
          this.logic.externalRequested = true;
        }
        const st = this.elevators.status(this.actorId());
        if (!st) {
          this.logic.finishClimbAtNearest(); // fuera de servicio: aterriza en la planta más cercana (sin teletransporte)
          this.logic.externalRequested = false;
          this.playerBoardT = 0;
        } else {
          this.logic.setClimbProgress(st.phase === 'riding' ? st.progress : 0);
          const inside = st.phase === 'boarding' || st.phase === 'riding';
          this.logic.setClimbZ(inside ? this.content.rules.view.roomZ - this.content.rules.view.commonDepth / 2 + this.content.rules.view.elevator.rideZ : null);
          // El jugador "da un paso" dentro de la cabina un instante tras abrirse la puerta
          // (el zOverride ya lo acerca); avisar al director para que cierre y viaje.
          if (st.phase === 'boarding') {
            this.playerBoardT += dt;
            if (this.playerBoardT > 1.0) this.elevators.notifyBoarded(this.actorId());
          } else {
            this.playerBoardT = 0;
          }
          if (st.phase === 'exiting') {
            this.logic.finishClimb();
            this.logic.externalRequested = false;
          }
        }
      } else if (this.logic.externalRequested) {
        this.logic.externalRequested = false;
      }
      // En remoto el servidor es la autoridad del reloj: nada de ticks locales.
      if (!this.net) {
        this.clockAcc += dt * store.speed;
        let guard = 0;
        while (this.clockAcc >= 1 && guard < 60) {
          tick(this.world, this.content);
          this.clockAcc -= 1;
          ticked = true;
          guard += 1;
        }
      }
    }

    if (this.world.events.length > 0) this.handleEvents();
    if (ticked) this.paintBuilding();

    const now = performance.now();
    if (now - this.lastHudSync > 200) {
      this.lastHudSync = now;
      useGameStore.getState().setFps(Math.round(this.engine.getFps()));
      this.syncHud();
    }

    // Logros (v1.17): evaluación perezosa a cadencia (~cada 2 s de tiempo real).
    // El evaluador es puro y solo lee el mundo, así que da igual si hay modal o pausa.
    this.achAcc += dt;
    if (this.achAcc >= 2) {
      this.achAcc = 0;
      this.syncAchievements();
      // Campaña (v1.18): el día de mandato avanza con el reloj — misma cadencia.
      syncCampaign(this.world!, this.content);
    }

    const pos = this.logic.position();
    this.actors.update(dt, pos, this.actorId());
    // v1.32 — SOMBRAS: refresco perezoso de participantes (rigs glTF tardíos, pool de
    // tráfico, celadores…): escaneo barato cada 2 s contra un Set de vistas.
    this.shadowRefreshT -= dt;
    if (this.shadows && this.shadowRefreshT <= 0) {
      this.shadowRefreshT = 2;
      this.shadows.refresh();
    }
    // Fondo urbano (v1.20): el cielo, el sol y las nubes siguen la hora del sim; las farolas
    // de la calle leen la luz de día resultante. Los modales no paran el ambiente (solo el reloj).
    this.backdrop?.update(dt);
    this.exterior?.update(dt);
    // v1.21/v1.22: el MOBILIARIO de la calle, los vehículos, los viandantes y las
    // manifestaciones viven en las vistas "edificio" y "planta" (v1.23: la planta baja
    // ve pasar la acera en el encuadre — no perderse la vidilla de la calle); en
    // estancia se apagan (menos carga, y no estorban la vista de la estancia).
    const streetView = store.camMode === 'edificio' || store.camMode === 'planta';
    this.exterior?.setPropsVisible(streetView);
    this.traffic?.setVisible(streetView);
    this.ambulance?.setVisible(streetView);
    this.pedestrians?.setVisible(streetView);
    this.streetlife?.setVisible(streetView);
    if (streetView) {
      this.traffic?.update(dt);
      this.ambulance?.update(dt);
      this.pedestrians?.update(dt);
      this.streetlife?.update(dt);
    }
    // Charlas de cruce (v1.20): en multijugador quedan en pausa (mismo criterio que el ecosistema).
    if (!this.net) this.chats?.update(dt);
    // Voces de proximidad (v1.22): se oyen en cualquier vista (pasillos incluidos).
    if (!this.net) this.voices?.update(dt);
    // Cutscene (Fase D): sus beats mueven cámara/actores DESPUÉS de los eventos y ANTES del render.
    this.cutscenePlayer?.update(dt);
    // Bocadillos (v1.10): después de actores y cámara — proyectan la posición FINAL del frame.
    this.bubbles?.update(dt, this.actorId());
    // Ecosistema (v1.14): cerebro a cadencia + extras + luces + deterioro. En multijugador
    // queda en pausa (el servidor es la autoridad; mismo criterio que partyDemo).
    if (!this.net) this.ecosystem?.update(dt);
    // Si la cutscene acaba y queda cola, encadena la siguiente aquí: no dependemos de que el sim
    // genere otro evento para descolgar la siguiente (durante el teatro el sim está congelado).
    if (this.cutsceneQueue.length > 0 && !this.cutscenePlayer?.active) this.pumpCutscene();
    // LOD por distancia: solo con cámaras cercanas (planta/estancia); el plano general (edificio) muestra todo.
    // Privacidad (v1.17): el tercer argumento es el bloque donde está el jugador — las fachadas
    // de las viviendas reaccionan al instante cuando entra o sale.
    // v1.19: el cuarto argumento alimenta carteles guía de trasteros y el apilamiento 3D.
    this.syncRear(pos);
    // v1.24: posiciones de todos los vecinos en escena — abren las puertas de escalera al
    // acercarse y encienden su iluminación compartida de noche al moverse por los cubos.
    const movers: { x: number; y: number; z: number }[] = [{ x: pos.x, y: pos.floor * (this.content?.rules.view.cellH ?? 2.6), z: pos.z }];
    if (this.world && this.actors) {
      for (const r of Object.values(this.world.residents)) {
        if (!r.present || r.location === null) continue;
        const p = this.actors.director?.nodeOf(r.id);
        if (p) movers.push(p);
      }
    }
    // v1.26: los EXTRAS del ecosistema (repartidor a puerta…) también abren las puertas de
    // escalera y encienden la luz compartida del cubo — nadie más llega a puertas cerradas.
    if (this.ecosystem) movers.push(...this.ecosystem.extraPositions());
    // v1.30 — los VIANDANTES también cuentan: el portal abre sus correderas cuando un
    // visitante se acerca a entrar (y el cubo de escalera los ve pasar, como siempre).
    for (const p of this.pedestrians?.positions() ?? []) movers.push({ x: p.x, y: 0, z: p.z });
    this.building.update(
      dt,
      useGameStore.getState().camMode === 'edificio' ? undefined : { x: pos.x, floor: pos.floor },
      pos.insideBlock,
      { x: pos.x, z: pos.z, insideBlock: pos.insideBlock },
      // v1.21: luz de día del fondo → luces nocturnas de interiores (encendidas solo con
      // gente despierta dentro) y pasillos a oscuras de noche salvo presencia + instalación OK.
      // v1.24: movers → puertas de escalera + su luz compartida nocturna.
      { daylight: this.backdrop ? this.backdrop.daylight : 1, movers },
    );
    this.rig.update(dt, pos);
    this.scene.render();
  };

  /**
   * Apilamiento 3D (v1.19): cada frame decide la fase del bloque trasero activo (y apaga el
   * resto). Trastero propio: E manda ('inside' mientras rearCell). Cuarto trasero de la
   * vivienda: asoma al acercarte a la puerta del fondo ('peek') y se activa al cruzar ('inside').
   */
  private syncRear(pos: ReturnType<PlayerLogic['position']>): void {
    if (!this.building || !this.world || !this.logic) return;
    let activeId: string | null = null;
    let phase: 'idle' | 'peek' | 'inside' = 'idle';
    if (this.logic.rearCell) {
      activeId = this.logic.rearCell.block;
      phase = 'inside';
    } else if (pos.mode === 'inside' && pos.insideBlock) {
      const b = this.world.blocks[pos.insideBlock];
      if (b && b.kind === 'dwelling') {
        const geo = layoutGeometryOf(this.content, b);
        const depth = this.content.rules.view.depth;
        const rear = geo?.rooms.find((r) => r.rect.z + r.rect.d > depth + 0.01);
        if (geo && rear) {
          const localX = pos.x - b.cell.col * this.content.rules.view.cellW;
          const room = roomAt(geo, localX, pos.z);
          const rearDoor = geo.doorways.find((d) => d.axis === 'x' && d.b === rear.key);
          const near =
            rearDoor &&
            pos.z > depth - this.content.rules.view.rearBlock.peekDistance &&
            Math.abs(localX - rearDoor.at) < rearDoor.width / 2 + 0.3;
          if (room.key === rear.key) {
            activeId = b.id;
            phase = 'inside';
          } else if (near) {
            activeId = b.id;
            phase = 'peek';
          }
        }
      }
    }
    for (const b of Object.values(this.world.blocks)) {
      if (!this.building.hasRear(b.id)) continue;
      this.building.setRearPhase(b.id, b.id === activeId ? phase : 'idle');
    }
  }

  /** Bomba de sincronización: reparte eventos pendientes y refresca el HUD. */
  private pump(): void {
    if (!this.world) return;
    this.handleEvents();
    this.paintBuilding();
    this.syncHud();
  }

  private paintBuilding(): void {
    this.building?.paint();
    // v1.35 — el nivel de grafiti de la cabina (param del núcleo) pinta el mural del
    // artista y salpica los muros del cubo/vestíbulo (el building lo hace en su paint()).
    const nuc = this.world ? Object.values(this.world.blocks).find((b) => this.content.blocks[b.defId]?.features?.elevator) : null;
    const level = typeof nuc?.params.cabin_graffiti === 'number' ? nuc.params.cabin_graffiti : 0;
    this.elevators?.setGraffiti(level);
  }

  // ───────────────────────── Eventos del sim → interfaz ─────────────────────────

  private nameOf(residentId: unknown): string {
    const r = this.world?.residents[String(residentId)];
    return r ? this.content.archetypes[r.archetype]?.name ?? r.id : String(residentId);
  }

  private titleOf(missionId: unknown): string {
    return this.content.missions[String(missionId)]?.title ?? String(missionId);
  }

  /** Etiqueta visible de una actividad (vive en el arquetipo, no en el código). */
  private activityLabel(residentId: unknown, activity: string): string {
    const r = this.world?.residents[String(residentId)];
    return r ? this.content.archetypes[r.archetype]?.activities[activity]?.label ?? activity : activity;
  }

  private handleEvents(): void {
    if (!this.world) return;
    const store = useGameStore.getState();
    for (const e of drainEvents(this.world)) {
      const d = e.data as Record<string, unknown>;
      eventSound(e.type, typeof d.type === 'string' ? d.type : undefined);
      switch (e.type) {
        case 'step_started':
          if (d.type === 'phone_call') this.openPhone(String(d.mission), String(d.dialog));
          break;
        case 'choice_required': {
          const choices = (d.choices as { id: string; label: string; hint?: string | null }[] | undefined) ?? [];
          store.setChoices({ mission: String(d.mission), title: String(d.title), choices: choices.map((c) => ({ id: c.id, label: c.label, hint: c.hint ?? null })) });
          store.pushLog(`⚖️ Decisión pendiente: ${String(d.title)}`, 'info');
          this.actors?.director.setGesture(this.actorId(), 'talk'); // el jugador razona en voz alta
          break;
        }
        case 'door_locked': {
          this.building?.shake(String(d.block));
          const price = typeof d.price === 'number' ? d.price : null;
          store.pushToast(`${blockLabel(String(d.block))}: puerta con candado${d.reason === 'for_sale' && price !== null ? ` (a la venta por ${price} €)` : ''}`, 'info');
          break;
        }
        case 'neighbor_arrived':
          store.pushToast(`Nuevo vecino en ${blockLabel(String(d.block))}: ${this.nameOf(d.resident)}`, 'good');
          store.pushLog(`${this.nameOf(d.resident)} se muda a ${blockLabel(String(d.block))}. El edificio ya no es lo que era. Era mejor.`, 'info');
          break;
        case 'mission_activated':
          store.pushLog(`📋 Nueva misión: ${String(d.title)}`, 'info');
          break;
        case 'mission_completed':
          // v1.30 — post-it de CELEBRACIÓN: se pliega como origami y suelta estrellitas que
          // caen al suelo (ToastStack) — sobre la fanfarria, como pidió el vecino.
          store.pushToast(`Misión completada: ${this.titleOf(d.mission)}`, 'good', { celebrate: true });
          store.pushLog(`✔ Misión completada: ${this.titleOf(d.mission)}`, 'good');
          this.syncAchievements(); // una misión caída puede cerrar varios logros a la vez
          syncCampaign(this.world!, this.content); // la misión del cargo activa el chip de presidencia
          break;
        case 'mission_failed':
          store.pushToast(`Misión fallida: ${this.titleOf(d.mission)}`, 'bad');
          store.pushLog(`✘ Misión fallida: ${this.titleOf(d.mission)}`, 'bad');
          break;
        case 'block_unlocked':
          store.pushToast(`${blockLabel(String(d.block))} desbloqueado`, 'good');
          break;
        case 'block_bought':
          store.pushLog(`🔑 ${blockLabel(String(d.block))} comprado por ${String(d.price)} €`, 'good');
          break;
        case 'block_for_sale':
          store.pushLog(`🪧 Cartel de "SE VENDE" en ${blockLabel(String(d.block))} (${String(d.price)} €)`, 'info');
          break;
        case 'knock_result':
          store.pushToast(`🗣️ ${String(d.name)}: «${String(d.line)}»`, d.asleep ? 'info' : 'good');
          // El vecino que responde gesticula la réplica unos segundos (v1.2).
          if (typeof d.resident === 'string') this.actors?.director.setGesture(d.resident, 'talk', 3.5);
          break;
        case 'noise_complaint': // texto data-driven: lo pinta el uiLog del catálogo (case mantenido por compatibilidad de eventos antiguos)
          if (d.uiLog === true) break;
          store.pushLog(`🔊 Ruido por encima del límite en ${blockLabel(String(d.block))}. Alguien aprieta los dientes.`, 'bad');
          break;
        case 'leak_detected':
          if (d.uiLog === true) break;
          store.pushLog(`💧 Goteo detectado en ${blockLabel(String(d.block))}. El cubo del salón hace ojitos.`, 'bad');
          break;
        case 'furniture_placed':
          store.pushLog(`${String(d.emoji ?? '📦')} ${String(d.name)} colocado en ${blockLabel(String(d.block))} (${String(d.room)}).`, 'info');
          break;
        case 'furniture_removed':
          store.pushLog(`${String(d.emoji ?? '📦')} ${String(d.name)} retirado de ${blockLabel(String(d.block))} (+${String(d.refund)} €).`, 'info');
          break;
        case 'room_renovated':
          store.pushLog(`🧱 Reforma terminada en ${blockLabel(String(d.block))}. Hay estancia nueva que amueblar.`, 'good');
          break;
        case 'weather_changed':
          store.pushLog(`El cielo cambia: ${this.content.rules.labels.weather[String(d.state)] ?? String(d.state)}`, 'info');
          break;
        case 'rent_collected':
          store.pushToast(`+${String(d.amount)} € de alquiler (${blockLabel(String(d.block))})`, 'good');
          break;
        case 'work_done':
          store.pushLog(`💻 Cerrada una "reunión que podía ser un correo": +${String(d.amount)} €`, 'info');
          break;
        case 'activity_started':
          if (d.activity !== 'idle') store.pushLog(`${this.nameOf(d.resident)} ${this.activityLabel(d.resident, String(d.activity))}`, 'info');
          break;
        case 'junta_requested': {
          const agenda = (d.agenda as { id: string; title: string; description: string; cost: number }[] | undefined) ?? [];
          store.setJunta(agenda.map((i) => ({ id: i.id, title: i.title, description: i.description, cost: i.cost })));
          this.actors?.director.setGesture(this.actorId(), 'talk'); // defensa del orden del día
          this.marchJunta(); // v1.30: los presentes entran en la sala de juntas y se sientan
          break;
        }
        case 'junta_result':
          store.pushToast(
            d.approved ? `Aprobado: ${String(d.title)} (${String(d.yes)} sí / ${String(d.no)} no)` : `Rechazado: ${String(d.title)} (${String(d.yes)} sí / ${String(d.no)} no)`,
            d.approved ? ('good' as Tone) : ('bad' as Tone),
          );
          break;
        case 'junta_vote_registered':
          store.pushLog(`🗳️ ${this.nameOf(d.resident)} ha depositado su voto. Pendientes: ${String(d.pendingHumans)}`, 'info');
          break;
        case 'junta_closed':
          store.setJunta(null);
          this.dismissJunta(); // v1.30: la sala se vacía, la IA retoma a los vecinos
          break;
        case 'stairs_grumble':
          // Malestar vecinal (v1.5): texto del catálogo con el nombre del vecino que sube a pie.
          store.pushLog(String(this.content.rules.sim.elevator.grumbleText).replace('{name}', this.nameOf(d.resident)), 'info');
          break;
        case 'minigame_requested': {
          const def = this.content.minigames[String(d.minigame)];
          if (!def) break;
          // Overrides numéricos del escenario activo (QA/E2E): solo config, nunca efectos ni textos.
          const ov = this.scenarioOverrides[def.id];
          const effective = ov ? ({ ...def, config: { ...def.config, ...ov } } as MinigameDef) : def;
          store.setMinigame({ ...effective, emoji: effective.emoji ?? '🎮', instruction: effective.instruction ?? null });
          break;
        }
        case 'minigame_finished': {
          const name = this.content.minigames[String(d.minigame)]?.name ?? String(d.minigame);
          store.pushLog(d.success ? `🎮 Minijuego superado: ${name}` : `🎮 Minijuego fallido: ${name}`, d.success ? 'good' : 'bad');
          break;
        }
        case 'ui_toast':
          // v1.33: los avisos del catálogo (ecosistema incluido) admiten tokens
          // data-driven si el evento trae vecinos {a}/{b}; sin contexto, texto tal cual.
          // v1.34: {home} (la vivienda del jugador) y el resto del catálogo de tokens.
          store.pushToast(
            resolveTokens(String(d.text), this.world, this.content, {
              a: typeof d.a === 'string' ? d.a : undefined,
              b: typeof d.b === 'string' ? d.b : undefined,
              home: this.world.residents[this.world.playerId]?.home,
            }),
            (d.tone as Tone | undefined) ?? 'info',
          );
          break;
        case 'finale':
          store.setFinale(String(d.text));
          break;
        case 'funds_changed': {
          const amount = typeof d.amount === 'number' ? d.amount : 0;
          if ((d.to === 'player' || d.to === 'community') && amount !== 0) {
            store.pushLog(amount > 0 ? `+${amount} € (fondos)` : `${amount} € (fondos)`, amount > 0 ? 'good' : 'bad');
          }
          break;
        }
        default: {
          // Umbral de canal con texto del catálogo (odors, wifi y futuros canales): totalmente data-driven.
          if (d.uiLog === true && typeof d.message === 'string') {
            store.pushLog(String(d.message).replace('{block}', blockLabel(String(d.block))), (d.tone as Tone | undefined) ?? 'info');
          }
          break; // resident_moved, param_changed, activity_ended... demasiado ruido para el registro
        }
      }
      // Cutscenes (Fase D): después del reparto, ¿alguna quiere este evento como disparador?
      this.maybeCutscene(e);
      // Bocadillos (v1.10): reacciones expresivas al evento según emotes.json del catálogo.
      this.bubbles?.onEvent(e);
    }
    this.pumpCutscene();
  }

  // ───────────────────────── Cutscenes (Fase D) ─────────────────────────

  /** Si el evento encaja con el trigger de alguna cutscene del catálogo, se encola (máx. 3). */
  private maybeCutscene(e: GameEvent): void {
    const defs = Object.values(this.content.cutscenes);
    if (defs.length === 0) return;
    const d = e.data as Record<string, unknown>;
    const hit = defs.find((c) => {
      const t = c.trigger;
      if (t.on !== e.type) return false;
      if (t.mission !== undefined && t.mission !== String(d.mission ?? '')) return false;
      if (t.step !== undefined && t.step !== String(d.step ?? '')) return false;
      return true;
    });
    if (!hit) return;
    if (this.cutsceneQueue.length >= 3) return; // nunca más de 3 esperando: el teatro no atravaca la partida
    this.cutsceneQueue.push({
      def: hit,
      ctx: {
        mission: typeof d.mission === 'string' ? d.mission : null,
        resident: typeof d.resident === 'string' ? d.resident : null,
        block: typeof d.block === 'string' ? d.block : null,
      },
    });
  }

  /** Lanza la siguiente cutscene en cola si no hay nada en pantalla (también un modal la pospone). */
  private pumpCutscene(): void {
    if (!this.cutscenePlayer || !this.world || !this.rig || !this.actors || !this.engine || !this.logic) return;
    if (this.cutscenePlayer.active || this.cutsceneQueue.length === 0) return;
    if (selectModalOpen(useGameStore.getState())) return; // no se roba la pantalla a un modal
    const next = this.cutsceneQueue.shift()!;
    this.cutscenePlayer.start(next.def, next.ctx, {
      engine: this.engine,
      rig: this.rig,
      actors: this.actors.director,
      world: this.world,
      playerPos: () => this.logic!.position(),
    });
  }

  // ───────────────────────── Teléfono ─────────────────────────

  private openPhone(mission: string, dialogId: string): void {
    const dlg = this.content.dialogs[dialogId];
    if (!dlg || dlg.lines.length === 0) return;
    // Si ya hay una llamada en pantalla, la nueva espera en cola (dedupe por misión).
    if (this.phoneMission) {
      if (this.phoneMission !== mission && !this.phoneQueue.some((q) => q.mission === mission)) {
        this.phoneQueue.push({ mission, dialogId });
      }
      return;
    }
    this.phoneMission = mission;
    this.phoneLines = dlg.lines;
    this.phoneLine = 0;
    this.actors?.director.setGesture(this.actorId(), 'phone'); // el jugador atiende con el móvil a la oreja
    this.showPhoneLine();
  }

  private showPhoneLine(): void {
    const line = this.phoneLines[this.phoneLine];
    if (!line) return;
    useGameStore.getState().setPhone({ mission: this.phoneMission, speaker: line.speaker, text: line.text, isLast: this.phoneLine === this.phoneLines.length - 1 });
  }

  // ───────────────────────── HUD ─────────────────────────

  /** Nombre visible de un bloque: label del catálogo (data-driven) o etiqueta de vivienda (1B). */
  private blockName(id: string): string {
    const b = this.world?.blocks[id];
    const defLabel = b ? this.content.blocks[b.defId]?.label : undefined;
    return defLabel ?? blockLabel(id);
  }

  private objectiveUi(): { title: string; text: string } | null {
    if (!this.world) return null;
    const o = activeObjective(this.world, this.content);
    if (!o) return null;
    if (o.state === 'awaiting_choice') return { title: o.title, text: 'El edificio contiene la respiración. Decide qué hacer.' };
    const s = o.step!;
    const left = o.untilTick !== null ? ` · quedan ${Math.max(0, o.untilTick - this.world.tick)} min` : '';
    switch (s.type) {
      case 'phone_call':
        return { title: o.title, text: 'Suena el teléfono. Atiéndelo.' };
      case 'reach':
        return { title: o.title, text: `Llega a la puerta (${this.blockName(s.block ?? '')}).` };
      case 'enter':
        return { title: o.title, text: 'Entra en tu piso con E.' };
      case 'catch_in_act':
        return { title: o.title, text: `Pilla al responsable in fraganti${left}.` };
      default:
        return { title: o.title, text: o.title };
    }
  }

  private promptText(): string | null {
    const logic = this.logic;
    const world = this.world;
    if (!logic || !world) return null;
    if (logic.position().climbing) return null;
    // El prompt es SIEMPRE el objetivo real de la tecla E (misma fuente, cero divergencias).
    const t = logic.interactTarget();
    if (t) {
      const ic = this.content.rules.interact;
      switch (t.kind) {
        case 'door': {
          const door = world.blocks[t.blockId]!;
          if (logic.position().mode === 'inside') return ic.exit;
          return door.access === 'locked'
            ? ic.doorLocked.replace('{block}', this.blockName(door.id))
            : ic.doorEnter.replace('{block}', this.blockName(door.id));
        }
        case 'resident':
          return ic.greet.replace('{name}', this.nameOf(t.residentId));
        case 'mailbox':
          return ic.mailbox.prompt;
        case 'noticeboard':
          return ic.noticeboard.prompt;
        case 'laptop':
          return ic.laptop;
        case 'bed':
          return ic.bed;
        case 'storageCell':
          return ic.storageEnter;
        case 'rearExit':
          return ic.rearExit;
      }
    }
    const zone = logic.zone();
    const feat = this.content.blocks[zone.defId]!.features;
    if (feat?.stairs || feat?.elevator) {
      const ic = this.content.rules.interact;
      // Lo que dice el prompt es lo que W/S hace aquí: ascensor operativo manda; si no hay
      // ascensor utilizable pero sí escalera, escalera; núcleo averiado sin escalera = aviso.
      if (feat.elevator && world.blocks[zone.id]!.params.elevator_status === 'ok') return ic.elevator;
      if (feat.stairs) return ic.stairs;
      return ic.elevatorBroken;
    }
    return null;
  }

  /** Viviendas del jugador para el editor de interiores (foto serializable, posiciones ya en %). */
  private homesUi() {
    const world = this.world!;
    const cellH = this.content.rules.view.cellH;
    const mine = this.actorId();
    return Object.values(world.blocks)
      .filter((b) => b.kind === 'dwelling' && b.ownerId === mine)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((b) => ({
        id: b.id,
        label: blockLabel(b.id),
        rooms: b.rooms.map((room) => {
          const rdef = this.content.rooms[room.defId];
          const slots = (rdef?.furnitureSlots ?? []).map((s) => {
            const itemId = room.furniture[s.id] ?? '';
            const fdef = itemId ? this.content.furniture[itemId] : undefined;
            return {
              id: s.id,
              kind: s.kind,
              left: Math.min(92, Math.max(2, (s.pos[0] / Math.max(0.001, rdef?.size.w ?? 1)) * 100)),
              bottom: Math.min(76, Math.max(0, (s.pos[1] / Math.max(0.001, cellH)) * 100)),
              item: fdef ? { id: fdef.id, name: fdef.name, emoji: fdef.emoji ?? '📦', color: fdef.view.color } : null,
            };
          });
          return { key: room.key, label: rdef?.label ?? room.key, access: room.access, slots };
        }),
      }));
  }

  private syncHud(): void {
    const world = this.world;
    if (!world) return;
    const player = world.residents[this.actorId()] ?? world.residents[world.playerId];
    if (!player) return;
    const home = player.home;
    const params = visibleParams(world, this.content, home).map((p) => ({ name: p.name, label: p.def.label ?? p.name, value: String(p.value) }));
    const missions = world.missions.map((m) => {
      const def = this.content.missions[m.id]!;
      const step = m.state === 'active' ? def.steps[m.step] : undefined;
      return {
        id: m.id,
        title: def.title,
        state: m.state,
        hint: step?.hint ?? null,
        remaining: m.until !== null ? `quedan ${Math.max(0, m.until - world.tick)} min` : null,
      };
    });
    const travel = travelMinutes(buildCirculation(world, this.content), world.entry, home);
    const elevatorBlock = Object.values(world.blocks).find((b) => b.params.elevator_status !== undefined);
    useGameStore.getState().syncHud({
      clock: { ...world.clock },
      weather: world.weather.state,
      funds: world.community.funds,
      wallet: player.wallet,
      reputation: player.reputation,
      elevator: String(elevatorBlock?.params.elevator_status ?? 'ok'),
      homeLabel: blockLabel(home),
      travelText: Number.isFinite(travel) ? `del portal a tu puerta: ${travel} min` : null,
      objective: this.objectiveUi(),
      prompt: this.promptText(),
      params,
      missions,
      homes: this.homesUi(),
      furnitureConfig: { refundRatio: this.content.rules.furniture.refundRatio, roomUnlockPrice: this.content.rules.furniture.roomUnlock.price },
    });
  }

  // ───────────────────── Logros tipo Steam (v1.17) ─────────────────────

  /** Logro del catálogo → forma de UI con textos resueltos al idioma actual del store. */
  private achievementUi(def: AchievementDef, unlocked: boolean, newly = false): AchievementUi {
    const lang = useGameStore.getState().lang;
    return {
      id: def.id,
      icon: def.icon,
      name: def.name[lang] ?? def.name.es,
      desc: def.desc[lang] ?? def.desc.es,
      hidden: def.hidden === true,
      unlocked,
      newly,
    };
  }

  /** Re-pinta la lista de logros (mismos desbloqueos) con los textos del idioma actual. */
  private rebuildAchievementTexts(): void {
    const catalog = this._content?.achievements;
    if (!catalog) return;
    const prev = useGameStore.getState().achievements;
    useGameStore.getState().setAchievements(
      catalog.achievements.map((def) => {
        const old = prev.find((a) => a.id === def.id);
        return this.achievementUi(def, this.unlockedAchievements.has(def.id), old?.newly === true);
      }),
    );
  }

  /**
   * Evalúa el catálogo de logros contra el estado actual del mundo. Solo LEE el sim: el
   * evaluador es puro (src/game/support/achievements.ts) y aquí se persisten los
   * desbloqueos en el perfil (localStorage), se anuncian en el registro y se encola el
   * popup estilo Steam (uno en pantalla; el resto queda `newly` para AchievementPopup).
   * Sin catálogo (achievements.json ausente) no hay logros y no se toca nada.
   */
  private syncAchievements(): void {
    const catalog = this._content?.achievements;
    const world = this.world;
    if (!catalog || !world) return;
    const player = world.residents[this.actorId()] ?? world.residents[world.playerId];
    if (!player) return;
    const store = useGameStore.getState();

    // Snapshot con las mismas fuentes que el HUD (día del reloj, funds, ascensor del núcleo…).
    const elevatorBlock = Object.values(world.blocks).find((b) => b.params.elevator_status !== undefined);
    let bestAffinity = 0;
    for (const rel of player.relations) bestAffinity = Math.max(bestAffinity, rel.affinity);
    const snap: AchievementSnapshot = {
      day: world.clock.day,
      tick: world.tick,
      wallet: player.wallet,
      funds: world.community.funds,
      reputation: player.reputation,
      elevatorStatus: String(elevatorBlock?.params.elevator_status ?? 'ok'),
      missionsDone: world.missions.filter((m) => m.state === 'done').map((m) => m.id),
      bestAffinity,
    };

    const fresh = evaluateAchievements(catalog, snap, this.unlockedAchievements);
    if (fresh.length === 0 && store.achievements.length > 0) return; // nada nuevo y lista ya pintada

    if (fresh.length > 0) {
      for (const id of fresh) this.unlockedAchievements.add(id);
      saveUnlocked([...this.unlockedAchievements]);
    }
    store.setAchievements(
      catalog.achievements.map((def) => this.achievementUi(def, this.unlockedAchievements.has(def.id), fresh.includes(def.id))),
    );

    const lang = useGameStore.getState().lang;
    for (const id of fresh) {
      const def = catalog.achievements.find((a) => a.id === id);
      if (def) store.pushLog(`🏆 Logro desbloqueado: ${def.name[lang] ?? def.name.es}`, 'good');
    }
    if (fresh.length > 0 && useGameStore.getState().achievementPopup === null) {
      const first = catalog.achievements.find((a) => a.id === fresh[0]);
      if (first) useGameStore.getState().setAchievementPopup(this.achievementUi(first, true));
    }
  }
}

// ───────────────────────── Singleton ─────────────────────────

let instance: GameController | null = null;

/** Crea (o reutiliza) el controlador y lo arranca sobre el canvas dado. */
export function createGameController(canvas: HTMLCanvasElement): GameController {
  if (!instance) {
    instance = new GameController();
    setController(instance); // la UI lo usa desde ya; sus acciones toleran mundo nulo
    void instance.init(canvas);
    // Gancho de depuración/E2E (solo lectura + teleport QoL de pruebas).
    const dbg = instance as unknown as { logic?: PlayerLogic; world?: World } | null;
    (globalThis as Record<string, unknown>).__vecinosDebug = () => ({
      player: dbg?.logic
        ? {
            x: +dbg.logic.x.toFixed(2),
            z: +dbg.logic.z.toFixed(2),
            floor: dbg.logic.floor,
            mode: dbg.logic.mode,
            insideBlock: dbg.logic.insideBlock,
            climbing: !!dbg.logic.position().climbing,
          }
        : null,
      clock: dbg?.world ? { ...dbg.world.clock } : null,
      camMode: useGameStore.getState().camMode,
      paused: useGameStore.getState().paused,
      simLocation: dbg?.world?.residents[dbg.world.playerId]?.location ?? null,
      missions: dbg?.world?.missions.map((m) => `${m.id}:${m.state}${m.state === 'active' ? `#${m.step}` : ''}`) ?? [],
      /** QoL de pruebas E2E: colocar al jugador ante la puerta de un bloque (recorrido legal del grafo). */
      tp: (blockId: string) => !!dbg?.logic?.teleportTo(blockId),
      /** QoL de pruebas E2E: comando del sim directo (diagnóstico de pasos). */
      cmd: (c: unknown) => {
        const w = dbg?.world;
        const ct = (dbg as unknown as { _content?: Content } | null)?._content;
        return w && ct ? JSON.stringify(dispatch(w, ct, c as Command)) : 'no-world';
      },
      /** QoL de pruebas E2E (pestaña en segundo plano: rAF suspendido): avanza n ticks del sim. */
      tickN: (n: number) => {
        const w = dbg?.world;
        const ct = (dbg as unknown as { _content?: Content } | null)?._content;
        if (!w || !ct) return 'no-world';
        for (let i = 0; i < n; i++) tick(w, ct);
        (dbg as unknown as { handleEvents?: () => void }).handleEvents?.();
        return JSON.stringify({ ...w.clock });
      },
      /** QoL de pruebas E2E: coloca la X del jugador (presentación) para apuntar interacciones fijas. */
      setX: (x: number) => {
        const lg = dbg?.logic;
        if (!lg) return 'no-logic';
        lg.x = x;
        return JSON.stringify({ x: lg.x });
      },
    });
  }
  return instance;
}

export function getGameController(): GameController | null {
  return instance;
}
