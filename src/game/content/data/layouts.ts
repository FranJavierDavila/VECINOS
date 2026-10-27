import type { LayoutDef } from '@/game/core/types';

export const LAYOUT_DEFS: LayoutDef[] = [
  {
    id: 'layout_vivienda_v1',
    rooms: [
      { key: 'salon', defId: 'estancia_salon_cocina', startsUnlocked: true },
      { key: 'dormitorio', defId: 'estancia_dormitorio', startsUnlocked: false },
      { key: 'bano', defId: 'estancia_bano', startsUnlocked: false },
    ],
  },
];
