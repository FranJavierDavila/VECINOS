import type { Mesh, Scene } from '@babylonjs/core';
import type { Content, PlayerPosition, World } from '@/game/core/types';
import { B } from './babylon';

interface Actor {
  mesh: Mesh;
  height: number;
}

/**
 * El jugador y los vecinos como cápsulas greybox (el arte final los sustituirá).
 * Color y altura salen de la vista del arquetipo; radios y fallbacks, de content.rules.view.
 */
export function createActors(scene: Scene, world: World, content: Content) {
  const { Color3, MeshBuilder, StandardMaterial, Vector3 } = B();
  const v = content.rules.view;
  const actors = new Map<string, Actor>();
  for (const r of Object.values(world.residents)) {
    const view = content.archetypes[r.archetype]?.view;
    const height = view?.height ?? v.actorFallbackHeight;
    const mesh = MeshBuilder.CreateCapsule(r.id, { height, radius: v.actorRadius }, scene);
    const m = new StandardMaterial(`${r.id}_mat`, scene);
    m.diffuseColor = Color3.FromHexString(view?.color ?? v.actorFallbackColor);
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
          goal.set(player.x, player.floor * v.cellH + (inside ? 0.12 : 0.14) + a.height / 2, inside ? v.roomZ : v.corridorZ);
        } else {
          const b = world.blocks[r.location!]!;
          const home = world.blocks[r.home]!;
          const inRoom = b.kind === 'dwelling';
          const x = b.layer === 'corridor' ? (home.cell.col + 0.5) * v.cellW : (b.cell.col + b.size.w / 2) * v.cellW;
          goal.set(x, b.cell.floor * v.cellH + 0.14 + a.height / 2, inRoom ? v.roomZ : v.corridorZ);
        }
        if (a.mesh.position.lengthSquared() === 0) a.mesh.position.copyFrom(goal);
        a.mesh.position.addInPlace(goal.subtract(a.mesh.position).scale(isPlayer ? Math.min(1, k * 2) : k));
      }
    },
  };
}
