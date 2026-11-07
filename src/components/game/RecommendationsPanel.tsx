'use client';

/**
 * PANEL DE ÚLTIMAS RECOMENDACIONES (v1.84) — la respuesta visible a «¿dónde están
 * las últimas recomendaciones?». Vive ENCIMA de la pestaña de Misiones del cuaderno
 * (InfoOverlay): se abre Misiones y las recomendaciones son lo PRIMERO que se lee.
 *
 * La lista la deriva support/recommendations.ts desde el snapshot del HUD (misma
 * foto que usa la barra): decisión pendiente, ascensor averiado, arcas, reputación,
 * mandato, misión activa y vecinos fríos. Solo presentación: nunca toca el sim.
 */

import { useGameStore } from '@/game/client/store';
import { useT } from '@/game/client/i18n';
import { recommendationsOf, type Reco } from '@/game/support/recommendations';

/** Icono por tipo de recomendación (emoji del propio dialecto del cuaderno). */
const RECO_ICON: Record<Reco['kind'], string> = {
  decision: '⚖️',
  elevator: '🛗',
  funds: '💰',
  repLow: '📌',
  repHigh: '⭐',
  mandate: '🏛️',
  mission: '🎯',
  neighbor: '💬',
  explore: '🚶',
};

export function RecommendationsPanel() {
  const t = useT();
  const elevator = useGameStore((s) => s.elevator);
  const reputation = useGameStore((s) => s.reputation);
  const funds = useGameStore((s) => s.funds);
  const missions = useGameStore((s) => s.missions);
  const campaign = useGameStore((s) => s.campaign);
  const residents = useGameStore((s) => s.residentsUi);

  const recos = recommendationsOf({
    elevator,
    reputation,
    funds,
    missions: missions.map((m) => ({ id: m.id, title: m.title, state: m.state, remaining: m.remaining })),
    campaign,
    neighbors: residents.map((r) => ({ id: r.id, name: r.name, affinity: r.affinity })),
  });

  return (
    <section
      className="rounded-md border border-dashed border-[color:var(--ink-soft)] bg-white/45 p-2.5"
      aria-label={t('reco.aria')}
      data-reco-panel=""
    >
      <h3 className="ink flex items-center gap-1.5 text-xs font-extrabold">
        <span aria-hidden>💡</span> {t('reco.title')}
      </h3>
      <ul className="mt-1.5 space-y-1">
        {recos.map((r, i) => (
          <li key={`${r.kind}-${i}`} className="ink flex items-start gap-1.5 text-xs leading-snug">
            <span className="shrink-0" aria-hidden>
              {RECO_ICON[r.kind]}
            </span>
            <span>{t(`reco.${r.kind}`, r.vars)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
