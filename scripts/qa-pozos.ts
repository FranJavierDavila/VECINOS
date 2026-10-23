/**
 * QA v0.6-c: pozos verticales independientes (escalera ≠ ascensor).
 * Verifica contra el contenido y el sim REALES:
 *  1. Con el ascensor averiado, la ruta portal→3C pasa por los bloques de escalera (nunca por el núcleo).
 *  2. canMove rechaza el salto vertical núcleo→núcleo averiado y acepta escalera→escalera.
 *  3. La escalera de planta 0 no tiene arista hacia abajo y la de la 7 no hacia arriba (particularidad pedida).
 *  4. Con el ascensor reparado, la ruta usa el núcleo (7 min < 13 min) y canMove acepta el salto.
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, tick, buildCirculation, travelMinutes, nextStepTowards } from '@/game/sim';
import { canMove } from '@/game/sim/commands';

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

const world = createWorld(content, content.rules.startScenario);
const step = (from: string, to: string) => nextStepTowards(world, content, from, to);

// ── 1. Ascensor averiado (estado inicial del escenario): la IA va por la escalera
check('avg averiado: portal→pasillo', step('blk_p0_portal', 'blk_p3_c') === 'blk_p0_pasillo');
check('avg averiado: pasillo→escalera (no al núcleo)', step('blk_p0_pasillo', 'blk_p3_c') === 'blk_p0_escalera', `→ ${step('blk_p0_pasillo', 'blk_p3_c')}`);
let cur = 'blk_p0_portal';
const path: string[] = [cur];
for (let i = 0; i < 40 && cur !== 'blk_p3_c'; i++) {
  const nxt = step(cur, 'blk_p3_c');
  if (!nxt) break;
  path.push(nxt);
  cur = nxt;
}
check('ruta completa termina en 3C', cur === 'blk_p3_c', path.join(' → '));
check('la ruta NO usa el núcleo (averiado)', !path.some((b) => b.includes('nucleo')));
check('la ruta SÍ usa la escalera', path.some((b) => b.startsWith('blk_p1_escalera') || b.startsWith('blk_p2_escalera')));
check('viaje portal→3C averiado = 13 min', travelMinutes(buildCirculation(world, content), world.entry, 'blk_p3_c') === 13);

// ── 2. Guards de movimiento vertical
check('canMove núcleo averiado p0→p1 RECHAZADO', !canMove(world, content, 'blk_p0_nucleo', 'blk_p1_nucleo'));
check('canMove escalera p0→p1 OK', canMove(world, content, 'blk_p0_escalera', 'blk_p1_escalera'));
check('canMove escalera→núcleo (pozos distintos) RECHAZADO', !canMove(world, content, 'blk_p0_escalera', 'blk_p1_nucleo'));

// ── 3. Particularidad: planta 0 no baja, última no sube
const g = buildCirculation(world, content);
const vecinos = (id: string) => [...(g.edges.get(id)?.keys() ?? [])];
check('escalera p0 solo conecta con pasillo/portal/p1 (nada por debajo)', vecinos('blk_p0_escalera').every((b) => !b.startsWith('blk_') || b === 'blk_p1_escalera' || b === 'blk_p0_pasillo' || b === 'blk_p0_portal' || b === 'blk_p0_trasteros'), JSON.stringify(vecinos('blk_p0_escalera')));
check('escalera p7 solo conecta con pasillo/p6 (nada por encima)', vecinos('blk_p7_escalera').every((b) => !b.startsWith('blk_') || b === 'blk_p6_escalera' || b === 'blk_p7_pasillo'), JSON.stringify(vecinos('blk_p7_escalera')));
// W/S en cliente: el guard to<0 / to>topFloor es la otra mitad (player-logic.startClimb).

// ── 4. Ascensor reparado: el núcleo vuelve a la ruta y el viaje baja a 7 min
world.blocks['blk_p0_nucleo']!.params.elevator_status = 'ok';
world.blocks['blk_p1_nucleo']!.params.elevator_status = 'ok';
world.blocks['blk_p2_nucleo']!.params.elevator_status = 'ok';
world.blocks['blk_p3_nucleo']!.params.elevator_status = 'ok';
check('reparado: pasillo→núcleo', step('blk_p0_pasillo', 'blk_p3_c') === 'blk_p0_nucleo', `→ ${step('blk_p0_pasillo', 'blk_p3_c')}`);
check('viaje portal→3C reparado = 7 min', travelMinutes(buildCirculation(world, content), world.entry, 'blk_p3_c') === 7);
check('canMove núcleo reparado p0→p1 OK', canMove(world, content, 'blk_p0_nucleo', 'blk_p1_nucleo'));

// ── 5. IA real: Pinturillas (roam con at:'stairs' 🛼) patrulla un bloque de escalera.
// Se aísla el roam vaciando la ventana de paint_cabin SOLO en este test (compiten en 16-19h).
delete content.archetypes['nino_grafitero']!.activities.paint_cabin;
world.residents['res_nino_01']!.present = true;
world.residents['res_nino_01']!.location = 'blk_p0_portal';
world.clock.minute = 16 * 60 + 30; // ventana roam 16:00-19:00
for (let i = 0; i < 80; i++) tick(world, content);
const nino = world.residents['res_nino_01']!;
check('Pinturillas patrulla un bloque de escalera', !!nino.location && nino.location.includes('escalera'), nino.location ?? 'null');
check('actividad roam activa en la escalera', nino.activity === 'roam', nino.activity ?? 'null');

console.log(fails === 0 ? '\nQA POZOS OK' : `\nQA POZOS: ${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
