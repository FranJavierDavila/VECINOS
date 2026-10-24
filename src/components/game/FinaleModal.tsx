'use client';

import { Drama } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useGameStore } from '@/game/client/store';

interface FinaleModalProps {
  onClose: () => void;
}

export function FinaleModal({ onClose }: FinaleModalProps) {
  const finale = useGameStore((s) => s.finale);

  if (!finale) return null;

  return (
    <Dialog
      open={!!finale}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-sm text-center">
        <DialogHeader className="items-center">
          <div className="mb-1 flex size-12 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/15">
            <Drama className="size-5 text-amber-600 dark:text-amber-400" aria-hidden />
          </div>
          <DialogTitle className="flex justify-center">Continuará...</DialogTitle>
        </DialogHeader>
        <p className="text-base leading-relaxed">{finale}</p>
        <Button
          onClick={onClose}
          className="w-full bg-amber-600 text-white hover:bg-amber-700"
          aria-label="Seguir jugando"
        >
          Seguir jugando
        </Button>
      </DialogContent>
    </Dialog>
  );
}
