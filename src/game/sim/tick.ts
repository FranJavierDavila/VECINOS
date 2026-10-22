import type { Content, World } from '@/game/core/types';
import { propagate, emissionsFromActivities } from './influence';
import { advanceMissions } from './missions';
import { updateWeather } from './extra/weather';
import { runAI } from './extra/ai';
import { economyTick } from './extra/economy';

/** Avanza un minuto de juego: clima → IA → emisiones → influencias → misiones → economía. */
export function tick(world: World, content: Content): void {
  world.tick += 1;
  world.clock.minute += 1;
  if (world.clock.minute >= 1440) {
    world.clock.minute = 0;
    world.clock.day += 1;
  }
  updateWeather(world, content);
  runAI(world, content);
  propagate(world, content, emissionsFromActivities(world, content));
  economyTick(world, content);
  advanceMissions(world, content);
}
