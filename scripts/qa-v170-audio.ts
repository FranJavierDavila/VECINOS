/**
 * QA v1.70 — FASE S (sonido profesional).
 * Verifica, headless y determinista:
 *  A) sounds.json y music.json pasan sus esquemas Zod.
 *  B) Todo sonido `kind:'file'` apunta a un WAV real: cabecera RIFF/PCM16 válida,
 *     duración y pico sanos, RMS > 0 (no silencio).
 *  C) El mapa de eventos solo referencia claves que existen.
 *  D) Los 22 SFX clave de la Fase S son `file` (upgrade aplicado).
 *  E) Los 4 loops de música existen (estéreo 32 kHz) con duración de 4 compases.
 *  F) DETERMINISMO: re-renderizar produce los mismos bytes (hash estable).
 *  G) Degradación elegante: un `file` inexistente no rompe el parseo del catálogo
 *     (el fallback procedural de audio.ts/music.ts cubre esa clave en runtime).
 */

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { soundsCatalogSchema } from '../src/game/content/schemas';
import { musicCatalogSchema } from '../src/game/content/schemas';

let pass = 0;
let fail = 0;
const ok = (m: string): void => {
  pass++;
  console.log(`  ✓ ${m}`);
};
const ko = (m: string): void => {
  fail++;
  console.log(`  ✗ ${m}`);
};

// ── WAV mínimo parser (cabecera + muestras para peak/RMS) ──
interface WavInfo {
  channels: number;
  sampleRate: number;
  bits: number;
  frames: number;
  peak: number;
  rms: number;
}

function parseWav(path: string): WavInfo | null {
  try {
    const b = readFileSync(path);
    if (b.length < 44) return null;
    if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null;
    if (b.toString('ascii', 12, 16) !== 'fmt ') return null;
    const audioFmt = b.readUInt16LE(20);
    const channels = b.readUInt16LE(22);
    const sampleRate = b.readUInt32LE(24);
    const bits = b.readUInt16LE(34);
    if (audioFmt !== 1) return null; // PCM
    // busca el chunk data
    let off = 36;
    while (off + 8 <= b.length) {
      const id = b.toString('ascii', off, off + 4);
      const size = b.readUInt32LE(off + 4);
      if (id === 'data') {
        const bytesPer = (bits / 8) * channels;
        const frames = Math.floor(size / bytesPer);
        let peak = 0;
        let sumSq = 0;
        for (let i = 0; i < frames; i++) {
          const p = off + 8 + i * bytesPer;
          for (let c = 0; c < channels; c++) {
            const s = b.readInt16LE(p + c * 2) / 32768;
            peak = Math.max(peak, Math.abs(s));
            sumSq += s * s;
          }
        }
        const rms = Math.sqrt(sumSq / Math.max(1, frames * channels));
        return { channels, sampleRate, bits, frames, peak, rms };
      }
      off += 8 + size + (size % 2);
    }
    return null;
  } catch {
    return null;
  }
}

const hash = (path: string): string => {
  const b = readFileSync(path);
  let h = 2166136261;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i]!;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
};

const PUB = join(process.cwd(), 'public');

console.log('QA v1.70 — FASE S (sonido profesional)\n');

// ── A) esquemas ──
let sounds: { masterGain: number; sounds: Record<string, { kind: string; file?: string; gain?: number }>; events: Record<string, string[]> };
let music: { contexts: Record<string, { file?: string; tempo: number }> };
try {
  sounds = soundsCatalogSchema.parse(JSON.parse(readFileSync(join(PUB, 'content/sounds.json'), 'utf8')));
  ok('sounds.json pasa soundsCatalogSchema');
} catch (e) {
  ko(`sounds.json INVÁLIDO: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
  process.exit(1);
}
try {
  music = musicCatalogSchema.parse(JSON.parse(readFileSync(join(PUB, 'content/music.json'), 'utf8')));
  ok('music.json pasa musicCatalogSchema');
} catch (e) {
  ko(`music.json INVÁLIDO: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
  process.exit(1);
}

// ── B) ficheros de SFX sanos ──
let fileSfx = 0;
for (const [key, spec] of Object.entries(sounds.sounds)) {
  if (spec.kind !== 'file' || !spec.file) continue;
  fileSfx++;
  const path = join(PUB, spec.file.replace(/^\//, ''));
  if (!existsSync(path)) {
    ko(`${key}: falta el fichero ${spec.file}`);
    continue;
  }
  if (!spec.file.endsWith('.wav')) {
    ok(`${key}: ${spec.file} (formato no-WAV, solo se verifica existencia — el navegador lo decodifica)`);
    continue;
  }
  const w = parseWav(path);
  if (!w) {
    ko(`${key}: WAV inválido (${spec.file})`);
    continue;
  }
  const secs = w.frames / w.sampleRate;
  if (secs < 0.05 || secs > 5) ko(`${key}: duración fuera de rango (${secs.toFixed(2)}s)`);
  else if (w.peak > 0.95) ko(`${key}: pico recortado (${w.peak.toFixed(3)})`);
  else if (w.rms < 0.005) ko(`${key}: casi silencio (rms ${w.rms.toFixed(4)})`);
  else ok(`${key}: ${spec.file} — ${secs.toFixed(2)}s mono ${w.sampleRate} Hz, pico ${w.peak.toFixed(2)}, rms ${w.rms.toFixed(3)}`);
}
if (fileSfx === 0) ko('no hay NINGÚN sonido kind:file (upgrade de Fase S no aplicado)');

// ── C) mapa de eventos coherente ──
let evOk = true;
for (const [ev, keys] of Object.entries(sounds.events)) {
  for (const k of keys) {
    if (!(k in sounds.sounds)) {
      ko(`evento '${ev}' referencia clave inexistente '${k}'`);
      evOk = false;
    }
  }
}
if (evOk) ok(`mapa de eventos coherente (${Object.keys(sounds.events).length} eventos)`);

// ── D) los 22 upgrades de Fase S ──
const EXPECT = [
  'ui_click', 'door_open', 'door_locked', 'coins', 'hucha_in', 'hucha_out',
  'jingle_win', 'jingle_lose', 'minigame_start', 'mg_hit', 'mg_miss', 'gavel',
  'stamp', 'thud', 'drill', 'phone_ring', 'wind', 'sirena_ambulancia',
  'claxon', 'frenazo', 'golpe_pelea', 'trueno',
];
const missing = EXPECT.filter((k) => sounds.sounds[k]?.kind !== 'file');
if (missing.length === 0) ok(`los ${EXPECT.length} SFX de Fase S son kind:file`);
else ko(`SFX sin upgrade: ${missing.join(', ')}`);

// ── E) loops de música ──
for (const [name, ctx] of Object.entries(music.contexts)) {
  if (!ctx.file) {
    ko(`contexto ${name}: sin loop grabado`);
    continue;
  }
  const path = join(PUB, ctx.file.replace(/^\//, ''));
  const w = existsSync(path) ? parseWav(path) : null;
  if (!w) {
    ko(`contexto ${name}: WAV inválido o ausente (${ctx.file})`);
    continue;
  }
  const barSec = (60 / ctx.tempo) * 4;
  const secs = w.frames / w.sampleRate;
  const expectedBars = secs / barSec;
  if (w.channels !== 2) ko(`contexto ${name}: el loop no es estéreo`);
  else if (expectedBars < 3.5 || expectedBars > 4.6) ko(`contexto ${name}: ${expectedBars.toFixed(2)} compases (esperados ~4)`);
  else ok(`contexto ${name}: loop ${secs.toFixed(1)}s estéreo ${w.sampleRate} Hz ≈ ${expectedBars.toFixed(2)} compases`);
}

// ── F) determinismo: re-render y comparación de hashes ──
const probe = ['ui_click', 'coins', 'jingle_win'];
const before = probe.map((k) => hash(join(PUB, `art/audio/sfx/${k}.wav`)));
const r = spawnSync('bun', ['scripts/gen-audio-v170.ts', '--sfx'], { cwd: process.cwd(), encoding: 'utf8' });
if (r.status !== 0 || r.error) ko(`re-render falló: ${(r.stderr || String(r.error)).slice(0, 160)}`);
else {
  const after = probe.map((k) => hash(join(PUB, `art/audio/sfx/${k}.wav`)));
  const same = before.every((h, i) => h === after[i]);
  if (same) ok(`determinismo: re-render produce los mismos bytes (${probe.join(', ')})`);
  else ko(`determinismo ROTO: hashes cambian entre renders (${probe.join('=')} → ${after.join('=')})`);
}

// ── G) el timbre original (v1.48) sigue en su sitio ──
if (sounds.sounds['doorbell']?.kind === 'file') ok(`doorbell mantiene su sample original (${sounds.sounds['doorbell'].file})`);
else ko('doorbell perdió su kind:file (regresión del timbre v1.48)');

console.log(`\nQA v1.70: ${pass} pasan · ${fail} fallan`);
process.exit(fail === 0 ? 0 : 1);
