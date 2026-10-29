'use client';

/**
 * MENÚ DE PAUSA (v1.39) — la pausa de verdad: overlay a pantalla completa con
 * REANUDAR / OPCIONES / GUARDAR / SALIR. Se abre con Escape, con el botón de pausa de la
 * barra y con Start del mando; mientras está abierto el mundo está congelado (store.paused)
 * y la música baja (ducking). «Guardar y salir» persiste la partida e intenta cerrar la
 * pestaña (si el navegador no deja, avisa con un aviso de guardar hecho).
 */

import { useState } from 'react';

import { useGameStore } from '@/game/client/store';
import { getController } from '@/game/client/bridge';
import { useT } from '@/game/client/i18n';
import { OptionsPanel } from './OptionsPanel';

export function PauseMenu() {
  const t = useT();
  const open = useGameStore((s) => s.pauseMenuOpen);
  const ready = useGameStore((s) => s.ready);
  const saveState = useGameStore((s) => s.saveState);
  const savedAt = useGameStore((s) => s.savedAt);
  const [showOptions, setShowOptions] = useState(false);
  const [exiting, setExiting] = useState(false);

  // Al cerrarse el menú, la sección de opciones vuelve a plegarse (ajuste de estado
  // durante el render: el patrón que recomienda React para reaccionar a un cambio propio).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setShowOptions(false);
      setExiting(false);
    }
  }

  if (!open) return null;

  const resume = () => {
    useGameStore.getState().setPauseMenuOpen(false);
    useGameStore.getState().setPaused(false);
  };

  const saveAndExit = async () => {
    setExiting(true);
    const c = getController();
    if (!useGameStore.getState().mpCode) await c?.save();
    // El navegador solo cierra pestañas abiertas por script; si no puede, avisamos.
    window.setTimeout(() => {
      window.close();
      setExiting(false);
      useGameStore
        .getState()
        .pushToast(t('pause.exitFallback'), 'info');
    }, 350);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('pause.title')}
    >
      <div className="w-full max-w-lg rounded-2xl border border-amber-500/25 bg-neutral-900/95 p-6 shadow-2xl">
        <header className="mb-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-500/80">{t('pause.gamePaused')}</p>
          <h2 className="mt-1 text-3xl font-extrabold tracking-tight text-amber-300">VECINOS</h2>
          <p className="mt-1 text-xs text-neutral-400">{t('pause.subtitle')}</p>
        </header>

        <div className="grid gap-2.5">
          <button
            type="button"
            onClick={resume}
            className="w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-neutral-900 transition hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
            autoFocus
          >
            ▶ {t('pause.resume')}
          </button>
          <button
            type="button"
            onClick={() => setShowOptions((v) => !v)}
            aria-expanded={showOptions}
            className="w-full rounded-xl border border-neutral-700 bg-neutral-800/80 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:border-amber-500/40 hover:text-amber-300"
          >
            ⚙ {t('pause.options')}
          </button>
          {showOptions && (
            <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-dashed border-neutral-700 bg-neutral-900/80 p-4">
              <OptionsPanel />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => void getController()?.save()}
              disabled={!ready || saveState === 'saving'}
              className="rounded-xl border border-neutral-700 bg-neutral-800/80 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:border-emerald-500/40 hover:text-emerald-300 disabled:opacity-50"
              title={saveState === 'saved' && savedAt ? t('ctrl.saveTitleSaved', { t: savedAt }) : t('ctrl.saveTitle')}
            >
              {saveState === 'saved' ? '✓' : '💾'} {t('ctrl.save')}
            </button>
            <button
              type="button"
              onClick={() => void saveAndExit()}
              disabled={exiting}
              className="rounded-xl border border-neutral-700 bg-neutral-800/80 px-4 py-2.5 text-sm font-semibold text-neutral-200 transition hover:border-red-500/40 hover:text-red-300 disabled:opacity-50"
            >
              🚪 {t('pause.exit')}
            </button>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-neutral-500">{t('pause.hint')}</p>
      </div>
    </div>
  );
}
