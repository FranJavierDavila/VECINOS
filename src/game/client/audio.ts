'use client';

/**
 * Motor de sonido procedural (Web Audio, cero ficheros de audio).
 * El catálogo vive en /content/sounds.json (sonidos sintetizados + mapa eventos→claves),
 * validado con soundsCatalogSchema. Si el catálogo falla o el navegador no da AudioContext,
 * el juego sigue funcionando en silencio: el audio nunca rompe la partida.
 */

import { soundsCatalogSchema, type SoundsCatalog } from '@/game/content/schemas';
import { loadOptions, saveOptionsPartial } from './options';
import { withBase } from '@/game/support/paths';

const MUTE_KEY = 'vecinos.muted';

// Los tipos se derivan del esquema Zod: única fuente de verdad (los defaults ya vienen resueltos).
type SoundSpec = SoundsCatalog['sounds'][string];
type ToneStep = Extract<SoundSpec, { kind: 'tone' }>;
type NoiseSpec = Extract<SoundSpec, { kind: 'noise' }>; // sonido completo tipo ruido

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let catalog: SoundsCatalog | null = null;
let loading: Promise<void> | null = null;
let muted = false;
/** Volumen maestro del jugador (0..1); multiplica el masterGain del catálogo (pulido Steam). */
let volume = loadOptions().volume;

/** Ganancia efectiva del bus: mando de volumen × masterGain del catálogo (0 si silenciado). */
function effectiveGain(): number {
  const base = catalog?.masterGain ?? 0.4;
  return muted ? 0 : Math.max(0, Math.min(1, volume)) * base;
}

try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  /* sin almacenamiento: parte sin silenciar */
}

/** Desbloquea el AudioContext con el primer gesto del usuario (política de autoplay). */
function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = effectiveGain();
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      return null;
    }
    const unlock = () => void ctx?.resume().catch(() => undefined);
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }
  return ctx;
}

async function loadCatalog(): Promise<void> {
  if (catalog || loading) return;
  loading = (async () => {
    try {
      const res = await fetch(withBase('/content/sounds.json'));
      const parsed = soundsCatalogSchema.safeParse(await res.json());
      if (parsed.success) {
        catalog = parsed.data;
        if (master && ctx) master.gain.value = effectiveGain();
      } else {
        console.warn('sounds.json inválido: el juego corre sin sonido', parsed.error.issues.slice(0, 3));
      }
    } catch {
      /* sin catálogo: silencio funcional */
    }
  })();
  return loading;
}

function tone(step: Omit<ToneStep, 'kind'>, when: number, mul = 1): void {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = step.wave;
  const t0 = when;
  const t1 = t0 + step.durMs / 1000;
  osc.frequency.setValueAtTime(Math.max(20, step.freq), t0);
  if (step.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, step.freqEnd), t1);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(Math.max(0.0001, step.gain * mul), t0 + Math.min(step.attackMs, step.durMs) / 1000);
  g.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t1 + 0.02);
}

function noise(spec: NoiseSpec, when: number, mul = 1): void {
  if (!ctx || !master) return;
  const len = Math.max(1, Math.floor((ctx.sampleRate * spec.durMs) / 1000));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = spec.filterHz;
  const g = ctx.createGain();
  const t0 = when;
  const t1 = t0 + spec.durMs / 1000;
  g.gain.setValueAtTime(Math.max(0.0001, spec.gain * mul), t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t1);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
  src.stop(t1 + 0.02);
}

function playSpec(spec: SoundSpec, mul = 1): void {
  const c = ensureCtx();
  if (!c || muted) return;
  const base = c.currentTime + 0.01;
  if (spec.kind === 'tone') tone(spec, base + spec.atMs / 1000, mul);
  else if (spec.kind === 'noise') noise(spec, base + spec.atMs / 1000, mul);
  // v1.48 — sonido grabado real (timbre de casa, truenos muestreados…): carga perezosa +
  // caché por URL. Si el fichero falla, el audio se queda en silencio sin romper la partida.
  else if (spec.kind === 'file') void playFile(spec, base, mul);
  // Secuencia (v1.22): puede MEZCLAR tonos y ráfagas de ruido (suspiros, motores...).
  else
    for (const step of spec.steps) {
      if ('kind' in step) noise(step, base + step.atMs / 1000, mul);
      else tone(step, base + step.atMs / 1000, mul);
    }
}

/** v1.48 — caché de AudioBuffers por URL (los timbres suenan muchas veces: una sola descarga). */
const fileBuffers = new Map<string, AudioBuffer>();
const fileLoads = new Map<string, Promise<AudioBuffer | null>>();

async function loadAudioFile(url: string): Promise<AudioBuffer | null> {
  const cached = fileBuffers.get(url);
  if (cached) return cached;
  let pending = fileLoads.get(url);
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const raw = await res.arrayBuffer();
        const c = ensureCtx();
        if (!c) return null;
        const buf = await c.decodeAudioData(raw);
        fileBuffers.set(url, buf);
        return buf;
      } catch {
        console.warn(`[audio] no se pudo cargar el sonido grabado: ${url}`);
        return null;
      } finally {
        fileLoads.delete(url);
      }
    })();
    fileLoads.set(url, pending);
  }
  return pending;
}

async function playFile(spec: { file: string; gain: number }, when: number, mul: number): Promise<void> {
  const c = ensureCtx();
  if (!c || !master || muted) return;
  const buf = await loadAudioFile(spec.file);
  if (!buf || !master || muted) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = Math.max(0.0001, spec.gain * mul);
  src.connect(g).connect(master);
  src.start(Math.max(c.currentTime + 0.01, when));
}

/** Reproduce una clave del catálogo (uso directo de la UI: acierto/fallo de minijuego, clics). */
export function playSound(key: string): void {
  playSoundAt(key, 1);
}

/** Reproduce una clave con VOLUMEN RELATIVO (voces de proximidad, motores al pasar). */
export function playSoundAt(key: string, gainMul: number): void {
  const mul = Math.max(0, Math.min(1.4, gainMul));
  if (muted || !catalog) {
    void loadCatalog().then(() => {
      const spec = catalog?.sounds[key];
      if (spec) playSpec(spec, mul);
    });
    return;
  }
  const spec = catalog.sounds[key];
  if (spec) playSpec(spec, mul);
}

/** Sonido por evento del sim: busca "type:subtype" y cae a "type". Nunca lanza. */
export function eventSound(type: string, subtype?: string): void {
  const play = () => {
    if (!catalog) return;
    const keys = (subtype !== undefined ? catalog.events[`${type}:${subtype}`] : undefined) ?? catalog.events[type];
    if (keys) for (const k of keys) playSpec(catalog.sounds[k] ?? { kind: 'tone', wave: 'sine', freq: 440, durMs: 1, gain: 0, attackMs: 1, atMs: 0 });
  };
  if (catalog) play();
  else void loadCatalog().then(play);
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
  try {
    localStorage.setItem(MUTE_KEY, v ? '1' : '0');
  } catch {
    /* preferencia solo en sesión */
  }
  if (master && ctx) master.gain.value = effectiveGain();
}

/** Volumen maestro del jugador (0..1): aplica en vivo y persiste en las opciones. */
export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  saveOptionsPartial({ volume });
  if (master && ctx) master.gain.value = effectiveGain();
}

export function getVolume(): number {
  return volume;
}

/** Precarga temprana del catálogo (el controller la llama al inicializar). */
export function preloadSounds(): void {
  void loadCatalog();
}

/**
 * v1.39 — BUS DE AUDIO para capas de sonido de alto nivel (música procedural).
 * Devuelve el AudioContext y el gain maestro: lo que se conecte aquí hereda VOLUMEN
 * y SILENCIO del jugador sin duplicar preferencias. Null si aún no hay contexto.
 */
export function audioBus(): { ctx: AudioContext; master: GainNode } | null {
  const c = ensureCtx();
  if (!c || !master) return null;
  return { ctx: c, master };
}
