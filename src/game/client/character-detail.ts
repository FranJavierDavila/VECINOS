import type { Mesh, Scene, TransformNode } from '@babylonjs/core';
import type { CharacterDetailSpec } from '@/game/core/types';
import { B } from './babylon';

/**
 * PERSONAJES DETALLADOS (v1.43) — LOD cercano de los vecinos.
 *
 * Lejos, el vecino es su rig glTF de siempre (barato, probado). Cuando la cámara
 * se acerca, el rig se OCULTA y este módulo reconstruye al personaje con piezas
 * legibles: cabeza con peinado/gafas/nariz/orejas/ojos, torso con solapas/corbata/
 * cinturón, extremidades con pivotes y accesorio de mano. La silueta se reconoce
 * de FRENTE (corbata, solapas, gafas, ojos), de PERFIL (nariz, patillas, varillas
 * de las gafas, orejas) y de ESPALDAS (parches de pelo, casquete, chaqueta lisa).
 *
 * Convención de autoría = la de los rigs (actors.ts): el personaje MIRA A +X,
 * pies en y=0 y el swing de extremidades rota sobre el eje Z (plano X-Y).
 * CERO textos (la apariencia es 100% JSON: public/content/character-details.json)
 * y CERO superficies coplanares: cada pieza superpuesta lleva su empuje explícito.
 */

/** Estado por frame que la presentación le pasa al personaje detallado. */
export interface DetailFrameState {
  speedH: number;
  gesture: string | null;
  seated: boolean;
  /** Fundido del actor (0..1) — el mismo del teatro del portal. */
  fade: number;
  /** ¿El actor está en escena (nodo habilitado)? */
  enabled: boolean;
}

export interface CharacterDetailRig {
  root: TransformNode;
  setEnabled(v: boolean): void;
  setFade(v: number): void;
  /** Animación procedural: marcha, reposo, sentado y gestos sociales. */
  sync(dt: number, state: DetailFrameState): void;
  dispose(): void;
}

export function buildCharacterDetail(scene: Scene, id: string, spec: CharacterDetailSpec, height: number): CharacterDetailRig | null {
  const { Color3, MeshBuilder, StandardMaterial, TransformNode, Vector3 } = B();
  if (!spec || height <= 0) return null;
  const H = spec.height && spec.height > 0 ? spec.height : height;

  const mats = new Map<string, StandardMaterial>();
  const matOf = (hex: string, name: string): StandardMaterial => {
    const key = `${name}:${hex}`;
    let m = mats.get(key);
    if (!m) {
      m = new StandardMaterial(`${id}_det_${key}_mat`, scene);
      m.diffuseColor = Color3.FromHexString(hex);
      m.specularColor = new Color3(0.04, 0.04, 0.04);
      mats.set(key, m);
    }
    return m;
  };
  const meshes: Mesh[] = [];

  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, m: StandardMaterial, parent: TransformNode): Mesh => {
    const mesh = MeshBuilder.CreateBox(`${id}_det_${name}`, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    mesh.isPickable = false;
    mesh.parent = parent;
    meshes.push(mesh);
    return mesh;
  };
  const ball = (name: string, d: number, x: number, y: number, z: number, m: StandardMaterial, parent: TransformNode): Mesh => {
    const mesh = MeshBuilder.CreateSphere(`${id}_det_${name}`, { diameter: d, segments: 7 }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    mesh.isPickable = false;
    mesh.parent = parent;
    meshes.push(mesh);
    return mesh;
  };
  const cyl = (name: string, dTop: number, dBot: number, h: number, x: number, y: number, z: number, m: StandardMaterial, parent: TransformNode): Mesh => {
    const mesh = MeshBuilder.CreateCylinder(`${id}_det_${name}`, { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: 10 }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    mesh.isPickable = false;
    mesh.parent = parent;
    meshes.push(mesh);
    return mesh;
  };

  // ── Proporciones base (fracciones de H) — posiciones ABSOLUTAS desde los pies. ──
  const hipY = 0.47 * H;
  const legLen = 0.42 * H;
  const torsoH = 0.32 * H;
  const torsoCY = hipY + torsoH / 2 - 0.015 * H; // el torso tapa el arranque de las piernas
  const torsoW = 0.34 * H;
  const torsoD = 0.2 * H;
  const shoulderY = hipY + torsoH - 0.055 * H;
  const neckY = hipY + torsoH + 0.02 * H;
  const headPivotY = neckY + 0.02 * H;
  const headCY = headPivotY + 0.075 * H;
  const headD = 0.235 * H;

  const skinM = matOf(spec.skin, 'piel');
  const hairM = matOf(spec.hairColor, 'pelo');
  const topM = matOf(spec.top, 'torso');
  const bottomM = matOf(spec.bottom, 'pierna');
  const shoeM = matOf(spec.shoes, 'zapato');
  const darkM = matOf('#2e2a26', 'oscuro');
  const whiteM = matOf('#f5f2ea', 'blanco');

  const root = new TransformNode(`${id}_det_root`, scene);

  // ── CADERAS: origen en los PIES (los hijos usan coordenadas absolutas); el bob y la
  //  caída al sentarse mueven este nodo. Las piernas cuelgan de la RAÍZ para que los
  //  pies sigan anclados al suelo mientras el cuerpo rebota. ──
  const hips = new TransformNode(`${id}_det_cuerpo`, scene);
  hips.parent = root;

  // ── TORSO ──
  box('torso', torsoW, torsoH, torsoD, 0, torsoCY, 0, topM, hips);
  // Hombros redondeados (la caja sola lee «robot» de perfil).
  ball('hombro_a', 0.115 * H, 0, shoulderY + 0.012 * H, torsoW / 2 - 0.02 * H, topM, hips);
  ball('hombro_b', 0.115 * H, 0, shoulderY + 0.012 * H, -(torsoW / 2 - 0.02 * H), topM, hips);

  // ── TRAJE (solapas + camisa + corbata): la lectura de «señor serio» del Presidente. ──
  if (spec.suit) {
    const lapelM = matOf(spec.suit.lapel, 'solapa');
    const shirtM = matOf(spec.suit.shirt, 'camisa');
    const tieM = matOf(spec.suit.tie, 'corbata');
    const faceX = torsoD / 2;
    // Camisa en V bajo el cuello (empuje +4 mm sobre el pecho).
    box('camisa', 0.085 * H, 0.17 * H, 0.014 * H, faceX + 0.004, torsoCY + 0.085 * H, 0, shirtM, hips);
    // Corbata: nudo + pica, SIEMPRE por delante de la camisa (+4 mm más).
    box('corbata_nudo', 0.016 * H, 0.032 * H, 0.034 * H, faceX + 0.008, torsoCY + 0.128 * H, 0, tieM, hips);
    box('corbata', 0.014 * H, 0.15 * H, 0.048 * H, faceX + 0.008, torsoCY + 0.035 * H, 0, tieM, hips);
    // Solapas: cajas inclinadas hacia la corbata (rotación en el plano Y-Z).
    const lpz = 0.058 * H;
    const lapelA = box('solapa_a', 0.012 * H, 0.15 * H, 0.05 * H, faceX + 0.006, torsoCY + 0.09 * H, lpz, lapelM, hips);
    lapelA.rotation.x = -0.3;
    const lapelB = box('solapa_b', 0.012 * H, 0.15 * H, 0.05 * H, faceX + 0.006, torsoCY + 0.09 * H, -lpz, lapelM, hips);
    lapelB.rotation.x = 0.3;
  }

  // ── CINTURÓN (anillo completo: se lee de frente, de perfil y de espaldas). ──
  if (spec.belt) {
    const strapM = matOf(spec.belt.strap, 'cinturon');
    box('cinturon', 0.208 * H, 0.045 * H, torsoW + 0.01 * H, 0, hipY - 0.005 * H, 0, strapM, hips);
    const buckleM = matOf(spec.belt.buckle, 'hebilla');
    box('hebilla', 0.014 * H, 0.034 * H, 0.05 * H, 0.208 * H / 2 + 0.003, hipY - 0.005 * H, 0, buckleM, hips);
  }

  // ── CUELLO ──
  cyl('cuello', 0.062 * H, 0.07 * H, 0.08 * H, 0, neckY - 0.008 * H, 0, skinM, hips);

  // ── CABEZA (pivote en el cuello: asiente y gira) ──
  const head = new TransformNode(`${id}_det_cabeza`, scene);
  head.parent = hips;
  head.position.y = headPivotY;
  const headRelY = headCY - headPivotY; // centro del cráneo respecto al pivote
  ball('craneo', headD, 0, headRelY, 0, skinM, head);

  // OJOS (blanco + pupila): la pieza que más «define» de cerca.
  const eyeZ = 0.048 * H;
  for (const sz of [-1, 1] as const) {
    ball(`ojo_${sz > 0 ? 'd' : 'i'}`, 0.042 * H, 0.1 * H, headRelY + 0.012 * H, sz * eyeZ, whiteM, head);
    ball(`pupila_${sz > 0 ? 'd' : 'i'}`, 0.02 * H, 0.115 * H, headRelY + 0.012 * H, sz * eyeZ + sz * 0.004 * H, darkM, head);
    // CEJA
    box(`ceja_${sz > 0 ? 'd' : 'i'}`, 0.016 * H, 0.012 * H, 0.05 * H, 0.1 * H, headRelY + 0.052 * H, sz * eyeZ, hairM, head);
  }
  // NARIZ (sobresale del cráneo: silueta de perfil inconfundible).
  ball('nariz', 0.05 * H, 0.118 * H, headRelY - 0.012 * H, 0, skinM, head);
  // BOCA
  box('boca', 0.014 * H, 0.011 * H, 0.042 * H, 0.106 * H, headRelY - 0.058 * H, 0, matOf(Color3.FromHexString(spec.skin).scale(0.55).toHexString(), 'boca'), head);
  // OREJAS
  ball('oreja_a', 0.05 * H, -0.005 * H, headRelY, 0.115 * H, skinM, head);
  ball('oreja_b', 0.05 * H, -0.005 * H, headRelY, -0.115 * H, skinM, head);
  // BIGOTE (opcional)
  if (spec.mustache) {
    box('bigote', 0.022 * H, 0.02 * H, 0.064 * H, 0.112 * H, headRelY - 0.04 * H, 0, matOf(spec.mustache, 'bigote'), head);
  }

  // ── PEINADOS ──
  switch (spec.hairStyle) {
    case 'baldSides': {
      // Corona despejada (piel) + parches grises a los lados y nuca (la hoja de personaje).
      const side = ball('pelo_lado_a', 0.15 * H, 0.005 * H, headRelY - 0.02 * H, 0.1 * H, hairM, head);
      side.scaling.set(0.62, 0.72, 0.62);
      const sideB = ball('pelo_lado_b', 0.15 * H, 0.005 * H, headRelY - 0.02 * H, -0.1 * H, hairM, head);
      sideB.scaling.set(0.62, 0.72, 0.62);
      const back = ball('pelo_nuca', 0.18 * H, -0.075 * H, headRelY - 0.02 * H, 0, hairM, head);
      back.scaling.set(0.6, 0.62, 0.85);
      // Patillas hacia la cara (conexión visual con las sienes).
      box('patilla_a', 0.05 * H, 0.05 * H, 0.022 * H, 0.078 * H, headRelY + 0.005 * H, 0.096 * H, hairM, head);
      box('patilla_b', 0.05 * H, 0.05 * H, 0.022 * H, 0.078 * H, headRelY + 0.005 * H, -0.096 * H, hairM, head);
      break;
    }
    case 'bun': {
      // Casquete + moño trasero (jubilada, cotilla, sanitaria).
      const cap = ball('pelo_casco', headD + 0.02 * H, -0.012 * H, headRelY + 0.028 * H, 0, hairM, head);
      cap.scaling.set(0.95, 0.76, 0.95);
      ball('moño', 0.095 * H, -0.1 * H, headRelY + 0.06 * H, 0, hairM, head);
      break;
    }
    case 'cap': {
      // Gorra: coronilla + visera hacia +X, color de la prenda superior.
      const crown = ball('gorra_copa', headD + 0.014 * H, 0, headRelY + 0.055 * H, 0, topM, head);
      crown.scaling.set(0.98, 0.62, 0.98);
      box('gorra_visera', 0.095 * H, 0.016 * H, 0.15 * H, 0.105 * H, headRelY + 0.05 * H, 0, topM, head);
      // Pelo asomando bajo la gorra (nuca).
      const back = ball('pelo_nuca', 0.14 * H, -0.065 * H, headRelY - 0.01 * H, 0, hairM, head);
      back.scaling.set(0.6, 0.6, 0.85);
      break;
    }
    case 'full': {
      // Melena: casquete grande que baja por los lados.
      const cap = ball('pelo_melena', headD + 0.026 * H, -0.015 * H, headRelY + 0.006 * H, 0, hairM, head);
      cap.scaling.set(0.98, 0.94, 0.98);
      break;
    }
    case 'headphones': {
      // Pelo corto + cascos: auriculares a los lados y arco superior.
      const cap = ball('pelo_casco', headD + 0.014 * H, -0.01 * H, headRelY + 0.024 * H, 0, hairM, head);
      cap.scaling.set(0.95, 0.74, 0.95);
      const cupM = matOf('#23211f', 'cascos');
      const cupA = cyl('casco_a', 0.075 * H, 0.075 * H, 0.035 * H, 0, headRelY, 0.118 * H, cupM, head);
      cupA.rotation.x = Math.PI / 2;
      const cupB = cyl('casco_b', 0.075 * H, 0.075 * H, 0.035 * H, 0, headRelY, -0.118 * H, cupM, head);
      cupB.rotation.x = Math.PI / 2;
      box('casco_arco', 0.03 * H, 0.02 * H, 0.25 * H, 0, headRelY + 0.115 * H, 0, cupM, head);
      break;
    }
    case 'short':
    default: {
      // Cortado al ras: casquete pegado al cráneo.
      const cap = ball('pelo_casco', headD + 0.02 * H, -0.012 * H, headRelY + 0.03 * H, 0, hairM, head);
      cap.scaling.set(0.95, 0.76, 0.95);
      break;
    }
  }

  // ── GAFAS (varillas hasta las orejas: silueta de perfil con línea continua). ──
  if (spec.glasses && spec.glasses !== 'none') {
    const sun = spec.glasses === 'sun';
    const frameM = matOf(sun ? '#191715' : '#3a3530', 'gafas_marco');
    const lensM = matOf(sun ? '#23282e' : '#dce9f2', 'gafas_cristal');
    const lensZ = 0.052 * H;
    const lensY = headRelY + 0.014 * H;
    const lensH = (sun ? 0.06 : 0.05) * H;
    for (const sz of [-1, 1] as const) {
      box(`gafa_marco_${sz > 0 ? 'd' : 'i'}`, 0.016 * H, lensH, 0.07 * H, 0.117 * H, lensY, sz * lensZ, frameM, head);
      box(`gafa_cristal_${sz > 0 ? 'd' : 'i'}`, 0.008 * H, lensH - 0.014 * H, 0.056 * H, 0.123 * H, lensY, sz * lensZ, lensM, head);
      // Varilla: del marco a la oreja.
      box(`gafa_varilla_${sz > 0 ? 'd' : 'i'}`, 0.11 * H, 0.011 * H, 0.011 * H, 0.012 * H, lensY, sz * 0.104 * H, frameM, head);
    }
    box('gafa_puente', 0.014 * H, 0.012 * H, 0.03 * H, 0.118 * H, lensY + lensH / 2, 0, frameM, head);
  }

  // ── BRAZOS: manga de la prenda + mano de piel; cuelgan del hombro (pivote arriba). ──
  const armLen = 0.29 * H;
  const armW = 0.078 * H;
  type Joint = { node: TransformNode; val: number };
  const arms: Joint[] = [];
  for (const sz of [-1, 1] as const) {
    const joint = new TransformNode(`${id}_det_brazo_${sz > 0 ? 'd' : 'i'}_pivot`, scene);
    joint.parent = hips;
    joint.position.set(0, shoulderY, sz * (torsoW / 2 + 0.008 * H));
    box(`brazo_${sz > 0 ? 'd' : 'i'}`, armW, armLen, 0.09 * H, 0, -armLen / 2, 0, topM, joint);
    ball(`mano_${sz > 0 ? 'd' : 'i'}`, 0.055 * H, 0, -armLen - 0.012 * H, 0, skinM, joint);
    arms.push({ node: joint, val: 0 });
  }

  // ── PIERNAS: pantalón + zapato con puntera hacia +X; pivotan en la cadera. ──
  const legW = 0.1 * H;
  const legs: Joint[] = [];
  for (const sz of [-1, 1] as const) {
    const joint = new TransformNode(`${id}_det_pierna_${sz > 0 ? 'd' : 'i'}_pivot`, scene);
    joint.parent = root; // ancladas a la RAÍZ: el bob del cuerpo no levanta los pies
    joint.position.set(0, hipY, sz * 0.066 * H);
    box(`pierna_${sz > 0 ? 'd' : 'i'}`, legW, legLen, 0.115 * H, 0, -legLen / 2, 0, bottomM, joint);
    box(`zapato_${sz > 0 ? 'd' : 'i'}`, 0.185 * H, 0.055 * H, legW + 0.006 * H, 0.022 * H, -legLen - 0.022 * H, 0, shoeM, joint);
    legs.push({ node: joint, val: 0 });
  }

  // ── ACCESORIO DE MANO (silueta lateral + frontal). ──
  const handL = arms[0]!.node; // brazo −Z
  const propY = -armLen - 0.02 * H;
  switch (spec.prop) {
    case 'clipboard': {
      const boardM = matOf('#8a6a48', 'portapapeles');
      const clipM = matOf('#b8bfc7', 'pinza');
      box('porta_tabla', 0.014 * H, 0.22 * H, 0.16 * H, 0.02 * H, propY - 0.08 * H, 0, boardM, handL);
      box('porta_papel', 0.008 * H, 0.185 * H, 0.13 * H, 0.031 * H, propY - 0.075 * H, 0, whiteM, handL);
      box('porta_pinza', 0.018 * H, 0.032 * H, 0.05 * H, 0.034 * H, propY + 0.025 * H, 0, clipM, handL);
      break;
    }
    case 'briefcase': {
      const caseM = matOf('#3a2f26', 'maletin');
      box('maletin', 0.055 * H, 0.17 * H, 0.24 * H, 0.02 * H, propY - 0.1 * H, 0, caseM, handL);
      box('maletin_asa', 0.016 * H, 0.03 * H, 0.07 * H, 0.02 * H, propY - 0.005 * H, 0, caseM, handL);
      break;
    }
    case 'spray': {
      const canM = matOf('#d8d3c8', 'spray');
      cyl('spray', 0.038 * H, 0.042 * H, 0.13 * H, 0.03 * H, propY - 0.04 * H, 0, canM, handL);
      box('spray_cap', 0.02 * H, 0.024 * H, 0.03 * H, 0.03 * H, propY + 0.035 * H, 0, matOf('#e2554a', 'spray_tapa'), handL);
      break;
    }
    case 'guitar': {
      // Guitarra al frente: caja junto a la cadera y mango hacia arriba-adelante.
      const woodM = matOf('#a8743d', 'guitarra');
      const body = box('guitarra_caja', 0.06 * H, 0.2 * H, 0.17 * H, 0.13 * H, hipY + 0.02 * H, 0.02 * H, woodM, hips);
      body.rotation.z = 0.15;
      const neck = box('guitarra_mango', 0.26 * H, 0.035 * H, 0.035 * H, 0.28 * H, hipY + 0.14 * H, 0.02 * H, matOf('#5b4632', 'guitarra_mango'), hips);
      neck.rotation.z = 0.55;
      break;
    }
    case 'baguette': {
      const barra = box('barra', 0.3 * H, 0.05 * H, 0.05 * H, 0.05 * H, propY - 0.02 * H, 0, matOf('#d9a55c', 'pan'), handL);
      barra.rotation.z = 0.5;
      break;
    }
    case 'none':
    default:
      break;
  }

  // ── Animación procedural (solo cuando el LOD cercano está activo) ──
  let time = 0;
  let phase = 0;
  let lastFade = -1;
  const ease = (j: Joint | undefined, target: number, k: number): void => {
    if (!j) return;
    j.val += (target - j.val) * k;
    j.node.rotation.z = j.val;
  };

  return {
    root,
    setEnabled(v: boolean) {
      root.setEnabled(v);
    },
    setFade(v: number) {
      if (v === lastFade) return;
      lastFade = v;
      for (const m of meshes) m.visibility = v;
    },
    sync(dt: number, state: DetailFrameState) {
      time += dt;
      const k = Math.min(1, dt * 11);
      const moving = state.speedH > 0.15;
      if (moving) phase += dt * (3.4 + state.speedH * 1.9);
      const swing = moving ? Math.min(0.6, 0.28 + state.speedH * 0.13) : 0;
      const s = Math.sin(phase);

      // Objetivos por estado (rotación Z: + hacia +X = adelante).
      let legL = moving ? s * swing : 0;
      let legR = moving ? -s * swing : 0;
      let armL = moving ? -s * swing * 0.72 : 0.035 * Math.sin(time * 1.3);
      let armR = moving ? s * swing * 0.72 : -0.035 * Math.sin(time * 1.3);
      let bob = moving ? Math.abs(s) * 0.018 * H : 0;
      let lean = moving ? -0.06 - Math.min(0.05, state.speedH * 0.006) : 0;
      let headYaw = moving ? 0 : 0.09 * Math.sin(time * 0.55);
      let headNod = moving ? 0.03 * s : 0.02 * Math.sin(time * 1.9);
      let drop = 0;

      if (state.seated) {
        // Sentado: caderas caen al asiento, muslos hacia delante, torso erguido.
        drop = Math.max(0, hipY - 0.45);
        legL = 1.18;
        legR = 1.18;
        armL = 0.18;
        armR = 0.18;
        lean = 0.04;
        bob = 0;
      }

      // Gestos sociales (misma gramática que los clips de los rigs).
      const g = state.gesture;
      if (g === 'talk') {
        armR = -1.75 + 0.32 * Math.sin(time * 5.2);
        armL = 0.15;
        headNod = 0.07 * Math.sin(time * 3.1);
      } else if (g === 'laugh') {
        bob += Math.abs(Math.sin(time * 6.5)) * 0.02 * H;
        headNod = -0.14;
        armL = 0.3;
        armR = 0.3;
      } else if (g === 'argue' || g === 'fight') {
        armL = -1.15 + 0.4 * Math.sin(time * 7);
        armR = -1.15 - 0.4 * Math.sin(time * 7);
        lean = -0.12;
      } else if (g === 'phone') {
        armR = -2.3;
        headYaw = 0.14;
      } else if (g && g !== 'sleep') {
        // Gesto desconocido (trabajo, spray…): mano derecha al frente.
        armR = -1.4;
      }

      // Suavizado y aplicación.
      ease(legs[0], legL, k);
      ease(legs[1], legR, k);
      ease(arms[0], armL, k);
      ease(arms[1], armR, k);
      hips.position.y = bob - drop;
      hips.rotation.z = lean;
      head.rotation.y = headYaw;
      head.rotation.z = headNod;
      // Respiración sutil en reposo (escala desde los pies: el pivote de caderas está en y=0).
      const breath = moving || state.seated ? 1 : 1 + 0.012 * Math.sin(time * 2.1);
      hips.scaling.y = breath;
    },
    dispose() {
      root.dispose(false, true);
      for (const m of mats.values()) m.dispose();
      mats.clear();
      meshes.length = 0;
    },
  };
}
