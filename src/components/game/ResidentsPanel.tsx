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

export function ResidentsPanel({ fill = false }: { fill?: boolean } = {}) {
  const t = useT();
  const residents = useGameStore((s) => s.residentsUi);

  if (residents.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('neighbors.empty')}</p>;
  }

  const affinityView = (a: number | null): { label: string; className: string } => {
    if (a === null) return { label: t('neighbors.unknown'), className: 'text-muted-foreground' };
    if (a >= 70) return { label: `💖 ${a}`, className: 'text-pink-600 dark:text-pink-400' };
    if (a >= 40) return { label: `🙂 ${a}`, className: 'text-emerald-600 dark:text-emerald-400' };
    return { label: `😐 ${a}`, className: 'text-amber-600 dark:text-amber-400' };
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
              <span className={'ml-auto text-[10px] font-semibold tabular-nums ' + aff.className} title={t('neighbors.affinity')}>
                {aff.label}
              </span>
            </header>
            <p className="mt-0.5 text-[11px] italic leading-snug text-muted-foreground">«{r.tagline}»</p>
            {/* v1.79 — confianza del vecino hacia el jugador (la mueve la charla con tema). */}
            {r.trust !== null && (
              <p className="mt-1 text-[10px] font-semibold tabular-nums text-sky-600 dark:text-sky-400" title={t('neighbors.trust')}>
                🤝 {t('neighbors.trust')}: {r.trust}
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
