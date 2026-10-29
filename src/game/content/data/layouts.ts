import type { LayoutDef } from '@/game/core/types';

/**
 * Fallback del catálogo (public/content/layouts.json manda).
 * v1.42 — VIVIENDA DIÁFANA: la vivienda es UNA sola estancia que tesela la huella
 * completa del bloque único (size.w 2 × view.cellW = 4.8 m de ancho × view.depth
 * 4.8 m de calado). Sin tabiques, sin doorways, sin sala trasera: el espacio es
 * diáfano y la pared del fondo es UNA pared continua.
 */
export const LAYOUT_DEFS: LayoutDef[] = [
  {
    id: 'layout_vivienda_v1',
    rooms: [
      {
        key: 'estudio',
        defId: 'estancia_estudio_diafano',
        startsUnlocked: true,
        rect: { x: 0, z: 0, w: 4.8, d: 4.8 },
      },
    ],
  },
];
