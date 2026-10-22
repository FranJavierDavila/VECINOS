'use client';

import type { AbstractEngine, Scene } from '@babylonjs/core';
import type { Content, Input, World } from '@/game/core/types';
import { blockLabel } from '@/game/core/types';
import { loadContent } from '@/game/content';
import { activeObjective, applyEffects, buildCirculation, createWorld, dispatch, drainEvents, migrateRooms, tick, travelMinutes, visibleParams } from '@/game/sim';
import { PlayerLogic } from '@/game/player-logic';
import { createEngine } from './engine';
import { createBuilding } from './building';
import { createActors } from './actors';
import { CameraRig, type CamMode } from './camera';
import { B } from './babylon';
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
  private clockAcc = 0;
  private lastHudSync = 0;
  private initializing = false;

  private phoneMission = '';
  private phoneLines: { speaker: string; text: string }[] = [];
  private phoneLine = 0;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (this.engine || this.initializing) return;
    this.initializing = true;
    this.canvas = canvas;

    try {
      // 1) Contenido externo + validación (los errores de referencias se avisan, no abortan).
      const { content, issues } = await loadContent();
      this._content = content;
      if (issues.length > 0) {
        useGameStore.getState().pushToast(`Contenido inválido: ${issues.length} errores de validación`, 'bad');
      }

      // 2) Motor de render (WebGPU con fallback WebGL2).
      const { engine, backend } = await createEngine(canvas);
      this.engine = engine;
      window.addEventListener('resize', this.onResize);
      await this.restart();
      useGameStore.getState().markReady(backend);
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
    this.engine?.stopRenderLoop(this.frame);
    this.scene?.dispose();
    this.engine?.dispose();
    this.engine = null;
    this.scene = null;
  }

  // ───────────────────────── Entrada (GameStage la conecta) ─────────────────────────

  onKeyDown(code: string): void {
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

  private readInput(): Input {
    const held = (...codes: string[]) => codes.some((c) => this.keys.has(c));
    return { left: held('KeyA', 'ArrowLeft'), right: held('KeyD', 'ArrowRight'), up: held('KeyW', 'ArrowUp'), down: held('KeyS', 'ArrowDown') };
  }

  // ───────────────────────── Acciones de la interfaz ─────────────────────────

  togglePause(): void {
    const store = useGameStore.getState();
    store.setPaused(!store.paused);
  }

  setSpeed(speed: Speed): void {
    useGameStore.getState().setSpeed(speed);
  }

  setCamMode(mode: CamMode): void {
    if (this.rig) this.rig.mode = mode;
    useGameStore.getState().setCamMode(mode);
  }

  /** Botón "Fiesta demo": datos en rules.demo (residente, bloque y ruido) → canal de ruido en acción. */
  partyDemo(): void {
    if (!this.world) return;
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
    for (let i = 0; i < 10; i++) tick(this.world, this.content);
    this.pump();
  }

  /** Tecla E: entrar, salir o usar el objeto cercano. El feedback visual lo ponen los eventos del sim. */
  private interact(): void {
    if (!this.logic) return;
    const r = this.logic.interact();
    if (r.type === 'entered') this.setCamMode('estancia');
    else if (r.type === 'exited') this.setCamMode('planta');
    this.pump();
  }

  /** Siguiente frase del teléfono; al colgar responde la llamada en el sim. */
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
    if (this.world && mission) {
      dispatch(this.world, this.content, { type: 'answer_call', mission });
      this.pump();
    }
  }

  choose(choiceId: string): void {
    const state = useGameStore.getState();
    const mission = state.choices?.mission;
    state.setChoices(null);
    if (!this.world || !mission) return;
    dispatch(this.world, this.content, { type: 'choose', mission, choice: choiceId });
    this.pump();
  }

  juntaVote(vote: 'yes' | 'no'): void {
    useGameStore.getState().setJunta(null);
    if (!this.world) return;
    dispatch(this.world, this.content, { type: 'junta_vote', vote });
    this.pump();
  }

  finaleClose(): void {
    useGameStore.getState().setFinale(null);
  }

  // ───────────────────────── Editor de interiores y minijuegos ─────────────────────────

  placeFurniture(block: string, room: string, slot: string, item: string): void {
    if (!this.world) return;
    const r = dispatch(this.world, this.content, { type: 'place_furniture', block, room, slot, item });
    if (!r.ok) this.furnitureFail(r.reason);
    this.pump();
  }

  removeFurniture(block: string, room: string, slot: string): void {
    if (!this.world) return;
    const r = dispatch(this.world, this.content, { type: 'remove_furniture', block, room, slot });
    if (!r.ok) this.furnitureFail(r.reason);
    this.pump();
  }

  renovateRoom(block: string, room: string): void {
    if (!this.world) return;
    const r = dispatch(this.world, this.content, { type: 'renovate_room', block, room });
    if (!r.ok) this.furnitureFail(r.reason);
    this.pump();
  }

  completeMinigame(id: string, success: boolean): void {
    if (!this.world) return;
    dispatch(this.world, this.content, { type: 'complete_minigame', id, success });
    this.pump();
  }

  private furnitureFail(reason: string | undefined): void {
    const text = this.content.rules.furniture.errors[reason ?? ''] ?? 'Gestión inmobiliaria rechazada sin explicación. Como en la junta.';
    useGameStore.getState().pushToast(text, 'bad');
  }

  async save(): Promise<void> {
    if (!this.world) return;
    const store = useGameStore.getState();
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

  /** (Re)crea el mundo y la escena. Con `state` restaura una partida guardada. */
  private async restart(state?: World): Promise<void> {
    if (!this.engine || !this.canvas || !this._content) return;
    const { Color4, DirectionalLight, HemisphericLight, Scene, UniversalCamera, Vector3 } = B();
    const view = this.content.rules.view;
    useGameStore.getState().resetUi();

    this.world = state ?? createWorld(this.content, this.content.rules.startScenario);
    // Guardados antiguos sin `entry`: la entrada es la zona común de planta baja.
    if (!this.world.entry) {
      this.world.entry = Object.values(this.world.blocks).find((b) => b.cell.floor === 0 && b.kind !== 'dwelling')?.id ?? Object.keys(this.world.blocks)[0]!;
    }
    // Migración de estancias de guardados v0.1: params y ranuras de muebles según catálogo.
    for (const b of Object.values(this.world.blocks)) migrateRooms(this.content, b.rooms);
    this.logic = new PlayerLogic(this.world, this.content);

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
    this.rig.mode = useGameStore.getState().camMode;

    this.clockAcc = 0;
    this.keys.clear();
    this.phoneLines = [];
    this.phoneMission = '';
    this.lastHudSync = 0;
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
      this.clockAcc += dt * store.speed;
      let guard = 0;
      while (this.clockAcc >= 1 && guard < 60) {
        tick(this.world, this.content);
        this.clockAcc -= 1;
        ticked = true;
        guard += 1;
      }
    }

    if (this.world.events.length > 0) this.handleEvents();
    if (ticked) this.paintBuilding();

    const now = performance.now();
    if (now - this.lastHudSync > 200) {
      this.lastHudSync = now;
      this.syncHud();
    }

    const pos = this.logic.position();
    this.actors.update(dt, pos);
    this.building.update(dt);
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
      switch (e.type) {
        case 'step_started':
          if (d.type === 'phone_call') this.openPhone(String(d.mission), String(d.dialog));
          break;
        case 'choice_required': {
          const choices = (d.choices as { id: string; label: string; hint?: string | null }[] | undefined) ?? [];
          store.setChoices({ mission: String(d.mission), title: String(d.title), choices: choices.map((c) => ({ id: c.id, label: c.label, hint: c.hint ?? null })) });
          store.pushLog(`⚖️ Decisión pendiente: ${String(d.title)}`, 'info');
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
          break;
        }
        case 'junta_result':
          store.pushToast(
            d.approved ? `Aprobado: ${String(d.title)} (${String(d.yes)} sí / ${String(d.no)} no)` : `Rechazado: ${String(d.title)} (${String(d.yes)} sí / ${String(d.no)} no)`,
            d.approved ? ('good' as Tone) : ('bad' as Tone),
          );
          break;
        case 'minigame_requested': {
          const def = this.content.minigames[String(d.minigame)];
          if (!def) break;
          store.setMinigame({ ...def, emoji: def.emoji ?? '🎮', instruction: def.instruction ?? null });
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
    }
  }

  // ───────────────────────── Teléfono ─────────────────────────

  private openPhone(mission: string, dialogId: string): void {
    const dlg = this.content.dialogs[dialogId];
    if (!dlg || dlg.lines.length === 0) return;
    this.phoneMission = mission;
    this.phoneLines = dlg.lines;
    this.phoneLine = 0;
    this.showPhoneLine();
  }

  private showPhoneLine(): void {
    const line = this.phoneLines[this.phoneLine];
    if (!line) return;
    useGameStore.getState().setPhone({ mission: this.phoneMission, speaker: line.speaker, text: line.text, isLast: this.phoneLine === this.phoneLines.length - 1 });
  }

  // ───────────────────────── HUD ─────────────────────────

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
        return { title: o.title, text: `Llega a la puerta (${blockLabel(s.block ?? '')}).` };
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
    const p = logic.position();
    if (p.mode === 'inside') return 'E · salir a la escalera';
    if (p.climbing) return null;
    const door = logic.doorInFront();
    if (door) return door.access === 'locked' ? `E · ${blockLabel(door.id)}: candado` : `E · entrar en ${blockLabel(door.id)}`;
    const zone = logic.zone();
    if (this.content.blocks[zone.defId]!.features?.stairs) {
      return world.blocks[zone.id]!.params.elevator_status === 'ok' ? 'W/S · ascensor' : 'W/S · escalera (el ascensor no funciona)';
    }
    return null;
  }

  /** Viviendas del jugador para el editor de interiores (foto serializable, posiciones ya en %). */
  private homesUi() {
    const world = this.world!;
    const cellH = this.content.rules.view.cellH;
    return Object.values(world.blocks)
      .filter((b) => b.kind === 'dwelling' && b.ownerId === world.playerId)
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
    const player = world.residents[world.playerId]!;
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
