import type { BlockInstance, Content } from '@/game/core/types';

/**
 * Geometría interior 2D de las viviendas (Fase C), compartida por el jugador (PlayerLogic)
 * y por los vecinos (actors.ts): UNA sola fuente de verdad para rects, tabiques, huecos,
 * rutas y anclas de actividad. Todo sale del catálogo (layouts.json + rooms.json +
 * rules.view); aquí solo está el algoritmo genérico. Sim-free: nunca toca el mundo vivo
 * más allá de leer el acceso de las instancias de estancia.
 *
 * Coordenadas: los rects y puntos son LOCALES a la vivienda (0,0 = esquina frontal-izquierda;
 * x desde la pared izquierda, z desde el plano frontal de la puerta). La conversión a mundo
 * es x_mundo = bordeIzq + x_local, z_mundo = frontZ + z_local (frontZ = roomZ − commonDepth/2).
 */

/** Estancia del layout con su geometría 2D y el acceso de la instancia viva. */
export interface RoomRect {
  key: string;
  defId: string;
  rect: { x: number; z: number; w: number; d: number };
  locked: boolean;
}

/** Geometría interior de una vivienda (del layout del catálogo); null = layout sin rects → 1D clásico. */
export interface LayoutGeometry {
  rooms: RoomRect[];
  doorways: { a: string; b: string; axis: 'x' | 'z'; at: number; width: number }[];
}

export interface Pt {
  x: number;
  z: number;
}

/** Geometría 2D del layout de una vivienda; null si el layout no declara rects (catálogo antiguo). */
export function layoutGeometryOf(content: Content, block: BlockInstance): LayoutGeometry | null {
  const layoutId = content.blocks[block.defId]?.container?.layout;
  const layout = layoutId ? content.layouts[layoutId] : undefined;
  const declared = layout?.rooms.filter((r) => r.rect !== undefined) ?? [];
  if (!layout || declared.length === 0) return null;
  return {
    rooms: declared.map((r) => {
      const inst = block.rooms.find((x) => x.key === r.key);
      return { key: r.key, defId: r.defId, rect: r.rect!, locked: inst ? inst.access !== 'unlocked' : true };
    }),
    doorways: layout.doorways ?? [],
  };
}

/** Estancia que contiene el punto (rects que teselan); si ninguno lo contiene, la más cercana por centro. */
export function roomAt(geo: LayoutGeometry, x: number, z: number): RoomRect {
  const hit = geo.rooms.find((r) => x >= r.rect.x && x < r.rect.x + r.rect.w && z >= r.rect.z && z < r.rect.z + r.rect.d);
  if (hit) return hit;
  let best = geo.rooms[0]!;
  let bestD = Infinity;
  for (const r of geo.rooms) {
    const d = (r.rect.x + r.rect.w / 2 - x) ** 2 + (r.rect.z + r.rect.d / 2 - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

/**
 * ¿Se puede estar en (x, z) viniendo de `from`? Misma estancia siempre; otra estancia solo
 * cruzando un hueco de puerta entre ambas y si la destino está abierta (access unlocked).
 * La particularidad del eje: axis 'z' = tabique que corre según Z (se cruza andando en X, y el
 * hueco se valida con la coordenada z); axis 'x' = simétrico.
 */
export function walkable(geo: LayoutGeometry, from: RoomRect, x: number, z: number): boolean {
  const target = roomAt(geo, x, z);
  if (target.key === from.key) return true;
  if (target.locked) return false;
  const door = geo.doorways.find((d) => (d.a === from.key && d.b === target.key) || (d.a === target.key && d.b === from.key));
  if (!door) return false;
  return door.axis === 'z' ? Math.abs(z - door.at) <= door.width / 2 : Math.abs(x - door.at) <= door.width / 2;
}

/** Punto central del hueco entre dos estancias (coords locales); null si no comparten puerta. */
export function doorwayPoint(geo: LayoutGeometry, aKey: string, bKey: string): Pt | null {
  const door = geo.doorways.find((d) => (d.a === aKey && d.b === bKey) || (d.a === bKey && d.b === aKey));
  if (!door) return null;
  const ra = geo.rooms.find((r) => r.key === door.a)?.rect;
  const rb = geo.rooms.find((r) => r.key === door.b)?.rect;
  if (!ra || !rb) return null;
  // Los rects teselan: el tabique vive en el borde compartido (el mayor de los dos en su eje).
  if (door.axis === 'z') return { x: Math.max(ra.x, rb.x), z: door.at };
  return { x: door.at, z: Math.max(ra.z, rb.z) };
}

/**
 * Ruta de estancias de `fromKey` a `toKey` por los huecos (BFS), sin ENTRAR en estancias
 * cerradas (salir de la estancia inicial, aunque esté cerrada, sí se permite).
 * Devuelve las claves de estancias intermedias y destino; null si no hay ruta.
 */
export function roomRoute(geo: LayoutGeometry, fromKey: string, toKey: string): string[] | null {
  if (fromKey === toKey) return [];
  const byKey = new Map(geo.rooms.map((r) => [r.key, r]));
  const prev = new Map<string, string>();
  const queue: string[] = [fromKey];
  const seen = new Set([fromKey]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const d of geo.doorways) {
      const other = d.a === cur ? d.b : d.b === cur ? d.a : null;
      if (!other || seen.has(other)) continue;
      const room = byKey.get(other);
      if (!room || room.locked) continue; // no se entra en estancias cerradas
      seen.add(other);
      prev.set(other, cur);
      if (other === toKey) {
        const path: string[] = [toKey];
        let step = toKey;
        while (prev.has(step)) {
          step = prev.get(step)!;
          path.unshift(step);
        }
        path.shift(); // la primera es fromKey: los waypoints empiezan en el primer hueco
        return path;
      }
      queue.push(other);
    }
  }
  return null;
}

/**
 * Waypoints (coords locales) para ir de `from` a `to` por dentro de la vivienda: centro de
 * cada hueco cruzado + punto final. Los rects son convexos, así que tramo recto dentro de
 * una estancia siempre es válido. null = sin ruta legal (destino en estancia inalcanzable).
 */
export function interiorRoute(geo: LayoutGeometry, from: Pt, to: Pt): Pt[] | null {
  const fromRoom = roomAt(geo, from.x, from.z);
  const toRoom = roomAt(geo, to.x, to.z);
  if (fromRoom.key === toRoom.key) return [to];
  const path = roomRoute(geo, fromRoom.key, toRoom.key);
  if (path === null) return null;
  const waypoints: Pt[] = [];
  let prevKey = fromRoom.key;
  for (const key of path) {
    const p = doorwayPoint(geo, prevKey, key);
    if (!p) return null;
    waypoints.push(p);
    prevKey = key;
  }
  waypoints.push(to);
  return waypoints;
}

/** Ancla declarada en la estancia (interactables primero —cama, portátil—, luego anchors libres). */
export function anchorInRoom(content: Content, room: RoomRect, kind: string): Pt | null {
  const def = content.rooms[room.defId];
  const it = def?.interactables?.find((i) => i.kind === kind);
  if (it) return { x: room.rect.x + it.pos[0], z: room.rect.z + it.pos[1] };
  const an = def?.anchors?.find((a) => a.kind === kind);
  if (an) return { x: room.rect.x + an.pos[0], z: room.rect.z + an.pos[1] };
  return null;
}

/**
 * Hash determinista 0..1 (FNV-1a): jitter y sorteo de estancias reproducibles sin RNG global
 * (la presentación no debe depender del rng del sim ni romper capturas de QA).
 */
export function hash01(seed: string, n: number): number {
  let h = 2166136261 ^ n;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Punto LOCAL donde un vecino vive su actividad dentro de la vivienda:
 *  1. Si la actividad declara `anchor` (kind de interactable/anchor), la primera estancia
 *     ABIERTA que lo tenga (cama → dormitorio; tv/stove → salón…).
 *  2. Sin ancla (idle, fiesta…): punto deambulatorio determinista por (residente, vuelta)
 *     entre las estancias abiertas — el centro con jitter, nunca pegado a las paredes.
 *  3. Nada abierto (todo cerrado): null → la presentación coloca al vecino como siempre.
 */
export function interiorTarget(
  content: Content,
  geo: LayoutGeometry,
  anchorKind: string | undefined,
  residentId: string,
  lap: number,
): Pt | null {
  // Apilamiento 3D (v1.19): las salas TRASERAS (más profundas que el bloque principal) son
  // territorio del jugador y de misiones dirigidas — la deambulación espontánea jamás mete
  // a un vecino ahí (evita swaps de bloque por toda la fachada cada dos ticks).
  const mainDepth = content.rules.view.depth;
  const open = geo.rooms.filter((r) => !r.locked && r.rect.z + r.rect.d <= mainDepth + 0.01);
  if (open.length === 0) return null;
  if (anchorKind) {
    for (const room of open) {
      const p = anchorInRoom(content, room, anchorKind);
      if (p) return p;
    }
  }
  const room = open[Math.floor(hash01(residentId, lap * 7 + 3) * open.length) % open.length]!;
  const jx = hash01(residentId, lap * 13 + 1);
  const jz = hash01(residentId, lap * 17 + 5);
  return {
    x: room.rect.x + room.rect.w * (0.25 + 0.5 * jx),
    z: room.rect.z + room.rect.d * (0.3 + 0.45 * jz),
  };
}
