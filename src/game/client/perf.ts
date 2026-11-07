'use client';

import type { AbstractEngine } from '@babylonjs/core';
import { QUALITY_SCALE, type PerfTarget, type QualityLevel } from './options';
import type { ShadowsDirector } from './shadows';

/**
 * V1.38 — PASE DE OPTIMIZACIÓN: DIRECTOR DE RENDIMIENTO ADAPTATIVO.
 *
 * El vecino pidió «un ajuste para asegurar al menos 30 FPS o más (cuanto más mejor)
 * en nuestro navegador». Este director ES ese ajuste: mide los FPS reales en ventanas
 * de ~1.2 s y sube/baja una escalera de optimización con histéresis hasta cumplir el
 * objetivo del menú de opciones (30/45/60 o máximo rendimiento). Solo presentación:
 * no toca el sim, la partida ni el contenido.
 *
 * La escalera (S0 → S8) tira primero de lo que no se ve y luego de lo que sí, y la
 * resolución — lo que el vecino nota como «se degrada la calidad» — se toca LO ÚLTIMO:
 *   S0 calidad completa → S1 sombras cada 2 fotogramas → S2 resolución −12% (glow intacto)
 *   → S3 sin glow → S4/S5 resolución −30/−50% → S6 sin sombras → S7/S8 resolución al mínimo.
 * Recuperar es SIMÉTRICO y rápido (2 muestras + cooldown corto) para volver a la
 * calidad máxima en cuanto el presupuesto de frame lo permita: el piso SIEMPRE es S0
 * (calidad completa) mientras los FPS no bajen de 30 — v1.84, petición del vecino:
 * «se deben permitir calidad máxima sin llegar a bajar de los 30FPS». El modo
 * 'máximo' del menú ya no arranca exprimido: apunta a S0 y solo degrada si el
 * juego no llega a 30 FPS reales.
 *
 * v1.86 — EL JUEGO VUELA: el objetivo por defecto pasa de 30 a 60 FPS (el vecino
 * pidió que «vuele»: los juegos web sofisticados van a 90). Con objetivos altos la
 * banda de decisión se adapta: en una pantalla de 60 Hz el rAF nunca supera 60, así
 * que la banda clásica (target + 18 %) sería inalcanzable y el optimizador, tras la
 * primera degradación, JAMÁS recuperaría — ahora se mide en fracción del objetivo
 * (degradar < 86 %, recuperar ≥ 95 %). El contrato de v1.84 se respeta: 'máximo'
 * sigue siendo «calidad máxima con suelo de 30» y 30 sigue siendo opción del menú.
 *
 * Regalo extra siempre activo (cero impacto visual): con sol apagado (noche/cielo
 * cerrado) el mapa de profundidad de las sombras se CONGELA — el sol de la escena
 * 2.5D no gira (solo cambia su intensidad), así que el mapa congelado es idéntico
 * y nos ahorramos el pase de profundidad durante toda la noche (~40 % del ciclo).
 */

/** Ganchos que el controlador presta al director (el sigue siendo dueño del render). */
export interface PerfHooks {
  /** Enciende/apaga la capa Glow (el controlador la recrea del catálogo si vuelve). */
  setGlowEnabled(visible: boolean): void;
  /** Cadencia del pase de sombras: 'off' = sin generador; N = cada N fotogramas. */
  setShadowEvery(n: number | 'off'): void;
  /** Publica el nivel vigente para la UI (el estado «cómo lo estoy llevando»). */
  onLevel(level: number): void;
}

/** Un peldaño de la escalera: qué precio pagamos exactamente en este nivel. */
interface Rung {
  /** Multiplicador sobre el hardware scaling de la calidad elegida (1 = sin tocar). */
  scale: number;
  glow: boolean;
  shadows: number | 'off';
}

/** La escalera completa, de más bonita a más rápida (S0..S8). v1.84: la resolución
 *  (el desenfoque que el vecino llama «degradación») se toca al FINAL; el glow
 *  aguanta hasta S3. */
const LADDER: readonly Rung[] = [
  { scale: 1, glow: true, shadows: 1 },
  { scale: 1, glow: true, shadows: 2 },
  { scale: 1.12, glow: true, shadows: 2 },
  { scale: 1.12, glow: false, shadows: 2 },
  { scale: 1.3, glow: false, shadows: 2 },
  { scale: 1.5, glow: false, shadows: 3 },
  { scale: 1.5, glow: false, shadows: 'off' },
  { scale: 1.9, glow: false, shadows: 'off' },
  { scale: 2.3, glow: false, shadows: 'off' },
];

/** FPS objetivo real por ajuste del menú. v1.86: el 60 de fábrica hace volar el juego;
 *  'máximo' conserva su contrato v1.84 («calidad máxima posible sin bajar de 30»). */
const TARGET_FPS: Record<PerfTarget, number> = { 30: 30, 45: 45, 60: 60, max: 30 };

const SAMPLE_WINDOW = 1.2; // s por ventana de medición
const GRACE_AFTER_CHANGE = 5000; // ms sin decidir tras tocar algo (compilación de shaders, etc.)
const COOLDOWN_DOWN = 4000; // ms entre degradaciones
const COOLDOWN_UP = 6000; // ms entre recuperaciones (v1.84: volver a calidad máxima PRONTO)
const DOWN_SAMPLES = 2; // ventanas seguidas por debajo del objetivo → degradar
const UP_SAMPLES = 2; // ventanas seguidas cómodas → recuperar (v1.84: antes 3, tardaba en subir)

export class PerfDirector {
  private baseScale = QUALITY_SCALE.normal;
  private level = 0;
  private target: PerfTarget = 60; // v1.86: objetivo de fábrica — el juego debe volar
  private auto = true;

  private frames = 0;
  private acc = 0;
  private below = 0;
  private above = 0;
  private graceUntil = 0;
  private lastChange = 0;

  constructor(
    private readonly engine: AbstractEngine,
    private readonly hooks: PerfHooks,
  ) {}

  /** Vuelve a atarse tras cada (re)arranque de escena: sombras nuevas, nivel vigente. */
  bind(): void {
    this.graceUntil = performance.now() + 4000;
    this.reapply();
  }

  /** Configuración inicial desde las preferencias guardadas. */
  configure(auto: boolean, target: PerfTarget): void {
    this.auto = auto;
    this.target = target;
    if (!auto) {
      // Manual: el jugador manda — calidad tal cual, sin optimizador.
      this.level = 0;
      this.applyLevel();
    }
  }

  setAuto(auto: boolean): void {
    if (this.auto === auto) return;
    this.auto = auto;
    this.below = 0;
    this.above = 0;
    this.graceUntil = performance.now() + GRACE_AFTER_CHANGE;
    if (auto) {
      this.applyLevel();
    } else {
      this.setLevel(0);
    }
  }

  setTarget(target: PerfTarget): void {
    if (this.target === target) return;
    this.target = target;
    this.below = 0;
    this.above = 0;
    this.graceUntil = performance.now() + GRACE_AFTER_CHANGE;
    // v1.84 — 'máximo' YA NO arranca exprimido (antes saltaba a S2 y mataba el glow):
    // apunta a la calidad completa (S0) y solo degrada si el juego no llega a 30 FPS.
  }

  /** La calidad manual (alta/normal/eco) es el SUELO visual del peldaño S0. */
  setBaseQuality(q: QualityLevel): void {
    const next = QUALITY_SCALE[q];
    if (next === this.baseScale) return;
    this.baseScale = next;
    this.applyLevel();
  }

  /** Nivel vigente (0..8) — la UI lo traduce a texto amable. */
  get currentLevel(): number {
    return this.level;
  }

  /** Re-aplica el nivel actual a la escena recién creada (tras restart/bind). */
  reapply(): void {
    this.applyLevel();
  }

  /** Muestreo por fotograma: barato (un sumo y un if). Decide en ventanas cerradas. */
  sample(): void {
    if (!this.auto) return;
    const dt = this.engine.getDeltaTime() / 1000;
    if (dt <= 0) return;
    this.frames += 1;
    this.acc += dt;
    if (this.acc < SAMPLE_WINDOW) return;
    const fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    this.evaluate(fps);
  }

  private evaluate(fps: number): void {
    const now = performance.now();
    if (now < this.graceUntil) return;
    const target = TARGET_FPS[this.target];
    const sinceChange = now - this.lastChange;
    // v1.86 — banda adaptativa: con objetivos altos (60) el rAF nunca supera target+6
    // en una pantalla de 60 Hz — la banda clásica sería inalcanzable para recuperar y
    // el optimizador, tras la primera degradación, jamás volvería a S0. Ahí la banda
    // se mide en fracción del objetivo: degradar < 86 % (51.6 a 60 Hz), recuperar ≥ 95 %
    // (57). En objetivos clásicos (30/45) la banda histórica sigue intacta.
    const hi = target >= 55;
    const downAt = hi ? target * 0.86 : target - 2;
    const upAt = hi ? target * 0.95 : target + Math.max(6, target * 0.18);
    if (fps < downAt) {
      this.above = 0;
      this.below += 1;
      if (this.below >= DOWN_SAMPLES && sinceChange >= COOLDOWN_DOWN && this.level < LADDER.length - 1) {
        this.setLevel(this.level + 1);
      }
    } else if (fps >= upAt) {
      this.below = 0;
      this.above += 1;
      // v1.84: el piso de recuperación SIEMPRE es S0 — la calidad máxima se permite
      // en cualquier modo mientras el presupuesto de frame lo permita.
      if (this.above >= UP_SAMPLES && sinceChange >= COOLDOWN_UP && this.level > 0) {
        this.setLevel(this.level - 1);
      }
    } else {
      this.below = 0;
      this.above = 0;
    }
  }

  private setLevel(level: number): void {
    const clamped = Math.min(LADDER.length - 1, Math.max(0, level));
    if (clamped === this.level) return;
    this.level = clamped;
    this.applyLevel();
    this.lastChange = performance.now();
    this.graceUntil = this.lastChange + GRACE_AFTER_CHANGE;
    this.below = 0;
    this.above = 0;
  }

  private applyLevel(): void {
    // Idempotente por diseño: setupGlow/setUpdateEvery ya guardan no-op. Barato de repetir.
    const rung = LADDER[this.level]!;
    this.engine.setHardwareScalingLevel(this.baseScale * rung.scale);
    this.hooks.setGlowEnabled(rung.glow);
    this.hooks.setShadowEvery(rung.shadows);
    this.hooks.onLevel(this.level);
  }
}

/** Total de peldaños de la escalera (la UI lo usa para acotar el nivel mostrado). */
export const PERF_LADDER_SIZE = LADDER.length;
