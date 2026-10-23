'use client';

import { useGameStore } from '@/game/client/store';
import { getController } from '@/game/client/bridge';

/**
 * Teatro de cutscenes (Fase D): bandas de cine + subtítulo del beat `line` + salto.
 * Solo presentación: el estado lo pinta el reproductor (src/game/client/cutscene.ts)
 * vía store.cutscene. Con E/Espacio/Enter/Escape (o el botón) se salta la cinemática.
 */
export function CutsceneOverlay() {
  const cutscene = useGameStore((s) => s.cutscene);
  if (!cutscene) return null;

  const skip = () => getController()?.cutsceneSkip();

  return (
    <div className="pointer-events-none absolute inset-0 z-20" role="dialog" aria-label="Cinemática en curso">
      {/* Bandas de cine (aparecen con el teatro montado) */}
      <div className="absolute inset-x-0 top-0 h-[9%] bg-black shadow-lg transition-all duration-500" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 h-[9%] bg-black shadow-lg transition-all duration-500" aria-hidden />

      {/* Subtítulo del beat `line` actual */}
      {cutscene.text !== null && (
        <div className="absolute inset-x-0 bottom-[12%] flex justify-center px-4">
          <div className="max-w-xl rounded-lg bg-black/80 px-4 py-2.5 text-center shadow-xl backdrop-blur-sm">
            {cutscene.speaker && (
              <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-300">{cutscene.speaker}</p>
            )}
            <p className="text-sm leading-snug text-neutral-100">{cutscene.text}</p>
          </div>
        </div>
      )}

      {/* Salto (clicable también en táctil) */}
      <div className="pointer-events-auto absolute right-3 top-[10.5%]">
        <button
          onClick={skip}
          className="rounded-md border border-white/10 bg-black/60 px-3 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:bg-black/85"
          aria-label="Saltar la cinemática"
        >
          Saltar · E
        </button>
      </div>
    </div>
  );
}
