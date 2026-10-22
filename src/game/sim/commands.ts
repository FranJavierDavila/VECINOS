import type { Command, Content, World } from '@/game/core/types';
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
  if (r.activity === 'sleep') return { line: 'Zzz... zzz... (no abre, pero sí sueña)', asleep: true };
  const pool = Object.values(arch?.activities ?? {}).flatMap((a) => a.say ?? []);
  const fallback = ['¿Quién es? ¡Ahora bajo! ...(no baja)'];
  const line = pool.length > 0 ? pool[Math.floor(nextRandom(world) * pool.length)]! : fallback[0]!;
  return { line, asleep: false };
}

function run(world: World, content: Content, cmd: Command): CommandResult {
  const player = world.residents[world.playerId]!;
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
      applyEffects(world, content, choice.effects, { roles: m.roles });
      completeMission(world, content, m);
      return ok();
    }
    case 'work': {
      if (world.tick < (player.cooldowns['work'] ?? 0)) {
        emit(world, 'ui_toast', { text: 'Acabas de cerrar el portátil. Tus ojos te lo agradecen.', tone: 'info' });
        return fail('cooldown');
      }
      player.cooldowns['work'] = world.tick + 120;
      player.wallet += 120;
      player.needs['fun'] = Math.max(0, player.needs['fun'] - 10);
      emit(world, 'work_done', { amount: 120 });
      emit(world, 'ui_toast', { text: '+120 €: "reunión que podía ser un correo" (x1).', tone: 'good' });
      return ok();
    }
    case 'buy_block': {
      const b = world.blocks[cmd.block];
      if (!b?.availability) return fail('not_for_sale');
      applyEffect(world, content, { op: 'buy', target: b.id, price: b.availability.price });
      return ok();
    }
    case 'junta_vote': {
      if (!world.junta) return fail('no_junta');
      castVotes(world, content);
      resolveJunta(world, content, cmd.vote);
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
        let rel = player.relations.find((x) => x.with === target.id);
        if (!rel) player.relations.push((rel = { with: target.id, affinity: 0, trust: 0 }));
        rel.affinity += 2;
        let rel2 = target.relations.find((x) => x.with === world.playerId);
        if (!rel2) target.relations.push((rel2 = { with: world.playerId, affinity: 0, trust: 0 }));
        rel2.affinity += 2;
      }
      emit(world, 'knock_result', { resident: target.id, block: b.id, line, asleep, name: content.archetypes[target.archetype]?.name ?? target.id });
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
