'use client';

/**
 * MÚSICA PROCEDURAL (v1.39) — banda sonora generativa 100% Web Audio, sin ficheros.
 * El catálogo (public/content/music.json) define un CONTEXTO MUSICAL por franja horaria
 * (mañana/tarde/evening/noche: tempo, tónica, escala, acordes, ganancias por capa) y una
 * CAPA DE LLUVIA (ruido filtrado en bucle, más presente con tormenta). El director agenda
 * compases por adelantado: bajo en la tónica del acorde, pad sostenido y melodía que
 * improvisa sobre la escala con la densidad del contexto. Presentación pura: el sim no
 * sabe que suena música, y sin catálogo (o sin AudioContext) la partida funciona igual.
 *
 * El bus de música cuelga del BUS MAESTRO de audio.ts: hereda volumen y silencio del
 * jugador, y añade el suyo propio (opción «Música»). Con pausa o modal hace DUCKING.
 */

import type { MusicCatalog } from '@/game/core/types';
import { audioBus } from './audio';

export interface MusicDirector {
  /** Estado del mundo → franja horaria, lluvia y ducking (pausa/modal). Cadencia interna. */
  update(minute: number, weather: string, ducked: boolean): void;
  /** Opción «Música» del menú de opciones (persistida; el director solo obedece). */
  setEnabled(v: boolean): void;
  /** Foto de estado para QA/E2E (dev). */
  state(): { enabled: boolean; context: string; started: boolean };
  dispose(): void;
}

type CtxName = 'morning' | 'afternoon' | 'evening' | 'night';

const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

export function createMusicDirector(catalog: MusicCatalog): MusicDirector {
  const parts = catalog.dayParts;
  let enabled = true;
  let disposed = false;

  // ── Contexto vigente y pendiente (el cambio se aplica en el borde de compás) ──
  let currentCtx: CtxName = 'morning';
  let pendingCtx: CtxName | null = null;
  let chordIdx = 0;
  let nextBarTime = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastWeather = '';

  // ── Grafo de audio (se construye en cuanto exista el bus de audio.ts) ──
  let ctx: AudioContext | null = null;
  let bus: GainNode | null = null;
  let rainGain: GainNode | null = null;
  let rainSource: AudioBufferSourceNode | null = null;

  // ── v1.70 — LOOPS GRABADOS por contexto (si el catálogo declara `file`) ──
  // Carga perezosa + caché; si el fichero falla se cachea null y ese contexto suena
  // con la síntesis de v1.39 (la partida NUNCA se rompe por audio). El cambio de
  // contexto hace cross-fade en el borde de compás (como la síntesis).
  const loopBuffers = new Map<CtxName, AudioBuffer | null>();
  const loopTried = new Set<CtxName>();
  let loopSrc: AudioBufferSourceNode | null = null;
  let loopGain: GainNode | null = null;
  let loopCtx: CtxName | null = null;

  const loadLoop = async (name: CtxName): Promise<AudioBuffer | null> => {
    if (loopTried.has(name)) return loopBuffers.get(name) ?? null;
    loopTried.add(name);
    const file = catalog.contexts[name]?.file;
    if (!file || !ctx) return null;
    try {
      const res = await fetch(file);
      if (!res.ok) throw new Error(String(res.status));
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      loopBuffers.set(name, buf);
      return buf;
    } catch {
      loopBuffers.set(name, null);
      return null;
    }
  };

  /** Arranca (o cambia) el loop del contexto en el instante dado, con micro-fade. */
  const startLoopAt = (name: CtxName, at: number): void => {
    if (!ctx || !bus) return;
    const buf = loopBuffers.get(name);
    if (!buf) return;
    if (loopGain) {
      loopGain.gain.setTargetAtTime(0, ctx.currentTime, 0.25); // salida suave del anterior
      const old = loopSrc;
      setTimeout(() => {
        try {
          old?.stop();
        } catch {
          /* ya parado */
        }
      }, 900);
    }
    const g = ctx.createGain();
    const fg = catalog.contexts[name]?.fileGain ?? 1;
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(fg, at, 0.3);
    g.connect(bus);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(g);
    src.start(at);
    loopSrc = src;
    loopGain = g;
    loopCtx = name;
  };

  const stopLoop = (): void => {
    if (loopSrc && ctx) {
      try {
        loopSrc.stop();
      } catch {
        /* ya parado */
      }
    }
    loopSrc = null;
    loopGain = null;
    loopCtx = null;
  };

  const targetBusGain = (): number => {
    if (!enabled) return 0;
    return catalog.masterGain;
  };

  const buildGraph = (): boolean => {
    if (ctx && bus) return true;
    const got = audioBus();
    if (!got) return false;
    ctx = got.ctx;
    bus = got.ctx.createGain();
    bus.gain.value = 0; // rampa de entrada suave hasta el objetivo
    bus.connect(got.master);
    bus.gain.setTargetAtTime(targetBusGain(), got.ctx.currentTime, 0.6);

    // Capa de lluvia: búfer de ruido en bucle → paso bajo → ganancia.
    const len = Math.floor(got.ctx.sampleRate * 2);
    const buf = got.ctx.createBuffer(1, len, got.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // Ruido ligeramente integrado (más «lluvia» que estática).
      last = 0.82 * last + 0.18 * (Math.random() * 2 - 1);
      data[i] = last * 3;
    }
    const filter = got.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = catalog.rain.filterHz;
    rainGain = got.ctx.createGain();
    rainGain.gain.value = 0;
    rainSource = got.ctx.createBufferSource();
    rainSource.buffer = buf;
    rainSource.loop = true;
    rainSource.connect(filter).connect(rainGain).connect(bus);
    rainSource.start();

    nextBarTime = got.ctx.currentTime + 0.15;
    if (timer === null) timer = setInterval(scheduleAhead, 400);
    return true;
  };

  /** Una nota corta del sintetizador (osc + gain con ataque y caída). */
  const note = (t: number, freq: number, dur: number, gain: number, wave: OscillatorType, attack = 0.012): void => {
    if (!ctx || !bus || gain <= 0.0001) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(Math.max(20, freq), t);
    const t1 = t + dur;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, Math.max(t + attack + 0.05, t1));
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t1 + 0.06);
  };

  /** Agenda un compás completo del contexto vigente (o del pendiente, en el borde). */
  const scheduleBar = (t0: number, name: CtxName): void => {
    if (!ctx) return;
    const c = catalog.contexts[name];
    if (!c) return;
    const beat = 60 / c.tempo;
    const bar = beat * 4;
    const chord = c.chords[chordIdx % c.chords.length]!;
    chordIdx += 1;

    // Bajo: tónica del acorde dos octavas abajo, en los pulsos 1 y 3.
    const bassNote = c.root + chord[0]! - 24;
    note(t0, midiToFreq(bassNote), beat * 1.7, c.bassGain, c.waves.bass, 0.03);
    note(t0 + beat * 2, midiToFreq(bassNote), beat * 1.7, c.bassGain * 0.85, c.waves.bass, 0.03);

    // Pad: el acorde entero sosteniendo el compás (ataque lento, cola suave).
    for (const semi of chord) {
      note(t0, midiToFreq(c.root + semi), bar * 1.02, (c.padGain * 1.6) / chord.length, c.waves.pad, bar * 0.3);
    }

    // Melodía: improvisa sobre la escala; en los tiempos fuertes prefiere notas del acorde.
    const eighths = 8;
    for (let i = 0; i < eighths; i++) {
      if (Math.random() > c.leadDensity * (i % 2 === 0 ? 1.25 : 0.8)) continue;
      const strong = i === 0 || i === 4;
      let semi: number;
      if (strong && chord.length > 0) {
        semi = chord[Math.floor(Math.random() * chord.length)]!;
      } else {
        semi = c.scale[Math.floor(Math.random() * c.scale.length)]!;
      }
      const oct = catalog.melodyOctaves[Math.floor(Math.random() * catalog.melodyOctaves.length)] ?? 0;
      const dur = beat * (Math.random() < 0.3 ? 1 : 0.5) * 0.92;
      note(
        t0 + (i * bar) / eighths,
        midiToFreq(c.root + semi + oct),
        dur,
        c.leadGain * (0.7 + Math.random() * 0.3),
        c.waves.lead,
        0.014,
      );
    }
  };

  const scheduleAhead = (): void => {
    if (disposed || !ctx || !bus) return;
    const now = ctx.currentTime;
    if (nextBarTime < now) nextBarTime = now + 0.1;
    const c = catalog.contexts[currentCtx];
    const barLen = c ? (60 / c.tempo) * 4 : 3;
    while (nextBarTime < now + 1.6) {
      // El cambio de contexto entra SIEMPRE en un borde de compás: transición musical, no corte.
      const name = pendingCtx ?? currentCtx;
      if (pendingCtx) {
        currentCtx = pendingCtx;
        pendingCtx = null;
        chordIdx = 0;
      }
      // v1.70 — si el contexto declara loop grabado, manda el fichero (síntesis = fallback).
      const wantsFile = !!catalog.contexts[name]?.file;
      if (wantsFile && loopCtx === name && loopSrc) {
        // loop ya sonando para este contexto: nada que agendar
      } else if (wantsFile) {
        void loadLoop(name).then((buf) => {
          if (buf && currentCtx === name && !disposed && ctx) {
            startLoopAt(name, Math.max(ctx.currentTime + 0.02, nextBarTime - barLen)); // entra ya, sin esperar otro borde
            return;
          }
          // sin fichero (fallo o contexto cambió): la síntesis cubre ese compás
          if (currentCtx === name && !disposed) scheduleBar(nextBarTime, name);
        });
        // mientras carga, síntesis (evita silencio en el primer compás)
        if (!loopBuffers.has(name)) scheduleBar(nextBarTime, name);
      } else {
        if (loopCtx !== null) stopLoop();
        scheduleBar(nextBarTime, name);
      }
      nextBarTime += barLen;
    }
  };

  const dayPartOf = (minute: number): CtxName => {
    const inPart = (p: { from: number; to: number }): boolean =>
      p.from <= p.to ? minute >= p.from && minute < p.to : minute >= p.from || minute < p.to;
    if (inPart(parts.morning)) return 'morning';
    if (inPart(parts.afternoon)) return 'afternoon';
    if (inPart(parts.evening)) return 'evening';
    return 'night';
  };

  return {
    update(minute: number, weather: string, ducked: boolean) {
      if (disposed) return;
      if (!buildGraph() || !ctx || !bus || !rainGain) return;
      const part = dayPartOf(minute);
      if (part !== currentCtx && pendingCtx !== part) pendingCtx = part;
      if (weather !== lastWeather) {
        lastWeather = weather;
        const target = weather === 'storm' ? catalog.rain.stormGain : weather === 'rain' ? catalog.rain.gain : 0;
        rainGain.gain.setTargetAtTime(target, ctx.currentTime, 1.2);
      }
      const base = targetBusGain();
      // El ducking (pausa/modal) manda siempre: lluvia incluida, que vive dentro del bus.
      const goal = ducked ? base * catalog.duckGain : base;
      bus.gain.setTargetAtTime(goal, ctx.currentTime, 0.8);
    },
    setEnabled(v: boolean) {
      enabled = v;
      if (ctx && bus) bus.gain.setTargetAtTime(targetBusGain(), ctx.currentTime, 0.5);
    },
    state() {
      return { enabled, context: pendingCtx ?? currentCtx, started: !!bus };
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      stopLoop();
      try {
        rainSource?.stop();
      } catch {
        /* ya parado */
      }
      rainSource = null;
      if (bus) {
        bus.disconnect();
        bus = null;
      }
      rainGain = null;
      ctx = null;
    },
  };
}
