'use client';

/**
 * Mandos táctiles del juego: stick virtual (izquierda, abajo) y botones de
 * acción/cámara (derecha, abajo). 100% data-driven: deadzone, tamaños del pad
 * y etiquetas salen de rules.touch (catálogo); aquí no se escribe ni un número
 * ni un texto de gameplay.
 *
 * Visibilidad: store.touchVisible, con auto-detección en la primera visita
 * (pantalla táctil) y preferencia persistida en localStorage('vecinos.touch').
 * Se monta sobre el lienzo relativo de GameStage. Con un modal abierto el
 * mundo está congelado: los mandos ignoran toda entrada en el momento del evento.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { loadContent } from '@/game/content';
import { getController } from '@/game/client/bridge';
import { selectModalOpen, useGameStore, type CamMode } from '@/game/client/store';
import type { Rules } from '@/game/core/types';

// ───────────────────────── Config del catálogo (rules.touch) ─────────────────────────

type TouchConfig = Rules['touch'];

/** Direcciones mantenidas que se envían al puente (se combinan con el teclado). */
interface TouchDirs {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

const DIRS_RELEASED: TouchDirs = { left: false, right: false, up: false, down: false };

/** v1.65 — ciclo de cámara del botón 🎥: de CERCA a LEJOS + espía (teclas 1-5 del teclado). */
const CAM_ORDER: readonly CamMode[] = ['estancia', 'planta', 'edificio', 'fachada', 'espia'];

/** Clave de la preferencia persistida (la escribe store.setTouchControls). */
const TOUCH_KEY = 'vecinos.touch';

/** Defaults defensivos mientras loadContent() resuelve (o si el catálogo falla). */
const DEFAULT_TOUCH: TouchConfig = {
  deadzone: 0.35,
  stick: { base: 124, thumb: 52 },
  labels: { interact: '✋', camera: '🎥', move: 'Mover' },
  hint: '',
};

// ───────────────────────── Componente ─────────────────────────

export function TouchControls() {
  const visible = useGameStore((s) => s.touchVisible);
  const [touch, setTouch] = useState<TouchConfig>(DEFAULT_TOUCH);

  /** Espejo de la config para los handlers: callbacks estables sin cierre obsoleto. */
  const touchRef = useRef<TouchConfig>(touch);

  // ── Preferencia persistida / auto-detección (una sola vez al montar) ──
  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    let stored: string | null = null;
    try {
      stored = localStorage.getItem(TOUCH_KEY);
    } catch {
      /* almacenamiento no disponible: decidir solo con la auto-detección */
    }
    if (stored !== null) {
      // Preferencia previa del usuario: restaurar solo si lo dejó activado.
      if (stored === '1') useGameStore.getState().setTouchControls(true);
      return;
    }
    // Primera visita: mandos visibles solo en pantallas táctiles.
    const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    useGameStore.getState().setTouchControls(coarse);
  }, []);

  // ── Catálogo: rules.touch (una vez; mientras llega, defaults defensivos) ──
  useEffect(() => {
    let cancelled = false;
    loadContent()
      .then(({ content }) => {
        if (cancelled) return;
        touchRef.current = content.rules.touch;
        setTouch(content.rules.touch);
      })
      .catch(() => {
        /* sin catálogo: los mandos funcionan con los defaults (el motor ya avisa del fallo) */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Stick virtual: refs de arrastre ──
  const baseRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  /** pointerId del dedo activo en el stick (null = sin arrastre). */
  const activePointerRef = useRef<number | null>(null);
  /** Última dirección enviada al puente (para no llamar setTouchInput si no cambia). */
  const dirsRef = useRef<TouchDirs>(DIRS_RELEASED);
  /** Rect de la base cacheado en pointerdown (evita leer layout en cada move). */
  const baseRectRef = useRef<DOMRect | null>(null);

  /** Suelta el stick: pulgar al centro y cero direcciones. Idempotente por pointerId. */
  const releaseStick = useCallback((pointerId: number | null) => {
    if (activePointerRef.current === null) return;
    if (pointerId !== null && activePointerRef.current !== pointerId) return;
    try {
      baseRef.current?.releasePointerCapture(activePointerRef.current);
    } catch {
      /* la captura ya no existe (elemento desmontado o liberada antes) */
    }
    activePointerRef.current = null;
    baseRectRef.current = null;
    if (thumbRef.current) thumbRef.current.style.transform = 'translate3d(0px, 0px, 0px)';
    dirsRef.current = DIRS_RELEASED;
    getController()?.setTouchInput(DIRS_RELEASED);
  }, []);

  /** Recalcula pulgar y direcciones desde las coordenadas del puntero. */
  const updateStick = useCallback((clientX: number, clientY: number) => {
    const rect = baseRectRef.current;
    const thumb = thumbRef.current;
    if (!rect) return;

    const { base: baseSize, thumb: thumbSize } = touchRef.current.stick;
    const max = Math.max(1, (baseSize - thumbSize) / 2); // radio de recorrido del pulgar

    // Desplazamiento respecto al centro, normalizado a 0..1 y con magnitud acotada.
    let nx = (clientX - (rect.left + rect.width / 2)) / max;
    let ny = (clientY - (rect.top + rect.height / 2)) / max; // dy positivo hacia abajo
    const mag = Math.hypot(nx, ny);
    if (mag > 1) {
      nx /= mag;
      ny /= mag;
    }

    if (thumb) thumb.style.transform = `translate3d(${(nx * max).toFixed(1)}px, ${(ny * max).toFixed(1)}px, 0px)`;

    const dead = touchRef.current.deadzone;
    const next: TouchDirs = {
      left: nx < -dead,
      right: nx > dead,
      up: ny < -dead,
      down: ny > dead,
    };
    const prev = dirsRef.current;
    if (prev.left === next.left && prev.right === next.right && prev.up === next.up && prev.down === next.down) return;
    dirsRef.current = next;
    getController()?.setTouchInput(next);
  }, []);

  const onStickPointerDown = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>) => {
      if (activePointerRef.current !== null) return; // ya hay un dedo en el stick
      if (selectModalOpen(useGameStore.getState())) return; // mundo congelado: ignorar
      ev.preventDefault(); // sin scroll ni doble disparo (touch sintético)
      const base = baseRef.current;
      if (!base) return;
      try {
        base.setPointerCapture(ev.pointerId);
      } catch {
        /* algunos navegadores lo rechazan: los move seguirán llegando mientras el dedo esté encima */
      }
      activePointerRef.current = ev.pointerId;
      baseRectRef.current = base.getBoundingClientRect();
      updateStick(ev.clientX, ev.clientY);
    },
    [updateStick],
  );

  const onStickPointerMove = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>) => {
      if (activePointerRef.current !== ev.pointerId) return;
      if (selectModalOpen(useGameStore.getState())) return; // congelado: no enviar direcciones
      updateStick(ev.clientX, ev.clientY);
    },
    [updateStick],
  );

  const onStickPointerUp = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>) => {
      releaseStick(ev.pointerId);
    },
    [releaseStick],
  );

  /** El navegador puede robar la captura (llamadas, gestos del SO): soltar limpio. */
  const onStickLostCapture = useCallback(
    (ev: ReactPointerEvent<HTMLDivElement>) => {
      releaseStick(ev.pointerId);
    },
    [releaseStick],
  );

  // ── Botones de acción ──

  const onInteract = useCallback(() => {
    if (selectModalOpen(useGameStore.getState())) return;
    getController()?.interact();
  }, []);

  const onCamera = useCallback(() => {
    if (selectModalOpen(useGameStore.getState())) return;
    const current = useGameStore.getState().camMode;
    const next = CAM_ORDER[(CAM_ORDER.indexOf(current) + 1) % CAM_ORDER.length];
    // El controlador sincroniza rig y store; sin él, el store mantiene el HUD coherente.
    const controller = getController();
    if (controller) controller.setCamMode(next);
    else useGameStore.getState().setCamMode(next);
  }, []);

  // ── Al ocultarse (o desmontar) con un dedo a medio arrastre: soltar todo ──
  useEffect(() => {
    if (!visible) return;
    return () => {
      activePointerRef.current = null;
      baseRectRef.current = null;
      dirsRef.current = DIRS_RELEASED;
      getController()?.setTouchInput(DIRS_RELEASED);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {/* Stick virtual: arrastrar el pulgar dentro de la base */}
      <div
        ref={baseRef}
        role="application"
        aria-label={touch.labels.move}
        className="pointer-events-auto absolute bottom-4 left-4 touch-none select-none rounded-full border border-white/15 bg-black/40 backdrop-blur-sm"
        style={{ width: touch.stick.base, height: touch.stick.base }}
        onPointerDown={onStickPointerDown}
        onPointerMove={onStickPointerMove}
        onPointerUp={onStickPointerUp}
        onPointerCancel={onStickPointerUp}
        onLostPointerCapture={onStickLostCapture}
      >
        <div
          ref={thumbRef}
          className="absolute left-1/2 top-1/2 rounded-full bg-amber-400/80 shadow-lg"
          style={{
            width: touch.stick.thumb,
            height: touch.stick.thumb,
            marginLeft: -touch.stick.thumb / 2,
            marginTop: -touch.stick.thumb / 2,
            transform: 'translate3d(0px, 0px, 0px)',
          }}
        />
      </div>

      {/* Botones: interacción (entrar, salir o usar) y ciclo de cámara */}
      <div className="pointer-events-auto absolute bottom-4 right-4 flex flex-col items-center gap-3">
        <button
          type="button"
          aria-label="Interactuar (entrar, salir o usar)"
          className="size-16 touch-none select-none rounded-full bg-amber-500/90 text-2xl text-neutral-900 shadow-lg transition-transform active:scale-95"
          onPointerDown={(ev) => ev.preventDefault()}
          onClick={onInteract}
        >
          {touch.labels.interact}
        </button>
        <button
          type="button"
          aria-label="Cambiar cámara"
          className="size-14 touch-none select-none rounded-full border border-white/15 bg-neutral-800/80 text-xl text-neutral-100 shadow-lg transition-transform active:scale-95"
          onPointerDown={(ev) => ev.preventDefault()}
          onClick={onCamera}
        >
          {touch.labels.camera}
        </button>
      </div>
    </div>
  );
}
