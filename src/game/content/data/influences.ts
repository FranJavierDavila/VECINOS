import type { InfluenceRule } from '@/game/core/types';

/** Reglas de influencia: el motor del humor. Se propagan por adyacencia sin tocar código. */
export const INFLUENCE_RULES: InfluenceRule[] = [
  {
    id: 'noise',
    channel: 'noise',
    spread: { horizontal: 1.0, up: 0.8, down: 0.6, diagonal: 0.3, corridor: 0.5 },
    attenuatedBy: 'soundproofing',
    decayPerTick: 0.1,
    threshold: 0.35,
    onThreshold: { emitEvent: 'noise_complaint' },
  },
  {
    id: 'water',
    channel: 'water',
    spread: { down: 1.0 },
    decayPerTick: 0.02,
    threshold: 0.2,
    onThreshold: { emitEvent: 'leak_detected', setParam: { param: 'humidity', delta: 8 } },
  },
];
