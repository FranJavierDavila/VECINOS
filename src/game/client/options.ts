'use client';

/**
 * Preferencias del jugador (pulido Steam): volumen maestro, calidad gráfica, contador de FPS
 * e idioma de la interfaz (localización ES/EN).
 * Persistencia en localStorage bajo una sola clave; sin almacenamiento el juego arranca con
 * los valores por defecto (nunca rompe la partida). La calidad NO toca el sim: solo render.
 */
export type QualityLevel = 'eco' | 'normal' | 'alta';
export type Lang = 'es' | 'en';

export interface GameOptions {
  /** Volumen maestro 0..1 (multiplica el masterGain del catálogo de sonidos). */
  volume: number;
  /** Presupuesto de píxeles: 'alta' = resolución nativa; normal/eco usan hardware scaling. */
  quality: QualityLevel;
  /** Mostrar contador de FPS sobre el lienzo. */
  fpsVisible: boolean;
  /** Idioma de la interfaz (chrome); el contenido JSON mantiene su idioma original. */
  lang: Lang;
}

const OPTIONS_KEY = 'vecinos.options';

export const DEFAULT_OPTIONS: GameOptions = { volume: 0.7, quality: 'normal', fpsVisible: false, lang: 'es' };

/** Hardware scaling por calidad: >1 renderiza a menor resolución (menos píxeles, más FPS). */
export const QUALITY_SCALE: Record<QualityLevel, number> = { alta: 1, normal: 1.35, eco: 1.75 };

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
