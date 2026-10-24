import type { Content, ParamValue } from '@/game/core/types';
import type { RoomInstance } from '@/game/core/types';

/** Instancia las estancias de una vivienda según su layout, con parámetros por defecto y ranuras vacías. */
export function instantiateRooms(content: Content, defId: string): RoomInstance[] {
  const layoutId = content.blocks[defId]?.container?.layout;
  const layout = layoutId ? content.layouts[layoutId] : undefined;
  return (layout?.rooms ?? []).map((r) => {
    const def = content.rooms[r.defId];
    const params: Record<string, ParamValue> = Object.fromEntries(
      Object.entries(def?.params ?? {}).map(([k, p]) => [k, p.default]),
    );
    const furniture: Record<string, string> = Object.fromEntries((def?.furnitureSlots ?? []).map((s) => [s.id, '']));
    return { key: r.key, defId: r.defId, access: r.startsUnlocked ? 'unlocked' : 'locked', params, furniture };
  });
}

/**
 * Migra estancias de guardados antiguos: garantiza params y furniture rellenando las ranuras del catálogo.
 * Idempotente: no toca lo que ya existe (un guardado de la v0.1 conserva su estado).
 */
export function migrateRooms(content: Content, rooms: RoomInstance[]): void {
  for (const room of rooms) {
    const def = content.rooms[room.defId];
    room.params ??= Object.fromEntries(Object.entries(def?.params ?? {}).map(([k, p]) => [k, p.default]));
    room.furniture ??= {};
    for (const slot of def?.furnitureSlots ?? []) if (room.furniture[slot.id] === undefined) room.furniture[slot.id] = '';
  }
}
