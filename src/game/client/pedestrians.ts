import type { DynamicTexture as BDynamicTexture, Mesh, Scene, StandardMaterial as BStandardMaterial, TransformNode } from '@babylonjs/core';
import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { B } from './babylon';
import { instantiateActorAsset, type ActorRig } from './assets';
import { MODEL_YAW_OFFSET } from './actors';
import { playSoundAt } from './audio';
import type { AmbulanceTheater } from './ambulance';

/**
 * VIANDANTES (v1.22→v1.32 «el vecindario respira») — paseantes anónimos por las aceras:
 * caminan, algunos ENTRAN al edificio (se desvanecen en el portal) y otros SALEN de él.
 * v1.32 — VIDA SOCIAL DE ACERA: dos viandantes que se cruzan PUEDEN parar (catálogo
 * pedestrians.social): CHARLA (clip talk + 💬), DISCUSIÓN (argue + ❗) o PELEA (clips
 * fight nuevos + 💥 con sonido de golpe). Si alguien sale HERIDO se queda en el suelo
 * (clip hurt) y el TEATRO DE LA AMBULANCIA (ambulance.ts) viene a recogerlo: celadores,
 * camilla entre los dos y traslado. Si el teatro está ocupado, el herido se recupera
 * solo (se levanta) y sigue su camino.
 *
 * Solo presentación (el sim no sabe de ellos) y solo visibles en la vista "edificio".
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
  id: number;
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
  /** v1.32 — encuentro social en curso (los dos viandantes se referencian mutuamente). */
  social: Social | null;
}

/** v1.32 — Estado del encuentro social de acera (fases del catálogo pedestrians.social). */
interface Social {
  other: Walker;
  kind: 'talk' | 'argue' | 'fight';
  phase: 'meet' | 'exchange' | 'after' | 'hurt' | 'carried';
  t: number;
  idx: number;
  /** Golpes dados en la pelea (para la tirada de herido al acabar). */
  rounds: number;
  injured: boolean;
  hurtLeft: number;
}

export interface PedestriansDirector {
  update(dt: number): void;
  setVisible(visible: boolean): void;
  aliveCount(): number;
  /** v1.30 — posiciones vivas de los viandantes (entrando/saliendo incluidos): el portal
   *  abre sus puertas correderas también para ellos y el controlador los manda en `movers`. */
  positions(): { x: number; z: number }[];
  /** v1.32 — encuentros sociales en curso (QA/E2E). */
  socialCount(): number;
  /** v1.32 — fuerza un encuentro social YA entre los dos viandantes más cercanos (QA/E2E). */
  forceEncounter(kind?: 'talk' | 'argue' | 'fight'): boolean;
  dispose(): void;
}

export function createPedestrians(scene: Scene, world: World, content: Content, ambulance?: AmbulanceTheater | null): PedestriansDirector {
  const { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3 } = B();
  const cfg = content.rules.view.pedestrians;
  if (!cfg.enabled || cfg.paths.length === 0) {
    return { update() {}, setVisible() {}, aliveCount: () => 0, positions: () => [], socialCount: () => 0, forceEncounter: () => false, dispose() {} };
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
  let walkerSeq = 0;

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
                // v1.32 — nombre con el viandante: las sombras data-driven (patrón
                // 'viandante') lo reconocen como caster sin tocar el catálogo.
                for (const m of rig.root.getChildMeshes(false)) m.name = `viandante_${i}_${m.name}`;
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
    const w: Walker = { id: walkerSeq++, gltf: slot.gltf, prim: slot.prim, pathIndex, x, z, speed, phase: hash01('viandante_fase', roll) * 6, mode, scale: mode === 'exit' ? 0.05 : 1, yaw: dir > 0 ? 0 : Math.PI, social: null };
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

  // ── v1.32 — VIDA SOCIAL DE ACERA ────────────────────────────────────────────
  const soc = cfg.social;
  const emojiTex = new Map<string, { tex: BDynamicTexture; mat: BStandardMaterial; meshes: { m: Mesh; t: number }[] }>();
  /** Bocadillo flotante cartoon (plane billboard con emoji/letra del catálogo visual). */
  const emote = (w: Walker, label: string, seconds = 1.1): void => {
    let entry = emojiTex.get(label);
    if (!entry) {
      const tex = new DynamicTexture(`viandante_emote_${emojiTex.size}`, { width: 96, height: 96 }, scene, false);
      tex.hasAlpha = true;
      const c = tex.getContext() as unknown as CanvasRenderingContext2D;
      c.clearRect(0, 0, 96, 96);
      c.fillStyle = 'rgba(255,252,240,0.94)';
      c.beginPath();
      c.arc(48, 48, 42, 0, Math.PI * 2);
      c.fill();
      c.font = '52px "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(label, 48, 52);
      tex.update(true);
      const mat = new StandardMaterial(`viandante_emote_mat_${emojiTex.size}`, scene);
      mat.diffuseTexture = tex;
      mat.emissiveColor = new Color3(1, 1, 1);
      mat.useAlphaFromDiffuseTexture = true;
      mat.disableLighting = true;
      mat.specularColor = new Color3(0, 0, 0);
      entry = { tex, mat, meshes: [] };
      emojiTex.set(label, entry);
    }
    const m = MeshBuilder.CreatePlane(`viandante_emote_${emojiTex.size}_${entry.meshes.length}`, { width: 0.5, height: 0.5 }, scene);
    m.material = entry.mat;
    m.billboardMode = Mesh.BILLBOARDMODE_ALL;
    m.isPickable = false;
    const node = w.gltf ? w.gltf.root : w.prim!.root;
    m.position.set(node.position.x, node.position.y + (w.gltf ? 1.75 : 1.62), node.position.z);
    m.scaling.setAll(w.scale);
    entry.meshes.push({ m, t: seconds });
  };

  const pairUntilSoc = new Map<string, number>();
  const pairKey = (a: Walker, b: Walker): string => `${Math.min(a.id, b.id)}|${Math.max(a.id, b.id)}`;

  const playSocial = (w: Walker, clip: string, rate = 1): void => {
    if (w.gltf) w.gltf.play(clip, rate);
  };

  const faceEachOther = (a: Walker, b: Walker): void => {
    const set = (w: Walker, tx: number, tz: number): void => {
      const yaw = Math.atan2(-(tz - w.z), tx - w.x);
      w.yaw = yaw;
      (w.gltf ? w.gltf.root : w.prim!.root).rotation.y = yaw + MODEL_YAW_OFFSET;
    };
    set(a, b.x, b.z);
    set(b, a.x, a.z);
  };

  /** Encuentro entre dos viandantes (kind forzado solo para QA/E2E). */
  const startEncounter = (a: Walker, b: Walker, forced?: 'talk' | 'argue' | 'fight'): void => {
    if (!soc?.enabled || a.social || b.social) return;
    const now = performance.now() / 1000;
    pairUntilSoc.set(pairKey(a, b), now + soc.pairCooldown);
    let kind: Social['kind'] = forced ?? 'talk';
    if (!forced) {
      const roll = hash01('viandante_social', world.tick + a.phase + b.phase);
      kind = roll < soc.fightChance ? 'fight' : roll < soc.fightChance + soc.argueChance ? 'argue' : 'talk';
    }
    const sA: Social = { other: b, kind, phase: 'meet', t: 0.45, idx: 0, rounds: 0, injured: false, hurtLeft: 0 };
    const sB: Social = { other: a, kind, phase: 'meet', t: 0.45, idx: 0, rounds: 0, injured: false, hurtLeft: 0 };
    a.social = sA;
    b.social = sB;
    faceEachOther(a, b);
    emote(a, kind === 'talk' ? '\u{1F4AC}' : kind === 'argue' ? '\u2757' : '\u{1F4A2}');
    emote(b, kind === 'talk' ? '\u{1F4AC}' : kind === 'argue' ? '\u{1F4A2}' : '\u26A0\uFE0F');
    playSocial(a, 'idle');
    playSocial(b, 'idle');
  };

  const endEncounter = (w: Walker): void => {
    const s = w.social;
    w.social = null;
    if (s && s.other.social && s.other.social.other === w) {
      // El otro solo queda libre si NO es un herido esperando su turno (hurt/carried).
      const op = s.other.social.phase;
      if (op !== 'hurt' && op !== 'carried') s.other.social = null;
    }
    playSocial(w, 'walk', walkRate(w.speed));
  };

  /** Actualiza un lado del encuentro; devuelve true si el walker sigue ocupado. */
  const updateSocial = (w: Walker, dt: number): boolean => {
    const s = w.social;
    if (!s) return false;
    const other = s.other;
    const node = w.gltf ? w.gltf.root : w.prim!.root;
    switch (s.phase) {
      case 'meet': {
        s.t -= dt;
        if (s.t <= 0) {
          s.phase = 'exchange';
          s.idx = 0;
          s.t = s.kind === 'fight' ? 0.9 : soc!.talkSeconds;
          playSocial(w, s.kind === 'talk' ? 'talk' : s.kind === 'argue' ? 'argue' : 'fight');
        }
        return true;
      }
      case 'exchange': {
        s.t -= dt;
        if (s.t <= 0) {
          if (s.kind === 'fight' && s.rounds < 5) {
            s.rounds += 1;
            s.idx = s.rounds;
            s.t = 0.9;
            playSocial(w, 'fight');
            if (s.idx % 2 === 1) {
              emote(w, '\u{1F4A5}');
              playSoundAt('golpe_pelea', 0.5);
            }
            return true;
          }
          // Fin del intercambio → tirada de herido (solo la decide el lado 'a' de la pareja).
          s.phase = 'after';
          s.t = 1.0;
          if (s.kind === 'fight' && s.idx === s.rounds && s.rounds >= 3 && other.social && other.social.other === w && !other.social.injured && !s.injured) {
            // un solo lado tira: el de clave menor (determinista)
            if (w.gltf && (w.gltf.root.name < (other.gltf?.root.name ?? ''))) {
              const injured = hash01('viandante_herido', world.tick + w.phase) < soc!.injuredChance;
              if (injured) {
                s.injured = true;
                other.social.injured = true;
              }
            }
          }
        }
        return true;
      }
      case 'after': {
        s.t -= dt;
        if (s.t <= 0) {
          if (s.injured && w.gltf) {
            // HERIDO: al suelo (clip hurt) y llamada de la ambulancia (teatro).
            s.phase = 'hurt';
            s.hurtLeft = soc!.hurtSeconds;
            playSocial(w, 'hurt');
            emote(w, '\u2691');
            const pickedUp = ambulance?.requestPickup({ node: w.gltf.root, play: (c, r) => w.gltf!.play(c, r), height: 1.35 }, node.position.x, node.position.z);
            if (pickedUp) {
              s.phase = 'carried';
            }
            return true;
          }
          if (s.injured && !w.gltf) s.injured = false; // primitivos sin clip: se levantan
          if (s.injured && other.social && other.social.phase === 'carried') return true; // espera su turno
          endEncounter(w);
          return false;
        }
        return true;
      }
      case 'hurt': {
        s.hurtLeft -= dt;
        if (s.hurtLeft <= 0) {
          playSocial(w, 'walk', walkRate(w.speed));
          endEncounter(w);
          return false;
        }
        return true;
      }
      case 'carried': {
        // El teatro mueve el nodo; cuando termina (teatro libre otra vez), el paseo acaba.
        if (!ambulance?.busy()) {
          recycle(w);
          walkers.delete(w);
        }
        return true;
      }
    }
  };

  /** Empareja los dos viandantes más cercanos en modo 'walk' (o fuerza el encuentro). */
  const tryEncounter = (forced?: 'talk' | 'argue' | 'fight'): boolean => {
    if (!soc?.enabled) return false;
    let count = 0;
    for (const w of walkers) if (w.social) count++;
    if (count >= soc.maxConcurrent * 2) return false;
    const candidates = [...walkers].filter((w) => !w.social && w.mode === 'walk' && w.gltf !== null);
    if (candidates.length < 2) return false;
    let best: [Walker, Walker] | null = null;
    let bestD = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i]!;
        const b = candidates[j]!;
        if ((pairUntilSoc.get(pairKey(a, b)) ?? 0) > performance.now() / 1000) continue;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < bestD) {
          bestD = d;
          best = [a, b];
        }
      }
    }
    if (!best || bestD > (forced ? 30 : soc.distance)) return false;
    startEncounter(best[0]!, best[1]!, forced);
    return true;
  };

  let socialAcc = 0;
  return {
    update(dt: number) {
      nextSpawn -= dt;
      if (nextSpawn <= 0 && poolReady) {
        nextSpawn = cfg.spawnEveryMin + hash01('viandante_t', world.tick + roll) * (cfg.spawnEveryMax - cfg.spawnEveryMin);
        if (walkers.size < cfg.maxAlive) spawn();
      }
      // v1.32 — detección de cruces sociales a cadencia (solo viandantes glTF con clips).
      if (soc?.enabled) {
        socialAcc -= dt;
        if (socialAcc <= 0) {
          socialAcc = soc.checkEvery;
          tryEncounter();
        }
      }
      // Bocadillos flotantes: envejecer y apagar.
      for (const entry of emojiTex.values()) {
        for (const it of [...entry.meshes]) {
          it.t -= dt;
          if (it.t <= 0) {
            it.m.dispose();
            entry.meshes.splice(entry.meshes.indexOf(it), 1);
          } else if (it.t < 0.35) {
            (it.m.material as BStandardMaterial).alpha = it.t / 0.35;
          }
        }
      }
      for (const w of [...walkers]) {
        // v1.32 — los viandantes en encuentro social no pasean: su estado lo gobierna
        // updateSocial (charla, discusión, pelea, herido, traslado en ambulancia).
        if (w.social) {
          updateSocial(w, dt);
          continue;
        }
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
    socialCount: () => [...walkers].filter((w) => w.social).length,
    forceEncounter: (kind?: 'talk' | 'argue' | 'fight') => tryEncounter(kind),
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
