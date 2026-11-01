/**
 * QA Fase C: movimiento interior 2D + layouts de estancias (100% data-driven).
 * Verifica contra el contenido y la PlayerLogic REALES (caja negra: update/interact/position):
 *  1. Al entrar en la vivienda, si la puerta cae en una estancia cerrada se aterriza en la abierta.
 *  2. Los tabiques bloquean: no se cruza a una estancia cerrada ni fuera de los huecos declarados.
 *  3. Reformar una estancia abre su hueco: se cruza andando (movimiento 2D con deslizamiento).
 *  4. Interactivos por posición 2D del catálogo (portátil en el salón, cama en el dormitorio).
 *  5. La profundidad se acota a los márgenes del catálogo (z ∈ [margin, depth − margin]).
 *  6. Salir devuelve al pasillo (modo corridor) y el sim queda sincronizado.
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, dispatch } from '@/game/sim';
import { PlayerLogic } from '@/game/player-logic';
import { doorwayPoint, hash01, interiorRoute, interiorTarget, layoutGeometryOf, roomAt, roomRoute, walkable } from '@/game/interior';

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}
let fails = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` · ${detail}` : ''}`);
  if (!cond) fails++;
};
const close = (a: number, b: number, eps = 0.02) => Math.abs(a - b) < eps;

const world = createWorld(content, content.rules.startScenario);
const HOME = world.residents[world.playerId]!.home; // blk_p3_c (col 5, x mundo 12..16.8)
const homeBlock = world.blocks[HOME]!;
const X0 = homeBlock.cell.col * content.rules.view.cellW; // borde izquierdo en metros de mundo
const logic = new PlayerLogic(world, content);

// ── Módulo interior compartido (Fase C "interiores vivos"): geometría, rutas y anclas. ──
// Misma fuente de verdad para el jugador (PlayerLogic) y los vecinos (actors.ts).
const geo0 = layoutGeometryOf(content, homeBlock)!;
check('geometría del layout: 4 estancias (con el cuarto trasero v1.19)', geo0.rooms.length === 4);
// v1.29/v1.30 (petición del vecino): UN solo bloque sin pared divisoria y el interior
// transitable de lado a lado — TODAS las estancias nacen abiertas (la reforma sobra).
check('accesos vivos: todo abierto (plan abierto, sin tabiques)', geo0.rooms.every((r) => !r.locked), geo0.rooms.map((r) => `${r.key}:${r.locked ? 'cerrada' : 'abierta'}`).join(' '));
check('roomAt tesela los rects (trasera incluida, detrás del bloque principal)', roomAt(geo0, 1.0, 1.0).key === 'salon' && roomAt(geo0, 3.0, 0.5).key === 'dormitorio' && roomAt(geo0, 3.0, 3.0).key === 'bano' && roomAt(geo0, 4.0, 5.0).key === 'trasera');
check('walkable: misma estancia siempre', walkable(geo0, roomAt(geo0, 1, 1), 2.0, 2.0));
check('walkable: plan abierto — se entra al dormitorio por su hueco', walkable(geo0, roomAt(geo0, 1, 1), 3.0, 0.8));
const dpDorm = doorwayPoint(geo0, 'salon', 'dormitorio');
const dpBano = doorwayPoint(geo0, 'salon', 'bano');
check('doorwayPoint salón↔dormitorio = centro del borde abierto (2.3, 1.25)', !!dpDorm && close(dpDorm.x, 2.3) && close(dpDorm.z, 1.25), JSON.stringify(dpDorm)); // v1.24: sin tabique central
check('doorwayPoint salón↔baño = centro del borde abierto (2.3, 3.35)', !!dpBano && close(dpBano.x, 2.3) && close(dpBano.z, 3.35), JSON.stringify(dpBano)); // v1.24
const dpTras = doorwayPoint(geo0, 'salon', 'trasera');
check('doorwayPoint salón↔trasera = puerta en la pared del FONDO (1.15, 4.2)', !!dpTras && close(dpTras.x, 1.15) && close(dpTras.z, content.rules.view.depth), JSON.stringify(dpTras));
check('roomRoute salón→baño (todo abierto)', JSON.stringify(roomRoute(geo0, 'salon', 'bano')) === '["bano"]');
check('interiorRoute al baño cruza por el borde abierto (x=2.3)', (() => { const rt = interiorRoute(geo0, { x: 0.5, z: 0.5 }, { x: 3.5, z: 2.2 }); return !!rt && rt.some((pt) => close(pt.x, 2.3)); })());
const tCama0 = interiorTarget(content, geo0, 'bed', 'qa_vecino', 0);
check('ancla cama accesible DESDE EL ARRANQUE (sin reforma) = (4.05, 0.8)', !!tCama0 && close(tCama0.x, 4.05) && close(tCama0.z, 0.8), JSON.stringify(tCama0));
const tWanderA = interiorTarget(content, geo0, undefined, 'qa_vecino', 0);
const tWanderB = interiorTarget(content, geo0, undefined, 'qa_vecino', 0);
check('deambulación determinista por (residente, vuelta)', !!tWanderA && tWanderA.x === tWanderB!.x && tWanderA.z === tWanderB!.z, JSON.stringify(tWanderA));
check('los vecinos NUNCA deambulan al cuarto trasero (apilamiento 3D)', (() => { for (let lap = 0; lap < 40; lap++) { const t = interiorTarget(content, geo0, undefined, 'qa_vecino', lap); if (!t || t.z > content.rules.view.depth) return false; } return true; })());
check('hash01 determinista y variable por vuelta', hash01('pinturillas', 3) === hash01('pinturillas', 3) && hash01('pinturillas', 3) !== hash01('pinturillas', 4));

// Entrar legalmente: teleport del editor + E en la puerta.
logic.teleportTo(HOME);
check('teleport coloca delante de la puerta', logic.position().mode === 'corridor' && close(logic.position().x, X0 + 2.4), `x=${logic.position().x.toFixed(2)}`);
const entered = logic.interact();
check('E entra en la vivienda', entered.type === 'entered', JSON.stringify(entered));
check('aterriza donde cae la puerta (dormitorio, todo abierto)', close(logic.position().x, X0 + 2.4), `x=${logic.position().x.toFixed(2)}`);
check('profundidad de entrada = 0.45', close(logic.position().z, 0.45), `z=${logic.position().z.toFixed(2)}`);

// ── Plan abierto: andar a la derecha CRUZA al dormitorio (no hay tabique desde v1.29)
for (let i = 0; i < 240; i++) logic.update(1 / 60, { left: false, right: true, up: false, down: false, run: false });
check('plan abierto: se cruza andando al dormitorio (sin tabiques)', logic.position().x > X0 + 2.31, `x=${logic.position().x.toFixed(2)}`);

// ── Profundidad: desde el centro (dentro del hueco dormitorio↔baño) se llega al fondo;
// la trasera solo se entra por SU hueco (x 0.675..1.625).
logic.x = X0 + 3.4;
for (let i = 0; i < 600; i++) logic.update(1 / 60, { left: false, right: false, up: true, down: false, run: false });
check('la pared del fondo frena en view.depth (la trasera solo se entra por su hueco)', logic.position().z > content.rules.view.depth - 0.2 && logic.position().z <= content.rules.view.depth, `z=${logic.position().z.toFixed(2)}`);
for (let i = 0; i < 600; i++) logic.update(1 / 60, { left: false, right: true, up: false, down: false, run: false });
check('plan abierto: el fondo del baño se recorre entero (sin tabique este)', logic.position().x > X0 + 2.31, `x=${logic.position().x.toFixed(2)}`);

// ── Reformar una estancia YA ABIERTA ya no procede (el plan abierto la dejó abierta)
const rBano = dispatch(world, content, { type: 'renovate_room', block: HOME, room: 'bano' });
check('reforma del baño sobra (ya abierta: room_open)', !rBano.ok && (rBano as { reason?: string }).reason === 'room_open', JSON.stringify(rBano));
logic.z = 3.3; // plantado en el hueco salón↔baño
for (let i = 0; i < 240; i++) logic.update(1 / 60, { left: false, right: true, up: false, down: false, run: false });
check('cruza andando al baño por el hueco del fondo (sin reforma)', logic.position().x > X0 + 2.4, `x=${logic.position().x.toFixed(2)}`);

// ── Rutas interiores de los vecinos: con el baño abierto ya hay ruta por el hueco ──
const geoB = layoutGeometryOf(content, homeBlock)!;
check('roomRoute salón→baño reformado', JSON.stringify(roomRoute(geoB, 'salon', 'bano')) === '["bano"]');
const rtB = interiorRoute(geoB, { x: 0.5, z: 0.5 }, { x: 3.5, z: 3.3 });
check('ruta interior al baño: cruce por el borde abierto (x=2.3)', !!rtB && rtB.length >= 1 && rtB.some((pt) => close(pt.x, 2.3)), JSON.stringify(rtB)); // v1.24: borde completo

// ── Interactivos por posición 2D del catálogo
logic.x = X0 + 0.4 + 0.05; // portátil del salón en [0.4, 0.55]
logic.z = 0.55;
check('portátil detectado por proximidad 2D', logic.interactTarget()?.kind === 'laptop');
const wallet0 = world.residents[world.playerId]!.wallet;
const used = logic.interact();
check('E usa el portátil (work del sim)', used.type === 'used' && (used as { kind?: string }).kind === 'laptop');
check('work paga +120 €', world.residents[world.playerId]!.wallet === wallet0 + content.rules.sim.work.pay, `${wallet0}→${world.residents[world.playerId]!.wallet}`);

const rDorm = dispatch(world, content, { type: 'renovate_room', block: HOME, room: 'dormitorio' });
check('reforma del dormitorio sobra (ya abierta: room_open)', !rDorm.ok && (rDorm as { reason?: string }).reason === 'room_open', JSON.stringify(rDorm));
logic.x = X0 + 2.3 + 1.75; // cama del dormitorio en local [1.75, 0.8]
logic.z = 0.8;
check('cama detectada en el dormitorio', logic.interactTarget()?.kind === 'bed');

// ── Anclas de actividad de los vecinos: la cama ya es destino legítimo (dormitorio abierto) ──
const geoD = layoutGeometryOf(content, homeBlock)!;
const tCama = interiorTarget(content, geoD, 'bed', 'qa_vecino', 0);
check('ancla cama en el dormitorio reformado = (4.05, 0.8)', !!tCama && close(tCama.x, 4.05) && close(tCama.z, 0.8), JSON.stringify(tCama));
const tTv = interiorTarget(content, geoD, 'tv', 'qa_vecino', 0);
check('ancla tv en el salón (local 1.15, 0.75 del rect)', !!tTv && close(tTv.x, 1.15) && close(tTv.z, 0.75), JSON.stringify(tTv));
check('walkable ya entra al dormitorio por su hueco', walkable(geoD, roomAt(geoD, 1, 1), 3.0, 0.8));
const rtD = interiorRoute(geoD, { x: 0.5, z: 0.5 }, { x: 4.05, z: 0.8 });
check('ruta al dormitorio: cruce por el borde abierto (x=2.3)', !!rtD && rtD.length >= 1 && rtD.some((pt) => close(pt.x, 2.3)), JSON.stringify(rtD)); // v1.24: borde completo
check('ancla desconocida → deambula por estancias abiertas', (() => { const t = interiorTarget(content, geoD, 'inexistente', 'qa_vecino', 2); return !!t && t.x >= 0 && t.x <= 4.8 && t.z >= 0 && t.z <= 4.2; })());
const usedBed = logic.interact();
const needs = world.residents[world.playerId]!.needs;
check('E usa la cama (sleep del sim)', usedBed.type === 'used' && (usedBed as { kind?: string }).kind === 'bed');
check('sleep restaura por completo', needs['sleep'] === 100, `sleep=${needs['sleep']}`);

// ── Salir: E con objetivo puerta → corridor y location en el pasillo
logic.x = X0 + 3.0; // dormitorio, lejos de la cama (radio 0.9)
logic.z = 0.45;
check('objetivo puerta dentro de casa', logic.interactTarget()?.kind === 'door');
const exited = logic.interact();
check('E sale al pasillo', exited.type === 'exited');
check('modo corridor y sim sincronizado', logic.position().mode === 'corridor' && world.residents[world.playerId]!.location === `blk_p${homeBlock.cell.floor}_pasillo`, world.residents[world.playerId]!.location ?? 'null');
check('vuelta al pasillo: z al carril interior (v1.19)', logic.position().z === content.rules.view.corridorZ, `z=${logic.position().z}`);

// ── Fallback 1D: un layout sin rects mantiene el comportamiento clásico (sin interior 2D)
for (const r of content.layouts['layout_vivienda_v1']!.rooms) delete r.rect;
content.layouts['layout_vivienda_v1']!.doorways = [];
logic.teleportTo(HOME);
logic.interact();
check('layout sin rects: entra sin geometría 2D (fallback 1D)', logic.position().mode === 'inside');
const xBefore = logic.position().x;
for (let i = 0; i < 120; i++) logic.update(1 / 60, { left: false, right: false, up: true, down: false, run: false });
check('fallback 1D: W/S no mueve profundidad', close(logic.position().z, 0.45) && close(logic.position().x, xBefore), `z=${logic.position().z.toFixed(2)}`);

// ── Candado (regresión v0.7.1): E delante de una puerta cerrada NO entra ni cambia de modo.
// El sim rechaza el move (door_locked) y la presentación se entera: {type:'locked'} + corridor.
const savedLayouts = JSON.parse(JSON.stringify(content.layouts)) as typeof content.layouts;
content.layouts['layout_vivienda_v1'] = savedLayouts['layout_vivienda_v1']!; // restaurar rects eliminados arriba
const logic2 = new PlayerLogic(world, content);
// v1.27: en el edificio de 3 plantas la planta del jugador (3) puede no tener cerradas;
// cualquier vivienda bloqueada del mundo sirve para la misma prueba del candado.
const lockedBlock = Object.values(world.blocks).find((b) => b.kind === 'dwelling' && b.access === 'locked')!;
logic2.teleportTo(lockedBlock.id);
check('delante de puerta cerrada', logic2.interactTarget()?.kind === 'door' && world.blocks[lockedBlock.id]!.access === 'locked', lockedBlock.id);
const rejected = logic2.interact();
check('E en puerta cerrada → locked (no entered)', rejected.type === 'locked', JSON.stringify(rejected));
check('el jugador NO entra: modo corridor', logic2.position().mode === 'corridor' && logic2.position().insideBlock === null);
check('el sim tampoco movió al residente', world.residents[world.playerId]!.location !== lockedBlock.id, world.residents[world.playerId]!.location ?? 'null');
const inFront = logic2.interactTarget();
check('sigue delante de la misma puerta', inFront?.kind === 'door' && inFront.blockId === lockedBlock.id);

console.log(fails === 0 ? '\nQA INTERIOR OK' : `\nQA INTERIOR: ${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
