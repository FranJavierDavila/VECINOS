import type { ProjectCatalog, World } from '@/game/core/types';

/**
 * PROYECTO COMUNITARIO DEL EDIFICIO (v1.39) — meta de largo plazo «mejorar el edificio».
 * Evaluador PURO (mismo patrón que los logros): solo LEE el mundo — misiones completadas,
 * arcas de la comunidad y reputación del jugador — y lo compara con los objetivos del
 * catálogo (public/content/project.json). Cero estado propio: cargar una partida antigua
 * recalcula el nivel sin migraciones. El sim ni se entera.
 */

export interface ProjectSnapshot {
  /** Misiones completadas (la clave del catálogo es `missions`). */
  missions: number;
  funds: number;
  reputation: number;
}

/** Foto de las contribuciones medibles desde el mundo (mismo criterio que syncHud). */
export function projectSnapshot(world: World, actorId: string): ProjectSnapshot {
  const player = world.residents[actorId] ?? world.residents[world.playerId];
  return {
    missions: world.missions.filter((m) => m.state === 'done').length,
    funds: world.community.funds,
    reputation: player?.reputation ?? 0,
  };
}

export interface ProjectLevelState {
  /** Nivel CONSEGUIDO (0 = ninguno). N = los `levels` 0..N-1 ya cumplidos. */
  level: number;
  /** true cuando la escalera entera está completada. */
  completed: boolean;
  /** Nivel en curso (o null si completado). */
  current: ProjectCatalog['levels'][number] | null;
  /** 0..1 de progreso del nivel en curso (mínimo de los ratios de cada requisito). */
  progress: number;
  /** Requisitos del nivel en curso con su estado. */
  goals: { key: 'missions' | 'funds' | 'reputation'; need: number; have: number; done: boolean }[];
}

const GOAL_KEYS: ('missions' | 'funds' | 'reputation')[] = ['missions', 'funds', 'reputation'];

export function evaluateProject(catalog: ProjectCatalog, snap: ProjectSnapshot): ProjectLevelState {
  let level = 0;
  for (const lv of catalog.levels) {
    const ok = GOAL_KEYS.every((k) => {
      const need = lv.goal[k];
      return need === undefined || snap[k] >= need;
    });
    if (!ok) break;
    level += 1;
  }
  const completed = level >= catalog.levels.length;
  const current = completed ? null : catalog.levels[level]!;
  const goals = (current ? GOAL_KEYS : [])
    .filter((k) => current!.goal[k] !== undefined)
    .map((k) => {
      const need = current!.goal[k]!;
      const have = snap[k];
      return { key: k, need, have: Math.min(have, need), done: have >= need };
    });
  const progress =
    goals.length === 0
      ? 1
      : goals.reduce((acc, g) => acc + g.have / Math.max(1, g.need), 0) / goals.length;
  return { level, completed, current, progress, goals };
}
