'use client';

/**
 * PANEL DE VECINOS (v1.39) — los residentes como personajes: nombre propio, lema del
 * arquetipo, gustos, cita de presentación, vivienda y afinidad con el jugador (la relación
 * que lleva el sim). La foto de datos la sincroniza el controlador cada ~2 s
 * (residentsUiSnapshot); aquí solo se pinta, con la lista larga con scroll propio.
 */

import { Badge } from '@/components/ui/badge';
import { useGameStore } from '@/game/client/store';
import { useT } from '@/game/client/i18n';
import { cn } from '@/lib/utils';

export function ResidentsPanel({ fill = false }: { fill?: boolean } = {}) {
  const t = useT();
  const residents = useGameStore((s) => s.residentsUi);

  if (residents.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('neighbors.empty')}</p>;
  }

  const affinityView = (a: number | null): { label: string; bar: string; pct: number } => {
    if (a === null) return { label: t('neighbors.unknown'), bar: 'bg-muted-foreground/40', pct: 0 };
    const pct = Math.max(0, Math.min(100, a));
    if (a >= 70) return { label: `💖 ${a}`, bar: 'bg-pink-500', pct };
    if (a >= 40) return { label: `🙂 ${a}`, bar: 'bg-emerald-500', pct };
    return { label: `😐 ${a}`, bar: 'bg-amber-500', pct };
  };
  /** v1.84 — la confianza (-100..100) se pinta como medidor: el 0 neutral queda al 50%. */
  const trustView = (v: number): { label: string; bar: string; pct: number } => {
    const pct = Math.max(0, Math.min(100, (v + 100) / 2));
    if (v >= 20) return { label: `🤝 ${v}`, bar: 'bg-sky-500', pct };
    if (v <= -20) return { label: `🤝 ${v}`, bar: 'bg-rose-500', pct };
    return { label: `🤝 ${v}`, bar: 'bg-amber-500', pct };
  };

  return (
    <div className={fill ? 'space-y-2.5' : 'max-h-96 space-y-2.5 overflow-y-auto pr-1 [scrollbar-width:thin]'}>
      {residents.map((r) => {
        const aff = affinityView(r.affinity);
        return (
          <article key={r.id} className="rounded-lg border border-dashed p-3">
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-xs font-bold">{r.name}</p>
              {!r.present && (
                <Badge variant="outline" className="border-dashed px-1.5 text-[10px] text-muted-foreground">
                  {t('neighbors.moving')}
                </Badge>
              )}
              {/* v1.84 — MEDIDOR de afinidad: número + barra 0..100. */}
              <span
                className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold tabular-nums"
                title={t('neighbors.affinity')}
                aria-label={r.affinity === null ? t('neighbors.unknown') : t('neighbors.affinityMeter', { n: r.affinity })}
              >
                {aff.label}
                <span className="relative inline-block h-1.5 w-14 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className={cn('absolute inset-y-0 left-0 rounded-full', aff.bar)} style={{ width: `${aff.pct}%` }} />
                </span>
              </span>
            </header>
            <p className="mt-0.5 text-[11px] italic leading-snug text-muted-foreground">«{r.tagline}»</p>
            {/* v1.79/v1.84 — confianza del vecino hacia el jugador, AHORA con medidor. */}
            {r.trust !== null && (
              <p
                className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold tabular-nums"
                title={t('neighbors.trust')}
                aria-label={t('neighbors.trustMeter', { n: r.trust })}
              >
                <span className="text-sky-600 dark:text-sky-400">{trustView(r.trust).label}</span>
                <span className="relative inline-block h-1.5 w-14 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span
                    className={cn('absolute inset-y-0 left-0 rounded-full', trustView(r.trust).bar)}
                    style={{ width: `${trustView(r.trust).pct}%` }}
                  />
                </span>
              </p>
            )}
            {r.quote && <p className="mt-1 text-[11px] leading-snug">{r.quote}</p>}
            {r.tastes.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-1" aria-label={t('neighbors.tastes')}>
                {r.tastes.map((taste, i) => (
                  <li key={i} className="rounded-full bg-muted px-2 py-0.5 text-[10px]">
                    {taste}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-[10px] opacity-60">
              🏠 {t('neighbors.home')}: {r.home}
            </p>
          </article>
        );
      })}
    </div>
  );
}
