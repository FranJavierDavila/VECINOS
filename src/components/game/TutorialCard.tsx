'use client';

/**
 * TARJETA DEL TUTORIAL (v1.39) — onboarding «primer día»: tarjeta de papel no bloqueante
 * en la esquina inferior izquierda del lienzo. Muestra la bienvenida, el paso vigente o el
 * cierre; con puntos de progreso y botón de omitir. El estado vive en el store
 * (game/client/tutorial.ts) y se persiste en el perfil del navegador.
 */

import { useGameStore } from '@/game/client/store';
import { useT } from '@/game/client/i18n';
import { getTutorial } from '@/game/client/tutorial';

export function TutorialCard() {
  const t = useT();
  const tut = useGameStore((s) => s.tutorial);
  const ready = useGameStore((s) => s.ready);
  const modalOpen = useGameStore((s) => s.phone !== null || s.choices !== null || s.junta !== null || s.minigame !== null || s.finale !== null || s.cutscene !== null || s.elevatorPanel !== null);
  const pauseMenuOpen = useGameStore((s) => s.pauseMenuOpen);
  if (!ready || !tut || modalOpen || pauseMenuOpen) return null;

  return (
    <aside
      className="absolute bottom-3 left-3 z-20 max-w-[300px] rounded-lg border border-amber-600/30 bg-[#fef9a7] p-3 text-[#3d3320] shadow-lg sketchy"
      aria-live="polite"
      aria-label={t('tutorial.aria')}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-lg leading-none" aria-hidden>
          {tut.icon}
        </span>
        {tut.mode === 'step' && (
          <span className="flex items-center gap-1" aria-label={t('tutorial.stepOf', { n: tut.index + 1, total: tut.total })}>
            {Array.from({ length: tut.total }, (_, i) => (
              <span
                key={i}
                className={'h-1.5 w-1.5 rounded-full ' + (i < tut.index ? 'bg-emerald-600' : i === tut.index ? 'bg-amber-600' : 'bg-amber-900/25')}
                aria-hidden
              />
            ))}
            <span className="ml-1 text-[10px] font-semibold opacity-70">
              {tut.index + 1}/{tut.total}
            </span>
          </span>
        )}
        <button
          type="button"
          onClick={() => getTutorial()?.skip()}
          className="ml-auto rounded border border-dashed border-amber-700/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900/80 hover:bg-amber-200/60"
          aria-label={t('tutorial.skip')}
        >
          {t('tutorial.skip')}
        </button>
      </div>
      <p className="text-xs font-bold leading-snug">{tut.title}</p>
      {tut.text && <p className="mt-1 text-[11px] leading-relaxed opacity-90">{tut.text}</p>}
      {tut.cta && (
        <button
          type="button"
          onClick={() => getTutorial()?.acceptWelcome()}
          className="mt-2 rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-neutral-900 hover:bg-amber-400"
        >
          {tut.cta}
        </button>
      )}
    </aside>
  );
}
