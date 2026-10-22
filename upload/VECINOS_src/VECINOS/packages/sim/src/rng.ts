import type { World } from './types';

/** mulberry32 con el estado guardado en el mundo: misma semilla y mismas llamadas, mismos resultados. */
export function nextRandom(world: Pick<World, 'rngState'>): number {
  world.rngState = (world.rngState + 0x6d2b79f5) | 0;
  let t = world.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
