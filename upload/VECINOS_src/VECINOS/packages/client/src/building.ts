import { Color3, Color4, MeshBuilder, Scene, StandardMaterial, type Mesh } from '@babylonjs/core';
import type { Content } from '@vecinos/content';
import type { BlockInstance, World } from '@vecinos/sim';
import { CELL_H, CELL_W } from './player-logic';

/** z de cada capa: el pasillo va delante, las viviendas detrás (el "poco de profundidad" del 2.5D). */
export const CORRIDOR_Z = -0.95;
export const ROOM_Z = 0;
const DEPTH = 1.4;
const WALL = 0.1;

interface BlockView {
  mat: StandardMaterial;
  front: Mesh | null; // panel que cierra la vivienda mientras tiene candado
  lock: Mesh | null;
  lockBase: { x: number; y: number };
}

/**
 * Una caja por bloque (placeholder del futuro prefab). Las viviendas se dibujan en corte, sin pared frontal,
 * y mientras están bloqueadas se tapan con un panel con candado.
 */
export function createBuilding(scene: Scene, world: World, content: Content) {
  const views = new Map<string, BlockView>();
  const shakes = new Map<string, number>();
  const mat = (name: string) => new StandardMaterial(name, scene);
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, m: StandardMaterial) => {
    const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    return mesh;
  };

  for (const b of Object.values(world.blocks)) {
    const m = mat(`${b.id}_mat`);
    const cx = (b.cell.col + b.size.w / 2) * CELL_W;
    const bottom = b.cell.floor * CELL_H;
    const w = b.size.w * CELL_W - 0.12;
    const h = CELL_H - 0.14;
    const view: BlockView = { mat: m, front: null, lock: null, lockBase: { x: cx, y: bottom + CELL_H / 2 - 0.2 } };
    if (b.layer === 'corridor') {
      box(b.id, b.size.w * CELL_W, 0.14, 0.5, cx, bottom + 0.07, CORRIDOR_Z, m);
    } else if (b.kind === 'dwelling') {
      const y = bottom + CELL_H / 2;
      box(`${b.id}_fondo`, w, h, WALL, cx, y, ROOM_Z + DEPTH / 2, m);
      box(`${b.id}_izq`, WALL, h, DEPTH, cx - w / 2, y, ROOM_Z, m);
      box(`${b.id}_der`, WALL, h, DEPTH, cx + w / 2, y, ROOM_Z, m);
      box(`${b.id}_suelo`, w, WALL, DEPTH, cx, bottom + 0.07 + WALL / 2, ROOM_Z, m);
      box(`${b.id}_techo`, w, WALL, DEPTH, cx, bottom + CELL_H - 0.07 - WALL / 2, ROOM_Z, m);
      view.front = box(`${b.id}_puerta`, w, h, WALL, cx, y, ROOM_Z - DEPTH / 2, m);
      view.lock = box(`${b.id}_candado`, 0.3, 0.38, 0.12, cx, view.lockBase.y, ROOM_Z - DEPTH / 2 - 0.1, mat(`${b.id}_candado_mat`));
      (view.lock.material as StandardMaterial).diffuseColor = Color3.FromHexString('#ffd166');
    } else {
      box(b.id, w, h, DEPTH, cx, bottom + CELL_H / 2, ROOM_Z, m);
    }
    views.set(b.id, view);
  }

  const homeId = world.residents[world.playerId]!.home;
  const homeWall = scene.getMeshByName(`${homeId}_fondo`)!;
  homeWall.enableEdgesRendering();
  homeWall.edgesWidth = 8;
  homeWall.edgesColor = new Color4(1, 1, 1, 1);

  function color(b: BlockInstance): Color3 {
    const base = Color3.FromHexString(content.blocks[b.defId]!.view?.color ?? '#cccccc');
    if (b.kind === 'dwelling' && b.access === 'locked') return Color3.FromHexString('#7d8493');
    if (b.kind === 'dwelling' && b.occupancy !== 'occupied') return Color3.Lerp(base, Color3.White(), 0.45);
    if (b.params.elevator_status !== undefined && b.params.elevator_status !== 'ok') return Color3.FromHexString('#c1666b');
    return base;
  }

  return {
    paint() {
      for (const b of Object.values(world.blocks)) {
        const v = views.get(b.id)!;
        v.mat.diffuseColor = color(b);
        const noise = Math.min(1, world.channels.noise?.[b.id] ?? 0);
        v.mat.emissiveColor = new Color3(noise, noise * 0.35, 0);
        const closed = b.kind === 'dwelling' && b.access === 'locked';
        v.front?.setEnabled(closed);
        v.lock?.setEnabled(closed);
      }
    },
    /** Sacude el candado de una puerta cerrada. */
    shake(blockId: string) {
      shakes.set(blockId, 0.4);
    },
    update(dt: number) {
      for (const [id, left] of shakes) {
        const v = views.get(id)!;
        const t = left - dt;
        if (t <= 0) {
          shakes.delete(id);
          v.lock?.position.set(v.lockBase.x, v.lockBase.y, v.lock.position.z);
        } else {
          shakes.set(id, t);
          v.lock?.position.set(v.lockBase.x + Math.sin(t * 60) * 0.06, v.lockBase.y, v.lock.position.z);
        }
      }
    },
  };
}
