/**
 * Service worker de VECINOS (pulido Steam / empaquetado web-installable).
 * Estrategia mínima y honesta:
 *   - Precache del shell (ruta /) + manifest + iconos.
 *   - NETWORK-FIRST para TODO lo que cambia con cada despliegue: navegaciones, chunks de
 *     Next (/_next/static), contenido JSON (la "data" del juego) y ASSETS glTF/audio.
 *     Sin red → caché.
 *     (v1.5: antes era cache-first para estáticos — un despliegue nuevo servía chunks
 *     VIEJOS hasta doble recarga. v1.8: /assets/ pasa a network-first por la misma razón —
 *     el glTF de la escalera v3 tardó en llegar y el jugador siguió viendo la torre vieja.
 *     Nunca más: si hay red, lo que se sirve es lo del despliegue actual.)
 *   - Message SKIP_WAITING (lo manda PwaRegister cuando hay SW esperando) + skipWaiting
 *     en install + clients.claim en activate: un SW nuevo toma el mando de inmediato y la
 *     página se recarga UNA vez sola (guardada en PwaRegister). Adiós a la doble recarga manual.
 *   - Las peticiones que no son GET (save/load API) NUNCA se cachean.
 */
const VERSION = 'vecinos-v1.38';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const SHELL_ASSETS = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('message', (event) => {
  // PwaRegister avisa de que hay un SW esperando mientras la pestaña sigue viva:
  // tomamos el mando ya (activate purga cachés viejas y claim controla la página).
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  // Handshake de versión: la página compara VERSION con la del build actual y decide
  // si hace falta UNA recarga (SW viejo controlando → assets potencialmente viejos).
  if (event.data && event.data.type === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // save/load API: siempre red
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navegación y estáticos del despliegue: network-first con fallback a caché (modo avión).
  // cache:'reload' evita que el HTTP cache del navegador conteste 304 con contenido viejo.
  // /assets/ incluido (v1.8): los glTF sí cambian entre despliegues — cache-first sirvió
  // la escalera vieja (v2) días después de deployar la v3.
  const deployable =
    req.mode === 'navigate' ||
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/content/') ||
    url.pathname.startsWith('/assets/');
  if (deployable) {
    event.respondWith(
      fetch(req, { cache: 'reload' })
        .then((res) => {
          const copy = res.clone();
          caches.open(req.mode === 'navigate' ? SHELL_CACHE : RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit ?? (req.mode === 'navigate' ? caches.match('/') : Promise.resolve(null))).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Iconos: cache-first (no cambian entre despliegues).
  if (!url.pathname.startsWith('/icons/')) return;
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        }),
    ),
  );
});
