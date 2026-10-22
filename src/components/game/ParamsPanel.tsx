'use client';

import { Sofa } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGameStore } from '@/game/client/store';

export function ParamsPanel() {
  const params = useGameStore((s) => s.params);
  const homeLabel = useGameStore((s) => s.homeLabel);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sofa className="size-4 text-amber-500" aria-hidden />
          Tu piso · {homeLabel}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        {params.length === 0 ? (
          <p className="text-sm text-muted-foreground">Los inspectores aún no han pasado por aquí.</p>
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
