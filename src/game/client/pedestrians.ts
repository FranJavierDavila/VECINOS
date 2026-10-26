import type { Color3, Mesh, Scene, StandardMaterial, TransformNode } from '@babylonjs/core';
import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { B } from './babylon';

/**
 * VIANDANTES (v1.22→v1.24) — paseantes anónimos por las aceras: caminan, algunos ENTRAN al
 * edificio (se desvanecen en el portal) y otros SALEN de él. Solo presentación (el sim
 * no sabe de ellos) y solo visibles en la vista "edificio" — en planta/estancia se apagan
 * para no estorbar ni cargar recursos.
 *
 * v1.24 — RIG MÁS DEFINIDO Y QUE ANDA DE VERDAD: las piernas llegan AL SUELO (antes flotaban
 * 0.28 m y la figura "patinaba"), con brazos que oscilan en contrafase del paso, cabeza
 * mayor y silueta cartoon. La fábrica (makePedRig) se comparte con streetlife.ts: las
 * manifestaciones están hechas de la misma gente, con pose de CARTEL en alto (brazos
 * estirados hacia arriba agarrando el palo).
 */

export interface PedRig {
  root: TransformNode;
  legs: Mesh[];
  arms: Mesh[];
  bodyMat: StandardMaterial;
  height: number;
  /** true mientras porta algo en alto (cartel): brazos estirados hacia arriba. */
  carrying: boolean;
  phase: number;
}

/** Fábrica de figuritas cartoon (cuerpo cilíndrico, cabeza esférica, gorro opcional). */
export function createPedFactory(scene: Scene) {
  const { Color3, MeshBuilder, StandardMaterial, TransformNode, Vector3 } = B();
  const mats = new Map<string, StandardMaterial>();
  const matOf = (hex: string, shade = 1): StandardMaterial => {
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

interface Walker {
  rig: PedRig;
  pathIndex: number;
  x: number;
  z: number;
  speed: number;
  phase: number;
  /** 'walk' recorre la acera; 'enter' va hacia el portal y se desvanece; 'exit' sale de él. */
  mode: 'walk' | 'enter' | 'exit';
  /** Escala para entrar/salir por el portal (desvanecido cartoon). */
  scale: number;
}

export interface PedestriansDirector {
  update(dt: number): void;
  setVisible(visible: boolean): void;
  aliveCount(): number;
  dispose(): void;
}

export function createPedestrians(scene: Scene, world: World, content: Content): PedestriansDirector {
  const { TransformNode } = B();
  const cfg = content.rules.view.pedestrians;
  if (!cfg.enabled || cfg.paths.length === 0) {
    return { update() {}, setVisible() {}, aliveCount: () => 0, dispose() {} };
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

  const spawn = (): void => {
    const pathIndex = Math.floor(hash01('viandante_ruta', roll) * cfg.paths.length) % cfg.paths.length;
    const path = cfg.paths[pathIndex]!;
    const dir = path.dir >= 0 ? 1 : -1;
    const speed = cfg.speedMin + hash01('viandante_velo', roll) * Math.max(0.1, cfg.speedMax - cfg.speedMin);
    const bodyHex = cfg.colors[Math.floor(hash01('viandante_color', roll) * cfg.colors.length) % cfg.colors.length]!;
    const hatRoll = hash01('viandante_gorro', roll);
    const rig = factory.make(bodyHex, hatRoll < cfg.hatChance ? cfg.hatColors[Math.floor(hatRoll * 97) % cfg.hatColors.length]! : null);
    rig.root.parent = root;
    const enterRoll = hash01('viandante_portal', roll);
    let mode: Walker['mode'] = 'walk';
    let x: number;
    if (enterRoll < cfg.enterChance) {
      // Entra al edificio: camina hacia el portal por SU acera y se desvanece en la puerta.
      mode = 'enter';
      x = dir > 0 ? bounds.min : bounds.max;
    } else if (enterRoll < cfg.enterChance + cfg.exitChance) {
      // Sale del edificio: aparece en el portal y camina hasta el borde.
      mode = 'exit';
      x = cfg.enterX;
    } else {
      x = dir > 0 ? bounds.min : bounds.max;
    }
    const z = mode === 'enter' || mode === 'exit' ? cfg.paths[0]!.z : path.z;
    walkers.add({ rig, pathIndex, x, z, speed, phase: hash01('viandante_fase', roll) * 6, mode, scale: mode === 'exit' ? 0.05 : 1 });
    rig.root.setEnabled(visible);
  };

  return {
    update(dt: number) {
      nextSpawn -= dt;
      if (nextSpawn <= 0) {
        nextSpawn = cfg.spawnEveryMin + hash01('viandante_t', world.tick + roll) * (cfg.spawnEveryMax - cfg.spawnEveryMin);
        if (walkers.size < cfg.maxAlive) spawn();
      }
      for (const w of [...walkers]) {
        const path = cfg.paths[w.pathIndex]!;
        const dir = path.dir >= 0 ? 1 : -1;
        if (w.mode === 'enter') {
          // Hacia el portal (por la acera frontal); al llegar, se desvanece creciendo el fade.
          const target = cfg.enterX;
          const d = target - w.x;
          const step = Math.min(Math.abs(d), w.speed * dt) * Math.sign(d || 1);
          w.x += step;
          w.phase += dt * w.speed * 4.2;
          if (Math.abs(target - w.x) < 0.35) {
            w.scale -= dt * 2.4;
            if (w.scale <= 0.05) {
              w.rig.root.dispose(false, true);
              walkers.delete(w);
              continue;
            }
          }
        } else if (w.mode === 'exit') {
          // Sale del portal: crece y toma su ruta hasta el borde.
          w.scale = Math.min(1, w.scale + dt * 2.4);
          if (w.scale >= 1) {
            w.mode = 'walk';
            // Ruta desde el portal hacia un extremo (elige un carril de acera).
            w.pathIndex = 0;
            w.x = cfg.enterX + (hash01('viandante_salida', roll) < 0.5 ? -0.6 : 0.6);
          }
        } else {
          w.x += dir * w.speed * dt;
          w.phase += dt * w.speed * 4.2;
          if ((dir > 0 && w.x > path.x1) || (dir < 0 && w.x < path.x0)) {
            w.rig.root.dispose(false, true);
            walkers.delete(w);
            continue;
          }
        }
        w.rig.phase = w.phase;
        factory.pose(w.rig, 1);
        w.rig.root.position.x = w.x;
        w.rig.root.position.z = w.z;
        w.rig.root.scaling.setAll(w.scale);
      }
    },
    setVisible(v: boolean) {
      if (visible === v) return;
      visible = v;
      root.setEnabled(v);
    },
    aliveCount: () => walkers.size,
    dispose() {
      for (const w of walkers) w.rig.root.dispose(false, true);
      walkers.clear();
      root.dispose(false, false);
      factory.dispose();
    },
  };
}
