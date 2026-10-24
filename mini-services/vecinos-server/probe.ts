/**
 * Probe de resolución de paths: Bun debe resolver '@/game/sim' vía tsconfig.json
 * (paths "@/*": ["../../src/*"], baseUrl "../../") hacia el núcleo del proyecto raíz.
 */
import { createWorld } from '@/game/sim';
import type { Command, World } from '@/game/core/types';

const cmd: Command = { type: 'work' };
const world: World | null = null;
console.log('paths ok ·', typeof createWorld === 'function', typeof cmd, world === null);
