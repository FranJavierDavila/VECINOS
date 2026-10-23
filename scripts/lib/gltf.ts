/**
 * Motor glTF compartido por los generadores de assets (Fase A piloto y Fase E completa).
 *
 * glTF 2.0 con animación POR NODOS (rotación/traslación de la jerarquía, sin skinning):
 * Babylon lo carga con su loader estándar y cada clip se convierte en un AnimationGroup.
 * El buffer binario va embebido como data-URI base64 (un solo fichero .gltf, sin .bin).
 *
 * ⚠️ CONVENCIÓN DE EJES: el loader glTF de Babylon NIEGA la Z (glTF es right-handed,
 * Babylon left-handed). En BLOQUES, el frente hacia la calle/corredor se authora en +Z
 * (aterriza en −Z de mundo). Los ACTORES miran a +X (la X no se toca) y sus props son
 * simétricos en Z, así que no les afecta.
 *
 * Cualquier .glb de artista puede sustituir estos ficheros sin tocar código: el manifiesto
 * public/content/assets.json apunta a las rutas y el runtime escala por dimensiones nominales.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export const srgbToLinear = (c: number) => Math.pow(c / 255, 2.2);
export const colorLinear = (hex: string): [number, number, number, number] => {
  const h = hex.replace('#', '');
  return [srgbToLinear(parseInt(h.slice(0, 2), 16)), srgbToLinear(parseInt(h.slice(2, 4), 16)), srgbToLinear(parseInt(h.slice(4, 6), 16)), 1];
};

/** Cuaternión de rotación alrededor de un eje unitario (ángulo en radianes). */
export const quatAxis = (ax: number, ay: number, az: number, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
};

export class Gltf {
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

// ───────────────────────── Rig de adulto (convenciones verificadas en juego) ─────────────────────────
// Modelo mira a +X, pivote de brazos/piernas con rotación Z = vaivén adelante-atrás/levantar,
// X = lateral; hips bounce en Y. nominalHeight 1.35 m. Los clips usan Z para "levantar brazo"
// (spray/watch/knit/dance) e Y para girar la cabeza — igual que los pilotos.

export interface AdultRig {
  g: Gltf;
  root: number;
  hips: number;
  headPivot: number;
  armL: number;
  armR: number;
  legL: number;
  legR: number;
}

export function buildAdult(opts: {
  torso: string;
  pants: string;
  skin: string;
  shoe: string;
  hipY?: number;
  torsoScale?: [number, number, number];
}): AdultRig {
  const g = new Gltf();
  const mTorso = g.addMaterial('torso', opts.torso);
  const mPants = g.addMaterial('pants', opts.pants);
  const mSkin = g.addMaterial('skin', opts.skin);
  const mShoe = g.addMaterial('shoe', opts.shoe);

  const meshTorso = g.addBoxMesh('torso', mTorso);
  const meshArm = g.addBoxMesh('brazo', mTorso);
  const meshHand = g.addBoxMesh('mano', mSkin);
  const meshPants = g.addBoxMesh('pierna', mPants);
  const meshShoe = g.addBoxMesh('zapato', mShoe);
  const meshHead = g.addBoxMesh('cabeza', mSkin);

  const hipY = opts.hipY ?? 0.52;
  const root = g.addNode({ name: 'Root', children: [] });
  const hips = g.addNode({ name: 'hips', translation: [0, hipY, 0], children: [] });
  const torso = g.addNode({ name: 'torso', mesh: meshTorso, translation: [0, 0.26, 0], scale: opts.torsoScale ?? [0.36, 0.5, 0.24] });
  const headPivot = g.addNode({ name: 'headPivot', translation: [0, 0.54, 0], children: [] });
  const head = g.addNode({ name: 'head', mesh: meshHead, translation: [0, 0.15, 0], scale: [0.25, 0.28, 0.25] });
  const armL = g.addNode({ name: 'armL', translation: [-0.23, 0.44, 0], children: [] });
  const armLMesh = g.addNode({ name: 'armLMesh', mesh: meshArm, translation: [0, -0.17, 0], scale: [0.09, 0.34, 0.11] });
  const handL = g.addNode({ name: 'handL', mesh: meshHand, translation: [0, -0.37, 0], scale: [0.08, 0.09, 0.09] });
  const armR = g.addNode({ name: 'armR', translation: [0.23, 0.44, 0], children: [] });
  const armRMesh = g.addNode({ name: 'armRMesh', mesh: meshArm, translation: [0, -0.17, 0], scale: [0.09, 0.34, 0.11] });
  const handR = g.addNode({ name: 'handR', mesh: meshHand, translation: [0, -0.37, 0], scale: [0.08, 0.09, 0.09] });
  const legL = g.addNode({ name: 'legL', translation: [-0.09, 0.02, 0], children: [] });
  const legLMesh = g.addNode({ name: 'legLMesh', mesh: meshPants, translation: [0, -0.23, 0], scale: [0.11, 0.46, 0.12] });
  const shoeL = g.addNode({ name: 'shoeL', mesh: meshShoe, translation: [0.02, -0.48, 0], scale: [0.13, 0.06, 0.14] });
  const legR = g.addNode({ name: 'legR', translation: [0.09, 0.02, 0], children: [] });
  const legRMesh = g.addNode({ name: 'legRMesh', mesh: meshPants, translation: [0, -0.23, 0], scale: [0.11, 0.46, 0.12] });
  const shoeR = g.addNode({ name: 'shoeR', mesh: meshShoe, translation: [0.02, -0.48, 0], scale: [0.13, 0.06, 0.14] });

  (g.nodes[root] as { children: number[] }).children = [hips];
  (g.nodes[hips] as { children: number[] }).children = [torso, headPivot, armL, armR, legL, legR];
  (g.nodes[headPivot] as { children: number[] }).children = [head];
  (g.nodes[armL] as { children: number[] }).children = [armLMesh, handL];
  (g.nodes[armR] as { children: number[] }).children = [armRMesh, handR];
  (g.nodes[legL] as { children: number[] }).children = [legLMesh, shoeL];
  (g.nodes[legR] as { children: number[] }).children = [legRMesh, shoeR];

  return { g, root, hips, headPivot, armL, armR, legL, legR };
}

export const loopTimes = (T: number, n: number) => Array.from({ length: n + 1 }, (_, i) => (T * i) / n);
export const sinKeys = (T: number, amp: number, base = 0, cycles = 1) => {
  const t = loopTimes(T, 8);
  const v = t.map((x) => base + amp * Math.sin((2 * Math.PI * cycles * x) / T));
  return { t, v };
};

/** idle + walk estándar de adulto sobre el rig; devuelve los nodos para el clip extra. */
export function addBaseClips(r: AdultRig, period = 2.6): void {
  const { g, hips, headPivot, armL, armR, legL, legR } = r;
  const bob = sinKeys(period, 0.012, 0.52);
  const headTilt = sinKeys(period, 0.05);
  const swayL = sinKeys(period, 0.03, 0.05);
  const swayR = sinKeys(period, 0.03, -0.05);
  g.addAnimation('idle', [
    { node: hips, path: 'translation', times: bob.t, values: bob.v.map((y) => [0, y, 0]) },
    { node: headPivot, path: 'rotation', times: headTilt.t, values: headTilt.v.map((z) => quatAxis(0, 0, 1, z)) },
    { node: armL, path: 'rotation', times: swayL.t, values: swayL.v.map((z) => quatAxis(0, 0, 1, z)) },
    { node: armR, path: 'rotation', times: swayR.t, values: swayR.v.map((z) => quatAxis(0, 0, 1, z)) },
  ]);

  const t = loopTimes(0.85, 8);
  const swing = t.map((x) => 0.5 * Math.sin((2 * Math.PI * x) / 0.85));
  const bounce = t.map((x) => 0.52 + 0.016 * Math.abs(Math.sin((2 * Math.PI * 2 * x) / 0.85)));
  g.addAnimation('walk', [
    { node: legL, path: 'rotation', times: t, values: swing.map((s) => quatAxis(1, 0, 0, s)) },
    { node: legR, path: 'rotation', times: t, values: swing.map((s) => quatAxis(1, 0, 0, -s)) },
    { node: armL, path: 'rotation', times: t, values: swing.map((s) => quatAxis(1, 0, 0, -s * 0.75)) },
    { node: armR, path: 'rotation', times: t, values: swing.map((s) => quatAxis(1, 0, 0, s * 0.75)) },
    { node: hips, path: 'translation', times: t, values: bounce.map((y) => [0, y, 0]) },
  ]);
}
