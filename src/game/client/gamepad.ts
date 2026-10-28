'use client';

/**
 * Soporte de gamepad (pulido Steam): API Gamepad del navegador, sin dependencias.
 * Mapeo estándar (mapping 'standard'):
 *   - Stick izquierdo + cruceta            → mover (mismos canales que los mandos táctiles)
 *   - A / Cross (0)                         → interactuar (tecla E virtual; salta cutscenes también)
 *   - X / Cuadrado (2)                      → correr (canal run; multiplica la velocidad)
 *   - Y / Triángulo (3)                     → ciclar cámara (Edificio → Planta → Estancia)
 *   - Start (9)                             → pausa
 * El controller ya filtra cutscenes/modales en onKeyDown; aquí solo protegemos cámara y pausa.
 */

import { getController } from './bridge';
import { selectModalOpen, useGameStore } from './store';

const DEADZONE = 0.45;

let raf = 0;
let polling = false;
let prevButtons: boolean[] = [];
let prevDirs = { left: false, right: false, up: false, down: false, run: false };

function poll(): void {
  raf = requestAnimationFrame(poll);
  const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  let pad: Gamepad | null = null;
  for (const p of pads) {
    if (p && p.connected && p.mapping === 'standard') {
      pad = p;
      break;
    }
  }
  const c = getController();

  // Mando desconectado: soltar direcciones y empezar de cero (evita pasos fantasma).
  if (!pad) {
    if (c && (prevDirs.left || prevDirs.right || prevDirs.up || prevDirs.down || prevDirs.run)) {
      c.setTouchInput({ left: false, right: false, up: false, down: false, run: false });
    }
    prevDirs = { left: false, right: false, up: false, down: false, run: false };
    prevButtons = [];
    return;
  }

  const b = (i: number) => pad.buttons[i]?.pressed ?? false;
  const pressed = (i: number) => b(i) && !prevButtons[i];
  const modalOpen = selectModalOpen(useGameStore.getState());

  // 1) Movimiento: stick izquierdo (axes 0/1) + cruceta (botones 12-15). X (2) = correr.
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  const dirs = {
    left: ax < -DEADZONE || b(14),
    right: ax > DEADZONE || b(15),
    up: ay < -DEADZONE || b(12),
    down: ay > DEADZONE || b(13),
    run: b(2),
  };
  if (c && (dirs.left !== prevDirs.left || dirs.right !== prevDirs.right || dirs.up !== prevDirs.up || dirs.down !== prevDirs.down || dirs.run !== prevDirs.run)) {
    c.setTouchInput(dirs);
  }
  prevDirs = dirs;

  // 2) A/Cross: interactuar. Subida = KeyE down, bajada = KeyE up (el controller empareja el set).
  if (c) {
    if (pressed(0)) c.onKeyDown('KeyE');
    else if (!b(0) && prevButtons[0]) c.onKeyUp('KeyE');
  }

  // 3) Y/Triángulo: ciclar cámara. 4) Start: menú de pausa (v1.39). Solo con el mundo despejado de modales.
  if (!modalOpen) {
    if (pressed(3)) c?.cycleCam();
    if (pressed(9)) c?.togglePauseMenu();
  }

  prevButtons = pad.buttons.map((x) => x.pressed);
}

/** Arranca el sondeo una sola vez; los eventos de conexión avisan con un toast. */
export function startGamepadPolling(): void {
  if (polling || typeof window === 'undefined') return;
  polling = true;
  window.addEventListener('gamepadconnected', (ev) => {
    const name = (ev as GamepadEvent).gamepad?.id?.slice(0, 40) ?? 'mando';
    useGameStore.getState().pushToast(`🎮 Mando conectado (${name}): A interactúa · Y cámara · Start pausa`, 'info');
  });
  window.addEventListener('gamepaddisconnected', () => {
    useGameStore.getState().pushToast('🎮 Mando desconectado', 'info');
    prevButtons = [];
    prevDirs = { left: false, right: false, up: false, down: false, run: false };
  });
  raf = requestAnimationFrame(poll);
}

export function stopGamepadPolling(): void {
  if (!polling) return;
  polling = false;
  cancelAnimationFrame(raf);
}
