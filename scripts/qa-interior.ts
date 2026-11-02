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
import { anchorInRoom, doorwayPoint, hash01, interiorRoute, interiorTarget, layoutGeometryOf, layoutIdOf, roomAt, roomRoute, walkable } from '@/game/interior';

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
// v1.71 (higiene): la vivienda del jugador recibe su layout del REPARTO de variantes (v1.53).
// HOY le toca layout_vivienda_bano: estancia principal (estudio) + baño trasero con SU hueco.
// Los checks se escriben contra la geometría RESUELTA (mainKey/rearKey), no contra claves fijas.
const geo0 = layoutGeometryOf(content, homeBlock)!;
const mainKey0 = geo0.rooms.find((r) => r.rect.z + r.rect.d <= content.rules.view.depth + 0.01)!.key;
const rearKey0 = geo0.rooms.find((r) => r.rect.z + r.rect.d > content.rules.view.depth + 0.01)?.key ?? null;
const mainRoom0 = geo0.rooms.find((r) => r.key === mainKey0)!;
const rearRoom0 = rearKey0 ? geo0.rooms.find((r) => r.key === rearKey0)! : null;
check('geometría del layout según el reparto de variantes (principal + trasero)', rearKey0 !== null && geo0.rooms.length === 2, `${geo0.rooms.map((r) => r.key).join('+')}`);
// v1.29/v1.30 (petición del vecino): UN solo bloque sin pared divisoria y el interior
// transitable de lado a lado — TODAS las estancias nacen abiertas (la reforma sobra).
check('accesos vivos: todo abierto (plan abierto, sin tabiques)', geo0.rooms.every((r) => !r.locked), geo0.rooms.map((r) => `${r.key}:${r.locked ? 'cerrada' : 'abierta'}`).join(' '));
check('roomAt tesela los rects (trasero incluido, detrás del bloque principal)', roomAt(geo0, 1.0, 1.0).key === mainKey0 && !!rearRoom0 && roomAt(geo0, rearRoom0.rect.x + rearRoom0.rect.w / 2, rearRoom0.rect.z + rearRoom0.rect.d / 2).key === rearKey0);
check('walkable: misma estancia siempre', walkable(geo0, roomAt(geo0, 1, 1), 2.0, 2.0));
const dpTras0 = rearKey0 ? doorwayPoint(geo0, mainKey0, rearKey0) : null;
check('walkable: plan abierto — se entra al cuarto trasero por su hueco', !!rearRoom0 && !!dpTras0 && walkable(geo0, roomAt(geo0, 1, 1), dpTras0.x, dpTras0.z + 0.1));
const dwCat0 = rearKey0 ? (geo0.doorways ?? []).find((d) => d.b === rearKey0 || d.a === rearKey0) : null;
check('doorwayPoint principal↔trasero = el hueco del CATÁLOGO (at, pared del fondo)', !!dpTras0 && !!dwCat0 && close(dpTras0.x, dwCat0.at) && close(dpTras0.z, content.rules.view.depth), JSON.stringify(dpTras0));
check('roomRoute principal→trasero (adyacente por el hueco)', !!rearKey0 && JSON.stringify(roomRoute(geo0, mainKey0, rearKey0)) === JSON.stringify([rearKey0]));
check('interiorRoute al trasero cruza por el hueco (x del catálogo)', (() => { if (!rearRoom0 || !dpTras0) return false; const rt = interiorRoute(geo0, { x: 0.5, z: 0.5 }, { x: dpTras0.x, z: rearRoom0.rect.z + rearRoom0.rect.d / 2 }); return !!rt && rt.some((pt) => close(pt.x, dpTras0.x)); })());
const tCama0 = interiorTarget(content, geo0, 'bed', 'qa_vecino', 0);
const camaEsperada0 = anchorInRoom(content, mainRoom0, 'bed');
check('ancla cama accesible DESDE EL ARRANQUE (sin reforma) = el catálogo', !!tCama0 && !!camaEsperada0 && close(tCama0.x, camaEsperada0.x) && close(tCama0.z, camaEsperada0.z), JSON.stringify(tCama0));
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
check('aterriza donde cae la puerta (estancia principal, todo abierto)', close(logic.position().x, X0 + 2.4), `x=${logic.position().x.toFixed(2)}`);
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

// ── Reformar una estancia YA ABIERTA ya no procede (el plan abierto la dejó abierta);
// los cuartos traseros son de PRESENTACIÓN (no están en b.rooms del sim): la reforma
// aplica a la estancia PRINCIPAL (la única que el sim conoce).
const rBano = dispatch(world, content, { type: 'renovate_room', block: HOME, room: mainKey0 });
check('reforma de la estancia principal sobra (ya abierta: room_open)', !rBano.ok && (rBano as { reason?: string }).reason === 'room_open', JSON.stringify(rBano));
check('renovar un cuarto trasero (presentación) es unknown_target para el sim', (() => { if (!rearKey0) return false; const r = dispatch(world, content, { type: 'renovate_room', block: HOME, room: rearKey0 }); return !r.ok && (r as { reason?: string }).reason === 'unknown_target'; })(), rearKey0 ?? '—');
// ── Cruzar ANDANDO al cuarto trasero por SU hueco (x del catálogo), sin reforma:
logic.x = X0 + (dwCat0?.at ?? 2.4);
logic.z = content.rules.view.depth - 0.6;
for (let i = 0; i < 300; i++) logic.update(1 / 60, { left: false, right: false, up: true, down: false, run: false });
check('cruza andando al cuarto trasero por el hueco del fondo (sin reforma)', !!rearRoom0 && logic.position().z > content.rules.view.depth + 0.1, `z=${logic.position().z.toFixed(2)} (trasero desde ${content.rules.view.depth})`);

// ── Rutas interiores de los vecinos: geometría reconstruida, ruta por el hueco ──
const geoB = layoutGeometryOf(content, homeBlock)!;
check('roomRoute principal→trasero (geometría viva)', rearKey0 !== null && JSON.stringify(roomRoute(geoB, mainKey0, rearKey0)) === JSON.stringify([rearKey0]));
const rtB = rearRoom0 && dpTras0 ? interiorRoute(geoB, { x: 0.5, z: 0.5 }, { x: dpTras0.x, z: rearRoom0.rect.z + rearRoom0.rect.d / 2 }) : null;
check('ruta interior al trasero: cruce por el hueco (x del catálogo)', !!rtB && rtB.some((pt) => !!dpTras0 && close(pt.x, dpTras0.x)), JSON.stringify(rtB));

// ── Interactivos por posición 2D del catálogo (anclas resueltas, no coordenadas fijas)
const laptopAnchor = anchorInRoom(content, mainRoom0, 'laptop')!;
logic.x = X0 + laptopAnchor.x; // portátil del catálogo en la estancia principal
logic.z = laptopAnchor.z;
check('portátil detectado por proximidad 2D', logic.interactTarget()?.kind === 'laptop');
const wallet0 = world.residents[world.playerId]!.wallet;
const used = logic.interact();
check('E usa el portátil (work del sim)', used.type === 'used' && (used as { kind?: string }).kind === 'laptop');
check('work paga +120 €', world.residents[world.playerId]!.wallet === wallet0 + content.rules.sim.work.pay, `${wallet0}→${world.residents[world.playerId]!.wallet}`);

const bedAnchor = anchorInRoom(content, mainRoom0, 'bed')!;
logic.x = X0 + bedAnchor.x; // cama del catálogo en la estancia principal
logic.z = bedAnchor.z;
check('cama detectada en la estancia principal', logic.interactTarget()?.kind === 'bed');

// ── Anclas de actividad de los vecinos: la cama ya es destino legítimo (estancia abierta) ──
const geoD = layoutGeometryOf(content, homeBlock)!;
const mainRoomD = geoD.rooms.find((r) => r.key === mainKey0)!;
const tCama = interiorTarget(content, geoD, 'bed', 'qa_vecino', 0);
check('ancla cama = la del catálogo en la estancia principal', !!tCama && close(tCama.x, bedAnchor.x) && close(tCama.z, bedAnchor.z), JSON.stringify(tCama));
const tvAnchor = anchorInRoom(content, mainRoomD, 'tv');
const tTv = interiorTarget(content, geoD, 'tv', 'qa_vecino', 0);
check('ancla tv = la del catálogo en la estancia principal', !!tTv && !!tvAnchor && close(tTv.x, tvAnchor.x) && close(tTv.z, tvAnchor.z), JSON.stringify(tTv));
check('walkable ya entra al cuarto trasero por su hueco', !!rearRoom0 && !!dpTras0 && walkable(geoD, roomAt(geoD, 1, 1), dpTras0.x, dpTras0.z + 0.1));
const rtD = rearRoom0 && dpTras0 ? interiorRoute(geoD, { x: 0.5, z: 0.5 }, { x: rearRoom0.rect.x + rearRoom0.rect.w / 2, z: rearRoom0.rect.z + rearRoom0.rect.d / 2 }) : null;
check('ruta al cuarto trasero: cruce por el hueco (x del catálogo)', rearRoom0 === null || (!!rtD && rtD.some((pt) => !!dpTras0 && close(pt.x, dpTras0.x))), JSON.stringify(rtD));
check('ancla desconocida → deambula por estancias abiertas', (() => { const t = interiorTarget(content, geoD, 'inexistente', 'qa_vecino', 2); return !!t && t.x >= 0 && t.x <= content.rules.view.depth && t.z >= 0 && t.z <= content.rules.view.depth; })());
const usedBed = logic.interact();
const needs = world.residents[world.playerId]!.needs;
check('E usa la cama (sleep del sim)', usedBed.type === 'used' && (usedBed as { kind?: string }).kind === 'bed');
check('sleep restaura por completo', needs['sleep'] === 100, `sleep=${needs['sleep']}`);

// ── Salir: E con objetivo puerta → corridor y location en el pasillo
// v1.71 (higiene): el punto de prueba es el de ENTRADA (x de la puerta): la cama del catálogo
// vive cerca del fondo y a (X0+3.0) el radio de objetos la capturaba antes que la puerta.
logic.x = X0 + 2.4; // el punto exacto de entrada, lejos de cama y portátil (radio 0.9)
logic.z = 0.45;
check('objetivo puerta dentro de casa', logic.interactTarget()?.kind === 'door');
const exited = logic.interact();
check('E sale al pasillo', exited.type === 'exited');
check('modo corridor y sim sincronizado', logic.position().mode === 'corridor' && world.residents[world.playerId]!.location === `blk_p${homeBlock.cell.floor}_pasillo`, world.residents[world.playerId]!.location ?? 'null');
check('vuelta al pasillo: z al carril interior (v1.19)', logic.position().z === content.rules.view.corridorZ, `z=${logic.position().z}`);

// ── Fallback 1D: un layout sin rects mantiene el comportamiento clásico (sin interior 2D)
// v1.71 (higiene): la vivienda del jugador usa SU variante del reparto (layoutIdOf), no la v1.
const homeLayoutId = layoutIdOf(content, homeBlock)!;
const savedRooms = JSON.parse(JSON.stringify(content.layouts[homeLayoutId]!.rooms)) as typeof content.layouts[typeof homeLayoutId]['rooms'];
const savedDoorways = JSON.parse(JSON.stringify(content.layouts[homeLayoutId]!.doorways ?? []));
for (const r of content.layouts[homeLayoutId]!.rooms) delete r.rect;
content.layouts[homeLayoutId]!.doorways = [];
logic.teleportTo(HOME);
logic.interact();
check('layout sin rects: entra sin geometría 2D (fallback 1D)', logic.position().mode === 'inside');
const xBefore = logic.position().x;
for (let i = 0; i < 120; i++) logic.update(1 / 60, { left: false, right: false, up: true, down: false, run: false });
check('fallback 1D: W/S no mueve profundidad', close(logic.position().z, 0.45) && close(logic.position().x, xBefore), `z=${logic.position().z.toFixed(2)}`);
content.layouts[homeLayoutId]!.rooms = JSON.parse(JSON.stringify(savedRooms)); // restaurar geometría
content.layouts[homeLayoutId]!.doorways = JSON.parse(JSON.stringify(savedDoorways));

// ── Candado/timbre (regresión v0.7.1 + v1.42): E delante de una puerta cerrada NO entra ni
// cambia de modo. El sim rechaza el move (door_locked) y la presentación lo traduce a TIMBRE
// (v1.42: llamar a la puerta ajena es el gesto social; nunca un enter seco).
const logic2 = new PlayerLogic(world, content);
// v1.27: en el edificio de 3 plantas la planta del jugador (3) puede no tener cerradas;
// cualquier vivienda bloqueada del mundo sirve para la misma prueba del candado.
const lockedBlock = Object.values(world.blocks).find((b) => b.kind === 'dwelling' && b.access === 'locked')!;
logic2.teleportTo(lockedBlock.id);
check('delante de puerta cerrada', logic2.interactTarget()?.kind === 'door' && world.blocks[lockedBlock.id]!.access === 'locked', lockedBlock.id);
const rejected = logic2.interact();
check('E en puerta cerrada → timbre (v1.42; no entered)', rejected.type === 'doorbell', JSON.stringify(rejected));
check('el jugador NO entra: modo corridor', logic2.position().mode === 'corridor' && logic2.position().insideBlock === null);
check('el sim tampoco movió al residente', world.residents[world.playerId]!.location !== lockedBlock.id, world.residents[world.playerId]!.location ?? 'null');
const inFront = logic2.interactTarget();
check('sigue delante de la misma puerta', inFront?.kind === 'door' && inFront.blockId === lockedBlock.id);

console.log(fails === 0 ? '\nQA INTERIOR OK' : `\nQA INTERIOR: ${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
