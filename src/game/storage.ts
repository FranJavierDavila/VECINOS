import type { BlockInstance, Rules } from '@/game/core/types';

/**
 * Geometría de los bloques de trasteros por COLUMNA (v1.18) — UNA sola verdad para el
 * runtime (building.ts levanta la geometría; actors.ts y player-logic.ts caminan por ella),
 * al estilo del contrato de src/game/stairs.ts. Todo sale de rules.view.trasteros:
 *
 *   · El bloque guarda los trasteros de TODAS las viviendas de su columna (una planta).
 *   · PASILLO CENTRAL de circulación (corridorW) que corre hacia el fondo (+Z).
 *   · IMPARES a un lado (oddSide) y PARES al otro, ordenados desde la entrada.
 *   · Compartimentos CERRADOS (unitH + tapa): el interior jamás se ve.
 *   · Profundidad del bloque = depth × blockDepthFactor (×3 → 8.4 m con el catálogo actual).
 *
 * Coordenadas: x0 = borde izquierdo del bloque; el pasillo es la banda central en X;
 * cada unidad ocupa toda la anchura de su lado y una franja en Z. La puerta da AL PASILLO.
 */

export interface StorageGeom {
  /** Profundidad total del bloque (m). */
  depth: number;
  /** Anchura total del bloque (m). */
  width: number;
  /** Anchura del pasillo central (m). */
  corridorW: number;
  /** Espesor de tabiques (m). */
  wallT: number;
  doorW: number;
  doorH: number;
  unitH: number;
  doorColor: string;
  oddSide: 'left' | 'right';
}

/** frontZ compartido con building/actors (el plano frontal de los bloques). */
export function frontZOf(view: Rules['view']): number {
  return view.roomZ - view.commonDepth / 2;
}

/**
 * Los DOS carriles del pasillo frontal (v1.19): pasillos del DOBLE de calado para que quepan
 * dos vías de movimiento — carril INTERIOR (junto a las puertas, la línea del pasillo de
 * siempre: corridorZ) y carril EXTERIOR (junto a la barandilla, simétrico al interior).
 * Por el exterior no salta NINGÚN aviso de interacción con elementos de pared (puertas,
 * buzones, tablón): es la vía de adelantamiento.
 */
export interface CorridorLanes {
  /** Z del carril interior (línea del pasillo, junto a puertas). */
  inner: number;
  /** Z del carril exterior (junto a la barandilla). */
  outer: number;
  /** Umbral: z < threshold = carril exterior (sin avisos de pared). */
  threshold: number;
  /** Límites del paseo por el pasillo (para el clamp del jugador). */
  minZ: number;
  maxZ: number;
}

export function corridorLanes(view: Rules['view']): CorridorLanes {
  const front = frontZOf(view);
  const innerGap = front - view.corridorZ; // distancia fachada → carril interior (0.6 con catálogo)
  const outer = front - view.corridorDepth + innerGap;
  return {
    inner: view.corridorZ,
    outer,
    threshold: (view.corridorZ + outer) / 2,
    minZ: outer + view.margin * 0.5,
    maxZ: front - view.margin * 0.5,
  };
}

export function storageGeomOf(view: Rules['view']): StorageGeom {
  const tr = view.trasteros;
  return {
    depth: view.depth * tr.blockDepthFactor,
    width: 2 * view.cellW - view.gapW,
    corridorW: tr.corridorW,
    wallT: tr.wallT,
    doorW: tr.doorW,
    doorH: tr.doorH,
    unitH: tr.unitH,
    doorColor: tr.doorColor,
    oddSide: tr.oddSide,
  };
}

/** ¿Es este bloque un trastero por columna? (defId del catálogo). */
export function isStorageColumnBlock(block: BlockInstance, view: Rules['view']): boolean {
  return block.defId === view.trasteros.blockDefId;
}

/** Banda X del pasillo central (mundo): [entrada, salida]. */
export function storageCorridorX(x0: number, g: StorageGeom): [number, number] {
  const a = x0 + (g.width - g.corridorW) / 2;
  return [a, a + g.corridorW];
}

/** Lado (−X = 'left' en pantalla al mirar hacia el fondo) donde cae la vivienda `floor`. */
export function storageSideOf(floor: number, g: StorageGeom): 'left' | 'right' {
  const odd = floor % 2 === 1;
  return (g.oddSide === 'left') === odd ? 'left' : 'right';
}

/**
 * Plan de unidades de una columna a partir de las plantas de sus viviendas (ascendentes):
 * cada vivienda → su lado y su índice dentro del lado (0 = junto a la entrada). Determinista
 * y en una sola pasada: impares a oddSide, pares al contrario.
 */
export function storageUnitPlan(
  view: Rules['view'],
  dwellingFloors: number[],
): { floor: number; side: 'left' | 'right'; index: number }[] {
  const g = storageGeomOf(view);
  const count = { left: 0, right: 0 };
  return [...dwellingFloors]
    .sort((a, b) => a - b)
    .map((floor) => {
      const side = storageSideOf(floor, g);
      const index = count[side]++;
      return { floor, side, index };
    });
}

/** Centro Z (mundo) de la unidad `index` de un lado con `count` unidades. */
export function storageUnitZ(frontZ: number, index: number, count: number, g: StorageGeom): number {
  const usable = g.depth - 2 * g.wallT;
  const unitD = usable / Math.max(1, count);
  return frontZ + g.wallT + (index + 0.5) * unitD;
}

/** X de la puerta de una unidad (ras del pasillo): el lado izquierdo mira a +X y viceversa.
 *  v1.19 FIX: las celdas IZQUIERDA ocupan [borde, corA] y su puerta está en corA (el borde
 *  IZQUIERDO del pasillo); las de la derecha, en corB. Antes devolvía el lado contrario y
 *  los vecinos se plantaban (y se escondían) frente a la celda equivocada. */
export function storageDoorX(x0: number, side: 'left' | 'right', g: StorageGeom): number {
  const [a, b] = storageCorridorX(x0, g);
  return side === 'left' ? a : b;
}

/**
 * Punto de puerta (mundo) del trastero de la vivienda `homeFloor` en el bloque `block`,
 * según el plan de unidades de su columna. null si el bloque no es de este tipo.
 */
export function storageDoorPoint(
  view: Rules['view'],
  block: BlockInstance,
  columnDwellingFloors: number[],
  homeFloor: number,
): { x: number; z: number; side: 'left' | 'right' } | null {
  if (!isStorageColumnBlock(block, view)) return null;
  const g = storageGeomOf(view);
  const plan = storageUnitPlan(view, columnDwellingFloors);
  const unit = plan.find((u) => u.floor === homeFloor);
  if (!unit) return null;
  const count = plan.filter((u) => u.side === unit.side).length;
  const x0 = block.cell.col * view.cellW;
  return {
    x: storageDoorX(x0, unit.side, g),
    z: storageUnitZ(frontZOf(view), unit.index, count, g),
    side: unit.side,
  };
}
