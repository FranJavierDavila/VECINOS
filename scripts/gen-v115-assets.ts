/**
 * Generador de arte final — v1.15 (Contenido F: +2 arquetipos):
 *   electricista (Román, el Mañas) — casco ámbar, taladro, clip de firma 'obra' (taladrando).
 *   sanitaria (Puri) — bata blanca, botiquín, clip de firma 'care' (toma la tensión).
 * Mismas convenciones que Fase E (motor scripts/lib/gltf.ts): modelo mira a +X, zancada
 * sobre Z, clips sociales genéricos incluidos (run/talk/laugh/argue/phone/sit).
 *
 * Ejecutar: bun scripts/gen-v115-assets.ts
 * Los archivos quedan declarados en public/content/assets.json — sustituir por .glb de
 * artista no toca código.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Gltf, quatAxis, loopTimes, sinKeys, buildAdult, addBaseClips, addSocialClips } from './lib/gltf';

/** Cierra el Root (nodo 0) con TODOS los nodos creados después — imposible fallar el recuento. */
function wireRoot(g: Gltf): void {
  (g.nodes[0] as { children: number[] }).children = g.nodes.map((_, i) => i).slice(1);
}

/** Román, el Mañas: chaleco de obra naranja, casco ámbar, taladro en la mano derecha.
 *  Clip 'obra': taladrando — brazo derecho al frente vibrando, izquierdo en cadera,
 *  cadera marcando el empuje y cabeza inclinada hacia "la pared". */
function buildElectricista(): Record<string, unknown> {
  const r = buildAdult({ torso: '#f4a83d', pants: '#4b5563', skin: '#d9a066', shoe: '#2f2a26' });
  const { g, hips, headPivot, armL, armR } = r;
  const mCasco = g.addMaterial('casco', '#ffc107');
  const mTool = g.addMaterial('taldro', '#39424e', { metallic: 0.4, roughness: 0.35 });
  const meshCasco = g.addBoxMesh('casco', mCasco);
  const meshTool = g.addBoxMesh('taldro', mTool);
  const casco = g.addNode({ name: 'casco', mesh: meshCasco, translation: [0.01, 0.36, 0], scale: [0.3, 0.13, 0.3] });
  const ala = g.addNode({ name: 'ala_casco', mesh: meshCasco, translation: [0.02, 0.31, 0], scale: [0.34, 0.03, 0.34] });
  const drill = g.addNode({ name: 'taldro', mesh: meshTool, translation: [0.05, -0.43, 0], scale: [0.07, 0.17, 0.07] });
  const broca = g.addNode({ name: 'broca', mesh: meshTool, translation: [0.05, -0.56, 0], scale: [0.02, 0.1, 0.02] });
  (g.nodes[headPivot] as { children: number[] }).children.push(casco, ala);
  (g.nodes[armR] as { children: number[] }).children.push(drill, broca);

  addBaseClips(r, 2.4);
  addSocialClips(r);
  // obra: taladra (1.8 s) — brazo R al frente (rotZ ~1.35) con vibración rápida, brazo L en cadera,
  // hips empuja hacia delante-abajo y la cabeza mira al punto (rotZ suave, mirada al trabajo).
  const T = 1.8;
  const t = loopTimes(T, 16);
  g.addAnimation('obra', [
    { node: armR, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 1.35 + 0.22 * Math.sin((2 * Math.PI * 5 * x) / T))) },
    { node: armL, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, 0.55)) },
    { node: hips, path: 'translation', times: t, values: t.map((x) => [0.015, 0.5 + 0.01 * Math.sin((2 * Math.PI * 5 * x) / T), 0]) },
    { node: headPivot, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 0.22 + 0.03 * Math.sin((2 * Math.PI * 2 * x) / T))) },
  ]);
  return g.finish('vecinos-gen-v115 (electricista v1)');
}

/** Puri, la Sanitaria: bata blanca, pantalón verde quirófano, moño, botiquín en la mano.
 *  Clip 'care': toma la tensión — brazo derecho extendido al frente (manguito) con
 *  vaivén suave, izquierdo en cadera, cabeza inclinada mirando "la lectura". */
function buildSanitaria(): Record<string, unknown> {
  const r = buildAdult({ torso: '#e9ecef', pants: '#8fae9e', skin: '#e8b98a', shoe: '#cfd8dc' });
  const { g, hips, headPivot, armL, armR } = r;
  const mKit = g.addMaterial('botiquin', '#d9455f');
  const mCross = g.addMaterial('cruz', '#ffffff');
  const mSteto = g.addMaterial('esteto', '#39424e');
  const meshKit = g.addBoxMesh('botiquin', mKit);
  const meshCross = g.addBoxMesh('cruz', mCross);
  const meshSteto = g.addBoxMesh('esteto', mSteto);
  const kit = g.addNode({ name: 'botiquin', mesh: meshKit, translation: [0.04, -0.44, 0], scale: [0.17, 0.13, 0.09] });
  const cruzV = g.addNode({ name: 'cruz_v', mesh: meshCross, translation: [0.04, -0.44, 0.05], scale: [0.03, 0.09, 0.01] });
  const cruzH = g.addNode({ name: 'cruz_h', mesh: meshCross, translation: [0.04, -0.44, 0.05], scale: [0.09, 0.03, 0.01] });
  const steto = g.addNode({ name: 'esteto', mesh: meshSteto, translation: [-0.1, 0.4, 0.02], scale: [0.03, 0.22, 0.03] });
  (g.nodes[armR] as { children: number[] }).children.push(kit, cruzV, cruzH);
  (g.nodes[headPivot] as { children: number[] }).children.push(steto);

  addBaseClips(r, 2.6);
  addSocialClips(r);
  // care: tensión (2.2 s) — brazo R al frente con bombeo lento, brazo L en cadera,
  // hips respira (bob lento) y la cabeza baja a "ver la lectura".
  const T = 2.2;
  const t = loopTimes(T, 12);
  const breathe = sinKeys(T, 0.012, 0.52);
  g.addAnimation('care', [
    { node: armR, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 1.15 + 0.08 * Math.sin((2 * Math.PI * 2 * x) / T))) },
    { node: armL, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, 0.5)) },
    { node: hips, path: 'translation', times: breathe.t, values: breathe.v.map((y) => [0, y, 0]) },
    { node: headPivot, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 0.3 + 0.04 * Math.sin((2 * Math.PI * x) / T))) },
  ]);
  return g.finish('vecinos-gen-v115 (sanitaria v1)');
}

// ───────────────────────── Escritura ─────────────────────────

const outDir = resolve(process.cwd(), 'public/assets');
for (const [path, data] of [
  ['actors/electricista.gltf', buildElectricista()],
  ['actors/sanitaria.gltf', buildSanitaria()],
] as const) {
  const file = resolve(outDir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  console.log(`✓ ${file}`);
}
console.log('Arte final v1.15 generada (2 actores nuevos).');
