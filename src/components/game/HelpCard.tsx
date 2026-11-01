'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Keyboard } from 'lucide-react';
import { useT } from '@/game/client/i18n';

const CONTROL_KEYS: { keys: string[]; key: string }[] = [
  { keys: ['A', 'D', '←', '→'], key: 'help.move' },
  { keys: ['W', 'S', '↑', '↓'], key: 'help.vertical' },
  { keys: ['E'], key: 'help.interact' },
  { keys: ['1', '2', '3', '4', '5'], key: 'help.cams' },
  { keys: ['Espacio'], key: 'help.dialog' },
];

/** Chuleta de controles. `flat` la dibuja sin tarjeta (para el post-it de ayuda). */
export function HelpCard({ flat = false }: { flat?: boolean }) {
  const t = useT();
  const content = (
    <>
      {CONTROL_KEYS.map((c) => (
        <div key={c.key} className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1">
            {c.keys.map((k) => (
              <kbd key={k} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                {k}
              </kbd>
            ))}
          </div>
          <span className="text-right text-xs text-muted-foreground">{t(c.key)}</span>
        </div>
      ))}
      <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">{t('help.note1')}</p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{t('help.note2')}</p>
    </>
  );
  if (flat) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
          <Keyboard className="h-4 w-4 text-amber-500" aria-hidden="true" />
          {t('help.title')}
        </p>
        {content}
      </div>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Keyboard className="h-4 w-4 text-amber-500" aria-hidden="true" />
          {t('help.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">{content}</CardContent>
    </Card>
  );
}
