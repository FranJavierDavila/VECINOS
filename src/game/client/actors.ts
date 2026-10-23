import type { Mesh, Scene, TransformNode } from '@babylonjs/core';
import type { Content, PlayerPosition, World } from '@/game/core/types';
import { B } from './babylon';
import { instantiateActorAsset, type ActorRig } from './assets';

interface Actor {
  /** Nodo posicionable: cápsula greybox o raíz del modelo glTF (pivote en pies). */
  node: Mesh | TransformNode;
  height: number;
  /** Offset Y del pivote: cápsula centrada (+h/2) o modelo con pies en el origen (+margen). */
  pivotY: number;
  /** X previa para detectar si camina (elige clip walk/idle). */
  prevX: number;
  /** Rig del arte final (null mientras carga o si hay fallback greybox). */
  rig: ActorRig | null;
}

/**
 * El jugador y los vecinos: cápsulas greybox o, si el manifiesto de assets declara un
 * modelo glTF para el arquetipo (Content.assets.actors), el modelo con sus animaciones
 * (idle/walk por desplazamiento y clip por actividad vía activityAnimations).
 * Color y altura salen de la vista del arquetipo; radios y fallbacks, de content.rules.view.
 *
 * Dinámico (multijugador): la plantilla se sincroniza con world.residents en cada
 * update — residentes nuevos reciben nodo y residentes que ya no existen lo pierden.
 */
export function createActors(scene: Scene, world: World, content: Content) {
  const { Color3, MeshBuilder, StandardMaterial, Vector3 } = B();
  const v = content.rules.view;
  const actors = new Map<string, Actor>();

  /** Crea la cápsula de un residente (greybox/fallback) y lanza la carga del modelo si el manifiesto lo declara. */
  const ensureActor = (id: string, archetype: string): Actor => {
    const view = content.archetypes[archetype]?.view;
    const height = view?.height ?? v.actorFallbackHeight;
    const mesh = MeshBuilder.CreateCapsule(id, { height, radius: v.actorRadius }, scene);
    const m = new StandardMaterial(`${id}_mat`, scene);
    m.diffuseColor = Color3.FromHexString(view?.color ?? v.actorFallbackColor);
    m.emissiveColor = m.diffuseColor.scale(0.25);
    mesh.material = m;
    mesh.isPickable = false;
    const a: Actor = { node: mesh, height, pivotY: height / 2, prevX: 0, rig: null };
    actors.set(id, a);

    // Arte final (opcional): modelo glTF del manifiesto; cualquier fallo → cápsula.
    const def = content.assets?.actors?.[archetype];
    if (def && content.assets) {
      void instantiateActorAsset(scene, def, content.assets.base, `${id}:${archetype}`).then((rig) => {
        if (!rig) return; // fallback greybox permanente
        const cur = actors.get(id);
        if (!cur || cur.rig) {
          rig.dispose(); // el residente se fue (o ya llegó otro rig): no dejar basura
          return;
        }
        // El modelo se authora a nominalHeight: escala uniforme a la altura del arquetipo.
        rig.root.scaling.setAll(height / def.nominalHeight);
        cur.node.dispose(false, true); // cápsula fuera (libera también su material propio)
        cur.node = rig.root;
        cur.pivotY = 0.02; // pies en el suelo
        cur.rig = rig;
      });
    }
    return a;
  };

  const goal = new Vector3();

  return {
    /** playerResidentId identifica al residente del jugador local (multijugador: puede ser un invitado). */
    update(dt: number, player: PlayerPosition, playerResidentId: string) {
      // Altas y bajas: residentes sin nodo → crear; nodos huérfanos → dispose + remove.
      for (const id in world.residents) {
        if (!actors.has(id)) ensureActor(id, world.residents[id]!.archetype);
      }
      const gone: string[] = [];
      for (const [id, a] of actors) {
        if (!world.residents[id]) gone.push(id);
      }
      for (const id of gone) {
        const a = actors.get(id)!;
        actors.delete(id);
        if (a.rig) a.rig.dispose();
        else if (a.node instanceof B().Mesh) a.node.dispose(false, true);
        else a.node.dispose(false, false);
      }

      const k = 1 - Math.exp(-dt * 10);
      for (const [id, a] of actors) {
        const r = world.residents[id]!;
        const isPlayer = id === playerResidentId;
        a.node.setEnabled(isPlayer || (r.present && r.location !== null));
        if (!a.node.isEnabled()) continue;
        if (isPlayer) {
          const inside = player.mode === 'inside';
          goal.set(player.x, player.floor * v.cellH + (inside ? 0.12 : 0.14) + a.pivotY, inside ? v.roomZ : v.corridorZ);
        } else {
          const b = world.blocks[r.location!]!;
          const home = world.blocks[r.home]!;
          const inRoom = b.kind === 'dwelling';
          const x = b.layer === 'corridor' ? (home.cell.col + 0.5) * v.cellW : (b.cell.col + b.size.w / 2) * v.cellW;
          goal.set(x, b.cell.floor * v.cellH + 0.14 + a.pivotY, inRoom ? v.roomZ : v.corridorZ);
        }
        if (a.node.position.lengthSquared() === 0) a.node.position.copyFrom(goal);
        a.node.position.addInPlace(goal.subtract(a.node.position).scale(isPlayer ? Math.min(1, k * 2) : k));

        // Animación (solo rigs): clip por actividad → walk si se mueve → idle por defecto.
        if (a.rig) {
          const moved = Math.abs(goal.x - a.prevX) > 0.01;
          a.prevX = goal.x;
          const def = content.assets?.actors?.[r.archetype];
          const activityClip = def?.activityAnimations?.[r.activity ?? ''] ?? null;
          a.rig.play(activityClip ?? (moved ? (def?.walkAnimation ?? null) : null));
        }
      }
    },
  };
}
