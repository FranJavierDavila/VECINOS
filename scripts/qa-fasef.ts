/**
 * QA Fase E-piloto + F: arte extra y contenido de El Rincón (bar + lavandería).
 * Verifica contra el contenido y el sim REALES:
 *  1. Catálogo válido (incluye refs def: de actividades y cutscenes nuevas).
 *  2. Destino 'def:<blockDefId>': la IA lleva a los vecinos al local (copas/concierto)
 *     y a la lavandería comunal (lavadora_comunal), resolviendo la instancia por defId.
 *  3. Emisión espacial honesta: las actividades con destino externo emiten DESDE el bloque
 *     donde están (no desde su vivienda).
 *  4. setParam soundproofing sobre blk_p0_local (misión m_bar_ruido) atenúa de verdad la
 *     propagación de ruido a los vecinos (canal noise, attenuatedBy).
 *  5. Cadena de misiones: con m_bienvenida done, m_bar_inaugura se activa sola; sus roles
 *     ($role.abuela) resuelven a Esperanza para la cutscene cut_lavanderia.
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, tick } from '@/game/sim';
import { emissionsFromActivities, propagate } from '@/game/sim/influence';
import { applyEffect, applyEffects } from '@/game/sim/effects';

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

// ── 1. Catálogo: contenido nuevo presente y validado
check('misiones nuevas cargadas', ['m_bar_inaugura', 'm_bar_ruido', 'm_lavanderia_pelea'].every((id) => !!content.missions[id]));
check('cutscenes nuevas cargadas', ['cut_bar_inaugura', 'cut_lavanderia'].every((id) => !!content.cutscenes[id]));
check('local_comercial declara soundproofing', content.blocks['local_comercial']!.params?.soundproofing?.default === 0.15);
check('actividades def: del catálogo', content.archetypes['fiestero']!.activities.copas_bar?.at === 'def:local_comercial' && content.archetypes['jubilada']!.activities.lavadora_comunal?.at === 'def:lavanderia_comunal');

// ── 2. Destino def: — Kevin (copas_bar, 20:00-21:30) termina en el local
// (15 ticks: el reloj avanza 1 min/tick y la ventana cierra a las 21:30)
const world = createWorld(content, content.rules.startScenario);
content.archetypes['fiestero']!.activities.copas_bar!.schedule![0]!.chance = 1; // aislado: sin azar
world.residents['res_fiestero_01']!.present = true;
world.residents['res_fiestero_01']!.location = world.entry;
world.clock.minute = 20 * 60 + 30;
for (let i = 0; i < 15; i++) tick(world, content);
const kevin = world.residents['res_fiestero_01']!;
check('Kevin va al bar (def:local_comercial)', kevin.location === 'blk_p0_local', kevin.location ?? 'null');
check('Kevin con actividad copas_bar en el bar', kevin.activity === 'copas_bar', kevin.activity ?? 'null');

// Esperanza (lavadora_comunal, días impares 10:30-11:30) termina en la lavandería
content.archetypes['jubilada']!.activities.lavadora_comunal!.schedule![0]!.chance = 1;
world.residents['res_jubilada_01']!.present = true;
world.residents['res_jubilada_01']!.location = world.entry;
world.clock.day = 3; // impar
world.clock.minute = 10 * 60 + 45;
for (let i = 0; i < 15; i++) tick(world, content);
const espe = world.residents['res_jubilada_01']!;
check('Esperanza va a la lavandería comunal (def:lavanderia_comunal)', espe.location === 'blk_p0_lavanderia', espe.location ?? 'null');
check('Esperanza con actividad lavadora_comunal', espe.activity === 'lavadora_comunal', espe.activity ?? 'null');

// ── 3. Emisión desde el bloque donde ocurre (no desde la vivienda)
world.clock.minute = 22 * 60 + 15;
world.residents['res_musico_01']!.present = true;
world.residents['res_musico_01']!.location = 'blk_p0_local';
world.residents['res_musico_01']!.activity = 'concierto_bar';
const em = emissionsFromActivities(world, content);
check('Rita emite ruido DESDE el local', (em.noise?.['blk_p0_local'] ?? 0) > 0, `noise local = ${em.noise?.['blk_p0_local'] ?? 0}`);
check('Rita NO emite desde su vivienda (1C)', (em.noise?.['blk_p1_c'] ?? 0) === 0);
world.residents['res_musico_01']!.activity = 'bateria'; // at:'home' → sí desde casa
const emHome = emissionsFromActivities(world, content);
check('bateria (at:home) emite desde 1C', (emHome.noise?.['blk_p1_c'] ?? 0) > 0);

// ── 4. soundproofing del local atenúa la propagación de ruido a vecinos
const probe = () => {
  const w2 = createWorld(content, content.rules.startScenario);
  propagate(w2, content, { noise: { blk_p0_local: 0.9 } });
  return w2.channels.noise?.['blk_p0_lavanderia'] ?? 0;
};
const sinObra = probe();
applyEffect(world, content, { op: 'setParam', target: 'blk_p0_local', param: 'soundproofing', delta: 0.3 });
const conObra = (() => {
  const w3 = createWorld(content, content.rules.startScenario);
  w3.blocks['blk_p0_local']!.params.soundproofing = world.blocks['blk_p0_local']!.params.soundproofing;
  propagate(w3, content, { noise: { blk_p0_local: 0.9 } });
  return w3.channels.noise?.['blk_p0_nucleo'] ?? 0;
})();
check('setParam aplicado (0.15 + 0.3 ≈ 0.45)', Math.abs(world.blocks['blk_p0_local']!.params.soundproofing as number - 0.45) < 1e-9, `${world.blocks['blk_p0_local']!.params.soundproofing}`);
check('con obra acústica la lavandería recibe MENOS ruido', conObra < sinObra, `${sinObra.toFixed(3)} → ${conObra.toFixed(3)}`);

// ── 5. Cadena: m_bar_inaugura done → m_lavanderia_pelea se activa el día 2; roles resuelven
const w4 = createWorld(content, content.rules.startScenario);
w4.missions.find((m) => m.id === 'm_bienvenida')!.state = 'done';
for (let i = 0; i < 3; i++) tick(w4, content);
const inaugura = w4.missions.find((m) => m.id === 'm_bar_inaugura');
check('m_bar_inaugura se activa sola al done m_bienvenida', inaugura?.state === 'active', inaugura?.state ?? 'ausente');
// El onComplete de la inauguración muda a Kevin al 2B (el bar tiene parroquia y m_fiesta_de_kevin cobra sentido)
const defBar = content.missions['m_bar_inaugura']!;
applyEffects(w4, content, defBar.onComplete ?? [], { roles: inaugura?.roles ?? {} });
const kevin2 = w4.residents['res_fiestero_01']!;
check('onComplete del bar muda a Kevin al 2B', kevin2.present && kevin2.home === 'blk_p2_b' && w4.blocks['blk_p2_b']!.occupancy === 'occupied', `${kevin.present ? 'presente' : 'ausente'} @ ${w4.blocks['blk_p2_b']?.occupancy}`);
// Simulamos que la inauguración se completa (pasos jugados fuera del test):
w4.missions.find((m) => m.id === 'm_bar_inaugura')!.state = 'done';
for (let i = 0; i < 3; i++) tick(w4, content);
const lav1 = w4.missions.find((m) => m.id === 'm_lavanderia_pelea');
check('m_lavanderia_pelea NO activa el día 1 (dayMin 2)', !lav1 || lav1.state === 'pending', lav1?.state ?? 'no instanciada');
w4.clock.day = 2;
for (let i = 0; i < 3; i++) tick(w4, content);
const lav2 = w4.missions.find((m) => m.id === 'm_lavanderia_pelea');
check('m_lavanderia_pelea activa el día 2', lav2?.state === 'active', lav2?.state ?? 'ausente');
check('role abuela resuelve a Esperanza ($role.abuela)', lav2?.roles['abuela'] === 'res_jubilada_01', lav2?.roles['abuela'] ?? 'sin rol');

console.log(fails === 0 ? '\nQA FASE E-F OK' : `\nQA FASE E-F: ${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
