import { Color3, MeshBuilder, Scene, StandardMaterial, Vector3, type Mesh } from '@babylonjs/core';
import type { World } from '@vecinos/sim';
import { CORRIDOR_Z, ROOM_Z } from './building';
import { CELL_H, CELL_W, type PlayerPosition } from './player-logic';

const COLORS: Record<string, string> = {
  jugador_base: '#3a86ff',
  cotilla: '#c77dff',
  fiestero: '#ff6b6b',
  nino_grafitero: '#ffd166',
};

interface Actor {
  mesh: Mesh;
  height: number;
}

/** El jugador y los vecinos como cápsulas. Los vecinos van a donde dice la simulación (aún sin IA propia). */
export function createActors(scene: Scene, world: World) {
  const actors = new Map<string, Actor>();
  for (const r of Object.values(world.residents)) {
    const kid = r.archetype === 'nino_grafitero';
    const height = kid ? 0.85 : 1.3;
    const mesh = MeshBuilder.CreateCapsule(r.id, { height, radius: kid ? 0.22 : 0.28 }, scene);
    const m = new StandardMaterial(`${r.id}_mat`, scene);
    m.diffuseColor = Color3.FromHexString(COLORS[r.archetype] ?? '#ffffff');
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
