'use client';

/**
 * V1.65 — CUADERNO SOBRE EL ESCENARIO (tercer rediseño del dock de información).
 *
 * Petición del vecino: «prácticamente solo veamos la pantalla de juego» — la barra
 * superior queda en UNA línea (MENÚ · Cámara · Misiones · Edificio · Vecinos · Logros)
 * y el detalle vive en un PANEL que se despliega POR ENCIMA del escenario:
 *   · como mucho la MITAD de la altura de la ventana de juego (rules.view.infoDock),
 *     con barra de scroll vertical propia y scroll fino (nada de scroll de página);
 *   · los subapartados son POSTITS HORIZONTALES con EFECTO DE PASE DE HOJA
 *     (PostitPager: pestañas + flechas + giro 3D hacia el lado que avanzas);
 *   · pincharse FUERA del panel (o Escape) lo oculta y devuelve la pantalla de juego;
 *   · si cambia el estado del juego (misión nueva/conseguida, logro, vecino nuevo,
 *     estado del edificio) una NOTA POSTIT GRANDE con meneo se superpone al botón
 *     (.postit-alert): se pulsa el botón, se consulta el cambio y la alerta se limpia.
 *
 * Componentes: InfoTabButtons (los 4 botones-postit de la barra superior) e
 * InfoOverlay (el panel flotante sobre el GameStage). Estado compartido en el store
 * de zustand (infoTab / infoAlerts) — también accesible para E2E.
 */

import { useEffect, useRef, useState } from 'react';

import { useGameStore, getInfoDockTuning } from '@/game/client/store';
import type { InfoTab } from '@/game/client/store';
import { useT } from '@/game/client/i18n';
import { cn } from '@/lib/utils';
import { AchievementsPanel } from './AchievementsPanel';
import { EventLog } from './EventLog';
import { MissionsPanel } from './MissionsPanel';
import { ParamsPanel } from './ParamsPanel';
import { ProjectCard } from './ProjectCard';
import { RecommendationsPanel } from './RecommendationsPanel';
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

const TABS: ReadonlyArray<{ id: InfoTab; labelKey: string; paper: string; tilt: number; icon: React.ReactNode }> = [
  { id: 'misiones', labelKey: 'dock.tab.missions', paper: 'var(--paper)', tilt: -1.6, icon: <InkTarget /> },
  { id: 'edificio', labelKey: 'dock.tab.building', paper: 'var(--paper-pink)', tilt: 1.2, icon: <InkBuilding /> },
  { id: 'vecinos', labelKey: 'dock.tab.neighbors', paper: 'var(--paper-green)', tilt: -1, icon: <InkPeople /> },
  { id: 'logros', labelKey: 'dock.tab.achievements', paper: 'var(--paper-blue)', tilt: 1.8, icon: <InkTrophy /> },
];

// ── Botones-postit de la barra superior (el panel vive en InfoOverlay) ──

export function InfoTabButtons() {
  const t = useT();
  const infoTab = useGameStore((s) => s.infoTab);
  const alerts = useGameStore((s) => s.infoAlerts);
  const missions = useGameStore((s) => s.missions);
  const achievements = useGameStore((s) => s.achievements);
  const alertsOn = getInfoDockTuning().alerts;

  const activeMissions = missions.filter((m) => m.state === 'active' || m.state === 'awaiting_choice').length;
  const decisions = missions.filter((m) => m.state === 'awaiting_choice').length;
  const unlockedAch = achievements.filter((a) => a.unlocked).length;

  const countBadge = (label: string, pulse?: boolean) => (
    <span
      className={cn(
        // v1.66 — contador más gordo y legible (antes 9px, pasaba desapercibido):
        'rounded-full border px-2 py-px text-[11px] leading-4 font-black tabular-nums',
        pulse
          ? 'animate-pulse border-orange-600/50 bg-orange-100/90 text-orange-700'
          : 'border-amber-600/40 bg-white/85 text-amber-700',
      )}
    >
      {label}
    </span>
  );

  const badgeOf = (id: InfoTab): React.ReactNode => {
    if (id === 'misiones' && activeMissions > 0) return countBadge(String(activeMissions), decisions > 0);
    if (id === 'logros' && achievements.length > 0) return countBadge(`${unlockedAch}/${achievements.length}`);
    return null;
  };

  return (
    <div role="tablist" aria-label={t('dock.title')} className="mt-2.5 flex items-start gap-2.5">
      {TABS.map((x) => {
        const selected = infoTab === x.id;
        const alertCount = alerts[x.id];
        return (
          <button
            key={x.id}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`info-panel-${x.id}`}
            data-info-tab-btn={x.id}
            aria-label={t(x.labelKey)}
            title={t('dock.toggleHint')}
            className={cn('postit sketchy !h-[58px] !w-[58px]', alertsOn && alertCount > 0 && 'postit-alert-ring')}
            style={{ background: x.paper, transform: selected ? 'scale(1.08) rotate(0deg)' : `rotate(${x.tilt}deg)` }}
            onClick={() => {
              const store = useGameStore.getState();
              store.setInfoTab(selected ? null : x.id);
              store.clearInfoAlert(x.id); // consultar el apartado limpia su alerta
            }}
          >
            {x.icon}
            <span className="text-[10px] leading-none font-bold">{t(x.labelKey)}</span>
            {badgeOf(x.id)}
            {alertsOn && alertCount > 0 && (
              <span className="postit-alert sketchy-thin" aria-label={t('dock.alertAria', { n: alertCount, tab: t(x.labelKey) })}>
                {alertCount > 1 ? alertCount : '!'}
              </span>
            )}
          </button>
        );
      })}
      <p className="ink mt-1.5 ml-1 hidden max-w-44 text-[11px] leading-tight opacity-60 lg:block">{t('dock.hint')}</p>
    </div>
  );
}

// ── Pase de hoja: subapartados como postits horizontales ──

interface PagerPage {
  id: string;
  labelKey: string;
  content: React.ReactNode;
}

function PostitPager({ pages }: { pages: PagerPage[] }) {
  const t = useT();
  const reduceMotion = useGameStore((s) => s.reduceMotion);
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const safeIdx = Math.min(idx, pages.length - 1);
  const go = (n: number) => {
    const next = Math.max(0, Math.min(pages.length - 1, n));
    if (next === safeIdx) return;
    setDir(next > safeIdx ? 1 : -1);
    setIdx(next);
  };
  const page = pages[safeIdx]!;
  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="tablist" aria-label={t('dock.title')}>
        {pages.map((p, i) => (
          <button
            key={p.id}
            role="tab"
            type="button"
            aria-selected={i === safeIdx}
            className="postit-btn sketchy-thin"
            data-active={i === safeIdx || undefined}
            aria-label={t('pager.pageAria', { n: i + 1, total: pages.length })}
            onClick={() => go(i)}
          >
            {t(p.labelKey)}
          </button>
        ))}
        <span className="ink ml-auto text-[10px] font-bold tabular-nums opacity-60" aria-hidden>
          {safeIdx + 1}/{pages.length}
        </span>
        <button type="button" className="postit-btn sketchy-thin !px-2" aria-label={t('pager.prev')} disabled={safeIdx === 0} onClick={() => go(safeIdx - 1)}>
          ‹
        </button>
        <button type="button" className="postit-btn sketchy-thin !px-2" aria-label={t('pager.next')} disabled={safeIdx === pages.length - 1} onClick={() => go(safeIdx + 1)}>
          ›
        </button>
      </div>
      <div style={{ perspective: '900px' }}>
        <div key={page.id} className={reduceMotion ? undefined : dir === 1 ? 'pageflip-next' : 'pageflip-prev'} data-pager-page={page.id}>
          {page.content}
        </div>
      </div>
    </div>
  );
}

// ── Panel flotante sobre el escenario (la mitad de la ventana de juego, como mucho) ──

export function InfoOverlay() {
  const t = useT();
  const tab = useGameStore((s) => s.infoTab);
  const reduceMotion = useGameStore((s) => s.reduceMotion);
  const objective = useGameStore((s) => s.objective);
  const prompt = useGameStore((s) => s.prompt);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Pinchar fuera del panel (o Escape) lo oculta: solo pantalla de juego.
  // Los botones-postit de la barra y los portales de Radix NO cuentan como «fuera».
  useEffect(() => {
    if (!tab) return;
    const onDown = (ev: PointerEvent) => {
      const target = ev.target as Node | null;
      if (overlayRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-info-tab-btn], [data-radix-popper-content-wrapper], [role="dialog"], [role="listbox"], [role="menu"]')) return;
      useGameStore.getState().setInfoTab(null);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') useGameStore.getState().setInfoTab(null);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [tab]);

  const tuning = getInfoDockTuning();
  const activeTab = TABS.find((x) => x.id === tab) ?? null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 bottom-1 z-30 flex items-start justify-center px-2">
      {activeTab && (
        <div
          ref={overlayRef}
          id={`info-panel-${activeTab.id}`}
          role="tabpanel"
          aria-label={t(activeTab.labelKey)}
          data-info-overlay={activeTab.id}
          className="pointer-events-auto flex w-full max-w-3xl flex-col sketchy p-3 shadow-xl"
          style={{
            background: activeTab.paper,
            maxHeight: `${tuning.overlayMaxHFactor * 100}%`,
            animation: reduceMotion ? undefined : 'postit-pop 0.16s ease-out',
          }}
        >
          <header className="flex items-center gap-2">
            {activeTab.icon}
            <h2 className="ink text-sm font-extrabold">{t(activeTab.labelKey)}</h2>
            <button
              type="button"
              className="postit-btn sketchy-thin ml-auto !px-2"
              aria-label={t('dock.close')}
              onClick={() => useGameStore.getState().setInfoTab(null)}
            >
              ✕
            </button>
          </header>
          <div className="info-scroll mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
            {activeTab.id === 'misiones' && (
              <div className="flex flex-col gap-2.5">
                {/* El objetivo «ahora mismo» sobrevive aquí (la franja inferior se retira en v1.65) */}
                {objective && (
                  <p className="ink flex items-center gap-1.5 text-xs font-semibold" aria-live="polite">
                    <span aria-hidden>🎯</span> {objective.title}
                    <span className="font-normal opacity-70">{objective.text}</span>
                  </p>
                )}
                {prompt && (
                  <p className="ink flex items-center gap-1.5 text-xs font-semibold opacity-80">
                    <span aria-hidden>⌨</span> {prompt}
                  </p>
                )}
                {/* v1.84 — las ÚLTIMAS RECOMENDACIONES viven aquí arriba: se abre Misiones
                    y lo primero que se lee es qué conviene hacer ahora mismo. */}
                <RecommendationsPanel />
                <PostitPager
                  pages={[
                    { id: 'curso', labelKey: 'missions.page.active', content: <MissionsPanel filter="active" fill /> },
                    { id: 'archivo', labelKey: 'missions.page.archive', content: <MissionsPanel filter="archive" fill /> },
                  ]}
                />
              </div>
            )}
            {activeTab.id === 'edificio' && (
              <div className="flex flex-col gap-2.5">
                <PostitPager
                  pages={[
                    {
                      id: 'params',
                      labelKey: 'edificio.page.params',
                      content: (
                        <div className="flex flex-col gap-2.5">
                          <ParamsPanel />
                          {/* v1.62 — la antigua pestaña "Mi casa" (en reforma) conserva su nota aquí */}
                          <p className="ink flex items-start gap-2 rounded-md border border-dashed border-[color:var(--ink-soft)] bg-white/45 p-2.5 text-xs leading-relaxed opacity-85">
                            <span aria-hidden="true">🏠</span>
                            {t('casa.retired')}
                          </p>
                        </div>
                      ),
                    },
                    { id: 'log', labelKey: 'edificio.page.log', content: <EventLog fill /> },
                    { id: 'proyecto', labelKey: 'edificio.page.project', content: <ProjectCard /> },
                  ]}
                />
              </div>
            )}
            {activeTab.id === 'vecinos' && <ResidentsPanel fill />}
            {activeTab.id === 'logros' && (
              <PostitPager
                pages={[
                  { id: 'ganados', labelKey: 'ach.page.unlocked', content: <AchievementsPanel filter="unlocked" fill /> },
                  { id: 'pendientes', labelKey: 'ach.page.locked', content: <AchievementsPanel filter="locked" fill /> },
                ]}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
