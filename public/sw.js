/**
 * Service worker de VECINOS (pulido Steam / empaquetado web-installable).
 * Estrategia mínima y honesta:
 *   - Precache del shell (ruta /) + manifest + iconos.
 *   - Cache-first para estáticos inmutables de Next (/_next/static/...) y contenido JSON.
 *   - Network-first para navegaciones: si la red falla, sirve el shell cacheado.
 * El juego guarda partidas vía API (POST): esas peticiones NUNCA se cachean.
 */
const VERSION = 'vecinos-v1.1';
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

  // Navegación: network-first con fallback al shell (modo avión abre la última versión).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Estáticos de Next y contenido: cache-first (los ficheros de /content son la "data" del juego).
  const cacheable = url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/content/') || url.pathname.startsWith('/icons/');
  if (!cacheable) return;

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
