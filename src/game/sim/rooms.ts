import type { Content } from '@/game/core/types';
import type { RoomInstance } from '@/game/core/types';

export function instantiateRooms(content: Content, defId: string): RoomInstance[] {
  const layoutId = content.blocks[defId]?.container?.layout;
  const layout = layoutId ? content.layouts[layoutId] : undefined;
  return (layout?.rooms ?? []).map((r) => ({ key: r.key, defId: r.defId, access: r.startsUnlocked ? 'unlocked' : 'locked' }));
}
