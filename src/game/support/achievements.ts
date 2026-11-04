/**
 * Evaluador de logros (v1.17): capa support — TS puro sin Babylon ni DOM.
 * Lee un SNAPSHOT del mundo (construido por el controlador con las mismas fuentes
 * que el HUD) y lo contrasta con el catálogo de logros. Funciones puras y
 * deterministas: ningún efecto, ninguna escritura, ninguna dependencia del sim.
 * Las condiciones son DEL PERFIL DE JUGADOR: nunca amplían el sim.
 */

import type { AchievementsCatalog, AchievementDef } from '@/game/core/types';

/** Foto mínima del estado del mundo que necesitan las condiciones de logros. */
export interface AchievementSnapshot {
  /** Día del reloj del mundo (world.clock.day, la misma fuente que el HUD). */
  day: number;
  /** Tick global del mundo (por si una condición futura quiere precisión al minuto). */
  tick: number;
  /** Cartera del jugador. */
  wallet: number;
  /** Fondos de la comunidad. */
  funds: number;
  /** Reputación del jugador. */
  reputation: number;
  /** Estado del ascensor ('ok' | 'broken' | …) leído del bloque con elevator_status. */
  elevatorStatus: string;
  /** Ids de misiones en estado 'done' (completadas, siguen en world.missions). */
  missionsDone: string[];
  /** Mejor afinidad del jugador en SUS relaciones (0 si todavía no tiene ninguna). */
  bestAffinity: number;
  /** v1.85 — tramas cómicas presenciadas (world.skitsSeen, las cuenta extra/comedy.ts). */
  skitsSeen: number;
}

/** ¿Cumple este logro su condición con este snapshot? (pura, determinista, sin efectos). */
export function achievementUnlocked(def: Pick<AchievementDef, 'condition'>, snap: AchievementSnapshot): boolean {
  const c = def.condition;
  switch (c.kind) {
    case 'mission_done':
      return snap.missionsDone.includes(c.mission);
    case 'missions_done':
      return snap.missionsDone.length >= c.count;
    case 'wallet':
      return snap.wallet >= c.amount;
    case 'funds':
      return snap.funds >= c.amount;
    case 'reputation':
      return snap.reputation >= c.amount;
    case 'day':
      return snap.day >= c.count;
    case 'relation':
      return snap.bestAffinity >= c.affinity;
    case 'elevator_ok':
      return snap.elevatorStatus === 'ok';
    case 'skits_witnessed':
      return snap.skitsSeen >= c.count;
  }
}

/**
 * Evalúa el catálogo completo contra el snapshot. Devuelve SOLO los ids NUEVOS
 * (los que no estaban en `unlocked`, el perfil persistente del navegador).
 */
export function evaluateAchievements(catalog: AchievementsCatalog, snap: AchievementSnapshot, unlocked: ReadonlySet<string>): string[] {
  const fresh: string[] = [];
  for (const def of catalog.achievements) {
    if (unlocked.has(def.id)) continue;
    if (achievementUnlocked(def, snap)) fresh.push(def.id);
  }
  return fresh;
}
