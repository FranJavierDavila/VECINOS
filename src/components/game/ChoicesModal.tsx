'use client';

import { HelpCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useGameStore } from '@/game/client/store';

interface ChoicesModalProps {
  onChoose: (choiceId: string) => void;
}

export function ChoicesModal({ onChoose }: ChoicesModalProps) {
  const choices = useGameStore((s) => s.choices);

  if (!choices) return null;

  return (
    <Dialog open={!!choices} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="size-5 shrink-0 text-amber-500" aria-hidden />
            {choices.title}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {choices.choices.map((c) => (
            <Button
              key={c.id}
              variant="outline"
              className="h-auto w-full justify-start py-3 text-left hover:border-amber-500/40 hover:bg-amber-500/10"
              onClick={() => onChoose(c.id)}
              aria-label={`Elegir: ${c.label}`}
            >
              <span className="flex flex-col items-start gap-0.5">
                <span className="font-semibold">{c.label}</span>
                {c.hint && <span className="text-xs font-normal text-muted-foreground">{c.hint}</span>}
              </span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
