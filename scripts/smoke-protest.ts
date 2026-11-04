/**
 * Prueba de humo v1.80 — PROTESTA POR APAGÓN (idea #3 del backlog FASE T):
 * 1) arm: el param `lighting` del pasillo por debajo del umbral (apagón del ecosistema)
 *    → world.protest armada + evento protest_armed; con luz normal no se arma.
 * 2) recluta: gracia delayMinutes con todos dormidos (reintentos sin candidato) y,
 *    forzado un vecino despierto (fixture), recluta al más cercano a la planta presidencial.
 * 3) marcha + timbrazos: teleport al pasillo del presidente (evento resident_moved) y
 *    protest_ring a ritmo ringIntervalMinutes.
 * 4) answer_door: fail('not_president') con actor equivocado; ok con el presidente →
 *    protest_calmed + deltas de afinidad/confianza + world.protest a null.
 * 5) rendición: rings > maxRings → protest_ended 'tired' + afinidad negativa.
 * 6) desarme al restaurar la luz: protest_ended 'power' y world.protest null.
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, dispatch, drainEvents, tick } from '@/game/sim';
import { protestTick } from '@/game/sim/extra/protest';
import type { World } from '@/game/core/types';

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FALLO:', msg);
    process.exit(1);
  }
  console.log('OK ·', msg);
}

const cfg = content.rules.sim.protest;
const PRESIDENT = 'res_presidente_01';
const MUSICO = 'res_musico_01';

/** Fixture: pasillo a oscuras (el apagón del ecosistema deja lighting = 0). */
function darkCorridors(w: World): void {
  for (const b of Object.values(w.blocks)) {
    if (b.defId === cfg.watchDef && typeof b.params[cfg.watchParam] === 'number') b.params[cfg.watchParam] = 0;
  }
}

/** Fixture: luz restaurada (restoreTo del catálogo del apagón). */
function litCorridors(w: World): void {
  for (const b of Object.values(w.blocks)) {
    if (b.defId === cfg.watchDef && typeof b.params[cfg.watchParam] === 'number') b.params[cfg.watchParam] = 90;
  }
}

/** Avanza n ticks de protesta a mano (sin IA: recluta/teleport/timbrazos deterministas). */
function step(w: World, n: number): void {
  for (let i = 0; i < n; i++) {
    w.tick += 1;
    protestTick(w, content);
  }
}

/** Fixture: todo el vecindario IA durmiendo (de noche no hay nadie despierto). */
function allAsleep(w: World): void {
  for (const r of Object.values(w.residents)) {
    if (r.controller.type === 'human') continue;
    r.present = true;
    r.location = r.home;
    r.activity = 'sleep';
    r.cooldowns['hop'] = 1_000_000;
  }
}

/** Fixture: arma la protesta y recluta/marcha al músico (despierto, misma planta que el presidente).
 *  Con delayMinutes ≥ recruitEveryMinutes el primer intento cae exactamente al cumplirse la gracia. */
function armAndRecruit(w: World): void {
  darkCorridors(w);
  tick(w, content); // arma
  drainEvents(w);
  allAsleep(w);
  w.residents[MUSICO]!.present = true;
  w.residents[MUSICO]!.location = w.entry;
  w.residents[MUSICO]!.activity = 'laundry';
  step(w, cfg.delayMinutes); // gracia cumplida → recluta + marcha en el último paso
}

// ══════════════ 1) arm — detección del apagón ══════════════
{
  const w = createWorld(content, content.rules.startScenario);
  tick(w, content); // luz normal: un tick NO arma nada
  assert(w.protest === null, 'con luz normal un tick no arma la protesta');
  assert(drainEvents(w).every((e) => e.type !== 'protest_armed'), 'sin apagón no hay protest_armed');

  darkCorridors(w);
  tick(w, content);
  assert(w.protest !== null, 'con el param por debajo del umbral la protesta se arma');
  assert(w.protest!.presidentId === PRESIDENT, 'la protesta apunta a la presidencia de la comunidad');
  assert(w.protest!.protester === null && w.protest!.phase === 'marching' && w.protest!.rings === 0, 'armada: sin protestante, fase marching, cero timbres');
  assert(!!drainEvents(w).find((e) => e.type === 'protest_armed'), 'protest_armed emitido (log-only en el cliente)');

  // Recolocar la luz desarma sin teatro (aún no hay protestante ni timbres).
  litCorridors(w);
  step(w, 1);
  assert(w.protest === null, 'con la luz restaurada la protesta armada se disuelve en silencio');
  assert(drainEvents(w).every((e) => e.type !== 'protest_ended'), 'sin protestante ni timbres no hay protest_ended');
}

// ══════════════ 2) recluta — gracia, reintentos y vecino despierto ══════════════
{
  const w = createWorld(content, content.rules.startScenario);
  darkCorridors(w);
  tick(w, content); // arma
  drainEvents(w);
  allAsleep(w);
  step(w, cfg.delayMinutes); // la gracia pasa: nadie despierto → sin protestante
  assert(w.protest!.protester === null, 'con delayMinutes cumplido pero todos dormidos no hay protestante');
  step(w, cfg.recruitEveryMinutes); // reintento: sigue sin nadie
  assert(w.protest!.protester === null, 'el reintento de recluta sin despiertos no recluta a nadie');

  // Fixture: un vecino despierto (lavadora de madrugada). El músico vive en la MISMA
  // planta que el presidente: distancia 0 → primer candidato determinista.
  const musico = w.residents[MUSICO]!;
  musico.present = true;
  musico.location = w.entry;
  musico.activity = 'laundry';
  step(w, cfg.recruitEveryMinutes);
  assert(w.protest!.protester === MUSICO, `el despierto más cercano a la planta presidencial es reclutado (${w.protest!.protester})`);
  assert(!!drainEvents(w).find((e) => e.type === 'protest_recruited'), 'protest_recruited emitido');
}

// ══════════════ 3) marcha + timbrazos ══════════════
{
  const w = createWorld(content, content.rules.startScenario);
  armAndRecruit(w);
  assert(w.protest!.protester === MUSICO, `el despierto más cercano a la planta presidencial es reclutado (${w.protest!.protester})`);
  const presFloor = w.blocks[w.residents[PRESIDENT]!.home]!.cell.floor;
  const corridor = Object.values(w.blocks).find((b) => b.layer === 'corridor' && b.cell.floor === presFloor)!.id;
  assert(w.protest!.phase === 'ringing' && w.residents[MUSICO]!.location === corridor, `el protestante aparece en el pasillo del presidente (${corridor})`);
  assert(!!drainEvents(w).find((e) => e.type === 'resident_moved'), 'resident_moved emitido (el cliente anima el paseo)');

  step(w, cfg.ringIntervalMinutes);
  let ev = drainEvents(w).find((e) => e.type === 'protest_ring');
  assert(!!ev && (ev!.data as Record<string, unknown>).ring === 1 && (ev!.data as Record<string, unknown>).block === corridor, 'primer timbrazo a ringIntervalMinutes (protest_ring ring=1)');
  step(w, cfg.ringIntervalMinutes * 2);
  const rings = drainEvents(w).filter((e) => e.type === 'protest_ring');
  assert(rings.length === 2 && (rings[1]!.data as Record<string, unknown>).ring === 3, 'los timbrazos escalan al ritmo del catálogo (ring=2 y ring=3)');
  assert(w.protest !== null, 'sin abrir la puerta la protesta sigue en pie');
}

// ══════════════ 4) answer_door — por la VÍA ÚNICA de comandos ══════════════
{
  const w = createWorld(content, content.rules.startScenario);
  armAndRecruit(w);
  drainEvents(w);
  const relBefore = w.residents[MUSICO]!.relations.find((x) => x.with === PRESIDENT);

  const rWrong = dispatch(w, content, { type: 'answer_door', actor: MUSICO }); // el protestante no puede "autoabrirse"
  assert(!rWrong.ok && rWrong.reason === 'not_president', `abrir sin ser presidente falla limpio (${rWrong.reason})`);

  // Sin protesta activa no hay nada que abrir (mundo nuevo: fail limpio).
  const w2 = createWorld(content, content.rules.startScenario);
  const rNone = dispatch(w2, content, { type: 'answer_door' });
  assert(!rNone.ok && rNone.reason === 'no_protest', `answer_door sin protesta falla limpio (${rNone.reason})`);

  const rOk = dispatch(w, content, { type: 'answer_door', actor: PRESIDENT });
  assert(rOk.ok, 'el presidente abre: answer_door resuelve ok');
  const ev = drainEvents(w).find((e) => e.type === 'protest_calmed');
  assert(!!ev && (ev!.data as Record<string, unknown>).resident === MUSICO, 'protest_calmed emitido con el protestante');
  const line = (ev!.data as Record<string, unknown>).line as { es: string } | null;
  assert(!!line && typeof line.es === 'string' && line.es.length > 0, 'protest_calmed trae la línea de calma del catálogo');
  assert(w.protest === null, 'abrir disuelve world.protest');
  const relAfter = w.residents[MUSICO]!.relations.find((x) => x.with === PRESIDENT)!;
  assert(relAfter.affinity === (relBefore?.affinity ?? 0) + cfg.calmAffinity, `afinidad protestante→presidente +calmAffinity (${relAfter.affinity})`);
  assert(relAfter.trust === (relBefore?.trust ?? 0) + cfg.calmTrust, `confianza protestante→presidente +calmTrust (${relAfter.trust})`);
}

// ══════════════ 5) rendición — maxRings agotados ══════════════
{
  const w = createWorld(content, content.rules.startScenario);
  armAndRecruit(w);
  drainEvents(w);
  step(w, cfg.ringIntervalMinutes * (cfg.maxRings + 1)); // los timbres del límite + el que lo rebasa
  const evs = drainEvents(w); // los timbrazos y la rendición llegan en el mismo lote
  const rings = evs.filter((e) => e.type === 'protest_ring');
  assert(rings.length === cfg.maxRings, `exactamente maxRings timbrazos antes de rendirse (${rings.length})`);
  const ended = evs.find((e) => e.type === 'protest_ended');
  assert(!!ended && (ended!.data as Record<string, unknown>).reason === 'tired', 'al rebasar maxRings la protesta termina por cansancio');
  assert(!!((ended!.data as Record<string, unknown>).line as { es: string } | null)?.es, 'protest_ended tired trae la línea del catálogo');
  assert(w.protest === null, 'la rendición disuelve world.protest');
  const rel = w.residents[MUSICO]!.relations.find((x) => x.with === PRESIDENT)!;
  assert(rel.affinity === cfg.tiredAffinity, `la rendición castiga la afinidad protestante→presidente (${rel.affinity})`);
}

// ══════════════ 6) desarme al restaurar — con protestante ══════════════
{
  const w = createWorld(content, content.rules.startScenario);
  armAndRecruit(w);
  drainEvents(w);
  litCorridors(w); // la luz vuelve (rearme del fusibles o restore del cerebro)
  step(w, 1);
  const ended = drainEvents(w).find((e) => e.type === 'protest_ended');
  assert(!!ended && (ended!.data as Record<string, unknown>).reason === 'power' && (ended!.data as Record<string, unknown>).resident === MUSICO, 'al volver la luz la protesta se disuelve con protest_ended power');
  assert(w.protest === null, 'el desarme por electricidad deja world.protest null');
}

console.log('SMOKE PROTEST OK');
