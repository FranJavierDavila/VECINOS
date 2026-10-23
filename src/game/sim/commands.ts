import type { Command, Content, RoomInstance, World } from '@/game/core/types';
import { emit } from './events';
import { applyEffects, applyEffect } from './effects';
import { advanceMissions, completeMission, notify } from './missions';
import { nextRandom } from './rng';
import { castVotes, resolveJunta } from './extra/junta';

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

const ok = (): CommandResult => ({ ok: true });
const fail = (reason: string): CommandResult => ({ ok: false, reason });

/**
 * Reglas de circulación: en la misma planta se pasa siempre por el pasillo; entre plantas
 * solo de núcleo a núcleo contiguo (escalera o ascensor).
 */
export function canMove(world: World, content: Content, from: string | null, to: string): boolean {
  const b = world.blocks[to];
  if (!b) return false;
  const a = from ? world.blocks[from] : undefined;
  if (!a) return true;
  if (a.cell.floor === b.cell.floor) {
    if (a.layer === 'corridor' || b.layer === 'corridor') return true;
    return a.kind !== 'dwelling' && b.kind !== 'dwelling';
  }
  const stairs = (id: string) => !!content.blocks[world.blocks[id]!.defId]!.features?.stairs;
  return stairs(a.id) && stairs(b.id) && Math.abs(a.cell.floor - b.cell.floor) === 1 && a.cell.col === b.cell.col;
}

function knockLine(world: World, content: Content, residentId: string): { line: string; asleep: boolean } {
  const r = world.residents[residentId]!;
  const arch = content.archetypes[r.archetype];
  if (r.activity === 'sleep') return { line: content.rules.sim.knock.asleepLine, asleep: true };
  const pool = Object.values(arch?.activities ?? {}).flatMap((a) => a.say ?? []);
  const fallback = content.rules.sim.knock.fallbackLines;
  const line = pool.length > 0 ? pool[Math.floor(nextRandom(world) * pool.length)]! : fallback[0]!;
  return { line, asleep: false };
}

/** Delta de parámetro de un mueble: a la estancia si el parámetro vive ahí, si no al bloque (con clamp del catálogo). */
function applyFurnitureParam(world: World, content: Content, blockId: string, room: RoomInstance, param: string, delta: number): void {
  const rdef = content.rooms[room.defId];
  const pd = rdef?.params?.[param];
  if (pd) {
    const cur = Number(room.params[param] ?? pd.default);
    room.params[param] = pd.type === 'number' ? Math.min(pd.max ?? Infinity, Math.max(pd.min ?? -Infinity, cur + delta)) : cur;
    emit(world, 'param_changed', { block: blockId, param, value: room.params[param] });
    return;
  }
  applyEffect(world, content, { op: 'setParam', target: blockId, param, delta });
}

function run(world: World, content: Content, cmd: Command): CommandResult {
  const actorId = 'actor' in cmd && typeof cmd.actor === 'string' && world.residents[cmd.actor] ? cmd.actor : world.playerId;
  const player = world.residents[actorId]!;
  switch (cmd.type) {
    case 'move': {
      const r = world.residents[cmd.resident];
      const to = world.blocks[cmd.to];
      if (!r || !r.present) return fail('unknown_resident');
      if (!to) return fail('unknown_block');
      if (r.location === to.id) return ok();
      if (to.kind === 'dwelling' && to.access === 'locked') {
        emit(world, 'door_locked', { resident: r.id, block: to.id, reason: to.lockReason, price: to.availability?.price ?? null });
        return fail('locked');
      }
      if (!canMove(world, content, r.location, to.id)) {
        emit(world, 'move_rejected', { resident: r.id, from: r.location, to: to.id });
        return fail('unreachable');
      }
      const from = r.location;
      r.location = to.id;
      emit(world, 'block_entered', { resident: r.id, block: to.id, from });
      notify(world, content, { type: 'block_entered', resident: r.id, block: to.id });
      return ok();
    }
    case 'approach': {
      const r = world.residents[cmd.resident];
      const b = world.blocks[cmd.block];
      if (!r || !r.present || !b) return fail('unknown_target');
      if (b.kind !== 'dwelling') return fail('not_a_door');
      const here = r.location ? world.blocks[r.location] : undefined;
      if (!here || here.cell.floor !== b.cell.floor) return fail('not_on_floor');
      emit(world, 'door_approached', { resident: r.id, block: b.id });
      notify(world, content, { type: 'door_approached', resident: r.id, block: b.id });
      return ok();
    }
    case 'answer_call': {
      const m = world.missions.find((x) => x.id === cmd.mission && x.state === 'active');
      if (!m || content.missions[m.id]!.steps[m.step]?.type !== 'phone_call') return fail('no_call');
      emit(world, 'call_answered', { mission: m.id });
      notify(world, content, { type: 'call_answered', mission: m.id });
      return ok();
    }
    case 'choose': {
      const m = world.missions.find((x) => x.id === cmd.mission && x.state === 'awaiting_choice');
      const choice = m && content.missions[m.id]!.choices?.find((c) => c.id === cmd.choice);
      if (!m || !choice) return fail('no_choice');
      m.choice = choice.id;
      emit(world, 'choice_made', { mission: m.id, choice: choice.id });
      applyEffects(world, content, choice.effects, { roles: m.roles, actor: actorId });
      completeMission(world, content, m);
      return ok();
    }
    case 'work': {
      const cfg = content.rules.sim.work;
      if (world.tick < (player.cooldowns['work'] ?? 0)) {
        emit(world, 'ui_toast', { text: cfg.toastCooldown, tone: 'info' });
        return fail('cooldown');
      }
      player.cooldowns['work'] = world.tick + cfg.cooldownTicks;
      player.wallet += cfg.pay;
      player.needs['fun'] = Math.max(0, player.needs['fun'] - cfg.funCost);
      emit(world, 'work_done', { amount: cfg.pay });
      emit(world, 'ui_toast', { text: cfg.toastDone.replace('{amount}', String(cfg.pay)), tone: 'good' });
      return ok();
    }
    case 'buy_block': {
      const b = world.blocks[cmd.block];
      if (!b?.availability) return fail('not_for_sale');
      applyEffect(world, content, { op: 'buy', target: b.id, price: b.availability.price }, { actor: actorId });
      return ok();
    }
    case 'junta_vote': {
      if (!world.junta) return fail('no_junta');
      // Multijugador: cada humano registra su voto; la votación se cierra cuando han votado todos.
      world.junta.votes[actorId] = cmd.vote;
      const humans = Object.values(world.residents).filter((r) => r.controller.type === 'human' && r.present);
      const pending = humans.filter((h) => !world.junta!.votes[h.id]);
      if (pending.length > 0) {
        emit(world, 'junta_vote_registered', { resident: actorId, pendingHumans: pending.length });
        return ok();
      }
      castVotes(world, content);
      resolveJunta(world, content);
      advanceMissions(world, content);
      return ok();
    }
    case 'knock': {
      const b = world.blocks[cmd.block];
      if (!b) return fail('unknown_block');
      const target = Object.values(world.residents).find((r) => r.present && r.id !== world.playerId && (r.home === b.id || r.location === b.id));
      if (!target) {
        emit(world, 'ui_toast', { text: 'Nadie responde. Aunque tienes la sensación de ser observado.', tone: 'info' });
        return fail('nobody_home');
      }
      const { line, asleep } = knockLine(world, content, target.id);
      // Afinidad mutua: llamar a la puerta siempre suma un poquito (salvo si duerme).
      if (!asleep) {
        const gain = content.rules.sim.knock.affinityGain;
        let rel = player.relations.find((x) => x.with === target.id);
        if (!rel) player.relations.push((rel = { with: target.id, affinity: 0, trust: 0 }));
        rel.affinity += gain;
        let rel2 = target.relations.find((x) => x.with === world.playerId);
        if (!rel2) target.relations.push((rel2 = { with: world.playerId, affinity: 0, trust: 0 }));
        rel2.affinity += gain;
      }
      emit(world, 'knock_result', { resident: target.id, block: b.id, line, asleep, name: content.archetypes[target.archetype]?.name ?? target.id });
      return ok();
    }
    case 'place_furniture': {
      const cfg = content.rules.furniture;
      const b = world.blocks[cmd.block];
      const item = content.furniture[cmd.item];
      if (!b || !item) return fail('unknown_target');
      if (b.ownerId !== world.playerId) return fail('not_yours');
      const room = b.rooms.find((r) => r.key === cmd.room);
      if (!room) return fail('unknown_target');
      if (room.access !== 'unlocked') return fail('room_locked');
      if (room.furniture[cmd.slot]) return fail('slot_occupied');
      const slot = content.rooms[room.defId]?.furnitureSlots?.find((s) => s.id === cmd.slot);
      if (!slot || !item.slots.includes(slot.kind)) return fail('slot_mismatch');
      if (player.wallet < item.price) {
        emit(world, 'ui_toast', { text: cfg.errors['no_money'] ?? 'Sin fondos.', tone: 'bad' });
        return fail('no_money');
      }
      player.wallet -= item.price;
      room.furniture[cmd.slot] = item.id;
      for (const p of item.params ?? []) applyFurnitureParam(world, content, b.id, room, p.param, p.delta);
      emit(world, 'furniture_placed', { block: b.id, room: room.key, slot: cmd.slot, item: item.id, price: item.price, name: item.name, emoji: item.emoji ?? '\ud83d\udce6' });
      emit(world, 'ui_toast', { text: `${item.emoji ?? '\ud83d\udce6'} ${item.name} colocado.`, tone: 'good' });
      return ok();
    }
    case 'remove_furniture': {
      const cfg = content.rules.furniture;
      const b = world.blocks[cmd.block];
      if (!b) return fail('unknown_target');
      if (b.ownerId !== world.playerId) return fail('not_yours');
      const room = b.rooms.find((r) => r.key === cmd.room);
      if (!room) return fail('unknown_target');
      const itemId = room.furniture[cmd.slot];
      if (!itemId) return fail('slot_empty');
      room.furniture[cmd.slot] = '';
      const item = content.furniture[itemId];
      if (item) {
        for (const p of item.params ?? []) applyFurnitureParam(world, content, b.id, room, p.param, -p.delta);
        const refund = Math.round(item.price * cfg.refundRatio);
        player.wallet += refund;
        emit(world, 'furniture_removed', { block: b.id, room: room.key, slot: cmd.slot, item: itemId, refund, name: item.name, emoji: item.emoji ?? '\ud83d\udce6' });
        emit(world, 'ui_toast', { text: `${item.emoji ?? '\ud83d\udce6'} ${item.name} retirado (+${refund} \u20ac de vuelta).`, tone: 'info' });
      }
      return ok();
    }
    case 'renovate_room': {
      const cfg = content.rules.furniture.roomUnlock;
      const b = world.blocks[cmd.block];
      if (!b) return fail('unknown_target');
      if (b.ownerId !== world.playerId) return fail('not_yours');
      const room = b.rooms.find((r) => r.key === cmd.room);
      if (!room) return fail('unknown_target');
      if (room.access === 'unlocked') return fail('room_open');
      if (player.wallet < cfg.price) {
        emit(world, 'ui_toast', { text: content.rules.furniture.errors['no_money'] ?? 'Sin fondos.', tone: 'bad' });
        return fail('no_money');
      }
      player.wallet -= cfg.price;
      room.access = 'unlocked';
      emit(world, 'room_renovated', { block: b.id, room: room.key, price: cfg.price });
      emit(world, 'ui_toast', { text: cfg.toast, tone: 'good' });
      return ok();
    }
    case 'complete_minigame': {
      // El estado del minijuego es presentación; el núcleo solo aplica las consecuencias del catálogo.
      const def = content.minigames[cmd.id];
      if (!def) return fail('unknown_target');
      applyEffects(world, content, cmd.success ? def.onSuccess : def.onFail, { actor: actorId });
      emit(world, 'minigame_finished', { minigame: def.id, success: cmd.success });
      return ok();
    }
  }
}

/** Punto de entrada único para las órdenes del jugador (o de la IA): valida, aplica y avanza las misiones. */
export function dispatch(world: World, content: Content, cmd: Command): CommandResult {
  const result = run(world, content, cmd);
  advanceMissions(world, content);
  return result;
}
