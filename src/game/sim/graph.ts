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
 * cada bloque de la capa principal se conecta con el pasillo de su planta; los núcleos se conectan
 * entre plantas contiguas por escalera (siempre) o por ascensor (solo si funciona en ambas plantas).
 */
export function buildCirculation(world: World, content: Content): Graph {
  const blocks = Object.values(world.blocks);
  const g: Graph = { nodes: blocks.map((b) => b.id), edges: new Map() };
  const corridors = blocks.filter((b) => b.layer === 'corridor' && content.blocks[b.defId]!.traversable);
  for (const c of corridors)
    for (const b of blocks) if (b.layer === 'main' && b.cell.floor === c.cell.floor) link(g, c.id, b.id, WALK_COST);

  const cores = blocks.filter((b) => content.blocks[b.defId]!.features?.stairs).sort((a, b) => a.cell.floor - b.cell.floor);
  for (let i = 0; i + 1 < cores.length; i++) {
    const a = cores[i]!;
    const b = cores[i + 1]!;
    if (b.cell.floor !== a.cell.floor + 1 || b.cell.col !== a.cell.col) continue;
    const useElevator = elevatorWorks(world, content, a.id) && elevatorWorks(world, content, b.id);
    link(g, a.id, b.id, useElevator ? ELEVATOR_COST : STAIRS_COST);
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
