# VECINOS en GitHub Pages — guía de despliegue (v1.82, fusión)

## La URL

**https://franjavierdavila.github.io/VECINOS/**

## El flujo (probado desde v1.74.1)

El juego entero es cliente (Babylon.js + sim determinista en el navegador): Pages lo
sirve tal cual con un export estático.

1. **`scripts/deploy-pages.sh`** (desde la raíz del repo): export con `NEXT_PAGES=1`
   (`output: 'export'` + `basePath /VECINOS` + `distDir .next-pages` aparte para no
   pisar el `.next` del dev), retira `src/app/api` temporalmente, ajusta el manifest al
   subpath, añade `.nojekyll` y publica la rama **`gh-pages`** como commit huérfano
   (plumbing `GIT_INDEX_FILE`/`GIT_WORK_TREE`: el working tree de main jamás se toca).
2. **Alta de Pages (una sola vez, manual)**: GitHub → Settings → Pages → Source:
   *«Deploy from a branch»* → `gh-pages` / (root) → Save. El PAT del sandbox es
   Contents-only y la API de Pages responde 403: este click no se puede automatizar hoy.
3. Cada redeploy = volver a correr el script; la URL se refresca en 1–3 min.

## Qué cambia en el export estático (`NEXT_PAGES=1` + `NEXT_PUBLIC_SW=off`)

| Función        | Con servidor (dev/sandbox)        | Export estático (Pages)                        |
|----------------|-----------------------------------|------------------------------------------------|
| Guardar/Cargar | POST/GET `/api/save` (SQLite)     | fallback a `localStorage` (misma forma `{state}`) |
| Telemetría     | POST `/api/telemetry` + vista GET | captura viva, lotes descartados en silencio    |
| Multijugador   | socket.io `:3010`                 | aviso honesto y ni abre socket (v1.82)         |
| Artref save    | POST `/api/artref-save`           | descarga directa de los 3 PNG                  |
| Service worker | activo (network-first)           | desactivado (el SW de raíz no vale en subruta) |

Las URLs de contenido y arte son **relativas** en los catálogos y en el código
(`content/…`, `art/…`): idénticas en sandbox y correctas bajo `/VECINOS/`.
El `manifest.webmanifest` usa `start_url`/`scope` `./` e iconos relativos, y el
`layout.tsx` prefija manifest/iconos con `/VECINOS` solo cuando `NEXT_PAGES=1`.

## Workflows de GitHub Actions (aparcao, listo para el futuro)

El PAT del sandbox **no puede publicar `.github/workflows/`** (scope «workflow»
requerido; rechaza el push entero). Aparcao y listo:

- `docs/DEPLOY-PAGES-ACTIONS.yml.txt` — workflow de deploy (build en runner +
  `deploy-pages`), con rutas scope-relative del SW v1.82 ya compatibles.
- `docs/PAGES-WORKFLOW.yml.txt` y `docs/ci-fase-h.yml.txt` — el canon de la rama
  remota (rama local `workflows-activate`, commit 5e9ffb9, con ambos yml listos).

En cuanto el token tenga **Workflows: R-W** (+ Pages write): `git push origin
workflows-activate:main` y el despliegue pasa a ser automático en cada push a main.

## Comprobación rápida tras un deploy

1. La web carga y el banner dice la versión del export.
2. Guardar partida → recargar → cargar partida: persiste (localStorage del navegador).
3. La consola no muestra 404 de `_next`, `content` ni `art`.
4. El botón de multijugador avisa con elegancia en vez de reconectar infinito.

## Límites conocidos del export estático

- El guardado vive en el navegador: cambiar de dispositivo/perfil no traslada la partida.
- La telemetría de playtest (FASE T) solo ingiere en despliegues con servidor.
- El multijugador (FASE N) requiere el mini-servicio `:3010` del sandbox. El plan
  PRESIDENCIA (Fases U–Y: personas online, iconos de jugadores reales, chat) necesitará
  un host con backend.
