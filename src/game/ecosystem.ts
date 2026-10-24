import type { BlockInstance, Content, EcosystemContent, EcosystemEvent, EcosystemOutcome, EcosystemWhen, Weather, World } from '@/game/core/types';
import { applyEffects, inMinuteWindow, resolveBlocks } from '@/game/sim';
import { hash01 } from '@/game/interior';

/**
 * CEREBRO del ecosistema ("El edificio está vivo", v1.14) — módulo de soporte, SIN Babylon.
 *
 * Función PURA evaluada a un tick concreto: recorre content.ecosystem.events en orden,
 * comprueba cooldowns/ventana horaria/condiciones/azar DETERMINISTA (hash01, jamás el RNG
 * del sim), elige una rama de outcome ponderada ("impredecible") y aplica sus efectos con
 * applyEffects (el ÚNICO camino legal para que la presentación mueva el mundo).
 *
 * El estado interno (cooldowns, apagón en curso, contador de azar) vive en EcosystemState,
 * un objeto aparte y serializable propiedad del director visual: NUNCA se mete en World.
 * Las condiciones del `when` son de este módulo: si hace falta una condición nueva, se
 * implementa AQUÍ, nunca en src/game/sim/**.
 */

export interface EcosystemState {
  /** Último tick evaluado (la cadencia la manda scheduler.evalEveryTicks). */
  lastEvalTick: number;
  /** Evaluaciones realizadas (telemetría/QA). */
  evalIndex: number;
  /** Contador monótono de sorteos: cada tirada usa un n distinto → sin colisiones de hash. */
  rollIndex: number;
  /** Cooldown por evento id → tick hasta el que está callado. */
  cooldowns: Record<string, number>;
  /** Apagón activo: tick hasta el que dura (null = luz normal). */
  blackoutUntilTick: number | null;
  /** Id del evento que provocó el apagón (para restaurar con SU config). */
  blackoutEventId: string | null;
}

export function createEcosystemState(): EcosystemState {
  return { lastEvalTick: -1, evalIndex: 0, rollIndex: 0, cooldowns: {}, blackoutUntilTick: null, blackoutEventId: null };
}

// ───────────────────────── Staging y report (teatro para la capa visual) ─────────────────────────

/** Teatro de un vendedor: entra por el portal, sube por la escalera y llama a puertas. */
export interface EcosystemVendorStage {
  kind: 'vendor';
  eventId: string;
  /** Arquetipo del extra (modelo en assets.actors o cápsula del color del arquetipo). */
  archetype: string;
  /** Planta donde llama a puertas. */
  floor: number;
  /** Pasillo de esa planta (la línea z = corridorZ por la que camina). */
  corridorBlock: string;
  /** Bloque de escalera (su X es la del pozo; subir/bajar = stairPathPoints). */
  stairsBlock: string;
  /** Puertas (ids de bloque) en el orden en que se llaman. */
  doors: string[];
  /** Rama elegida por cada puerta (los efectos YA están aplicados: aquí solo teatro). */
  knocks: string[];
}

/** Teatro de la mascota: vive mientras su misión esté abierta (el sim es la autoridad). */
export interface EcosystemPetStage {
  kind: 'pet';
  eventId: string;
  mission: string;
  /** Bloque que declara el paso reach/enter de la misión (pista; la visual relee la misión). */
  blockId: string | null;
}

export type EcosystemStaging = EcosystemVendorStage | EcosystemPetStage;

export interface EcosystemFired {
  eventId: string;
  kind: EcosystemEvent['kind'];
  /** 'fire' = evento disparado; 'restore' = apagón expirado y luz restaurada. */
  phase: 'fire' | 'restore';
}

export interface EcosystemReport {
  /** Tick en el que se evaluó. */
  tick: number;
  /** Eventos disparados en esta evaluación (en orden). */
  fired: EcosystemFired[];
  /** Teatro pendiente para la capa visual (extras que caminan, mascota…). */
  staging: EcosystemStaging[];
}

export interface EcosystemEvalOptions {
  /** Semilla del azar determinista (default: la semilla del mundo). */
  seed?: string;
}

// ───────────────────────── Azar determinista y condiciones ─────────────────────────

/** Tirada determinista 0..1: cada uso avanza state.rollIndex (sin tocar el RNG del sim). */
function roll(state: EcosystemState, seed: string): number {
  const r = hash01(seed, state.rollIndex);
  state.rollIndex += 1;
  return r;
}

/** Rama ponderada: r recorre el total de pesos y cae en una rama (orden del catálogo). */
function pickWeighted<T extends { weight: number }>(list: T[], r: number): T | null {
  const total = list.reduce((s, o) => s + Math.max(0, o.weight), 0);
  if (total <= 0 || list.length === 0) return null;
  let acc = r * total;
  for (const item of list) {
    acc -= Math.max(0, item.weight);
    if (acc < 0) return item;
  }
  return list[list.length - 1]!;
}

/** Ánimo medio del edificio: media ponderada de necesidades de los residentes presentes. */
function moodAverage(world: World, needs: Record<string, number>): number | null {
  let sum = 0;
  let count = 0;
  for (const r of Object.values(world.residents)) {
    if (!r.present) continue;
    let s = 0;
    let total = 0;
    for (const [k, w] of Object.entries(needs)) {
      const v = r.needs[k];
      if (typeof v === 'number') {
        s += v * w;
        total += w;
      }
    }
    if (total > 0) {
      sum += s / total;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

/** Primer bloque (por id) de los que resuelve `ref` que tenga el param pedido. */
function paramOf(world: World, content: Content, ref: string, param: string): number | null {
  for (const b of resolveBlocks(world, content, ref)) {
    const v = b.params[param];
    if (typeof v === 'number') return v;
  }
  return null;
}

/** ¿Se cumple la condición? Todas las condiciones son DEL CEREBRO (nunca del sim). */
export function whenHolds(world: World, content: Content, w: EcosystemWhen, eco: EcosystemContent): boolean {
  if ('weather' in w) {
    const wanted = Array.isArray(w.weather) ? w.weather : [w.weather];
    const hit = (wanted as Weather[]).includes(world.weather.state);
    return w.not ? !hit : hit;
  }
  if ('paramAbove' in w) {
    const v = paramOf(world, content, w.paramAbove.block, w.paramAbove.param);
    return v !== null && v > w.paramAbove.value;
  }
  if ('paramBelow' in w) {
    const v = paramOf(world, content, w.paramBelow.block, w.paramBelow.param);
    return v !== null && v < w.paramBelow.value;
  }
  if ('fundsAbove' in w) return world.community.funds > w.fundsAbove;
  if ('fundsBelow' in w) return world.community.funds < w.fundsBelow;
  if ('moodAbove' in w) {
    const m = moodAverage(world, eco.mood.needs);
    return m !== null && m > w.moodAbove;
  }
  if ('moodBelow' in w) {
    const m = moodAverage(world, eco.mood.needs);
    return m !== null && m < w.moodBelow;
  }
  if ('residentPresent' in w) {
    const r = world.residents[w.residentPresent];
    return !!r && r.present;
  }
  if ('missionState' in w) {
    const m = world.missions.find((x) => x.id === w.missionState.mission);
    if (w.missionState.state === 'none') return !m;
    return m?.state === w.missionState.state;
  }
  return true;
}

const whenListHolds = (world: World, content: Content, when: EcosystemWhen[] | undefined, eco: EcosystemContent): boolean =>
  !when || when.every((w) => whenHolds(world, content, w, eco));

// ───────────────────────── Ayudas de mundo (puertas, escaleras, pasillos) ─────────────────────────

const byId = (a: BlockInstance, b: BlockInstance) => a.id.localeCompare(b.id);

/** Puertas de una planta: viviendas; si la planta no tiene (baja), locales comunes sin pozo. */
function doorBlocksOf(world: World, content: Content, floor: number): BlockInstance[] {
  const dwellings = Object.values(world.blocks).filter((b) => b.cell.floor === floor && b.kind === 'dwelling').sort(byId);
  if (dwellings.length > 0) return dwellings;
  return Object.values(world.blocks)
    .filter((b) => {
      if (b.cell.floor !== floor || b.layer !== 'main' || b.kind === 'dwelling') return false;
      const f = content.blocks[b.defId]?.features;
      return !(f?.stairs || f?.elevator); // los pozos no son puertas
    })
    .sort(byId);
}

function corridorOfFloor(world: World, floor: number): BlockInstance | null {
  return Object.values(world.blocks).find((b) => b.layer === 'corridor' && b.cell.floor === floor) ?? null;
}

function stairsOfFloor(world: World, content: Content, floor: number): BlockInstance | null {
  return Object.values(world.blocks).find((b) => b.cell.floor === floor && content.blocks[b.defId]?.features?.stairs === true) ?? null;
}

/** Bloque de la misión (paso reach o enter) donde vive el teatro de la mascota. */
function missionBlockId(content: Content, missionId: string): string | null {
  const step = content.missions[missionId]?.steps.find((s) => s.type === 'reach' || s.type === 'enter');
  if (!step) return null;
  return step.type === 'reach' ? step.target.block : step.type === 'enter' ? step.target : null;
}

/** Aplica los efectos de una rama + su toast (el orden del catálogo manda). */
function applyOutcome(world: World, content: Content, outcome: EcosystemOutcome): void {
  applyEffects(world, content, outcome.effects, {});
  if (outcome.toast) applyEffects(world, content, [{ op: 'toast', text: outcome.toast, tone: 'info' }], {});
}

// ───────────────────────── El cerebro ─────────────────────────

/**
 * Evalúa el ecosistema en el tick actual. La llamará la presentación cuando
 * `world.tick - state.lastEvalTick >= evalEveryTicks` (y el apagón caducado se comprueba
 * en cada llamada, evaluación due o no, para restaurar la luz en cuanto toque).
 */
export function evaluateEcosystem(world: World, content: Content, state: EcosystemState, opts: EcosystemEvalOptions = {}): EcosystemReport {
  const report: EcosystemReport = { tick: world.tick, fired: [], staging: [] };
  const eco = content.ecosystem;
  if (!eco) return report;
  const seed = opts.seed ?? `eco:${world.seed}`;

  // 1) Apagón caducado: se comprueba en CADA llamada (evaluación due o no) para que la luz
  //    vuelva en la primera evaluación posterior a la expiración — con SU valor de catálogo.
  if (state.blackoutUntilTick !== null) {
    const ev = eco.events.find((e) => e.id === state.blackoutEventId);
    if (world.tick >= state.blackoutUntilTick) {
      if (ev?.blackout) {
        applyEffects(
          world,
          content,
          [
            { op: 'setParam', target: ev.blackout.corridorBlock, param: ev.blackout.lightingParam, value: ev.blackout.restoreTo },
            { op: 'toast', text: ev.blackout.restoreToast, tone: 'good' },
          ],
          {},
        );
      }
      report.fired.push({ eventId: ev?.id ?? 'blackout', kind: 'blackout', phase: 'restore' });
      state.blackoutUntilTick = null;
      state.blackoutEventId = null;
    }
  }

  // 2) ¿Toca evaluar? (la cadencia la manda el catálogo)
  if (world.tick - state.lastEvalTick < eco.scheduler.evalEveryTicks) return report;
  state.lastEvalTick = world.tick;
  state.evalIndex += 1;

  // 3) Candidatos: cooldown + ventana horaria + condiciones + probabilidad por evaluación.
  const candidates = eco.events.filter((ev) => {
    if ((state.cooldowns[ev.id] ?? 0) > world.tick) return false;
    if (ev.kind === 'blackout' && state.blackoutUntilTick !== null) return false; // nunca dos apagones
    if (ev.window && !inMinuteWindow(world.clock.minute, ev.window)) return false;
    if (!whenListHolds(world, content, ev.when, eco)) return false;
    if (ev.chance !== undefined && roll(state, `${seed}:${ev.id}:chance`) >= ev.chance) return false;
    return true;
  });

  // 4) Un solo evento por evaluación: sorteo ponderado entre candidatos (impredecible).
  const ev = pickWeighted(candidates, roll(state, `${seed}:pick`));
  if (!ev) return report;
  state.cooldowns[ev.id] = world.tick + ev.cooldownTicks;

  switch (ev.kind) {
    // ── Vendedor: sube a una planta y CADA puerta dispara su propio sorteo ponderado. ──
    case 'vendor': {
      const cfg = ev.vendor;
      if (!cfg) break;
      // Plantas válidas (pasillo + puertas, en el orden del JSON): el sorteo reparte la visita
      // entre ellas (impredecible); el orden del catálogo solo desempata.
      const valid: { floor: number; corridor: BlockInstance; doors: BlockInstance[] }[] = [];
      for (const floor of eco.extras.vendor.floors) {
        const corridor = corridorOfFloor(world, floor);
        const doors = corridor ? doorBlocksOf(world, content, floor) : [];
        if (corridor && doors.length > 0) valid.push({ floor, corridor, doors });
      }
      const picked = valid.length > 0 ? valid[Math.floor(roll(state, `${seed}:${ev.id}:floor`) * valid.length) % valid.length]! : null;
      if (!picked) break;
      const stairs = stairsOfFloor(world, content, picked.floor) ?? Object.values(world.blocks).find((b) => content.blocks[b.defId]?.features?.stairs === true) ?? null;
      if (!stairs) break;
      // Puertas: recorte a las disponibles + inicio determinista con desplazamiento circular.
      const start = Math.floor(roll(state, `${seed}:${ev.id}:start`) * picked.doors.length);
      const n = Math.min(cfg.doors, picked.doors.length);
      const doors: BlockInstance[] = [];
      for (let i = 0; i < n; i++) doors.push(picked.doors[(start + i) % picked.doors.length]!);
      // CADA puerta: su propio outcome ponderado, efectos aplicados YA por el cerebro.
      const knocks: string[] = [];
      for (const door of doors) {
        const eligible = cfg.perKnockOutcomes.filter((o) => whenListHolds(world, content, o.when, eco));
        const outcome = pickWeighted(eligible, roll(state, `${seed}:${ev.id}:${door.id}`));
        if (!outcome) continue;
        applyOutcome(world, content, outcome);
        knocks.push(outcome.id);
      }
      report.staging.push({
        kind: 'vendor',
        eventId: ev.id,
        archetype: cfg.archetype,
        floor: picked.floor,
        corridorBlock: picked.corridor.id,
        stairsBlock: stairs.id,
        doors: doors.map((d) => d.id),
        knocks,
      });
      break;
    }
    // ── Mascota: arranca su misión (el sim es la autoridad; la visual lee la misión activa). ──
    case 'pet': {
      const mission = ev.pet?.mission;
      if (!mission || !content.missions[mission]) break;
      const outcome = pickWeighted(ev.outcomes ?? [], roll(state, `${seed}:${ev.id}`));
      if (outcome) applyOutcome(world, content, outcome);
      report.staging.push({ kind: 'pet', eventId: ev.id, mission, blockId: missionBlockId(content, mission) });
      break;
    }
    // ── Apagón: efectos del outcome + registro de expiración (la restauración la hace el cerebro). ──
    case 'blackout': {
      const cfg = ev.blackout;
      const outcome = pickWeighted(ev.outcomes ?? [], roll(state, `${seed}:${ev.id}`));
      if (!cfg || !outcome) break;
      applyOutcome(world, content, outcome);
      const span = Math.max(0, cfg.durationMinutes.max - cfg.durationMinutes.min);
      const minutes = cfg.durationMinutes.min + Math.floor(roll(state, `${seed}:${ev.id}:dur`) * (span + 1));
      state.blackoutUntilTick = world.tick + minutes;
      state.blackoutEventId = ev.id;
      break;
    }
    // ── Trastadas y deriva: una rama ponderada y sus efectos (el unlock con resident es del sim). ──
    case 'prank':
    case 'drift': {
      const eligible = (ev.outcomes ?? []).filter((o) => whenListHolds(world, content, o.when, eco));
      const outcome = pickWeighted(eligible, roll(state, `${seed}:${ev.id}`));
      if (outcome) applyOutcome(world, content, outcome);
      break;
    }
  }
  report.fired.push({ eventId: ev.id, kind: ev.kind, phase: 'fire' });
  return report;
}
