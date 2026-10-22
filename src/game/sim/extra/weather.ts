import type { Content, Weather, World } from '@/game/core/types';
import { emit } from '../events';
import { nextRandom } from '../rng';

const WEATHER_CYCLE: { state: Weather; weight: number }[] = [
  { state: 'sunny', weight: 0.4 },
  { state: 'cloudy', weight: 0.25 },
  { state: 'rain', weight: 0.22 },
  { state: 'storm', weight: 0.13 },
];

/** El clima cambia cada 3-8 h de juego. `nextChangeMinute` es un tick absoluto del mundo. */
export function updateWeather(world: World, _content: Content): void {
  if (world.tick < world.weather.nextChangeMinute) return;
  let roll = nextRandom(world);
  let next: Weather = 'sunny';
  for (const w of WEATHER_CYCLE) {
    if (roll < w.weight) {
      next = w.state;
      break;
    }
    roll -= w.weight;
  }
  const duration = 180 + Math.floor(nextRandom(world) * 300);
  const changed = world.weather.state !== next;
  world.weather.state = next;
  world.weather.nextChangeMinute = world.tick + duration;
  if (changed) emit(world, 'weather_changed', { state: next });
}
