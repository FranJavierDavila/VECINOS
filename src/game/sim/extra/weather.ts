import type { Content, Weather, World } from '@/game/core/types';
import { emit } from '../events';
import { nextRandom } from '../rng';

/** El clima cambia cada X horas de juego; ciclo y duración viven en content.rules.sim.weather. */
export function updateWeather(world: World, content: Content): void {
  const cfg = content.rules.sim.weather;
  if (world.tick < world.weather.nextChangeMinute) return;
  let roll = nextRandom(world);
  let next: Weather = cfg.cycle[0]?.state ?? 'sunny';
  for (const w of cfg.cycle) {
    if (roll < w.weight) {
      next = w.state;
      break;
    }
    roll -= w.weight;
  }
  const span = Math.max(1, cfg.durationMinutes.max - cfg.durationMinutes.min);
  const duration = cfg.durationMinutes.min + Math.floor(nextRandom(world) * span);
  const changed = world.weather.state !== next;
  world.weather.state = next;
  world.weather.nextChangeMinute = world.tick + duration;
  if (changed) emit(world, 'weather_changed', { state: next });
}
