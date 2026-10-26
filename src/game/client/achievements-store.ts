'use client';

/**
 * Perfil de logros (v1.17, estilo Steam): los desbloqueos son del JUGADOR, no de la
 * partida, así que viven en localStorage y sobreviven a resets y cargas de guardado.
 * Sin almacenamiento disponible el juego funciona igual (el perfil solo vive en sesión).
 * Mismo patrón try/catch que options.ts.
 */

const ACHIEVEMENTS_KEY = 'vecinos.achievements.v1';

/** Ids de logros desbloqueados guardados en el navegador ([] si no hay perfil). */
export function loadUnlocked(): string[] {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

/** Guarda el perfil completo de ids desbloqueados (dedupe incluido por cortesía). */
export function saveUnlocked(ids: string[]): void {
  try {
    localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* almacenamiento no disponible: el perfil solo vive en sesión */
  }
}
