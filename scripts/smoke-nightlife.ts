/**
 * Prueba de humo v1.81 — LOTE FINAL DE FASE T (ideas #4, #5 y #6):
 *
 * TEJADO (extra/roof.ts): con tormenta y damageChancePerTick=1 un tick daña el tejado
 *   (roof_damage=1 + roof_damaged); el goteo sube la humedad SOLO de las viviendas de la
 *   planta residencial más alta (roof_leak cada leakEveryTicks, marcador en el tejado) y
 *   repair_roof falla sin daño ('no_damage') y sin hucha ('poor'); con hucha: tejado a 0,
 *   arcas +coste y afinidad de los áticos IA con el reparador.
 * BORRACHO (extra/ai.ts): un IA que entra de noche con chance=1 vuelve EBrio (drunk_started
 *   con línea); con staggerChance=1 tambalea (drunk_stumble) sin acercarse monótonamente;
 *   forzando su llegada a casa: dos faroleos (drunk_fumble) y al tercero entra (drunk_home)
 *   con la juerga limpiada (drunk a 0, drunkDone a futuro).
 * JUEGO ILEGAL (extra/gamble.ts): el anfitrión (fondo_buitre) abre mesa dentro de la
 *   ventana con chancePerNight=1 (gamble_night + invitados teleportados y sentados con hop
 *   hasta el cierre); la redada (raidChancePerTick=1) multa al anfitrión, ingreso parcial
 *   en arcas, invitados a casa y veto de cooldownDays; el cierre natural emite gamble_over
 *   UNA sola vez.
 * DETERMINISMO: la secuencia del borracho, repetida en dos mundos gemelos (misma semilla),
 *   produce DOS flujos de eventos idénticos (comparación JSON).
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, dispatch, drainEvents, tick } from '@/game/sim';
import { roofTick } from '@/game/sim/extra/roof';
import { gambleTick } from '@/game/sim/extra/gamble';
import type { GameEvent, World } from '@/game/core/types';

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

const roofCfg = content.rules.sim.roof;
const drunkCfg = content.rules.sim.drunk;
const gambleCfg = content.rules.sim.gamble;
const PLAYER = 'res_player_01';
const MUSICO = 'res_musico_01'; // presente en el slice, vivienda blk_p1_c
const BUITRE = 'res_buitre_01'; // fondo_buitre, vivienda blk_p3_b (ausente de origen)

/** Fixture: tormenta sujeta (el clima no cambia: nextChangeMinute lejísimos). */
function storm(w: World): void {
  w.weather.state = 'storm';
  w.weather.nextChangeMinute = 1e9;
}

/** Avanza n ticks SOLO del módulo bajo prueba (aislamiento, patrón smoke-protest). */
function stepRoof(w: World, n: number): void {
  for (let i = 0; i < n; i++) {
    w.tick += 1;
    roofTick(w, content);
  }
}
function stepGamble(w: World, n: number): void {
  for (let i = 0; i < n; i++) {
    w.tick += 1;
    gambleTick(w, content);
  }
}

/** Vivienda (ático) de la planta residencial más alta, ordenadas por id. */
function attics(w: World): string[] {
  let top = 0;
  for (const b of Object.values(w.blocks)) if (b.kind === 'dwelling' && b.cell.floor > top) top = b.cell.floor;
  return Object.values(w.blocks).filter((b) => b.kind === 'dwelling' && b.cell.floor === top).map((b) => b.id).sort();
}

// ══════════════ 1) TEJADO: daño, goteo y reparación ══════════════
{
  const w = createWorld(content, content.rules.startScenario);

  // Sin tormenta ni con chance=1: el tejado ni se entera.
  content.rules.sim.roof.damageChancePerTick = 1; // fixture de test: el daño es seguro
  stepRoof(w, 3);
  assert(Object.values(w.blocks).every((b) => b.params.roof_damage !== 1), 'sin tormenta, chance=1 no daña el tejado');
  assert(drainEvents(w).every((e) => e.type !== 'roof_damaged'), 'sin tormenta no hay roof_damaged');

  // Con tormenta: el primer tick de tirada revienta el tejado (primer bloque por id).
  storm(w);
  stepRoof(w, 1);
  const roof = Object.values(w.blocks).find((b) => b.defId === roofCfg.roofDef)!;
  assert(roof.params.roof_damage === 1, 'con tormenta y chance=1 el tejado queda dañado (roof_damage=1)');
  const dmg = drainEvents(w).find((e) => e.type === 'roof_damaged');
  assert(!!dmg && (dmg!.data as Record<string, unknown>).block === roof.id, 'roof_damaged emitido con el bloque del tejado');

  // El goteo: el tick siguiente ya moja (marcador a -9999) y SOLO los áticos suben humedad.
  const att = attics(w);
  const before = Object.fromEntries(att.map((id) => [id, w.blocks[id]!.params.humidity]));
  stepRoof(w, 1);
  let leak = drainEvents(w).find((e) => e.type === 'roof_leak');
  assert(!!leak, 'roof_leak emitido en el primer tick con el tejado dañado');
  const leaked = leak!.data as Record<string, unknown>;
  assert(att.includes(String(leaked.block)) && leaked.roof === roof.id, 'el goteo cae en un ático y cita el tejado');
  assert(w.blocks[String(leaked.block)]!.params.humidity === (before[String(leaked.block)] as number) + roofCfg.humidityPerLeak, `la humedad del ático sube +${roofCfg.humidityPerLeak} (now ${leaked.humidity})`);
  assert(roof.params.roof_last_leak === w.tick, 'el marcador roof_last_leak queda en el tejado');

  // Ritmo: ni un goteo antes de leakEveryTicks; justo al cumplirse, otro (y el tope del catálogo manda).
  stepRoof(w, roofCfg.leakEveryTicks - 1);
  assert(drainEvents(w).every((e) => e.type !== 'roof_leak'), 'entre goteos el pasillo se seca (sin roof_leak)');
  stepRoof(w, 1);
  leak = drainEvents(w).find((e) => e.type === 'roof_leak');
  assert(!!leak && (leak!.data as Record<string, unknown>).humidity === (before[String((leak!.data as Record<string, unknown>).block)] as number) + 2 * roofCfg.humidityPerLeak, 'el segundo goteo sube otros humidityPerLeak');
  const lowFloors = Object.values(w.blocks).filter((b) => b.kind === 'dwelling' && !att.includes(b.id));
  assert(lowFloors.every((b) => b.params.humidity === content.blocks[b.defId]!.params!.humidity!.default), 'las plantas bajas no reciben ni una gota');

  // Reparación SIN daño: fail limpio (mundo nuevo, tejado intacto).
  const w2 = createWorld(content, content.rules.startScenario);
  const rNone = dispatch(w2, content, { type: 'repair_roof' });
  assert(!rNone.ok && rNone.reason === 'no_damage', `repair_roof sin daño falla 'no_damage' (${rNone.reason})`);

  // Sin hucha: fail 'poor' (y no toca nada).
  storm(w);
  w.residents[PLAYER]!.wallet = 0;
  const rPoor = dispatch(w, content, { type: 'repair_roof' });
  assert(!rPoor.ok && rPoor.reason === 'poor', `repair_roof sin hucha falla 'poor' (${rPoor.reason})`);
  assert(roof.params.roof_damage === 1 && w.community.funds === 800, 'sin hucha el tejado sigue dañado y las arcas intactas');

  // Con hucha: paga, repara y los áticos IA lo agradecen (+affinityPerRepair cada uno).
  const fundsBefore = w.community.funds;
  const top = att.map((id) => w.blocks[id]!.cell.floor)[0]!;
  const atticAis = Object.values(w.residents).filter((r) => r.controller.type !== 'human' && w.blocks[r.home]!.cell.floor === top);
  const affBefore = atticAis.map((r) => r.relations.find((x) => x.with === PLAYER)?.affinity ?? 0);
  w.residents[PLAYER]!.wallet = roofCfg.repairCost;
  const rOk = dispatch(w, content, { type: 'repair_roof' });
  assert(rOk.ok, 'repair_roof con hucha resuelve ok');
  assert(roof.params.roof_damage === 0, 'la reparación deja roof_damage a 0');
  assert(w.residents[PLAYER]!.wallet === 0 && w.community.funds === fundsBefore + roofCfg.repairCost, `el coste pasa de la hucha a las arcas (+${roofCfg.repairCost})`);
  const rep = drainEvents(w).find((e) => e.type === 'roof_repaired');
  assert(!!rep && (rep!.data as Record<string, unknown>).actor === PLAYER && (rep!.data as Record<string, unknown>).cost === roofCfg.repairCost, 'roof_repaired emitido con actor y coste');
  const affAfter = atticAis.map((r) => r.relations.find((x) => x.with === PLAYER)?.affinity ?? 0);
  assert(affAfter.every((a, i) => a === affBefore[i]! + roofCfg.affinityPerRepair), `los ${atticAis.length} vecinos IA de la planta alta suman +${roofCfg.affinityPerRepair} de afinidad`);
}

// ══════════════ 2) BORRACHO: detección, tambaleo y faroleo ══════════════
{
  const w = createWorld(content, content.rules.startScenario);
  content.rules.sim.drunk.chance = 1; // fixture de test: la juerga es segura
  w.clock.minute = 0; // medianoche: dentro de la ventana nocturna 23:00→07:30

  // Sin la transición out→dentro no hay detección (está en casa, sobrio).
  tick(w, content);
  assert(drainEvents(w).every((e) => e.type !== 'drunk_started'), 'con el vecino en casa no hay drunk_started');

  // Lo mandamos fuera y lo dejamos volver: al cruzar el portal, EBrio.
  const musico = w.residents[MUSICO]!;
  musico.location = null;
  tick(w, content);
  assert(!!drainEvents(w).find((e) => e.type === 'drunk_started'), 'al entrar de noche con chance=1 llega borracho (drunk_started)');
  assert((musico.cooldowns['drunk'] ?? 0) > w.tick && musico.cooldowns['drunkTries'] === 0, 'cooldowns de juerga plantados (drunk a futuro, tries a 0)');

  // Tambaleo: staggerChance=1 → cada paso es un trompo; nunca se acerca monótonamente.
  content.rules.sim.drunk.staggerChance = 1;
  const home = w.blocks[musico.home]!;
  const distToHome = (id: string): number => {
    const b = w.blocks[id]!;
    return Math.abs(b.cell.floor - home.cell.floor) * 4 + Math.abs(b.cell.col - home.cell.col);
  };
  const distances: number[] = [];
  for (let i = 0; i < 10; i++) {
    const beforeId = musico.location;
    tick(w, content);
    if (musico.location !== beforeId && musico.location !== null) distances.push(distToHome(musico.location));
  }
  const evs = drainEvents(w);
  const stumbles = evs.filter((e) => e.type === 'drunk_stumble');
  assert(stumbles.length >= 1, `borrachera con drunk_stumble a ritmo lineEveryHops (${stumbles.length} trompos con línea)`);
  assert(!(distances.length > 1 && distances.every((d, i) => i === 0 || d < distances[i - 1]!)), `el camino NO es monótono hacia casa (${distances.join('→')})`);

  // Faroleo forzado: llegada a su puerta → 2 faroleos → al tercero, entra y limpia.
  drainEvents(w);
  musico.location = musico.home;
  musico.cooldowns['hop'] = 0;
  tick(w, content);
  let fumbles = drainEvents(w).filter((e) => e.type === 'drunk_fumble');
  assert(fumbles.length === 1 && musico.cooldowns['drunkTries'] === 1, 'primer faroleo (drunk_fumble, tries=1)');
  assert(!!((fumbles[0]!.data as Record<string, unknown>).line as { es: string } | null)?.es, 'el faroleo trae línea del catálogo');
  assert(musico.location !== musico.home, 'el faroleo lo aleja de la puerta (pasito de más)');
  musico.location = musico.home;
  musico.cooldowns['hop'] = 0;
  tick(w, content);
  fumbles = drainEvents(w).filter((e) => e.type === 'drunk_fumble');
  assert(fumbles.length === 1 && musico.cooldowns['drunkTries'] === 2, 'segundo faroleo (tries=2 = fumbleTries)');
  musico.location = musico.home;
  musico.cooldowns['hop'] = 0;
  tick(w, content);
  const homeEv = drainEvents(w).find((e) => e.type === 'drunk_home');
  assert(!!homeEv, 'al agotar los faroleos entra (drunk_home)');
  assert(!!((homeEv!.data as Record<string, unknown>).line as { es: string } | null)?.es, 'drunk_home trae línea del catálogo');
  assert(musico.cooldowns['drunk'] === 0 && musico.cooldowns['drunkDone'] > w.tick && musico.cooldowns['drunkTries'] === 0, 'juerga limpiada y ~2 días de resaca (drunkDone a futuro)');
}

// ══════════════ 3) JUEGO ILEGAL: mesa, redada y cierre natural ══════════════
{
  const w = createWorld(content, content.rules.startScenario);
  const buitre = w.residents[BUITRE]!;
  buitre.present = true; // fixture: el anfitrión llega a vivir al bloque
  content.rules.sim.gamble.chancePerNight = 1; // fixture de test: la mesa es segura
  content.rules.sim.gamble.raidChancePerTick = 0;

  // Sin anfitrión (present=false) no hay mesa: mundo nuevo, tick suelto.
  const w0 = createWorld(content, content.rules.startScenario);
  stepGamble(w0, 1);
  assert(drainEvents(w0).every((e) => e.type !== 'gamble_night'), 'sin anfitrión presente no hay partida');

  // Ventana cerrada (mediodía) con chance=1: nada.
  buitre.cooldowns['gambleDay'] = -1;
  w.clock.minute = 720; // 12:00, fuera de 22:00→03:00
  stepGamble(w, 1);
  assert(drainEvents(w).every((e) => e.type !== 'gamble_night'), 'fuera de la ventana no se abre mesa');

  // Dentro de la ventana: abre mesa y trae a los invitados (despiertos, IA, presentes).
  w.clock.minute = 1350; // 22:30
  const awake = ['res_presidente_01', 'res_okupa_01', 'res_musico_01', 'res_electricista_01', 'res_sanitaria_01'];
  for (const id of awake) {
    const r = w.residents[id]!;
    r.present = true;
    r.location = r.home;
    r.activity = null;
    r.cooldowns['hop'] = 0;
  }
  stepGamble(w, 1);
  const nightEvs = drainEvents(w);
  const night = nightEvs.find((e) => e.type === 'gamble_night');
  assert(!!night && (night!.data as Record<string, unknown>).host === BUITRE, 'gamble_night emitido con el anfitrión (fondo_buitre)');
  const guests = ((night!.data as Record<string, unknown>).guests as string[]) ?? [];
  assert(guests.length === gambleCfg.maxGuests, `invitados limitados a maxGuests (${guests.length})`);
  assert(guests.every((id) => w.residents[id]!.location === buitre.home), 'los invitados aparecen teleportados en el salón del anfitrión');
  const visits = nightEvs.filter((e) => e.type === 'gamble_visit');
  assert(visits.length === guests.length && visits.every((v) => (v.data as Record<string, unknown>).block === buitre.home), `un gamble_visit por invitado (${visits.length})`);
  const partyEnd = buitre.cooldowns['gamble']!;
  assert(guests.every((id) => w.residents[id]!.cooldowns['hop'] === partyEnd), 'los invitados quedan sentados (hop = fin de la partida)');

  // Su IA pelea pero el hop la gatea: un tick completo y siguen en el salón.
  tick(w, content);
  assert(guests.every((id) => w.residents[id]!.location === buitre.home), 'con la partida en marcha la IA no saca a los invitados (hop gatea)');

  // REDADA: multa al anfitrión, parte a arcas, invitados a casa y veto nocturno.
  content.rules.sim.gamble.raidChancePerTick = 1;
  const walletBefore = buitre.wallet;
  const fundsBefore = w.community.funds;
  const relBefore = guests.map((id) => w.residents[id]!.relations.find((x) => x.with === BUITRE)?.affinity ?? 0);
  stepGamble(w, 1);
  const raid = drainEvents(w).find((e) => e.type === 'gamble_raid');
  assert(!!raid && (raid!.data as Record<string, unknown>).fine === gambleCfg.fine, 'gamble_raid emitido con la multa del catálogo');
  assert(!!((raid!.data as Record<string, unknown>).line as { es: string } | null)?.es, 'la redada trae línea del catálogo');
  assert(buitre.wallet === walletBefore - gambleCfg.fine && w.community.funds === fundsBefore + Math.round(gambleCfg.fine * gambleCfg.fundsShare), `hucha −${gambleCfg.fine} y arcas +${Math.round(gambleCfg.fine * gambleCfg.fundsShare)}`);
  assert(guests.every((id) => w.residents[id]!.location === w.residents[id]!.home && w.residents[id]!.cooldowns['hop'] === 0), 'los invitados devueltos a casa y liberados');
  const relAfter = guests.map((id) => w.residents[id]!.relations.find((x) => x.with === BUITRE)?.affinity ?? 0);
  assert(relAfter.every((a, i) => a === relBefore[i]! - 2), 'cada invitado pierde 2 de afinidad con el anfitrión');
  assert(buitre.cooldowns['gamble'] === 0 && buitre.cooldowns['gambleDay'] === w.clock.day, 'la mesa cierra y esta noche no se reabre');
  stepGamble(w, 1);
  assert(drainEvents(w).every((e) => e.type !== 'gamble_night'), 'el veto de gambleDay impide reabrir la misma noche');

  // Resaca: sin partida hasta pasar cooldownDays (día simulado a mano).
  w.clock.day += gambleCfg.cooldownDays - 1;
  w.clock.minute = 1350;
  stepGamble(w, 1);
  assert(drainEvents(w).every((e) => e.type !== 'gamble_night'), 'dentro de cooldownDays tras la redada no hay mesa');
  w.clock.day += 1;
  stepGamble(w, 1);
  assert(!!drainEvents(w).find((e) => e.type === 'gamble_night'), `pasada la resaca (${gambleCfg.cooldownDays} días) vuelve a abrir`);

  // Cierre NATURAL: gamble_over UNA sola vez aunque el tick se pase dos veces por ahí.
  const w3 = createWorld(content, content.rules.startScenario);
  const host3 = w3.residents[BUITRE]!;
  host3.present = true;
  content.rules.sim.gamble.raidChancePerTick = 0;
  host3.cooldowns['gamble'] = w3.tick + 2; // fiesta forzada que expira en 2 ticks
  const guest3 = w3.residents['res_musico_01']!;
  guest3.present = true;
  guest3.location = host3.home; // sentado en la mesa (como lo deja gambleTick)
  guest3.cooldowns['hop'] = w3.tick + 2;
  stepGamble(w3, 2); // expira justo aquí
  let overs = drainEvents(w3).filter((e) => e.type === 'gamble_over');
  assert(overs.length === 1 && (overs[0]!.data as Record<string, unknown>).host === BUITRE, 'el cierre natural emite gamble_over una vez');
  assert(guest3.location === guest3.home && guest3.cooldowns['hop'] === 0, 'al cierre natural los invitados van a la cama');
  stepGamble(w3, 2);
  overs = drainEvents(w3).filter((e) => e.type === 'gamble_over');
  assert(overs.length === 0, 'el marcador gambleOver no repite el cierre');
}

// ══════════════ 4) DETERMINISMO: dos mundos gemelos, un solo flujo ══════════════
{
  const run = (): GameEvent[] => {
    const w = createWorld(content, content.rules.startScenario); // misma semilla del escenario
    w.clock.minute = 0; // noche
    content.rules.sim.drunk.chance = 1;
    content.rules.sim.drunk.staggerChance = 1;
    const musico = w.residents[MUSICO]!;
    const stream: GameEvent[] = [];
    musico.location = null;
    for (let i = 0; i < 8; i++) {
      tick(w, content);
      stream.push(...drainEvents(w));
    }
    musico.location = musico.home; // forzar llegada → faroleos → casa
    musico.cooldowns['hop'] = 0;
    for (let i = 0; i < 4; i++) {
      tick(w, content);
      musico.location = musico.home;
      musico.cooldowns['hop'] = 0;
      stream.push(...drainEvents(w));
    }
    return stream;
  };
  const a = JSON.stringify(run());
  const b = JSON.stringify(run());
  assert(a === b, 'dos mundos gemelos (misma semilla) producen flujos de eventos idénticos');
  assert(a.includes('drunk_started') && a.includes('drunk_fumble') && a.includes('drunk_home'), 'el flujo determinista cubre la borrachera completa');
}

// Restaurar los fixtures de catálogo (por si el proceso sigue vivo).
content.rules.sim.roof.damageChancePerTick = 0.004;
content.rules.sim.drunk.chance = 0.35;
content.rules.sim.drunk.staggerChance = 0.55;
content.rules.sim.gamble.chancePerNight = 0.3;
content.rules.sim.gamble.raidChancePerTick = 0.0015;

console.log('SMOKE NIGHTLIFE OK');
