'use client';

import { Keyboard, Target } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGameStore } from '@/game/client/store';

export function ObjectiveCard() {
  const objective = useGameStore((s) => s.objective);
  const prompt = useGameStore((s) => s.prompt);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Target className="size-4 text-amber-500" aria-hidden />
          Objetivo
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-4">
        {objective ? (
          <div>
            <p className="text-sm font-bold">{objective.title}</p>
            <p className="text-sm text-muted-foreground">{objective.text}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sin misiones activas. Disfruta del edificio... pronto sonará algo.
          </p>
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
