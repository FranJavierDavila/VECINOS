'use client';

import { Trophy } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGameStore } from '@/game/client/store';
import { useT } from '@/game/client/i18n';
import { cn } from '@/lib/utils';

/**
 * Panel de logros (v1.17): grid responsive al estilo Steam. Los desbloqueados lucen
 * icono, nombre y descripción con su badge "logrado"; los bloqueados van atenuados con
 * candado, y los ocultos no destripan nada ("???" / "Logro oculto") hasta caer.
 */
export function AchievementsPanel() {
  const t = useT();
  const achievements = useGameStore((s) => s.achievements);

  const unlocked = achievements.filter((a) => a.unlocked).length;
  const locked = achievements.length - unlocked;

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Trophy className="size-4 text-amber-500" aria-hidden />
          {t('ach.title')}
          {achievements.length > 0 && (
            <Badge
              variant="outline"
              className="ml-auto border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400"
            >
              {t('ach.progress', { x: unlocked, y: achievements.length })}
            </Badge>
          )}
        </CardTitle>
        {achievements.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('ach.doneCount', { n: unlocked })} · {t('ach.lockedCount', { n: locked })}
          </p>
        )}
      </CardHeader>
      <CardContent className="px-4">
        {achievements.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('ach.empty')}</p>
        ) : (
          <ul className="grid max-h-96 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
            {achievements.map((a) => {
              const revealed = a.unlocked || !a.hidden;
              return (
                <li
                  key={a.id}
                  className={cn(
                    'flex items-start gap-2.5 rounded-lg border p-2.5',
                    a.unlocked ? 'border-amber-500/30 bg-amber-500/10' : 'opacity-60',
                  )}
                >
                  <span className="text-xl leading-none" aria-hidden>
                    {a.unlocked ? a.icon : '🔒'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{revealed ? a.name : t('ach.hiddenName')}</p>
                    <p className="text-xs text-muted-foreground">{revealed ? a.desc : t('ach.hiddenDesc')}</p>
                    {a.unlocked && (
                      <Badge
                        variant="outline"
                        className="mt-1.5 border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      >
                        {t('ach.done')}
                      </Badge>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
