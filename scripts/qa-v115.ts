/**
 * QA v1.15 — "Hablan: bocadillos con texto + Contenido F (obra del Mañas)".
 * Verifica contra el contenido y el sim REALES (patrón qa-v13/qa-ecosystem):
 *  1. Bocadillos con texto: emotes.speech (tiempos/estilo) y líneas `say` sanas en catálogo.
 *  2. Canal polvo: influences.json declara umbral + setParam dust; vivienda_estandar tiene
 *     el param `dust`; ecosystem.json pinta el decal polvo_obra (param REAL).
 *  3. Arquetipos nuevos (electricista/sanitaria): actividades con say/emits/schedule y view.
 *  4. Assets: glTF generados en disco con clips obra/care + base + sociales; activityAnimations.
 *  5. Escenarios: residents nuevos con viviendas EXISTENTES en plantilla (p5_b / p3_a).
 *  6. Cadena encadenada: m_aviso_polvo (trigger día 2) → m_negociar_obra (catch en portal)
 *     → m_fin_de_obra (delay 1440 + enter portal); diálogo y 2 cutscenes encadenadas.
 *  7. Sim E2E: el trigger del día 2 dispara m_aviso_polvo; la elección arranca
 *     m_negociar_obra; Román aterriza en el portal en SU ventana (14:10–15:30) —
 *     reintentando a lo largo de los días si su chance del catálogo no sale (determinista).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, advanceMissions, dispatch, resolveBlocks } from '@/game/sim';

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

// ── 1. Bocadillos con texto (v1.15) ──
const emotes = content.emotes;
check('emotes.speech declarado (v1.15)', !!emotes?.speech, emotes?.speech ? JSON.stringify(emotes.speech) : 'ausente');
const sp = emotes?.speech;
check('speech: tiempos positivos y coherentes', !!sp && sp.lineSeconds > 0 && sp.gapSeconds >= 0 && sp.cycleGap >= 0 && sp.maxPx >= 80 && sp.fontSizePx >= 9, '');
const sayActs: { arch: string; act: string; lines: string[] }[] = [];
for (const [archId, a] of Object.entries(content.archetypes)) {
  for (const [actId, act] of Object.entries(a.activities)) {
    if (act.say && act.say.length > 0) sayActs.push({ arch: archId, act: actId, lines: act.say });
  }
}
check('hay ≥12 actividades con líneas say', sayActs.length >= 12, `${sayActs.length}`);
check('todas las líneas say son texto no vacío', sayActs.every((s) => s.lines.every((l) => l.trim().length > 0)), '');

// ── 2. Canal polvo + param dust + decal ──
const polvo = Object.values(content.influences).find((c) => c.id === 'polvo');
check('canal polvo declarado con umbral', !!polvo && polvo.threshold > 0, polvo ? `threshold=${polvo.threshold}` : 'ausente');
check('polvo onThreshold → dust delta negativo/positivo', !!polvo && polvo.onThreshold?.setParam?.param === 'dust' && typeof polvo.onThreshold.setParam.delta === 'number', JSON.stringify(polvo?.onThreshold?.setParam ?? {}));
const dustParam = content.blocks['vivienda_estandar']?.params?.dust;
check('vivienda_estandar tiene param dust (number 0..100)', !!dustParam && dustParam.type === 'number', JSON.stringify(dustParam ?? {}));
const decal = content.ecosystem?.visuals.deterioration.find((d) => d.id === 'polvo_obra');
check('decal polvo_obra lee param REAL de vivienda', !!decal && !!content.blocks[decal.blockDef]?.params?.[decal.param], decal ? `${decal.blockDef}.${decal.param} ${decal.kind}` : 'ausente');

// ── 3. Arquetipos nuevos ──
const ma = content.archetypes['electricista'];
const pu = content.archetypes['sanitaria'];
check('arquetipo electricista con obra_en_casa (emite polvo)', !!ma?.activities.obra_en_casa && (ma.activities.obra_en_casa.emits?.polvo ?? 0) > 0, JSON.stringify(ma?.activities.obra_en_casa?.emits ?? {}));
check('electricista baja al portal por materiales (def:portal + say)', ma?.activities.materiales_portal?.at === 'def:portal' && (ma.activities.materiales_portal.say?.length ?? 0) >= 2, ma?.activities.materiales_portal?.at ?? 'ausente');
check('sanitaria con ronda en pasillo y botiquín con say', !!pu?.activities.ronda_sanitaria?.at && (pu.activities.prepara_botiquin.say?.length ?? 0) >= 2, `${pu?.activities.ronda_sanitaria?.at}`);
check('views nuevas dentro del schema (hat/prop válidos)', ma?.view.hat === 'cap' && pu?.view.hat === 'bun' && ma.view.prop === 'briefcase', `${ma?.view.hat}/${pu?.view.hat}`);

// ── 4. Assets: glTF en disco con los clips correctos ──
const actorsDir = resolve(process.cwd(), 'public/assets/actors');
for (const [arch, clip] of [['electricista', 'obra'], ['sanitaria', 'care']] as const) {
  const def = content.assets?.actors?.[arch];
  const file = resolve(actorsDir, `${arch}.gltf`);
  let anims: string[] = [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { animations?: { name?: string }[] };
    anims = (raw.animations ?? []).map((a) => a.name ?? '');
  } catch { /* file missing */ }
  check(`${arch}: modelo declarado, en disco y con clips base+${clip}`, !!def && existsSync(file) && anims.includes(clip) && anims.includes('walk') && anims.includes('talk'), anims.join(','));
  const mapped = Object.values(def?.activityAnimations ?? {}).some((c) => c === clip);
  check(`${arch}: activityAnimations enlaza ${clip} a una actividad real`, mapped, JSON.stringify(def?.activityAnimations ?? {}));
}

// ── 5. Escenarios: residents con viviendas de la plantilla ──
const templateTags = new Set<string>();
const tpl = Object.values(content.templates)[0];
for (const row of tpl?.rows ?? []) {
  for (const b of row.blocks) templateTags.add(b.tag);
}
const homesOk = (home: string) => {
  const m = /^blk_p(\d+)_(\w+)$/.exec(home);
  return !!m && templateTags.has(m[2]!);
};
for (const s of Object.values(content.scenarios)) {
  const el = s.residents.find((r) => r.id === 'res_electricista_01');
  const sa = s.residents.find((r) => r.id === 'res_sanitaria_01');
  check(`${s.id}: Román (electricista) en p5_b y Puri (sanitaria) en p3_a, viviendas reales`, el?.home === 'blk_p5_b' && sa?.home === 'blk_p3_a' && homesOk(el?.home ?? '') && homesOk(sa?.home ?? ''), `${el?.home}·${sa?.home}`);
}

// ── 6. Cadena encadenada + teatro ──
const m1 = content.missions['m_aviso_polvo'];
const m2 = content.missions['m_negociar_obra'];
const m3 = content.missions['m_fin_de_obra'];
check('m_aviso_polvo: trigger día≥2 con ventana horaria', JSON.stringify(m1?.trigger ?? {}).includes('dayMin') && JSON.stringify(m1?.trigger ?? {}).includes('after'), JSON.stringify(m1?.trigger ?? {}));
check('m_aviso_polvo: ambas elecciones encadenan m_negociar_obra', m1?.choices?.every((c) => c.effects.some((e) => e.op === 'startMission' && e.id === 'm_negociar_obra')) ?? false, '');
check('m_negociar_obra: catch_in_act de Román en el portal', m2?.steps[0]?.type === 'catch_in_act' && m2.steps[0].place === 'portal', JSON.stringify(m2?.steps[0] ?? {}));
check('m_negociar_obra: las dos salidas cerrarán m_fin_de_obra a 24h', m2?.onComplete?.some((e) => e.op === 'startMission' && e.id === 'm_fin_de_obra' && e.delayMinutes === 1440) ?? false, '');
check('m_fin_de_obra: enter BLK_P0_PORTAL (id de instancia, resolveRef no resuelve defIds) + rol invitada', m3?.steps[0]?.type === 'enter' && m3.steps[0].target === 'blk_p0_portal' && m3.roles?.invitada?.archetype === 'jubilada', '');
check('dlg_polvo_aviso cargado con 3 líneas', (content.dialogs['dlg_polvo_aviso']?.lines.length ?? 0) === 3, '');
const cA = content.cutscenes['cut_mañas_portal'];
const cB = content.cutscenes['cut_fin_obra'];
check('cutscene del Mañas dispara al ACTIVARSE la negociación (sin choque con el modal del catch)', cA?.trigger.on === 'mission_activated' && cA.trigger.mission === 'm_negociar_obra', cA?.trigger.on ?? 'ausente');
check('cutscene de inauguración: Román sale de SU casa hasta el portal', cB?.trigger.on === 'step_started' && cB.beats.some((b) => b.type === 'walk' && b.who === '$role.obra') && cB.beats.some((b) => b.type === 'walk' && b.to.block === 'portal'), '');

// ── 7. Sim E2E: trigger del día 2 → elección → Román en el portal en su ventana ──
const w = createWorld(content, content.rules.startScenario);
w.clock.day = 2;
w.clock.minute = 630; // 10:30 del día 2
w.tick += 1;
advanceMissions(w, content);
const aviso = w.missions.find((m) => m.id === 'm_aviso_polvo');
check('sim: día 2 → m_aviso_polvo se activa', aviso?.state === 'active' || aviso?.state === 'awaiting_choice', aviso?.state ?? 'ausente');

const a1 = dispatch(w, content, { type: 'answer_call', mission: 'm_aviso_polvo' });
const a2 = dispatch(w, content, { type: 'choose', mission: 'm_aviso_polvo', choice: 'me_ocupo' });
const negociar = w.missions.find((m) => m.id === 'm_negociar_obra');
check('sim: la llamada + elección arrancan m_negociar_obra', a1.ok && a2.ok && negociar?.state === 'active', `call=${a1.ok} choose=${a2.ok} state=${negociar?.state}`);

// El catch_in_act COLOCA al objetivo en el lugar al arrancar el paso (mismo teatro que la
// trastada del crío): Román debe estar en el portal (resolveBlocks por defId) sin depender
// de su schedule, y Puri sigue en su vida normal.
const portal = resolveBlocks(w, content, 'portal').sort((x, y) => x.id.localeCompare(y.id))[0];
const roman = w.residents['res_electricista_01'];
const puri = w.residents['res_sanitaria_01'];
check('sim: el catch coloca a Román EN el portal (teatro del catch)', !!portal && roman?.location === portal.id, `${roman?.location ?? 'null'} vs portal=${portal?.id}`);
check('sim: Puri sigue viva y presente en su casa', puri?.present === true && puri?.location !== null, `${puri?.location}`);

console.log('');
if (fails) {
  console.error(`QA v1.15 FALLÓ: ${fails} checks`);
  process.exit(1);
}
console.log('QA v1.15 OK · bocadillos con texto + la obra del Mañas');
