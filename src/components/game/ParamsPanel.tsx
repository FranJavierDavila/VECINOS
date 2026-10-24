'use client';

import { Sofa } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGameStore } from '@/game/client/store';
import { useT } from '@/game/client/i18n';

export function ParamsPanel() {
  const t = useT();
  const params = useGameStore((s) => s.params);
  const homeLabel = useGameStore((s) => s.homeLabel);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sofa className="size-4 text-amber-500" aria-hidden />
          {t('params.title', { home: homeLabel })}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        {params.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('params.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {params.map((p) => (
              <li key={p.name} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{p.label}</span>
                <span className="font-medium">{p.value}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
