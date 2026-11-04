/**
 * FASE S (v1.70) — RENDERIZADOR OFFLINE DE SAMPLES.
 * Renderiza los SFX clave del catálogo como WAV 16-bit REALES con DSP enriquecido
 * sobre la síntesis procedural: parciales aditivos/FM (cuerpos metálicos y de madera),
 * transitorios de ruido filtrado, reverb Schroeder, limitador suave y normalización.
 *
 * Por qué renderizar en vez de muestrear externo: determinismo total (PRNG con semilla),
 * cero licencias, cero red, y el catálogo (sounds.json) sigue siendo la única verdad.
 * El motor (audio.ts) ya reproduce `kind:'file'` desde v1.48 con caché y fallback: si un
 * fichero faltara, el juego sigue sonando (procedural) — la ley del proyecto se respeta.
 *
 * Determinista: misma semilla → mismos bytes (verificado en qa-v170-audio.ts).
 *
 * Uso:  bun scripts/gen-audio-v170.ts          (renderiza SFX + loop de música)
 *       bun scripts/gen-audio-v170.ts --sfx    (solo SFX)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ─────────────────────────── Utilidades DSP ───────────────────────────

const SR = 44100; // SFX
const SR_MUSIC = 32000; // loop de música (estéreo, pesa la mitad)
const SEED = 20261102; // semilla fija: renders reproducibles byte a byte

/** PRNG determinista (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midi2freq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

type Wave = 'sine' | 'tri' | 'saw' | 'square';

/** Oscilador de un paso: acumula fase (soporta barrido y vibrato) y escribe con decay exponencial. */
function tone(
  buf: Float32Array,
  t0Sec: number,
  freq: number,
  gain: number,
  durSec: number,
  opts: { wave?: Wave; freqEnd?: number; attackMs?: number; decayPow?: number; vibratoHz?: number; vibratoCents?: number } = {},
): void {
  const wave = opts.wave ?? 'sine';
  const fEnd = opts.freqEnd ?? freq;
  const attackSec = Math.max(0.001, (opts.attackMs ?? 2) / 1000);
  const decayPow = opts.decayPow ?? 3.5;
  const vibHz = opts.vibratoHz ?? 0;
  const vibCents = opts.vibratoCents ?? 0;
  const start = Math.max(0, Math.floor(t0Sec * SR));
  const n = Math.min(buf.length - start, Math.floor(durSec * SR));
  let phase = 0;
  let vibPhase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const k = t / durSec;
    const f = freq * Math.pow(fEnd / freq, k) * (vibHz > 0 ? Math.pow(2, (vibCents / 1200) * Math.sin(2 * Math.PI * vibHz * t)) : 1);
    phase += (2 * Math.PI * f) / SR;
    vibPhase += (2 * Math.PI * vibHz) / SR;
    const p = phase % (2 * Math.PI);
    let s: number;
    if (wave === 'sine') s = Math.sin(p);
    else if (wave === 'tri') s = 2 * Math.abs(2 * (p / (2 * Math.PI)) - 1) - 1;
    else if (wave === 'square') s = p < Math.PI ? 1 : -1;
    else s = 2 * (p / (2 * Math.PI)) - 1;
    const env = Math.min(1, t / attackSec) * Math.pow(1 - k, decayPow);
    buf[start + i] += s * gain * env;
  }
}

/** Golpe de ruido filtrado (transitorio). kind: 'lp' graves, 'hp' brillos, 'bp' bandas. */
function noiseBurst(
  buf: Float32Array,
  t0Sec: number,
  gain: number,
  durSec: number,
  opts: { kind?: 'lp' | 'hp' | 'bp'; hz?: number; q?: number; sweepTo?: number; rand: () => number } ,
): void {
  const kind = opts.kind ?? 'lp';
  const hz0 = opts.hz ?? 1200;
  const hz1 = opts.sweepTo ?? hz0;
  const q = opts.q ?? 1;
  const rand = opts.rand;
  const start = Math.max(0, Math.floor(t0Sec * SR));
  const n = Math.min(buf.length - start, Math.floor(durSec * SR));
  // biquad RBJ bandpass/lowpass/highpass de estado por ráfaga
  let lp1z = 0, lp2z = 0; // one-pole cascada para lp
  let hpX1 = 0, hpY1 = 0;
  let bpX1 = 0, bpX2 = 0, bpY1 = 0, bpY2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const k = t / durSec;
    const hz = hz0 * Math.pow(hz1 / hz0, k);
    const w0 = (2 * Math.PI * Math.min(hz, SR * 0.45)) / SR;
    const env = Math.pow(1 - k, 2.2) * 0.9 + 0.1 * Math.pow(1 - k, 8);
    const x = rand() * 2 - 1;
    let y: number;
    if (kind === 'lp') {
      const a = Math.exp(-w0);
      lp1z = (1 - a) * x + a * lp1z;
      lp2z = (1 - a) * lp1z + a * lp2z;
      y = lp2z * 1.6;
    } else if (kind === 'hp') {
      const a = Math.exp(-w0);
      hpY1 = a * (hpY1 + x - hpX1);
      hpX1 = x;
      y = hpY1 * 1.2;
    } else {
      const bw = Math.max(0.02, q / (hz / (SR / 2) / Math.PI / 2));
      const alpha = Math.sin(w0) / (2 * Math.max(0.2, 1 / Math.max(bw, 0.001)));
      const b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
      y = (b0 * x + b2 * bpX2 - a1 * bpY1 - a2 * bpY2) / a0;
      bpX2 = bpX1; bpX1 = x; bpY2 = bpY1; bpY1 = y;
      y *= 0.8;
    }
    buf[start + i] += y * gain * env;
  }
}

/** Golpe «cuerpo resonante» (madera/cerámica/metal): pila de parciales inarmónicos con decays escalonados. */
function bodyHit(
  buf: Float32Array,
  t0Sec: number,
  base: number,
  gain: number,
  partials: Array<{ ratio: number; g: number; decay: number }>,
  opts: { attackMs?: number; clickGain?: number; rand?: () => number } = {},
): void {
  for (const p of partials) {
    tone(buf, t0Sec, base * p.ratio, gain * p.g, p.decay, { wave: 'sine', attackMs: opts.attackMs ?? 1, decayPow: 4.5 });
  }
  const click = opts.clickGain ?? 0;
  if (click > 0 && opts.rand) noiseBurst(buf, t0Sec, click, 0.012, { kind: 'hp', hz: 2600, rand: opts.rand });
}

/** Reverb Schroeder (4 peines + 2 allpass) — cola suave, sin máquina de internacional. */
function reverb(buf: Float32Array, mix: number, decaySec = 1.1): void {
  const combLens = [1687, 1601, 2053, 2251].map((s) => Math.round((s * SR) / 44100));
  const apLens = [331, 473].map((s) => Math.round((s * SR) / 44100));
  const fb = Math.pow(10, (-3 * decaySec) / (Math.max(...combLens) / SR) / 20); // ~decay exponencial
  const wet = new Float32Array(buf.length);
  for (const len of combLens) {
    const z = new Float32Array(len);
    let idx = 0;
    for (let i = 0; i < buf.length; i++) {
      const y = buf[i] + fb * 0.84 * z[idx];
      z[idx] = y;
      wet[i] += y;
      idx = (idx + 1) % len;
    }
  }
  for (let i = 0; i < wet.length; i++) wet[i] *= 0.25;
  for (const len of apLens) {
    const z = new Float32Array(len);
    let idx = 0;
    let acc = 0;
    for (let i = 0; i < wet.length; i++) {
      const x = wet[i];
      const zy = z[idx];
      const y = -acc + zy;
      z[idx] = x + 0.7 * zy;
      acc = 0.7 * y;
      wet[i] = y;
      idx = (idx + 1) % len;
      void acc;
    }
  }
  for (let i = 0; i < buf.length; i++) buf[i] = buf[i] * (1 - mix) + wet[i] * mix;
}

/** Master: normaliza pico, limita suave y aplica micro-fades anti-click. */
function master(buf: Float32Array, peakTarget = 0.85): void {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  if (peak > 0) {
    const g = peakTarget / peak;
    for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * g * 1.02) * (0.985 / Math.tanh(1.02));
  }
  const fi = Math.floor(SR * 0.002);
  const fo = Math.floor(SR * 0.01);
  for (let i = 0; i < fi; i++) buf[i] *= i / fi;
  for (let i = 0; i < fo; i++) buf[buf.length - 1 - i] *= i / fo;
}

// ─────────────────────────── WAV writer ───────────────────────────

function writeWavMono(path: string, data: Float32Array, sr: number): void {
  const bytes = data.length * 2;
  const h = new ArrayBuffer(44);
  const v = new DataView(h);
  const wstr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  wstr(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  wstr(8, 'WAVE');
  wstr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr(36, 'data');
  v.setUint32(40, bytes, true);
  const out = new Uint8Array(44 + bytes);
  out.set(new Uint8Array(h), 0);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]!));
    dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  writeFileSync(path, out);
}

function writeWavStereo(path: string, l: Float32Array, r: Float32Array, sr: number): void {
  const frames = Math.min(l.length, r.length);
  const bytes = frames * 4;
  const h = new ArrayBuffer(44);
  const v = new DataView(h);
  const wstr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  wstr(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  wstr(8, 'WAVE');
  wstr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true); // stereo
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  wstr(36, 'data');
  v.setUint32(40, bytes, true);
  const out = new Uint8Array(44 + bytes);
  out.set(new Uint8Array(h), 0);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < frames; i++) {
    const ls = Math.max(-1, Math.min(1, l[i]));
    const rs = Math.max(-1, Math.min(1, r[i]));
    dv.setInt16(44 + i * 4, ls < 0 ? ls * 0x8000 : ls * 0x7fff, true);
    dv.setInt16(46 + i * 4, rs < 0 ? rs * 0x8000 : rs * 0x7fff, true);
  }
  writeFileSync(path, out);
}

// ─────────────────────────── Recetas SFX ───────────────────────────
// Cada receta compone en un buffer (dur + cola) con el PRNG inyectado.

interface Recipe {
  dur: number; // segundos de composición (sin cola)
  tail: number; // segundos de cola de reverb
  mix: number; // mezcla de reverb
  render: (buf: Float32Array, rand: () => number) => void;
}

const RECIPES: Record<string, Recipe> = {
  ui_click: {
    dur: 0.09, tail: 0.05, mix: 0.08,
    render: (b, r) => {
      tone(b, 0, 1900, 0.5, 0.03, { wave: 'sine', decayPow: 5 });
      noiseBurst(b, 0, 0.22, 0.018, { kind: 'hp', hz: 4000, rand: r });
      tone(b, 0.012, 950, 0.25, 0.05, { wave: 'sine', decayPow: 4 });
    },
  },
  door_open: {
    dur: 0.5, tail: 0.25, mix: 0.16,
    render: (b, r) => {
      noiseBurst(b, 0, 0.4, 0.02, { kind: 'hp', hz: 2200, rand: r }); // pestillo
      bodyHit(b, 0.004, 110, 0.6, [{ ratio: 1, g: 1, decay: 0.16 }, { ratio: 2.02, g: 0.4, decay: 0.1 }, { ratio: 3.9, g: 0.15, decay: 0.06 }], { clickGain: 0.15, rand: r });
      tone(b, 0.05, 300, 0.12, 0.28, { wave: 'saw', freqEnd: 540, vibratoHz: 11, vibratoCents: 35, decayPow: 1.6 }); // chirrido breve
      bodyHit(b, 0.36, 95, 0.35, [{ ratio: 1, g: 1, decay: 0.1 }], { clickGain: 0.1, rand: r }); // tope suave
    },
  },
  door_locked: {
    dur: 0.42, tail: 0.2, mix: 0.12,
    render: (b, r) => {
      bodyHit(b, 0, 130, 0.7, [{ ratio: 1, g: 1, decay: 0.09 }, { ratio: 2.6, g: 0.3, decay: 0.05 }], { clickGain: 0.3, rand: r });
      bodyHit(b, 0.11, 120, 0.6, [{ ratio: 1, g: 1, decay: 0.08 }, { ratio: 2.4, g: 0.28, decay: 0.05 }], { clickGain: 0.25, rand: r });
      noiseBurst(b, 0.2, 0.3, 0.09, { kind: 'bp', hz: 1900, q: 2.4, rand: r }); // traqueteo del pomo
      noiseBurst(b, 0.3, 0.18, 0.06, { kind: 'bp', hz: 1500, q: 2.8, rand: r });
    },
  },
  coins: {
    dur: 0.85, tail: 0.4, mix: 0.2,
    render: (b, r) => {
      const strikes = [0, 0.07, 0.13, 0.22, 0.31, 0.42, 0.55];
      for (let i = 0; i < strikes.length; i++) {
        const t = strikes[i]! + r() * 0.01;
        const det = 1 + (r() - 0.5) * 0.04;
        const g = 0.5 - i * 0.045;
        bodyHit(b, t, 2400 * det, g, [
          { ratio: 1, g: 1, decay: 0.14 + r() * 0.1 },
          { ratio: 1.51, g: 0.55, decay: 0.11 },
          { ratio: 2.26, g: 0.34, decay: 0.08 },
          { ratio: 3.42, g: 0.2, decay: 0.06 },
        ], { clickGain: 0.12, rand: r });
      }
      noiseBurst(b, 0.1, 0.08, 0.5, { kind: 'hp', hz: 7000, rand: r }); // brillo metálico
    },
  },
  hucha_in: {
    dur: 0.55, tail: 0.3, mix: 0.18,
    render: (b, r) => {
      bodyHit(b, 0.02, 2500, 0.42, [{ ratio: 1, g: 1, decay: 0.12 }, { ratio: 1.62, g: 0.4, decay: 0.08 }], { clickGain: 0.1, rand: r });
      bodyHit(b, 0.05, 760, 0.5, [{ ratio: 1, g: 1, decay: 0.2 }, { ratio: 1.83, g: 0.35, decay: 0.12 }], {}); // cuerpo cerámico
      bodyHit(b, 0.17, 2100 * (1 + (r() - 0.5) * 0.05), 0.22, [{ ratio: 1, g: 1, decay: 0.09 }], { clickGain: 0.06, rand: r }); // rebote
      bodyHit(b, 0.19, 700, 0.28, [{ ratio: 1, g: 1, decay: 0.12 }], {});
    },
  },
  hucha_out: {
    dur: 0.7, tail: 0.3, mix: 0.15,
    render: (b, r) => {
      tone(b, 0, 190, 0.16, 0.3, { wave: 'saw', freqEnd: 135, vibratoHz: 9, vibratoCents: 25, decayPow: 1.4 }); // tapa
      noiseBurst(b, 0.18, 0.24, 0.3, { kind: 'lp', hz: 1400, sweepTo: 700, rand: r }); // monedas deslizándose
      bodyHit(b, 0.42, 2300, 0.2, [{ ratio: 1, g: 1, decay: 0.1 }, { ratio: 1.55, g: 0.4, decay: 0.07 }], { clickGain: 0.08, rand: r });
      bodyHit(b, 0.5, 800, 0.24, [{ ratio: 1, g: 1, decay: 0.12 }], {});
    },
  },
  jingle_win: {
    dur: 1.35, tail: 0.7, mix: 0.34,
    render: (b, r) => {
      const notes = [72, 76, 79, 84]; // C5 E5 G5 C6
      const times = [0, 0.11, 0.22, 0.34];
      for (let i = 0; i < notes.length; i++) {
        const f = midi2freq(notes[i]!);
        const t = times[i]!;
        const g = i === notes.length - 1 ? 0.5 : 0.34;
        tone(b, t, f, g, 0.75, { wave: 'sine', decayPow: 3.2 });
        tone(b, t, f * 2.76, g * 0.24, 0.4, { wave: 'sine', decayPow: 4.5 }); // parcial de campana
        tone(b, t, f * 5.4, g * 0.1, 0.2, { wave: 'sine', decayPow: 5 });
        tone(b, t + 0.06, f * 2, g * 0.3, 0.5, { wave: 'sine', decayPow: 3.6 }); // octava de apoyo
        noiseBurst(b, t, 0.06, 0.09, { kind: 'hp', hz: 6500, rand: r }); // chispa
      }
      tone(b, 0.34, midi2freq(84) / 2, 0.22, 1.0, { wave: 'tri', decayPow: 2.4 }); // cuerpo cálido
    },
  },
  jingle_lose: {
    dur: 1.15, tail: 0.5, mix: 0.26,
    render: (b) => {
      const notes = [64, 60, 57, 53]; // E4 C4 A3 F3
      const times = [0, 0.15, 0.3, 0.46];
      for (let i = 0; i < notes.length; i++) {
        const f = midi2freq(notes[i]!);
        const t = times[i]!;
        tone(b, t, f * 1.004, 0.3, 0.5, { wave: 'tri', decayPow: 2.6 });
        tone(b, t, f * 0.996, 0.22, 0.45, { wave: 'tri', decayPow: 2.8 }); // batido triste
      }
      tone(b, 0.46, midi2freq(41), 0.2, 0.65, { wave: 'sine', decayPow: 2 }); // F2 grave
    },
  },
  minigame_start: {
    dur: 0.45, tail: 0.2, mix: 0.14,
    render: (b, r) => {
      noiseBurst(b, 0, 0.34, 0.22, { kind: 'bp', hz: 500, sweepTo: 3400, q: 1.4, rand: r }); // whoosh
      tone(b, 0.24, 660, 0.34, 0.14, { wave: 'tri', decayPow: 3 });
      tone(b, 0.26, 1320, 0.16, 0.1, { wave: 'sine', decayPow: 4 });
    },
  },
  mg_hit: {
    dur: 0.28, tail: 0.12, mix: 0.1,
    render: (b) => {
      tone(b, 0, 880, 0.44, 0.16, { wave: 'tri', decayPow: 4 });
      tone(b, 0, 1760, 0.18, 0.09, { wave: 'sine', decayPow: 5 });
      bodyHit(b, 0.004, 440, 0.24, [{ ratio: 1, g: 1, decay: 0.12 }, { ratio: 2.01, g: 0.3, decay: 0.07 }], {});
    },
  },
  mg_miss: {
    dur: 0.38, tail: 0.14, mix: 0.1,
    render: (b, r) => {
      tone(b, 0, 165, 0.5, 0.24, { wave: 'sine', freqEnd: 118, decayPow: 2.4 });
      noiseBurst(b, 0, 0.2, 0.07, { kind: 'lp', hz: 340, rand: r });
      tone(b, 0.02, 233, 0.14, 0.2, { wave: 'tri', decayPow: 3 }); // si bemol apagado
    },
  },
  gavel: {
    dur: 0.75, tail: 0.45, mix: 0.24,
    render: (b, r) => {
      const knock = (t: number, g: number): void => {
        bodyHit(b, t, 170, g, [{ ratio: 1, g: 1, decay: 0.14 }, { ratio: 2.9, g: 0.3, decay: 0.06 }, { ratio: 4.7, g: 0.14, decay: 0.04 }], { clickGain: 0.3, rand: r });
        bodyHit(b, t, 92, g * 0.8, [{ ratio: 1, g: 1, decay: 0.2 }], {}); // tabla
      };
      knock(0, 0.6);
      knock(0.13, 0.45);
    },
  },
  stamp: {
    dur: 0.3, tail: 0.12, mix: 0.1,
    render: (b, r) => {
      noiseBurst(b, 0, 0.5, 0.05, { kind: 'lp', hz: 900, rand: r });
      bodyHit(b, 0, 140, 0.42, [{ ratio: 1, g: 1, decay: 0.1 }], { clickGain: 0.1, rand: r });
      noiseBurst(b, 0.06, 0.14, 0.08, { kind: 'hp', hz: 3200, rand: r }); // papel
    },
  },
  thud: {
    dur: 0.42, tail: 0.2, mix: 0.14,
    render: (b, r) => {
      tone(b, 0, 72, 0.75, 0.28, { wave: 'sine', freqEnd: 52, decayPow: 2.2 });
      noiseBurst(b, 0, 0.3, 0.025, { kind: 'lp', hz: 260, rand: r });
      bodyHit(b, 0.005, 180, 0.2, [{ ratio: 1, g: 1, decay: 0.09 }], {});
    },
  },
  drill: {
    dur: 1.05, tail: 0.3, mix: 0.12,
    render: (b, r) => {
      tone(b, 0, 96, 0.3, 0.9, { wave: 'saw', vibratoHz: 27, vibratoCents: 55, decayPow: 0.6 }); // motor AM
      tone(b, 0, 192, 0.14, 0.9, { wave: 'square', vibratoHz: 27, vibratoCents: 55, decayPow: 0.6 });
      noiseBurst(b, 0.02, 0.2, 0.85, { kind: 'bp', hz: 2400, q: 1.8, rand: r }); // broca
      noiseBurst(b, 0.95, 0.4, 0.08, { kind: 'lp', hz: 500, rand: r }); // apagado
    },
  },
  phone_ring: {
    dur: 1.35, tail: 0.3, mix: 0.16,
    render: (b) => {
      const ring = (t: number): void => {
        for (let i = 0; i < 20; i++) {
          const tt = t + i * 0.02;
          const gate = 0.55;
          if (i % 10 < 5) {
            tone(b, tt, 440, 0.16 * gate, 0.021, { wave: 'sine', decayPow: 0.2 });
            tone(b, tt, 480, 0.16 * gate, 0.021, { wave: 'sine', decayPow: 0.2 });
          }
        }
      };
      ring(0);
      ring(0.65);
    },
  },
  wind: {
    dur: 2.4, tail: 0.6, mix: 0.2,
    render: (b, r) => {
      noiseBurst(b, 0, 0.4, 2.2, { kind: 'lp', hz: 420, sweepTo: 780, rand: r });
      noiseBurst(b, 0.3, 0.16, 1.8, { kind: 'bp', hz: 900, sweepTo: 500, q: 1.2, rand: r });
      tone(b, 0.2, 90, 0.05, 2.0, { wave: 'sine', vibratoHz: 0.7, vibratoCents: 40, decayPow: 0.4 }); //(OS) gravedad
    },
  },
  sirena_ambulancia: {
    dur: 2.3, tail: 0.5, mix: 0.22,
    render: (b) => {
      for (let c = 0; c < 3; c++) {
        const t = c * 0.72;
        tone(b, t, 610, 0.3, 0.36, { wave: 'sine', freqEnd: 940, decayPow: 0.4 });
        tone(b, t + 0.36, 940, 0.3, 0.36, { wave: 'sine', freqEnd: 610, decayPow: 0.4 });
        tone(b, t, 1220, 0.05, 0.72, { wave: 'sine', decayPow: 0.4 }); // armónico
      }
    },
  },
  claxon: {
    dur: 0.62, tail: 0.25, mix: 0.16,
    render: (b) => {
      tone(b, 0, 370, 0.3, 0.45, { wave: 'saw', decayPow: 1.2 });
      tone(b, 0, 466, 0.3, 0.45, { wave: 'saw', decayPow: 1.2 });
      tone(b, 0, 932, 0.07, 0.45, { wave: 'square', decayPow: 1.2 });
      tone(b, 0.47, 350, 0.2, 0.12, { wave: 'saw', decayPow: 2 }); // suelta
    },
  },
  frenazo: {
    dur: 0.95, tail: 0.3, mix: 0.18,
    render: (b, r) => {
      noiseBurst(b, 0, 0.42, 0.7, { kind: 'bp', hz: 1750, sweepTo: 950, q: 3.2, rand: r }); // chirrido
      noiseBurst(b, 0, 0.12, 0.7, { kind: 'hp', hz: 4200, rand: r });
      tone(b, 0.72, 85, 0.5, 0.2, { wave: 'sine', freqEnd: 60, decayPow: 2 }); // tope
      noiseBurst(b, 0.72, 0.24, 0.04, { kind: 'lp', hz: 320, rand: r });
    },
  },
  golpe_pelea: {
    dur: 0.36, tail: 0.16, mix: 0.12,
    render: (b, r) => {
      noiseBurst(b, 0, 0.55, 0.035, { kind: 'lp', hz: 520, rand: r });
      tone(b, 0, 95, 0.6, 0.18, { wave: 'sine', freqEnd: 62, decayPow: 2.4 });
      noiseBurst(b, 0.004, 0.2, 0.02, { kind: 'hp', hz: 2400, rand: r }); // bofetada
    },
  },
  trueno: {
    dur: 2.9, tail: 0.9, mix: 0.3,
    render: (b, r) => {
      noiseBurst(b, 0, 0.5, 0.03, { kind: 'hp', hz: 1500, rand: r }); // crac
      noiseBurst(b, 0.01, 0.6, 1.8, { kind: 'lp', hz: 180, sweepTo: 70, rand: r }); // retumbo
      noiseBurst(b, 0.4, 0.3, 1.6, { kind: 'lp', hz: 120, sweepTo: 60, rand: r });
      tone(b, 0.05, 48, 0.25, 2.2, { wave: 'sine', decayPow: 0.8 }); // subsuelo
    },
  },
};

// ─────────────────────────── Loop de música (por contexto) ───────────────────────────
// Compone un loop de 4 compases con las REGLAS del catálogo music.json (el contexto que
// se pida: morning/afternoon/evening/night): tempo, tónica, escala, acordes y ganancias
// por capa. El final se PLIEGA sobre el principio (foldback) → loop perfecto sin costuras.

function renderContextLoop(ctxName: string): { l: Float32Array; r: Float32Array; sr: number } {
  const catalog = JSON.parse(readFileSync(join(process.cwd(), 'public/content/music.json'), 'utf8')) as {
    contexts: Record<string, { tempo: number; root: number; scale: number[]; chords: number[][]; bassGain: number; padGain: number; leadGain: number; leadDensity: number }>;
  };
  const ctx = catalog.contexts[ctxName]!;
  const bpm = ctx.tempo;
  const barSec = (60 / bpm) * 4;
  const bars = 4;
  const loopSec = barSec * bars;
  const tailSec = Math.min(1.2, barSec * 0.45);
  const sr = SR_MUSIC;
  const total = Math.ceil((loopSec + tailSec) * sr);
  const bl = new Float32Array(total);
  const br = new Float32Array(total);
  const rand = mulberry32(SEED ^ 0x5eed);

  const addStereo = (t: number, write: (b: Float32Array) => void, pan: number): void => {
    const tmp = new Float32Array(total);
    write(tmp);
    // pan simple: copia con recorte de borde
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    const start = Math.max(0, Math.floor(t * sr));
    for (let i = 0; start + i < total && i < tmp.length; i++) {
      bl[start + i] += tmp[i]! * gl;
      br[start + i] += tmp[i]! * gr;
    }
  };

  for (let bar = 0; bar < bars; bar++) {
    const tBar = bar * barSec;
    const chord = ctx.chords[bar % ctx.chords.length]!;
    // BAJO: raíz del acorde, octava baja, una nota por compás + anticipación en el 3.5
    const bassMidi = ctx.root - 12 + chord[0]!;
    addStereo(tBar, (b) => tone(b, 0, midi2freq(bassMidi), ctx.bassGain, barSec * 0.95, { wave: 'sine', attackMs: 12, decayPow: 0.8 }), -0.15);
    addStereo(tBar + barSec * 0.75, (b) => tone(b, 0, midi2freq(bassMidi + (rand() < 0.5 ? 7 : 12)), ctx.bassGain * 0.6, barSec * 0.22, { wave: 'sine', attackMs: 8, decayPow: 2 }), -0.1);
    // PAD: tríada sostenida (desafinado ±4 cents L/R vía pan por nota)
    chord.forEach((iv, vi) => {
      const m = ctx.root + iv + (vi === 2 ? 12 : 0);
      addStereo(tBar, (b) => tone(b, 0, midi2freq(m) * 1.001, ctx.padGain, barSec * 1.05, { wave: 'tri', attackMs: 320, decayPow: 0.5 }), vi === 0 ? -0.5 : vi === 1 ? 0.4 : 0.15);
      addStereo(tBar, (b) => tone(b, 0, midi2freq(m) * 0.999, ctx.padGain * 0.8, barSec * 1.05, { wave: 'tri', attackMs: 320, decayPow: 0.5 }), vi === 0 ? -0.2 : vi === 1 ? 0.55 : -0.45);
    });
    // MELODÍA: improvisación determinista sobre la escala (densidad del catálogo)
    const slots = 8;
    for (let s = 0; s < slots; s++) {
      if (rand() < ctx.leadDensity) {
        const deg = Math.floor(rand() * ctx.scale.length);
        const oct = rand() < 0.25 ? 12 : 0;
        const m = ctx.root + 12 + ctx.scale[deg]! + oct;
        addStereo(tBar + (s * barSec) / slots, (b) => tone(b, 0, midi2freq(m), ctx.leadGain, barSec / slots * 1.6, { wave: 'tri', attackMs: 14, decayPow: 2.2, vibratoHz: 5.2, vibratoCents: 14 }), 0.2);
      }
    }
    // PERCUSIÓN suave: kicks 1/3 y hats en corcheas
    addStereo(tBar, (b) => tone(b, 0, 58, 0.24, 0.16, { wave: 'sine', freqEnd: 40, decayPow: 2.6 }), 0);
    addStereo(tBar + barSec / 2, (b) => tone(b, 0, 58, 0.18, 0.14, { wave: 'sine', freqEnd: 40, decayPow: 2.6 }), 0);
    for (let s = 0; s < 8; s++) {
      const g = s % 2 === 0 ? 0.045 : 0.028;
      addStereo(tBar + (s * barSec) / 8, (b) => noiseBurst(b, 0, g, 0.03, { kind: 'hp', hz: 8000, rand }), 0);
    }
  }

  // Reverb estéreo ligera + pliegue de la cola sobre el inicio (loop perfecto)
  const tailN = Math.floor(tailSec * sr);
  const loopN = Math.floor(loopSec * sr);
  reverb(bl, 0.18, 1.4);
  reverb(br, 0.18, 1.4);
  for (let i = 0; i < tailN; i++) {
    bl[i] += bl[loopN + i]!;
    br[i] += br[loopN + i]!;
  }
  const L = bl.slice(0, loopN);
  const R = br.slice(0, loopN);
  // normalización por canal con limitador suave
  const norm = (x: Float32Array): void => {
    let p = 0;
    for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]!));
    if (p > 0) {
      const g = 0.82 / p;
      for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i]! * g);
    }
  };
  norm(L);
  norm(R);
  return { l: L, r: R, sr };
}

// ─────────────────────────── Main ───────────────────────────

function main(): void {
  const onlySfx = process.argv.includes('--sfx');
  const outDir = join(process.cwd(), 'public/art/audio/sfx');
  mkdirSync(outDir, { recursive: true });

  console.log(`FASE S — renderizando ${Object.keys(RECIPES).length} SFX a ${outDir}`);
  let totalBytes = 0;
  for (const [key, recipe] of Object.entries(RECIPES)) {
    const rand = mulberry32(SEED ^ (key.length * 7919 + key.charCodeAt(0)));
    const buf = new Float32Array(Math.ceil((recipe.dur + recipe.tail) * SR));
    recipe.render(buf, rand);
    reverb(buf, recipe.mix, 0.9 + recipe.tail);
    master(buf);
    const path = join(outDir, `${key}.wav`);
    writeWavMono(path, buf, SR);
    const size = buf.length * 2 + 44;
    totalBytes += size;
    console.log(`  ✓ ${key.padEnd(18)} ${(recipe.dur + recipe.tail).toFixed(2)}s  ${(size / 1024).toFixed(0)} KB`);
  }
  console.log(`SFX total: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

  if (!onlySfx) {
    const musicDir = join(process.cwd(), 'public/art/audio/music');
    mkdirSync(musicDir, { recursive: true });
    for (const ctxName of ['morning', 'afternoon', 'evening', 'night']) {
      const res = renderContextLoop(ctxName);
      const path = join(musicDir, `loop_${ctxName}.wav`);
      writeWavStereo(path, res.l, res.r, res.sr);
      const bytes = 44 + res.l.length * 4;
      console.log(`  ✓ loop ${ctxName.padEnd(9)} (4 compases) ${(res.l.length / res.sr).toFixed(1)}s estéreo 32 kHz — ${(bytes / 1024 / 1024).toFixed(2)} MB`);
    }
  }
  console.log('Listo: samples deterministas en public/art/audio/.');
}

main();
