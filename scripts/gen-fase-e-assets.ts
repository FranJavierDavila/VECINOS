/**
 * Generador de arte final — FASE E COMPLETA (v1.0):
 *   7 actores que faltaban (mismas convenciones que los pilotos, motor en scripts/lib/gltf.ts):
 *     jugador_base (jugador), presidente, estudiante, fondo_buitre, inquilino, okupa, musico —
 *     cada uno con idle/walk + clip de firma ligado a una actividad real del arquetipo.
 *   6 bloques que faltaban:
 *     pasillo_planta (paseo saliente), garaje, trasteros, local_comercial (El Rincón),
 *     lavanderia_comunal y vivienda_estandar como OVERLAY (marco de puerta sobre el corte
 *     interior: no oculta greybox ni el edge de vivienda).
 *
 * Ejecutar: bun scripts/gen-fase-e-assets.ts
 * Todo queda declarado en public/content/assets.json — sustituir por .glb de artista no toca código.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Gltf, quatAxis, loopTimes, sinKeys, buildAdult, addBaseClips, addSocialClips, type AdultRig, type Vec3 } from './lib/gltf';

/** Pieza de bloque: caja con material, posición y escala. Los children del Root se cablean solos. */
function box(g: Gltf, name: string, m: number, t: Vec3, s: Vec3): number {
  return g.addNode({ name, mesh: g.addBoxMesh(name, m), translation: t, scale: s });
}

/** Cierra el Root (nodo 0) con TODOS los nodos creados después — imposible fallar el recuento. */
function wireRoot(g: Gltf): void {
  (g.nodes[0] as { children: number[] }).children = g.nodes.map((_, i) => i).slice(1);
}

// ───────────────────────── Actores ─────────────────────────

/** El recién llegado (JUGADOR): naranja, gorra ámbar, móvil en la mano. Clip 'work' (teletrabaja). */
function buildJugador(): Record<string, unknown> {
  const r = buildAdult({ torso: '#ff7043', pants: '#3a4a5c', skin: '#e8b98a', shoe: '#e9ecef' });
  const { g, hips, headPivot, armL, armR } = r;
  const mCap = g.addMaterial('gorra', '#ffd166');
  const mPhone = g.addMaterial('movil', '#22303a', { metallic: 0.3, roughness: 0.4 });
  const meshCap = g.addBoxMesh('gorra', mCap);
  const meshPhone = g.addBoxMesh('movil', mPhone);
  const cap = g.addNode({ name: 'cap', mesh: meshCap, translation: [0.01, 0.3, 0], scale: [0.27, 0.09, 0.27] });
  const visor = g.addNode({ name: 'visor', mesh: meshCap, translation: [0.17, 0.28, 0], scale: [0.12, 0.035, 0.2] });
  const phone = g.addNode({ name: 'phone', mesh: meshPhone, translation: [0.03, -0.41, 0], scale: [0.05, 0.13, 0.04] });
  (g.nodes[headPivot] as { children: number[] }).children.push(cap, visor);
  (g.nodes[armR] as { children: number[] }).children.push(phone);

  addBaseClips(r, 2.4);
  addSocialClips(r);
  // work: teclea de pie — brazos al frente alternando, cabeza asintiendo (2.6 s)
  const t = loopTimes(2.6, 12);
  const tapL = t.map((x) => 1.05 + 0.1 * Math.sin((2 * Math.PI * 3 * x) / 2.6));
  const tapR = t.map((x) => 1.05 + 0.1 * Math.sin((2 * Math.PI * 3 * x) / 2.6 + Math.PI));
  g.addAnimation('work', [
    { node: armL, path: 'rotation', times: t, values: tapL.map((z) => quatAxis(0, 0, 1, z)) },
    { node: armR, path: 'rotation', times: t, values: tapR.map((z) => quatAxis(0, 0, 1, z)) },
    { node: headPivot, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 0.14 + 0.04 * Math.sin((2 * Math.PI * 2 * x) / 2.6))) },
    { node: hips, path: 'translation', times: t, values: t.map((x) => [0, 0.52 + 0.006 * Math.sin((2 * Math.PI * 4 * x) / 2.6), 0]) },
  ]);
  return g.finish('vecinos-gen-fase-e (jugador_base v1)');
}

/** Don Ramón, el Presidente: traje gris, corona roja, maletín. Clip 'inspect' (inspecciona el pasillo). */
function buildPresidente(): Record<string, unknown> {
  const r = buildAdult({ torso: '#4a4a55', pants: '#3c3c46', skin: '#e0b48d', shoe: '#2b2b31', torsoScale: [0.38, 0.52, 0.25] });
  const { g, hips, headPivot, armL, armR } = r;
  const mTie = g.addMaterial('corbata', '#e63946');
  const mCase = g.addMaterial('maletin', '#5a4632', { roughness: 0.6 });
  const mClasp = g.addMaterial('broche', '#ffd60a', { metallic: 0.5, roughness: 0.35 });
  const meshTie = g.addBoxMesh('corbata', mTie);
  const meshCase = g.addBoxMesh('maletin', mCase);
  const meshClasp = g.addBoxMesh('broche', mClasp);
  const tie = g.addNode({ name: 'tie', mesh: meshTie, translation: [0.19, 0.28, 0], scale: [0.04, 0.22, 0.07] });
  const caseBody = g.addNode({ name: 'briefcase', mesh: meshCase, translation: [0.02, -0.45, 0], scale: [0.08, 0.24, 0.3] });
  const caseHandle = g.addNode({ name: 'caseHandle', mesh: meshCase, translation: [0.02, -0.31, 0], scale: [0.03, 0.05, 0.12] });
  const caseClasp = g.addNode({ name: 'caseClasp', mesh: meshClasp, translation: [0.07, -0.38, 0], scale: [0.02, 0.04, 0.08] });
  (g.nodes[hips] as { children: number[] }).children.push(tie);
  (g.nodes[armR] as { children: number[] }).children.push(caseBody, caseHandle, caseClasp);

  addBaseClips(r, 2.9);
  addSocialClips(r);
  // inspect: mira el reloj con el brazo derecho arriba, escanea el pasillo con la cabeza (3.2 s)
  const t = loopTimes(3.2, 12);
  const scan = t.map((x) => 0.45 * Math.sin((2 * Math.PI * x) / 3.2));
  const nod = t.map((x) => 0.08 * Math.sin((2 * Math.PI * 3 * x) / 3.2));
  g.addAnimation('inspect', [
    { node: armR, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 1.35 + 0.06 * Math.sin((2 * Math.PI * 2 * x) / 3.2))) },
    { node: armL, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, -0.25)) },
    { node: headPivot, path: 'rotation', times: t, values: scan.map((y) => quatAxis(0, 1, 0, y)) },
    { node: hips, path: 'rotation', times: t, values: nod.map((z) => quatAxis(0, 0, 1, z)) },
  ]);
  return g.finish('vecinos-gen-fase-e (presidente v1)');
}

/** Laia, la Estudiante: sudadera lila, cascos dorados. Clip 'rock' (estudia con amplificador). */
function buildEstudiante(): Record<string, unknown> {
  const r = buildAdult({ torso: '#8e6fd8', pants: '#453f56', skin: '#e8b98a', shoe: '#2f3037', torsoScale: [0.34, 0.48, 0.24] });
  const { g, hips, headPivot, armL, armR } = r;
  const mBand = g.addMaterial('diadema', '#26232e');
  const mCup = g.addMaterial('auricular', '#ffca3a', { metallic: 0.2, roughness: 0.5 });
  const meshBand = g.addBoxMesh('diadema', mBand);
  const meshCup = g.addBoxMesh('auricular', mCup);
  const band = g.addNode({ name: 'headband', mesh: meshBand, translation: [0, 0.31, 0], scale: [0.05, 0.03, 0.32] });
  const cupL = g.addNode({ name: 'cupL', mesh: meshCup, translation: [0, 0.15, -0.15], scale: [0.1, 0.11, 0.05] });
  const cupR = g.addNode({ name: 'cupR', mesh: meshCup, translation: [0, 0.15, 0.15], scale: [0.1, 0.11, 0.05] });
  (g.nodes[headPivot] as { children: number[] }).children.push(band, cupL, cupR);

  addBaseClips(r, 2.3);
  addSocialClips(r);
  // rock: headbanging + guitarra aire (1.4 s)
  const t = loopTimes(1.4, 10);
  const beat = (x: number) => Math.sin((2 * Math.PI * 2 * x) / 1.4);
  g.addAnimation('rock', [
    { node: headPivot, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 0.3 * beat(x))) },
    { node: armR, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 0.7 + 0.28 * beat(x))) },
    { node: armL, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 1.5 + 0.08 * beat(x))) },
    { node: hips, path: 'translation', times: t, values: t.map((x) => [0, 0.52 + 0.03 * Math.abs(beat(x)), 0]) },
    { node: hips, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 1, 0, 0.12 * beat(x))) },
  ]);
  return g.finish('vecinos-gen-fase-e (estudiante v1)');
}

/** Sr. Vulture, del Fondo Buitre: traje negro, gafas oscuras, maletín. Clip 'appraise' (tasar el edificio). */
function buildBuitre(): Record<string, unknown> {
  const r = buildAdult({ torso: '#232323', pants: '#191919', skin: '#e6c3a1', shoe: '#101010', torsoScale: [0.38, 0.52, 0.25] });
  const { g, hips, headPivot, armL, armR } = r;
  const mShades = g.addMaterial('gafas', '#0b0b0b', { metallic: 0.5, roughness: 0.25 });
  const mCase = g.addMaterial('maletin', '#141414', { metallic: 0.3, roughness: 0.5 });
  const mClasp = g.addMaterial('broche', '#ffd60a', { metallic: 0.5, roughness: 0.35 });
  const meshShades = g.addBoxMesh('gafas', mShades);
  const meshCase = g.addBoxMesh('maletin', mCase);
  const meshClasp = g.addBoxMesh('broche', mClasp);
  const shades = g.addNode({ name: 'shades', mesh: meshShades, translation: [0.14, 0.17, 0], scale: [0.05, 0.05, 0.26] });
  const caseBody = g.addNode({ name: 'briefcase', mesh: meshCase, translation: [0.02, -0.45, 0], scale: [0.08, 0.24, 0.3] });
  const caseHandle = g.addNode({ name: 'caseHandle', mesh: meshCase, translation: [0.02, -0.31, 0], scale: [0.03, 0.05, 0.12] });
  const caseClasp = g.addNode({ name: 'caseClasp', mesh: meshClasp, translation: [0.07, -0.38, 0], scale: [0.02, 0.04, 0.08] });
  (g.nodes[headPivot] as { children: number[] }).children.push(shades);
  (g.nodes[armR] as { children: number[] }).children.push(caseBody, caseHandle, caseClasp);

  addBaseClips(r, 2.9);
  addSocialClips(r);
  // appraise: manos a la espalda, escaneo lento del edificio, asentimientos de tasador (3.6 s)
  const t = loopTimes(3.6, 12);
  const scan = t.map((x) => 0.35 * Math.sin((2 * Math.PI * x) / 3.6));
  const nod = t.map((x) => (x % 1.2 < 0.3 ? 0.1 : 0));
  g.addAnimation('appraise', [
    { node: armL, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, -0.35)) },
    { node: armR, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, -0.35)) },
    { node: headPivot, path: 'rotation', times: t, values: scan.map((y) => quatAxis(0, 1, 0, y)) },
    { node: hips, path: 'rotation', times: t, values: nod.map((z) => quatAxis(0, 0, 1, z)) },
  ]);
  return g.finish('vecinos-gen-fase-e (fondo_buitre v1)');
}

/** Mateo, el Erasmus: sudadera turquesa, gorra rosa, móvil. Clip 'phone' (habla por teléfono). */
function buildInquilino(): Record<string, unknown> {
  const r = buildAdult({ torso: '#46b5c9', pants: '#4a5568', skin: '#c98d5f', shoe: '#e9ecef' });
  const { g, hips, headPivot, armL, armR } = r;
  const mCap = g.addMaterial('gorra', '#ff70a6');
  const mPhone = g.addMaterial('movil', '#22303a', { metallic: 0.3, roughness: 0.4 });
  const meshCap = g.addBoxMesh('gorra', mCap);
  const meshPhone = g.addBoxMesh('movil', mPhone);
  const cap = g.addNode({ name: 'cap', mesh: meshCap, translation: [0.01, 0.3, 0], scale: [0.27, 0.09, 0.27] });
  const visor = g.addNode({ name: 'visor', mesh: meshCap, translation: [0.17, 0.28, 0], scale: [0.12, 0.035, 0.2] });
  const phone = g.addNode({ name: 'phone', mesh: meshPhone, translation: [0.03, -0.41, 0], scale: [0.05, 0.13, 0.04] });
  (g.nodes[headPivot] as { children: number[] }).children.push(cap, visor);
  (g.nodes[armR] as { children: number[] }).children.push(phone);

  addBaseClips(r, 2.5);
  addSocialClips(r);
  // phone: móvil a la oreja, cabeza inclinada, cambia de peso (2.8 s)
  const t = loopTimes(2.8, 10);
  const sway = t.map((x) => 0.06 * Math.sin((2 * Math.PI * x) / 2.8));
  g.addAnimation('phone', [
    { node: armR, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, 1.55)) },
    { node: armL, path: 'rotation', times: t, values: sinKeys(2.8, 0.04, -0.05).v.map((z) => quatAxis(0, 0, 1, z)) },
    { node: headPivot, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, 0.12)) },
    { node: hips, path: 'rotation', times: t, values: sway.map((y) => quatAxis(0, 1, 0, y)) },
  ]);
  return g.finish('vecinos-gen-fase-e (inquilino v1)');
}

/** Nando, el Okupa: cazadora marrón, gorra ámbar, taladro. Clip 'drill' (reforma creativa). */
function buildOkupa(): Record<string, unknown> {
  const r = buildAdult({ torso: '#8d6e63', pants: '#5d4037', skin: '#d9a06b', shoe: '#3e2f28' });
  const { g, hips, headPivot, armL, armR } = r;
  const mCap = g.addMaterial('gorra', '#ffb703');
  const mBelt = g.addMaterial('cinturon', '#4e342e');
  const mDrill = g.addMaterial('taladro', '#ffb703', { metallic: 0.3, roughness: 0.5 });
  const mChuck = g.addMaterial('broca', '#37474f', { metallic: 0.6, roughness: 0.35 });
  const meshCap = g.addBoxMesh('gorra', mCap);
  const meshBelt = g.addBoxMesh('cinturon', mBelt);
  const meshDrill = g.addBoxMesh('taladro', mDrill);
  const meshChuck = g.addBoxMesh('broca', mChuck);
  const cap = g.addNode({ name: 'cap', mesh: meshCap, translation: [0.01, 0.3, 0], scale: [0.27, 0.09, 0.27] });
  const visor = g.addNode({ name: 'visor', mesh: meshCap, translation: [0.17, 0.28, 0], scale: [0.12, 0.035, 0.2] });
  const belt = g.addNode({ name: 'toolbelt', mesh: meshBelt, translation: [0, 0.08, 0], scale: [0.4, 0.09, 0.3] });
  const drillBody = g.addNode({ name: 'drill', mesh: meshDrill, translation: [0.03, -0.44, 0], scale: [0.14, 0.1, 0.1] });
  const drillChuck = g.addNode({ name: 'chuck', mesh: meshChuck, translation: [0.12, -0.44, 0], scale: [0.08, 0.045, 0.045] });
  (g.nodes[headPivot] as { children: number[] }).children.push(cap, visor);
  (g.nodes[hips] as { children: number[] }).children.push(belt);
  (g.nodes[armR] as { children: number[] }).children.push(drillBody, drillChuck);

  addBaseClips(r, 2.4);
  addSocialClips(r);
  // drill: taladra la pared — brazo fijo al frente con vibración rápida, cuerpo apoyado (2.0 s)
  const t = loopTimes(2.0, 24);
  const jitter = t.map((x) => 1.3 + 0.07 * Math.sin((2 * Math.PI * 8 * x) / 2.0));
  g.addAnimation('drill', [
    { node: armR, path: 'rotation', times: t, values: jitter.map((z) => quatAxis(0, 0, 1, z)) },
    { node: armL, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, 0.9)) },
    { node: hips, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, 0.08)) },
    { node: headPivot, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, 0.1)) },
  ]);
  return g.finish('vecinos-gen-fase-e (okupa v1)');
}

/** Rita, la Batería: camiseta terracota, cascos, guitarra a la espalda. Clips 'drums' y 'gig'. */
function buildMusico(): Record<string, unknown> {
  const r = buildAdult({ torso: '#e76f51', pants: '#2a9d8f', skin: '#a9714b', shoe: '#1d3557', torsoScale: [0.35, 0.49, 0.24] });
  const { g, hips, headPivot, armL, armR } = r;
  const mBand = g.addMaterial('diadema', '#232323');
  const mCup = g.addMaterial('auricular', '#264653', { metallic: 0.2, roughness: 0.5 });
  const mGuitar = g.addMaterial('guitarra', '#a3623b', { roughness: 0.6 });
  const mNeck = g.addMaterial('mastil', '#4e342e');
  const meshBand = g.addBoxMesh('diadema', mBand);
  const meshCup = g.addBoxMesh('auricular', mCup);
  const meshGuitar = g.addBoxMesh('guitarra', mGuitar);
  const meshNeck = g.addBoxMesh('mastil', mNeck);
  const band = g.addNode({ name: 'headband', mesh: meshBand, translation: [0, 0.31, 0], scale: [0.05, 0.03, 0.32] });
  const cupL = g.addNode({ name: 'cupL', mesh: meshCup, translation: [0, 0.15, -0.15], scale: [0.1, 0.11, 0.05] });
  const cupR = g.addNode({ name: 'cupR', mesh: meshCup, translation: [0, 0.15, 0.15], scale: [0.1, 0.11, 0.05] });
  const guitarBody = g.addNode({ name: 'guitarBody', mesh: meshGuitar, translation: [-0.22, 0.26, 0], scale: [0.09, 0.3, 0.26] });
  const guitarNeck = g.addNode({ name: 'guitarNeck', mesh: meshNeck, translation: [-0.3, 0.52, 0], scale: [0.04, 0.32, 0.06], rotation: quatAxis(0, 0, 1, 0.3) });
  (g.nodes[headPivot] as { children: number[] }).children.push(band, cupL, cupR);
  (g.nodes[hips] as { children: number[] }).children.push(guitarBody, guitarNeck);

  addBaseClips(r, 2.5);
  addSocialClips(r);
  // drums: baquetas alternas sobre las pads, groove de cabeza (1.2 s)
  {
    const t = loopTimes(1.2, 10);
    const hit = (x: number) => Math.sin((2 * Math.PI * 2 * x) / 1.2);
    g.addAnimation('drums', [
      { node: armL, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 1.25 + 0.35 * hit(x))) },
      { node: armR, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 1.25 - 0.35 * hit(x))) },
      { node: headPivot, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 0.14 * hit(x))) },
      { node: hips, path: 'translation', times: t, values: t.map((x) => [0, 0.52 + 0.02 * Math.abs(hit(x)), 0]) },
    ]);
  }
  // gig: puntea con la guitarra a la espalda… o la imagina; cadera marcando compás (1.6 s)
  {
    const t = loopTimes(1.6, 12);
    const beat = (x: number) => Math.sin((2 * Math.PI * 2 * x) / 1.6);
    g.addAnimation('gig', [
      { node: armR, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 0.75 + 0.3 * beat(x))) },
      { node: armL, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, 1.45)) },
      { node: hips, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 1, 0, 0.18 * beat(x))) },
      { node: headPivot, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 1, 0, 0.1 * beat(x))) },
    ]);
  }
  return g.finish('vecinos-gen-fase-e (musico v1)');
}

/** Pilar, la Pintora: peto teal, boina ámbar, rodillo en la mano. Clip 'paint' (pinta el mural). */
function buildPintora(): Record<string, unknown> {
  const r = buildAdult({ torso: '#2a9d8f', pants: '#264653', skin: '#d9a06b', shoe: '#e9ecef', torsoScale: [0.33, 0.47, 0.24] });
  const { g, hips, headPivot, armL, armR } = r;
  const mCap = g.addMaterial('boina', '#e9c46a');
  const mRoller = g.addMaterial('rodillo', '#eceff1', { roughness: 0.55 });
  const mPaint = g.addMaterial('pintura', '#e76f51', { roughness: 0.7 });
  const mHandle = g.addMaterial('mango', '#4e342e');
  const meshCap = g.addBoxMesh('boina', mCap);
  const meshRoller = g.addBoxMesh('rodillo', mRoller);
  const meshPaint = g.addBoxMesh('pintura', mPaint);
  const meshHandle = g.addBoxMesh('mango', mHandle);
  const beret = g.addNode({ name: 'beret', mesh: meshCap, translation: [0.01, 0.33, 0], scale: [0.24, 0.07, 0.24] });
  const rollerDrum = g.addNode({ name: 'rollerDrum', mesh: meshRoller, translation: [0.1, -0.3, 0.16], scale: [0.09, 0.16, 0.09] });
  const rollerPaint = g.addNode({ name: 'rollerPaint', mesh: meshPaint, translation: [0.1, -0.24, 0.16], scale: [0.1, 0.05, 0.1] });
  const rollerHandle = g.addNode({ name: 'rollerHandle', mesh: meshHandle, translation: [0.06, -0.42, 0.1], scale: [0.03, 0.24, 0.03] });
  (g.nodes[headPivot] as { children: number[] }).children.push(beret);
  (g.nodes[armR] as { children: number[] }).children.push(rollerDrum, rollerPaint, rollerHandle);

  addBaseClips(r, 2.4);
  addSocialClips(r);
  // paint: pasa el rodillo hacia arriba con la mano derecha, escanea la pared con la cabeza (2.4 s)
  const t = loopTimes(2.4, 12);
  const swipe = t.map((x) => (Math.sin((2 * Math.PI * 2 * x) / 2.4) + 1) / 2); // 0..1
  g.addAnimation('paint', [
    { node: armR, path: 'rotation', times: t, values: swipe.map((k) => quatAxis(0, 0, 1, 1.15 + 0.75 * k)) },
    { node: armL, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, -0.3)) },
    { node: headPivot, path: 'rotation', times: t, values: swipe.map((k) => quatAxis(0, 0, 1, 0.12 - 0.2 * k)) },
    { node: hips, path: 'translation', times: t, values: swipe.map((k) => [0, 0.52 + 0.015 * k, 0]) },
  ]);
  return g.finish('vecinos-gen-fase-e (pintora v1)');
}

/** Ray, el Repartidor: chaqueta naranja, gorra oscura, mochila térmica. Clip 'ride' (conduce la moto). */
function buildRepartidor(): Record<string, unknown> {
  const r = buildAdult({ torso: '#f4a261', pants: '#264653', skin: '#c98d5f', shoe: '#2b2b31', torsoScale: [0.36, 0.5, 0.25] });
  const { g, hips, headPivot, armL, armR } = r;
  const mCap = g.addMaterial('gorra', '#264653');
  const mBag = g.addMaterial('mochila', '#b5651d', { roughness: 0.6 });
  const mBagStrap = g.addMaterial('correa', '#5d4037');
  const mPhone = g.addMaterial('movil', '#22303a', { metallic: 0.3, roughness: 0.4 });
  const meshCap = g.addBoxMesh('gorra', mCap);
  const meshBag = g.addBoxMesh('mochila', mBag);
  const meshStrap = g.addBoxMesh('correa', mBagStrap);
  const meshPhone = g.addBoxMesh('movil', mPhone);
  const cap = g.addNode({ name: 'cap', mesh: meshCap, translation: [0.01, 0.3, 0], scale: [0.27, 0.09, 0.27] });
  const visor = g.addNode({ name: 'visor', mesh: meshCap, translation: [0.17, 0.28, 0], scale: [0.12, 0.035, 0.2] });
  const bag = g.addNode({ name: 'thermalBag', mesh: meshBag, translation: [-0.3, 0.24, 0], scale: [0.14, 0.34, 0.34] });
  const bagLid = g.addNode({ name: 'bagLid', mesh: meshStrap, translation: [-0.38, 0.42, 0], scale: [0.03, 0.06, 0.28] });
  const strap = g.addNode({ name: 'strap', mesh: meshStrap, translation: [-0.12, 0.24, 0], scale: [0.03, 0.36, 0.05] });
  const phone = g.addNode({ name: 'phone', mesh: meshPhone, translation: [0.03, -0.41, 0], scale: [0.05, 0.13, 0.04] });
  (g.nodes[headPivot] as { children: number[] }).children.push(cap, visor);
  (g.nodes[hips] as { children: number[] }).children.push(bag, bagLid, strap);
  (g.nodes[armR] as { children: number[] }).children.push(phone);

  addBaseClips(r, 2.3);
  addSocialClips(r);
  // ride: agarra el manillar con los dos brazos al frente, culebreo de moto y cabeza atenta (1.8 s)
  const t = loopTimes(1.8, 12);
  const weave = t.map((x) => 0.09 * Math.sin((2 * Math.PI * 2 * x) / 1.8));
  g.addAnimation('ride', [
    { node: armL, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, 1.0)) },
    { node: armR, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, 1.0)) },
    { node: hips, path: 'translation', times: t, values: t.map((x) => [0, 0.52 + 0.018 * Math.sin((2 * Math.PI * 6 * x) / 1.8), 0]) },
    { node: hips, path: 'rotation', times: t, values: weave.map((y) => quatAxis(0, 1, 0, y)) },
    { node: headPivot, path: 'rotation', times: t, values: weave.map((y) => quatAxis(0, 1, 0, -0.5 * y)) },
  ]);
  return g.finish('vecinos-gen-fase-e (repartidor v1)');
}

// ───────────────────────── Bloques ─────────────────────────
// Convenciones: base y=0, centrado en x/z, frente hacia −Z. Nominal = celda real (el runtime escala).

/** Paseo del pasillo (10 celdas de ancho, canto slab*2): tablero + faldón + listones. Coordenada y=0 = CENTRO del canto. */
function buildPasillo(): Record<string, unknown> {
  const g = new Gltf();
  const mTablero = g.addMaterial('tablero', '#d9c9a3', { roughness: 0.95 });
  const mFaldon = g.addMaterial('faldon', '#c49a6c', { roughness: 0.9 });
  const mListon = g.addMaterial('liston', '#e3d4b0', { roughness: 0.85 });
  g.addNode({ name: 'Root', children: [] });
  box(g, 'tablero', mTablero, [0, 0, 0], [24, 0.14, 1.4]);
  box(g, 'faldon_frontal', mFaldon, [0, -0.17, 0.68], [24, 0.2, 0.07]);
  box(g, 'faldon_trasero', mFaldon, [0, -0.15, -0.68], [24, 0.16, 0.06]);
  box(g, 'liston_frontal', mListon, [0, 0.075, 0.66], [24, 0.035, 0.1]);
  box(g, 'liston_trasero', mListon, [0, 0.075, -0.66], [24, 0.035, 0.1]);
  wireRoot(g);
  return g.finish('vecinos-gen-fase-e (pasillo_planta v1)');
}

/** Garaje (1 celda): puerta basculante con nervios, rótulo y faroles. */
function buildGaraje(): Record<string, unknown> {
  const g = new Gltf();
  const mCuerpo = g.addMaterial('hormigon', '#6d6875', { roughness: 0.95 });
  const mZocalo = g.addMaterial('zocalo', '#575262');
  const mDark = g.addMaterial('hueco', '#343a40');
  const mPuerta = g.addMaterial('puerta', '#9a94a5', { metallic: 0.35, roughness: 0.55 });
  const mRib = g.addMaterial('nervio', '#837d90');
  const mSign = g.addMaterial('rotulo', '#ffd166');
  const mLamp = g.addMaterial('farol', '#fff3d6');
  g.addNode({ name: 'Root', children: [] });
  box(g, 'cuerpo', mCuerpo, [0, 1.23, 0], [2.28, 2.46, 1.4]);
  box(g, 'zocalo', mZocalo, [0, 0.04, 0], [2.32, 0.08, 1.44]);
  box(g, 'hueco', mDark, [0, 0.99, 0.72], [1.94, 1.94, 0.08]);
  // v1.77 — la hoja LLENA el vano del catálogo (locals.garaje.doorW 2.16 × doorH 1.92, v1.37):
  // la vieja 1.86×1.86 (arte original v1.30, cuando la hoja ERA toda la fachada) dejaba 15 cm
  // de hueco por lado y 6 cm arriba/abajo — «la puerta más pequeña que el hueco». Apoyada en
  // el suelo (y 0→1.92) y a ras de jambas. Los faroles suben sobre la hoja: a la altura
  // antigua (y 1.9) quedaban embebidos en las esquinas de la hoja nueva.
  box(g, 'puerta_basculante', mPuerta, [0, 0.96, 0.75], [2.16, 1.92, 0.07]);
  box(g, 'nervio_1', mRib, [0, 0.48, 0.79], [2.16, 0.05, 0.03]);
  box(g, 'nervio_2', mRib, [0, 0.96, 0.79], [2.16, 0.05, 0.03]);
  box(g, 'nervio_3', mRib, [0, 1.44, 0.79], [2.16, 0.05, 0.03]);
  box(g, 'rotulo', mSign, [0, 2.18, 0.75], [1.3, 0.2, 0.06]);
  box(g, 'farol_izq', mLamp, [-0.95, 2.06, 0.78], [0.12, 0.2, 0.1]);
  box(g, 'farol_der', mLamp, [0.95, 2.06, 0.78], [0.12, 0.2, 0.1]);
  wireRoot(g);
  return g.finish('vecinos-gen-fase-e (garaje v1)');
}

/** Trasteros (1 celda): dos persianas con candado, rótulo. */
function buildTrasteros(): Record<string, unknown> {
  const g = new Gltf();
  const mCuerpo = g.addMaterial('ladrillo', '#8a5a3c', { roughness: 0.95 });
  const mZocalo = g.addMaterial('zocalo', '#6f4730');
  const mDark = g.addMaterial('hueco', '#3f2d20');
  const mPersiana = g.addMaterial('persiana', '#b08968', { metallic: 0.25, roughness: 0.6 });
  const mSlat = g.addMaterial('liston', '#9c7b56');
  const mLock = g.addMaterial('candado', '#ffd166', { metallic: 0.5, roughness: 0.4 });
  const mSign = g.addMaterial('rotulo', '#f2e8cf');
  g.addNode({ name: 'Root', children: [] });
  box(g, 'cuerpo', mCuerpo, [0, 1.23, 0], [2.28, 2.46, 1.4]);
  box(g, 'zocalo', mZocalo, [0, 0.04, 0], [2.32, 0.08, 1.44]);
  box(g, 'hueco_izq', mDark, [-0.55, 0.92, 0.72], [0.85, 1.72, 0.08]);
  box(g, 'hueco_der', mDark, [0.55, 0.92, 0.72], [0.85, 1.72, 0.08]);
  box(g, 'persiana_izq', mPersiana, [-0.55, 0.9, 0.75], [0.8, 1.64, 0.07]);
  box(g, 'persiana_der', mPersiana, [0.55, 0.9, 0.75], [0.8, 1.64, 0.07]);
  box(g, 'liston_izq', mSlat, [-0.55, 0.9, 0.79], [0.8, 0.06, 0.03]);
  box(g, 'liston_der', mSlat, [0.55, 0.9, 0.79], [0.8, 0.06, 0.03]);
  box(g, 'candado_izq', mLock, [-0.55, 0.13, 0.79], [0.1, 0.14, 0.06]);
  box(g, 'candado_der', mLock, [0.55, 0.13, 0.79], [0.1, 0.14, 0.06]);
  box(g, 'rotulo', mSign, [0, 2.18, 0.75], [1.1, 0.18, 0.06]);
  wireRoot(g);
  return g.finish('vecinos-gen-fase-e (trasteros v1)');
}

/** El Rincón (local comercial, 2 celdas): cristalera ámbar, puerta de madera, toldo, rótulo y faroles. */
function buildLocal(): Record<string, unknown> {
  const g = new Gltf();
  const mCuerpo = g.addMaterial('fachada', '#5d4037', { roughness: 0.95 });
  const mZocalo = g.addMaterial('zocalo', '#3e2723');
  const mDark = g.addMaterial('hueco', '#2b1b16');
  const mCristal = g.addMaterial('cristal', '#caa472', { metallic: 0.35, roughness: 0.3 });
  const mMarco = g.addMaterial('marco', '#3e2723');
  const mPuerta = g.addMaterial('puerta', '#6d4c41', { roughness: 0.7 });
  const mToldo = g.addMaterial('toldo', '#e07a5f');
  const mSign = g.addMaterial('rotulo', '#ffd166');
  const mLamp = g.addMaterial('farol', '#fff3d6');
  g.addNode({ name: 'Root', children: [] });
  box(g, 'cuerpo', mCuerpo, [0, 1.23, 0], [4.68, 2.46, 1.4]);
  box(g, 'zocalo', mZocalo, [0, 0.04, 0], [4.72, 0.08, 1.44]);
  box(g, 'hueco_vitrina', mDark, [0, 1.05, 0.72], [4.0, 1.66, 0.08]);
  box(g, 'cristal_izq', mCristal, [-1.2, 1.05, 0.75], [1.55, 1.58, 0.06]);
  box(g, 'cristal_der', mCristal, [1.2, 1.05, 0.75], [1.55, 1.58, 0.06]);
  box(g, 'puerta', mPuerta, [0, 1.05, 0.75], [0.72, 1.58, 0.07]);
  box(g, 'montante_izq', mMarco, [-0.4, 1.05, 0.74], [0.08, 1.66, 0.09]);
  box(g, 'montante_der', mMarco, [0.4, 1.05, 0.74], [0.08, 1.66, 0.09]);
  box(g, 'marco_sup', mMarco, [0, 1.92, 0.74], [4.16, 0.08, 0.09]);
  box(g, 'toldo', mToldo, [0, 2.12, 0.95], [4.4, 0.07, 0.75]);
  box(g, 'rotulo', mSign, [0, 2.3, 0.77], [2.3, 0.28, 0.08]);
  box(g, 'farol_izq', mLamp, [-2.05, 1.9, 0.78], [0.12, 0.2, 0.1]);
  box(g, 'farol_der', mLamp, [2.05, 1.9, 0.78], [0.12, 0.2, 0.1]);
  wireRoot(g);
  return g.finish('vecinos-gen-fase-e (local_comercial v1)');
}

/** Lavandería comunal (2 celdas): tres máquinas con portilla, tendal con toallas y tubo de descarga. */
function buildLavanderia(): Record<string, unknown> {
  const g = new Gltf();
  const mCuerpo = g.addMaterial('fachada', '#78a09a', { roughness: 0.95 });
  const mZocalo = g.addMaterial('zocalo', '#5f7f7a');
  const mMaquina = g.addMaterial('lavadora', '#eceff1', { roughness: 0.5 });
  const mPorton = g.addMaterial('portilla', '#37474f', { metallic: 0.4, roughness: 0.35 });
  const mCentro = g.addMaterial('cristal', '#90a4ae', { metallic: 0.4, roughness: 0.3 });
  const mSign = g.addMaterial('rotulo', '#f2e8cf');
  const mTowelA = g.addMaterial('toalla_a', '#e9c46a');
  const mTowelB = g.addMaterial('toalla_b', '#e07a5f');
  const mLine = g.addMaterial('cuerda', '#b0bec5');
  const mPipe = g.addMaterial('tubo', '#78909c', { metallic: 0.5, roughness: 0.45 });
  g.addNode({ name: 'Root', children: [] });
  box(g, 'cuerpo', mCuerpo, [0, 1.23, 0], [4.68, 2.46, 1.4]);
  box(g, 'zocalo', mZocalo, [0, 0.04, 0], [4.72, 0.08, 1.44]);
  box(g, 'maquina_1', mMaquina, [-1.5, 0.62, 0.73], [0.8, 0.95, 0.09]);
  box(g, 'maquina_2', mMaquina, [0, 0.62, 0.73], [0.8, 0.95, 0.09]);
  box(g, 'maquina_3', mMaquina, [1.5, 0.62, 0.73], [0.8, 0.95, 0.09]);
  box(g, 'portilla_1', mPorton, [-1.5, 0.55, 0.78], [0.42, 0.42, 0.05]);
  box(g, 'portilla_2', mPorton, [0, 0.55, 0.78], [0.42, 0.42, 0.05]);
  box(g, 'portilla_3', mPorton, [1.5, 0.55, 0.78], [0.42, 0.42, 0.05]);
  box(g, 'cristal_1', mCentro, [-1.5, 0.55, 0.81], [0.2, 0.2, 0.04]);
  box(g, 'cristal_2', mCentro, [0, 0.55, 0.81], [0.2, 0.2, 0.04]);
  box(g, 'cristal_3', mCentro, [1.5, 0.55, 0.81], [0.2, 0.2, 0.04]);
  box(g, 'rotulo', mSign, [0, 2.2, 0.75], [1.9, 0.22, 0.06]);
  // Tendal y tubo: valores ESPEJADOS en X a propósito — el loader glTF de Babylon voltea X y Z
  // (convención RH→LH, documentada en buildEscalera); autorando ya espejado, el arte aterrice
  // donde fue diseñado: tendal a la derecha del local, tubo de descarga en la esquina izquierda.
  box(g, 'cuerda', mLine, [-0.9, 1.76, 0.8], [1.4, 0.025, 0.02]);
  box(g, 'toalla_a', mTowelA, [-0.55, 1.45, 0.79], [0.45, 0.55, 0.03]);
  box(g, 'toalla_b', mTowelB, [-1.25, 1.45, 0.79], [0.45, 0.55, 0.03]);
  box(g, 'tubo_descarga', mPipe, [2.15, 0.55, 0.5], [0.09, 1.1, 0.09]);
  wireRoot(g);
  return g.finish('vecinos-gen-fase-e (lavanderia_comunal v1)');
}

/** Vivienda estándar — OVERLAY: marco de puerta, dintel, placa, toldito y rodapié sobre el corte interior. */
function buildViviendaOverlay(): Record<string, unknown> {
  const g = new Gltf();
  const mMarco = g.addMaterial('marco', '#efe6d8', { roughness: 0.85 });
  const mPlaca = g.addMaterial('placa', '#e0b34d', { metallic: 0.5, roughness: 0.4 });
  const mToldo = g.addMaterial('toldito', '#e9c46a');
  const mRodapie = g.addMaterial('rodapie', '#d8d2c4', { roughness: 0.9 });
  g.addNode({ name: 'Root', children: [] });
  box(g, 'jamba_izq', mMarco, [-0.68, 1.05, 1.43], [0.12, 2.1, 0.12]);
  box(g, 'jamba_der', mMarco, [0.68, 1.05, 1.43], [0.12, 2.1, 0.12]);
  box(g, 'dintel', mMarco, [0, 2.15, 1.43], [1.48, 0.1, 0.12]);
  box(g, 'placa', mPlaca, [0.55, 2.3, 1.42], [0.28, 0.13, 0.05]);
  box(g, 'toldito', mToldo, [0, 2.26, 1.52], [1.5, 0.05, 0.28]);
  box(g, 'rodapie', mRodapie, [0, 0.07, 1.42], [4.68, 0.14, 0.1]);
  wireRoot(g);
  return g.finish('vecinos-gen-fase-e (vivienda_estandar overlay v1)');
}

// ───────────────────────── Escritura ─────────────────────────

const outDir = resolve(process.cwd(), 'public/assets');
for (const [path, data] of [
  ['actors/jugador_base.gltf', buildJugador()],
  ['actors/presidente.gltf', buildPresidente()],
  ['actors/estudiante.gltf', buildEstudiante()],
  ['actors/fondo_buitre.gltf', buildBuitre()],
  ['actors/inquilino.gltf', buildInquilino()],
  ['actors/okupa.gltf', buildOkupa()],
  ['actors/musico.gltf', buildMusico()],
  ['actors/pintora.gltf', buildPintora()],
  ['actors/repartidor.gltf', buildRepartidor()],
  ['blocks/pasillo_planta.gltf', buildPasillo()],
  ['blocks/garaje.gltf', buildGaraje()],
  ['blocks/trasteros.gltf', buildTrasteros()],
  ['blocks/local_comercial.gltf', buildLocal()],
  ['blocks/lavanderia_comunal.gltf', buildLavanderia()],
  ['blocks/vivienda_estandar.gltf', buildViviendaOverlay()],
] as const) {
  const file = resolve(outDir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  console.log(`✓ ${file}`);
}
console.log('Arte final Fase E generada.');
