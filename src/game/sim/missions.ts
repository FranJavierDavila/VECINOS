import type { ActiveMission, Condition, Content, MissionDef, World } from '@/game/core/types';
import { emit } from './events';
import { applyEffects, resolveBlocks } from './effects';

type Step = MissionDef['steps'][number];
const byId = <T extends { id: string }>(a: T, b: T) => a.id.localeCompare(b.id);

export function newMission(id: string, startAtTick: number): ActiveMission {
  return { id, state: 'pending', startAtTick, step: 0, roles: {}, until: null, choice: null };
}

/** Enlaza los roles de una misión con residentes presentes: por arquetipo y por parentesco (`parentOf`). */
export function bindRoles(world: World, def: MissionDef): { roles: Record<string, string>; complete: boolean } {
  const roles: Record<string, string> = {};
  const taken = new Set<string>();
  const present = Object.values(world.residents).filter((r) => r.present).sort(byId);
  const defs = Object.entries(def.roles ?? {});
  for (const [name, r] of defs) {
    if (!r.archetype) continue;
    const c = present.find((x) => x.archetype === r.archetype && !taken.has(x.id));
    if (c) {
      roles[name] = c.id;
      taken.add(c.id);
    }
  }
  for (const [name, r] of defs) {
    if (r.relation !== 'parentOf' || !r.of || !roles[r.of]) continue;
    const kid = roles[r.of]!;
    const p = present.find((x) => x.parentOf.includes(kid));
    if (p) roles[name] = p.id;
  }
  return { roles, complete: defs.every(([name]) => name in roles) };
}

const resolveRef = (world: World, ref: string) => (ref === '$home' ? world.residents[world.playerId]!.home : ref);
const currentStep = (content: Content, m: { id: string; step: number }): Step | undefined => content.missions[m.id]?.steps[m.step];

export function conditionHolds(world: World, content: Content, c: Condition, roles: Record<string, string>): boolean {
  if ('dayMin' in c) return world.clock.day >= c.dayMin;
  if ('param' in c) {
    const [ref, p] = c.param.split('.') as [string, string];
    const blocks = resolveBlocks(world, content, ref);
    return blocks.length > 0 && blocks.every((b) => {
      const v = b.params[p];
      if (c.eq !== undefined) return v === c.eq;
      if (typeof v !== 'number') return false;
      if (c.gte !== undefined && v < c.gte) return false;
      if (c.lte !== undefined && v > c.lte) return false;
      return c.eq !== undefined ? v === c.eq : (c.gte !== undefined || c.lte !== undefined);
    });
  }
  if ('role' in c) return c.exists === (c.role in roles);
  if ('mission' in c) {
    const m = world.missions.find((x) => x.id === c.mission);
    return c.state === 'done' ? m?.state === 'done' : m?.state === 'active' || m?.state === 'awaiting_choice';
  }
  // Condición horaria (con ventana nocturna opcional: after 21:00 + before 02:00 cruza medianoche).
  const [ah, am] = c.time.after.split(':').map(Number) as [number, number];
  const after = ah * 60 + am;
  if (c.time.before) {
    const [bh, bm] = c.time.before.split(':').map(Number) as [number, number];
    const before = bh * 60 + bm;
    return before >= after ? world.clock.minute >= after && world.clock.minute <= before : world.clock.minute >= after || world.clock.minute <= before;
  }
  return world.clock.minute >= after;
}

function restoreLocations(world: World, m: { roles: Record<string, string> }) {
  for (const id of Object.values(m.roles)) {
    const r = world.residents[id];
    if (r && r.present && id !== world.playerId) r.location = r.home;
  }
}

function enterStep(world: World, content: Content, m: ActiveMission) {
  const step = currentStep(content, m)!;
  const base = { mission: m.id, step: step.id, type: step.type };
  switch (step.type) {
    case 'phone_call':
      return emit(world, 'step_started', { ...base, dialog: step.dialog, hint: step.hint ?? null });
    case 'reach':
      return emit(world, 'step_started', { ...base, block: resolveRef(world, step.target.block), hint: step.hint ?? null });
    case 'enter':
      return emit(world, 'step_started', { ...base, block: resolveRef(world, step.target), hint: step.hint ?? null });
    case 'catch_in_act': {
      const kidId = m.roles[step.target];
      const kid = kidId ? world.residents[kidId] : undefined;
      const homeFloor = kid ? world.blocks[kid.home]?.cell.floor : undefined;
      const candidates = resolveBlocks(world, content, step.place.split('.')[0]!).sort(byId);
      const block = candidates.find((b) => b.cell.floor === homeFloor) ?? candidates[0];
      m.until = world.tick + step.windowMinutes;
      if (kid && block) kid.location = block.id;
      return emit(world, 'step_started', { ...base, resident: kidId ?? null, block: block?.id ?? null, untilTick: m.until, hint: step.hint ?? null });
    }
  }
}

function activate(world: World, content: Content, m: ActiveMission) {
  const def = content.missions[m.id]!;
  m.roles = { ...bindRoles(world, def).roles, ...m.roles };
  m.state = 'active';
  m.step = 0;
  m.until = null;
  emit(world, 'mission_activated', { mission: m.id, title: def.title, description: def.description });
  enterStep(world, content, m);
}

export function completeMission(world: World, content: Content, m: ActiveMission) {
  const def = content.missions[m.id]!;
  m.state = 'done';
  applyEffects(world, content, def.onComplete ?? [], { roles: m.roles });
  restoreLocations(world, m);
  emit(world, 'mission_completed', { mission: m.id });
}

function failMission(world: World, m: ActiveMission, reason: string) {
  m.state = 'failed';
  restoreLocations(world, m);
  emit(world, 'mission_failed', { mission: m.id, reason });
}

function completeStep(world: World, content: Content, m: ActiveMission) {
  const def = content.missions[m.id]!;
  emit(world, 'step_completed', { mission: m.id, step: def.steps[m.step]!.id });
  m.step += 1;
  m.until = null;
  if (m.step < def.steps.length) return enterStep(world, content, m);
  if (def.choices?.length) {
    m.state = 'awaiting_choice';
    return emit(world, 'choice_required', {
      mission: m.id,
      title: def.title,
      choices: def.choices.map((c) => ({ id: c.id, label: c.label, hint: c.hint ?? null, icon: c.icon ?? null })),
    });
  }
  completeMission(world, content, m);
}

export type MissionSignal =
  | { type: 'door_approached' | 'block_entered'; resident: string; block: string }
  | { type: 'call_answered'; mission: string };

/** Las órdenes del jugador avisan aquí: si encajan con el paso actual de una misión activa, el paso se completa. */
export function notify(world: World, content: Content, sig: MissionSignal) {
  for (const m of world.missions) {
    if (m.state !== 'active') continue;
    const step = currentStep(content, m);
    if (!step) continue;
    const byPlayer = sig.type !== 'call_answered' && sig.resident === world.playerId;
    let hit = false;
    switch (step.type) {
      case 'phone_call':
        hit = sig.type === 'call_answered' && sig.mission === m.id;
        break;
      case 'reach':
        hit = sig.type === 'door_approached' && byPlayer && sig.block === resolveRef(world, step.target.block);
        break;
      case 'enter':
        hit = sig.type === 'block_entered' && byPlayer && sig.block === resolveRef(world, step.target);
        break;
      case 'catch_in_act': {
        const kid = m.roles[step.target];
        hit = sig.type === 'block_entered' && byPlayer && !!kid && world.residents[kid]?.location === sig.block && (m.until === null || world.tick <= m.until);
        break;
      }
    }
    if (hit) completeStep(world, content, m);
  }
}

function advanceOnce(world: World, content: Content): boolean {
  let changed = false;
  for (const m of world.missions) {
    if (m.state === 'pending' && world.tick >= m.startAtTick) {
      activate(world, content, m);
      changed = true;
    } else if (m.state === 'active') {
      const step = currentStep(content, m);
      if (step?.type === 'catch_in_act' && m.until !== null && world.tick > m.until) {
        failMission(world, m, 'timeout');
        changed = true;
      }
    }
  }
  for (const def of Object.values(content.missions).sort(byId)) {
    if (!def.trigger || world.missions.some((x) => x.id === def.id)) continue;
    const { roles, complete } = bindRoles(world, def);
    if (!complete) continue;
    const holds = 'all' in def.trigger ? def.trigger.all!.every((c) => conditionHolds(world, content, c, roles)) : def.trigger!.any!.some((c) => conditionHolds(world, content, c, roles));
    if (!holds) continue;
    const m = newMission(def.id, world.tick);
    m.roles = roles;
    world.missions.push(m);
    activate(world, content, m);
    changed = true;
  }
  return changed;
}

/** Activa misiones pendientes o con disparador cumplido y caduca las que se pasaron de plazo. */
export function advanceMissions(world: World, content: Content): void {
  for (let i = 0; i < 4; i++) if (!advanceOnce(world, content)) break;
}
