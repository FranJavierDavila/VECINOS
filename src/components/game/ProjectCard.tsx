'use client';

/**
 * TARJETA DEL PROYECTO DEL EDIFICIO (v1.39) — meta de largo plazo siempre visible:
 * «Mejorar el edificio» con niveles, objetivos en curso (misiones, arcas, reputación),
 * barra de progreso y recompensa narrativa. Se evalúa SOLO LECTURA del mundo
 * (support/project.ts) y se sincroniza con la misma cadencia que los logros.
 */

import { useGameStore } from '@/game/client/store';
import { useT } from '@/game/client/i18n';

export function ProjectCard() {
  const t = useT();
  const ready = useGameStore((s) => s.ready);
  const project = useGameStore((s) => s.project);
  if (!ready || !project) return null;

  return (
    <section
      className="rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-transparent p-3"
      aria-label={project.title}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xl leading-none" aria-hidden>
          {project.icon}
        </span>
        <div className="min-w-[180px] flex-1">
          <p className="text-xs font-bold leading-tight">
            {project.title}
            <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              {project.levelTitle}
            </span>
          </p>
          {/* Barra de progreso del nivel en curso */}
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-amber-500/15" role="progressbar" aria-valuenow={Math.round(project.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={project.title}>
            <div className="h-full rounded-full bg-amber-500 transition-[width] duration-500" style={{ width: `${Math.round(project.progress * 100)}%` }} />
          </div>
        </div>
        {project.goals.length > 0 ? (
          <ul className="flex flex-wrap items-center gap-1.5" aria-label={t('project.goalsAria')}>
            {project.goals.map((g) => (
              <li
                key={g.label}
                className={
                  'rounded-md border px-2 py-0.5 text-[10px] font-semibold tabular-nums ' +
                  (g.done ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-dashed text-muted-foreground')
                }
              >
                {g.done ? '✓ ' : ''}
                {g.label} {g.have}/{g.need}
              </li>
            ))}
          </ul>
        ) : (
          <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            🏆 {t('project.completed')}
          </span>
        )}
      </div>
      {project.reward && project.goals.length === 0 && (
        <p className="mt-2 border-t border-dashed border-amber-500/30 pt-2 text-[11px] text-muted-foreground">{project.reward}</p>
      )}
    </section>
  );
}
