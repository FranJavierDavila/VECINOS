/**
 * QA v1.19 — "el edificio gana profundidad y un tercer eje":
 *   1. Catálogo: depthModule (todos los bloques +1 módulo), pasillos del DOBLE de calado con
 *      DOS carriles, sección rearBlock (apilamiento 3D), trasteros con fachada/guía/celda
 *      presentable y textos de interacción nuevos.
 *   2. Escalera: def escaleras_cota SOLO en la planta alta (tramo especial sin tramos
 *      fantasma), glTF en disco y contrato de peldaño a peldaño en stairPathPoints.
 *   3. Geometría: carriles del pasillo (interior/exterior), FIX de storageDoorX (la puerta de
 *      una celda izquierda está en el borde IZQUIERDO del pasillo) y cuarto trasero alcanzable
 *      SOLO por la puerta del fondo.
 *   4. Sim E2E: mundo nuevo con 28 viviendas; el jugador camina los dos carriles (y en el
 *      exterior no hay puerta delante), entra en SU trastero (rearEnter/rearExit) y cruza a
 *      pie la puerta trasera de su vivienda.
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, tick, dispatch } from '@/game/sim';
import { PlayerLogic } from '@/game/player-logic';
import { corridorLanes, storageCorridorX, storageDoorX, storageGeomOf } from '@/game/storage';
import { stairGeomOf, stairPathPoints } from '@/game/stairs';
import { layoutGeometryOf, interiorTarget, roomAt, walkable } from '@/game/interior';

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
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ── 1. Catálogo ──
const v = content.rules.view;
check('depthModule declarado (todos los bloques +1 módulo hacia el fondo)', v.depthModule === 1.4, `${v.depthModule} m`);
check('viviendas a calado final 4.2 y comunes a 2.8 (módulo ya incluido)', close(v.depth, 4.2) && close(v.commonDepth, 2.8), `${v.depth}/${v.commonDepth}`);
check('pasillos frontales del DOBLE de calado (2 carriles)', close(v.corridorDepth, 2.6), `${v.corridorDepth} m`);
check('línea del pasillo recolocada al carril interior (0.6 de la fachada)', close(v.corridorZ, v.roomZ - v.commonDepth / 2 - 0.6), `${v.corridorZ}`);
check('rearBlock declarado (contorno rojo + fundidos)', v.rearBlock.outline === '#e63946' && v.rearBlock.fadeSeconds > 0 && v.rearBlock.junk >= 0, `${v.rearBlock.outline} · ${v.rearBlock.fadeSeconds}s`);
check('trasteros: puerta dorada propia + celda presentable + cartel guía', !!v.trasteros.ownDoorColor && v.trasteros.cellRoomDepth > 1.5 && v.trasteros.guide.w > 1 && v.trasteros.cellJunk >= 0, `${v.trasteros.cellRoomDepth} m de sala`);
check('textos de interacción nuevos (trastero/salida)', !!content.rules.interact.storageEnter && !!content.rules.interact.rearExit, content.rules.interact.storageEnter);
check('la escalera cota existe como def con stairs', content.blocks['escaleras_cota']?.features?.stairs === true, String(content.blocks['escaleras_cota']?.label));
check('assets declara la cota con spanW 2', content.assets?.blocks?.escaleras_cota?.spanW === 2, content.assets?.blocks?.escaleras_cota?.model ?? 'ausente');

// ── 2. Plantilla ──
const world = createWorld(content, content.rules.startScenario);
const stairTop = Object.values(world.blocks).filter((b) => b.defId === 'escaleras_cota');
const stairNorm = Object.values(world.blocks).filter((b) => b.defId === 'escaleras_planta');
check('cota SOLO en la planta 9 (tramo especial de bajada)', stairTop.length === 1 && stairTop[0]!.cell.floor === 9, stairTop.map((b) => b.id).join(','));
check('tramos normales 0..8 (nada que suba al vacío)', stairNorm.length === 9 && stairNorm.every((b) => b.cell.floor <= 8), stairNorm.map((b) => b.cell.floor).sort((a, z) => a - z).join(','));
const maxFloor = Math.max(...Object.values(world.blocks).map((b) => b.cell.floor));
check('la cota es la última planta con escalera (0..9 completos)', maxFloor === 10 && stairTop[0]!.cell.floor === 9, `max=${maxFloor}`);

// ── 3. Geometría: carriles, puertas de celda y escalera a peldaños ──
const lanes = corridorLanes(v);
const frontZ = v.roomZ - v.commonDepth / 2;
check('carril interior = línea del pasillo (junto a puertas)', close(lanes.inner, v.corridorZ), `${lanes.inner}`);
check('carril exterior simétrico junto a la barandilla', close(lanes.outer, frontZ - v.corridorDepth + (frontZ - v.corridorZ)), `${lanes.outer.toFixed(2)}`);
check('umbral de carril entre ambos', lanes.threshold < lanes.inner && lanes.threshold > lanes.outer, `${lanes.threshold.toFixed(2)}`);

const sg = storageGeomOf(v);
const x0s = 8 * v.cellW; // col 8 = primer bloque de trasteros (letra a)
const [corA, corB] = storageCorridorX(x0s, sg);
check('FIX puerta de celda IZQUIERDA en el borde izquierdo del pasillo', close(storageDoorX(x0s, 'left', sg), corA), `${storageDoorX(x0s, 'left', sg).toFixed(2)} = corA ${corA.toFixed(2)}`);
check('puerta de celda DERECHA en el borde derecho', close(storageDoorX(x0s, 'right', sg), corB), `${storageDoorX(x0s, 'right', sg).toFixed(2)} = corB ${corB.toFixed(2)}`);

const g = stairGeomOf(v)!;
const cellH = v.cellH;
const y0 = 2 * cellH + v.slab * 2;
const y1 = 3 * cellH + v.slab * 2;
const up = stairPathPoints(v, 24, y0, y1);
const down = stairPathPoints(v, 24, y1, y0);
check('ruta de escalada peldaño a peldaño (≥ 20 puntos, antes 14)', up.length >= 20, `${up.length} puntos`);
check('subida monótona en Y (sin patinajes)', up.every((p, i) => i === 0 || p.y >= up[i - 1]!.y - 1e-9), '');
check('la bajada es el reverso EXACTO de la subida', down.length === up.length && down.every((p, i) => close(p.x, up[up.length - 1 - i]!.x) && close(p.y, up[up.length - 1 - i]!.y) && close(p.z, up[up.length - 1 - i]!.z)), '');
check('la subida termina en el carril interior del pasillo', close(up[up.length - 1]!.z, v.corridorZ), `${up[up.length - 1]!.z}`);

// ── 4. Layout: cuarto trasero SOLO por la puerta del fondo ──
const HOME = world.residents[world.playerId]!.home;
const homeBlock = world.blocks[HOME]!;
const geo = layoutGeometryOf(content, homeBlock)!;
const depth = v.depth;
const rear = geo.rooms.find((r) => r.rect.z + r.rect.d > depth + 0.01);
check('la vivienda tiene cuarto trasero más profundo que el bloque', !!rear && rear.key === 'trasera', rear?.key ?? 'nada');
check('la trasera NO se alcanza caminando fuera del hueco', !walkable(geo, roomAt(geo, 0.45, 4.1), 0.45, 4.3), 'x=0.45 fuera del hueco');
check('la trasera SÍ se alcanza por la puerta del fondo', walkable(geo, roomAt(geo, 1.15, 4.1), 1.15, 4.3), 'x=1.15 en el hueco');
check('los vecinos jamás deambulan a la trasera', (() => { for (let lap = 0; lap < 30; lap++) { const t = interiorTarget(content, geo, undefined, 'qa', lap); if (!t || t.z > depth) return false; } return true; })(), '');

// ── 5. Sim E2E: dos carriles + trastero propio + puerta del fondo ──
const logic = new PlayerLogic(world, content);
const STOR = Object.values(world.blocks).find((b) => b.defId === v.trasteros.blockDefId && b.id.endsWith('_c'))!;
logic.teleportTo(STOR.id);
for (let i = 0; i < 6; i++) tick(world, content);
check('jugador plantado en el pasillo de la planta de trasteros', logic.mode === 'corridor' && logic.floor === STOR.cell.floor, `${logic.floor}`);
const zInner = logic.z;
for (let i = 0; i < 40; i++) logic.update(1 / 60, { left: false, right: false, up: false, down: true, run: false });
check('S lleva al carril EXTERIOR (y allí no hay puerta delante)', logic.z < lanes.threshold && logic.doorInFront() === null, `z ${zInner.toFixed(2)}→${logic.z.toFixed(2)}`);
for (let i = 0; i < 40; i++) logic.update(1 / 60, { left: false, right: false, up: true, down: false, run: false });
check('W devuelve al carril interior', logic.z >= zInner - 0.05, `z=${logic.z.toFixed(2)}`);
// En el pozo, W/S siguen subiendo (regresión de carriles): planta de trasteros no tiene pozo en su X, así que W aquí es carril.
check('W/S sin pozo delante nunca disparan escalada', logic.mode === 'corridor' && !logic.position().climbing, '');

// Entrar al bloque de trasteros y plantarse ante la puerta PROPIA (vivienda del jugador, letra c)
const entered = logic.interact(); // teleportTo deja al jugador ante el bloque → E entra al pasillo interior
check('E entra en el pasillo interior del bloque de trasteros', entered.type === 'entered' && logic.mode === 'inside' && logic.insideBlock === STOR.id, JSON.stringify(entered));
const me = world.residents[world.playerId]!;
const home = world.blocks[me.home]!;
const tag = home.id.slice(home.id.lastIndexOf('_') + 1);
const colDwell = Object.values(world.blocks).filter((b) => b.kind === 'dwelling' && b.id.endsWith(`_${tag}`)).map((b) => b.cell.floor).sort((a, z) => a - z);
const planDoor = (await import('@/game/storage')).storageDoorPoint(v, STOR, colDwell, home.cell.floor)!;
logic.x = planDoor.x;
logic.z = planDoor.z - (v.roomZ - v.commonDepth / 2); // la z del jugador es LOCAL al pasillo interior
const tgt = logic.interactTarget();
check('ante TU puerta dorada el objetivo es la celda propia', tgt?.kind === 'storageCell', JSON.stringify(tgt));
const rearEnter = logic.interact();
check('E abre el trastero: swap de bloques (rearEnter + hold)', rearEnter.type === 'rearEnter' && logic.rearCell?.block === STOR.id && logic.rearHold, JSON.stringify(rearEnter));
const seat = logic.position().rear;
// v1.21: dentro del trastero hay MOVIMIENTO LIBRE — el aterrizaje es junto a la puerta
// (por dentro) y desde ahí el jugador se pasea esquivando obstáculos (qa-v121).
check('el cuerpo vive dentro del bloque trasero (aterriza junto a la puerta propia)', !!seat && Math.abs(seat.z - (frontZ + 0.75)) < 0.05 && Math.abs(seat.x - planDoor.x) < 0.05, JSON.stringify(seat));
const rearExit = logic.interact();
check('E vuelve a salir: el trastero recupera su misterio', rearExit.type === 'rearExit' && logic.rearCell === null && !logic.rearHold, JSON.stringify(rearExit));

// Puerta del fondo de la vivienda: teleport a casa, entrar y cruzar a la trasera a pie
logic.teleportTo(home.id);
for (let i = 0; i < 4; i++) tick(world, content);
logic.interact(); // entra en la vivienda
const X0 = home.cell.col * v.cellW;
logic.x = X0 + 1.15;
logic.z = depth - 0.3;
for (let i = 0; i < 90; i++) logic.update(1 / 60, { left: false, right: false, up: true, down: false, run: false });
check('cruzando la puerta del fondo se vive el cuarto trasero', logic.z > depth + 0.05 && logic.z < depth + 1.4, `z=${logic.z.toFixed(2)}`);
for (let i = 0; i < 90; i++) logic.update(1 / 60, { left: false, right: false, up: false, down: true, run: false });
check('y se vuelve al salón por la misma puerta', logic.z < depth, `z=${logic.z.toFixed(2)}`);
check('el sim nunca supo de la trasera: location sigue siendo la vivienda', me.location === home.id, me.location ?? 'null');

// ── 6. Regresión exprés del sim ──
for (let i = 0; i < 240; i++) tick(world, content);
check('sim 240 ticks sin deriva · día 1', world.clock.day === 1, `día ${world.clock.day} · tick ${world.tick}`);

console.log(fails === 0 ? '\nQA V1.19 OK ✅' : `\nQA V1.19: ${fails} FALLOS ❌`);
process.exit(fails === 0 ? 0 : 1);
