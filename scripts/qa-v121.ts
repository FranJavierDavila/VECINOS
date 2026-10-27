/**
 * QA v1.21 — "la calle mira al edificio, el cielo mira al cielo":
 *   1. Catálogo: capas de fachadas con SELLO real (image → PNG existente en disco con blur
 *      horneado por distancia), LLUVIA (rain/storm con densidades distintas), ventana del
 *      bloque trasero (rearBlock.window) y luces de pasillo nocturnas con presencia
 *      (ecosystem.lights.nightRequiresPresence).
 *   2. Señal de cámara del pasillo de trasteros: position().storage (cx = centro del bloque
 *      ≡ centro del pasillo) presente dentro y null fuera; dentro de la celda propia cede
 *      ante `rear`.
 *   3. Movimiento libre dentro del trastero: rearPos avanza, FRENA contra los rects
 *      registrados (estanterías/trastos) y la salida por E restaura el cuerpo del sim.
 *   4. Humor de cruce: el catálogo crossings crece con temas de trasteros/ventana/lluvia.
 *   5. Regresión: el sim sigue vivo tras 120 ticks.
 */
import { existsSync } from 'node:fs';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, tick } from '@/game/sim';
import { PlayerLogic } from '@/game/player-logic';
import { storageCorridorX, storageGeomOf, storageDoorPoint } from '@/game/storage';

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

// ── 1. Catálogo v1.21 ──
const v = content.rules.view;
const bd = v.backdrop;
check('capas de fachadas con sello PNG declarado', bd.layers.length >= 3 && bd.layers.every((l) => !!l.image && l.image.startsWith('/content/backdrop/')), bd.layers.map((l) => l.image?.split('/').pop()).join(' · '));
const onDisk = bd.layers.every((l) => l.image && existsSync(`public${l.image}`));
check('los sellos existen en disco (variantes desenfocadas por capa)', onDisk, 'public/content/backdrop/*.png');
check('blur creciente con la distancia (nombres cerca/media/lejos)', /cerca/.test(bd.layers[0]!.image ?? '') && /media/.test(bd.layers[1]!.image ?? '') && /lejos/.test(bd.layers[2]!.image ?? ''), '');
check('tinte de armonización distinto por capa (v1.22: con niebla desde la cercana)', bd.layers.every((l) => l.tint.startsWith('#')) && bd.layers[0]!.tint !== bd.layers[1]!.tint && bd.layers[1]!.tint !== bd.layers[2]!.tint, `${bd.layers[0]!.tint} / ${bd.layers[1]!.tint} / ${bd.layers[2]!.tint}`);
check('lluvia declarada con densidad de tormenta mayor', bd.rain.count > 0 && bd.rain.stormCount > bd.rain.count && bd.rain.fallSpeed > 10 && bd.rain.wind !== 0, `${bd.rain.count}→${bd.rain.stormCount} · ${bd.rain.fallSpeed} m/s`);
check('ventana del bloque trasero (marco+cristal al paisaje)', v.rearBlock.window.w > 0.6 && v.rearBlock.window.h > 0.6 && v.rearBlock.window.glassAlpha < 0.4, `${v.rearBlock.window.w}×${v.rearBlock.window.h}`);
const eco = content.ecosystem!;
check('luces de pasillo: de noche exigen presencia', eco.lights.nightRequiresPresence === true, `${eco.lights.nightIntensity}`);
check('crossings.json válido tras ampliar el humor (32 temas)', content.crossings!.groups.reduce((n, g) => n + g.topics.length, 0) >= 30, `${content.crossings!.groups.reduce((n, g) => n + g.topics.length, 0)} temas`);
const allTopics = content.crossings!.groups.flatMap((g) => g.topics.map((t) => t.id));
check('temas nuevos de trasteros/ventana/lluvia presentes', ['trastero_orden', 'ventana_fondo', 'lluvia_guapa', 'farolas', 'pasillo_oscuro', 'ruido_cajas'].every((id) => allTopics.includes(id)), '');

// ── 2+3. Sim E2E: señal de cámara + movimiento con obstáculos ──
const world = createWorld(content, 'slice');
for (let i = 0; i < 4; i++) tick(world, content);
const logic = new PlayerLogic(world, content);
// v1.27: el edificio simplificado ya no trae columna de trasteros (trasteros_columna
// fuera de la plantilla). La geometría sigue viva en storage.ts; si algún día vuelve un
// bloque de columna, estas aserciones se reactivan solas.
const STOR = Object.values(world.blocks).find((b) => b.defId === v.trasteros.blockDefId && b.id.endsWith('_c'));
const sg = storageGeomOf(v);
if (!STOR) {
  console.log('↷ v1.27: sin trasteros_columna en la plantilla simplificada — sección de columna de trasteros omitida (la geometría sigue cubierta por qa-v18/storage)');
  console.log('\nQA v1.21 VERDE (con omisión v1.27)');
  process.exit(0);
}
const x0 = STOR.cell.col * v.cellW;
const W = STOR.size.w * v.cellW - v.gapW;
const [corA, corB] = storageCorridorX(x0, sg);
check('el pasillo central está centrado en el bloque (cx de cámara ≡ medio del pasillo)', close((corA + corB) / 2, x0 + W / 2), `${((corA + corB) / 2).toFixed(2)} ≈ ${(x0 + W / 2).toFixed(2)}`);

logic.teleportTo(STOR.id);
for (let i = 0; i < 6; i++) tick(world, content);
check('fuera del bloque: sin señal de cámara de trasteros', logic.position().storage === null, '');
const entered = logic.interact();
check('E entra en el pasillo interior del bloque de trasteros', entered.type === 'entered' && logic.mode === 'inside', JSON.stringify(entered));
const sig = logic.position().storage;
check('caminando el pasillo: la cámara recibe el encuadre del pasillo', !!sig && close(sig.cx, x0 + W / 2) && close(sig.frontZ, v.roomZ - v.commonDepth / 2) && close(sig.depth, sg.depth), JSON.stringify(sig));
check('fondo del pasillo completo declarado (12.6 m con el catálogo)', (sig?.depth ?? 0) > 12, `${sig?.depth} m`);

// La celda propia: la puerta dorada
const me = world.residents[world.playerId]!;
const home = world.blocks[me.home]!;
const tag = home.id.slice(home.id.lastIndexOf('_') + 1);
const colDwell = Object.values(world.blocks).filter((b) => b.kind === 'dwelling' && b.id.endsWith(`_${tag}`)).map((b) => b.cell.floor).sort((a, z) => a - z);
const planDoor = storageDoorPoint(v, STOR, colDwell, home.cell.floor)!;
logic.x = planDoor.x;
logic.z = planDoor.z - (v.roomZ - v.commonDepth / 2);
const rearEnter = logic.interact();
check('E abre el trastero propio (rearEnter)', rearEnter.type === 'rearEnter' && logic.rearHold, JSON.stringify(rearEnter));
const pIn = logic.position();
check('dentro de la celda: la señal de pasillo cede (la cámara encuadra la estancia)', pIn.storage === null && !!pIn.rear, `storage ${pIn.storage} · rear ${JSON.stringify(pIn.rear)}`);

// Movimiento libre con obstáculos: estanterías al fondo (z alto) y trastos sueltos
const seat0 = pIn.rear!;
logic.setCellObstacles([
  { x0: seat0.x - 0.4, z0: seat0.z + 0.75, w: 1.2, d: 0.45 }, // estantería delante
  { x0: x0 + W - 1.1, z0: seat0.z - 0.2, w: 0.7, d: 0.7 }, // trasto a la derecha
]);
for (let i = 0; i < 60; i++) logic.update(1 / 60, { left: false, right: false, up: true, down: false, run: false });
const seatBlocked = logic.position().rear!;
check('el cuerpo AVANZA dentro del trastero pero FRENA ante la estantería', seatBlocked.z > seat0.z && seatBlocked.z < seat0.z + 0.75 - v.actorRadius + 0.06, `z ${seat0.z.toFixed(2)}→${seatBlocked.z.toFixed(2)} (obstáculo en ${seat0.z + 0.75})`);
for (let i = 0; i < 60; i++) logic.update(1 / 60, { left: true, right: false, up: false, down: false, run: false });
const seatLeft = logic.position().rear!;
check('el desplazamiento lateral también es libre (esquivar trastos)', seatLeft.x < seatBlocked.x - 0.3, `x ${seatBlocked.x.toFixed(2)}→${seatLeft.x.toFixed(2)}`);
const rearExit = logic.interact();
check('E sale del trastero y el cuerpo del sim vuelve al pasillo', rearExit.type === 'rearExit' && !logic.rearHold && logic.position().rear === null, JSON.stringify(rearExit));
const sig2 = logic.position().storage;
check('al salir de la celda la señal de cámara del pasillo vuelve', !!sig2 && close(sig2.cx, x0 + W / 2), '');

// Camina hacia la entrada (z local baja) para dejar la puerta propia detrás antes de pulsar E
for (let i = 0; i < 50; i++) logic.update(1 / 60, { left: false, right: false, up: false, down: true, run: false });
const out = logic.interact(); // salir del bloque de trasteros
check('E devuelve al pasillo del edificio (señal de cámara apagada)', out.type === 'exited' && logic.position().storage === null, JSON.stringify(out));

// ── 5. Regresión: el mundo sigue vivo ──
for (let i = 0; i < 120; i++) tick(world, content);
check('sim 120 ticks sin colarse en la presentación', world.tick >= 120, `tick ${world.tick}`);

console.log(fails === 0 ? '\nQA v1.21 VERDE' : `\nQA v1.21: ${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
