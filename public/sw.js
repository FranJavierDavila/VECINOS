/**
 * Service worker de VECINOS (pulido Steam / empaquetado web-installable).
 * Estrategia mínima y honesta:
 *   - Precache del shell (ruta /) + manifest + iconos.
 *   - NETWORK-FIRST para TODO lo que cambia con cada despliegue: navegaciones, chunks de
 *     Next (/_next/static) y contenido JSON (la "data" del juego). Sin red → caché.
 *     (v1.5: antes era cache-first para estáticos — un despliegue nuevo servía chunks
 *     VIEJOS hasta doble recarga; el jugador veía el juego anticuado. Nunca más.)
 *   - Las peticiones que no son GET (save/load API) NUNCA se cachean.
 */
const VERSION = 'vecinos-v1.5';
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
  const deployable = req.mode === 'navigate' || url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/content/');
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

  // Iconos y demás assets estables: cache-first (no cambian entre despliegues).
  if (!url.pathname.startsWith('/icons/') && !url.pathname.startsWith('/assets/')) return;
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
