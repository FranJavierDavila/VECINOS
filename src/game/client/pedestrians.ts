import type { Mesh, Scene, TransformNode } from '@babylonjs/core';
import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { B } from './babylon';
import { instantiateActorAsset, type ActorRig } from './assets';
import { MODEL_YAW_OFFSET } from './actors';

/**
 * VIANDANTES (v1.22→v1.25) — paseantes anónimos por las aceras: caminan, algunos ENTRAN al
 * edificio (se desvanecen en el portal) y otros SALEN de él. Solo presentación (el sim
 * no sabe de ellos) y solo visibles en la vista "edificio" — en planta/estancia se apagan
 * para no estorbar ni cargar recursos.
 *
 * v1.25 — MISMA ESTÉTICA QUE LOS VECINOS + ORIENTACIÓN CORRECTA:
 *  · Los viandantes SON ahora vecinos de verdad: rigs glTF del mismo catálogo de arquetipos
 *    (jubilada, estudiante, repartidor, musico…) con el clip de andar sincronizado a la
 *    velocidad real (animSync del catálogo). El rig primitivo de cilindros queda como
 *    fallback si un modelo falla (el juego nunca se rompe por un asset).
 *  · ORIENTACIÓN: el rig mira hacia donde anda (la misma convención yaw=atan2(−dz,dx)
 *    verificada de actors.ts — antes patinaban de lado: piernas al aire y cuerpo cruzado).
 */

export interface PedRig {
  root: TransformNode;
  legs: Mesh[];
  arms: Mesh[];
  bodyMat: import('@babylonjs/core').StandardMaterial;
  height: number;
  /** true mientras porta algo en alto (cartel): brazos estirados hacia arriba. */
  carrying: boolean;
  phase: number;
}

/** Fábrica de figuritas cartoon (cuerpo cilíndrico, cabeza esférica, gorro opcional). */
export function createPedFactory(scene: Scene) {
  const { Color3, MeshBuilder, StandardMaterial, TransformNode, Vector3 } = B();
  const mats = new Map<string, import('@babylonjs/core').StandardMaterial>();
  const matOf = (hex: string, shade = 1): import('@babylonjs/core').StandardMaterial => {
    const key = `${hex}:${shade}`;
    let m = mats.get(key);
    if (!m) {
      m = new StandardMaterial(`ped_${key}`, scene);
      const c = Color3.FromHexString(hex);
      m.diffuseColor = shade === 1 ? c : c.scale(shade);
      m.specularColor = new Color3(0, 0, 0);
      mats.set(key, m);
    }
    return m;
  };

  /**
   * Muñeco articulado (proporciones sobre altura 1.3 m):
   *   pies en y=0 → piernas 0..0.5 (pivote de cadera en 0.5) → torso 0.5..1.14
   *   → brazos colgando del hombro 1.08 → cabeza 1.32 (Ø 0.34) → gorro opcional.
   * El paso: piernas en péndulo contrafasado, brazos al revés de las piernas.
   */
  const make = (bodyHex: string, hatHex: string | null, height = 1.3): PedRig => {
    const root = new TransformNode('viandante', scene);
    const bodyMat = matOf(bodyHex);
    const s = height / 1.3;
    const torso = MeshBuilder.CreateCylinder('ped_torso', { diameterTop: 0.3, diameterBottom: 0.4, height: 0.64, tessellation: 10 }, scene);
    torso.position.y = 0.82 * s;
    torso.material = bodyMat;
    torso.parent = root;
    const head = MeshBuilder.CreateSphere('ped_cabeza', { diameter: 0.34, segments: 8 }, scene);
    head.position.y = 1.31 * s;
    head.material = matOf(bodyHex, 0.82); // cabeza en tono más oscuro: muñeco sin datos extra
    head.parent = root;
    if (hatHex) {
      const hat = MeshBuilder.CreateCylinder('ped_gorro', { diameterTop: 0.24, diameterBottom: 0.34, height: 0.16, tessellation: 10 }, scene);
      hat.position.y = 1.52 * s;
      hat.material = matOf(hatHex);
      hat.parent = root;
    }
    const legs: Mesh[] = [];
    for (const sx of [-0.1, 0.1]) {
      const leg = MeshBuilder.CreateBox('ped_pierna', { width: 0.13, height: 0.5, depth: 0.15 }, scene);
      leg.setPivotPoint(new Vector3(0, 0.25 * s, 0)); // pivote en la CADERA (punta superior)
      leg.position.set(sx, 0.5 * s, 0); // la caja llega AL SUELO: pies en y=0, sin flotar
      leg.material = matOf(bodyHex, 0.62);
      leg.parent = root;
      legs.push(leg);
    }
    const arms: Mesh[] = [];
    for (const sx of [-0.25, 0.25]) {
      const arm = MeshBuilder.CreateBox('ped_brazo', { width: 0.1, height: 0.46, depth: 0.12 }, scene);
      arm.setPivotPoint(new Vector3(0, 0.23 * s, 0)); // pivote en el HOMBRO (punta superior)
      arm.position.set(sx, 1.08 * s, 0);
      arm.material = matOf(bodyHex, 0.78);
      arm.parent = root;
      arms.push(arm);
    }
    return { root, legs, arms, bodyMat, height, carrying: false, phase: 0 };
  };

  /**
   * Pose del rig según el paso y la carga. `swing` 0 = quieto.
   *  · Normal: brazos en contrafase de las piernas (andar creíble).
   *  · carrying: ambos brazos ESTIRADOS HACIA ARRIBA agarrando el palo del cartel
   *    (rotación ~180° con leve convergencia hacia el eje).
   */
  const pose = (rig: PedRig, swing: number): void => {
    const s = rig.height / 1.3;
    rig.legs[0]!.rotation.x = Math.sin(rig.phase) * 0.6 * swing;
    rig.legs[1]!.rotation.x = -Math.sin(rig.phase) * 0.6 * swing;
    rig.root.position.y = Math.abs(Math.sin(rig.phase)) * 0.045 * swing;
    if (rig.carrying) {
      for (let i = 0; i < rig.arms.length; i++) {
        const arm = rig.arms[i]!;
        arm.rotation.x = Math.PI * 0.94;
        arm.rotation.z = (i === 0 ? 1 : -1) * 0.16; // manos convergen sobre el palo
      }
    } else {
      for (let i = 0; i < rig.arms.length; i++) {
        const arm = rig.arms[i]!;
        arm.rotation.x = (i === 0 ? -1 : 1) * Math.sin(rig.phase) * 0.45 * swing;
        arm.rotation.z = 0;
      }
    }
    void s;
  };

  return {
    make,
    pose,
    dispose() {
      for (const m of mats.values()) m.dispose();
      mats.clear();
    },
  };
}

/** Un viandante: rig glTF del catálogo de vecinos (o primitivo de fallback) + su paseo. */
interface Walker {
  gltf: ActorRig | null;
  prim: PedRig | null;
  pathIndex: number;
  x: number;
  z: number;
  speed: number;
  phase: number;
  /** 'walk' recorre la acera; 'enter' va hacia el portal y se desvanece; 'exit' sale de él. */
  mode: 'walk' | 'enter' | 'exit' | 'leave';
  /** Escala para entrar/salir por el portal (desvanecido cartoon). */
  scale: number;
  /** Última orientación aplicada (rad) — solo se escribe si cambia (cero escrituras ociosas). */
  yaw: number;
}

export interface PedestriansDirector {
  update(dt: number): void;
  setVisible(visible: boolean): void;
  aliveCount(): number;
  /** v1.30 — posiciones vivas de los viandantes (entrando/saliendo incluidos): el portal
   *  abre sus puertas correderas también para ellos y el controlador los manda en `movers`. */
  positions(): { x: number; z: number }[];
  dispose(): void;
}

export function createPedestrians(scene: Scene, world: World, content: Content): PedestriansDirector {
  const { TransformNode } = B();
  const cfg = content.rules.view.pedestrians;
  if (!cfg.enabled || cfg.paths.length === 0) {
    return { update() {}, setVisible() {}, aliveCount: () => 0, positions: () => [], dispose() {} };
  }
  // Límites de la calle derivados de las rutas (sin duplicar datos en el catálogo).
  const bounds = {
    min: Math.min(...cfg.paths.map((p) => Math.min(p.x0, p.x1))),
    max: Math.max(...cfg.paths.map((p) => Math.max(p.x0, p.x1))),
  };
  const factory = createPedFactory(scene);
  const root = new TransformNode('viandantes', scene);
  let visible = true;
  const walkers = new Set<Walker>();
  let nextSpawn = 2;
  let roll = 0;

  // ── POOL de rigs glTF (misma estética que los vecinos): instancias del catálogo de
  // arquetipos con clip de andar. Asíncrono: hasta que llega el primero, la acera queda
  // vacía unos segundos (y si el modelo falla, rig null → rig primitivo de fallback).
  const vCfg = content.rules.view;
  const archIds = cfg.actorArchetypes?.length ? cfg.actorArchetypes : Object.keys(content.assets?.actors ?? {});
  const archDefs = archIds
    .map((id) => content.assets?.actors?.[id])
    .filter((d): d is NonNullable<typeof d> => !!d && !!d.animations?.walk);
  const primColors = cfg.colors;
  const free: { gltf: ActorRig | null; prim: PedRig | null }[] = [];
  let poolReady = false;
  const buildPool = async (): Promise<void> => {
    const base = content.assets?.base ?? '/assets/';
    const jobs: Promise<void>[] = [];
    const total = Math.max(cfg.maxAlive, 1);
    for (let i = 0; i < total; i++) {
      const def = archDefs.length > 0 ? archDefs[i % archDefs.length]! : null;
      jobs.push(
        (async () => {
          try {
            if (def) {
              const rig = await instantiateActorAsset(scene, def, base, `viandante_${i}`);
              if (rig) {
                rig.root.parent = root;
                rig.root.setEnabled(false);
                free.push({ gltf: rig, prim: null });
                return;
              }
            }
            // Fallback primitivo (mismo pool de colores del catálogo).
            const prim = factory.make(primColors[i % primColors.length]!, null);
            prim.root.parent = root;
            prim.root.setEnabled(false);
            free.push({ gltf: null, prim });
          } catch {
            // Sin rig → el pool simplemente queda más corto; la acera se vacía con elegancia.
          }
        })(),
      );
    }
    await Promise.all(jobs);
    poolReady = true;
  };
  void buildPool();

  const walkRate = (speed: number): number => {
    const sync = vCfg.animSync;
    const ref = speed / Math.max(0.1, sync.walkRefSpeed);
    return Math.min(sync.maxRate, Math.max(sync.minRate, ref));
  };

  const spawn = (): void => {
    const slot = free.pop();
    if (!slot) return;
    const pathIndex = Math.floor(hash01('viandante_ruta', roll) * cfg.paths.length) % cfg.paths.length;
    const path = cfg.paths[pathIndex]!;
    const dir = path.dir >= 0 ? 1 : -1;
    const speed = cfg.speedMin + hash01('viandante_velo', roll) * Math.max(0.1, cfg.speedMax - cfg.speedMin);
    const enterRoll = hash01('viandante_portal', roll);
    let mode: Walker['mode'] = 'walk';
    let x: number;
    if (enterRoll < cfg.enterChance) {
      // Entra al edificio: camina hacia el portal por SU acera y cruza las puertas correderas.
      mode = 'enter';
      x = dir > 0 ? bounds.min : bounds.max;
    } else if (enterRoll < cfg.enterChance + cfg.exitChance) {
      // Sale del edificio: nace en el umbral del portal (tras las hojas) y crece al cruzarlas.
      mode = 'exit';
      x = cfg.enterX;
    } else {
      x = dir > 0 ? bounds.min : bounds.max;
    }
    const z = mode === 'enter' || mode === 'exit' ? cfg.paths[0]!.z : path.z;
    const w: Walker = { gltf: slot.gltf, prim: slot.prim, pathIndex, x, z, speed, phase: hash01('viandante_fase', roll) * 6, mode, scale: mode === 'exit' ? 0.05 : 1, yaw: dir > 0 ? 0 : Math.PI };
    const node = w.gltf ? w.gltf.root : w.prim!.root;
    node.setEnabled(visible);
    node.scaling.setAll(w.scale);
    // v1.26: el rig mira hacia donde anda CON EL OFFSET DEL MODELO (los rigs miran a −Z;
    // sin el offset se veía la frontal caminando de lado — piernas cruzadas).
    node.rotation.y = w.yaw + MODEL_YAW_OFFSET;
    if (w.gltf) w.gltf.play('walk', walkRate(speed));
    walkers.add(w);
  };

  /** Devuelve el rig al pool (el mismo muñeco reaparece: cero creaciones por paseo). */
  const recycle = (w: Walker): void => {
    const node = w.gltf ? w.gltf.root : w.prim!.root;
    node.setEnabled(false);
    free.push({ gltf: w.gltf, prim: w.prim });
  };

  return {
    update(dt: number) {
      nextSpawn -= dt;
      if (nextSpawn <= 0 && poolReady) {
        nextSpawn = cfg.spawnEveryMin + hash01('viandante_t', world.tick + roll) * (cfg.spawnEveryMax - cfg.spawnEveryMin);
        if (walkers.size < cfg.maxAlive) spawn();
      }
      for (const w of [...walkers]) {
        const path = cfg.paths[w.pathIndex]!;
        const dir = path.dir >= 0 ? 1 : -1;
        // v1.30 — el UMBRAL del portal (enterZ del catálogo): entrar/salir pasa POR LAS
        // PUERTAS correderas, no se desvanece a mitad de acera.
        const enterZ = cfg.enterZ ?? -1.7;
        let movedX = 0;
        if (w.mode === 'enter') {
          // Hacia el portal (por la acera frontal); al acercarse, la z vira al umbral y cruza.
          const target = cfg.enterX;
          const d = target - w.x;
          const step = Math.min(Math.abs(d), w.speed * dt) * Math.sign(d || 1);
          w.x += step;
          movedX = step;
          if (Math.abs(d) < 2.4) {
            const dzT = enterZ - w.z;
            w.z += Math.sign(dzT) * Math.min(Math.abs(dzT), w.speed * dt * 0.9);
          }
          w.phase += dt * w.speed * 4.2;
          if (Math.abs(target - w.x) < 0.35 && Math.abs(w.z - enterZ) < 0.45) {
            w.scale -= dt * 2.4;
            if (w.scale <= 0.05) {
              recycle(w);
              walkers.delete(w);
              continue;
            }
          }
        } else if (w.mode === 'exit') {
          // Sale del portal: crece cruzando las hojas y toma la acera.
          w.scale = Math.min(1, w.scale + dt * 2.4);
          if (w.scale >= 1) {
            w.mode = 'leave';
          }
        } else if (w.mode === 'leave') {
          // Del umbral a la acera (z del camino elegido); después, paseo normal.
          const streetZ = cfg.paths[0]!.z;
          const dzT = streetZ - w.z;
          if (Math.abs(dzT) > 0.15) {
            w.z += Math.sign(dzT) * Math.min(Math.abs(dzT), w.speed * dt);
            w.phase += dt * w.speed * 4.2;
          } else {
            w.mode = 'walk';
            w.pathIndex = 0;
            const outDir = hash01('viandante_salida', roll) < 0.5 ? -0.6 : 0.6;
            w.x += outDir;
            w.yaw = outDir < 0 ? Math.PI : 0;
          }
        } else {
          const step = dir * w.speed * dt;
          w.x += step;
          movedX = step;
          w.phase += dt * w.speed * 4.2;
          if ((dir > 0 && w.x > path.x1) || (dir < 0 && w.x < path.x0)) {
            recycle(w);
            walkers.delete(w);
            continue;
          }
        }
        // v1.25 — ORIENTACIÓN: el rig mira hacia donde anda (convención de actors.ts:
        // yaw 0 = mirando a +X; π = a −X). Solo escrituras en cambio de sentido.
        // v1.26: + offset del modelo (los rigs authorados a −Z).
        if (movedX !== 0) {
          const wantYaw = movedX > 0 ? 0 : Math.PI;
          if (w.yaw !== wantYaw) {
            w.yaw = wantYaw;
            (w.gltf ? w.gltf.root : w.prim!.root).rotation.y = wantYaw + MODEL_YAW_OFFSET;
          }
        }
        if (w.prim) {
          w.prim.phase = w.phase;
          factory.pose(w.prim, 1);
        }
        const node = w.gltf ? w.gltf.root : w.prim!.root;
        node.position.x = w.x;
        node.position.z = w.z;
        node.scaling.setAll(w.scale);
      }
    },
    setVisible(v: boolean) {
      if (visible === v) return;
      visible = v;
      root.setEnabled(v);
    },
    aliveCount: () => walkers.size,
    positions(): { x: number; z: number }[] {
      const out: { x: number; z: number }[] = [];
      for (const w of walkers) out.push({ x: w.x, z: w.z });
      return out;
    },
    dispose() {
      for (const w of walkers) {
        if (w.gltf) w.gltf.dispose();
        else w.prim!.root.dispose(false, true);
      }
      walkers.clear();
      for (const f of free) {
        if (f.gltf) f.gltf.dispose();
        else f.prim!.root.dispose(false, true);
      }
      free.length = 0;
      root.dispose(false, false);
      factory.dispose();
    },
  };
}
