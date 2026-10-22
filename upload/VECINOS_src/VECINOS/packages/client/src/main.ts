/// <reference types="vite/client" />
import { AbstractEngine, Color4, DirectionalLight, Engine, HemisphericLight, Scene, UniversalCamera, Vector3, WebGPUEngine } from '@babylonjs/core';
import { buildContent, formatIssues } from '@vecinos/content';
import {
  activeObjective, buildCirculation, createWorld, dispatch, drainEvents, emissionsFromActivities, applyEffects, tick, travelMinutes,
  visibleParams, type GameEvent,
} from '@vecinos/sim';
import { createActors } from './actors';
import { createBuilding } from './building';
import { CameraRig, type CamMode } from './camera';
import { $, Hud, blockLabel } from './hud';
import { PlayerLogic, type Input } from './player-logic';

// ───────── Contenido: se valida al arrancar, igual que en Node ─────────
const records = import.meta.glob('../../content/data/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const { content, issues } = buildContent(records);
if (issues.length) {
  $('error').textContent = formatIssues(issues);
  $('status').textContent = 'El contenido tiene errores.';
  throw new Error('Contenido inválido');
}

// Etiquetas provisionales: pasarán a claves de localización (v0.2 del modelo de datos).
const LABELS: Record<string, string> = { condition: 'Estado', soundproofing: 'Aislamiento', humidity: 'Humedad', style: 'Estilo', rent: 'Alquiler' };

// ───────── Motor: WebGPU si está disponible, WebGL2 si no ─────────
async function createEngine(canvas: HTMLCanvasElement): Promise<{ engine: AbstractEngine; backend: string }> {
  try {
    if (await WebGPUEngine.IsSupportedAsync) {
      const e = new WebGPUEngine(canvas, { antialias: true });
      await e.initAsync();
      return { engine: e, backend: 'WebGPU' };
    }
  } catch (err) {
    console.warn('WebGPU no disponible, uso WebGL2', err);
  }
  return { engine: new Engine(canvas, true), backend: 'WebGL2' };
}

const { engine, backend } = await createEngine($<HTMLCanvasElement>('view'));
const world = createWorld(content, 'slice');
const logic = new PlayerLogic(world, content);

const scene = new Scene(engine);
scene.clearColor = new Color4(0.106, 0.122, 0.165, 1);
new HemisphericLight('ambient', new Vector3(0.2, 1, -0.6), scene).intensity = 0.85;
new DirectionalLight('sun', new Vector3(-0.4, -0.7, 0.8), scene).intensity = 0.55;

const building = createBuilding(scene, world, content);
const actors = createActors(scene, world);
const blocks = Object.values(world.blocks);
const rig = new CameraRig(new UniversalCamera('cam', new Vector3(0, 0, -30), scene), engine, Math.max(...blocks.map((b) => b.cell.col + b.size.w)), Math.max(...blocks.map((b) => b.cell.floor)) + 1);

// ───────── Teléfono, decisiones y avisos ─────────
const log: GameEvent[] = [];
const hud = new Hud(
  content,
  (mission) => { dispatch(world, content, { type: 'answer_call', mission }); pump(); },
  (mission, choice) => { dispatch(world, content, { type: 'choose', mission, choice }); pump(); },
);
const title = (id: unknown) => content.missions[String(id)]?.title ?? String(id);

/** Reparte los eventos de la simulación entre la interfaz y los efectos visuales. Devuelve si hubo alguno. */
function handleEvents(): boolean {
  const events = drainEvents(world);
  for (const e of events) {
    log.push(e);
    const d = e.data;
    switch (e.type) {
      case 'step_started':
        if (d.type === 'phone_call') hud.showPhone(String(d.mission), String(d.dialog));
        break;
      case 'choice_required':
        hud.showChoices(String(d.mission), title(d.mission), d.choices as { id: string; label: string }[]);
        break;
      case 'door_locked':
        building.shake(String(d.block));
        hud.toast(`${blockLabel(String(d.block))}: puerta con candado${d.reason === 'for_sale' ? ' (a la venta)' : ''}`);
        break;
      case 'neighbor_arrived':
        hud.toast(`Nuevo vecino en ${blockLabel(String(d.block))}: ${content.archetypes[world.residents[String(d.resident)]!.archetype]?.name ?? d.resident}`);
        break;
      case 'mission_completed':
        hud.toast(`Misión completada: ${title(d.mission)}`);
        break;
      case 'mission_failed':
        hud.toast(`Misión fallida: ${title(d.mission)}`);
        break;
      case 'block_unlocked':
        hud.toast(`${blockLabel(String(d.block))} desbloqueado`);
        break;
    }
  }
  return events.length > 0;
}

function pump() {
  handleEvents();
  refreshHud();
}

function objectiveText(): string | null {
  const o = activeObjective(world, content);
  if (!o) return null;
  if (o.state === 'awaiting_choice') return `${o.title}: decide qué hacer`;
  const s = o.step!;
  const left = o.untilTick !== null ? ` · quedan ${Math.max(0, o.untilTick - world.tick)} min` : '';
  switch (s.type) {
    case 'phone_call': return `${o.title}: atiende la llamada`;
    case 'reach': return `${o.title}: llega a la puerta de tu piso (${blockLabel(s.block!)})`;
    case 'enter': return `${o.title}: entra en tu piso (E)`;
    case 'catch_in_act': return `${o.title}: ¡pilla al responsable!${left}`;
    default: return o.title;
  }
}

function refreshHud() {
  const home = world.residents[world.playerId]!.home;
  const hh = String(Math.floor(world.clock.minute / 60)).padStart(2, '0');
  const mm = String(world.clock.minute % 60).padStart(2, '0');
  hud.status(
    `${backend} · día ${world.clock.day} ${hh}:${mm} · fondos: ${world.community.funds} · ascensor: ${world.blocks.blk_p1_nucleo!.params.elevator_status}`,
    `Tu piso: ${blockLabel(home)} · del portal a tu puerta: ${travelMinutes(buildCirculation(world, content), 'blk_p0_portal', home)} min`,
  );
  hud.list('params', visibleParams(world, content, home).map((p) => `${LABELS[p.name] ?? p.name}: ${p.value}`));
  hud.list('events', log.slice(-7).reverse().map((e) => `[${e.tick}] ${e.type} ${JSON.stringify(e.data)}`));
  hud.objective(objectiveText());
  building.paint();
}

// ───────── Entrada ─────────
const keys = new Set<string>();
const held = (...codes: string[]) => codes.some((c) => keys.has(c));
function setCam(mode: CamMode) {
  rig.mode = mode;
  document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.classList.toggle('active', b.dataset.cam === mode));
}
setCam('edificio');

window.addEventListener('keydown', (ev) => {
  if (ev.repeat) return;
  keys.add(ev.code);
  if (hud.modalOpen) {
    if (ev.code === 'Space' || ev.code === 'Enter') hud.advance();
    return;
  }
  const cam = ({ Digit1: 'edificio', Digit2: 'planta', Digit3: 'estancia' } as Record<string, CamMode>)[ev.code];
  if (cam) setCam(cam);
  if (ev.code === 'KeyE') {
    const r = logic.interact();
    if (r.type === 'entered') setCam('estancia');
    if (r.type === 'exited') setCam('planta');
    pump();
  }
});
window.addEventListener('keyup', (ev) => keys.delete(ev.code));
document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam as CamMode)));
$('b-fiesta').addEventListener('click', () => {
  if (!world.residents.res_fiestero_01!.present) applyEffects(world, content, [{ op: 'unlock', target: 'blk_p2_b', resident: 'res_fiestero_01', arrival: 'mudanza' }]);
  tick(world, content, emissionsFromActivities(world, content, [{ resident: 'res_fiestero_01', activity: 'party' }]));
  pump();
});
$('b-tiempo').addEventListener('click', () => { for (let i = 0; i < 10; i++) tick(world, content); pump(); });
window.addEventListener('resize', () => engine.resize());

// ───────── Bucle: el tiempo de juego avanza 1 minuto por segundo real (se detiene con un diálogo abierto) ─────────
let clock = 0;
function promptText(): string | null {
  const p = logic.position();
  if (p.mode === 'inside') return 'E · salir a la escalera';
  if (p.climbing) return null;
  const door = logic.doorInFront();
  if (door) return door.access === 'locked' ? `E · ${blockLabel(door.id)}: candado` : `E · entrar en ${blockLabel(door.id)}`;
  if (content.blocks[logic.zone().defId]!.features?.stairs) return world.blocks[logic.zone().id]!.params.elevator_status === 'ok' ? 'W/S · ascensor' : 'W/S · escalera (el ascensor no funciona)';
  return null;
}

pump();
engine.runRenderLoop(() => {
  const dt = Math.min(0.1, engine.getDeltaTime() / 1000);
  const frozen = hud.modalOpen;
  if (!frozen) {
    const input: Input = { left: held('KeyA', 'ArrowLeft'), right: held('KeyD', 'ArrowRight'), up: held('KeyW', 'ArrowUp'), down: held('KeyS', 'ArrowDown') };
    logic.update(dt, input);
    clock += dt;
    let ticked = false;
    while (clock >= 1) {
      tick(world, content);
      clock -= 1;
      ticked = true;
    }
    if (handleEvents() || ticked) refreshHud();
  }
  hud.prompt(frozen ? null : promptText());
  const pos = logic.position();
  actors.update(dt, pos);
  building.update(dt);
  rig.update(dt, pos);
  scene.render();
});
