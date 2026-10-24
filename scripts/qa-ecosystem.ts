/**
 * QA v1.14 — "El edificio está vivo": ecosistema data-driven.
 * Verifica contra el contenido y el sim REALES (sin Babylon, patrón qa-v13):
 *  1. Catálogo: ecosystem.json válido (Zod) con los 5 kinds de evento declarados.
 *  2. Vendedor: una rama ponderada POR PUERTA con efectos aplicados al mundo (fondos/params/
 *     misión arrancada) y su staging para la capa visual.
 *  3. Mascota: m_mascota_perdida arranca, apunta a un bloque EXISTENTE del mundo y es
 *     COMPLETABLE (moves legales del grafo hasta el pasillo p4 → elección aplicada).
 *  4. Apagón: lighting a 0, duración dentro del rango del catálogo y restauración al valor
 *     de catálogo (comprobada en cada llamada del cerebro, no solo a cadencia).
 *  5. Deriva: deltas nocturnos dentro de los rangos del catálogo y como mucho una rama.
 *  6. Determinismo: misma semilla + mismos ticks → mismo report y mismas consecuencias.
 *  7. Misiones nuevas: schema Zod, referencias (bloques, arquetipos, encadenadas) y
 *     teatro del unlock del crío (sim) para su catch_in_act en el portal.
 *  8. Pureza del cerebro: jamás toca el RNG del sim (hash01 propio).
 *
 * Palancas de QA documentadas: world.clock.minute (ventanas), world.tick (cadencia),
 * state.lastEvalTick (forzar evaluación) y eco.events filtrado por test (para aislar el
 * evento bajo prueba sin tocar el sim ni el código).
 */
import { readFileSync } from 'node:fs';
import { loadContent, formatIssues } from '@/game/content';
import { ecosystemContentSchema, missionDefSchema } from '@/game/content/schemas';
import { advanceMissions, createWorld, dispatch, nextStepTowards, resolveBlocks } from '@/game/sim';
import { createEcosystemState, evaluateEcosystem, type EcosystemReport, type EcosystemState } from '@/game/ecosystem';

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

const eco = content.ecosystem;
check('ecosystem.json cargado y versionado', !!eco && eco.schemaVersion === 1);
try {
  ecosystemContentSchema.parse(JSON.parse(readFileSync(new URL('../public/content/ecosystem.json', import.meta.url), 'utf8')));
  check('ecosystem.json pasa su schema Zod', true);
} catch (e) {
  check('ecosystem.json pasa su schema Zod', false, e instanceof Error ? e.message.slice(0, 90) : '');
}
const kinds = new Set((eco?.events ?? []).map((e) => e.kind));
check('catálogo con los 5 kinds (vendor/prank/pet/blackout/drift)', (['vendor', 'prank', 'pet', 'blackout', 'drift'] as const).every((k) => kinds.has(k)), eco?.events.map((e) => e.kind).join(', ') ?? '');
check('reglas de deterioro leen params REALES del catálogo', !!eco && eco.visuals.deterioration.every((r) => !!content.blocks[r.blockDef]?.params?.[r.param]), eco?.visuals.deterioration.map((r) => `${r.blockDef}.${r.param}`).join(' · ') ?? '');
check('luces: la autoridad es el param lighting del pasillo', !!eco && eco.lights.paramThreshold > 0 && content.blocks['pasillo_planta']?.params?.lighting !== undefined, `umbral ${eco?.lights.paramThreshold}`);

if (!eco) process.exit(1);

/** Aísla los eventos indicados durante la prueba (content es catálogo, no estado del sim). */
function withOnlyEvents<T>(ids: string[], fn: () => T): T {
  const backup = eco!.events;
  eco!.events = backup.filter((e) => ids.includes(e.id));
  try {
    return fn();
  } finally {
    eco!.events = backup;
  }
}

/** Evalúa forzando la cadencia (palanca QA documentada: state.lastEvalTick). */
function forceEval(w: ReturnType<typeof createWorld>, state: EcosystemState) {
  state.lastEvalTick = w.tick - eco!.scheduler.evalEveryTicks; // toca evaluar ya
  return evaluateEcosystem(w, content, state);
}

const evById = (id: string) => eco!.events.find((e) => e.id === id)!;
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

// ── 1. Vendedor: una rama ponderada POR PUERTA, efectos ya aplicados por el cerebro ──
{
  const w = createWorld(content, 'slice');
  w.clock.minute = 11 * 60; // 11:00: ventana del vendedor de semillas
  const state = createEcosystemState();
  const before = {
    funds: w.community.funds,
    clean: num(w.blocks['blk_p0_pasillo']!.params.cleanliness),
    missions: w.missions.length,
  };
  const rngBefore = w.rngState;
  const rep = withOnlyEvents(['ev_vendedor_semillas'], () => forceEval(w, state));
  check('cerebro: NO toca el RNG del sim (hash01 propio)', w.rngState === rngBefore);
  const stage = rep.staging.find((s) => s.kind === 'vendor');
  check('vendedor: evento disparado (kind vendor)', rep.fired.some((f) => f.kind === 'vendor' && f.phase === 'fire'));
  check(
    'vendedor: staging con pasillo, escalera y puertas reales del mundo',
    !!stage && stage.kind === 'vendor' && !!w.blocks[stage.corridorBlock] && !!w.blocks[stage.stairsBlock] && stage.doors.length >= 1 && stage.doors.every((id) => !!w.blocks[id]),
    stage?.kind === 'vendor' ? `planta ${stage.floor} · ${stage.doors.join(' + ')}` : 'sin staging',
  );
  if (stage?.kind === 'vendor') {
    check('vendedor: una rama por puerta (impredecible per-knock)', stage.knocks.length === stage.doors.length, stage.knocks.join(' / '));
    const dFunds = w.community.funds - before.funds;
    const dClean = num(w.blocks['blk_p0_pasillo']!.params.cleanliness) - before.clean;
    const dMissions = w.missions.length - before.missions;
    check('vendedor: "venta" suma 15 € a la comunidad por puerta vendida', dFunds === 15 * stage.knocks.filter((k) => k === 'venta').length, `Δfunds=${dFunds}`);
    check('vendedor: "folletos" ensucia el pasillo −6 por puerta', dClean === -6 * stage.knocks.filter((k) => k === 'folletos').length, `Δcleanliness=${dClean}`);
    check('vendedor: "encargo" arranca m_pedido_vecinal', stage.knocks.includes('encargo') ? dMissions >= 1 : dMissions === 0, `Δmissions=${dMissions}`);
    const toasts = w.events.filter((e) => e.type === 'ui_toast').length;
    check('vendedor: cada puerta lanza su aviso vecinal', toasts >= stage.knocks.length, `${toasts} toasts`);
    check('vendedor: cooldown registrado en el estado', (state.cooldowns['ev_vendedor_semillas'] ?? 0) === w.tick + 900);
  }
}

// ── 2. Mascota: misión arrancada, bloque existente y completable de verdad ──
{
  const w = createWorld(content, 'slice');
  w.clock.minute = 10 * 60;
  const state = createEcosystemState();
  const rep = withOnlyEvents(['ev_mascota_escapada'], () => forceEval(w, state));
  check('mascota: evento disparado y misión pendiente', rep.fired.some((f) => f.kind === 'pet') && !!w.missions.find((m) => m.id === 'm_mascota_perdida'));
  advanceMissions(w, content); // el siguiente tick del sim la activa
  const m = w.missions.find((x) => x.id === 'm_mascota_perdida');
  check('mascota: misión activa con dueña (jubilada) atada por roles', m?.state === 'active' && !!m?.roles.owner, `${m?.state ?? 'ausente'} · owner=${m?.roles.owner ?? '—'}`);
  const step = content.missions['m_mascota_perdida']!.steps[0]!;
  const ref = step.type === 'enter' ? step.target : step.type === 'reach' ? step.target.block : null;
  const block = ref ? w.blocks[ref] : undefined;
  check('mascota: el paso apunta a un bloque EXISTENTE del mundo (pasillo p4)', !!block && block!.layer === 'corridor' && block!.cell.floor === 4, ref ?? '—');
  // Completable: el jugador camina por el grafo de circulación (moves legales 1 a 1) hasta el pasillo.
  let hops = 0;
  let loc = w.residents[w.playerId]!.location;
  while (loc && loc !== 'blk_p4_pasillo' && hops < 30) {
    const next = nextStepTowards(w, content, loc, 'blk_p4_pasillo');
    if (!next) break;
    const res = dispatch(w, content, { type: 'move', resident: w.playerId, to: next });
    if (!res.ok) break;
    loc = next;
    hops += 1;
  }
  check('mascota: llegar al pasillo p4 pide la elección (completable en partida)', m?.state === 'awaiting_choice', `${m?.state ?? '—'} en ${hops} tramos`);
  const cleanBefore = num(w.blocks['blk_p0_pasillo']!.params.cleanliness);
  const chosen = dispatch(w, content, { type: 'choose', mission: 'm_mascota_perdida', choice: 'dejarla' });
  check('mascota: elección "dejarla" aplica el setParam del pasillo (−5)', chosen.ok && num(w.blocks['blk_p0_pasillo']!.params.cleanliness) === cleanBefore - 5);
  check('mascota: misión cerrada (la visual despide a la mascota)', m?.state === 'done');
}

// ── 3. Apagón: lighting a 0 con rango del catálogo y restauración garantizada ──
{
  const w = createWorld(content, 'slice');
  w.clock.minute = 23 * 60 + 30; // 23:30: ventana del apagón
  const state = createEcosystemState();
  const ev = evById('ev_apagon_nocturno');
  const chanceBackup = ev.chance;
  ev.chance = 1; // palanca QA: la probabilidad por evaluación se fuerza a 1
  const rep = withOnlyEvents(['ev_apagon_nocturno'], () => forceEval(w, state));
  ev.chance = chanceBackup;
  check('apagón: evento disparado de noche', rep.fired.some((f) => f.kind === 'blackout' && f.phase === 'fire'));
  check('apagón: lighting del pasillo a 0 (autoridad del sim)', num(w.blocks['blk_p0_pasillo']!.params.lighting) === 0, `lighting=${w.blocks['blk_p0_pasillo']!.params.lighting}`);
  const dur = (state.blackoutUntilTick ?? 0) - w.tick;
  check('apagón: duración sorteada dentro del rango del catálogo', dur >= 150 && dur <= 300, `${dur} min`);
  // La expiración se comprueba en CADA llamada del cerebro, aunque la cadencia no toque.
  w.tick = state.blackoutUntilTick! + 1;
  state.lastEvalTick = w.tick; // cadencia "no toca" y aun así restaura
  const rep2 = evaluateEcosystem(w, content, state);
  check('apagón: la restauración llega por el report (phase restore)', rep2.fired.some((f) => f.kind === 'blackout' && f.phase === 'restore'));
  check('apagón: la luz vuelve al valor del catálogo (restoreTo 90)', num(w.blocks['blk_p0_pasillo']!.params.lighting) === 90, `lighting=${w.blocks['blk_p0_pasillo']!.params.lighting}`);
  check('apagón: estado del cerebro limpio tras restaurar', state.blackoutUntilTick === null && state.blackoutEventId === null);
}

// ── 4. Deriva nocturna: deltas dentro de los rangos del catálogo ──
{
  const w = createWorld(content, 'slice');
  w.clock.minute = 2 * 60; // 02:00, con lluvia
  w.weather.state = 'rain';
  const state = createEcosystemState();
  const snap = () => ({
    humidity: num(w.blocks['blk_p3_c']!.params.humidity),
    clean: num(w.blocks['blk_p0_pasillo']!.params.cleanliness),
    stairs: num(w.blocks['blk_p0_escalera']!.params.condition),
  });
  const before = snap();
  const rep = withOnlyEvents(['ev_deterioro_nocturno'], () => forceEval(w, state));
  check('deriva: evento nocturno disparado con lluvia', rep.fired.some((f) => f.kind === 'drift'));
  const one = snap();
  const dh = one.humidity - before.humidity;
  const dc = one.clean - before.clean;
  const ds = one.stairs - before.stairs;
  const moved = (['humedad', 'suciedad', 'escaleras'] as const).filter((_, i) => [dh, dc, ds][i] !== 0);
  check('deriva: como mucho UNA rama de destrozo por evaluación', moved.length <= 1, moved.join('+') || 'noche tranquila');
  check('deriva: deltas exactamente los del catálogo (o 0)', (dh === 0 || dh === 6) && (dc === 0 || dc === -4) && (ds === 0 || ds === -3), `dh=${dh} dc=${dc} ds=${ds}`);
  // Evaluaciones encadenadas (cooldown reseteado): el sorteo caerá en ramas de destrozo;
  // cada rama aporta EXACTAMENTE el delta de su rama del catálogo, nunca otra cosa.
  let total = { h: 0, c: 0, s: 0 };
  for (let i = 0; i < 12; i++) {
    const s0 = snap();
    state.cooldowns['ev_deterioro_nocturno'] = 0; // palanca QA: sin cooldown entre evaluaciones
    withOnlyEvents(['ev_deterioro_nocturno'], () => forceEval(w, state));
    total = {
      h: total.h + (snap().humidity - s0.humidity),
      c: total.c + (snap().clean - s0.clean),
      s: total.s + (snap().stairs - s0.stairs),
    };
  }
  check(
    'deriva: 12 evaluaciones acumulan SOLO múltiplos exactos del catálogo',
    total.h % 6 === 0 && total.h >= 0 && total.c % 4 === 0 && total.c <= 0 && total.s % 3 === 0 && total.s <= 0,
    `Δhumedad=${total.h} Δlimpieza=${total.c} Δescalera=${total.s}`,
  );
}

// ── 5. Determinismo: misma semilla + mismos ticks → mismo report y mismas consecuencias ──
{
  const schedule = [660, 1020, 1110, 1430, 30, 120, 660, 17 * 60 + 45, 16 * 60 + 30, 610, 900, 1380];
  const run = () => {
    const w = createWorld(content, 'slice');
    const state = createEcosystemState();
    const reports: EcosystemReport[] = [];
    for (const minute of schedule) {
      w.tick += 8; // cadencia: toca evaluar en cada paso
      w.clock.minute = minute;
      reports.push(evaluateEcosystem(w, content, state));
    }
    return {
      reports: JSON.stringify(reports),
      funds: w.community.funds,
      lighting: num(w.blocks['blk_p0_pasillo']!.params.lighting),
      clean: num(w.blocks['blk_p0_pasillo']!.params.cleanliness),
      missions: w.missions.map((m) => m.id).sort().join(','),
    };
  };
  const a = run();
  const b = run();
  check('determinismo: misma semilla+ticks → mismo report (12 evaluaciones)', a.reports === b.reports);
  check('determinismo: mismas consecuencias (fondos, luz, limpieza, misiones)', a.funds === b.funds && a.lighting === b.lighting && a.clean === b.clean && a.missions === b.missions, `${a.funds} € · luz ${a.lighting} · limpieza ${a.clean}`);
}

// ── 6. Misiones nuevas: schema, referencias y teatro del unlock del crío ──
{
  const w = createWorld(content, 'slice');
  const newIds = ['m_mascota_perdida', 'm_trastada_portal', 'm_pedido_vecinal'];
  for (const id of newIds) {
    const def = content.missions[id];
    let okSchema = false;
    try {
      missionDefSchema.parse(def);
      okSchema = true;
    } catch {
      okSchema = false;
    }
    check(`${id}: declarada y válida contra el schema Zod`, !!def && okSchema);
    check(`${id}: sin trigger automático (la arranca el ecosistema)`, !!def && def.trigger === undefined);
    for (const s of def?.steps ?? []) {
      if (s.type === 'reach' || s.type === 'enter') {
        const ref = s.type === 'reach' ? s.target.block : s.target;
        check(`${id}: el paso "${s.id}" apunta a bloque existente (${ref})`, !!w.blocks[ref] || resolveBlocks(w, content, ref).length > 0);
      }
      if (s.type === 'catch_in_act') check(`${id}: place "${s.place}" resuelve a bloques del mundo`, resolveBlocks(w, content, s.place.split('.')[0]!).length > 0);
      if (s.type === 'phone_call') check(`${id}: diálogo ${s.dialog} cargado`, !!content.dialogs[s.dialog]);
    }
    for (const [role, r] of Object.entries(def?.roles ?? {})) {
      if (r.archetype) check(`${id}: rol ${role} → arquetipo ${r.archetype} existe`, !!content.archetypes[r.archetype]);
    }
    for (const c of def?.choices ?? [])
      for (const e of c.effects) {
        if (e.op === 'startMission') check(`${id}: misión encadenada ${e.id} existe`, !!content.missions[e.id]);
        if (e.op === 'unlock' && e.resident) {
          const exists = Object.values(content.scenarios).some((sc) => sc.residents.some((r) => r.id === e.resident));
          check(`${id}: residente del unlock existe (${e.resident})`, exists);
        }
      }
  }

  // Trastada: el unlock del sim trae al crío y el catch_in_act lo planta en el portal.
  const w2 = createWorld(content, 'slice');
  w2.clock.minute = 17 * 60;
  const state2 = createEcosystemState();
  const rep = withOnlyEvents(['ev_trastada_nino'], () => forceEval(w2, state2));
  const kid = w2.residents['res_nino_01']!;
  check('trastada: el unlock (op del sim) deja al crío presente', kid.present && rep.fired.some((f) => f.kind === 'prank'), `location=${kid.location ?? '—'}`);
  advanceMissions(w2, content);
  const mt = w2.missions.find((m) => m.id === 'm_trastada_portal');
  check('trastada: catch_in_act activo y el sim coloca al crío en el portal', mt?.state === 'active' && kid.location === 'blk_p0_portal', `${mt?.state ?? 'ausente'} · ${kid.location ?? '—'}`);
}

// ── 7. Deriva positiva: mejorilla comunitaria con fondos y ánimo altos ──
{
  const w = createWorld(content, 'slice');
  w.clock.minute = 12 * 60;
  w.community.funds = 500; // por encima del umbral fundsAbove 250
  const state = createEcosystemState();
  const before = {
    stairs: num(w.blocks['blk_p0_escalera']!.params.condition),
    clean: num(w.blocks['blk_p0_pasillo']!.params.cleanliness),
  };
  const rep = withOnlyEvents(['ev_vecinos_organizados'], () => forceEval(w, state));
  check('mejorilla: drift positivo disparado con fondos y ánimo altos', rep.fired.some((f) => f.kind === 'drift'));
  const ds = num(w.blocks['blk_p0_escalera']!.params.condition) - before.stairs;
  const dc = num(w.blocks['blk_p0_pasillo']!.params.cleanliness) - before.clean;
  check('mejorilla: solo sube (+6 escalera / +8 limpieza) o no pasa nada', (ds === 0 || ds === 6) && (dc === 0 || dc === 8), `ds=${ds} dc=${dc}`);
  check('mejorilla: las dos mejoras van juntas (una sola rama)', (ds === 0 && dc === 0) || (ds === 6 && dc === 8), `ds=${ds} dc=${dc}`);
}

console.log(fails === 0 ? '\nQA ecosistema OK · el edificio está vivo' : `\nQA ecosistema FALLÓ: ${fails} checks`);
process.exit(fails === 0 ? 0 : 1);
