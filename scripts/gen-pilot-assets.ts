/**
 * Generador de assets piloto (Fase A del arte final, v0.6):
 *   - public/assets/actors/nino_grafitero.gltf — Pinturillas (jerarquía de nodos + 3 clips: idle/walk/spray)
 *   - public/assets/blocks/nucleo_comunicaciones.gltf — bloque del núcleo con puertas del ascensor
 *
 * glTF 2.0 con animación POR NODOS (rotación/traslación de la jerarquía, sin skinning):
 * Babylon lo carga con su loader estándar y cada clip se convierte en un AnimationGroup.
 * El buffer binario va embebido como data-URI base64 (un solo fichero .gltf, sin .bin).
 *
 * Ejecutar: bun scripts/gen-pilot-assets.ts
 * Cualquier .glb de artista puede sustituir estos ficheros sin tocar código: el manifiesto
 * public/content/assets.json apunta a las rutas y el runtime escala por dimensiones nominales.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// ───────────────────────── Utilidades glTF ─────────────────────────

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

const srgbToLinear = (c: number) => Math.pow(c / 255, 2.2);
const colorLinear = (hex: string): [number, number, number, number] => {
  const h = hex.replace('#', '');
  return [srgbToLinear(parseInt(h.slice(0, 2), 16)), srgbToLinear(parseInt(h.slice(2, 4), 16)), srgbToLinear(parseInt(h.slice(4, 6), 16)), 1];
};

/** Cuaternión de rotación alrededor de un eje unitario (ángulo en radianes). */
const quatAxis = (ax: number, ay: number, az: number, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
};

class Gltf {
  private chunks: Uint8Array[] = [];
  private byteLen = 0;
  bufferViews: { buffer: 0; byteOffset: number; byteLength: number; target?: number }[] = [];
  accessors: Record<string, unknown>[] = [];
  nodes: Record<string, unknown>[] = [];
  meshes: Record<string, unknown>[] = [];
  materials: Record<string, unknown>[] = [];
  animations: Record<string, unknown>[] = [];

  private view(data: ArrayBufferView, target?: number): number {
    // Alineación a 4 bytes (requisito del spec para accessors de float).
    const pad = (4 - (this.byteLen % 4)) % 4;
    if (pad > 0) {
      this.chunks.push(new Uint8Array(pad));
      this.byteLen += pad;
    }
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.chunks.push(bytes);
    this.bufferViews.push({ buffer: 0, byteOffset: this.byteLen, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    this.byteLen += bytes.byteLength;
    return this.bufferViews.length - 1;
  }

  private accessor(viewIdx: number, compType: number, count: number, type: string, minMax?: { min: number[]; max: number[] }): number {
    this.accessors.push({ bufferView: viewIdx, componentType: compType, count, type, ...(minMax ?? {}) });
    return this.accessors.length - 1;
  }

  times(times: number[]): number {
    return this.accessor(this.view(new Float32Array(times)), 5126, times.length, 'SCALAR', {
      min: [Math.min(...times)],
      max: [Math.max(...times)],
    });
  }

  vec3(values: number[][]): number {
    const flat = new Float32Array(values.length * 3);
    values.forEach((v, i) => flat.set(v, i * 3));
    const mins = [0, 1, 2].map((k) => Math.min(...values.map((v) => v[k]!)));
    const maxs = [0, 1, 2].map((k) => Math.max(...values.map((v) => v[k]!)));
    return this.accessor(this.view(flat), 5126, values.length, 'VEC3', { min: mins, max: maxs });
  }

  vec4(values: number[][]): number {
    const flat = new Float32Array(values.length * 4);
    values.forEach((v, i) => flat.set(v, i * 4));
    return this.accessor(this.view(flat), 5126, values.length, 'VEC4', { min: [0, 0, 0, 0], max: [1, 1, 1, 1] });
  }

  /** Cubo unitario (24 vértices con normales por cara, 36 índices). Se reutiliza con node.scale. */
  private static cubeGeometry(): { pos: Float32Array; nor: Float32Array; idx: Uint16Array } {
    // Cara: normal + 4 esquinas (x,y,z con extensión ±0.5) en orden CCW.
    const faces: { n: Vec3; corners: Vec3[] }[] = [
      { n: [1, 0, 0], corners: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
      { n: [-1, 0, 0], corners: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
      { n: [0, 1, 0], corners: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
      { n: [0, -1, 0], corners: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
      { n: [0, 0, 1], corners: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
      { n: [0, 0, -1], corners: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
    ];
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    faces.forEach((f, fi) => {
      const base = fi * 4;
      f.corners.forEach((c) => {
        pos.push(...c);
        nor.push(...f.n);
      });
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint16Array(idx) };
  }

  private cubeAccessors: { pos: number; nor: number; idx: number } | null = null;

  /** Mesh "cubo" con un material; todas las piezas reutilizan estos accessors vía node.scale. */
  addBoxMesh(name: string, materialIdx: number): number {
    if (!this.cubeAccessors) {
      const g = Gltf.cubeGeometry();
      const pv = this.view(g.pos, 34962);
      const nv = this.view(g.nor, 34962);
      const iv = this.view(g.idx, 34963);
      const posMin = [-0.5, -0.5, -0.5];
      const posMax = [0.5, 0.5, 0.5];
      this.cubeAccessors = {
        pos: this.accessor(pv, 5126, 24, 'VEC3', { min: posMin, max: posMax }),
        nor: this.accessor(nv, 5126, 24, 'VEC3', { min: [-1, -1, -1], max: [1, 1, 1] }),
        idx: this.accessor(iv, 5123, 36, 'SCALAR'),
      };
    }
    this.meshes.push({
      name,
      primitives: [{ attributes: { POSITION: this.cubeAccessors.pos, NORMAL: this.cubeAccessors.nor }, indices: this.cubeAccessors.idx, material: materialIdx }],
    });
    return this.meshes.length - 1;
  }

  addMaterial(name: string, hex: string, opts: { metallic?: number; roughness?: number } = {}): number {
    this.materials.push({
      name,
      pbrMetallicRoughness: {
        baseColorFactor: colorLinear(hex),
        metallicFactor: opts.metallic ?? 0,
        roughnessFactor: opts.roughness ?? 0.85,
      },
    });
    return this.materials.length - 1;
  }

  addNode(n: { name: string; mesh?: number; translation?: Vec3; scale?: Vec3; rotation?: Quat; children?: number[] }): number {
    this.nodes.push({ name: n.name, ...(n.mesh !== undefined ? { mesh: n.mesh } : {}), ...(n.translation ? { translation: n.translation } : {}), ...(n.scale ? { scale: n.scale } : {}), ...(n.rotation ? { rotation: n.rotation } : {}), ...(n.children ? { children: n.children } : {}) });
    return this.nodes.length - 1;
  }

  /** Añade una animación: cada canal es { node, path, times, values } (values: VEC3 o VEC4 ya serializados). */
  addAnimation(name: string, channels: { node: number; path: 'translation' | 'rotation'; times: number[]; values: number[][] }[]): void {
    const samplers: { input: number; output: number; interpolation: 'LINEAR' }[] = [];
    const chs: { sampler: number; target: { node: number; path: string } }[] = [];
    for (const c of channels) {
      const input = this.times(c.times);
      const output = c.path === 'rotation' ? this.vec4(c.values) : this.vec3(c.values);
      samplers.push({ input, output, interpolation: 'LINEAR' });
      chs.push({ sampler: samplers.length - 1, target: { node: c.node, path: c.path } });
    }
    this.animations.push({ name, channels: chs, samplers });
  }

  finish(generator: string): Record<string, unknown> {
    const total = new Uint8Array(this.byteLen);
    let off = 0;
    for (const c of this.chunks) {
      total.set(c, off);
      off += c.byteLength;
    }
    const uri = `data:application/octet-stream;base64,${Buffer.from(total).toString('base64')}`;
    return {
      asset: { version: '2.0', generator },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: this.nodes,
      meshes: this.meshes,
      materials: this.materials,
      buffers: [{ uri, byteLength: this.byteLen }],
      bufferViews: this.bufferViews,
      accessors: this.accessors,
      ...(this.animations.length ? { animations: this.animations } : {}),
    };
  }
}

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
  g.addNode({ name: 'hueco_puerta', mesh: mesh('hueco_puerta', mDark), translation: [0, 1.02, -0.72], scale: [1.16, 2.04, 0.08] });
  g.addNode({ name: 'puerta_ascensor_izq', mesh: mesh('izq', mMetal), translation: [-0.29, 0.98, -0.76], scale: [0.54, 1.94, 0.07] });
  g.addNode({ name: 'puerta_ascensor_der', mesh: mesh('der', mMetal), translation: [0.29, 0.98, -0.76], scale: [0.54, 1.94, 0.07] });
  g.addNode({ name: 'marco_izq', mesh: mesh('marco_izq', mFrame), translation: [-0.62, 1.07, -0.74], scale: [0.08, 2.14, 0.09] });
  g.addNode({ name: 'marco_der', mesh: mesh('marco_der', mFrame), translation: [0.62, 1.07, -0.74], scale: [0.08, 2.14, 0.09] });
  g.addNode({ name: 'marco_sup', mesh: mesh('marco_sup', mFrame), translation: [0, 2.12, -0.74], scale: [1.32, 0.08, 0.09] });
  g.addNode({ name: 'rotulo', mesh: mesh('rotulo', mSign), translation: [0, 2.3, -0.75], scale: [0.8, 0.18, 0.06] });
  g.addNode({ name: 'tira_luz', mesh: mesh('tira_luz', mStrip), translation: [0, 2.44, -0.75], scale: [1.7, 0.06, 0.06] });
  g.addNode({ name: 'cubierta', mesh: mesh('cubierta', mRoof), translation: [0, 2.66, 0], scale: [2.52, 0.12, 1.52] });
  g.addNode({ name: 'antena', mesh: mesh('antena', mRoof), translation: [0, 2.98, 0], scale: [0.05, 0.52, 0.05] });
  g.addNode({ name: 'antena_brazo', mesh: mesh('antena_brazo', mRoof), translation: [0, 3.18, 0], scale: [0.44, 0.04, 0.04] });

  return g.finish('vecinos-gen-pilot-assets (nucleo_comunicaciones v1)');
}

// ───────────────────────── Escritura ─────────────────────────

const outDir = resolve(process.cwd(), 'public/assets');
for (const [path, data] of [
  ['actors/nino_grafitero.gltf', buildKid()],
  ['blocks/nucleo_comunicaciones.gltf', buildNucleo()],
] as const) {
  const file = resolve(outDir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  console.log(`✓ ${file}`);
}
console.log('Assets piloto generados.');
