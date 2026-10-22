import type { Content, Direction } from '@vecinos/content';
import type { World } from './types';
import { emit } from './events';
import { applyEffect } from './effects';

export type Emissions = Record<string, Record<string, number>>; // canal → bloque → intensidad

interface Neighbor {
  id: string;
  dir: Direction;
}

const DIR_ORDER: Direction[] = ['horizontal', 'up', 'down', 'diagonal'];

/** Vecindad por adyacencia, vista desde cada bloque emisor (up = el vecino está encima). */
export function adjacency(world: World): Map<string, Neighbor[]> {
  const blocks = Object.values(world.blocks).sort((a, b) => a.id.localeCompare(b.id));
  const mains = blocks.filter((b) => b.layer === 'main');
  const cells = (b: (typeof blocks)[number]) => {
    const out: [number, number][] = [];
    for (let dc = 0; dc < b.size.w; dc++) for (let df = 0; df < b.size.h; df++) out.push([b.cell.col + dc, b.cell.floor + df]);
    return out;
  };
  const rel = (a: (typeof blocks)[number], b: (typeof blocks)[number]): Direction | null => {
    const found = new Set<Direction>();
    for (const [ca, fa] of cells(a))
      for (const [cb, fb] of cells(b)) {
        const dc = cb - ca;
        const df = fb - fa;
        if (df === 0 && Math.abs(dc) === 1) found.add('horizontal');
        else if (dc === 0 && df === 1) found.add('up');
        else if (dc === 0 && df === -1) found.add('down');
        else if (Math.abs(dc) === 1 && Math.abs(df) === 1) found.add('diagonal');
      }
    return DIR_ORDER.find((d) => found.has(d)) ?? null;
  };

  const out = new Map<string, Neighbor[]>();
  for (const b of blocks) out.set(b.id, []);
  for (const a of mains)
    for (const b of mains) {
      if (a.id === b.id) continue;
      const dir = rel(a, b);
      if (dir) out.get(a.id)!.push({ id: b.id, dir });
    }
  for (const c of blocks.filter((b) => b.layer === 'corridor'))
    for (const m of mains.filter((b) => b.cell.floor === c.cell.floor)) {
      out.get(m.id)!.push({ id: c.id, dir: 'corridor' });
      out.get(c.id)!.push({ id: m.id, dir: 'corridor' });
    }
  return out;
}

/** Emisiones de ruido, olores... de las actividades en curso de los residentes (en su vivienda). */
export function emissionsFromActivities(world: World, content: Content, active: { resident: string; activity: string }[]): Emissions {
  const out: Emissions = {};
  for (const { resident, activity } of active) {
    const r = world.residents[resident];
    const emits = r && content.archetypes[r.archetype]?.activities[activity]?.emits;
    if (!r || !r.present || !emits) continue;
    for (const [channel, v] of Object.entries(emits)) {
      const bucket = (out[channel] ??= {});
      bucket[r.home] = Math.max(bucket[r.home] ?? 0, v);
    }
  }
  return out;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Un paso de propagación: cada canal decae, recibe las emisiones del tick (atenuadas por el receptor)
 * y dispara su evento al cruzar el umbral hacia arriba. Orden estable por id, así que es determinista.
 */
export function propagate(world: World, content: Content, emissions: Emissions): void {
  const nb = adjacency(world);
  for (const rule of Object.values(content.influences).sort((a, b) => a.id.localeCompare(b.id))) {
    const state = (world.channels[rule.channel] ??= {});
    const before = { ...state };
    for (const id of Object.keys(state)) {
      state[id] = state[id]! * (1 - rule.decayPerTick);
      if (state[id]! < 1e-6) delete state[id];
    }
    const em = emissions[rule.channel] ?? {};
    for (const emitter of Object.keys(em).sort()) {
      for (const n of nb.get(emitter) ?? []) {
        const factor = rule.spread[n.dir];
        if (!factor) continue;
        let att = 1;
        if (rule.attenuatedBy) {
          const p = world.blocks[n.id]!.params[rule.attenuatedBy];
          if (typeof p === 'number') att = 1 - Math.min(1, Math.max(0, p));
        }
        const value = em[emitter]! * factor * att;
        if (value > (state[n.id] ?? 0)) state[n.id] = value;
      }
    }
    if (!rule.onThreshold) continue;
    for (const id of Object.keys(state).sort()) {
      if ((before[id] ?? 0) >= rule.threshold || state[id]! < rule.threshold) continue;
      emit(world, rule.onThreshold.emitEvent, {
        block: id,
        channel: rule.channel,
        value: round3(state[id]!),
        occupied: world.blocks[id]!.occupancy === 'occupied',
      });
      const sp = rule.onThreshold.setParam;
      if (sp) applyEffect(world, content, { op: 'setParam', target: id, param: sp.param, delta: sp.delta });
    }
  }
}
