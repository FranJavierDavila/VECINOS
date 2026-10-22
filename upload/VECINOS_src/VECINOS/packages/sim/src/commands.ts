import type { Content } from '@vecinos/content';
import type { World } from './types';
import { emit } from './events';
import { applyEffects } from './effects';
import { advanceMissions, completeMission, notify } from './missions';

export type Command =
  | { type: 'move'; resident: string; to: string }
  | { type: 'approach'; resident: string; block: string }
  | { type: 'answer_call'; mission: string }
  | { type: 'choose'; mission: string; choice: string };

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

const ok = (): CommandResult => ({ ok: true });
const fail = (reason: string): CommandResult => ({ ok: false, reason });

/**
 * Reglas de circulación: en la misma planta se pasa siempre por el pasillo (nunca de vivienda a vivienda ni
 * de vivienda a zona común sin salir); entre plantas solo de núcleo a núcleo contiguo (escalera o ascensor).
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

function run(world: World, content: Content, cmd: Command): CommandResult {
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
  }
}

/** Punto de entrada único para las órdenes del jugador (o de la IA): valida, aplica y avanza las misiones. */
export function dispatch(world: World, content: Content, cmd: Command): CommandResult {
  const result = run(world, content, cmd);
  advanceMissions(world, content);
  return result;
}
