'use client';

import { Gavel } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useGameStore } from '@/game/client/store';

interface JuntaModalProps {
  onVote: (vote: 'yes' | 'no') => void;
}

export function JuntaModal({ onVote }: JuntaModalProps) {
  const junta = useGameStore((s) => s.junta);

  if (!junta) return null;

  return (
    <Dialog open={!!junta} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="size-5 shrink-0 text-amber-500" aria-hidden />
            Junta de Vecinos
          </DialogTitle>
          <DialogDescription>Orden del día</DialogDescription>
        </DialogHeader>

        {junta.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Hoy no hay puntos en el orden del día... sospechosamente.
          </p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-3 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30">
            {junta.map((item) => (
              <li key={item.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm leading-tight font-medium">{item.title}</p>
                  <Badge variant="secondary" className="shrink-0">
                    {item.cost} €
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p className="text-sm font-medium">¿Tu voto?</p>
          <div className="flex gap-2">
            <Button
              onClick={() => onVote('yes')}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              aria-label="Votar a favor"
            >
              A favor
            </Button>
            <Button variant="destructive" onClick={() => onVote('no')} aria-label="Votar en contra">
              En contra
            </Button>
          </div>
        </DialogFooter>
        <p className="text-xs text-muted-foreground">
          El resto de vecinos vota según su humor... y lo mucho (o poco) que les caes.
        </p>
      </DialogContent>
    </Dialog>
  );
}
