import type { Content, Direction, World } from '@/game/core/types';
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

/** Emisiones de las actividades en curso (ruido, agua...) desde el bloque donde ocurren. */
export function emissionsFromActivities(world: World, content: Content): Emissions {
  const out: Emissions = {};
  for (const r of Object.values(world.residents)) {
    if (!r.present || !r.activity || r.location === null) continue;
    const act = content.archetypes[r.archetype]?.activities[r.activity];
    const emits = act?.emits;
    if (!emits) continue;
    // La actividad emite desde DONDE ocurre: 'home' (o sin destino) desde la vivienda;
    // cualquier destino externo (corridor/core/stairs/def:bar…) desde el bloque en que está.
    const from = !act.at || act.at === 'home' ? r.home : r.location ?? r.home;
    for (const [channel, v] of Object.entries(emits)) {
      const bucket = (out[channel] ??= {});
      bucket[from] = Math.max(bucket[from] ?? 0, v);
    }
  }
  return out;
}

/**
 * Emisiones persistentes del editor de interiores: cada mueble colocado emite desde su bloque.
 * Valores negativos = absorbentes (reducen el canal en su propio bloque; los aplica `propagate`).
 */
export function emissionsFromFurniture(world: World, content: Content): Emissions {
  const out: Emissions = {};
  for (const b of Object.values(world.blocks)) {
    for (const room of b.rooms) {
      for (const itemId of Object.values(room.furniture ?? {})) {
        const emits = content.furniture[itemId]?.emits;
        if (!emits) continue;
        for (const [channel, v] of Object.entries(emits)) {
          const bucket = (out[channel] ??= {});
          bucket[b.id] = (bucket[b.id] ?? 0) + v;
        }
      }
    }
  }
  return out;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Un paso de propagación: cada canal decae, recibe las emisiones del tick (atenuadas por el receptor)
 * y dispara su evento al cruzar el umbral hacia arriba. Orden estable por id: determinista.
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
    // Absorción local: los muebles negativos reducen el nivel recibido en su propio bloque.
    for (const absorber of Object.keys(em).sort()) {
      const v = em[absorber]!;
      if (v < 0 && state[absorber] !== undefined) {
        state[absorber] = Math.max(0, state[absorber]! + v);
        if (state[absorber]! < 1e-6) delete state[absorber];
      }
    }
    for (const emitter of Object.keys(em).sort()) {
      if (em[emitter]! <= 0) continue;
      for (const n of nb.get(emitter) ?? []) {
        const factor = rule.spread[n.dir];
        if (!factor) continue;
        // Atenuación por aislamiento en CUALQUIERA de los dos extremos: manda el que más apaga
        // (un local insonorizado no deja salir ruido aunque el receptor sea una caseta de obra).
        let att = 1;
        if (rule.attenuatedBy) {
          const pr = world.blocks[n.id]!.params[rule.attenuatedBy];
          const pe = world.blocks[emitter]!.params[rule.attenuatedBy];
          const fr = typeof pr === 'number' ? 1 - Math.min(1, Math.max(0, pr)) : 1;
          const fe = typeof pe === 'number' ? 1 - Math.min(1, Math.max(0, pe)) : 1;
          att = Math.min(fr, fe);
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
