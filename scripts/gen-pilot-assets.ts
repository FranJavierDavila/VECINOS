/**
 * Generador de assets piloto (Fase A del arte final, v0.6; motor extraído a scripts/lib/gltf.ts):
 *   - public/assets/actors/nino_grafitero.gltf — Pinturillas (jerarquía de nodos + 3 clips: idle/walk/spray)
 *   - public/assets/blocks/nucleo_comunicaciones.gltf — bloque del núcleo con puertas del ascensor
 *
 * Ejecutar: bun scripts/gen-pilot-assets.ts
 * Cualquier .glb de artista puede sustituir estos ficheros sin tocar código: el manifiesto
 * public/content/assets.json apunta a las rutas y el runtime escala por dimensiones nominales.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Gltf, quatAxis, sinKeys, loopTimes, buildAdult, addBaseClips, type AdultRig } from './lib/gltf';

// ───────────────────────── Pinturillas (nino_grafitero) ─────────────────────────

function buildKid(): Record<string, unknown> {
  const g = new Gltf();
  const mHoodie = g.addMaterial('hoodie', '#f77f00');
  const mPants = g.addMaterial('pants', '#3a4a5c');
  const mSkin = g.addMaterial('skin', '#f2cc8f');
  const mCap = g.addMaterial('cap', '#e63946');
  const mAccent = g.addMaterial('accent', '#ffd166');
  const mShoe = g.addMaterial('shoe', '#293241');

  const meshHoodie = g.addBoxMesh('torso', mHoodie);
  const meshArm = g.addBoxMesh('brazo', mHoodie);
  const meshHand = g.addBoxMesh('mano', mSkin);
  const meshPants = g.addBoxMesh('pierna', mPants);
  const meshShoe = g.addBoxMesh('zapato', mShoe);
  const meshHead = g.addBoxMesh('cabeza', mSkin);
  const meshCap = g.addBoxMesh('gorra', mCap);
  const meshVisor = g.addBoxMesh('visor', mCap);
  const meshCan = g.addBoxMesh('spray', mAccent);

  // Jerarquía: pies en y=0, altura nominal 1.2 m, mira hacia +X.
  // Root → hips → { torso, headPivot → {head, cap, visor}, armL, armR(+spray), legL, legR }
  const root = g.addNode({ name: 'Root', children: [] });
  const hips = g.addNode({ name: 'hips', translation: [0, 0.45, 0], children: [] });
  const torso = g.addNode({ name: 'torso', mesh: meshHoodie, translation: [0, 0.21, 0], scale: [0.34, 0.42, 0.22] });
  const headPivot = g.addNode({ name: 'headPivot', translation: [0, 0.44, 0], children: [] });
  const head = g.addNode({ name: 'head', mesh: meshHead, translation: [0, 0.13, 0], scale: [0.24, 0.26, 0.24] });
  const cap = g.addNode({ name: 'cap', mesh: meshCap, translation: [0.01, 0.27, 0], scale: [0.27, 0.09, 0.27] });
  const visor = g.addNode({ name: 'visor', mesh: meshVisor, translation: [0.17, 0.25, 0], scale: [0.12, 0.035, 0.2] });
  const armL = g.addNode({ name: 'armL', translation: [-0.21, 0.36, 0], children: [] });
  const armLMesh = g.addNode({ name: 'armLMesh', mesh: meshArm, translation: [0, -0.16, 0], scale: [0.09, 0.32, 0.12] });
  const armR = g.addNode({ name: 'armR', translation: [0.21, 0.36, 0], children: [] });
  const armRMesh = g.addNode({ name: 'armRMesh', mesh: meshArm, translation: [0, -0.16, 0], scale: [0.09, 0.32, 0.12] });
  const can = g.addNode({ name: 'spray_can', mesh: meshCan, translation: [0, -0.37, 0], scale: [0.09, 0.13, 0.09] });
  const legL = g.addNode({ name: 'legL', translation: [-0.08, 0.01, 0], children: [] });
  const legLMesh = g.addNode({ name: 'legLMesh', mesh: meshPants, translation: [0, -0.2, 0], scale: [0.11, 0.4, 0.13] });
  const legR = g.addNode({ name: 'legR', translation: [0.08, 0.01, 0], children: [] });
  const legRMesh = g.addNode({ name: 'legRMesh', mesh: meshPants, translation: [0, -0.2, 0], scale: [0.11, 0.4, 0.13] });
  const shoeL = g.addNode({ name: 'shoeL', mesh: meshShoe, translation: [0.02, -0.43, 0], scale: [0.13, 0.06, 0.14] });
  const shoeR = g.addNode({ name: 'shoeR', mesh: meshShoe, translation: [0.02, -0.43, 0], scale: [0.13, 0.06, 0.14] });

  // Puntas de jerarquía (por índice devuelto, no literal).
  (g.nodes[root] as { children: number[] }).children = [hips];
  (g.nodes[hips] as { children: number[] }).children = [torso, headPivot, armL, armR, legL, legR];
  (g.nodes[headPivot] as { children: number[] }).children = [head, cap, visor];
  (g.nodes[armL] as { children: number[] }).children = [armLMesh];
  (g.nodes[armR] as { children: number[] }).children = [armRMesh, can];
  (g.nodes[legL] as { children: number[] }).children = [legLMesh, shoeL];
  (g.nodes[legR] as { children: number[] }).children = [legRMesh, shoeR];

  const loopTimes = (T: number, n: number) => Array.from({ length: n + 1 }, (_, i) => (T * i) / n);
  const sinKeys = (T: number, amp: number, base = 0, cycles = 1) => {
    const t = loopTimes(T, 8);
    const v = t.map((x) => base + amp * Math.sin((2 * Math.PI * cycles * x) / T));
    return { t, v };
  };

  // ── idle: balanceo sutil (2.4 s) ──
  {
    const bob = sinKeys(2.4, 0.012, 0.45);
    const headTilt = sinKeys(2.4, 0.06);
    const armSwayL = sinKeys(2.4, 0.03, 0.06); // brazo izquierdo algo separado del cuerpo
    const armSwayR = sinKeys(2.4, 0.03, -0.06);
    g.addAnimation('idle', [
      { node: hips, path: 'translation', times: bob.t, values: bob.v.map((y) => [0, y, 0]) },
      { node: headPivot, path: 'rotation', times: headTilt.t, values: headTilt.v.map((z) => quatAxis(0, 0, 1, z)) },
      { node: armL, path: 'rotation', times: armSwayL.t, values: armSwayL.v.map((z) => quatAxis(0, 0, 1, z)) },
      { node: armR, path: 'rotation', times: armSwayR.t, values: armSwayR.v.map((z) => quatAxis(0, 0, 1, z)) },
    ]);
  }

  // ── walk: ciclo de paso (0.8 s) ──
  {
    const t = loopTimes(0.8, 8);
    const swing = t.map((x) => 0.55 * Math.sin((2 * Math.PI * x) / 0.8));
    const bounce = t.map((x) => 0.45 + 0.018 * Math.abs(Math.sin((2 * Math.PI * 2 * x) / 0.8)));
    g.addAnimation('walk', [
      { node: legL, path: 'rotation', times: t, values: swing.map((s) => quatAxis(1, 0, 0, s)) },
      { node: legR, path: 'rotation', times: t, values: swing.map((s) => quatAxis(1, 0, 0, -s)) },
      { node: armL, path: 'rotation', times: t, values: swing.map((s) => quatAxis(1, 0, 0, -s * 0.8)) },
      { node: armR, path: 'rotation', times: t, values: swing.map((s) => quatAxis(1, 0, 0, s * 0.8)) },
      { node: hips, path: 'translation', times: t, values: bounce.map((y) => [0, y, 0]) },
    ]);
  }

  // ── spray: levanta el brazo derecho con la lata y "pinta" (1.6 s) ──
  {
    const t = [0, 0.25, 0.45, 0.8, 1.15, 1.4, 1.6];
    const raise = [0, 1.9, 2.85, 2.72, 2.98, 2.85, 0]; // 0 → arriba (~163°) con vaivén → vuelve
    const shake = [0, 0.05, -0.06, 0.06, -0.06, 0.05, 0];
    const hipSway = sinKeys(1.6, 0.015, 0.45, 2);
    g.addAnimation('spray', [
      { node: armR, path: 'rotation', times: t, values: raise.map((z) => quatAxis(0, 0, 1, z)) },
      { node: armL, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, -0.5)) }, // mano en la cadera
      { node: hips, path: 'rotation', times: t, values: shake.map((y) => quatAxis(0, 1, 0, y)) },
      { node: hips, path: 'translation', times: loopTimes(1.6, 8), values: hipSway.v.map((y) => [0, y, 0]) },
    ]);
  }

  return g.finish('vecinos-gen-pilot-assets (nino_grafitero v1)');
}

// ───────────────────── Núcleo de comunicaciones (bloque) ─────────────────────

function buildNucleo(): Record<string, unknown> {
  const g = new Gltf();
  const mBody = g.addMaterial('hormigon', '#8d99ae', { roughness: 0.95 });
  const mDark = g.addMaterial('hueco', '#343a40');
  const mMetal = g.addMaterial('puerta_ascensor', '#cbd5e1', { metallic: 0.6, roughness: 0.35 });
  const mFrame = g.addMaterial('marco', '#6c757d');
  const mSign = g.addMaterial('rotulo', '#ffd166');
  const mStrip = g.addMaterial('luz', '#e9ecef');
  const mRoof = g.addMaterial('cubierta', '#5c677d');

  const mesh = (name: string, m: number) => g.addBoxMesh(name, m);

  // Cuerpo completo de la celda 2.4 × 2.6 × 1.4 (base en y=0, centrado en x/z).
  const root = g.addNode({ name: 'Root', children: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
  g.addNode({ name: 'cuerpo', mesh: mesh('cuerpo', mBody), translation: [0, 1.3, 0], scale: [2.4, 2.6, 1.4] });
  g.addNode({ name: 'hueco_puerta', mesh: mesh('hueco_puerta', mDark), translation: [0, 1.02, 0.72], scale: [1.16, 2.04, 0.08] });
  g.addNode({ name: 'puerta_ascensor_izq', mesh: mesh('izq', mMetal), translation: [-0.29, 0.98, 0.76], scale: [0.54, 1.94, 0.07] });
  g.addNode({ name: 'puerta_ascensor_der', mesh: mesh('der', mMetal), translation: [0.29, 0.98, 0.76], scale: [0.54, 1.94, 0.07] });
  g.addNode({ name: 'marco_izq', mesh: mesh('marco_izq', mFrame), translation: [-0.62, 1.07, 0.74], scale: [0.08, 2.14, 0.09] });
  g.addNode({ name: 'marco_der', mesh: mesh('marco_der', mFrame), translation: [0.62, 1.07, 0.74], scale: [0.08, 2.14, 0.09] });
  g.addNode({ name: 'marco_sup', mesh: mesh('marco_sup', mFrame), translation: [0, 2.12, 0.74], scale: [1.32, 0.08, 0.09] });
  g.addNode({ name: 'rotulo', mesh: mesh('rotulo', mSign), translation: [0, 2.3, 0.75], scale: [0.8, 0.18, 0.06] });
  g.addNode({ name: 'tira_luz', mesh: mesh('tira_luz', mStrip), translation: [0, 2.44, 0.75], scale: [1.7, 0.06, 0.06] });
  g.addNode({ name: 'cubierta', mesh: mesh('cubierta', mRoof), translation: [0, 2.66, 0], scale: [2.52, 0.12, 1.52] });
  g.addNode({ name: 'antena', mesh: mesh('antena', mRoof), translation: [0, 2.98, 0], scale: [0.05, 0.52, 0.05] });
  g.addNode({ name: 'antena_brazo', mesh: mesh('antena_brazo', mRoof), translation: [0, 3.18, 0], scale: [0.44, 0.04, 0.04] });

  return g.finish('vecinos-gen-pilot-assets (nucleo_comunicaciones v1)');
}

function buildDolores(): Record<string, unknown> {
  const r = buildAdult({ torso: '#b04a7d', pants: '#6d3b56', skin: '#e8b98a', shoe: '#3d2c3a' });
  const { g, hips, headPivot, armL, armR } = r;
  const mHair = g.addMaterial('rodete', '#4a3b45');
  const mGlass = g.addMaterial('prismatico', '#22303a', { metallic: 0.3, roughness: 0.4 });
  const meshHair = g.addBoxMesh('rodete', mHair);
  const meshOpt = g.addBoxMesh('tubo', mGlass);
  const bun = g.addNode({ name: 'bun', mesh: meshHair, translation: [0, 0.34, 0], scale: [0.12, 0.12, 0.12] });
  (g.nodes[headPivot] as { children: number[] }).children.push(bun);
  // Prismáticos colgando del pecho (child de hips, delante): dos tubos + puente.
  const optL = g.addNode({ name: 'optL', mesh: meshOpt, translation: [0.2, 0.18, -0.06], scale: [0.09, 0.12, 0.07] });
  const optR = g.addNode({ name: 'optR', mesh: meshOpt, translation: [0.2, 0.18, 0.06], scale: [0.09, 0.12, 0.07] });
  const optBridge = g.addNode({ name: 'optBridge', mesh: meshOpt, translation: [0.2, 0.2, 0], scale: [0.03, 0.03, 0.08] });
  (g.nodes[hips] as { children: number[] }).children.push(optL, optR, optBridge);

  addBaseClips(r, 2.4);
  // watch: prismáticos a los ojos (brazos al frente con temblor de escaneo) 2.8 s
  const t = loopTimes(2.8, 10);
  const scan = t.map((x) => 1.35 + 0.09 * Math.sin((2 * Math.PI * 2 * x) / 2.8));
  g.addAnimation('watch', [
    { node: armL, path: 'rotation', times: t, values: scan.map((z) => quatAxis(0, 0, 1, z)) },
    { node: armR, path: 'rotation', times: t, values: scan.map((z) => quatAxis(0, 0, 1, z)) },
    { node: headPivot, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 1, 0, 0.35 * Math.sin((2 * Math.PI * x) / 2.8))) },
  ]);
  return g.finish('vecinos-gen-pilot-assets (cotilla v1)');
}

/** Kevin, el Fiestero: camisa hawaiana, gafas de sol. Clip 'dance' (fiesta en casa). */
function buildKevin(): Record<string, unknown> {
  const r = buildAdult({ torso: '#1fa88c', pants: '#e9e2d0', skin: '#c98d5f', shoe: '#22333b', torsoScale: [0.4, 0.5, 0.26] });
  const { g, hips, headPivot, armL, armR, legL, legR } = r;
  const mShades = g.addMaterial('gafas', '#101418', { metallic: 0.4, roughness: 0.3 });
  const mFlower = g.addMaterial('flor', '#ff9f1c');
  const meshShades = g.addBoxMesh('gafas', mShades);
  const meshFlower = g.addBoxMesh('flor', mFlower);
  const shades = g.addNode({ name: 'shades', mesh: meshShades, translation: [0.14, 0.16, 0], scale: [0.06, 0.05, 0.24] });
  const flower = g.addNode({ name: 'flower', mesh: meshFlower, translation: [-0.12, 0.4, 0], scale: [0.07, 0.07, 0.07] });
  (g.nodes[headPivot] as { children: number[] }).children.push(shades);
  (g.nodes[hips] as { children: number[] }).children.push(flower);

  addBaseClips(r, 2.2);
  // dance: twist de caderas, puños arriba alternos, cabeza marcando el compás (1.6 s)
  const t = loopTimes(1.6, 12);
  const beat = (x: number) => Math.sin((2 * Math.PI * 2 * x) / 1.6);
  g.addAnimation('dance', [
    { node: hips, path: 'translation', times: t, values: t.map((x) => [0, 0.52 + 0.05 * Math.abs(beat(x)), 0]) },
    { node: hips, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 1, 0, 0.35 * beat(x))) },
    { node: armL, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 1.9 + 0.55 * beat(x))) },
    { node: armR, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, -1.9 + 0.55 * beat(x))) },
    { node: headPivot, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 0.18 * beat(x))) },
    { node: legL, path: 'rotation', times: t, values: t.map((x) => quatAxis(1, 0, 0, 0.12 * beat(x))) },
    { node: legR, path: 'rotation', times: t, values: t.map((x) => quatAxis(1, 0, 0, -0.12 * beat(x))) },
  ]);
  return g.finish('vecinos-gen-pilot-assets (fiestero v1)');
}

/** Esperanza, la Jubilada: abrigo verde, coleta y carrito de la compra. Clip 'knit' (silla del pasillo). */
function buildEsperanza(): Record<string, unknown> {
  const r = buildAdult({ torso: '#5f7d4f', pants: '#7d6b58', skin: '#e0b48d', shoe: '#4a3f35', torsoScale: [0.34, 0.48, 0.22] });
  const { g, root, headPivot, armL, armR } = r;
  const mHair = g.addMaterial('coleta', '#cfcfcf');
  const mCart = g.addMaterial('carrito', '#a4453b', { metallic: 0.2, roughness: 0.6 });
  const mBag = g.addMaterial('bolsa', '#d9c9a3');
  const meshHair = g.addBoxMesh('coleta', mHair);
  const meshCart = g.addBoxMesh('barra', mCart);
  const meshBag = g.addBoxMesh('bolsa', mBag);
  const tail = g.addNode({ name: 'coleta', mesh: meshHair, translation: [-0.1, 0.3, 0], scale: [0.14, 0.18, 0.14] });
  (g.nodes[headPivot] as { children: number[] }).children.push(tail);
  // Carrito al lado (child del root): dos barras + bolsa + dos ruedas.
  const cartBarL = g.addNode({ name: 'cartBarL', mesh: meshCart, translation: [0.28, 0.45, -0.16], scale: [0.03, 0.9, 0.03] });
  const cartBarR = g.addNode({ name: 'cartBarR', mesh: meshCart, translation: [0.28, 0.45, 0.16], scale: [0.03, 0.9, 0.03] });
  const cartBag = g.addNode({ name: 'cartBag', mesh: meshBag, translation: [0.28, 0.42, 0], scale: [0.24, 0.4, 0.3] });
  const wheelF = g.addNode({ name: 'wheelF', mesh: meshCart, translation: [0.31, 0.04, 0], scale: [0.05, 0.08, 0.08] });
  const wheelB = g.addNode({ name: 'wheelB', mesh: meshCart, translation: [0.12, 0.04, 0], scale: [0.05, 0.08, 0.08] });
  (g.nodes[root] as { children: number[] }).children.push(cartBarL, cartBarR, cartBag, wheelF, wheelB);

  addBaseClips(r, 3.0);
  // knit: teje en la silla — brazos al frente, manos alternando (2.4 s)
  const t = loopTimes(2.4, 10);
  const knitL = t.map((x) => 0.85 + 0.12 * Math.sin((2 * Math.PI * 2 * x) / 2.4));
  const knitR = t.map((x) => 0.85 + 0.12 * Math.sin((2 * Math.PI * 2 * x) / 2.4 + Math.PI));
  g.addAnimation('knit', [
    { node: armL, path: 'rotation', times: t, values: knitL.map((z) => quatAxis(0, 0, 1, z)) },
    { node: armR, path: 'rotation', times: t, values: knitR.map((z) => quatAxis(0, 0, 1, z)) },
    { node: headPivot, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, -0.12)) },
  ]);
  return g.finish('vecinos-gen-pilot-assets (jubilada v1)');
}

// ───────────────────── Fase E-piloto: bloques portal + escaleras ─────────────────────

/** Portal del edificio (2 celdas): doble puerta de cristal, toldo, rótulo, faroles y macetas. */
function buildPortal(): Record<string, unknown> {
  const g = new Gltf();
  const mBody = g.addMaterial('hormigon', '#c9b49a', { roughness: 0.95 });
  const mDark = g.addMaterial('hueco', '#343a40');
  const mGlass = g.addMaterial('cristal', '#a8cbd4', { metallic: 0.25, roughness: 0.3 });
  const mFrame = g.addMaterial('marco', '#6c757d');
  const mAwning = g.addMaterial('toldo', '#e07a5f');
  const mSign = g.addMaterial('rotulo', '#ffd166');
  const mLamp = g.addMaterial('farol', '#fff3d6');
  const mPot = g.addMaterial('maceta', '#b08968');
  const mBush = g.addMaterial('arbusto', '#84a59d');

  const mesh = (name: string, m: number) => g.addBoxMesh(name, m);
  g.addNode({ name: 'Root', children: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] });
  // Nominal 4.68 × 2.46 × 1.4 (w2 · cellH · commonDepth), base y=0. FRENTE = +Z en glTF
  // (el loader de Babylon niega la Z: lo autorado en +z mira a la calle/corredor).
  g.addNode({ name: 'cuerpo', mesh: mesh('cuerpo', mBody), translation: [0, 1.23, 0], scale: [4.68, 2.46, 1.4] });
  g.addNode({ name: 'zocalo', mesh: mesh('zocalo', mFrame), translation: [0, 0.04, 0], scale: [4.72, 0.08, 1.44] });
  g.addNode({ name: 'hueco', mesh: mesh('hueco', mDark), translation: [0, 0.97, 0.72], scale: [2.1, 1.94, 0.08] });
  g.addNode({ name: 'cristal_izq', mesh: mesh('izq', mGlass), translation: [-0.51, 0.97, 0.75], scale: [0.96, 1.86, 0.06] });
  g.addNode({ name: 'cristal_der', mesh: mesh('der', mGlass), translation: [0.51, 0.97, 0.75], scale: [0.96, 1.86, 0.06] });
  g.addNode({ name: 'marco_izq', mesh: mesh('marco_izq', mFrame), translation: [-1.09, 0.99, 0.74], scale: [0.08, 1.98, 0.09] });
  g.addNode({ name: 'marco_der', mesh: mesh('marco_der', mFrame), translation: [1.09, 0.99, 0.74], scale: [0.08, 1.98, 0.09] });
  g.addNode({ name: 'marco_sup', mesh: mesh('marco_sup', mFrame), translation: [0, 2.0, 0.74], scale: [2.26, 0.08, 0.09] });
  g.addNode({ name: 'toldo', mesh: mesh('toldo', mAwning), translation: [0, 2.08, 0.95], scale: [4.4, 0.07, 0.62] });
  g.addNode({ name: 'rotulo', mesh: mesh('rotulo', mSign), translation: [0, 2.32, 0.75], scale: [1.7, 0.2, 0.06] });
  g.addNode({ name: 'farol_izq', mesh: mesh('farol_izq', mLamp), translation: [-1.7, 1.95, 0.78], scale: [0.12, 0.2, 0.1] });
  g.addNode({ name: 'farol_der', mesh: mesh('farol_der', mLamp), translation: [1.7, 1.95, 0.78], scale: [0.12, 0.2, 0.1] });
  g.addNode({ name: 'maceta_izq', mesh: mesh('maceta_izq', mPot), translation: [-2.05, 0.17, 0.88], scale: [0.34, 0.34, 0.3] });
  g.addNode({ name: 'arbusto_izq', mesh: mesh('arbusto_izq', mBush), translation: [-2.05, 0.5, 0.88], scale: [0.3, 0.34, 0.26] });
  g.addNode({ name: 'maceta_der', mesh: mesh('maceta_der', mPot), translation: [2.05, 0.17, 0.88], scale: [0.34, 0.34, 0.3] });
  g.addNode({ name: 'arbusto_der', mesh: mesh('arbusto_der', mBush), translation: [2.05, 0.5, 0.88], scale: [0.3, 0.34, 0.26] });
  return g.finish('vecinos-gen-pilot-assets (portal v1)');
}

/** Caja de escalera (1 celda): portillo abierto con peldaños zigzag visibles, barandilla y rótulo. */
function buildEscalera(): Record<string, unknown> {
  const g = new Gltf();
  const mBody = g.addMaterial('hormigon', '#b8c0a8', { roughness: 0.95 });
  const mDark = g.addMaterial('hueco', '#2f353b');
  const mStep = g.addMaterial('peldano', '#8f9779');
  const mRail = g.addMaterial('barandilla', '#5c677d', { metallic: 0.5, roughness: 0.4 });
  const mSign = g.addMaterial('rotulo', '#f2e8cf');
  const mStrip = g.addMaterial('luz', '#e9ecef');

  const mesh = (name: string, m: number) => g.addBoxMesh(name, m);
  g.addNode({ name: 'Root', children: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
  // Nominal 2.28 × 2.46 × 1.4 (w1 · cellH · commonDepth), base y=0, frente = +Z (ver lib).
  g.addNode({ name: 'cuerpo', mesh: mesh('cuerpo', mBody), translation: [0, 1.23, 0], scale: [2.28, 2.46, 1.4] });
  g.addNode({ name: 'hueco', mesh: mesh('hueco', mDark), translation: [0, 1.02, 0.72], scale: [1.5, 2.04, 0.08] });
  g.addNode({ name: 'peldano_1', mesh: mesh('p1', mStep), translation: [-0.24, 0.36, 0.58], scale: [0.86, 0.15, 0.26] });
  g.addNode({ name: 'peldano_2', mesh: mesh('p2', mStep), translation: [0.26, 0.72, 0.62], scale: [0.86, 0.15, 0.26] });
  g.addNode({ name: 'peldano_3', mesh: mesh('p3', mStep), translation: [-0.24, 1.08, 0.66], scale: [0.86, 0.15, 0.26] });
  g.addNode({ name: 'peldano_4', mesh: mesh('p4', mStep), translation: [0.26, 1.44, 0.58], scale: [0.86, 0.15, 0.26] });
  g.addNode({ name: 'barandilla', mesh: mesh('rail', mRail), translation: [0.34, 1.2, 0.4], scale: [0.05, 0.05, 1.1] });
  g.addNode({ name: 'poste_1', mesh: mesh('poste1', mRail), translation: [0.34, 0.9, 0.72], scale: [0.04, 0.62, 0.04] });
  g.addNode({ name: 'poste_2', mesh: mesh('poste2', mRail), translation: [0.34, 1.42, 0.1], scale: [0.04, 0.5, 0.04] });
  g.addNode({ name: 'rotulo', mesh: mesh('rotulo', mSign), translation: [0, 2.2, 0.75], scale: [0.9, 0.16, 0.05] });
  g.addNode({ name: 'tira_luz', mesh: mesh('tira_luz', mStrip), translation: [0, 2.34, 0.75], scale: [1.2, 0.05, 0.05] });
  g.addNode({ name: 'cubierta', mesh: mesh('cubierta', mBody), translation: [0, 2.5, 0], scale: [2.36, 0.1, 1.48] });
  return g.finish('vecinos-gen-pilot-assets (escaleras_planta v1)');
}

// ───────────────────────── Escritura ─────────────────────────

const outDir = resolve(process.cwd(), 'public/assets');
for (const [path, data] of [
  ['actors/nino_grafitero.gltf', buildKid()],
  ['actors/cotilla.gltf', buildDolores()],
  ['actors/fiestero.gltf', buildKevin()],
  ['actors/jubilada.gltf', buildEsperanza()],
  ['blocks/nucleo_comunicaciones.gltf', buildNucleo()],
  ['blocks/portal.gltf', buildPortal()],
  ['blocks/escaleras_planta.gltf', buildEscalera()],
] as const) {
  const file = resolve(outDir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  console.log(`✓ ${file}`);
}
console.log('Assets piloto generados.');
