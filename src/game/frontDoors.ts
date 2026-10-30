import type { BlockInstance, Rules } from './core/types';

/**
 * v1.47 — VANOS DE PUERTA FRONTAL (UNA sola verdad para jugador y vecinos).
 *
 * Los huecos reales que dibuja building.ts en la fachada de cada bloque de planta 0,
 * medidos con el catálogo (rules.view.locals). Los consumen:
 *  · player-logic (disciplina de hueco del jugador: entrar/salir SOLO por la puerta).
 *  · actors/routing (vecinos y asistentes: entran y salen por el vano, nunca a través
 *    de las paredes — la sala de juntas ya no se cruza por la fachada).
 *
 * La lavandería es fachada ABIERTA (el frente entero es vano) y el portal acristalado
 * solo abre en su HOYA REAL: las dos hojas correderas (portalDoors.slide) se separan
 * desde el centro — cruzar por el cristal fijo ya no es "estar en el vano".
 */
export interface DoorSpan {
  x0: number;
  x1: number;
}

/** Vanos de la fachada frontal de un bloque (x de mundo). [] = sin disciplina (viviendas). */
export function frontDoorSpans(view: Rules['view'], b: BlockInstance): DoorSpan[] {
  if (b.kind === 'dwelling') return [];
  const a = b.cell.col * view.cellW;
  const z = (b.cell.col + b.size.w) * view.cellW;
  const cx = (a + z) / 2;
  const loc = view.locals;
  const pad = loc.walkIn?.doorPad ?? 0.05;
  const span = (w: number, x: number): DoorSpan[] => [{ x0: x - w / 2 - pad, x1: x + w / 2 + pad }];
  switch (b.defId) {
    case 'trasteros': {
      const tc = loc.trasteroComunal;
      return [...span(tc.doorW, cx - tc.doorDx), ...span(tc.doorW, cx + tc.doorDx)];
    }
    case 'local_comercial':
      return span(loc.juntaHall.doorW, cx);
    case 'garaje':
      return span(loc.garaje.doorW ?? 2.16, cx);
    case 'lavanderia_comunal':
      return [{ x0: a + 0.1, x1: z - 0.1 }]; // fachada abierta: el frente entero es vano
    case 'portal':
      // v1.47 — la apertura REAL de las correderas (2 × slide desde el centro): antes el
      // vano lógico medía toda la fachada y se "entraba" por el cristal fijo lateral.
      return span((loc.portalDoors?.slide ?? 0.96) * 2, cx);
    default:
      return [];
  }
}

/**
 * x (mundo) del vano por el que cruzar la fachada de un bloque: el centro del vano más
 * cercano a `preferX` (las celdas de trasteros eligen SU puerta). Viviendas: el centro del
 * bloque (la hoja de privacidad vive en cx). Locales sin puerta (lavandería): undefined.
 */
export function frontDoorX(view: Rules['view'], b: BlockInstance, preferX?: number): number | undefined {
  const a = b.cell.col * view.cellW;
  const z = (b.cell.col + b.size.w) * view.cellW;
  const cx = (a + z) / 2;
  if (b.kind === 'dwelling') return cx;
  const spans = frontDoorSpans(view, b);
  if (spans.length === 0) return undefined;
  const best = preferX === undefined
    ? spans[0]!
    : spans.reduce((acc, s) => {
        const dBest = Math.abs((acc.x0 + acc.x1) / 2 - preferX);
        const dS = Math.abs((s.x0 + s.x1) / 2 - preferX);
        return dS < dBest ? s : acc;
      });
  return (best.x0 + best.x1) / 2;
}
