/**
 * v1.47 — ARREGLA LAS PIERNAS "EN TIJERA" (la X del walk/run).
 *
 * Los clips walk/run se authoraron con WALK_AMPLITUDE 0.9 rad (±51.6°) y RUN_AMPLITUDE
 * 1.05 rad (±60°): con el pivote en la cadera y piernas de ~0.48, cada pierna barre
 * MÁS ALLÁ de la vertical contraria y en máxima zancada los pies quedan a 0.24 del suelo
 * (flotando) — en perfil se lee como una X rota. Amplitud humana/cartoon legible:
 * walk ±0.5 rad (±28.6°), run ±0.7 rad (±40.1°).
 *
 * El parche reescala EL ÁNGULO de cada quaternion de rotación (puro eje Z en estos
 * clips: x=y≈0) de los canales legL/legR/armL/armR de walk y run — los brazos bajan con
 * la misma proporción (0.75/0.9 de la pierna). El buffer NO cambia de tamaño: se
 * reescala in-situ y se re-codifica. Los demás clips (sit/talk/fight/spray...) no se
 * tocan: sus ángulos grandes son intencionales (sentarse, gesticular...).
 *
 * CONTRATO anti-patinaje (una sola verdad): v_natural = 2·L·sin(amp)/period.
 *   walk: 2·0.48·sin(0.5)/0.65 ≈ 0.71 m/s  → rules.view.animSync.walkRefSpeed = 0.71
 *   run:  2·0.48·sin(0.7)/0.38 ≈ 1.63 m/s  → rules.view.animSync.runRefSpeed  = 1.63
 * (scripts/lib/gltf.ts se actualiza a la par para futuras regeneraciones.)
 *
 * Uso: bun scripts/fix-walk-amplitude.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'public/assets/actors';

/** Amplitudes NUEVAS (rad) — las viejas se miden del propio clip (robusto a regens). */
const NEW_AMP: Record<string, number> = { walk: 0.5, run: 0.7 };
/** Nodos que oscilan en la zancada (piernas manda, brazos siguen la misma proporción). */
const SWING_NODES = new Set(['legL', 'legR', 'armL', 'armR']);

let patched = 0;

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.gltf'))) {
  const path = join(DIR, file);
  const doc = JSON.parse(readFileSync(path, 'utf8') as string);
  const buf = doc.buffers?.[0];
  if (!buf?.uri?.startsWith('data:')) {
    console.warn(`${file}: sin data URI — omitido`);
    continue;
  }
  let bin = Buffer.from(buf.uri.slice(buf.uri.indexOf(',') + 1), 'base64');
  const nodes: { name?: string }[] = doc.nodes ?? [];
  let fileChanges = 0;

  for (const anim of doc.animations ?? []) {
    const target = NEW_AMP[anim.name ?? ''];
    if (target === undefined) continue;
    // Amplitud VIEJA real: máximo ángulo Z entre los canales de pierna del propio clip.
    let oldAmp = 0;
    for (const ch of anim.channels) {
      if (ch.target?.path !== 'rotation') continue;
      const name = nodes[ch.target.node]?.name ?? '';
      if (name !== 'legL' && name !== 'legR') continue;
      const acc = doc.accessors[anim.samplers?.[ch.sampler]?.output ?? -1];
      if (!acc || acc.type !== 'VEC4') continue;
      const bv = doc.bufferViews[acc.bufferView];
      const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      for (let i = 0; i < acc.count; i++) {
        const [x, y, z, w] = [bin.readFloatLE(off + i * 16), bin.readFloatLE(off + i * 16 + 4), bin.readFloatLE(off + i * 16 + 8), bin.readFloatLE(off + i * 16 + 12)];
        if (Math.abs(x) > 1e-3 || Math.abs(y) > 1e-3) continue; // no es rotación pura Z: no tocar
        oldAmp = Math.max(oldAmp, 2 * Math.atan2(Math.abs(z), w));
      }
    }
    if (oldAmp < 1e-3) continue;
    const ratio = target / oldAmp;
    if (ratio > 0.98 && ratio < 1.02) continue; // ya parcheado
    for (const ch of anim.channels) {
      if (ch.target?.path !== 'rotation') continue;
      const name = nodes[ch.target.node]?.name ?? '';
      if (!SWING_NODES.has(name)) continue;
      const acc = doc.accessors[anim.samplers?.[ch.sampler]?.output ?? -1];
      if (!acc || acc.type !== 'VEC4') continue;
      const bv = doc.bufferViews[acc.bufferView];
      const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      for (let i = 0; i < acc.count; i++) {
        const p = off + i * 16;
        const x = bin.readFloatLE(p);
        const y = bin.readFloatLE(p + 4);
        const z = bin.readFloatLE(p + 8);
        const w = bin.readFloatLE(p + 12);
        if (Math.abs(x) > 1e-3 || Math.abs(y) > 1e-3) continue;
        const theta = 2 * Math.atan2(Math.abs(z), w) * ratio;
        const s = Math.sign(z) || 1;
        bin.writeFloatLE(0, p);
        bin.writeFloatLE(0, p + 4);
        bin.writeFloatLE(s * Math.sin(theta / 2), p + 8);
        bin.writeFloatLE(Math.cos(theta / 2), p + 12);
        fileChanges++;
      }
    }
  }

  if (fileChanges === 0) {
    console.log(`· ${file}: walk/run ya en amplitud correcta`);
    continue;
  }
  buf.uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
  writeFileSync(path, JSON.stringify(doc));
  patched++;
  console.log(`✓ ${file}: ${fileChanges} keyframes reescalados`);
}

console.log(`\nArchivos parcheados: ${patched}`);
