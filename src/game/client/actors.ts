import type { Mesh, Scene, TransformNode } from '@babylonjs/core';
import type { BlockInstance, Content, PlayerPosition, World } from '@/game/core/types';
import { B } from './babylon';
import { instantiateActorAsset, type ActorRig } from './assets';
import { hash01, interiorRoute, interiorTarget, layoutGeometryOf, type Pt } from '@/game/interior';

/** Plano frontal de las viviendas: z local 0 de los interiores (la cara de la puerta). */
const frontZOf = (roomZ: number, commonDepth: number): number => roomZ - commonDepth / 2;

interface Actor {
  /** Nodo posicionable: cápsula greybox o raíz del modelo glTF (pivote en pies). */
  node: Mesh | TransformNode;
  height: number;
  /** Offset Y del pivote: cápsula centrada (+h/2) o modelo con pies en el origen (+margen). */
  pivotY: number;
  /** Cola de tramos en curso: el actor la agota ANTES de capturar el destino del mundo de nuevo
   *  (ir al pozo → subir → salir: un salto del sim se ve como un viaje, nunca un teletransporte). */
  path: { x: number; y: number; z: number }[];
  /** Vida interior (Fase C): cuenta atrás para el próximo punto de deambulación y nº de vuelta
   *  (el punto es determinista por residente+ vuelta: sin RNG global ni capturas irreproducibles). */
  wanderT: number;
  wanderLap: number;
  /** Objetivo interior VIGENTE (coords locales de la vivienda): se refresca con la cadencia del
   *  catálogo (npcWanderSeconds), no cada tick — amortigua el parpadeo de actividades con chance. */
  targetLocal: Pt | null;
  lastLoc: string | null;
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
    const a: Actor = { node: mesh, height, pivotY: height / 2, path: [], wanderT: 0, wanderLap: 0, targetLocal: null, lastLoc: null, rig: null };
    actors.set(id, a);

    // Arte final (opcional): modelo glTF del manifiesto; cualquier fallo → cápsula.
    const def = content.assets?.actors?.[archetype];
    if (def && content.assets) {
      void instantiateActorAsset(scene, def, content.assets.base, `${id}:${archetype}`).then((rig) => {
        // La escena pudo morir mientras cargaba (restart/Cargar partida): no adjuntar nada viejo.
        if (rig && scene.isDisposed) {
          rig.dispose();
          return;
        }
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
  /** Pozos verticales del mundo (features stairs/elevator): para rutear los cambios de planta. */
  const shafts = Object.values(world.blocks).filter((b) => {
    const f = content.blocks[b.defId]!.features;
    return !!f && (f.stairs === true || f.elevator === true);
  });
  const shaftXOf = (b: BlockInstance): number => (b.cell.col + b.size.w / 2) * v.cellW;

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
      const frontZ = frontZOf(v.roomZ, v.commonDepth);
      // Ritmos del catálogo (rules.view): crucero de vecinos y subida por pozo.
      const npcSpeed = v.npcWalkSpeed;
      const width = Math.max(...Object.values(world.blocks).map((b) => (b.cell.col + b.size.w) * v.cellW));
      for (const [id, a] of actors) {
        const r = world.residents[id]!;
        const isPlayer = id === playerResidentId;
        a.node.setEnabled(isPlayer || (r.present && r.location !== null));
        if (!a.node.isEnabled()) continue;
        const node = a.node.position;
        const prevX = node.x;
        const prevY = node.y;
        const prevZ = node.z;
        if (isPlayer) {
          const inside = player.mode === 'inside';
          // Dentro de la vivienda el actor sigue la posición 2D (x + profundidad z del layout).
          const z = inside ? frontZ + Math.min(Math.max(player.z, 0), v.depth) : v.corridorZ;
          goal.set(player.x, player.floor * v.cellH + (inside ? 0.12 : 0.14) + a.pivotY, z);
          if (node.lengthSquared() === 0) node.copyFrom(goal);
          node.addInPlace(goal.subtract(node).scale(Math.min(1, k * 2)));
        } else {
          const b = world.blocks[r.location!]!;
          const home = world.blocks[r.home]!;
          const inRoom = b.kind === 'dwelling';
          const x0 = b.cell.col * v.cellW;
          let gx = b.layer === 'corridor' ? (home.cell.col + 0.5) * v.cellW : (x0 + b.size.w * v.cellW) / 2;
          let gz = inRoom ? frontZ + 0.6 : v.corridorZ;
          // ── Vida interior (Fase C): en vivienda, el punto lo decide el contenido. La actividad
          // con `anchor` (cama, tv, stove…) coloca al vecino en SU estancia por el catálogo de
          // anclas (rooms.json); sin ancla, deambula por las estancias abiertas. El objetivo se
          // REFRESCA con la cadencia npcWanderSeconds (no cada tick): una actividad con chance
          // que parpadea en el sim no arrastra al vecino por la casa. Cerradas jamás son destino.
          const geo = inRoom ? layoutGeometryOf(content, b) : null;
          let localTarget: Pt | null = null;
          if (a.lastLoc !== r.location) {
            a.lastLoc = r.location;
            a.targetLocal = null;
            a.wanderT = 0;
          }
          if (geo) {
            a.wanderT -= dt;
            if (a.path.length === 0 && a.wanderT <= 0) {
              a.wanderLap += 1;
              a.wanderT = v.npcWanderSeconds * (0.7 + 0.6 * hash01(id, a.wanderLap));
              const act = r.activity ? content.archetypes[r.archetype]?.activities[r.activity] : undefined;
              a.targetLocal = (act?.anchor ? interiorTarget(content, geo, act.anchor, id, 0) : null)
                ?? interiorTarget(content, geo, undefined, id, a.wanderLap);
            }
            localTarget = a.targetLocal;
          }
          if (localTarget) {
            gx = x0 + localTarget.x;
            gz = frontZ + localTarget.z;
          }
          goal.set(gx, b.cell.floor * v.cellH + 0.14 + a.pivotY, gz);
          // ── Locomoción interpolada (nada de teletransportes): el destino del sim se recorre a
          // velocidad de crucero del catálogo, tramo a tramo. Los saltos del sim (IA cada aiHopTicks)
          // se encolan: el actor agota su ruta (pozo incluido) y SOLO THEN captura el destino nuevo.
          if (node.lengthSquared() === 0) node.copyFrom(goal);
          const dh = Math.hypot(goal.x - node.x, goal.z - node.z);
          const dy = Math.abs(goal.y - node.y);
          if (dh > width + 2 || dy > v.cellH * 1.6) {
            // Estado imposible (aparición/carga/reconciliación): sin teatro.
            node.copyFrom(goal);
            a.path = [];
          } else if (a.path.length === 0) {
            // Captura: sin cambio de planta → tramo directo. Con cambio → pozo más cercano:
            // andar hasta él (saliendo de la vivienda si hace falta), subir y salir al destino.
            let startX = node.x;
            let startZ = node.z;
            if (dy > 0.05) {
              const here = shafts
                .filter((s) => s.cell.floor === b.cell.floor)
                .sort((s1, s2) => Math.abs(shaftXOf(s1) - node.x) - Math.abs(shaftXOf(s2) - node.x))[0];
              if (here && Math.abs(shaftXOf(here) - node.x) > 0.3) {
                a.path.push({ x: shaftXOf(here), y: node.y, z: v.corridorZ });
              }
              if (here) {
                a.path.push({ x: shaftXOf(here), y: goal.y, z: v.corridorZ });
                startX = shaftXOf(here);
                startZ = v.corridorZ;
              }
            }
            // Tramo final: dentro de una vivienda con geometría 2D, la ruta pasa por los huecos
            // del catálogo (nunca a través de tabiques): entrada por la puerta + cruce de
            // estancias (interior.ts). Fuera de ella, el tramo directo de siempre.
            const legs: Pt[] = [];
            if (geo && localTarget) {
              const outside = startZ < frontZ - 0.01;
              const fromLocal: Pt = outside
                ? { x: Math.min(b.size.w * v.cellW - v.margin, Math.max(v.margin, startX - x0)), z: 0.45 }
                : { x: startX - x0, z: startZ - frontZ };
              const route = interiorRoute(geo, fromLocal, localTarget);
              if (route) {
                if (outside) legs.push({ x: x0 + fromLocal.x, z: frontZ + 0.45 });
                for (const p of route) legs.push({ x: x0 + p.x, z: frontZ + p.z });
              } else {
                legs.push({ x: (x0 + b.size.w * v.cellW) / 2, z: frontZ + 0.6 }); // sin ruta legal: al frente
              }
            }
            if (legs.length === 0) legs.push({ x: goal.x, z: goal.z });
            for (const p of legs) a.path.push({ x: p.x, y: goal.y, z: p.z });
          }
          if (a.path.length > 0) {
            const w = a.path[0]!;
            const wdh = Math.hypot(w.x - node.x, w.z - node.z);
            const wdy = w.y - node.y;
            if (Math.abs(wdy) > 0.02 && wdh < 0.3) {
              // Tramo VERTICAL en el pozo: ritmo del catálogo (ascensor operativo → cabina).
              const shaftHere = shafts
                .filter((s) => s.cell.floor === b.cell.floor && Math.abs(shaftXOf(s) - node.x) < 0.3)
                .sort((s1, s2) => Math.abs(shaftXOf(s1) - node.x) - Math.abs(shaftXOf(s2) - node.x))[0];
              const feat = shaftHere ? content.blocks[shaftHere.defId]!.features : undefined;
              const rate = feat?.elevator && shaftHere!.params.elevator_status === 'ok' ? v.cellH / v.elevatorSeconds : v.cellH / v.stairsSeconds;
              node.y += Math.sign(wdy) * Math.min(Math.abs(wdy), rate * dt);
            } else if (wdh > 0.001) {
              // Tramo horizontal: crucero con llegada suave (frena al acercarse, nunca sobrepasa).
              const step = Math.min(npcSpeed * dt, (0.35 + wdh * 2.5) * dt, wdh);
              const t = step / wdh;
              node.x += (w.x - node.x) * t;
              node.z += (w.z - node.z) * t;
            }
            // Tramo terminado → siguiente tramo de la ruta.
            if (Math.hypot(w.x - node.x, w.z - node.z) < 0.06 && Math.abs(w.y - node.y) < 0.03) a.path.shift();
          }
        }

        // Animación (solo rigs) por velocidad REAL del nodo: andar mientras se avanza (aunque
        // el destino cambie), clip de actividad parado (ej. spray), idle por defecto.
        if (a.rig) {
          const speed = Math.hypot(node.x - prevX, node.y - prevY, node.z - prevZ) / Math.max(1e-4, dt);
          const def = content.assets?.actors?.[r.archetype];
          const activityClip = def?.activityAnimations?.[r.activity ?? ''] ?? null;
          a.rig.play(speed > 0.3 ? (def?.walkAnimation ?? activityClip) : activityClip);
        }
      }
    },
  };
}
