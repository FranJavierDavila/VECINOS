import type { Mesh, Scene, TransformNode } from '@babylonjs/core';
import type { BlockInstance, Content, PlayerPosition, World } from '@/game/core/types';
import { B } from './babylon';
import { instantiateActorAsset, type ActorRig } from './assets';
import { hash01, interiorRoute, interiorTarget, layoutGeometryOf, type Pt } from '@/game/interior';
import { stairGeomOf, stairPathPoints } from '@/game/stairs';

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
  /** Dirección de cutscenes (Fase D): mientras está activa, la IA normal no captura destinos;
   *  el actor solo consume la cola de tramos que le marca el director (nunca teletransporta). */
  directed: boolean;
  /** Rumbo actual (rad): el actor MIRA hacia donde camina (v1.2, credibilidad 2.5D).
   *  0 = el modelo mira +X (perfil); ±π/2 = de espaldas/frente al entrar o salir de casa. */
  yaw: number;
  /** Rumbo pendiente de terminar: el actor remata el giro aunque se pare (nunca queda torcido). */
  targetYaw: number | null;
  /** Gesto social en curso (stateAnimations: talk/laugh/argue/phone/sit…) o null. */
  gesture: string | null;
  /** Cuenta atrás del gesto temporal (0 = persistente hasta que alguien lo quite). */
  gestureT: number;
  /** El objetivo interior vigente es un ancla de asiento (rules.view.seatAnchors): se sienta al llegar. */
  seated: boolean;
  /** Rig del arte final (null mientras carga o si hay fallback greybox). */
  rig: ActorRig | null;
}

/**
 * API de dirección de cutscenes (Fase D): toma actores, colócalos en escena y márcales rutas.
 * Mientras un actor está "taken", el bucle normal de IA no le captura destinos: solo consume
 * la cola de tramos (la misma locomoción interpolada de siempre, cero teletransportes).
 */
export interface ActorsDirector {
  /** Posición del nodo (null si el actor no existe o está oculto). */
  nodeOf(id: string): { x: number; y: number; z: number } | null;
  /** Crea el actor si falta y lo marca como dirigido. false si el residente no está en escena. */
  take(id: string): boolean;
  /** Suelta al actor: la IA vuelve a decidir destino (cola y objetivo interior reseteados). */
  release(id: string): void;
  /** Coloca al actor en un punto de escena (staging teatral, decisión del contenido). */
  stageAt(id: string, x: number, floor: number, z: number): void;
  /** Encola la ruta del nodo actual al destino (pozo incluido si cambia la planta). */
  walkTo(id: string, dest: { x: number; z: number; floor: number; inside?: { block: string; local: Pt } }): boolean;
  /** true cuando el actor no tiene tramos pendientes (llegó — o no existe). */
  idle(id: string): boolean;
  /**
   * Estado social explícito (v1.2): talk/laugh/argue/phone/sit… según stateAnimations del
   * manifiesto. Con `seconds` > 0 el gesto expira solo (líneas de diálogo); null lo suelta
   * ya (al colgar el teléfono, al cerrar el modal). El clip que falte cae al default del rig.
   */
  setGesture(id: string, state: string | null, seconds?: number): void;
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
  const { Color3, MeshBuilder, Quaternion, StandardMaterial, Vector3 } = B();
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
    const a: Actor = { node: mesh, height, pivotY: height / 2, path: [], wanderT: 0, wanderLap: 0, targetLocal: null, lastLoc: null, directed: false, yaw: 0, targetYaw: null, gesture: null, gestureT: 0, seated: false, rig: null };
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
  /** Pozos verticales del mundo (features stairs/elevator), para el RITMO de los tramos verticales. */
  const shafts = Object.values(world.blocks).filter((b) => {
    const f = content.blocks[b.defId]!.features;
    return !!f && (f.stairs === true || f.elevator === true);
  });
  /** Pozos UTILIZABLES para rutear (v1.3): la escalera siempre; el ascensor SOLO si funciona
   *  (elevator_status 'ok'). Antes la presentación elegía el pozo más cercano sin mirar el
   *  estado: los vecinos "usaban" el ascensor averiado aunque el sim los mandase a la escalera. */
  const usableShafts = shafts.filter((b) => {
    const f = content.blocks[b.defId]!.features!;
    if (f.stairs === true) return true;
    return f.elevator === true && b.params.elevator_status === 'ok';
  });
  const shaftXOf = (b: BlockInstance): number => (b.cell.col + b.size.w / 2) * v.cellW;
  /** Calado transitablo del bloque (vivienda 2× o bloque común). */
  const depthOfBlock = (b: BlockInstance): number => (b.kind === 'dwelling' ? v.depth : v.commonDepth);
  /** Plano frontal de las viviendas: z local 0 de los interiores y origen del pasillo. */
  const frontZ = frontZOf(v.roomZ, v.commonDepth);

  /**
   * Ruta (cola de tramos) del nodo actual al destino: cambio de planta → pozo más cercano
   * (andar hasta él, subir/bajar, salir), y dentro de una vivienda con geometría 2D la ruta
   * pasa por los huecos del catálogo (nunca a través de tabiques). La comparten la IA normal
   * y el director de cutscenes: una sola verdad de locomoción.
   */
  const buildRoute = (a: Actor, dest: { x: number; y: number; z: number; inside?: { block: BlockInstance; local: Pt } | null }): void => {
    const node = a.node.position;
    let startX = node.x;
    let startZ = node.z;
    if (Math.abs(dest.y - node.y) > 0.05) {
      const floorNow = Math.round(node.y / v.cellH);
      const here = usableShafts
        .filter((s) => s.cell.floor === floorNow)
        .sort((s1, s2) => Math.abs(shaftXOf(s1) - startX) - Math.abs(shaftXOf(s2) - startX))[0];
      if (here) {
        const sx = shaftXOf(here);
        if (Math.abs(sx - startX) > 0.3) {
          a.path.push({ x: sx, y: node.y, z: v.corridorZ });
        }
        // Escalera REAL (v1.4): el tramo vertical se sustituye por el recorrido del contrato
        // (tramo A → descansillo → tramo B en dirección contraria → desembarco): los vecinos
        // suben y bajan por los peldaños, de perfil, como en una escalera de verdad.
        const feat = content.blocks[here.defId]!.features!;
        
        const stairPts = feat.stairs === true ? stairPathPoints(v, sx, node.y, dest.y) : [];
        if (stairPts.length > 1) {
          for (const p of stairPts) a.path.push({ x: p.x, y: p.y, z: p.z });
        } else {
          a.path.push({ x: sx, y: dest.y, z: v.corridorZ });
        }
        startX = sx;
        startZ = v.corridorZ;
      }
    }
    const legs: Pt[] = [];
    if (dest.inside) {
      const b = dest.inside.block;
      const geo = layoutGeometryOf(content, b);
      if (geo) {
        const x0 = b.cell.col * v.cellW;
        const outside = startZ < frontZ - 0.01;
        const fromLocal: Pt = outside
          ? { x: Math.min(b.size.w * v.cellW - v.margin, Math.max(v.margin, startX - x0)), z: 0.45 }
          : { x: startX - x0, z: startZ - frontZ };
        const route = interiorRoute(geo, fromLocal, dest.inside.local);
        if (route) {
          if (outside) legs.push({ x: x0 + fromLocal.x, z: frontZ + 0.45 });
          for (const p of route) legs.push({ x: x0 + p.x, z: frontZ + p.z });
        } else {
          legs.push({ x: (x0 + b.size.w * v.cellW) / 2, z: frontZ + 0.6 }); // sin ruta legal: al frente
        }
      } else {
        legs.push({ x: dest.x, z: dest.z });
      }
    }
    if (legs.length === 0) legs.push({ x: dest.x, z: dest.z });
    for (const p of legs) a.path.push({ x: p.x, y: dest.y, z: p.z });
  };

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
        const prevZ = node.z;
        if (isPlayer) {
          const inside = player.mode === 'inside';
          // Dentro de la vivienda el actor sigue la posición 2D (x + profundidad z del layout);
          // en el cubo de escalera (v1.4) manda la Z absoluta del recorrido (pathZ).
          const z = inside ? frontZ + Math.min(Math.max(player.z, 0), v.depth) : (player.pathZ ?? v.corridorZ);
          goal.set(player.x, player.floor * v.cellH + (inside ? 0.12 : 0.14) + a.pivotY, z);
          if (node.lengthSquared() === 0) node.copyFrom(goal);
          node.addInPlace(goal.subtract(node).scale(Math.min(1, k * 2)));
        } else {
          const b = world.blocks[r.location!]!;
          const home = world.blocks[r.home]!;
          const inRoom = b.kind === 'dwelling';
          const x0 = b.cell.col * v.cellW;
          // Con dirección de cutscene (Fase D) el actor solo consume su cola de tramos:
          // ni objetivo de IA ni captura de ruta (el director ya se la ha dado).
          if (!a.directed) {
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
              a.seated = false;
            }
            if (geo) {
              a.wanderT -= dt;
              if (a.path.length === 0 && a.wanderT <= 0) {
                a.wanderLap += 1;
                a.wanderT = v.npcWanderSeconds * (0.7 + 0.6 * hash01(id, a.wanderLap));
                const act = r.activity ? content.archetypes[r.archetype]?.activities[r.activity] : undefined;
                const anchorKind = act?.anchor;
                const anchored = anchorKind ? interiorTarget(content, geo, anchorKind, id, 0) : null;
                a.targetLocal = anchored ?? interiorTarget(content, geo, undefined, id, a.wanderLap);
                // Ancla de asiento (catálogo: rules.view.seatAnchors): al llegar se sienta (clip "sit").
                a.seated = anchored !== null && !!anchorKind && v.seatAnchors.includes(anchorKind);
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
              // Captura compartida (pozo más cercano + ruta interior por huecos): la misma
              // que usa el director de cutscenes — una sola verdad de locomoción.
              buildRoute(a, { x: goal.x, y: goal.y, z: goal.z, inside: geo && localTarget ? { block: b, local: localTarget } : null });
            }
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
              // Tramo con componente horizontal: crucero con llegada suave (frena al acercarse,
              // nunca sobrepasa). Con dy el tramo es 3D (pendiente de escalera, Task 29): el paso
              // reparte X/Z/Y con la MISMA velocidad de crucero, así la subida es física.
              const step = Math.min(npcSpeed * dt, (0.35 + wdh * 2.5) * dt, wdh);
              const t = step / wdh;
              node.x += (w.x - node.x) * t;
              node.z += (w.z - node.z) * t;
              node.y += wdy * t;
            }
            // Tramo terminado → siguiente tramo de la ruta.
            if (Math.hypot(w.x - node.x, w.z - node.z) < 0.06 && Math.abs(w.y - node.y) < 0.03) a.path.shift();
          }
        }

        // ── Rotación 2.5D (v1.2): el actor MIRA hacia donde camina. El pasillo es lateral (eje
        // X, perfil); entrar/salir de una vivienda es profundidad (eje Z: de espaldas al alejarse,
        // de frente al acercarse). Giro por el arco corto con el ritmo del catálogo
        // (rules.view.actorTurnSpeed). El rumbo queda PENDIENTE hasta rematarse: aunque el actor
        // se pare a mitad de giro, termina de encarar la dirección en la que iba (nadie se queda
        // torcido en una puerta).
        // Aplicación ROBUSTA (v1.3): si el nodo lleva rotationQuaternion (el loader glTF puede
        // ponérselo), Babylon IGNORA rotation.y — hay que escribir el cuaternión; si no,
        // rotation.y de toda la vida. En ambos casos SOLO yaw: nadie se ladea ni se tumba.
        const mdx = node.x - prevX;
        const mdz = node.z - prevZ;
        if (Math.hypot(mdx, mdz) / Math.max(1e-4, dt) > 0.25) a.targetYaw = Math.atan2(-mdz, mdx);
        if (a.targetYaw !== null) {
          let dYaw = a.targetYaw - a.yaw;
          dYaw = ((dYaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
          if (Math.abs(dYaw) < 0.02) {
            a.yaw = a.targetYaw; // rematado
            a.targetYaw = null;
          } else {
            a.yaw += dYaw * Math.min(1, dt * v.actorTurnSpeed);
          }
        }
        const q = a.node.rotationQuaternion;
        if (q) Quaternion.RotationYawPitchRollToRef(a.yaw, 0, 0, q);
        else a.node.rotation.y = a.yaw;

        // ── Animación (solo rigs) por prioridad de estados (v1.2) + SINCRONÍA DE ZANCADA (v1.3):
        //   gesto explícito → run (speed > runSpeed) → walk (mientras se avanza) → clip de
        //   actividad parado → sentado en ancla → idle. El ratio de playback sale de la
        //   velocidad PLANA real (m/s en el suelo; la Y no mueve piernas) contra la velocidad
        //   natural del clip (rules.view.animSync): las piernas acompañan al cuerpo, cero patinaje.
        if (a.gestureT > 0) {
          a.gestureT -= dt;
          if (a.gestureT <= 0) a.gesture = null;
        }
        if (a.rig) {
          const speedH = Math.hypot(node.x - prevX, node.z - prevZ) / Math.max(1e-4, dt);
          const def = content.assets?.actors?.[r.archetype];
          const activityClip = def?.activityAnimations?.[r.activity ?? ''] ?? null;
          const walkClip = def?.walkAnimation ?? 'walk';
          let clip: string | null;
          if (a.gesture) clip = a.gesture;
          else if (speedH > v.runSpeed) clip = 'run';
          else if (speedH > 0.25) clip = walkClip;
          else if (activityClip) clip = activityClip;
          else if (a.seated && a.path.length === 0) clip = 'sit';
          else clip = null;
          const sync = v.animSync;
          let rate = 1;
          if (!a.gesture && clip === 'run') rate = speedH / sync.runRefSpeed;
          else if (!a.gesture && clip === walkClip) rate = speedH / sync.walkRefSpeed;
          rate = Math.min(sync.maxRate, Math.max(sync.minRate, rate));
          a.rig.play(clip, rate);
        }
      }
    },
    /** Dirección de cutscenes (Fase D): toma/coloca/ruta/suelta actores como teatro. */
    director: {
      nodeOf(id: string): { x: number; y: number; z: number } | null {
        const a = actors.get(id);
        return a && a.node.isEnabled() ? { x: a.node.position.x, y: a.node.position.y, z: a.node.position.z } : null;
      },
      take(id: string): boolean {
        const r = world.residents[id];
        if (!r || !r.present || r.location === null) return false;
        if (!actors.has(id)) ensureActor(id, r.archetype);
        const a = actors.get(id)!;
        a.directed = true;
        a.seated = false;
        a.node.setEnabled(true);
        return true;
      },
      release(id: string): void {
        const a = actors.get(id);
        if (!a) return;
        a.directed = false;
        a.path = [];
        a.targetLocal = null;
        a.wanderT = 0;
        a.seated = false;
        a.gesture = null;
        a.gestureT = 0;
        a.targetYaw = null;
      },
      stageAt(id: string, x: number, floor: number, z: number): void {
        const a = actors.get(id);
        if (!a) return;
        a.path = [];
        a.node.position.set(x, floor * v.cellH + 0.14 + a.pivotY, z);
      },
      walkTo(id: string, dest: { x: number; z: number; floor: number; inside?: { block: string; local: Pt } }): boolean {
        const a = actors.get(id);
        if (!a) return false;
        const b = dest.inside ? world.blocks[dest.inside.block] : undefined;
        const inside = b && dest.inside
          ? {
              block: b,
              local: {
                x: Math.min(b.size.w * v.cellW - 0.2, Math.max(0.2, dest.inside.local.x)),
                z: Math.min(depthOfBlock(b) - 0.2, Math.max(0.2, dest.inside.local.z)),
              },
            }
          : null;
        buildRoute(a, { x: dest.x, y: dest.floor * v.cellH + 0.14 + a.pivotY, z: dest.z, inside });
        return true;
      },
      idle(id: string): boolean {
        const a = actors.get(id);
        return !a || a.path.length === 0;
      },
      setGesture(id: string, state: string | null, seconds = 0): void {
        const a = actors.get(id);
        if (!a) return;
        a.gesture = state;
        a.gestureT = state && seconds > 0 ? seconds : 0;
      },
    },
  };
}
