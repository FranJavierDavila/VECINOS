/**
 * Acceso tipado a Babylon.js cargado como script global (CDN) en el navegador.
 * `typeof import(...)` es SOLO tipos: Turbopack lo borra, así que el paquete @babylonjs/core
 * no entra en el grafo del servidor (evita OOM al compilar en sandboxes pequeños).
 */
export type Babylon = typeof import('@babylonjs/core');

/** Devuelve el namespace global BABYLON. Solo se puede llamar desde el navegador, tras cargar el script. */
export function B(): Babylon {
  const lib = (globalThis as { BABYLON?: Babylon }).BABYLON;
  if (!lib) throw new Error('Babylon.js todavía no está cargado (el script del CDN no llegó).');
  return lib;
}

/** Inyecta el script de Babylon.js (CDN) y resuelve cuando el global está disponible. */
export function loadBabylonScript(src = 'https://cdn.babylonjs.com/babylon.js'): Promise<void> {
  const w = globalThis as { BABYLON?: Babylon };
  if (w.BABYLON) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar Babylon.js desde el CDN'));
    document.head.appendChild(s);
  });
}
