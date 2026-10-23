import type { Color3, Mesh, Scene, StandardMaterial } from '@babylonjs/core';
import type { BlockInstance, Content, World } from '@/game/core/types';
import { B } from './babylon';

interface BlockView {
  mat: StandardMaterial;
  front: Mesh | null; // panel que cierra la vivienda mientras tiene candado
  lock: Mesh | null;
  lockBase: { x: number; y: number };
}

/**
 * Una caja por bloque (placeholder greybox del futuro prefab). TODA la geometría y los colores
 * salen de content.rules.view + block.view: sustituir el greybox por arte final no toca este código.
 * Las viviendas se dibujan en corte, sin pared frontal; bloqueadas, con panel y candado.
 */
export function createBuilding(scene: Scene, world: World, content: Content) {
  const { Color3, Color4, MeshBuilder, StandardMaterial } = B();
  const v = content.rules.view;
  const glow = Object.fromEntries(Object.entries(v.channelGlow).map(([k, hex]) => [k, Color3.FromHexString(hex)])) as Record<string, Color3>;
  const views = new Map<string, BlockView>();
  const shakes = new Map<string, number>();
  /** Foco del LOD (posición del jugador): lo alimenta update() y lo consume paint(). */
  let lastFocus: { x: number; floor: number } | null = null;
  const mat = (name: string) => new StandardMaterial(name, scene);
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, m: StandardMaterial) => {
    const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    return mesh;
  };

  for (const b of Object.values(world.blocks)) {
    const m = mat(`${b.id}_mat`);
    const cx = (b.cell.col + b.size.w / 2) * v.cellW;
    const bottom = b.cell.floor * v.cellH;
    const w = b.size.w * v.cellW - v.gapW;
    const h = v.cellH - v.gapH;
    const view: BlockView = { mat: m, front: null, lock: null, lockBase: { x: cx, y: bottom + v.cellH / 2 - 0.2 } };
    if (b.layer === 'corridor') {
      box(b.id, b.size.w * v.cellW, v.slab * 2, 0.5, cx, bottom + v.slab, v.corridorZ, m);
    } else if (b.kind === 'dwelling') {
      const y = bottom + v.cellH / 2;
      box(`${b.id}_fondo`, w, h, v.wall, cx, y, v.roomZ + v.depth / 2, m);
      box(`${b.id}_izq`, v.wall, h, v.depth, cx - w / 2, y, v.roomZ, m);
      box(`${b.id}_der`, v.wall, h, v.depth, cx + w / 2, y, v.roomZ, m);
      box(`${b.id}_suelo`, w, v.wall, v.depth, cx, bottom + v.slab + v.wall / 2, v.roomZ, m);
      box(`${b.id}_techo`, w, v.wall, v.depth, cx, bottom + v.cellH - v.slab - v.wall / 2, v.roomZ, m);
      view.front = box(`${b.id}_puerta`, w, h, v.wall, cx, y, v.roomZ - v.depth / 2, m);
      view.lock = box(`${b.id}_candado`, 0.3, 0.38, 0.12, cx, view.lockBase.y, v.roomZ - v.depth / 2 - 0.1, mat(`${b.id}_candado_mat`));
      (view.lock.material as StandardMaterial).diffuseColor = Color3.FromHexString(v.lockColor);
    } else {
      box(b.id, w, h, v.depth, cx, bottom + v.cellH / 2, v.roomZ, m);
    }
    views.set(b.id, view);
  }

  // ── Multi-vivienda destacada: borde blanco en la pared del fondo de TODAS las viviendas del jugador ──
  // (la actual del jugador además recibe el doble de grosor; el criterio es el ownerId, no el catálogo).
  const homeId = world.residents[world.playerId]!.home;
  for (const b of Object.values(world.blocks)) {
    if (b.kind !== 'dwelling' || b.ownerId !== world.playerId) continue;
    const wall = scene.getMeshByName(`${b.id}_fondo`);
    if (!wall) continue;
    wall.enableEdgesRendering();
    wall.edgesWidth = b.id === homeId ? 14 : 8;
    wall.edgesColor = Color4.FromHexString(v.homeEdge + 'ff');
  }

  // ── Mobiliario placeholder (greybox del editor de interiores): una caja por ranura de las viviendas. ──
  // La geometría llega al pintar, desde furniture.view del catálogo: sustituible por arte final sin tocar esto.
  const furnViews = new Map<string, { mesh: Mesh; mat: StandardMaterial; x: number; z: number; bottom: number; pos1: number }>();
  for (const b of Object.values(world.blocks)) {
    if (b.kind !== 'dwelling') continue;
    const w = b.size.w * v.cellW - v.gapW;
    const bottom = b.cell.floor * v.cellH;
    const layoutId = content.blocks[b.defId]?.container?.layout;
    const layoutRooms = layoutId ? content.layouts[layoutId]?.rooms ?? [] : [];
    const bandW = w / Math.max(1, layoutRooms.length);
    layoutRooms.forEach((layoutRoom, roomIdx) => {
      const rdef = content.rooms[layoutRoom.defId];
      const roomW = rdef?.size.w ?? 1;
      (rdef?.furnitureSlots ?? []).forEach((slot, slotIdx) => {
        const x = b.cell.col * v.cellW + roomIdx * bandW + (slot.pos[0] / Math.max(0.001, roomW)) * bandW;
        const z = v.roomZ - v.depth / 2 + 0.35 + slotIdx * 0.32;
        const fm = mat(`${b.id}_${layoutRoom.key}_${slot.id}_furn`);
        const mesh = box(`${b.id}_${layoutRoom.key}_${slot.id}_furn`, 1, 1, 1, x, bottom + v.slab, z, fm);
        mesh.setEnabled(false);
        furnViews.set(`${b.id}:${layoutRoom.key}:${slot.id}`, { mesh, mat: fm, x, z, bottom, pos1: slot.pos[1] });
      });
    });
  }

  function color(b: BlockInstance): Color3 {
    const base = Color3.FromHexString(content.blocks[b.defId]!.view?.color ?? '#cccccc');
    if (b.kind === 'dwelling' && b.access === 'locked') return Color3.FromHexString(v.lockedColor);
    if (b.kind === 'dwelling' && b.occupancy !== 'occupied') return Color3.Lerp(base, Color3.White(), v.vacantTint);
    if (b.params.elevator_status !== undefined && b.params.elevator_status !== 'ok') return Color3.FromHexString(v.brokenColor);
    return base;
  }

  return {
    paint() {
      for (const b of Object.values(world.blocks)) {
        const view = views.get(b.id)!;
        view.mat.diffuseColor = color(b);
        // Canales de influencia → emissive según color del canal en el catálogo. Se acumulan.
        let e = new Color3(0, 0, 0);
        for (const [channel, value] of Object.entries(world.channels)) {
          const level = value[b.id];
          if (!level) continue;
          const g = glow[channel];
          if (!g) continue;
          e = e.add(g.scale(Math.min(1, level)));
        }
        view.mat.emissiveColor = e;
        const closed = b.kind === 'dwelling' && b.access === 'locked';
        view.front?.setEnabled(closed);
        view.lock?.setEnabled(closed);
      }
      // Muebles del editor de interiores: visibles/escala/color según furniture.view (catálogo).
      for (const [key, fv] of furnViews) {
        const [blockId, roomKey, slotId] = key.split(':');
        const room = world.blocks[blockId ?? '']?.rooms.find((r) => r.key === roomKey);
        const itemId = room?.furniture[slotId ?? ''] ?? '';
        const fdef = itemId ? content.furniture[itemId] : undefined;
        if (!fdef) {
          fv.mesh.setEnabled(false);
          continue;
        }
        const [iw, ih, idz] = fdef.view.size;
        fv.mesh.setEnabled(true);
        fv.mesh.scaling.set(iw, ih, idz);
        fv.mesh.position.set(fv.x, fv.bottom + v.slab + v.wall + fv.pos1 + ih / 2, fv.z);
        fv.mat.diffuseColor = Color3.FromHexString(fdef.view.color);
      }
    },
    /** Sacude el candado de una puerta cerrada. */
    shake(blockId: string) {
      shakes.set(blockId, 0.4);
    },
    /**
     * dt en segundos; `focus` es el punto de interés (posición del jugador) para el
     * LOD por distancia (rules.view.lod). Se consume en el siguiente paint().
     */
    update(dt: number, focus?: { x: number; floor: number }) {
      if (focus) lastFocus = focus;
      for (const [id, left] of shakes) {
        const view = views.get(id)!;
        const t = left - dt;
        if (t <= 0) {
          shakes.delete(id);
          view.lock?.position.set(view.lockBase.x, view.lockBase.y, view.lock.position.z);
        } else {
          shakes.set(id, t);
          view.lock?.position.set(view.lockBase.x + Math.sin(t * 60) * 0.06, view.lockBase.y, view.lock.position.z);
        }
      }
    },
  };
}
