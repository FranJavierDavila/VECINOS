'use client';

import { ScrollText } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGameStore } from '@/game/client/store';
import type { UiMission } from '@/game/client/store';
import { cn } from '@/lib/utils';
import { useT } from '@/game/client/i18n';

const STATE_KEY: Record<UiMission['state'], string> = {
  pending: 'missions.state.pending',
  active: 'missions.state.active',
  awaiting_choice: 'missions.state.awaiting',
  done: 'missions.state.done',
  failed: 'missions.state.failed',
};

const STATE_BADGE: Record<UiMission['state'], { variant: 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  pending: { variant: 'secondary' },
  active: {
    variant: 'outline',
    className: 'border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  awaiting_choice: {
    variant: 'outline',
    className: 'animate-pulse border-orange-500/30 bg-orange-500/15 text-orange-600 dark:text-orange-400',
  },
  done: {
    variant: 'outline',
    className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  failed: { variant: 'destructive' },
};

export function MissionsPanel() {
  const t = useT();
  const missions = useGameStore((s) => s.missions);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ScrollText className="size-4 text-amber-500" aria-hidden />
          {t('missions.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        {missions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('missions.empty')}</p>
        ) : (
          <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
            {missions.map((m) => {
              const badge = STATE_BADGE[m.state];
              return (
                <li key={m.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm leading-tight font-medium">{m.title}</p>
                    {m.hint && <p className="text-xs text-muted-foreground">{m.hint}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant={badge.variant} className={cn(badge.className)}>
                      {t(STATE_KEY[m.state])}
                    </Badge>
                    {m.remaining && (
                      <span className="font-mono text-xs text-muted-foreground">{m.remaining}</span>
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
