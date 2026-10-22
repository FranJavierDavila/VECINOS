import type { Content } from '@vecinos/content';
import type { World } from './types';
import { propagate, type Emissions } from './influence';
import { advanceMissions } from './missions';

/** Avanza un minuto de juego. Las emisiones del tick las aportan las actividades de los residentes. */
export function tick(world: World, content: Content, emissions: Emissions = {}): void {
  world.tick += 1;
  world.clock.minute += 1;
  if (world.clock.minute >= 1440) {
    world.clock.minute = 0;
    world.clock.day += 1;
  }
  propagate(world, content, emissions);
  advanceMissions(world, content);
}
