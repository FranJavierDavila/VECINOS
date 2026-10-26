'use client';

import { Badge } from '@/components/ui/badge';
import { useGameStore } from '@/game/client/store';
import { useT } from '@/game/client/i18n';

/**
 * Tracker de misión (v1.17): franja compacta SIEMPRE visible entre el HUD y el dock.
 * Objetivo activo, su pista y recuento de misiones en curso / decisiones pendientes.
 * Discreto a propósito: el detalle vive en el dock, aquí solo el "ahora mismo".
 */
export function MissionTracker() {
  const t = useT();
  const objective = useGameStore((s) => s.objective);
  const missions = useGameStore((s) => s.missions);

  const active = missions.filter((m) => m.state === 'active' || m.state === 'awaiting_choice').length;
  const decisions = missions.filter((m) => m.state === 'awaiting_choice').length;

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm" aria-live="polite">
      <span className="shrink-0 text-base leading-none" aria-hidden>
        🎯
      </span>
      {objective ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className="truncate font-semibold">{objective.title}</p>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">{objective.text}</p>
        </div>
      ) : (
        <p className="min-w-0 flex-1 truncate text-muted-foreground">{t('tracker.noMission')}</p>
      )}
      {active > 0 && (
        <Badge
          variant="outline"
          className="shrink-0 border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400"
        >
          {t('tracker.active', { n: active })}
        </Badge>
      )}
      {decisions > 0 && (
        <Badge
          variant="outline"
          className="animate-pulse shrink-0 border-orange-500/30 bg-orange-500/15 text-orange-600 dark:text-orange-400"
        >
          {t('tracker.decisions', { n: decisions })}
        </Badge>
      )}
    </div>
  );
}
