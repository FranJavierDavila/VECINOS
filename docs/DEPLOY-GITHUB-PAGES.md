# VECINOS en GitHub Pages — guía de despliegue (v1.82, fusión)

## La URL

**https://franjavierdavila.github.io/VECINOS/**

## Estado (2026-11-04, sesión «Opción B»)

- **gh-pages = 0147ad4, export v1.82 publicado y verificado en navegador** (banner, escena
  viva 2239+ mallas, barrio 3D con píxeles, guardar→recargar→cargar por localStorage).
- **La URL sigue 404**: Pages está en `build_type: "workflow"` sin ningún run. Ni el PAT
  viejo (Contents-only) ni el nuevo (2026-11-04: **read-only** — GET 200, PUT/push 403;
  el `permissions.admin:true` del payload es el rol del usuario, no del token) puede
  activarla. Falta UNA acción humana:
  - **(A) Click manual [10 s]**: Settings → Pages → Source *«Deploy from a branch»* →
    `gh-pages` / (root) → Save. La URL sirve el export v1.82 en 1–3 min.
  - **(B) PAT con Contents R-W + Workflows R-W** (fine-grained) o classic con scope
    `workflow`: `git push origin workflows-activate:main` (fast-forward, el commit
    62c8478 trae el yml corregido) y Pages se activa sola vía Actions; cada push a main
    auto-despliega para siempre.

## El flujo (probado desde v1.74.1)

El juego entero es cliente (Babylon.js + sim determinista en el navegador): Pages lo
sirve tal cual con un export estático.

1. **`scripts/deploy-pages.sh`** (desde la raíz del repo): export con `NEXT_PAGES=1`
   (`output: 'export'` + `basePath /VECINOS` + `distDir .next-pages` aparte para no
   pisar el `.next` del dev), retira `src/app/api` temporalmente, ajusta el manifest al
   subpath, añade `.nojekyll` y publica la rama **`gh-pages`** como commit huérfano
   (plumbing `GIT_INDEX_FILE`/`GIT_WORK_TREE`: el working tree de main jamás se toca).
2. **Alta de Pages (una sola vez)**: con los tokens actuales es un **click manual**
   (camino A del bloque «Estado») o se automatiza con un PAT con permisos (camino B).
3. Cada redeploy = volver a correr el script; la URL se refresca en 1–3 min. OJO: los
   commits de gh-pages son huérfanos — el push lleva `--force` (corregido en el script;
   solo el primer push de la rama puede ser fast-forward).

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

## Workflows de GitHub Actions (a un push de distancia)

El PAT del sandbox **no puede publicar `.github/workflows/`** (scope «workflow»
requerido; rechaza el push entero — probado también con el PAT read-only de 2026-11-04).
El yml ya está escrito y commitido:

- Rama local **`workflows-activate`** — commit del yml corregido (62c8478, rebasado sobre
  main): build canon `NEXT_PAGES=1` + `NEXT_PUBLIC_SW='off'` en el runner + `.nojekyll` +
  `upload-pages-artifact` desde **`.next-pages`** + `actions/deploy-pages@v4` con el
  GITHUB_TOKEN del runner (no necesita PAT de Pages).
- `docs/DEPLOY-PAGES-ACTIONS.yml.txt` — copia del mismo canon (reemplaza al txt viejo,
  que apuntaba a `out/` y a `VECINOS_STATIC_EXPORT`: nombres de la línea remota v1.81).
- `docs/PAGES-WORKFLOW.yml.txt` y `docs/ci-fase-h.yml.txt` — canon histórico de la rama
  remota (5e9ffb9).

En cuanto el token tenga **Contents R-W + Workflows R-W**: `git push origin
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
