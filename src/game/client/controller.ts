'use client';

import type { AbstractEngine, Scene } from '@babylonjs/core';
import type { Command, Content, CutsceneDef, GameEvent, Input, MinigameDef, ScenarioDef, World } from '@/game/core/types';
import type { CommandResult } from '@/game/sim';
import { blockLabel } from '@/game/core/types';
import { loadContent } from '@/game/content';
import { activeObjective, applyEffects, buildCirculation, createWorld, dispatch, drainEvents, migrateRooms, tick, travelMinutes, visibleParams } from '@/game/sim';
import { PlayerLogic } from '@/game/player-logic';
import { createEngine } from './engine';
import { createBuilding } from './building';
import { createActors } from './actors';
import { CameraRig, type CamMode } from './camera';
import { CutscenePlayer, type CutsceneEventCtx } from './cutscene';
import { B } from './babylon';
import { eventSound, preloadSounds } from './audio';
import { QUALITY_SCALE, loadOptions, type QualityLevel } from './options';
import { startGamepadPolling } from './gamepad';
import { NetSession, type SessionStatePayload } from './net';
import { setController } from './bridge';
import { selectModalOpen, useGameStore, type Speed, type Tone } from './store';

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
  private rig: CameraRig | null = null;

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
    const r = this.logic.interact();
    if (r.type === 'entered') this.setCamMode('estancia');
    else if (r.type === 'exited') this.setCamMode('planta');
    else if (r.type === 'used') this.presentInteraction(r.kind);
    this.pump();
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
      const text = ic.noticeboard.template
        .replace('{day}', String(this.world.clock.day))
        .replace('{funds}', String(this.world.community.funds))
        .replace('{elevator}', this.content.rules.labels.elevator[status] ?? status)
        .replace('{weather}', this.content.rules.labels.weather[this.world.weather.state] ?? this.world.weather.state);
      useGameStore.getState().pushToast(text, 'info');
    }
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
    const { Color4, DirectionalLight, HemisphericLight, Scene, UniversalCamera, Vector3 } = B();
    const view = this.content.rules.view;
    useGameStore.getState().resetUi();

    this.world = state ?? createWorld(this.content, this.activeScenarioId());
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
    new HemisphericLight('ambient', new Vector3(...view.ambient.dir), this.scene).intensity = view.ambient.intensity;
    new DirectionalLight('sun', new Vector3(...view.sun.dir), this.scene).intensity = view.sun.intensity;

    this.building = createBuilding(this.scene, this.world, this.content);
    this.actors = createActors(this.scene, this.world, this.content);
    const blocks = Object.values(this.world.blocks);
    this.rig = new CameraRig(
      new UniversalCamera('cam', new Vector3(0, 0, -30), this.scene),
      this.engine,
      Math.max(...blocks.map((b) => b.cell.col + b.size.w)),
      Math.max(...blocks.map((b) => b.cell.floor)) + 1,
      view.cellW,
      view.cellH,
    );
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
  }

  private onResize = (): void => {
    this.engine?.resize();
  };

  // ───────────────────────── Bucle de render ─────────────────────────

  private frame = (): void => {
    if (!this.engine || !this.scene || !this.world || !this.logic || !this.building || !this.actors || !this.rig) return;
    const dt = Math.min(0.1, this.engine.getDeltaTime() / 1000);
    const store = useGameStore.getState();
    const frozen = selectModalOpen(store) || store.paused;

    let ticked = false;
    if (!frozen) {
      this.logic.update(dt, this.readInput());
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

    const pos = this.logic.position();
    this.actors.update(dt, pos, this.actorId());
    // Cutscene (Fase D): sus beats mueven cámara/actores DESPUÉS de los eventos y ANTES del render.
    this.cutscenePlayer?.update(dt);
    // Si la cutscene acaba y queda cola, encadena la siguiente aquí: no dependemos de que el sim
    // genere otro evento para descolgar la siguiente (durante el teatro el sim está congelado).
    if (this.cutsceneQueue.length > 0 && !this.cutscenePlayer?.active) this.pumpCutscene();
    // LOD por distancia: solo con cámaras cercanas (planta/estancia); el plano general (edificio) muestra todo.
    this.building.update(dt, useGameStore.getState().camMode === 'edificio' ? undefined : { x: pos.x, floor: pos.floor });
    this.rig.update(dt, pos);
    this.scene.render();
  };

  /** Bomba de sincronización: reparte eventos pendientes y refresca el HUD. */
  private pump(): void {
    if (!this.world) return;
    this.handleEvents();
    this.paintBuilding();
    this.syncHud();
  }

  private paintBuilding(): void {
    this.building?.paint();
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
          store.pushToast(`Misión completada: ${this.titleOf(d.mission)}`, 'good');
          store.pushLog(`✔ Misión completada: ${this.titleOf(d.mission)}`, 'good');
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
          store.pushToast(String(d.text), (d.tone as Tone | undefined) ?? 'info');
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
}

// ───────────────────────── Singleton ─────────────────────────

let instance: GameController | null = null;

/** Crea (o reutiliza) el controlador y lo arranca sobre el canvas dado. */
export function createGameController(canvas: HTMLCanvasElement): GameController {
  if (!instance) {
    instance = new GameController();
    setController(instance); // la UI lo usa desde ya; sus acciones toleran mundo nulo
    void instance.init(canvas);
  }
  return instance;
}

export function getGameController(): GameController | null {
  return instance;
}
