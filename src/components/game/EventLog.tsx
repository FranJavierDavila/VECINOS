'use client';

import { Newspaper } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGameStore } from '@/game/client/store';
import type { Tone } from '@/game/client/store';
import { cn } from '@/lib/utils';
import { useT } from '@/game/client/i18n';

const TONE_BORDER: Record<Tone, string> = {
  good: 'border-l-emerald-500',
  bad: 'border-l-rose-500',
  info: 'border-l-muted-foreground/40',
};

export function EventLog() {
  const t = useT();
  const log = useGameStore((s) => s.log);

  // Más reciente primero: copia para no mutar el array del store.
  const entries = [...log].reverse();

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Newspaper className="size-4 text-amber-500" aria-hidden />
          {t('log.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('log.empty')}</p>
        ) : (
          <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-1 text-xs font-mono [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30">
            {entries.map((e) => (
              <li key={e.id} className={cn('border-l-2 pl-2 leading-snug', TONE_BORDER[e.tone])}>
                <span className="text-muted-foreground">[{e.tick}]</span> {e.text}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
