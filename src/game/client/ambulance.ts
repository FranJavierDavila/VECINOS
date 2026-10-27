import type { Scene, StandardMaterial, TransformNode } from '@babylonjs/core';
import type { Content } from '@/game/core/types';
import { B } from './babylon';
import { playSoundAt } from './audio';
import { createPedFactory, type PedRig } from './pedestrians';
import type { AmbulanceRig, TrafficDirector } from './traffic';

/**
 * TEATRO DE EMERGENCIAS (v1.32) — el vecino: «si alguno sale herido vendrá la ambulancia
 * y tendrán que recoger al herido y llevarlo a la ambulancia».
 *
 * La CHOREOGRAPHY completa, data-driven (rules.view.traffic.ambulance + pedestrians.social):
 *  1. Llegada — el furgón (rig del catálogo: librea, cruz, girofarios, ruedas en arcos
 *     recortados) entra por la carretera con la SIRENA del catálogo y se detiene frente
 *     al herido, girando los giros.
 *  2. Descenso — las puertas traseras se abren y DOS CELADORES bajan (uniformes del
 *     catálogo) y caminan hasta el herido.
 *  3. Recogida — breve reconocimiento, el herido se eleva ENTRE los dos (tumbado, clip
 *     'hurt') y caminan los tres hacia la parte trasera del furgón.
 *  4. Traslado — herido y celadores suben a la caja, puertas cerradas, sirena y fuera.
 *
 * Solo presentación: el sim jamás lee nada de esto. Un solo teatro a la vez (busy()).
 */

/** Herido que el teatro puede recoger: nodo posable del rig (glTF con clips) + alto. */
export interface InjuredRig {
  node: TransformNode;
  /** Reproduce el clip lógico del rig ('hurt'…) — null para soltar. */
  play(clip: string | null, rate?: number): void;
  height: number;
}

type Phase = 'idle' | 'driveIn' | 'doors' | 'walkOut' | 'kneel' | 'carry' | 'board' | 'driveOut';

export interface AmbulanceTheater {
  /** Pide una recogida para un herido tumbado en (x, z). false si el teatro está ocupado. */
  requestPickup(injured: InjuredRig, x: number, z: number): boolean;
  update(dt: number): void;
  busy(): boolean;
  /** Solo vistas con calle: el furgón entero se apaga fuera de edificio/planta. */
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createAmbulanceTheater(scene: Scene, content: Content, traffic: TrafficDirector | null): AmbulanceTheater {
  const { Color3, Vector3 } = B();
  const cfg = content.rules.view.traffic.ambulance;
  const soc = content.rules.view.pedestrians.social;
  if (!cfg || !soc?.enabled || !traffic) {
    return { requestPickup: () => false, update() {}, busy: () => false, setVisible() {}, dispose() {} };
  }
  const rig = traffic.buildAmbulance();
  if (!rig) return { requestPickup: () => false, update() {}, busy: () => false, setVisible() {}, dispose() {} };

  const factory = createPedFactory(scene);
  const medics: PedRig[] = [];
  const medicMat = (hex: string): StandardMaterial => {
    const m = new (B().StandardMaterial)(`celador_${hex}`, scene);
    m.diffuseColor = Color3.FromHexString(hex);
    m.specularColor = new Color3(0, 0, 0);
    return m;
  };
  for (let i = 0; i < 2; i++) {
    const ped = factory.make(cfg.medicColor, i === 0 ? cfg.medicCapColor : null, 1.32);
    // Uniforme: repintar torso y cabeza (las piernas quedan en el tono del pantalón).
    ped.bodyMat.dispose();
    ped.bodyMat = medicMat(cfg.medicColor);
    ped.legs.forEach((l) => (l.material = medicMat(cfg.medicLegColor)));
    ped.root.setEnabled(false);
    medics.push(ped);
  }

  const laneZ = cfg.stopZ;
  const state = {
    phase: 'idle' as Phase,
    visible: true,
    t: 0,
    flash: 0,
    doors: 0,
    injured: null as InjuredRig | null,
    spot: { x: 0, z: 0 },
    /** Punto de parada: el morro del furgón queda en spot.x + stopAhead. */
    vanX: 0,
  };

  /** Puesto de cada celador junto al herido (los dos flanquean la camilla). */
  const medicTarget = (i: number, lying: { x: number; z: number }): { x: number; z: number; yaw: number } => {
    const side = i === 0 ? 1 : -1;
    return { x: lying.x + side * 0.45, z: lying.z, yaw: side > 0 ? Math.PI : 0 };
  };

  const stepToward = (ped: PedRig, tx: number, tz: number, speed: number, dt: number): boolean => {
    const dx = tx - ped.root.position.x;
    const dz = tz - ped.root.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.06) {
      ped.phase += dt * 1.5;
      factory.pose(ped, 0);
      return true;
    }
    const step = Math.min(d, speed * dt);
    ped.root.position.x += (dx / d) * step;
    ped.root.position.z += (dz / d) * step;
    ped.phase += dt * speed * 4.2;
    factory.pose(ped, 1);
    ped.root.rotation.y = (dx - dz > 0 ? 0 : Math.PI);
    return d - step < 0.06;
  };

  return {
    requestPickup(injured: InjuredRig, x: number, z: number): boolean {
      if (state.phase !== 'idle' || state.injured) return false;
      state.injured = injured;
      state.spot = { x, z };
      state.phase = 'driveIn';
      state.t = 0;
      state.doors = 0;
      // El furgón entra desde el lado del catálogo (según el carril) y frena frente al herido.
      state.vanX = cfg.enterFrom === 'left' ? x - cfg.stopAhead - 60 : x + cfg.stopAhead + 60;
      rig.root.position.set(state.vanX, 0, laneZ);
      rig.root.rotation.y = cfg.enterFrom === 'left' ? 0 : Math.PI;
      rig.setDoors(0);
      rig.root.setEnabled(state.visible);
      for (const m of medics) m.root.setEnabled(false);
      playSoundAt('sirena_ambulancia', 0.9);
      return true;
    },
    update(dt: number) {
      if (state.phase === 'idle') return;
      state.flash += dt;
      rig.flash(state.flash);
      // Ruedas girando mientras el furgón se mueve.
      const moving = state.phase === 'driveIn' || state.phase === 'driveOut';
      const speed = cfg.speed;
      if (moving) {
        const dirSign = cfg.enterFrom === 'left' ? 1 : -1;
        for (const w of rig.wheels) w.hub.rotation.z -= (speed * dt) / w.r * dirSign;
      }
      switch (state.phase) {
        case 'driveIn': {
          const targetX = state.spot.x + (cfg.enterFrom === 'left' ? -cfg.stopAhead : cfg.stopAhead);
          const dx = targetX - state.vanX;
          const step = Math.min(Math.abs(dx), speed * dt) * Math.sign(dx || 1);
          state.vanX += step;
          rig.root.position.x = state.vanX;
          if (Math.abs(dx) < 0.15) {
            state.phase = 'doors';
            state.t = 0;
            playSoundAt('sirena_ambulancia', 0.55);
          }
          break;
        }
        case 'doors': {
          state.t += dt;
          state.doors = Math.min(1, state.doors + dt / Math.max(0.2, cfg.doorSeconds));
          rig.setDoors(state.doors);
          if (state.doors >= 1 && state.t > 0.6) {
            // Los celadores salen por la puerta trasera.
            const rearX = state.vanX - (cfg.enterFrom === 'left' ? rig.length / 2 : -rig.length / 2);
            medics.forEach((m, i) => {
              m.root.setEnabled(true);
              m.root.position.set(rearX + (i === 0 ? 0.25 : -0.25), 0, laneZ + (i === 0 ? 0.5 : -0.5));
              m.root.rotation.y = cfg.enterFrom === 'left' ? Math.PI : 0;
            });
            state.phase = 'walkOut';
            state.t = 0;
          }
          break;
        }
        case 'walkOut': {
          let done = 0;
          medics.forEach((m, i) => {
            const tgt = medicTarget(i, state.spot);
            if (stepToward(m, tgt.x, tgt.z, cfg.medicSpeed, dt)) done++;
          });
          if (done === medics.length) {
            state.phase = 'kneel';
            state.t = 0;
          }
          break;
        }
        case 'kneel': {
          state.t += dt;
          // Reconocimiento: los celadores se agachan un pelo (bob del cuerpo).
          medics.forEach((m) => {
            factory.pose(m, 0);
            m.root.position.y = Math.abs(Math.sin(state.t * 2.2)) * 0.06;
          });
          if (state.t > 1.1) {
            state.phase = 'carry';
            state.t = 0;
            // El herido sube a la camilla entre los dos: tumbado a la altura del traslado.
            const injured = state.injured!;
            injured.play('hurt', 0.9);
            playSoundAt('door_open', 0.4);
          }
          break;
        }
        case 'carry': {
          const dirSign = cfg.enterFrom === 'left' ? -1 : 1; // hacia la puerta trasera
          const rearX = state.vanX - (cfg.enterFrom === 'left' ? rig.length / 2 + 0.55 : -(rig.length / 2 + 0.55));
          const injured = state.injured!;
          const carryX = injured.node.position.x + dirSign * cfg.medicSpeed * dt;
          const reached = dirSign > 0 ? carryX >= rearX : carryX <= rearX;
          const cx = reached ? rearX : carryX;
          // Herido entre los dos celadores, a la altura de la camilla.
          injured.node.position.x = cx;
          injured.node.position.z = laneZ;
          injured.node.position.y = cfg.carryHeight;
          medics.forEach((m, i) => {
            const side = i === 0 ? 1 : -1;
            stepToward(m, cx + side * 0.42, laneZ, cfg.medicSpeed, dt);
          });
          if (reached) {
            state.phase = 'board';
            state.t = 0;
          }
          break;
        }
        case 'board': {
          state.t += dt;
          const injured = state.injured!;
          // Todos se meten en la caja: el herido se desliza a la puerta y se apaga.
          const inX = state.vanX - (cfg.enterFrom === 'left' ? rig.length * 0.3 : -rig.length * 0.3);
          injured.node.position.x += Math.sign(inX - injured.node.position.x) * Math.min(Math.abs(inX - injured.node.position.x), dt * 1.6);
          const k = Math.max(0, 1 - state.t / 1.1);
          injured.node.scaling.setAll(Math.max(0.02, k));
          medics.forEach((m, i) => {
            const side = i === 0 ? 1 : -1;
            stepToward(m, injured.node.position.x + side * 0.4, laneZ, cfg.medicSpeed, dt);
            m.root.scaling.setAll(Math.max(0.02, k));
          });
          if (state.t > 1.2) {
            injured.node.setEnabled(false);
            injured.play(null);
            state.injured = null;
            medics.forEach((m) => m.root.setEnabled(false));
            state.phase = 'driveOut';
            state.t = 0;
            playSoundAt('sirena_ambulancia', 0.8);
          }
          break;
        }
        case 'driveOut': {
          state.doors = Math.max(0, state.doors - dt / Math.max(0.2, cfg.doorSeconds));
          rig.setDoors(state.doors);
          const dirSign = cfg.enterFrom === 'left' ? 1 : -1;
          state.vanX += dirSign * speed * dt;
          rig.root.position.x = state.vanX;
          for (const w of rig.wheels) w.hub.rotation.z -= (speed * dt) / w.r * dirSign;
          if (Math.abs(state.vanX) > 130) {
            rig.root.setEnabled(false);
            state.phase = 'idle';
          }
          break;
        }
      }
    },
    busy: () => state.phase !== 'idle',
    setVisible(visible: boolean) {
      state.visible = visible;
      if (state.phase === 'idle') rig.root.setEnabled(false);
      else rig.root.setEnabled(visible);
      if (!visible) medics.forEach((m) => m.root.setEnabled(false));
    },
    dispose() {
      rig.dispose();
      for (const m of medics) m.root.dispose(false, true);
      factory.dispose();
    },
  };
}
