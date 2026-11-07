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
 *   - v1.77 — SCOPE-RELATIVE: el juego puede vivir bajo una subruta (GitHub Pages monta
 *     /VECINOS/). Toda ruta del SW se resuelve contra self.registration.scope, así que
 *     el mismo fichero vale para `/` (dev) y `/VECINOS/` (Pages) sin build-time mágico.
 */
const VERSION = 'vecinos-v1.86'; // v1.86 (petición del vecino): EL JUEGO VUELA — objetivo de 60 FPS de fábrica (antes 30) con banda de decisión adaptativa para objetivos altos (degradar <86 %, recuperar ≥95 %: en pantallas de 60 Hz la banda clásica era inalcanzable y el optimizador no recuperaba jamás). Migración única optsVer 3 (el 30 guardado de fábrica sube a 60). 'máximo' conserva su contrato v1.84 (calidad máxima, suelo 30). Antes v1.85 (comedia de barrio: 18 tramas, presencia premiada, logros de teatro)
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
/** El scope de un SW siempre acaba en '/': '/' en dev, '/VECINOS/' en GitHub Pages. */
const SCOPE = self.registration.scope;
const SCOPE_PATH = new URL(SCOPE).pathname;
/** Convierte una ruta raíz-absoluta ('/manifest.webmanifest') en absoluta-dentro-del-scope. */
const scoped = (p) => new URL(p.replace(/^\/+/, ''), SCOPE).href;
const SHELL_ASSETS = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'].map(scoped);

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
  // Nada fuera del scope (en Pages el mismo origen puede alojar otras páginas).
  if (!url.pathname.startsWith(SCOPE_PATH)) return;
  /** Ruta con el prefijo del scope quitado: '/_next/x' tanto en '/' como en '/VECINOS/'. */
  const rel = url.pathname.slice(SCOPE_PATH.length - 1);

  // Navegación y estáticos del despliegue: network-first con fallback a caché (modo avión).
  // cache:'reload' evita que el HTTP cache del navegador conteste 304 con contenido viejo.
  // /assets/ incluido (v1.8): los glTF sí cambian entre despliegues — cache-first sirvió
  // la escalera vieja (v2) días después de deployar la v3.
  const deployable =
    req.mode === 'navigate' ||
    rel.startsWith('/_next/static/') ||
    rel.startsWith('/content/') ||
    rel.startsWith('/assets/');
  if (deployable) {
    event.respondWith(
      fetch(req, { cache: 'reload' })
        .then((res) => {
          const copy = res.clone();
          caches.open(req.mode === 'navigate' ? SHELL_CACHE : RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit ?? (req.mode === 'navigate' ? caches.match(scoped('/')) : Promise.resolve(null))).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Iconos: cache-first (no cambian entre despliegues).
  if (!rel.startsWith('/icons/')) return;
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
