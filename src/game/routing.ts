import type { Rules } from '@/game/core/types';
import type { LayoutGeometry, Pt } from '@/game/interior';
import { interiorRoute } from '@/game/interior';

/**
 * Rutas horizontales a prueba de vecinos (v1.14) — UNA sola verdad para TODA locomoción
 * de presentación (IA de actores y dirección de cutscenes): la LEY DEL PASILLO.
 *
 * El edificio es una banda de bloques (viviendas y comunes) que arranca en el plano frontal
 * FRONT = roomZ − commonDepth/2 y crece hacia +Z; delante queda el pasillo, una línea libre
 * a z = corridorZ. Por tanto:
 *
 *   1. El movimiento HORIZONTAL en X solo ocurre sobre la línea del pasillo (z = corridorZ),
 *      jamás dentro de la banda: cruzar de un extremo a otro nunca atraviesa una vivienda
 *      ajena ni el núcleo (el caso "el 2B entra en casa a través del 2C y del ascensor").
 *   2. Entrar o salir de la banda (cambio de z) ocurre SOLO en vertical y únicamente en la
 *      X del bloque que se entra o se sale: su propia puerta.
 *   3. Dentro de una vivienda con geometría 2D manda interiorRoute (tabiques y huecos del
 *      catálogo); solo se entra por el frente si se viene de fuera.
 *
 * Módulo puro (sin Babylon, sin sim): lo consumen actors.ts y los QA headless.
 */

export interface RouteLegXZ {
  x: number;
  z: number;
}

/** Bloque bajo los pies: se sale de la banda por SU puerta (x clampeada a su ancho).
 *  v1.28 — doorX/geo: si el anfitrión tiene puerta frontal (vivienda), la SALIDA camina por
 *  dentro hasta el hueco (interiorRoute) y cruza POR ÉL — jamás a través de la fachada. */
export interface HostSpan {
  x0: number;
  w: number;
  doorX?: number;
  geo?: LayoutGeometry | null;
}

/** Destino con interior 2D: geometría del catálogo y objetivo en coords locales.
 *  v1.28 — doorX: la ENTRADA se hace por el hueco de la puerta frontal (el corte real de la
 *  fachada), no por la x del objetivo (cruzaba la pared a la altura de la cama). */
export interface DestInside {
  x0: number;
  w: number;
  geo: LayoutGeometry;
  target: Pt;
  doorX?: number;
}

export interface HorizontalRouteInput {
  view: Rules['view'];
  /** Posición actual del actor (pies) en el plano de su planta. */
  from: { x: number; z: number };
  /** Destino final en el plano (misma planta; el vertical lo gestiona el llamador). */
  dest: { x: number; z: number };
  destInside?: DestInside | null;
  hostSpan?: HostSpan | null;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Elimina legs idénticas consecutivas y la primera si el actor ya está en ella. */
function compact(legs: RouteLegXZ[], from: { x: number; z: number }): RouteLegXZ[] {
  const out: RouteLegXZ[] = [];
  for (const l of legs) {
    const prev = out.length > 0 ? out[out.length - 1]! : from;
    if (Math.abs(l.x - prev.x) < 0.04 && Math.abs(l.z - prev.z) < 0.04) continue;
    out.push(l);
  }
  return out;
}

/**
 * Tramos horizontales de `from` a `dest` respetando la ley del pasillo. El resultado es una
 * cola de waypoints (x, z) a consumir a crucero; la Y la añade el llamador.
 */
export function horizontalLegs(input: HorizontalRouteInput): RouteLegXZ[] {
  const v = input.view;
  const frontZ = v.roomZ - v.commonDepth / 2;
  const corr = v.corridorZ;
  const m = v.margin;
  const inBand = (z: number): boolean => z > frontZ + 0.02;
  const legs: RouteLegXZ[] = [];
  const d = input.destInside;
  // ¿El destino es el MISMO bloque en el que ya se está? (moverse dentro: sin salir a la calle)
  const inThisBlock = !!d && input.from.x >= d.x0 && input.from.x <= d.x0 + d.w && inBand(input.from.z);

  // ── 1. Salida de la banda por la puerta del bloque bajo los pies (solo cambio de z en SU x).
  //    Se omite si el destino es ese mismo bloque: nadie sale de casa para irse a casa.
  //    v1.28 — con puerta propia (doorX + geometría), la salida camina por DENTRO hasta el
  //    hueco (tabiques del catálogo manda) y cruza por él: el vecino que duerme en la
  //    trasera sale por la puerta, no a través del salón ni de la fachada.
  if (inBand(input.from.z) && !inThisBlock) {
    const hs = input.hostSpan;
    const doorExit = !!hs?.doorX && !!hs?.geo;
    let exitX: number;
    if (doorExit) {
      exitX = hs!.doorX!;
      const fromLocal: Pt = { x: input.from.x - hs!.x0, z: input.from.z - frontZ };
      const doorLocal: Pt = { x: Math.min(hs!.w - m, Math.max(m, exitX - hs!.x0)), z: 0.45 };
      const route = interiorRoute(hs!.geo!, fromLocal, doorLocal);
      if (route) {
        for (const p of route) legs.push({ x: hs!.x0 + p.x, z: frontZ + p.z });
      } else {
        legs.push({ x: exitX, z: input.from.z });
        legs.push({ x: exitX, z: frontZ + 0.45 });
      }
    } else {
      exitX = hs ? clamp(input.from.x, hs.x0 + m, hs.x0 + hs.w - m) : input.from.x;
      legs.push({ x: exitX, z: frontZ + 0.45 });
    }
    legs.push({ x: exitX, z: corr });
  }

  // ── 2. Destino con interior 2D (vivienda del catálogo).
  if (d) {
    if (inThisBlock) {
      // Ya dentro de la vivienda destino: ruta interior desde el punto real (tabiques manda).
      const fromLocal: Pt = { x: input.from.x - d.x0, z: input.from.z - frontZ };
      const route = interiorRoute(d.geo, fromLocal, d.target);
      if (route && route.length > 0) {
        for (const p of route) legs.push({ x: d.x0 + p.x, z: frontZ + p.z });
      } else {
        // Sin ruta legal (estancia cerrada): se queda en el salón de entrada, nunca a través.
        legs.push({ x: d.x0 + clamp(d.target.x, m, d.w - m), z: frontZ + 0.6 });
      }
    } else {
      // Desde fuera: pasillo hasta la x de la PUERTA (v1.28: el hueco real de la fachada,
      // no la x del objetivo — eso atravesaba la pared), entrar por el frente y ruta interior.
      const entryLocal = d.doorX !== undefined
        ? clamp(d.doorX - d.x0, m, d.w - m)
        : clamp(d.target.x, m, d.w - m);
      const entryX = d.x0 + entryLocal;
      legs.push({ x: entryX, z: corr });
      legs.push({ x: entryX, z: frontZ + 0.45 });
      const route = interiorRoute(d.geo, { x: entryLocal, z: 0.45 }, d.target);
      if (route) for (const p of route) legs.push({ x: d.x0 + p.x, z: frontZ + p.z });
    }
    return compact(legs, input.from);
  }

  // ── 3. Destino sin interior (pasillo, pozo, común o vivienda sin layout): pasillo primero,
  //      y el único cruce de banda es el salto final EN la x del destino.
  legs.push({ x: input.dest.x, z: corr });
  if (input.dest.z > corr + 0.01) legs.push({ x: input.dest.x, z: input.dest.z });
  return compact(legs, input.from);
}
