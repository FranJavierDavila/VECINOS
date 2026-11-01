'use client';

/**
 * V1.66 — BANNER DE MÁXIMA PRIORIDAD sobre el escenario (misión/logro/decisión).
 *
 * Petición del vecino: «las marcas de misiones y logros mucho más evidentes… marcan la
 * evolución del juego y sus objetivos, deben ser algo de máxima prioridad». Los badges
 * post-it de la barra (v1.65) se quedan cortos: quien juega mira EL JUEGO, no la barra.
 * Este banner es un POST-IT GIGANTE centrado sobre el escenario que anuncia UNO a UNO
 * los acontecimientos gordos de la partida:
 *
 *   · misión nueva · misión conseguida · misión fallida · decisión pendiente · logro
 *
 * La cola vive en el store (priorityQueue, cap rules.view.infoDock.bannerQueueMax) y la
 * alimenta el controlador en handleEvents/syncAchievements. Cada aviso permanece
 * bannerShowMs (catálogo) y sale SOLO — o antes con «Abrir» (abre su pestaña del cuaderno
 * y limpia su alerta de la barra) o con ✕. role=alert para lectores de pantalla; con
 * reduce-motion el meneo desaparece (globals.css). QA: data-priority-banner/kind.
 */

import { useEffect } from 'react';

import { getInfoDockTuning, useGameStore } from '@/game/client/store';
import type { PriorityKind } from '@/game/client/store';
import { useT } from '@/game/client/i18n';
import { cn } from '@/lib/utils';

/** Papel y tinta de cada clase de aviso (mismo dialecto post-it que ToastStack). */
const KIND_PAPER: Record<PriorityKind, { paper: string; ink: string; tape: string; emoji: string }> = {
  mission_new: { paper: '#fef9a7', ink: '#3b3129', tape: '#e8d75a', emoji: '📌' },
  mission_done: { paper: '#d4f0c0', ink: '#2c4327', tape: '#b5dd9c', emoji: '🎉' },
  mission_failed: { paper: '#fdd9e0', ink: '#57252f', tape: '#f4b8c6', emoji: '⚠️' },
  decision: { paper: '#ffd9a8', ink: '#4a2c12', tape: '#f2bf80', emoji: '⚖️' },
  achievement: { paper: '#cfe6f7', ink: '#1e3a5c', tape: '#a9cdeb', emoji: '🏆' },
};

export function PriorityBanner() {
  const t = useT();
  const first = useGameStore((s) => s.priorityQueue[0] ?? null);

  // Cadencia del catálogo: cada aviso vive bannerShowMs y sale SOLO (el timer se rearma
  // por id — si entra otro aviso, el anterior completa su ciclo y este espera su turno).
  useEffect(() => {
    if (!first) return;
    const h = setTimeout(() => useGameStore.getState().shiftPriorityBanner(), getInfoDockTuning().bannerShowMs);
    return () => clearTimeout(h);
  }, [first?.id]);

  if (!first) return null;
  const k = KIND_PAPER[first.kind];

  // «Abrir»: lleva la pestaña del cuaderno correspondiente y limpia su alerta de la barra.
  const open = () => {
    const st = useGameStore.getState();
    st.setInfoTab(first.tab);
    st.clearInfoAlert(first.tab);
    st.shiftPriorityBanner();
  };

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-40 w-[min(94%,30rem)] -translate-x-1/2" role="alert" aria-live="assertive">
      <div
        data-priority-banner="1"
        data-priority-kind={first.kind}
        aria-label={t('banner.aria', { t: `${first.title} ${first.text}` })}
        className="priority-banner pointer-events-auto cursor-pointer select-none"
        onClick={open}
      >
        {/* Cinta adhesiva (el papelito clavado en el cristal del escenario) */}
        <span
          aria-hidden
          className="absolute -top-2.5 left-1/2 z-10 h-5 w-24 -translate-x-1/2 -rotate-2 rounded-[2px]"
          style={{ background: 'rgba(255,255,255,0.55)', boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }}
        />
        <div
          className="priority-banner-paper sketchy px-5 py-4 shadow-[0_10px_22px_rgba(0,0,0,0.32)]"
          style={{
            background: `linear-gradient(180deg, ${k.paper} 0%, ${k.paper} 76%, ${k.tape} 100%)`,
            color: k.ink,
            transformOrigin: '50% 0%',
          }}
        >
          <div className="flex items-start gap-3">
            <span className="text-4xl leading-none" aria-hidden>
              {k.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base leading-tight font-extrabold tracking-wide uppercase">{first.title}</p>
              <p className="mt-0.5 text-sm leading-snug font-medium">{first.text}</p>
            </div>
            <button
              type="button"
              className="-mr-1 -mt-1 shrink-0 rounded px-1.5 text-lg leading-none font-bold opacity-60 hover:opacity-100"
              aria-label={t('banner.dismiss')}
              onClick={(e) => {
                e.stopPropagation();
                useGameStore.getState().shiftPriorityBanner();
              }}
            >
              ✕
            </button>
          </div>
          <button
            type="button"
            className={cn(
              'postit-btn sketchy-thin mt-2.5 w-full !justify-center !py-1.5 !text-xs !font-extrabold uppercase tracking-wide',
            )}
            aria-label={t('banner.openAria', { tab: first.title })}
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
          >
            {t('banner.open')} →
          </button>
        </div>
      </div>
    </div>
  );
}
