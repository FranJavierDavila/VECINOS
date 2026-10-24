'use client';

import { useEffect } from 'react';

/**
 * Registro del service worker (PWA instalable: "empaquetado de escritorio" web).
 * Silencioso: si no hay soporte o falla, el juego funciona igual que siempre.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // Busca actualizaciones del SW en cada carga: sin esto, el navegador puede tardar
          // en revalidar sw.js y un despliegue nuevo exigiría recargas extra para verse.
          reg.update().catch(() => {
            /* sin red: el SW actual sigue valiendo */
          });
        })
        .catch(() => {
          /* sin SW: la partida sigue funcionando por red */
        });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
