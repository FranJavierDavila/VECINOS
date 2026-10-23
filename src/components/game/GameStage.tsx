'use client';

import { useEffect, useRef } from 'react';
import { getController } from '@/game/client/bridge';
import { loadBabylonScript } from '@/game/client/babylon';
import { selectModalOpen, useGameStore } from '@/game/client/store';
import { PhoneModal } from './PhoneModal';
import { ChoicesModal } from './ChoicesModal';
import { JuntaModal } from './JuntaModal';
import { MinigameModal } from './MinigameModal';
import { FinaleModal } from './FinaleModal';
import { ToastStack } from './ToastStack';
import { TouchControls } from './TouchControls';

/**
 * Lienzo Babylon con overlays: aviso contextual, modales y toasts. Conecta el teclado.
 * El controlador (y Babylon vía CDN) se cargan perezosamente en el cliente:
 * el servidor nunca toca el motor, así el sandbox no se queda sin memoria.
 */
export default function GameStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prompt = useGameStore((s) => s.prompt);
  const ready = useGameStore((s) => s.ready);
  const engineError = useGameStore((s) => s.engineError);
  const modalOpen = useGameStore(selectModalOpen);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;

    void (async () => {
      try {
        await loadBabylonScript();
        const mod = await import('@/game/client/controller');
        if (disposed) return;
        mod.createGameController(canvas);
      } catch (err) {
        console.error('Fallo al arrancar el juego', err);
        if (!disposed) useGameStore.getState().setEngineError(true);
      }
    })();

    const gameKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
    /** Normaliza a códigos físicos: los navegadores reales traen ev.code; algunos eventos sintéticos solo ev.key. */
    const normalize = (ev: KeyboardEvent): string => {
      if (ev.code) return ev.code;
      const k = ev.key;
      const map: Record<string, string> = { a: 'KeyA', d: 'KeyD', w: 'KeyW', s: 'KeyS', e: 'KeyE', A: 'KeyA', D: 'KeyD', W: 'KeyW', S: 'KeyS', E: 'KeyE', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', ' ': 'Space' };
      return map[k] ?? k;
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      const code = normalize(ev);
      if (gameKeys.has(code) && !selectModalOpen(useGameStore.getState())) ev.preventDefault();
      getController()?.onKeyDown(code);
    };
    const onKeyUp = (ev: KeyboardEvent) => getController()?.onKeyUp(normalize(ev));
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      disposed = true;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return (
    <div className="relative w-full overflow-hidden rounded-xl border bg-neutral-900 shadow-sm" style={{ aspectRatio: '16 / 10' }}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" aria-label="Vista del edificio en Babylon.js" />

      {!ready && !engineError && (
        <div className="absolute inset-0 grid place-items-center bg-neutral-900 text-neutral-100">
          <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" aria-hidden="true" />
            <p className="text-sm text-neutral-300">Encendiendo las luces del portal…</p>
          </div>
        </div>
      )}

      {engineError && (
        <div className="absolute inset-0 grid place-items-center bg-neutral-900 text-neutral-100">
          <div className="max-w-sm space-y-2 px-4 text-center">
            <p className="text-base font-semibold text-amber-300">El portal está a oscuras</p>
            <p className="text-sm text-neutral-300">No se pudo cargar el motor 3D (Babylon.js por CDN). Comprueba la conexión y recarga la página.</p>
            <button onClick={() => window.location.reload()} className="mt-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-amber-400">
              Reintentar
            </button>
          </div>
        </div>
      )}

      {ready && prompt && !modalOpen && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-xs font-medium text-amber-200 shadow" role="status">
          {prompt}
        </div>
      )}

      <PhoneModal onNext={() => getController()?.phoneNext()} />
      <ChoicesModal onChoose={(choiceId) => getController()?.choose(choiceId)} />
      <JuntaModal onVote={(vote) => getController()?.juntaVote(vote)} />
      <MinigameModal />
      <FinaleModal onClose={() => getController()?.finaleClose()} />
      <ToastStack onDismiss={(id) => useGameStore.getState().dropToast(id)} />
      <TouchControls />
    </div>
  );
}
