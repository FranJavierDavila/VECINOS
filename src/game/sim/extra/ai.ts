import type { Content, ResidentInstance, ScheduleWindow, World } from '@/game/core/types';
import { emit } from '../events';
import { nextRandom } from '../rng';
import { applyEffects, resolveBlocks } from '../effects';
import { nextStepTowards } from '../graph';

/**
 * IA de los vecinos: sin física y SIN datos de gameplay. Cada arquetipo declara sus
 * actividades con ventanas horarias (schedule) en el catálogo; aquí solo está el algoritmo
 * genérico que las evalúa. Los vecinos se mueven por el grafo de circulación (2 ticks por paso).
 */

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** ¿Está `minute` dentro de la ventana? Si `to` ≤ `from`, la ventana cruza medianoche. */
export function inMinuteWindow(minute: number, w: { from: string; to?: string }): boolean {
  const from = toMinutes(w.from);
  const to = w.to ? toMinutes(w.to) : 1440;
  return to <= from ? minute >= from || minute < to : minute >= from && minute < to;
}

function windowActive(w: ScheduleWindow, minute: number, day: number): boolean {
  if (w.days === 'even' && day % 2 !== 0) return false;
  if (w.days === 'odd' && day % 2 !== 1) return false;
  return inMinuteWindow(minute, w);
}

/** Decide la actividad deseada del residente: primera actividad cuyo schedule encaje (orden del catálogo). */
function desire(world: World, content: Content, r: ResidentInstance): [string | null, 'home' | 'corridor' | 'core' | 'stairs' | 'out' | `def:${string}`] {
  const acts = content.archetypes[r.archetype]?.activities ?? {};
  const { night } = content.rules.sim;
  const minute = world.clock.minute;
  const day = world.clock.day;

  // Por la noche manda el sueño (si el arquetipo sabe dormir).
  if (inMinuteWindow(minute, night) && acts['sleep']) return ['sleep', 'home'];

  for (const [id, a] of Object.entries(acts)) {
    for (const w of a.schedule ?? []) {
      if (!windowActive(w, minute, day)) continue;
      if (w.chance !== undefined && nextRandom(world) >= w.chance) continue;
      return [id, a.at ?? 'home'];
    }
  }
  return ['idle', 'home'];
}

function corridorOf(world: World, floor: number): string | null {
  return Object.values(world.blocks).find((b) => b.layer === 'corridor' && b.cell.floor === floor)?.id ?? null;
}
function coreOf(world: World, floor: number): string | null {
  return Object.values(world.blocks).find((b) => b.layer === 'main' && b.cell.floor === floor && !!b.params.elevator_status)?.id ?? null;
}
function stairsOf(world: World, content: Content, floor: number): string | null {
  return Object.values(world.blocks).find((b) => b.cell.floor === floor && content.blocks[b.defId]!.features?.stairs === true)?.id ?? null;
}
/**
 * Resuelve `def:<blockDefId>`: la instancia de ese tipo más cercana a la vivienda del residente
 * (distancia de rejilla |Δplanta|·4 + |Δcolumna|, desempate por id — determinista y sin grafo).
 */
function blockOfDef(world: World, defId: string, homeId: string): string | null {
  const home = world.blocks[homeId];
  const candidates = Object.values(world.blocks)
    .filter((b) => b.defId === defId)
    .sort((a, b) => {
      const da = home ? Math.abs(a.cell.floor - home.cell.floor) * 4 + Math.abs(a.cell.col - home.cell.col) : 0;
      const db = home ? Math.abs(b.cell.floor - home.cell.floor) * 4 + Math.abs(b.cell.col - home.cell.col) : 0;
      return da - db || a.id.localeCompare(b.id);
    });
  return candidates[0]?.id ?? null;
}

function setActivity(world: World, content: Content, r: ResidentInstance, activity: string | null) {
  if (r.activity === activity) return;
  if (r.activity) emit(world, 'activity_ended', { resident: r.id, activity: r.activity });
  r.activity = activity;
  if (activity) {
    emit(world, 'activity_started', { resident: r.id, activity, archetype: r.archetype });
    // Efectos al empezar, declarados en el catálogo (p. ej. pintar la cabina ensucia).
    const onStart = content.archetypes[r.archetype]?.activities[activity]?.onStart;
    if (onStart?.length) applyEffects(world, content, onStart, {});
  }
}

/** Un paso de IA por tick para cada vecino IA/script presente. */
export function runAI(world: World, content: Content): void {
  for (const r of Object.values(world.residents).sort((a, b) => a.id.localeCompare(b.id))) {
    if (r.controller.type === 'human' || !r.present) continue;

    const [activity, where] = desire(world, content, r);
    const homeFloor = world.blocks[r.home]!.cell.floor;
    const targetBlock = where === 'home' ? r.home : where === 'corridor' ? corridorOf(world, homeFloor) : where === 'core' ? coreOf(world, homeFloor) : where === 'stairs' ? stairsOf(world, content, homeFloor) : where.startsWith('def:') ? blockOfDef(world, where.slice('def:'.length), r.home) : null;

    if (where === 'out') {
      if (r.location !== null) {
        r.location = null;
        emit(world, 'resident_left', { resident: r.id });
      }
      setActivity(world, content, r, activity);
      continue;
    }

    // Volver al edificio: entra por el portal del mundo.
    if (r.location === null) {
      r.location = world.entry;
      emit(world, 'resident_moved', { resident: r.id, block: world.entry });
    }

    if (targetBlock && r.location !== targetBlock) {
      if (world.tick >= (r.cooldowns['hop'] ?? 0)) {
        const step = nextStepTowards(world, content, r.location, targetBlock);
        if (step) {
          r.location = step;
          emit(world, 'resident_moved', { resident: r.id, block: step });
          r.cooldowns['hop'] = world.tick + content.rules.sim.aiHopTicks;
        }
      }
      // De camino: sin actividad destacable (pasea).
      setActivity(world, content, r, null);
    } else {
      setActivity(world, content, r, activity);
    }
  }
}
