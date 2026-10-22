import type { Mesh, Scene } from '@babylonjs/core';
import type { Content, PlayerPosition, World } from '@/game/core/types';
import { CORRIDOR_Z, ROOM_Z } from './building';
import { CELL_H, CELL_W } from '@/game/player-logic';
import { B } from './babylon';

// Fallback si el arquetipo no tiene vista definida (los datos normales siempre la traen).
const FALLBACK_COLOR = '#e8e6e1';
const FALLBACK_HEIGHT = 1.3;
const RADIUS = 0.28;

interface Actor {
  mesh: Mesh;
  height: number;
}

/**
 * El jugador y los vecinos como cápsulas. Los vecinos van a donde dice la simulación (aún sin IA propia).
 * Color y altura salen de la vista del arquetipo (content.archetypes[r.archetype].view).
 */
export function createActors(scene: Scene, world: World, content: Content) {
  const { Color3, MeshBuilder, StandardMaterial, Vector3 } = B();
  const actors = new Map<string, Actor>();
  for (const r of Object.values(world.residents)) {
    const view = content.archetypes[r.archetype]?.view;
    const height = view?.height ?? FALLBACK_HEIGHT;
    const mesh = MeshBuilder.CreateCapsule(r.id, { height, radius: RADIUS }, scene);
    const m = new StandardMaterial(`${r.id}_mat`, scene);
    m.diffuseColor = Color3.FromHexString(view?.color ?? FALLBACK_COLOR);
    m.emissiveColor = m.diffuseColor.scale(0.25);
    mesh.material = m;
    mesh.isPickable = false;
    actors.set(r.id, { mesh, height });
  }
  const goal = new Vector3();

  return {
    update(dt: number, player: PlayerPosition) {
      const k = 1 - Math.exp(-dt * 10);
      for (const [id, a] of actors) {
        const r = world.residents[id]!;
        const isPlayer = id === world.playerId;
        a.mesh.setEnabled(isPlayer || (r.present && r.location !== null));
        if (!a.mesh.isEnabled()) continue;
        if (isPlayer) {
          const inside = player.mode === 'inside';
          goal.set(player.x, player.floor * CELL_H + (inside ? 0.12 : 0.14) + a.height / 2, inside ? ROOM_Z : CORRIDOR_Z);
        } else {
          const b = world.blocks[r.location!]!;
          const home = world.blocks[r.home]!;
          const inRoom = b.kind === 'dwelling';
          const x = b.layer === 'corridor' ? (home.cell.col + 0.5) * CELL_W : (b.cell.col + b.size.w / 2) * CELL_W;
          goal.set(x, b.cell.floor * CELL_H + 0.14 + a.height / 2, inRoom ? ROOM_Z : CORRIDOR_Z);
        }
        if (a.mesh.position.lengthSquared() === 0) a.mesh.position.copyFrom(goal);
        a.mesh.position.addInPlace(goal.subtract(a.mesh.position).scale(isPlayer ? Math.min(1, k * 2) : k));
      }
    },
  };
}
