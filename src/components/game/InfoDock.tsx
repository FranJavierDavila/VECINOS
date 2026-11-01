'use client';

/**
 * V1.62 — CUADERNO DEL VECINO (rediseño del dock de información).
 *
 * Problema (petición del vecino): demasiados apartados con mucha información —
 * Misiones, Edificio, Vecinos, Mi casa y Logros — y la Ayuda inferior DUPLICADA
 * (ya existe el post-it de ayuda en la barra superior).
 *
 * Referencia (juegos superventas que manejan mucha información):
 *   · Stardew Valley / Cities: Skylines — UNA barra de pestañas con iconos y
 *     contadores; el detalle vive a un clic, el HUD no se satura.
 *   · Los Sims / Animal Crossing — el resumen "ahora mismo" siempre visible
 *     (aquí: MissionTracker y ProjectCard encima) y los paneles grandes bajo
 *     demanda con badges que avisan CUÁNDO conviene mirar.
 *
 * Solución (manteniendo la estructura de post-it para dar uniformidad a todo):
 *   · 4 PESTAÑAS-POSTIT (icono a bolígrafo + etiqueta + badge en vivo):
 *     Misiones · Edificio · Vecinos · Logros.
 *   · FUERA la pestaña Ayuda (duplicada del post-it superior) y FUERA "Mi casa"
 *     (su nota de reforma conserva un hueco dentro de EDIFICIO — cero pérdida).
 *   · FUERA la tarjeta de objetivo (su texto es el MISMO que la franja
 *     MissionTracker SIEMPRE visible justo encima; la pista de teclado se
 *     conserva como línea compacta en Misiones).
 *   · El cuaderno se PLEGA al volver a pulsar la pestaña activa: HUD limpio sin
 *     perder información (los badges siguen contando en las pestañas).
 */

import { useCallback, useState } from 'react';

import { useGameStore } from '@/game/client/store';
import { useT } from '@/game/client/i18n';
import { cn } from '@/lib/utils';
import { AchievementsPanel } from './AchievementsPanel';
import { EventLog } from './EventLog';
import { MissionsPanel } from './MissionsPanel';
import { ParamsPanel } from './ParamsPanel';
import { ResidentsPanel } from './ResidentsPanel';

// ── Tinta a bolígrafo: iconos garabateados (mismo trazo que PostItControls) ──

const INK = '#274b8f';

const svgProps = () => ({
  width: 26,
  height: 26,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: INK,
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
});

/** Diana garabateada (misiones). */
function InkTarget() {
  return (
    <svg {...svgProps()}>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="4.7" />
      <circle cx="12" cy="12" r="1.2" />
      <path d="M17.5 6.5l4-4m-2.2-.4l.5 2 2 .4" />
    </svg>
  );
}

/** Bloque de pisos a mano (edificio). */
function InkBuilding() {
  return (
    <svg {...svgProps()}>
      <path d="M5.4 20.4V5.2c4.3-.4 8.7-.4 13.1 0v15.2" />
      <path d="M3.6 20.5c5.6-.3 11.2-.3 16.8 0" />
      <path d="M8.6 8.4h1.6m3.6 0h1.6M8.6 12h1.6m3.6 0h1.6M8.6 15.6h1.6m3.6 0h1.6" />
      <path d="M11.2 20.3v-3.1l1.7-.1v3.2" />
    </svg>
  );
}

/** Dos vecinos charlando (mismo garabato que el post-it de jugadores). */
function InkPeople() {
  return (
    <svg {...svgProps()}>
      <circle cx="8.6" cy="8" r="3" />
      <path d="M3.4 19c.4-4 2.6-6 5.2-6 2.6 0 4.8 2 5.2 6" />
      <circle cx="16.4" cy="9.2" r="2.4" />
      <path d="M15.4 12.6c2.8-.4 4.9 1.6 5.3 5.2" />
    </svg>
  );
}

/** Copa garabateada (logros). */
function InkTrophy() {
  return (
    <svg {...svgProps()}>
      <path d="M8 4.4c2.7-.3 5.4-.3 8 0 .3 3.4-.6 6.2-2.5 7.4a4 4 0 0 1-3 0C8.6 10.6 7.7 7.8 8 4.4z" />
      <path d="M8 5.6c-1.8-.2-3 .6-3 2.1 0 1.6 1.3 2.7 3.2 2.9M16 5.6c1.8-.2 3 .6 3 2.1 0 1.6-1.3 2.7-3.2 2.9" />
      <path d="M12 12.6v3.2m-3 2.4c1.9-.4 4.1-.4 6 0" />
    </svg>
  );
}

// ── Pestañas del cuaderno ──

type TabId = 'misiones' | 'edificio' | 'vecinos' | 'logros';

const TABS: ReadonlyArray<{ id: TabId; labelKey: string; paper: string; tilt: number; icon: React.ReactNode }> = [
  { id: 'misiones', labelKey: 'dock.tab.missions', paper: 'var(--paper)', tilt: -1.6, icon: <InkTarget /> },
  { id: 'edificio', labelKey: 'dock.tab.building', paper: 'var(--paper-pink)', tilt: 1.2, icon: <InkBuilding /> },
  { id: 'vecinos', labelKey: 'dock.tab.neighbors', paper: 'var(--paper-green)', tilt: -1, icon: <InkPeople /> },
  { id: 'logros', labelKey: 'dock.tab.achievements', paper: 'var(--paper-blue)', tilt: 1.8, icon: <InkTrophy /> },
];

export function InfoDock() {
  const t = useT();
  // v1.62: pestaña activa (null = cuaderno plegado). Por defecto Misiones abierta,
  // como antes — primera vez, la partida a la vista.
  const [tab, setTab] = useState<TabId | null>('misiones');
  const missions = useGameStore((s) => s.missions);
  const achievements = useGameStore((s) => s.achievements);
  const prompt = useGameStore((s) => s.prompt);

  const activeMissions = missions.filter((m) => m.state === 'active' || m.state === 'awaiting_choice').length;
  const decisions = missions.filter((m) => m.state === 'awaiting_choice').length;
  const unlockedAch = achievements.filter((a) => a.unlocked).length;

  const toggle = useCallback((id: TabId) => setTab((cur) => (cur === id ? null : id)), []);

  const countBadge = (label: string, pulse?: boolean) => (
    <span
      className={cn(
        'rounded-full border border-amber-600/25 bg-white/70 px-1.5 text-[9px] leading-4 font-bold text-amber-700',
        pulse && 'animate-pulse border-orange-600/30 text-orange-700',
      )}
    >
      {label}
    </span>
  );

  const badgeOf = (id: TabId): React.ReactNode => {
    if (id === 'misiones' && activeMissions > 0) return countBadge(String(activeMissions), decisions > 0);
    if (id === 'logros' && achievements.length > 0) return countBadge(`${unlockedAch}/${achievements.length}`);
    return null;
  };

  const activeTab = TABS.find((x) => x.id === tab);

  return (
    <section className="postit-bar sketchy rounded-xl p-3" aria-label={t('dock.title')}>
      <h2 className="ink sr-only">{t('dock.title')}</h2>

      {/* ── Pestañas post-it (uniformes con la barra de mandos superior) ── */}
      <div role="tablist" aria-label={t('dock.title')} className="flex flex-wrap items-start gap-2.5">
        {TABS.map((x) => {
          const selected = tab === x.id;
          return (
            <button
              key={x.id}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`dock-panel-${x.id}`}
              aria-label={t(x.labelKey)}
              title={t('dock.toggleHint')}
              className="postit sketchy !h-[58px] !w-[58px]"
              style={{ background: x.paper, transform: selected ? 'scale(1.08) rotate(0deg)' : `rotate(${x.tilt}deg)` }}
              onClick={() => toggle(x.id)}
            >
              {x.icon}
              <span className="text-[10px] leading-none font-bold">{t(x.labelKey)}</span>
              {badgeOf(x.id)}
            </button>
          );
        })}
        <p className="ink mt-1.5 ml-1 hidden max-w-52 text-[11px] leading-tight opacity-60 sm:block">
          {t('dock.hint')}
        </p>
      </div>

      {/* ── Panel del cuaderno (el post-it activo "crece" hacia abajo) ── */}
      {activeTab && (
        <div
          id={`dock-panel-${activeTab.id}`}
          role="tabpanel"
          aria-label={t(activeTab.labelKey)}
          className="sketchy mt-3 p-3"
          style={{ background: activeTab.paper, animation: 'postit-pop 0.16s ease-out' }}
        >
          {activeTab.id === 'misiones' && (
            <div className="flex flex-col gap-3">
              {/* v1.62 — la pista de teclado de la tarjeta de objetivo sobrevive aquí:
                  el objetivo en sí ya vive SIEMPRE visible en la franja MissionTracker. */}
              {prompt && (
                <p className="ink flex items-center gap-1.5 text-xs font-semibold opacity-80">
                  <span aria-hidden>⌨</span> {prompt}
                </p>
              )}
              <MissionsPanel />
            </div>
          )}
          {activeTab.id === 'edificio' && (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 lg:grid-cols-2">
                <ParamsPanel />
                <EventLog />
              </div>
              {/* v1.62 — la antigua pestaña "Mi casa" (en reforma) conserva su nota aquí:
                  misma información, un apartado menos en el cuaderno. */}
              <p className="ink flex items-start gap-2 rounded-md border border-dashed border-[color:var(--ink-soft)] bg-white/45 p-2.5 text-xs leading-relaxed opacity-85">
                <span aria-hidden="true">🏠</span>
                {t('casa.retired')}
              </p>
            </div>
          )}
          {activeTab.id === 'vecinos' && <ResidentsPanel />}
          {activeTab.id === 'logros' && <AchievementsPanel />}
        </div>
      )}
    </section>
  );
}
