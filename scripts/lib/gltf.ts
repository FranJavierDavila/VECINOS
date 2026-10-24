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

  addMaterial(name: string, hex: string, opts: { metallic?: number; roughness?: number; emissive?: string } = {}): number {
    const emissive = opts.emissive
      ? { emissiveFactor: colorLinear(opts.emissive).slice(0, 3) as [number, number, number] }
      : {};
    this.materials.push({
      name,
      pbrMetallicRoughness: {
        baseColorFactor: colorLinear(hex),
        metallicFactor: opts.metallic ?? 0,
        roughnessFactor: opts.roughness ?? 0.85,
      },
      ...emissive,
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

/** idle + walk estándar de adulto sobre el rig; devuelve los nodos para el clip extra.
 *  La zancada rota brazos/piernas sobre Z (el eje perpendicular al plano de la cámara en
 *  vista lateral): el vaivén es adelante-atrás a lo largo de +X (la dirección a la que
 *  mira el modelo), no hacia/alejándose de la cámara. Con la rotación de yaw del runtime
 *  (v1.2), la misma zancada se ve correcta de perfil, de frente y de espaldas.
 *
 *  CONTRATO DE ZANCADA (v1.3, anti-patinaje): el walk se authora con amplitud 0.9 rad y
 *  periodo 0.65 s → velocidad natural ≈ 2·0.48·sin(0.9)/0.65 ≈ 1.15 m/s a ratio 1. El
 *  runtime (rules.view.animSync.walkRefSpeed) escala el playback con la velocidad REAL del
 *  actor: las piernas nunca patinan. Cambiar aquí la amplitud/periodo implica actualizar
 *  walkRefSpeed en el catálogo (una sola verdad). */
export const WALK_AMPLITUDE = 0.9;
export const WALK_PERIOD = 0.65;
/** Velocidad natural del walk (m/s a ratio 1): la que declara rules.view.animSync.walkRefSpeed. */
export const WALK_NATURAL_SPEED = 1.15;
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

  const t = loopTimes(WALK_PERIOD, 8);
  const swing = t.map((x) => WALK_AMPLITUDE * Math.sin((2 * Math.PI * x) / WALK_PERIOD));
  const bounce = t.map((x) => 0.52 + 0.018 * Math.abs(Math.sin((2 * Math.PI * 2 * x) / WALK_PERIOD)));
  g.addAnimation('walk', [
    { node: legL, path: 'rotation', times: t, values: swing.map((s) => quatAxis(0, 0, 1, s)) },
    { node: legR, path: 'rotation', times: t, values: swing.map((s) => quatAxis(0, 0, 1, -s)) },
    { node: armL, path: 'rotation', times: t, values: swing.map((s) => quatAxis(0, 0, 1, -s * 0.75)) },
    { node: armR, path: 'rotation', times: t, values: swing.map((s) => quatAxis(0, 0, 1, s * 0.75)) },
    { node: hips, path: 'translation', times: t, values: bounce.map((y) => [0, y, 0]) },
  ]);
}

// ───────────────── Clips sociales genéricos (v1.2, credibilidad 2.5D) ─────────────────
// Estados que CUALQUIER vecino puede necesitar más allá de su clip de firma:
// run/talk/laugh/argue/phone/sit. El manifiesto los expone por assets.actors[*].stateAnimations
// y el runtime los prioriza: gesto > run > walk > sentado > actividad > idle.
// Mismas convenciones que el resto del catálogo: modelo mira a +X, rotación Z = vaivén
// adelante-atrás (positivo = hacia delante), Y = girar cabeza, hips baja en Y al sentarse.

export interface RigParts {
  g: Gltf;
  hips: number;
  headPivot: number;
  armL: number;
  armR: number;
  legL: number;
  legR: number;
}

/** Zancada del run (CONTRATO v1.3, anti-patinaje): velocidad natural ≈ 2.2 m/s a ratio 1,
 *  la que declara rules.view.animSync.runRefSpeed. Cambiar aquí implica cambiar el catálogo. */
export const RUN_AMPLITUDE = 1.05;
export const RUN_PERIOD = 0.38;
export const RUN_NATURAL_SPEED = 2.2;

/** hipBase del rig: 0.52 adulto, 0.45 niño (define a qué altura cae la cadera al sentarse). */
export function addSocialClips(parts: RigParts, opts: { hipBase?: number } = {}): void {
  const { g, hips, headPivot, armL, armR, legL, legR } = parts;
  const hipBase = opts.hipBase ?? 0.52;

  // run: zancada amplia y rápida (CONTRATO v1.3: velocidad natural ≈ 2.2 m/s a ratio 1 →
  // rules.view.animSync.runRefSpeed; el runtime escala con la velocidad real, sin patinaje).
  {
    const t = loopTimes(RUN_PERIOD, 8);
    const swing = t.map((x) => RUN_AMPLITUDE * Math.sin((2 * Math.PI * x) / RUN_PERIOD));
    const bounce = t.map((x) => hipBase + 0.026 * Math.abs(Math.sin((2 * Math.PI * 2 * x) / RUN_PERIOD)));
    g.addAnimation('run', [
      { node: legL, path: 'rotation', times: t, values: swing.map((s) => quatAxis(0, 0, 1, s)) },
      { node: legR, path: 'rotation', times: t, values: swing.map((s) => quatAxis(0, 0, 1, -s)) },
      { node: armL, path: 'rotation', times: t, values: swing.map((s) => quatAxis(0, 0, 1, s * 0.9)) },
      { node: armR, path: 'rotation', times: t, values: swing.map((s) => quatAxis(0, 0, 1, -s * 0.9)) },
      { node: hips, path: 'translation', times: t, values: bounce.map((y) => [0, y, 0]) },
      { node: hips, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, -0.14)) },
    ]);
  }

  // talk (1.6 s): brazo derecho gesticulando, la cabeza asiente y escanea.
  {
    const t = loopTimes(1.6, 10);
    const gest = t.map((x) => 1.15 + 0.3 * Math.sin((2 * Math.PI * x) / 1.6));
    g.addAnimation('talk', [
      { node: armR, path: 'rotation', times: t, values: gest.map((z) => quatAxis(0, 0, 1, z)) },
      { node: armL, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, -0.25)) },
      { node: headPivot, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 1, 0, 0.22 * Math.sin((2 * Math.PI * 2 * x) / 1.6))) },
      { node: hips, path: 'translation', times: t, values: t.map((x) => [0, hipBase + 0.006 * Math.sin((2 * Math.PI * 2 * x) / 1.6), 0]) },
    ]);
  }

  // laugh (1.4 s): cabeza hacia atrás, hombros y cadera con la risa, mano a la barriga.
  {
    const t = loopTimes(1.4, 10);
    g.addAnimation('laugh', [
      { node: headPivot, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 0.28 + 0.05 * Math.sin((2 * Math.PI * 5 * x) / 1.4))) },
      { node: hips, path: 'translation', times: t, values: t.map((x) => [0, hipBase + 0.016 * Math.abs(Math.sin((2 * Math.PI * 2.5 * x) / 1.4)), 0]) },
      { node: armL, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, -0.55)) },
      { node: armR, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, -0.35 - 0.3 * Math.abs(Math.sin((2 * Math.PI * 2 * x) / 1.4)))) },
    ]);
  }

  // argue (1.8 s): los dos brazos abiertos, la cabeza niega, cuerpo echado adelante.
  {
    const t = loopTimes(1.8, 10);
    const beat = (x: number) => Math.sin((2 * Math.PI * 2 * x) / 1.8);
    g.addAnimation('argue', [
      { node: armL, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, -0.75 + 0.3 * beat(x))) },
      { node: armR, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 0.9 + 0.3 * beat(x))) },
      { node: headPivot, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 1, 0, 0.4 * beat(x))) },
      { node: hips, path: 'translation', times: t, values: t.map(() => [0.03, hipBase - 0.02, 0]) },
      { node: hips, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, -0.08)) },
      { node: legL, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 0.06 * beat(x))) },
      { node: legR, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, -0.06 * beat(x))) },
    ]);
  }

  // phone (2.8 s): mano a la oreja, cabeza ladeada, el peso cambia de pie.
  {
    const t = loopTimes(2.8, 10);
    g.addAnimation('phone', [
      { node: armR, path: 'rotation', times: t, values: t.map((x) => quatAxis(0, 0, 1, 2.25 + 0.05 * Math.sin((2 * Math.PI * 2 * x) / 2.8))) },
      { node: headPivot, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, 0.16)) },
      { node: hips, path: 'translation', times: t, values: t.map((x) => [0, hipBase - 0.012 + 0.004 * Math.sin((2 * Math.PI * x) / 2.8), 0]) },
    ]);
  }

  // sit (3.2 s): la cadera cae, piernas al frente, respiración tranquila de sentado.
  {
    const t = loopTimes(3.2, 10);
    const sitY = hipBase - 0.2;
    g.addAnimation('sit', [
      { node: hips, path: 'translation', times: t, values: t.map((x) => [0, sitY + 0.004 * Math.sin((2 * Math.PI * x) / 3.2), 0]) },
      { node: legL, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, 1.3)) },
      { node: legR, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, 1.3)) },
      { node: armL, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, -0.35)) },
      { node: armR, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, 0.5)) },
      { node: headPivot, path: 'rotation', times: t, values: t.map(() => quatAxis(0, 0, 1, 0.05)) },
    ]);
  }
}
