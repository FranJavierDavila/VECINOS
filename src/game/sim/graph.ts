import type { Content, World } from '@/game/core/types';

export const STAIRS_COST = 3;
export const ELEVATOR_COST = 1;
const WALK_COST = 1;

export interface Graph {
  nodes: string[];
  edges: Map<string, Map<string, number>>;
}

function link(g: Graph, a: string, b: string, cost: number) {
  for (const [x, y] of [[a, b], [b, a]] as const) {
    if (!g.edges.has(x)) g.edges.set(x, new Map());
    const prev = g.edges.get(x)!.get(y);
    g.edges.get(x)!.set(y, prev === undefined ? cost : Math.min(prev, cost));
  }
}

const elevatorWorks = (world: World, content: Content, id: string) => {
  const b = world.blocks[id]!;
  return content.blocks[b.defId]!.features?.elevator === true && b.params.elevator_status === 'ok';
};

/**
 * Grafo de circulación (nodos = bloques, aristas = minutos de viaje):
 * cada bloque de la capa principal se conecta con el pasillo de su planta; los bloques con
 * features.stairs o features.elevator se encadenan por columna entre plantas contiguas:
 * la escalera siempre (coste STAIRS_COST) y el ascensor solo si funciona en ambas plantas
 * (coste ELEVATOR_COST). Un bloque puede tener ambos (escalera de emergencia del ascensor)
 * o solo uno: la escalera y el ascensor son pozos independientes, en la columna que diga el template.
 * De la regla emerge que la escalera de la planta 0 no baja (no hay planta -1) y la de la
 * última no sube: simplemente no existen esas aristas.
 */
export function buildCirculation(world: World, content: Content): Graph {
  const blocks = Object.values(world.blocks);
  const g: Graph = { nodes: blocks.map((b) => b.id), edges: new Map() };
  const corridors = blocks.filter((b) => b.layer === 'corridor' && content.blocks[b.defId]!.traversable);
  for (const c of corridors)
    for (const b of blocks) if (b.layer === 'main' && b.cell.floor === c.cell.floor) link(g, c.id, b.id, WALK_COST);

  const shafts = blocks.filter((b) => {
    const f = content.blocks[b.defId]!.features;
    return !!f && (f.stairs === true || f.elevator === true);
  });
  for (const a of shafts) {
    const b = shafts.find((x) => x.cell.col === a.cell.col && x.cell.floor === a.cell.floor + 1);
    if (!b) continue;
    const fa = content.blocks[a.defId]!.features!;
    const fb = content.blocks[b.defId]!.features!;
    if (fa.stairs && fb.stairs) link(g, a.id, b.id, STAIRS_COST);
    if (fa.elevator && fb.elevator && elevatorWorks(world, content, a.id) && elevatorWorks(world, content, b.id))
      link(g, a.id, b.id, ELEVATOR_COST);
  }
  return g;
}

/** Minutos de juego para ir de un bloque a otro (Dijkstra); Infinity si no hay camino. */
export function travelMinutes(g: Graph, from: string, to: string): number {
  const dist = new Map<string, number>(g.nodes.map((n) => [n, Infinity]));
  dist.set(from, 0);
  const open = new Set(g.nodes);
  while (open.size) {
    let u: string | null = null;
    for (const n of open) if (u === null || dist.get(n)! < dist.get(u)!) u = n;
    if (u === null || dist.get(u) === Infinity) break;
    open.delete(u);
    if (u === to) break;
    for (const [v, w] of g.edges.get(u) ?? []) dist.set(v, Math.min(dist.get(v)!, dist.get(u)! + w));
  }
  return dist.get(to) ?? Infinity;
}

/** Primer paso del camino más corto de `from` a `to`; null si no hay camino o ya estás allí. */
export function nextStepTowards(world: World, content: Content, from: string, to: string): string | null {
  if (from === to) return null;
  const g = buildCirculation(world, content);
  // Dijkstra desde `to` (el grafo es no dirigido): distTo[n] = coste mínimo n → to.
  const distTo = new Map<string, number>(g.nodes.map((n) => [n, Infinity]));
  distTo.set(to, 0);
  const open = new Set(g.nodes);
  while (open.size) {
    let u: string | null = null;
    for (const n of open) if (u === null || distTo.get(n)! < distTo.get(u)!) u = n;
    if (u === null || distTo.get(u)! === Infinity) break;
    open.delete(u);
    for (const [v, w] of g.edges.get(u) ?? []) distTo.set(v, Math.min(distTo.get(v)!, distTo.get(u)! + w));
  }
  if (distTo.get(from) === Infinity) return null;
  // El siguiente salto es el vecino que minimiza w(from→v) + distTo(v).
  let best: string | null = null;
  let bestCost = Infinity;
  for (const [v, w] of g.edges.get(from) ?? []) {
    const cost = w + distTo.get(v)!;
    if (cost < bestCost) {
      bestCost = cost;
      best = v;
    }
  }
  return best;
}
