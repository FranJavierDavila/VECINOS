'use client';

import { useEffect } from 'react';
import { Phone } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useGameStore } from '@/game/client/store';

interface PhoneModalProps {
  onNext: () => void;
}

export function PhoneModal({ onNext }: PhoneModalProps) {
  const phone = useGameStore((s) => s.phone);
  const open = phone !== null;

  // Espacio / Enter avanzan el diálogo de teléfono mientras esté abierto.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onNext]);

  if (!phone) return null;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-sm"
      >
        <DialogHeader className="items-center">
          <div className="mb-1 flex size-12 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/15">
            <Phone className="size-5 text-amber-600 dark:text-amber-400" aria-hidden />
          </div>
          <DialogTitle className="flex justify-center">
            <Badge variant="secondary">{phone.speaker}</Badge>
          </DialogTitle>
        </DialogHeader>
        <p className="text-base leading-relaxed">{phone.text}</p>
        <DialogFooter>
          <Button
            onClick={onNext}
            className="w-full bg-amber-600 text-white hover:bg-amber-700 sm:w-auto"
            aria-label={phone.isLast ? 'Colgar el teléfono' : 'Siguiente línea de diálogo'}
          >
            {phone.isLast ? 'Colgar' : 'Siguiente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
