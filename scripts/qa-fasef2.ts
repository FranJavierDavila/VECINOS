/**
 * QA Contenido F v1.1 (pulido Steam + festival): verifica contra el contenido y el sim REALES:
 *  1. Catálogo válido: cadena del Festival (3 misiones), m_buzon_4d, cutscenes y diálogos nuevos.
 *  2. Canal chisme: influencia con propagación por pasillo, glow en rules.view y emisiones
 *     de la cotilla (watch_corridor / copas_bar).
 *  3. Param hype: declarado en portal y vivienda; onThreshold del chisme lo SUBE de verdad.
 *  4. Pilar (pintora) y Ray (repartidor): arquetipos válidos, residentes del escenario
 *     (present:false), assets glTF declarados y ficheros presentes.
 *  5. Cadena del festival: m_festival_convocatoria activa el día 3 (tras m_bienvenida); su
 *     onComplete sube la hype del portal +25; unlock de la pintora la muda con su modelo;
 *     m_festival_grandia exige hype ≥ 50 y hora ≥ 19:00; los roles $role resuelven.
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, tick } from '@/game/sim';
import { emissionsFromActivities, propagate } from '@/game/sim/influence';
import { applyEffects } from '@/game/sim/effects';
import { existsSync } from 'node:fs';

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

// ── 1. Catálogo: la cadena del festival + m_buzon_4d + cutscenes + diálogos
check('misiones del festival cargadas', ['m_festival_convocatoria', 'm_festival_musica', 'm_festival_grandia'].every((id) => !!content.missions[id]));
check('m_buzon_4d cargada', !!content.missions['m_buzon_4d']);
check('cutscenes del festival cargadas', ['cut_festival_convocatoria', 'cut_festival_final'].every((id) => !!content.cutscenes[id]));
check('diálogos del festival cargados', ['dlg_festival_1', 'dlg_festival_2', 'dlg_festival_3', 'dlg_buzon_4d'].every((id) => !!content.dialogs[id]));
const grandia = content.missions['m_festival_grandia']!;
const trig = grandia.trigger?.all ?? [];
check('gran día exige hype ≥ 50', trig.some((c) => 'param' in c && c.param === 'blk_p0_portal.hype' && c.gte === 50));
check('gran día exige hora ≥ 19:00', trig.some((c) => 'time' in c && c.time.after === '19:00'));

// ── 2. Canal chisme: influencia + emisiones de la cotilla
const chisme = content.influences['chisme'];
check('canal chisme declarado', !!chisme && chisme.channel === 'chisme', `threshold=${chisme?.threshold}`);
check('chisme se propaga por el pasillo (0.95)', chisme?.spread.corridor === 0.95);
const cotilla = content.archetypes['cotilla']!;
check('cotilla emite chisme vigilando el pasillo', cotilla.activities.watch_corridor?.emits?.chisme === 0.5);
check('cotilla emite chisme en El Rincón', cotilla.activities.copas_bar?.emits?.chisme === 0.6);
check('glow rosa del chisme en rules.view', content.rules.view.channelGlow.chisme === '#ff8fa3');

// ── 3. Param hype declarado y SUBIDO por el onThreshold del chisme (flujo real: pasillo → viviendas)
check('hype param en portal', content.blocks['portal']!.params?.hype?.label === 'Hype del barrio');
check('hype param en vivienda', content.blocks['vivienda_estandar']!.params?.hype?.max === 100);
const w0 = createWorld(content, content.rules.startScenario);
// La cotilla vigila el PASILLO de la planta 1 (at: corridor → emite desde el bloque pasillo):
// su chisme llega a TODAS las viviendas de la planta (factor corridor 0.95) y cruza el umbral.
const cot = w0.residents['res_cotilla_01']!;
cot.present = true;
cot.activity = 'watch_corridor';
const pasilloP1 = Object.values(w0.blocks).find((b) => b.defId === 'pasillo_planta' && b.cell.floor === 1)!.id;
cot.location = pasilloP1;
const before = (w0.blocks['blk_p1_b']!.params.hype as number) ?? 0;
propagate(w0, content, emissionsFromActivities(w0, content));
const after = w0.blocks['blk_p1_b']!.params.hype as number;
const delta = content.influences['chisme']!.onThreshold?.setParam?.delta ?? 0;
check('chisme del pasillo cruza umbral y SUBE la hype en 1B', after - before === delta, `${before} → ${after} (+${delta})`);
check('evento gossip_buzz emitido', w0.events.some((e) => e.type === 'gossip_buzz' && (e.data as { block?: string }).block === 'blk_p1_b'));

// ── 4. Pilar (pintora) y Ray (repartidor): arquetipos + residentes + assets
const pintora = content.archetypes['pintora']!;
const repartidor = content.archetypes['repartidor']!;
check('pintora: mural en def:portal y emite chisme', pintora.activities.pintar_mural?.at === 'def:portal' && pintora.activities.pintar_mural?.emits?.chisme === 0.35);
check('repartidor: ruta nocturna out con ruido', repartidor.activities.ruta_nocturna?.at === 'out' && repartidor.activities.ruta_nocturna?.emits?.noise === 0.4);
const scen = content.scenarios[content.rules.startScenario]!;
const pRes = scen.residents.find((r) => r.id === 'res_pintora_01');
const rRes = scen.residents.find((r) => r.id === 'res_repartidor_01');
check('res_pintora_01 en el escenario (present:false, 2C)', !!pRes && pRes.present === false && pRes.home === 'blk_p2_c');
check('res_repartidor_01 en el escenario (present:false, 1A — v1.27)', !!rRes && rRes.present === false && rRes.home === 'blk_p1_a');
const aP = content.assets?.actors?.['pintora'];
const aR = content.assets?.actors?.['repartidor'];
check('assets: pintora declarada con clip paint → pintar_mural', !!aP && aP.model === 'actors/pintora.gltf' && aP.activityAnimations?.pintar_mural === 'paint');
check('assets: repartidor declarado con clip ride → ruta_nocturna', !!aR && aR.model === 'actors/repartidor.gltf' && aR.activityAnimations?.ruta_nocturna === 'ride');
check('glTF pintora existe en disco', !!aP && existsSync(new URL('../public/assets/' + aP.model, import.meta.url).pathname));
check('glTF repartidor existe en disco', !!aR && existsSync(new URL('../public/assets/' + aR.model, import.meta.url).pathname));

// ── 5. Cadena: activación por triggers + onComplete (hype + mudanzas)
const w1 = createWorld(content, content.rules.startScenario);
w1.missions.find((m) => m.id === 'm_bienvenida')!.state = 'done';
w1.clock.day = 3; // dayMin 3 de la convocatoria
for (let i = 0; i < 3; i++) tick(w1, content);
const conv = w1.missions.find((m) => m.id === 'm_festival_convocatoria');
check('m_festival_convocatoria activa el día 3', conv?.state === 'active', conv?.state ?? 'ausente');
const hypeBefore = (w1.blocks['blk_p0_portal']!.params.hype as number) ?? 0;
applyEffects(w1, content, content.missions['m_festival_convocatoria']!.onComplete ?? [], { roles: conv?.roles ?? {} });
const hypeAfter = (w1.blocks['blk_p0_portal']!.params.hype as number) ?? 0;
check('convocatoria sube hype del portal +25', hypeAfter - hypeBefore === 25, `${hypeBefore} → ${hypeAfter}`);
w1.missions.find((m) => m.id === 'm_festival_convocatoria')!.state = 'done';
w1.clock.minute = 9 * 60 + 30; // trigger de la música: time.after 09:00
for (let i = 0; i < 3; i++) tick(w1, content);
const mus = w1.missions.find((m) => m.id === 'm_festival_musica');
check('m_festival_musica se encadena sola', mus?.state === 'active', mus?.state ?? 'ausente');
applyEffects(w1, content, content.missions['m_festival_musica']!.onComplete ?? [], { roles: mus?.roles ?? {} });
const pil = w1.residents['res_pintora_01']!;
check('onComplete del ensayo muda a Pilar al 2C con su modelo glTF', pil.present && pil.home === 'blk_p2_c' && !!content.assets?.actors?.['pintora']);
check('neighbor_arrived de Pilar emitido', w1.events.some((e) => e.type === 'neighbor_arrived' && (e.data as { resident?: string }).resident === 'res_pintora_01'));
w1.missions.find((m) => m.id === 'm_festival_musica')!.state = 'done';
for (let i = 0; i < 3; i++) tick(w1, content);
const grandia1 = w1.missions.find((m) => m.id === 'm_festival_grandia');
check('gran día NO activa con hype 50 exacta antes de las 19:00', !grandia1 || grandia1.state === 'pending', `${grandia1?.state ?? 'no instanciada'} (hype=${w1.blocks['blk_p0_portal']!.params.hype})`);
w1.clock.minute = 19 * 60 + 15;
for (let i = 0; i < 3; i++) tick(w1, content);
const grandia2 = w1.missions.find((m) => m.id === 'm_festival_grandia');
check('gran día activa a las 19:15 con hype 50', grandia2?.state === 'active', grandia2?.state ?? 'ausente');
check('roles del gran día resuelven ($role.presidente / $role.musico)', grandia2?.roles['presidente'] === 'res_presidente_01' && grandia2?.roles['musico'] === 'res_musico_01');
applyEffects(w1, content, content.missions['m_festival_grandia']!.choices?.[0]!.effects ?? [], { roles: grandia2?.roles ?? {} });
const ray = w1.residents['res_repartidor_01']!;
check('elección brindis muda a Ray al 1A (v1.27)', ray.present && ray.home === 'blk_p1_a' && w1.blocks['blk_p1_a']!.occupancy === 'occupied');

console.log(fails === 0 ? '\nQA CONTENIDO F v1.1 OK' : `\nQA CONTENIDO F v1.1: ${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
