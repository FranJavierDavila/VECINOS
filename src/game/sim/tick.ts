import type { Content, World } from '@/game/core/types';
import { propagate, emissionsFromActivities, emissionsFromFurniture, type Emissions } from './influence';
import { advanceMissions } from './missions';
import { updateWeather } from './extra/weather';
import { runAI } from './extra/ai';
import { economyTick } from './extra/economy';
import { socialTick } from './extra/social';
import { protestTick } from './extra/protest';
import { roofTick } from './extra/roof';
import { gambleTick } from './extra/gamble';

/** Combina dos paquetes de emisiones (canal → bloque → intensidad), quedándose con el máximo. */
function mergeEmissions(a: Emissions, b: Emissions): Emissions {
  const out: Emissions = { ...a };
  for (const [channel, blocks] of Object.entries(b))
    for (const [block, v] of Object.entries(blocks)) out[channel] = { ...out[channel], [block]: Math.max(out[channel]?.[block] ?? 0, v) };
  return out;
}

/** Avanza un minuto de juego: clima → IA → social → protesta → tejado → juego ilegal → emisiones (actividades + muebles) → influencias → misiones → economía. */
export function tick(world: World, content: Content, extraEmissions?: Emissions): void {
  world.tick += 1;
  world.clock.minute += 1;
  if (world.clock.minute >= 1440) {
    world.clock.minute = 0;
    world.clock.day += 1;
  }
  updateWeather(world, content);
  runAI(world, content);
  socialTick(world, content); // v1.79 — cotilleo de pasillos (capa social, opcional: sin catálogo no hace nada)
  protestTick(world, content); // v1.80 — protesta por apagón (observa el param de luz del pasillo; sin bloque protest no hace nada)
  roofTick(world, content); // v1.81 — tormenta daña el tejado y gotea a los áticos (solo con tormenta)
  gambleTick(world, content); // v1.81 — juego ilegal nocturno del anfitrión (sin anfitrión no hay mesa)
  let emissions = mergeEmissions(emissionsFromActivities(world, content), emissionsFromFurniture(world, content));
  if (extraEmissions) emissions = mergeEmissions(emissions, extraEmissions);
  propagate(world, content, emissions);
  economyTick(world, content);
  advanceMissions(world, content);
}
