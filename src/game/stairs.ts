import type { Rules } from '@/game/core/types';

/**
 * Geometría de la escalera de vecinos (v1.4) — UNA sola verdad para la authoría glTF
 * (scripts/gen-pilot-assets.ts, que lee este contrato desde rules.view.stairs) y para el
 * runtime (ruta de los vecinos y escalada del jugador).
 *
 * El cubo de escalera ocupa visualmente `spanW` celdas de ancho (la celda lógica queda en el
 * extremo izquierdo: el cubo sobresale por el lateral derecho del edificio, como torre de
 * escalera real). La puerta de entrada está en el CENTRO de la celda lógica (donde el grafo
 * coloca el pozo) y los dos tramos suben en direcciones contrarias con un descansillo:
 *
 *   entrada (carril frontal, junto al pasillo) → tramo A subiendo hacia el fondo del cubo
 *   → descansillo → tramo B subiendo en dirección contraria por el carril trasero
 *   → desembarco sobre el forjado de la planta superior → salida al pasillo.
 *
 * Niveles de.actor: 16 subidas de peldaño por planta (rise = cellH/16). El tramo A cubre las
 * 7 primeras, el descansillo la 8.ª (es un forjado de `slab*2`), el tramo B las 7 siguientes
 * y la 16.ª es el forjado de la planta superior (el desembarco ES el canto de la planta
 * siguiente, como en una escalera real).
 */

export interface StairGeom {
  spanW: number;
  doorLocalX: number;
  entryHalf: number;
  laneFront: number;
  laneBack: number;
  flightRun: number;
  landingX: number;
  stepCount: number;
  climbSpeed: number;
}

export function stairGeomOf(view: Rules['view']): StairGeom | null {
  const s = (view as { stairs?: StairGeom }).stairs;
  return s ?? null;
}

export interface StairPoint {
  x: number;
  y: number;
  z: number;
}

/** Plano frontal de los bloques (la cara que mira al pasillo), igual que en building/actors. */
export const frontPlaneZ = (view: Rules['view']): number => view.roomZ - view.commonDepth / 2;

/**
 * Puntos (mundo) de la escalera entre dos niveles de pies. Si y1 ≥ y0 devuelve la subida;
 * si y1 < y0 devuelve exactamente el reverso (bajada). El carril frontal (entrada) queda
 * junto al pasillo y el trasero al fondo del cubo.
 */
export function stairPathPoints(view: Rules['view'], sx: number, y0: number, y1: number): StairPoint[] {
  const g = stairGeomOf(view);
  if (!g) return [];
  const front = frontPlaneZ(view);
  const zF = front + g.laneFront;
  const zB = front + g.laneBack;
  // La subida SIEMPRE se construye entre el nivel bajo y el alto (misma huella geométrica);
  // la bajada es exactamente el reverso: se entra por el desembarco, se baja el tramo B en
  // dirección contraria, descansillo, tramo A hacia la entrada y salida al pasillo.
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  const rise = hi - lo;
  const step = rise / (g.stepCount * 2); // subida por peldaño (16 por planta)
  const x0 = sx + g.entryHalf; // pie del tramo A
  const x1 = x0 + g.flightRun; // pie del descansillo
  const xL = x1 + g.landingX; // punto de giro del descansillo
  const asc: StairPoint[] = [
    { x: sx, y: lo, z: zF },
    { x: x0, y: lo, z: zF },
  ];
  // Tramo A peldaño a peldaño (v1.19): con solo 3 puntos por tramo la interpolación lineal
  // cortaba las esquinas y el actor PATINABA sobre los peldaños del modelo. Un punto por
  // peldaño mantiene los pies sobre el canto real de cada escalón (7 peldaños por tramo).
  const runA = g.flightRun / g.stepCount;
  for (let i = 1; i <= g.stepCount - 1; i++) {
    asc.push({ x: x0 + i * runA, y: lo + i * step, z: zF });
  }
  // Descansillo (el 8.º peldaño es el propio forjado): subir a su canto hasta la X del giro,
  // cruzar de carril frontal a trasero y volver a la X donde arranca el tramo B.
  asc.push(
    { x: xL, y: lo + g.stepCount * step, z: zF },
    { x: xL, y: lo + g.stepCount * step, z: zB },
    { x: x1, y: lo + g.stepCount * step, z: zB },
  );
  // Tramo B peldaño a peldaño (dirección contraria, carril trasero).
  for (let i = 1; i <= g.stepCount - 1; i++) {
    asc.push({ x: x1 - i * runA, y: lo + (g.stepCount + i) * step, z: zB });
  }
  asc.push(
    { x: sx, y: hi, z: zB },
    { x: sx, y: hi, z: zF },
    { x: sx, y: hi, z: view.corridorZ },
  );
  const ascending = y1 >= y0;
  return ascending ? asc : asc.slice().reverse();
}
