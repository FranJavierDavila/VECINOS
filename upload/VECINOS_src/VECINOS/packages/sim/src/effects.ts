import type { Content, Effect } from '@vecinos/content';
import type { BlockInstance, World } from './types';
import { emit } from './events';
import { instantiateRooms } from './rooms';
import { newMission } from './missions';

export interface EffectContext {
  /** Roles de la misión en curso (p. ej. kid → res_nino_01). */
  roles?: Record<string, string>;
}

/** Bloques a los que se refiere `ref`: id exacto, o todos los de un defId o un alignGroup. */
export function resolveBlocks(world: World, content: Content, ref: string): BlockInstance[] {
  const exact = world.blocks[ref];
  if (exact) return [exact];
  return Object.values(world.blocks).filter((b) => b.defId === ref || content.blocks[b.defId]?.alignGroup === ref);
}

function resolveActor(world: World, ref: string, ctx: EffectContext): string | null {
  if (ref === 'player') return world.playerId;
  const role = ctx.roles?.[ref];
  if (role) return role;
  return world.residents[ref] ? ref : null;
}

/** Único punto por el que misiones y decisiones modifican el mundo. */
export function applyEffect(world: World, content: Content, e: Effect, ctx: EffectContext = {}): void {
  switch (e.op) {
    case 'setParam': {
      const [ref, param] = e.param ? [e.target, e.param] : (e.target.split('.') as [string, string]);
      for (const b of resolveBlocks(world, content, ref)) {
        const pd = content.blocks[b.defId]!.params[param];
        if (!pd) continue;
        let next = e.value ?? (Number(b.params[param] ?? pd.default) + (e.delta ?? 0));
        if (pd.type === 'number' && typeof next === 'number') next = Math.min(pd.max ?? Infinity, Math.max(pd.min ?? -Infinity, next));
        b.params[param] = next;
        emit(world, 'param_changed', { block: b.id, param, value: next });
      }
      return;
    }
    case 'unlock': {
      const b = world.blocks[e.target];
      if (!b) return emit(world, 'effect_unresolved', { op: e.op, target: e.target });
      if (e.availability) {
        b.availability = e.availability;
        b.lockReason = 'for_sale';
        emit(world, 'block_for_sale', { block: b.id, price: e.availability.price });
      } else {
        const wasLocked = b.access === 'locked';
        b.access = 'unlocked';
        b.lockReason = null;
        b.availability = null;
        if (b.kind === 'dwelling' && b.rooms.length === 0) b.rooms = instantiateRooms(content, b.defId);
        if (wasLocked) emit(world, 'block_unlocked', { block: b.id });
      }
      b.occupancy = e.occupancy ?? (e.resident ? 'occupied' : b.occupancy);
      const r = e.resident ? world.residents[e.resident] : undefined;
      if (r) {
        r.present = true;
        r.location = b.id;
        b.ownerId ??= r.id;
        emit(world, 'neighbor_arrived', { resident: r.id, block: b.id, arrival: e.arrival ?? null });
      }
      return;
    }
    case 'addRelation': {
      const a = resolveActor(world, e.a, ctx);
      const b = resolveActor(world, e.b, ctx);
      const res = a ? world.residents[a] : undefined;
      if (!a || !b || !res) return emit(world, 'effect_unresolved', { op: e.op, a: e.a, b: e.b });
      let rel = res.relations.find((x) => x.with === b);
      if (!rel) res.relations.push((rel = { with: b, affinity: 0, trust: 0 }));
      rel.affinity += e.affinity ?? 0;
      rel.trust += e.trust ?? 0;
      return emit(world, 'relation_changed', { a, b, affinity: rel.affinity, trust: rel.trust });
    }
    case 'startMission': {
      if (world.missions.some((m) => m.id === e.id)) return;
      world.missions.push(newMission(e.id, world.tick + (e.delayMinutes ?? 0)));
      return emit(world, 'mission_started', { mission: e.id, startAtTick: world.tick + (e.delayMinutes ?? 0) });
    }
    case 'addFunds': {
      if (e.to === 'community') world.community.funds += e.amount;
      else {
        const id = resolveActor(world, e.to, ctx);
        if (!id) return emit(world, 'effect_unresolved', { op: e.op, to: e.to });
        world.residents[id]!.wallet += e.amount;
      }
      return emit(world, 'funds_changed', { to: e.to, amount: e.amount });
    }
    case 'revealParams': {
      if (e.tier) world.progress.revealedTier = Math.max(world.progress.revealedTier, e.tier);
      for (const p of e.params ?? []) {
        if (!world.progress.revealedParams.includes(p)) world.progress.revealedParams.push(p);
        world.progress.hiddenParams = world.progress.hiddenParams.filter((x) => x !== p);
      }
      return emit(world, 'params_revealed', { tier: e.tier ?? null, params: e.params ?? [] });
    }
    case 'hideParams': {
      for (const p of e.params ?? []) if (!world.progress.hiddenParams.includes(p)) world.progress.hiddenParams.push(p);
      if (e.tier) world.progress.revealedTier = Math.min(world.progress.revealedTier, e.tier - 1);
      return emit(world, 'params_hidden', { tier: e.tier ?? null, params: e.params ?? [] });
    }
    case 'grantFavor': {
      const from = resolveActor(world, e.from, ctx) ?? e.from;
      world.favors[from] = (world.favors[from] ?? 0) + e.count;
      return emit(world, 'favor_granted', { from, count: e.count });
    }
    // Estos efectos los consume la presentación o un sistema futuro; el núcleo solo avisa.
    case 'openJunta':
      return emit(world, 'junta_requested', { agenda: e.agenda });
    case 'startMinigame':
      return emit(world, 'minigame_requested', { minigame: e.id });
    default: {
      const never: never = e;
      return never;
    }
  }
}

export function applyEffects(world: World, content: Content, effects: Effect[], ctx: EffectContext = {}): void {
  for (const e of effects) applyEffect(world, content, e, ctx);
}
