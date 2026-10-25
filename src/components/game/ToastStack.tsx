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
      className="pointer-events-none absolute right-3 top-3 z-30 flex w-[min(24rem,calc(100%-6rem))] flex-col items-end gap-2"
      role="status"
      aria-live="polite"
    >
      <p className="sr-only">Avisos de la comunidad</p>
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
              'pointer-events-auto animate-in fade-in slide-in-from-top-2 flex-row items-start gap-2 py-2 pr-3 pl-3 shadow-lg shadow-black/30 hover:shadow-xl',
              tone.cardClassName,
              'bg-background/95 backdrop-blur-sm',
            )}
          >
            <Icon className={cn('mt-0.5 size-4 shrink-0', tone.iconClassName)} aria-hidden />
            <p className="text-sm leading-snug">{t.text}</p>
          </Card>
        );
      })}
    </div>
  );
}
