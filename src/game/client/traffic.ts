import type { Color3, Mesh, Scene, StandardMaterial, TransformNode } from '@babylonjs/core';
import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { B } from './babylon';
import { playSoundAt } from './audio';

/**
 * TRÁFICO (v1.22) — vehículos ocasionales por la carretera: coches, furgonetas, autobús
 * y patrulla con la sirena girando. Solo presentación: recorren los carriles del catálogo
 * (rules.view.traffic) de un extremo al otro y se desvanecen al salir; el sim jamás los
 * ve. Solo se muestran en la vista "edificio" (setVisible) y quedan congelados mientras
 * el jugador mira otra cosa (menos CPU y la calle sigue viva al volver).
 */

interface VehicleRig {
  root: TransformNode;
  bodyMat: StandardMaterial;
  wheels: Mesh[];
  siren: { red: StandardMaterial; blue: StandardMaterial; bar: TransformNode } | null;
  windows: Mesh | null;
}

interface Active {
  rig: VehicleRig;
  defIndex: number;
  laneIndex: number;
  x: number;
  speed: number;
  passed: boolean;
  phase: number;
}

export interface TrafficDirector {
  /** Avanza vehículos y sirenas. dt en segundos. */
  update(dt: number): void;
  /** Solo vista "edificio": idempotente. */
  setVisible(visible: boolean): void;
  /** Vehículos vivos (para QA/E2E). */
  aliveCount(): number;
  dispose(): void;
}

export function createTraffic(scene: Scene, world: World, content: Content): TrafficDirector {
  const { Color3, MeshBuilder, StandardMaterial, TransformNode, Vector3 } = B();
  const cfg = content.rules.view.traffic;
  if (!cfg.enabled || cfg.vehicles.length === 0 || cfg.lanes.length === 0) {
    return { update() {}, setVisible() {}, aliveCount: () => 0, dispose() {} };
  }

  const root = new TransformNode('trafico', scene);
  let visible = true;
  const mats = new Map<string, StandardMaterial>();
  const matOf = (hex: string, name: string, emissive = 0): StandardMaterial => {
    const key = `${name}:${hex}:${emissive}`;
    let m = mats.get(key);
    if (!m) {
      m = new StandardMaterial(key, scene);
      m.diffuseColor = Color3.FromHexString(hex);
      m.specularColor = new Color3(0, 0, 0);
      if (emissive > 0) m.emissiveColor = Color3.FromHexString(hex).scale(emissive);
      mats.set(key, m);
    }
    return m;
  };
  const glass = matOf('#3d4a56', 'cristal_trafico', 0.12);
  const tyre = matOf('#26221e', 'rueda');

  /** Construye UNA plantilla por tipo de vehículo (pool: se recolorean al salir). */
  const buildRig = (defIndex: number): VehicleRig => {
    const def = cfg.vehicles[defIndex]!;
    const node = new TransformNode(`trafico_${def.kind}`, scene);
    node.parent = root;
    const wheelR = Math.min(0.42, Math.max(0.26, def.height * 0.3));
    const bodyMat = new StandardMaterial(`trafico_${def.kind}_mat`, scene);
    bodyMat.diffuseColor = Color3.FromHexString(def.colors[0]!);
    bodyMat.specularColor = new Color3(0, 0, 0);
    mats.set(`rig_${def.kind}`, bodyMat);
    const cabinLen = def.length * Math.min(0.6, Math.max(0.12, def.cabin));
    const bodyLen = def.length - cabinLen * 0.35;
    // Cuerpo: morro delante (o un solo bloque en el bus/furgoneta).
    const body = MeshBuilder.CreateBox(`trafico_${def.kind}_cuerpo`, { width: bodyLen, height: def.height, depth: def.width }, scene);
    body.position.set(-(def.length - bodyLen) / 2, wheelR * 0.55 + def.height / 2, 0);
    body.material = bodyMat;
    body.parent = node;
    // Cabina: bloque superior trasero con ventanilla oscura.
    const cabin = MeshBuilder.CreateBox(`trafico_${def.kind}_cabina`, { width: cabinLen * 0.9, height: def.height * 0.55, depth: def.width * 0.92 }, scene);
    cabin.position.set(def.length / 2 - cabinLen * 0.55, wheelR * 0.55 + def.height + (def.height * 0.55) / 2 - 0.06, 0);
    cabin.material = bodyMat;
    cabin.parent = node;
    let windows: Mesh | null = null;
    if (def.length > 5) {
      // Bus: franja de ventanas a lo largo del costado.
      windows = MeshBuilder.CreateBox(`trafico_${def.kind}_ventanas`, { width: def.length * 0.82, height: def.height * 0.34, depth: def.width * 1.01 }, scene);
      windows.position.set(0, wheelR * 0.55 + def.height * 0.62, 0);
      windows.material = glass;
      windows.parent = node;
    }
    const wheels: Mesh[] = [];
    const wx = def.length * 0.32;
    for (const sx of [-wx, wx]) {
      for (const sz of [-def.width / 2, def.width / 2]) {
        const w = MeshBuilder.CreateCylinder(`trafico_${def.kind}_rueda_${sx}_${sz}`, { diameter: wheelR * 2, height: 0.22, tessellation: 10 }, scene);
        w.rotation.x = Math.PI / 2;
        w.position.set(sx, wheelR, sz * 0.86);
        w.material = tyre;
        w.parent = node;
        wheels.push(w);
      }
    }
    let siren: VehicleRig['siren'] = null;
    if (def.siren) {
      const bar = new TransformNode(`trafico_${def.kind}_barra`, scene);
      bar.position.set(def.length * 0.1, wheelR * 0.55 + def.height + def.height * 0.55 - 0.02, 0);
      bar.parent = node;
      const red = new StandardMaterial(`trafico_sirena_rojo`, scene);
      red.diffuseColor = Color3.FromHexString('#c0392b');
      red.emissiveColor = Color3.FromHexString('#c0392b').scale(0.1);
      const blue = new StandardMaterial(`trafico_sirena_azul`, scene);
      blue.diffuseColor = Color3.FromHexString('#286090');
      blue.emissiveColor = Color3.FromHexString('#286090').scale(0.1);
      mats.set('sirena_rojo', red);
      mats.set('sirena_azul', blue);
      const a = MeshBuilder.CreateBox('sirena_a', { width: 0.34, height: 0.12, depth: def.width * 0.4 }, scene);
      a.position.z = -def.width * 0.22;
      a.material = red;
      a.parent = bar;
      const b = MeshBuilder.CreateBox('sirena_b', { width: 0.34, height: 0.12, depth: def.width * 0.4 }, scene);
      b.position.z = def.width * 0.22;
      b.material = blue;
      b.parent = bar;
      siren = { red, blue, bar };
    }
    node.setEnabled(false);
    return { root: node, bodyMat, wheels, siren, windows };
  };

  const rigs = cfg.vehicles.map((_, i) => buildRig(i));
  const active = new Set<Active>();
  let nextSpawn = 1.5;
  let roll = 0;
  const pick = (): number => {
    // Ruleta ponderada determinista por hash (mismo lenguaje que el resto de la calle).
    let acc = 0;
    const total = cfg.vehicles.reduce((s, v) => s + v.chance, 0);
    const r = hash01('trafico_ruleta', roll++) * total;
    for (let i = 0; i < cfg.vehicles.length; i++) {
      acc += cfg.vehicles[i]!.chance;
      if (r <= acc) return i;
    }
    return 0;
  };

  const spawn = (): void => {
    const defIndex = pick();
    const def = cfg.vehicles[defIndex]!;
    // Un rig por tipo: si ya está en la calle, este tipo no sale esta vez (pool honesto).
    if ([...active].some((a) => a.defIndex === defIndex)) return;
    const rig = rigs[defIndex]!;
    const laneIndex = Math.floor(hash01('trafico_carril', roll) * cfg.lanes.length) % cfg.lanes.length;
    const lane = cfg.lanes[laneIndex]!;
    const dir = lane.dir >= 0 ? 1 : -1;
    const speed = lane.speedMin + hash01('trafico_velo', roll) * Math.max(0.1, lane.speedMax - lane.speedMin);
    const x = dir > 0 ? cfg.xMin - def.length : cfg.xMax + def.length;
    const hex = def.colors[Math.floor(hash01('trafico_color', roll) * def.colors.length) % def.colors.length]!;
    rig.bodyMat.diffuseColor = Color3.FromHexString(hex);
    rig.root.rotation.y = dir > 0 ? 0 : Math.PI;
    rig.root.setEnabled(visible);
    rig.root.position = new Vector3(x, 0, lane.z);
    active.add({ rig, defIndex, laneIndex, x, speed, passed: false, phase: hash01('trafico_fase', roll) * 6 });
  };

  return {
    update(dt: number) {
      nextSpawn -= dt;
      if (nextSpawn <= 0) {
        nextSpawn = cfg.spawnEveryMin + hash01('trafico_t', world.tick + roll) * (cfg.spawnEveryMax - cfg.spawnEveryMin);
        if (active.size < cfg.maxAlive) spawn();
      }
      for (const a of [...active]) {
        const def = cfg.vehicles[a.defIndex]!;
        // Movimiento real: la dirección del carril manda.
        const dir = cfg.lanes[a.laneIndex]!.dir >= 0 ? 1 : -1;
        a.rig.root.position.x += dir * a.speed * dt;
        a.x = a.rig.root.position.x;
        // Balanceo cartoon sutil.
        a.phase += dt * a.speed * 2.4;
        a.rig.root.position.y = Math.sin(a.phase) * 0.015;
        // Sirena: rojo/azul alternando (siempre que la patrulla circula).
        if (a.rig.siren) {
          const on = Math.floor(a.phase * 2.2) % 2 === 0;
          a.rig.siren.red.emissiveColor = Color3.FromHexString('#c0392b').scale(on ? 1 : 0.1);
          a.rig.siren.blue.emissiveColor = Color3.FromHexString('#286090').scale(on ? 0.1 : 1);
        }
        // Sonido de paso frente al portal (una vez por vehículo).
        if (!a.passed && Math.abs(a.x - cfg.passX) < 4) {
          a.passed = true;
          playSoundAt('calle_vehiculo', Math.max(0.25, 1 - Math.abs(a.x - cfg.passX) / cfg.passRadius));
        }
        if ((dir > 0 && a.x > cfg.xMax + def.length + 2) || (dir < 0 && a.x < cfg.xMin - def.length - 2)) {
          a.rig.root.setEnabled(false);
          active.delete(a);
        }
      }
    },
    setVisible(v: boolean) {
      if (visible === v) return;
      visible = v;
      root.setEnabled(v);
    },
    aliveCount: () => active.size,
    dispose() {
      for (const a of active) a.rig.root.dispose(false, true);
      active.clear();
      for (const r of rigs) r.root.dispose(false, true);
      root.dispose(false, false);
      for (const m of mats.values()) m.dispose();
      mats.clear();
    },
  };
}
