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
 *
 * Dinámico (multijugador): la plantilla de cápsulas se sincroniza con world.residents en cada
 * update — residentes nuevos reciben malla y residentes que ya no existen la pierden — porque
 * el servidor puede añadir invitados (o marcar ausencias) en cualquier session:state.
 */
export function createActors(scene: Scene, world: World, content: Content) {
  const { Color3, MeshBuilder, StandardMaterial, Vector3 } = B();
  const v = content.rules.view;
  const actors = new Map<string, Actor>();

  /** Crea la cápsula de un residente (helper extraído; también la usan las altas en caliente). */
  const ensureActor = (id: string, archetype: string): Actor => {
    const view = content.archetypes[archetype]?.view;
    const height = view?.height ?? v.actorFallbackHeight;
    const mesh = MeshBuilder.CreateCapsule(id, { height, radius: v.actorRadius }, scene);
    const m = new StandardMaterial(`${id}_mat`, scene);
    m.diffuseColor = Color3.FromHexString(view?.color ?? v.actorFallbackColor);
    m.emissiveColor = m.diffuseColor.scale(0.25);
    mesh.material = m;
    mesh.isPickable = false;
    const a = { mesh, height };
    actors.set(id, a);
    return a;
  };

  const goal = new Vector3();

  return {
    /** playerResidentId identifica al residente del jugador local (multijugador: puede ser un invitado). */
    update(dt: number, player: PlayerPosition, playerResidentId: string) {
      // Altas y bajas: residentes sin malla → crear; mallas huérfanas → dispose + remove.
      for (const id in world.residents) {
        if (!actors.has(id)) ensureActor(id, world.residents[id]!.archetype);
      }
      const gone: string[] = [];
      for (const id of actors.keys()) {
        if (!world.residents[id]) gone.push(id);
      }
      for (const id of gone) {
        const a = actors.get(id);
        actors.delete(id);
        a?.mesh.dispose(false, true); // true: libera también el material propio de la cápsula
      }

      const k = 1 - Math.exp(-dt * 10);
      for (const [id, a] of actors) {
        const r = world.residents[id]!;
        const isPlayer = id === playerResidentId;
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
