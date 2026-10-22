import type { Content, ParamDef, ParamValue } from '@vecinos/content';
import type { World } from './types';

export interface VisibleParam {
  name: string;
  value: ParamValue;
  def: ParamDef;
}

export function playerHome(world: World): string {
  return world.residents[world.playerId]!.home;
}

/**
 * Parámetros que el jugador ve de un bloque: los de nivel <= nivel revelado, más los revelados uno a uno,
 * menos los ocultados. La simulación calcula todos igualmente; esto solo afecta a la interfaz.
 * Un parámetro sin `tier` queda oculto hasta que se revele por nombre.
 */
export function visibleParams(world: World, content: Content, blockId: string): VisibleParam[] {
  const b = world.blocks[blockId];
  if (!b) return [];
  const def = content.blocks[b.defId]!;
  const p = world.progress;
  return Object.entries(def.params)
    .filter(([name, d]) => {
      if (p.hiddenParams.includes(name)) return false;
      return (d.tier !== undefined && d.tier <= p.revealedTier) || p.revealedParams.includes(name);
    })
    .map(([name, d]) => ({ name, value: b.params[name] ?? d.default, def: d }));
}

export interface Objective {
  mission: string;
  title: string;
  state: 'active' | 'awaiting_choice';
  step: { id: string; type: string; block?: string; dialog?: string } | null;
  untilTick: number | null;
}

/** Objetivo que se muestra al jugador: la primera misión en curso. */
export function activeObjective(world: World, content: Content): Objective | null {
  const m = world.missions.find((x) => x.state === 'active' || x.state === 'awaiting_choice');
  if (!m) return null;
  const def = content.missions[m.id]!;
  const s = m.state === 'active' ? def.steps[m.step] : undefined;
  const home = world.residents[world.playerId]!.home;
  const block = s?.type === 'reach' ? s.target.block : s?.type === 'enter' ? s.target : undefined;
  return {
    mission: m.id,
    title: def.title,
    state: m.state as 'active' | 'awaiting_choice',
    step: s ? { id: s.id, type: s.type, block: block === '$home' ? home : block, dialog: s.type === 'phone_call' ? s.dialog : undefined } : null,
    untilTick: m.until,
  };
}
