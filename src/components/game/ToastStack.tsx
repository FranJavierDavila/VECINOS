'use client';

import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { useGameStore } from '@/game/client/store';
import type { Tone } from '@/game/client/store';
import { cn } from '@/lib/utils';

const TONE_UI: Record<Tone, { icon: LucideIcon; cardClassName: string; iconClassName: string }> = {
  info: {
    icon: Info,
    cardClassName: 'border-border',
    iconClassName: 'text-foreground',
  },
  good: {
    icon: CheckCircle2,
    cardClassName: 'border-emerald-500/40',
    iconClassName: 'text-emerald-500',
  },
  bad: {
    icon: AlertTriangle,
    cardClassName: 'border-rose-500/40',
    iconClassName: 'text-rose-500',
  },
};

interface ToastStackProps {
  onDismiss: (id: number) => void;
}

export function ToastStack({ onDismiss }: ToastStackProps) {
  const toasts = useGameStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed right-4 bottom-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 sm:w-auto"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const tone = TONE_UI[t.tone];
        const Icon = tone.icon;
        return (
          <Card
            key={t.id}
            role="button"
            tabIndex={0}
            aria-label={`Cerrar aviso: ${t.text}`}
            onClick={() => onDismiss(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onDismiss(t.id);
              }
            }}
            className={cn(
              'animate-in fade-in slide-in-from-bottom-2 flex-row items-center gap-2 py-2 pr-3 pl-3 shadow-md hover:shadow-lg',
              tone.cardClassName,
            )}
          >
            <Icon className={cn('size-4 shrink-0', tone.iconClassName)} aria-hidden />
            <p className="text-sm leading-snug">{t.text}</p>
          </Card>
        );
      })}
    </div>
  );
}
