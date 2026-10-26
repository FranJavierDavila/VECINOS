'use client';

import { useEffect } from 'react';

/**
 * Registro del service worker (PWA instalable: "empaquetado de escritorio" web).
 * Silencioso: si no hay soporte o falla, el juego funciona igual que siempre.
 *
 * Actualización determinista (v1.8): un despliegue nuevo deja la carga en curso bajo el
 * SW VIEJO (que servía /assets/ cache-first → glTF anticuado pese a recargar; el caso de
 * la escalera v2↔v3). Ahora la página pregunta la VERSION al SW que la controla y la
 * compara con la del build: si difiere (o el SW viejo no sabe contestar), recarga UNA
 * sola vez (guarda en sessionStorage anti-bucle). El SW nuevo ya hace skipWaiting+claim,
 * así que tras esa recarga todo (chunks, JSON y glTF) sale de la red del despliegue.
 */
/** Debe espejar VERSION de public/sw.js (una recarga extra como máximo si se desalinean). */
const EXPECTED_SW_VERSION = 'vecinos-v1.24';
/** sessionStorage: como mucho UNA auto-recarga por sesión de pestaña. */
const RELOAD_KEY = 'vecinos.swReloadDone';

function reloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_KEY) === '1') return false;
    sessionStorage.setItem(RELOAD_KEY, '1');
  } catch {
    /* sin sessionStorage: el flag local evita bucles dentro de la página */
    if ((window as unknown as { __vecinosSwReloaded?: boolean }).__vecinosSwReloaded) return false;
    (window as unknown as { __vecinosSwReloaded?: boolean }).__vecinosSwReloaded = true;
  }
  window.location.reload();
  return true;
}

export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    /** true solo si esta página fue servida por un SW anterior (primera visita: no). */
    let outdatedSeen = false;

    const askControllerVersion = () => {
      const ctrl = navigator.serviceWorker.controller;
      if (!ctrl) return; // primera visita: nada que actualizar
      outdatedSeen = true;
      const timer = window.setTimeout(() => {
        // El SW que nos controla no contesta (v1.6/v1.7 no tienen el handler): está viejo.
        reloadOnce();
      }, 900);
      navigator.serviceWorker.addEventListener('message', function onVersion(ev: MessageEvent) {
        if (ev.data?.type !== 'VERSION') return;
        navigator.serviceWorker.removeEventListener('message', onVersion);
        window.clearTimeout(timer);
        if (ev.data.version !== EXPECTED_SW_VERSION) reloadOnce();
      });
      ctrl.postMessage({ type: 'GET_VERSION' });
    };

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // Busca actualizaciones del SW en cada carga: sin esto, el navegador puede tardar
          // en revalidar sw.js y un despliegue nuevo exigiría recargas extra para verse.
          reg.update().catch(() => {
            /* sin red: el SW actual sigue valiendo */
          });
          // SW ya descargado y esperando (el despliegue llegó con la pestaña abierta):
          // se le ordena tomar el mando ahora; el handshake/claim culmina la actualización.
          if (reg.waiting && navigator.serviceWorker.controller) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
        })
        .catch(() => {
          /* sin SW: la partida sigue funcionando por red */
        });

      // Un SW que toma el mando con la página ya cargada también nos deja desfasados:
      // una recarga única lo aplica (la primera visita no tenía controller y no entra).
      if (navigator.serviceWorker.controller) askControllerVersion();
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (outdatedSeen) reloadOnce();
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
