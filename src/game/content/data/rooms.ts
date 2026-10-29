import type { RoomDef } from '@/game/core/types';

export const ROOM_DEFS: RoomDef[] = [
  {
    id: 'estancia_estudio_diafano',
    kind: 'room',
    label: 'Estudio diáfano',
    size: { w: 5, h: 1 },
    params: {
      comfort: { type: 'number', min: 0, max: 100, default: 50, tier: 1, label: 'Confort' },
      clutter: { type: 'number', min: 0, max: 100, default: 20 },
      cleanliness: { type: 'number', min: 0, max: 100, default: 60 },
    },
    furnitureSlots: [],
    interactables: [
      { id: 'portatil', kind: 'laptop', pos: [0.7, 1] },
      { id: 'cama', kind: 'bed', pos: [3.5, 1.15] },
    ],
    anchors: [
      { id: 'tv', kind: 'tv', pos: [1.4, 1.7] },
      { id: 'cocina', kind: 'stove', pos: [2.3, 0.6] },
      { id: 'ampli', kind: 'amp', pos: [3.1, 2.8] },
      { id: 'escritorio', kind: 'desk', pos: [0.7, 2.6] },
    ],
    view: { color: '#e8d8c8' },
  },
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
