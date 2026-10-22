import type { GameEvent, World } from './types';

export function emit(world: World, type: string, data: Record<string, unknown> = {}): void {
  world.events.push({ tick: world.tick, type, data });
}

/** Devuelve y vacía la cola de eventos (la usa la presentación, el audio, las misiones...). */
export function drainEvents(world: World): GameEvent[] {
  return world.events.splice(0, world.events.length);
}
