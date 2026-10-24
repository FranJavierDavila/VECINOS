'use client';

import { Keyboard, Target } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGameStore } from '@/game/client/store';
import { useT } from '@/game/client/i18n';

export function ObjectiveCard() {
  const t = useT();
  const objective = useGameStore((s) => s.objective);
  const prompt = useGameStore((s) => s.prompt);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Target className="size-4 text-amber-500" aria-hidden />
          {t('obj.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-4">
        {objective ? (
          <div>
            <p className="text-sm font-bold">{objective.title}</p>
            <p className="text-sm text-muted-foreground">{objective.text}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('obj.empty')}</p>
        )}
        {prompt && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Keyboard className="size-3.5 shrink-0" aria-hidden />
            {prompt}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
