'use client';

import { useEffect, useRef } from 'react';
import { getController } from '@/game/client/bridge';
import { loadBabylonScript } from '@/game/client/babylon';
import { selectModalOpen, useGameStore } from '@/game/client/store';
import { useT } from '@/game/client/i18n';
import { TEXT_SCALE_PCT } from '@/game/client/options';
import { PhoneModal } from './PhoneModal';
import { ChoicesModal } from './ChoicesModal';
import { JuntaModal } from './JuntaModal';
import { MinigameModal } from './MinigameModal';
import { FinaleModal } from './FinaleModal';
import { CutsceneOverlay } from './CutsceneOverlay';
import { ElevatorPanelModal } from './ElevatorPanelModal';
import { MoneyOverlay } from './MoneyOverlay';
import { ToastStack } from './ToastStack';
import { TouchControls } from './TouchControls';
import { PauseMenu } from './PauseMenu';
import { TutorialCard } from './TutorialCard';
import { MoveRight } from 'lucide-react';

/**
 * v1.40 — Overlay de CONTEXTO GRÁFICO PERDIDO: el navegador nos quitó el WebGL/WebGPU
 * (presión de memoria, pestaña en segundo plano…) y el lienzo se quedó negro. En vez de
 * un juego muerto silencioso, un aviso del tono del barrio + botón de recargar. La partida
 * ya quedó guardada por autoguardado; recargar retoma desde ahí.
 */
function LostOverlay() {
  const t = useT();
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-neutral-950/90 p-4" role="alert">
      <div className="max-w-sm space-y-3 rounded-xl border border-amber-500/30 bg-neutral-900/95 p-5 text-center">
        <p className="text-2xl" aria-hidden>
          🔦
        </p>
        <p className="text-sm font-bold text-amber-300">{t('lost.title')}</p>
        <p className="text-xs leading-relaxed text-neutral-300">{t('lost.text')}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md bg-amber-500 px-4 py-2 text-xs font-bold text-neutral-900 hover:bg-amber-400"
        >
          {t('lost.reload')}
        </button>
      </div>
    </div>
  );
}

/**
 * v1.48 — Flecha animada del LATERAL: la entrada frontal del portal está cerrada; al
 * empujar de frente, esta flecha manda a girar la esquina (la entrada real es la lateral).
 */
function SideHint() {
  const sideHint = useGameStore((s) => s.sideHint);
  if (!sideHint) return null;
  return (
    <div className="pointer-events-none absolute bottom-14 left-1/2 z-20 -translate-x-1/2" role="status" aria-live="polite">
      <div className="flex items-center gap-2 rounded-full border border-amber-400/60 bg-neutral-900/90 px-4 py-2 shadow-lg">
        <MoveRight className="h-5 w-5 animate-bounce text-amber-300" aria-hidden />
        <span className="text-xs font-semibold text-amber-100">{sideHint}</span>
      </div>
    </div>
  );
}

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
  const fpsVisible = useGameStore((s) => s.fpsVisible);
  const fps = useGameStore((s) => s.fps);
  // v1.39 — accesibilidad: tamaño de texto, daltónico y reducir animaciones
  const textScale = useGameStore((s) => s.textScale);
  const colorblind = useGameStore((s) => s.colorblind);
  const reduceMotion = useGameStore((s) => s.reduceMotion);
  // v1.40 — contexto gráfico perdido: overlay amable con recarga (el lienzo negro ya no
  // se queda mudo: dice qué pasó y cómo salir).
  const engineLost = useGameStore((s) => s.engineLost);

  // Tamaño de texto: escala el font-size RAÍZ — toda la partida (chrome y overlays)
  // crece o baja proporcionalmente, como pedía la accesibilidad.
  useEffect(() => {
    document.documentElement.style.fontSize = `${TEXT_SCALE_PCT[textScale]}%`;
    return () => {
      document.documentElement.style.fontSize = '';
    };
  }, [textScale]);

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
    /** Normaliza a códigos físicos: los navegadores reales traen ev.code; algunos eventos
     *  sintéticos (CDP/mandos virtuales) solo ev.key — en MAYÚSCULAS a veces ('W'). */
    const normalize = (ev: KeyboardEvent): string => {
      if (ev.code) return ev.code;
      const k = ev.key;
      const map: Record<string, string> = { a: 'KeyA', d: 'KeyD', w: 'KeyW', s: 'KeyS', e: 'KeyE', j: 'KeyJ', A: 'KeyA', D: 'KeyD', W: 'KeyW', S: 'KeyS', E: 'KeyE', J: 'KeyJ', '0': 'Digit0', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', ' ': 'Space' };
      return map[k] ?? k;
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      // v1.65 — una tecla ya CONSUMIDA por un portal de Radix no llega al juego: los
      // diálogos escuchan Escape en CAPTURA (document) y hacen preventDefault al cerrarse,
      // así que aquí —listener de window en burbuja, SIEMPRE posterior— el estado del store
      // ya cambió. Sin este guard, cerrar el diálogo multijugador (o cualquier Radix) con
      // Escape abría además el menú de pausa detrás (capturado en E2E v1.65, caso A9).
      if (ev.defaultPrevented) return;
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
    <div
      className={'relative w-full overflow-hidden rounded-xl border bg-neutral-900 shadow-sm' + (reduceMotion ? ' game-no-anim' : '')}
      style={{ aspectRatio: '16 / 10' }}
    >
      {/* v1.39 — Filtros de daltonismo (SVG): se aplican sobre el LIENZO vía CSS filter url(). */}
      <svg className="absolute h-0 w-0" aria-hidden="true" focusable="false">
        <defs>
          <filter id="cb-protanopia">
            <feColorMatrix in="SourceGraphic" type="matrix" values="0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0" />
          </filter>
          <filter id="cb-deuteranopia">
            <feColorMatrix in="SourceGraphic" type="matrix" values="0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0" />
          </filter>
          <filter id="cb-tritanopia">
            <feColorMatrix in="SourceGraphic" type="matrix" values="0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0" />
          </filter>
        </defs>
      </svg>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        style={colorblind === 'off' ? undefined : { filter: `url(#cb-${colorblind})` }}
        aria-label="Vista del edificio en Babylon.js"
      />

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

      {engineLost && <LostOverlay />}

      {ready && fpsVisible && (
        <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-amber-200" role="status" aria-live="off">
          {fps} FPS
        </div>
      )}

      {/* Economía siempre visible: arcas del edificio + hucha del jugador (v1.23). */}
      {ready && <MoneyOverlay />}

      {ready && prompt && !modalOpen && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-xs font-medium text-amber-200 shadow" role="status">
          {prompt}
        </div>
      )}

      {/* v1.48 — flecha animada: la entrada frontal está cerrada, gira la esquina. */}
      {ready && !modalOpen && <SideHint />}

      <PhoneModal onNext={() => getController()?.phoneNext()} />
      <CutsceneOverlay />
      <ElevatorPanelModal />
      <ChoicesModal onChoose={(choiceId) => getController()?.choose(choiceId)} />
      <JuntaModal onVote={(vote) => getController()?.juntaVote(vote)} />
      <MinigameModal />
      <FinaleModal onClose={() => getController()?.finaleClose()} />
      <ToastStack onDismiss={(id) => useGameStore.getState().dropToast(id)} />
      <TouchControls />
      {/* v1.39 — tutorial del primer día + menú de pausa de verdad */}
      <TutorialCard />
      <PauseMenu />
    </div>
  );
}
