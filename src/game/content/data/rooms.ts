import type { RoomDef } from '@/game/core/types';

export const ROOM_DEFS: RoomDef[] = [
  {
    id: 'estancia_salon_cocina',
    kind: 'room',
    size: { w: 3, h: 1 },
    params: {
      comfort: { type: 'number', min: 0, max: 100, default: 50, tier: 1, label: 'Confort' },
      clutter: { type: 'number', min: 0, max: 100, default: 20 },
    },
    furnitureSlots: [],
    view: { color: '#f4a261' },
  },
  {
    id: 'estancia_dormitorio',
    kind: 'room',
    size: { w: 2, h: 1 },
    params: {
      comfort: { type: 'number', min: 0, max: 100, default: 50, tier: 1, label: 'Confort' },
    },
    furnitureSlots: [],
    view: { color: '#a8dadc' },
  },
  {
    id: 'estancia_bano',
    kind: 'room',
    size: { w: 1, h: 1 },
    params: {
      cleanliness: { type: 'number', min: 0, max: 100, default: 60 },
    },
    furnitureSlots: [],
    view: { color: '#90e0ef' },
  },
];
