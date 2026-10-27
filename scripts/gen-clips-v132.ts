/**
 * v1.32 «el vecindario respira» — clips NUEVOS de vida social para TODOS los actores:
 *  · fight — reyerta cartoon: jabs alternos con guardia, torso que acompaña y rebote.
 *  · hurt  — herido en el suelo: tumbado de espaldas (caída hacia atrás), piernas y
 *            brazos desparramados, respiración sutil (bucle).
 * Los rigs son los del catálogo (Root → hips → torso/cabeza/brazos/piernas; el cuerpo
 * mira a +X; los brazos cuelgan −Y y el swing va en el eje Z — misma convención que el
 * clip 'argue' existente, verificado con sus keyframes). El buffer es base64 inline:
 * se decodifica, se AÑADEN los samplers nuevos al final (nada existente se toca) y se
 * vuelve a codificar. Idempotente: si el clip ya existe, se deja como está.
 *
 * Uso: bun scripts/gen-clips-v132.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'public/assets/actors';

/** Clave cuaternión (x,y,z,w) a partir de ángulos de Euler XYZ (radianes). */
const quat = (x: number, y: number, z: number): number[] => {
  const cx = Math.cos(x / 2);
  const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2);
  const sz = Math.sin(z / 2);
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
};

interface ChannelSpec {
  node: string;
  path: 'rotation' | 'translation';
  /** frames: [t, valores] — rotation en Euler XYZ, translation en XYZ. */
  frames: [number, number[]][];
}

// ── FIGHT: jab derecho → cross izquierdo → guardia (0.9 s, bucle) ─────────────────
const fightT = [0, 0.12, 0.22, 0.34, 0.46, 0.58, 0.68, 0.78, 0.9];
const fight: ChannelSpec[] = [
  {
    node: 'armR',
    path: 'rotation',
    frames: fightT.map((t, i) => {
      const z = [0.55, 0.9, 1.5, 0.8, 0.5, 0.62, 0.55, 0.58, 0.55][i]!;
      const x = [0, 0.1, 0.18, 0.08, 0, -0.06, 0, 0.03, 0][i]!;
      return [t, quat(x, 0, z)];
    }),
  },
  {
    node: 'armL',
    path: 'rotation',
    frames: fightT.map((t, i) => {
      const z = [-0.55, -0.5, -0.42, -0.5, -0.95, -1.42, -0.7, -0.58, -0.55][i]!;
      const x = [0, -0.06, 0, 0.06, 0.12, 0.2, 0.06, 0, 0][i]!;
      return [t, quat(x, 0, z)];
    }),
  },
  {
    node: 'hips',
    path: 'rotation',
    frames: fightT.map((t, i) => {
      const z = [0.06, 0.1, 0.16, 0.08, 0.04, -0.12, -0.06, 0.02, 0.06][i]!;
      return [t, quat(0, 0, z)];
    }),
  },
  {
    node: 'hips',
    path: 'translation',
    frames: fightT.map((t, i) => {
      const y = [0.5, 0.48, 0.46, 0.49, 0.5, 0.47, 0.49, 0.5, 0.5][i]!;
      return [t, [0.03, y, 0]];
    }),
  },
  {
    node: 'headPivot',
    path: 'rotation',
    frames: fightT.map((t, i) => {
      const y = [0, 0.1, 0.16, 0.08, 0, -0.14, -0.08, -0.02, 0][i]!;
      return [t, quat(0, y, 0)];
    }),
  },
  {
    node: 'legL',
    path: 'rotation',
    frames: fightT.map((t, i) => {
      const z = [0.2, 0.22, 0.24, 0.22, 0.2, 0.24, 0.22, 0.2, 0.2][i]!;
      return [t, quat(0, 0, z)];
    }),
  },
  {
    node: 'legR',
    path: 'rotation',
    frames: fightT.map((t, i) => {
      const z = [-0.16, -0.18, -0.2, -0.18, -0.16, -0.2, -0.18, -0.16, -0.16][i]!;
      return [t, quat(0, 0, z)];
    }),
  },
];

// ── HURT: tumbado de espaldas (2.2 s, bucle con respiración) ────────────────────────
// La caída: hips gira ~+80° en Z (la cabeza va a −X: de espaldas, pies hacia el morro)
// y BAJA a y 0.17 (el cuerpo descansa sobre el suelo, no flota). El bucle respira.
const hurtT = [0, 0.5, 1.1, 1.65, 2.2];
const hurt: ChannelSpec[] = [
  {
    node: 'hips',
    path: 'rotation',
    frames: hurtT.map((t, i) => {
      const z = [1.4, 1.42, 1.38, 1.42, 1.4][i]!;
      return [t, quat(0, 0, z)];
    }),
  },
  {
    node: 'hips',
    path: 'translation',
    frames: hurtT.map((t, i) => {
      const y = [0.17, 0.175, 0.17, 0.175, 0.17][i]!;
      return [t, [0.04, y, 0]];
    }),
  },
  {
    node: 'armR',
    path: 'rotation',
    frames: hurtT.map((t, i) => {
      const z = [2.3, 2.34, 2.26, 2.33, 2.3][i]!;
      return [t, quat(0, 0, z)];
    }),
  },
  {
    node: 'armL',
    path: 'rotation',
    frames: hurtT.map((t, i) => {
      const z = [-0.75, -0.78, -0.72, -0.77, -0.75][i]!;
      return [t, quat(0, 0, z)];
    }),
  },
  {
    node: 'legL',
    path: 'rotation',
    frames: hurtT.map((t, i) => {
      const z = [-0.28, -0.26, -0.3, -0.27, -0.28][i]!;
      return [t, quat(0, 0, z)];
    }),
  },
  {
    node: 'legR',
    path: 'rotation',
    frames: hurtT.map((t, i) => {
      const z = [0.34, 0.32, 0.36, 0.33, 0.34][i]!;
      return [t, quat(0, 0, z)];
    }),
  },
  {
    node: 'headPivot',
    path: 'rotation',
    frames: hurtT.map((t, i) => {
      const y = [0.3, 0.24, 0.3, 0.36, 0.3][i]!;
      return [t, quat(0, y, 0)];
    }),
  },
];

let totalNew = 0;
let skipped = 0;

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.gltf'))) {
  const path = join(DIR, file);
  const doc = JSON.parse(readFileSync(path, 'utf8') as string);
  doc.animations ??= [];
  const have = new Set((doc.animations as { name?: string }[]).map((a) => a.name));
  const pending: { name: string; spec: ChannelSpec[] }[] = [];
  if (!have.has('fight')) pending.push({ name: 'fight', spec: fight });
  if (!have.has('hurt')) pending.push({ name: 'hurt', spec: hurt });
  if (pending.length === 0) {
    skipped++;
    continue;
  }
  const nodes = doc.nodes as { name?: string }[];
  const nodeIndex = new Map<string, number>();
  nodes.forEach((n, i) => nodeIndex.set(n.name ?? `#${i}`, i));

  // Buffer actual (data URI base64).
  const buf = doc.buffers[0];
  if (!buf.uri || !buf.uri.startsWith('data:')) {
    console.warn(`${file}: buffer sin data URI — se omite`);
    skipped++;
    continue;
  }
  let bin = Buffer.from(buf.uri.slice(buf.uri.indexOf(',') + 1), 'base64');

  for (const { name, spec } of pending) {
    let offset = bin.length;
    const pad = (4 - (offset % 4)) % 4;
    if (pad > 0) {
      bin = Buffer.concat([bin, Buffer.alloc(pad)]);
      offset += pad;
    }
    const channels: unknown[] = [];
    const samplers: unknown[] = [];
    for (const ch of spec) {
      const ni = nodeIndex.get(ch.node);
      if (ni === undefined) {
        console.warn(`${file}: nodo '${ch.node}' no existe — canal omitido`);
        continue;
      }
      // Sampler: tiempos (SCALAR) + valores (VEC4 rotation / VEC3 translation).
      const n = ch.frames.length;
      const times = new Float32Array(n);
      const vals = new Float32Array(n * (ch.path === 'rotation' ? 4 : 3));
      ch.frames.forEach(([t, v], i) => {
        times[i] = t;
        if (ch.path === 'rotation') {
          vals.set([v[0]!, v[1]!, v[2]!, v[3]!], i * 4);
        } else {
          vals.set([v[0]!, v[1]!, v[2]!], i * 3);
        }
      });
      const timeOff = offset;
      bin = Buffer.concat([bin, Buffer.from(times.buffer)]);
      offset += times.byteLength;
      const valOff = offset;
      bin = Buffer.concat([bin, Buffer.from(vals.buffer)]);
      offset += vals.byteLength;
      const bvTime = (doc.bufferViews as unknown[]).push({
        buffer: 0,
        byteOffset: timeOff,
        byteLength: times.byteLength,
      }) - 1;
      const bvVal = (doc.bufferViews as unknown[]).push({
        buffer: 0,
        byteOffset: valOff,
        byteLength: vals.byteLength,
      }) - 1;
      const accTime = (doc.accessors as unknown[]).push({
        bufferView: bvTime,
        componentType: 5126,
        count: n,
        type: 'SCALAR',
        min: [times[0]],
        max: [times[n - 1]],
      }) - 1;
      const accVal = (doc.accessors as unknown[]).push({
        bufferView: bvVal,
        componentType: 5126,
        count: n,
        type: ch.path === 'rotation' ? 'VEC4' : 'VEC3',
      }) - 1;
      samplers.push({ input: accTime, output: accVal, interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: ni, path: ch.path } });
    }
    (doc.animations as unknown[]).push({ name, channels, samplers });
    totalNew++;
  }

  buf.byteLength = bin.length;
  buf.uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
  writeFileSync(path, JSON.stringify(doc));
  console.log(`✓ ${file}: +${pending.map((p) => p.name).join(', +')}`);
}

console.log(`\nClips añadidos: ${totalNew} · archivos ya completos: ${skipped}`);
