'use client';

/**
 * Preferencias del jugador (pulido Steam): volumen maestro, calidad gráfica, contador de FPS
 * e idioma de la interfaz (localización ES/EN).
 * Persistencia en localStorage bajo una sola clave; sin almacenamiento el juego arranca con
 * los valores por defecto (nunca rompe la partida). La calidad NO toca el sim: solo render.
 * v1.39 — música procedural, tamaño de texto, modo daltónico y reducir animaciones
 * (accesibilidad): todo presentación, todo persistido en la misma clave.
 */
export type QualityLevel = 'eco' | 'normal' | 'alta';
export type Lang = 'es' | 'en';

/** Tamaño de texto global de la partida (escala sobre el font-size raíz). */
export type TextScale = 'small' | 'normal' | 'large' | 'huge';
/** Simulación de daltonismo aplicada como filtro al lienzo del juego. */
export type ColorblindMode = 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia';

/**
 * v1.38 — Objetivo de FPS del auto-ajuste de rendimiento:
 *  · 30/45/60 — el optimizador mantiene esa cadencia degradando detalles solo si hace falta.
 *  · 'max'    — preset de máximo rendimiento: arranca sin glow y con sombras baratas,
 *               y solo degrada resolución si no llega a 30 (el suelo mínimo garantizado).
 */
export type PerfTarget = 30 | 45 | 60 | 'max';

export interface GameOptions {
  /** Volumen maestro 0..1 (multiplica el masterGain del catálogo de sonidos). */
  volume: number;
  /** Presupuesto de píxeles: 'alta' = resolución nativa; normal/eco usan hardware scaling. */
  quality: QualityLevel;
  /** Mostrar contador de FPS sobre el lienzo. */
  fpsVisible: boolean;
  /** Idioma de la interfaz (chrome); el contenido JSON mantiene su idioma original. */
  lang: Lang;
  /** v1.38 — auto-ajuste de rendimiento activo (degrada/recupera detalles para cumplir el objetivo). */
  perfAuto: boolean;
  /** v1.38 — cadencia objetivo que el auto-ajuste garantiza (30 mínimo prometido). */
  perfTarget: PerfTarget;
  /** v1.39 — música ambiental procedural (por hora del día y lluvia) activada. */
  music: boolean;
  /** v1.39 — accesibilidad: escala del texto de toda la partida. */
  textScale: TextScale;
  /** v1.39 — accesibilidad: filtro de daltonismo sobre el lienzo. */
  colorblind: ColorblindMode;
  /** v1.39 — accesibilidad: sin animaciones de monedas/post-its ni movimiento extra. */
  reduceMotion: boolean;
}

const OPTIONS_KEY = 'vecinos.options';

export const DEFAULT_OPTIONS: GameOptions = {
  volume: 0.7,
  quality: 'normal',
  fpsVisible: false,
  lang: 'es',
  perfAuto: true,
  perfTarget: 30,
  music: true,
  textScale: 'normal',
  colorblind: 'off',
  reduceMotion: false,
};

/** Hardware scaling por calidad: >1 renderiza a menor resolución (menos píxeles, más FPS). */
export const QUALITY_SCALE: Record<QualityLevel, number> = { alta: 1, normal: 1.35, eco: 1.75 };

/** Porcentaje de font-size raíz por tamaño de texto (accesibilidad v1.39). */
export const TEXT_SCALE_PCT: Record<TextScale, number> = { small: 87.5, normal: 100, large: 112.5, huge: 125 };

export function loadOptions(): GameOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    if (!raw) return { ...DEFAULT_OPTIONS };
    const parsed = JSON.parse(raw) as Partial<GameOptions>;
    return {
      volume:
        typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULT_OPTIONS.volume,
      quality: parsed.quality === 'eco' || parsed.quality === 'alta' ? parsed.quality : 'normal',
      fpsVisible: parsed.fpsVisible === true,
      lang: parsed.lang === 'en' ? 'en' : 'es',
      perfAuto: parsed.perfAuto !== false,
      perfTarget:
        parsed.perfTarget === 'max' || parsed.perfTarget === 45 || parsed.perfTarget === 60
          ? parsed.perfTarget
          : 30,
      music: parsed.music !== false,
      textScale:
        parsed.textScale === 'small' || parsed.textScale === 'large' || parsed.textScale === 'huge'
          ? parsed.textScale
          : 'normal',
      colorblind:
        parsed.colorblind === 'protanopia' || parsed.colorblind === 'deuteranopia' || parsed.colorblind === 'tritanopia'
          ? parsed.colorblind
          : 'off',
      reduceMotion: parsed.reduceMotion === true,
    };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

function persist(o: GameOptions): void {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(o));
  } catch {
    /* la preferencia solo vive en sesión */
  }
}

export function saveOptions(o: GameOptions): void {
  persist(o);
}

/** Parchea y guarda solo los campos indicados (el resto se conservan). */
export function saveOptionsPartial(patch: Partial<GameOptions>): GameOptions {
  const next = { ...loadOptions(), ...patch };
  persist(next);
  return next;
}
