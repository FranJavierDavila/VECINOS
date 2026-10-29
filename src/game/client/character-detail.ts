import type { Mesh, Scene, TransformNode } from '@babylonjs/core';
import type { CharacterDetailSpec } from '@/game/core/types';
import { B } from './babylon';

/**
 * PERSONAJES DETALLADOS (v1.44) — LOD de los vecinos con TRES niveles.
 *
 *  · NIVEL 0 (lejos)   — rig glTF de siempre (actors.ts): barato y probado.
 *  · NIVEL 1 (medio)   — este módulo, piezas de SILUETA: masa de pelo, gafas,
 *                        nariz, torso con solapas/corbata, piernas, zapatos.
 *  · NIVEL 2 (cerca)   — TODO: ojos con pupilas, cejas, bigote, varillas de las
 *                        gafas, hebilla del cinturón, papel y pinza del portapapeles,
 *                        suelas, jorobas de abuelo…
 *
 * La apariencia sale 1:1 de la hoja de personaje del catálogo (100% JSON,
 * public/content/character-details.json): proporciones corpulentas (headScale,
 * bulk), postura encorvada (hunch), traje con solapas y corbata, cinturón con
 * hebilla, accesorio de mano. La silueta se reconoce de FRENTE (corbata, solapas,
 * gafas, ojos), de PERFIL (nariz, patillas, varillas, orejas, barriga) y de
 * ESPALDAS (parches de pelo/casquete, chaqueta lisa, cinturón).
 *
 * Convención de autoría = la de los rigs (actors.ts): el personaje MIRA A +X,
 * pies en y=0 y el swing de extremidades rota sobre el eje Z (plano X-Y).
 * CERO superficies coplanares: cada pieza superpuesta lleva su empuje explícito.
 */

/** Estado por frame que la presentación le pasa al personaje detallado. */
export interface DetailFrameState {
  speedH: number;
  gesture: string | null;
  seated: boolean;
  /** Fundido del actor (0..1) — el mismo del teatro del portal. */
  fade: number;
}

export interface CharacterDetailRig {
  root: TransformNode;
  setEnabled(v: boolean): void;
  /** Nivel de detalle de las piezas (1 = silueta, 2 = todo). */
  setTier(t: 1 | 2): void;
  setFade(v: number): void;
  /** Animación procedural: marcha, reposo, sentado y gestos sociales. */
  sync(dt: number, state: DetailFrameState): void;
  dispose(): void;
}

export function buildCharacterDetail(scene: Scene, id: string, spec: CharacterDetailSpec, height: number): CharacterDetailRig | null {
  const { Color3, MeshBuilder, StandardMaterial, TransformNode, Vector3 } = B();
  if (!spec || height <= 0) return null;
  const H = spec.height && spec.height > 0 ? spec.height : height;
  const hs = spec.headScale && spec.headScale > 0 ? spec.headScale : 1;
  const bk = spec.bulk && spec.bulk > 0 ? spec.bulk : 1;
  const hunch = Math.min(0.3, Math.max(0, spec.hunch ?? 0));

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
  /** Piezas con su nivel: 1 = silueta (medio), 2 = detalle de cerca. */
  const pieces: { mesh: Mesh; tier: 1 | 2 }[] = [];

  const box = (name: string, tier: 1 | 2, w: number, h: number, d: number, x: number, y: number, z: number, m: StandardMaterial, parent: TransformNode): Mesh => {
    const mesh = MeshBuilder.CreateBox(`${id}_det_${name}`, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    mesh.isPickable = false;
    mesh.parent = parent;
    pieces.push({ mesh, tier });
    return mesh;
  };
  const ball = (name: string, tier: 1 | 2, d: number, x: number, y: number, z: number, m: StandardMaterial, parent: TransformNode): Mesh => {
    const mesh = MeshBuilder.CreateSphere(`${id}_det_${name}`, { diameter: d, segments: 8 }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    mesh.isPickable = false;
    mesh.parent = parent;
    pieces.push({ mesh, tier });
    return mesh;
  };
  const cyl = (name: string, tier: 1 | 2, dTop: number, dBot: number, h: number, x: number, y: number, z: number, m: StandardMaterial, parent: TransformNode): Mesh => {
    const mesh = MeshBuilder.CreateCylinder(`${id}_det_${name}`, { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: 12 }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    mesh.isPickable = false;
    mesh.parent = parent;
    pieces.push({ mesh, tier });
    return mesh;
  };

  // ── Proporciones (fracciones de H, medidas sobre la hoja de personaje) ──
  const hipY = 0.47 * H;               // cinturón
  const legLen = 0.42 * H;             // pantalón hasta el tobillo
  const torsoTop = 0.78 * H;           // hombros
  const torsoBot = 0.45 * H;           // bajo de la chaqueta (el cinturón queda visto)
  const torsoH = torsoTop - torsoBot;
  const torsoCY = (torsoTop + torsoBot) / 2;
  const torsoW = 0.36 * H * bk;        // corpulencia
  const torsoD = 0.22 * H * bk;
  const shoulderY = torsoTop - 0.045 * H;
  const headPivotY = torsoTop + 0.02 * H;
  const headD = 0.2 * H * hs;          // cabeza corpulenta caricaturesca
  const headCY = headPivotY + headD / 2 * 0.95;

  const skinM = matOf(spec.skin, 'piel');
  const hairM = matOf(spec.hairColor, 'pelo');
  const topM = matOf(spec.top, 'torso');
  const bottomM = matOf(spec.bottom, 'pierna');
  const shoeM = matOf(spec.shoes, 'zapato');
  const darkM = matOf('#2e2a26', 'oscuro');
  const whiteM = matOf('#f5f2ea', 'blanco');

  const root = new TransformNode(`${id}_det_root`, scene);

  // ── CUERPO (caderas): origen en los PIES; el bob y la caída al sentarse mueven este
  //  nodo. Las piernas cuelgan de la RAÍZ para que los pies no floten al rebotar. ──
  const hips = new TransformNode(`${id}_det_cuerpo`, scene);
  hips.parent = root;
  hips.rotation.z = -hunch * 0.55; // postura encorvada (señor mayor de la hoja)

  // ── TORSO: chaqueta con hombreras redondeadas y faldón que drapea sobre la cadera ──
  box('torso', 1, torsoW, torsoH, torsoD, 0, torsoCY, 0, topM, hips);
  box('torso_faldon', 1, torsoW + 0.025 * H, 0.11 * H, torsoD + 0.02 * H, 0, torsoBot + 0.045 * H, 0, topM, hips);
  ball('hombro_a', 1, 0.13 * H, 0, shoulderY + 0.015 * H, torsoW / 2 - 0.03 * H, topM, hips);
  ball('hombro_b', 1, 0.13 * H, 0, shoulderY + 0.015 * H, -(torsoW / 2 - 0.03 * H), topM, hips);

  // ── TRAJE ABIERTO: camisa en V GRANDE + corbata + solapas + cuello (la lectura del
  //  Presidente de la hoja: pecho claro enmarcado por la chaqueta oscura) ──
  if (spec.suit) {
    const lapelM = matOf(spec.suit.lapel, 'solapa');
    const shirtM = matOf(spec.suit.shirt, 'camisa');
    const tieM = matOf(spec.suit.tie, 'corbata');
    const faceX = torsoD / 2;
    // Cuello blanco asomando sobre la chaqueta (el marco superior de la V).
    box('cuello_camisa', 1, 0.02 * H, 0.055 * H, 0.15 * H, faceX - 0.004, torsoTop + 0.008 * H, 0, shirtM, hips);
    // Camisa: panel blanco ancho de la V (empuje +7 mm sobre el pecho).
    box('camisa', 1, 0.018 * H, 0.27 * H, 0.14 * H, faceX + 0.007, torsoCY + 0.1 * H, 0, shirtM, hips);
    // Corbata: nudo + pica larga hasta el cinturón; SIEMPRE +4 mm por delante de la camisa.
    box('corbata_nudo', 1, 0.026 * H, 0.055 * H, 0.06 * H, faceX + 0.017, torsoTop - 0.03 * H, 0, tieM, hips);
    box('corbata', 1, 0.022 * H, 0.3 * H, 0.078 * H, faceX + 0.017, torsoCY + 0.01 * H, 0, tieM, hips);
    // Solapas: marcos inclinados de la chaqueta alrededor de la V (bien separados).
    const lpz = 0.095 * H;
    const lapelA = box('solapa_a', 1, 0.02 * H, 0.26 * H, 0.075 * H, faceX + 0.01, torsoCY + 0.11 * H, lpz, lapelM, hips);
    lapelA.rotation.x = -0.38;
    const lapelB = box('solapa_b', 1, 0.02 * H, 0.26 * H, 0.075 * H, faceX + 0.01, torsoCY + 0.11 * H, -lpz, lapelM, hips);
    lapelB.rotation.x = 0.38;
  }

  // ── CINTURÓN VISTO bajo la chaqueta (franja completa: frontal, perfil y espalda) ──
  if (spec.belt) {
    const strapM = matOf(spec.belt.strap, 'cinturon');
    box('cinturon', 1, 0.235 * H, 0.055 * H, torsoW + 0.016 * H, 0, hipY + 0.005 * H, 0, strapM, hips);
    const buckleM = matOf(spec.belt.buckle, 'hebilla');
    box('hebilla', 2, 0.016 * H, 0.042 * H, 0.055 * H, 0.235 * H / 2 + 0.004, hipY + 0.005 * H, 0, buckleM, hips);
  }

  // ── CUELLO corto y grueso ──
  cyl('cuello', 1, 0.075 * H, 0.082 * H, 0.06 * H, 0.01 * H, torsoTop + 0.012 * H, 0, skinM, hips);

  // ── CABEZA (pivote en la base del cuello) ──
  const head = new TransformNode(`${id}_det_cabeza`, scene);
  head.parent = hips;
  head.position.set(0.03 * H + hunch * 0.18 * H, headPivotY, 0); // el cuello se adelanta con la joroba
  const headRelY = headCY - headPivotY;
  ball('craneo', 1, headD, 0, headRelY, 0, skinM, head);
  // Carrillos de abuelo (volumen bajo la mirada, como la hoja).
  const jowlA = ball('carrillo_a', 2, 0.085 * H, 0.055 * H, headRelY - 0.05 * H, 0.058 * H, skinM, head);
  jowlA.scaling.set(0.85, 0.8, 0.85);
  const jowlB = ball('carrillo_b', 2, 0.085 * H, 0.055 * H, headRelY - 0.05 * H, -0.058 * H, skinM, head);
  jowlB.scaling.set(0.85, 0.8, 0.85);

  // OJOS: blanco + pupila (nivel 2 — es lo que «define» de cerca).
  const eyeZ = 0.05 * H;
  for (const sz of [-1, 1] as const) {
    ball(`ojo_${sz > 0 ? 'd' : 'i'}`, 2, 0.05 * H, 0.096 * H, headRelY + 0.016 * H, sz * eyeZ, whiteM, head);
    ball(`pupila_${sz > 0 ? 'd' : 'i'}`, 2, 0.024 * H, 0.116 * H, headRelY + 0.016 * H, sz * eyeZ + sz * 0.004 * H, darkM, head);
    // CEJA gruesa gris, con leve gesto de enfado (nivel 2).
    const brow = box(`ceja_${sz > 0 ? 'd' : 'i'}`, 2, 0.02 * H, 0.022 * H, 0.058 * H, 0.098 * H, headRelY + 0.06 * H, sz * eyeZ, hairM, head);
    brow.rotation.z = sz > 0 ? -0.18 : 0.18;
  }
  // NARIZ grande y redonda (silueta de perfil inconfundible).
  ball('nariz', 1, 0.068 * H, 0.115 * H, headRelY - 0.008 * H, 0, skinM, head);
  // BOCA (fruncida) + BIGOTE gris.
  box('boca', 2, 0.016 * H, 0.012 * H, 0.05 * H, 0.108 * H, headRelY - 0.066 * H, 0, matOf(Color3.FromHexString(spec.skin).scale(0.5).toHexString(), 'boca'), head);
  if (spec.mustache) {
    box('bigote', 2, 0.026 * H, 0.022 * H, 0.07 * H, 0.108 * H, headRelY - 0.044 * H, 0, matOf(spec.mustache, 'bigote'), head);
  }
  // OREJAS
  ball('oreja_a', 1, 0.055 * H, -0.01 * H, headRelY, 0.1 * H, skinM, head);
  ball('oreja_b', 1, 0.055 * H, -0.01 * H, headRelY, -0.1 * H, skinM, head);

  // ── PEINADOS (masas de pelo: lo primero que define la silueta) ──
  switch (spec.hairStyle) {
    case 'baldSides': {
      // Hoja del Presidente: coronilla CALVA + laterales blancos pompados + nuca llena.
      const side = ball('pelo_lado_a', 1, 0.17 * H, 0.012 * H, headRelY - 0.012 * H, 0.082 * H, hairM, head);
      side.scaling.set(0.72, 0.95, 0.68);
      const sideB = ball('pelo_lado_b', 1, 0.17 * H, 0.012 * H, headRelY - 0.012 * H, -0.082 * H, hairM, head);
      sideB.scaling.set(0.72, 0.95, 0.68);
      const back = ball('pelo_nuca', 1, 0.21 * H, -0.058 * H, headRelY - 0.015 * H, 0, hairM, head);
      back.scaling.set(0.62, 0.78, 0.92);
      // mechones en la sienes (conexión visual con la cara).
      box('patilla_a', 1, 0.06 * H, 0.06 * H, 0.026 * H, 0.07 * H, headRelY + 0.015 * H, 0.09 * H, hairM, head);
      box('patilla_b', 1, 0.06 * H, 0.06 * H, 0.026 * H, 0.07 * H, headRelY + 0.015 * H, -0.09 * H, hairM, head);
      break;
    }
    case 'bun': {
      const cap = ball('pelo_casco', 1, headD + 0.024 * H, -0.014 * H, headRelY + 0.03 * H, 0, hairM, head);
      cap.scaling.set(0.96, 0.78, 0.96);
      ball('moño', 1, 0.11 * H, -0.11 * H, headRelY + 0.065 * H, 0, hairM, head);
      break;
    }
    case 'cap': {
      const crown = ball('gorra_copa', 1, headD + 0.016 * H, 0, headRelY + 0.06 * H, 0, topM, head);
      crown.scaling.set(0.98, 0.6, 0.98);
      box('gorra_visera', 1, 0.11 * H, 0.018 * H, 0.16 * H, 0.115 * H, headRelY + 0.055 * H, 0, topM, head);
      const back = ball('pelo_nuca', 1, 0.15 * H, -0.07 * H, headRelY - 0.012 * H, 0, hairM, head);
      back.scaling.set(0.6, 0.62, 0.85);
      break;
    }
    case 'full': {
      const cap = ball('pelo_melena', 1, headD + 0.03 * H, -0.018 * H, headRelY + 0.008 * H, 0, hairM, head);
      cap.scaling.set(0.98, 0.95, 0.98);
      break;
    }
    case 'headphones': {
      const cap = ball('pelo_casco', 1, headD + 0.016 * H, -0.012 * H, headRelY + 0.026 * H, 0, hairM, head);
      cap.scaling.set(0.96, 0.76, 0.96);
      const cupM = matOf('#23211f', 'cascos');
      const cupA = cyl('casco_a', 1, 0.08 * H, 0.08 * H, 0.04 * H, 0, headRelY, 0.1 * H, cupM, head);
      cupA.rotation.x = Math.PI / 2;
      const cupB = cyl('casco_b', 1, 0.08 * H, 0.08 * H, 0.04 * H, 0, headRelY, -0.1 * H, cupM, head);
      cupB.rotation.x = Math.PI / 2;
      box('casco_arco', 1, 0.032 * H, 0.022 * H, 0.22 * H, 0, headRelY + headD / 2 + 0.005 * H, 0, cupM, head);
      break;
    }
    case 'short':
    default: {
      const cap = ball('pelo_casco', 1, headD + 0.022 * H, -0.014 * H, headRelY + 0.032 * H, 0, hairM, head);
      cap.scaling.set(0.96, 0.78, 0.96);
      break;
    }
  }

  // ── GAFAS grandes con varilla hasta la oreja (nivel 2: varillas y puente) ──
  if (spec.glasses && spec.glasses !== 'none') {
    const sun = spec.glasses === 'sun';
    const frameM = matOf(sun ? '#191715' : '#26221f', 'gafas_marco');
    const lensM = matOf(sun ? '#23282e' : '#eef2f5', 'gafas_cristal');
    const lensZ = 0.056 * H;
    const lensY = headRelY + 0.02 * H;
    const lensH = (sun ? 0.075 : 0.07) * H;
    for (const sz of [-1, 1] as const) {
      box(`gafa_marco_${sz > 0 ? 'd' : 'i'}`, 1, 0.02 * H, lensH, 0.085 * H, 0.112 * H, lensY, sz * lensZ, frameM, head);
      box(`gafa_cristal_${sz > 0 ? 'd' : 'i'}`, 2, 0.01 * H, lensH - 0.018 * H, 0.07 * H, 0.121 * H, lensY, sz * lensZ, lensM, head);
      // Varilla del marco a la oreja (nivel 2 — la línea continua del perfil).
      box(`gafa_varilla_${sz > 0 ? 'd' : 'i'}`, 2, 0.12 * H, 0.014 * H, 0.014 * H, 0.012 * H, lensY, sz * 0.092 * H, frameM, head);
    }
    box('gafa_puente', 2, 0.016 * H, 0.014 * H, 0.034 * H, 0.114 * H, lensY + lensH / 2 - 0.004 * H, 0, frameM, head);
  }

  // ── BRAZOS: manga completa + mano; pivote en el hombro, leve apertura de reposo ──
  const armLen = 0.29 * H;
  const armW = 0.095 * H;
  type Joint = { node: TransformNode; val: number };
  const arms: Joint[] = [];
  for (const sz of [-1, 1] as const) {
    const joint = new TransformNode(`${id}_det_brazo_${sz > 0 ? 'd' : 'i'}_pivot`, scene);
    joint.parent = hips;
    joint.position.set(0, shoulderY + 0.01 * H, sz * (torsoW / 2 - 0.005 * H));
    joint.rotation.x = sz > 0 ? -0.07 : 0.07; // reposo: brazos apenas separados del cuerpo
    box(`brazo_${sz > 0 ? 'd' : 'i'}`, 1, armW, armLen, 0.1 * H, 0, -armLen / 2, 0, topM, joint);
    ball(`mano_${sz > 0 ? 'd' : 'i'}`, 1, 0.062 * H, 0, -armLen - 0.014 * H, 0, skinM, joint);
    arms.push({ node: joint, val: 0 });
  }

  // ── PIERNAS: pantalón grueso + zapato GRANDE con puntera redonda ──
  const legW = 0.125 * H;
  const legs: Joint[] = [];
  for (const sz of [-1, 1] as const) {
    const joint = new TransformNode(`${id}_det_pierna_${sz > 0 ? 'd' : 'i'}_pivot`, scene);
    joint.parent = root; // ancladas a la RAÍZ: el bob del cuerpo no levanta los pies
    joint.position.set(0, hipY + 0.01 * H, sz * 0.075 * H);
    box(`pierna_${sz > 0 ? 'd' : 'i'}`, 1, legW, legLen, 0.14 * H, 0, -legLen / 2, 0, bottomM, joint);
    // Zapato: caja + puntera esférica + suela más oscura (nivel 2 la suela).
    box(`zapato_${sz > 0 ? 'd' : 'i'}`, 1, 0.24 * H, 0.07 * H, legW + 0.01 * H, 0.035 * H, -legLen - 0.028 * H, 0, shoeM, joint);
    ball(`puntera_${sz > 0 ? 'd' : 'i'}`, 1, legW + 0.01 * H, 0.14 * H, -legLen - 0.028 * H, 0, shoeM, joint);
    box(`suela_${sz > 0 ? 'd' : 'i'}`, 2, 0.25 * H, 0.02 * H, legW + 0.02 * H, 0.035 * H, -legLen - 0.068 * H, 0, darkM, joint);
    legs.push({ node: joint, val: 0 });
  }

  // ── ACCESORIO DE MANO (la hoja: portapapeles del Presidente) ──
  const handL = arms[0]!.node; // brazo −Z (su izquierda: aparece a la derecha del frontal)
  const propY = -armLen - 0.02 * H;
  switch (spec.prop) {
    case 'clipboard': {
      const boardM = matOf('#8a6a48', 'portapapeles');
      box('porta_tabla', 1, 0.018 * H, 0.25 * H, 0.19 * H, 0.03 * H, propY - 0.09 * H, 0, boardM, handL);
      box('porta_papel', 2, 0.01 * H, 0.21 * H, 0.155 * H, 0.042 * H, propY - 0.085 * H, 0, whiteM, handL);
      box('porta_pinza', 2, 0.022 * H, 0.038 * H, 0.06 * H, 0.048 * H, propY + 0.03 * H, 0, matOf('#b8bfc7', 'pinza'), handL);
      break;
    }
    case 'briefcase': {
      const caseM = matOf('#3a2f26', 'maletin');
      box('maletin', 1, 0.06 * H, 0.19 * H, 0.27 * H, 0.025 * H, propY - 0.11 * H, 0, caseM, handL);
      box('maletin_asa', 2, 0.018 * H, 0.034 * H, 0.08 * H, 0.025 * H, propY - 0.005 * H, 0, caseM, handL);
      break;
    }
    case 'spray': {
      const canM = matOf('#d8d3c8', 'spray');
      cyl('spray', 1, 0.042 * H, 0.046 * H, 0.14 * H, 0.03 * H, propY - 0.04 * H, 0, canM, handL);
      box('spray_cap', 2, 0.022 * H, 0.026 * H, 0.034 * H, 0.03 * H, propY + 0.038 * H, 0, matOf('#e2554a', 'spray_tapa'), handL);
      break;
    }
    case 'guitar': {
      const woodM = matOf('#a8743d', 'guitarra');
      const body = box('guitarra_caja', 1, 0.07 * H, 0.22 * H, 0.19 * H, 0.14 * H, hipY + 0.02 * H, 0.02 * H, woodM, hips);
      body.rotation.z = 0.15;
      const neck = box('guitarra_mango', 1, 0.28 * H, 0.04 * H, 0.04 * H, 0.3 * H, hipY + 0.16 * H, 0.02 * H, matOf('#5b4632', 'guitarra_mango'), hips);
      neck.rotation.z = 0.55;
      break;
    }
    case 'baguette': {
      const barra = box('barra', 1, 0.32 * H, 0.055 * H, 0.055 * H, 0.05 * H, propY - 0.02 * H, 0, matOf('#d9a55c', 'pan'), handL);
      barra.rotation.z = 0.5;
      break;
    }
    case 'none':
    default:
      break;
  }

  // ── Animación procedural (solo cuando el LOD cercano/medio está activo) ──
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
    setTier(t: 1 | 2) {
      for (const p of pieces) p.mesh.setEnabled(p.tier === 1 || t === 2);
    },
    setFade(v: number) {
      if (v === lastFade) return;
      lastFade = v;
      for (const p of pieces) p.mesh.visibility = v;
    },
    sync(dt: number, state: DetailFrameState) {
      time += dt;
      const k = Math.min(1, dt * 11);
      const moving = state.speedH > 0.15;
      if (moving) phase += dt * (3.4 + state.speedH * 1.9);
      const swing = moving ? Math.min(0.58, 0.26 + state.speedH * 0.12) : 0;
      const s = Math.sin(phase);

      // Objetivos por estado (rotación Z: + mueve el extremo hacia +X = adelante).
      let legL = moving ? s * swing : 0;
      let legR = moving ? -s * swing : 0;
      let armL = moving ? -s * swing * 0.7 : 0.04 * Math.sin(time * 1.3);
      let armR = moving ? s * swing * 0.7 : -0.04 * Math.sin(time * 1.3);
      let bob = moving ? Math.abs(s) * 0.016 * H : 0;
      let lean = moving ? -0.05 - Math.min(0.05, state.speedH * 0.006) : 0;
      let headYaw = moving ? 0 : 0.08 * Math.sin(time * 0.55);
      let headNod = moving ? 0.02 * s : 0.018 * Math.sin(time * 1.9);
      let drop = 0;

      if (state.seated) {
        // Sentado: caderas caen al asiento, muslos hacia delante, torso erguido.
        drop = Math.max(0, hipY - 0.45);
        legL = 1.18;
        legR = 1.18;
        armL = 0.18;
        armR = 0.18;
        lean = 0.03;
        bob = 0;
      }

      // Gestos sociales (misma gramática que los clips de los rigs).
      const g = state.gesture;
      if (g === 'talk') {
        armR = -1.7 + 0.3 * Math.sin(time * 5.2);
        armL = 0.15;
        headNod = 0.06 * Math.sin(time * 3.1);
      } else if (g === 'laugh') {
        bob += Math.abs(Math.sin(time * 6.5)) * 0.018 * H;
        headNod = -0.12;
        armL = 0.28;
        armR = 0.28;
      } else if (g === 'argue' || g === 'fight') {
        armL = -1.1 + 0.38 * Math.sin(time * 7);
        armR = -1.1 - 0.38 * Math.sin(time * 7);
        lean = -0.1;
      } else if (g === 'phone') {
        armR = -2.25;
        headYaw = 0.14;
      } else if (g && g !== 'sleep') {
        // Gesto desconocido (trabajo, spray…): mano derecha al frente.
        armR = -1.35;
      }

      // Suavizado y aplicación (el encorvamiento base va SUMADO al vaivén).
      ease(legs[0], legL, k);
      ease(legs[1], legR, k);
      ease(arms[0], armL, k);
      ease(arms[1], armR, k);
      hips.position.y = bob - drop;
      hips.rotation.z = lean - hunch * 0.55;
      head.rotation.y = headYaw;
      head.rotation.z = headNod + hunch * 0.35; // compensa: mira al frente pese a la joroba
      // Respiración sutil en reposo (escala desde los pies).
      const breath = moving || state.seated ? 1 : 1 + 0.011 * Math.sin(time * 2.1);
      hips.scaling.y = breath;
    },
    dispose() {
      root.dispose(false, true);
      for (const m of mats.values()) m.dispose();
      mats.clear();
      pieces.length = 0;
    },
  };
}
