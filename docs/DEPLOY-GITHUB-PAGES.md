# VECINOS en GitHub Pages — guía de despliegue (v1.77)

## La URL

**https://franjavierdavila.github.io/VECINOS/**

Se despliega sola: cada push a `main` dispara `.github/workflows/deploy-pages.yml`
(build de export estático → artifact → Pages). También se puede disparar a mano
desde la pestaña *Actions* del repo («Deploy a GitHub Pages» → *Run workflow*).

## Cómo funciona

El juego entero es cliente (Babylon.js + sim determinista en el navegador), así que
Pages lo sirve tal cual con dos ajustes que hace el workflow:

1. **basePath `/VECINOS`** — Pages monta proyectos de usuario en subruta. El build va
   con `VECINOS_STATIC_EXPORT=1` + `NEXT_PUBLIC_STATIC_EXPORT=1` + `NEXT_PUBLIC_BASE_PATH=/VECINOS`:
   - `next.config.ts` cambia a `output: 'export'` + `trailingSlash` + `basePath`.
   - `src/game/support/paths.ts` (`withBase`, `absolutizeContent`) prefija contenido,
     arte, sonidos, manifest e iconos. En dev (`BASE_PATH=''`) es identidad total.
   - `public/sw.js` (v1.77) resuelve TODO contra `self.registration.scope`, así que el
     mismo service worker vale en `/` (dev) y `/VECINOS/` (Pages).
2. **Sin `/api/*`** — el export no admite route handlers con POST; el workflow retira
   `src/app/api` antes de construir. El cliente ya degrada con elegancia
   (`NEXT_PUBLIC_STATIC_EXPORT=1`):

   | Función        | Con servidor (dev/prod)            | Export estático (Pages)                     |
   |----------------|------------------------------------|---------------------------------------------|
   | Guardar/Cargar | POST/GET `/api/save` (SQLite)      | `localStorage` (misma forma JSON `{state}`) |
   | Telemetría     | POST `/api/telemetry` + vista GET  | captura viva, lotes descartados en silencio |
   | Multijugador   | socket.io `:3010`                  | aviso honesto, no abre socket               |
   | Artref save    | POST `/api/artref-save`            | descarga directa de los 3 PNG               |

## Detalles que impiden el 404 clásico de Pages

- **`.nojekyll`**: sin él, GitHub Pages ignora carpetas que empiezan por `_` (adiós `/_next/`).
- **`assetPrefix` NO se toca**: Next ya antepone el `basePath` a los assets; duplicarlo
  producía `/VECINOS/VECINOS/_next/...`.
- **manifest relativo**: `start_url`/`scope` `./` e iconos sin `/` — válido en ambas raíces.
- **CI de higiene** (`.github/workflows/ci.yml`): lint + tsc + batería headless en cada
  push; el deploy corre en paralelo (la convención del proyecto es QA local antes de push).

## Comprobación rápida tras un deploy

1. La web carga y el banner dice la versión actual (`v1.77 · jugable online…`).
2. DevTools → Application → Service Workers: activo con scope `/VECINOS/`.
3. Guardar partida → recargar → cargar partida: persiste (localStorage del navegador).
4. La consola no muestra 404 de `_next`, `content` ni `art`.

## Límites conocidos del export estático

- El guardado vive en el navegador: cambiar de dispositivo/perfil no traslada la partida.
- La telemetría de playtest (FASE T) solo ingiere en despliegues con servidor.
- El multijugador (FASE N) requiere el mini-servicio `:3010` del sandbox; en Pages avisa
  y sigue el juego en solitario. El plan PRESIDENCIA (Fases U–Y) necesitará servidor
  para personas online, iconos de jugadores reales y chat — o bien un host con backend.
