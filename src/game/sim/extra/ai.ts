import type { Content, ResidentInstance, World } from '@/game/core/types';
import { emit } from '../events';
import { nextRandom } from '../rng';
import { applyEffect, resolveBlocks } from '../effects';
import { nextStepTowards } from '../graph';

/**
 * IA de los vecinos: sin física. Eligen actividad por horario y arquetipo y se mueven
 * por el grafo de circulación hop a hop (2 ticks por paso). La vista las interpola.
 */

const isNight = (minute: number) => minute >= 23 * 60 || minute < 7 * 60 + 30;

function corridorOf(world: World, floor: number): string | null {
  return Object.values(world.blocks).find((b) => b.layer === 'corridor' && b.cell.floor === floor)?.id ?? null;
}
function coreOf(world: World, floor: number): string | null {
  return Object.values(world.blocks).find((b) => b.layer === 'main' && b.cell.floor === floor && !!b.params.elevator_status)?.id ?? null;
}

/** Decide la actividad deseada del residente según su arquetipo y la hora. Devuelve [actividad, destino]. */
function desire(world: World, content: Content, r: ResidentInstance): [string | null, 'home' | 'corridor' | 'core' | 'out'] {
  const m = world.clock.minute;
  const day = world.clock.day;
  const has = (a: string) => !!content.archetypes[r.archetype]?.activities[a];

  if (isNight(m)) return [has('sleep') ? 'sleep' : null, 'home'];

  switch (r.archetype) {
    case 'cotilla':
      if (m >= 7 * 60 + 30 && m < 9 * 60) return ['watch_corridor', 'corridor'];
      if (m >= 17 * 60 && m < 19 * 60) return [nextRandom(world) < 0.6 ? 'tv_loud' : 'watch_corridor', nextRandom(world) < 0.6 ? 'home' : 'corridor'];
      return ['idle', 'home'];
    case 'fiestero':
      if (m >= 10 * 60 + 30 && m < 19 * 60) return ['out', 'out'];
      if (m >= 21 * 60 + 30 || m < 60) return [nextRandom(world) < 0.75 ? 'party' : 'idle', 'home'];
      return ['idle', 'home'];
    case 'jubilada':
      if (m >= 10 * 60 + 30 && m < 11 * 60 + 10 && day % 2 === 0) return ['laundry', 'home'];
      if ((m >= 8 * 60 && m < 8 * 60 + 40) || (m >= 12 * 60 && m < 12 * 60 + 40) || (m >= 18 * 60 && m < 18 * 60 + 40)) return ['chair', 'corridor'];
      return ['idle', 'home'];
    case 'presidente':
      if (m >= 12 * 60 && m < 12 * 60 + 30) return ['stroll', 'corridor'];
      if (m >= 17 * 60 && m < 17 * 60 + 30) return ['stroll', 'corridor'];
      return ['idle', 'home'];
    case 'estudiante':
      if (m >= 8 * 60 && m < 15 * 60) return ['out', 'out'];
      if (m >= 16 * 60 && m < 22 * 60) return ['study_music', 'home'];
      return ['idle', 'home'];
    case 'nino_grafitero':
      if (m >= 8 * 60 && m < 15 * 60) return ['out', 'out'];
      if (m >= 16 * 60 && m < 19 * 60) return [nextRandom(world) < 0.4 ? 'paint_cabin' : 'roam', 'core'];
      return ['idle', 'home'];
    case 'fondo_buitre':
      if ((m >= 9 * 60 + 30 && m < 10 * 60) || (m >= 14 * 60 && m < 14 * 60 + 30)) return ['stroll', 'corridor'];
      return ['idle', 'home'];
    case 'inquilino':
      if (m >= 8 * 60 && m < 14 * 60) return ['out', 'out'];
      return ['idle', 'home'];
    default:
      return ['idle', 'home'];
  }
}

function setActivity(world: World, content: Content, r: ResidentInstance, activity: string | null) {
  if (r.activity === activity) return;
  if (r.activity) emit(world, 'activity_ended', { resident: r.id, activity: r.activity });
  r.activity = activity;
  if (activity) {
    emit(world, 'activity_started', { resident: r.id, activity, archetype: r.archetype });
    // Efectos especiales de actividades concretas.
    if (activity === 'paint_cabin') {
      const core = resolveBlocks(world, content, 'nucleo').find((b) => b.cell.floor === world.blocks[r.home]?.cell.floor) ?? resolveBlocks(world, content, 'nucleo')[0];
      if (core) applyEffect(world, content, { op: 'setParam', target: core.id, param: 'cabin_graffiti', delta: 15 });
    }
  }
}

/** Un paso de IA por tick para cada vecino IA/script presente. */
export function runAI(world: World, content: Content): void {
  for (const r of Object.values(world.residents).sort((a, b) => a.id.localeCompare(b.id))) {
    if (r.controller.type === 'human' || !r.present) continue;

    const [activity, where] = desire(world, content, r);
    const targetBlock = where === 'home' ? r.home : where === 'corridor' ? corridorOf(world, world.blocks[r.home]!.cell.floor) : where === 'core' ? coreOf(world, world.blocks[r.home]!.cell.floor) : null;

    if (where === 'out') {
      if (r.location !== null) {
        r.location = null;
        emit(world, 'resident_left', { resident: r.id });
      }
      setActivity(world, content, r, activity);
      continue;
    }

    // Volver al edificio: entra por el portal.
    if (r.location === null) {
      r.location = 'blk_p0_portal';
      emit(world, 'resident_moved', { resident: r.id, block: 'blk_p0_portal' });
    }

    if (targetBlock && r.location !== targetBlock) {
      if (world.tick >= (r.cooldowns['hop'] ?? 0)) {
        const step = nextStepTowards(world, content, r.location, targetBlock);
        if (step) {
          r.location = step;
          emit(world, 'resident_moved', { resident: r.id, block: step });
          r.cooldowns['hop'] = world.tick + 2;
        }
      }
      // De camino: sin actividad destacable (pasea).
      setActivity(world, content, r, null);
    } else {
      setActivity(world, content, r, activity);
    }
  }
}
