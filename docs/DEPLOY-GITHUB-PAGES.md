# VECINOS en GitHub Pages — guía de despliegue (v1.82, fusión)

## La URL

**https://franjavierdavila.github.io/VECINOS/**

## Estado (2026-11-05, v1.82·C — EN VIVO ✅)

- **La URL está VIVA**: https://franjavierdavila.github.io/VECINOS/ → HTTP 200, juego
  v1.82 verificado en navegador real sobre el sitio público (banner, barrio 3D con
  píxeles, HUD Día 1 · 08:08, Arcas/Hucha 800 €, intro Molina & Hijos, 0 errores de
  consola).
- Cómo se desbloqueó (camino B, completado): el usuario activó Pages con fuente
  «GitHub Actions» (build_type workflow — por eso el 404 persistía: Pages existía pero
  sin ningún run) y trajo un PAT fine-grained con **Contents R-W + Workflows R-W**. El
  push `workflows-activate:main` (fast-forward 336ffaa→177ce22) disparó el run
  41881742781 → build + deploy **success** en ~2 min con el GITHUB_TOKEN del runner
  (sin necesitar PAT de Pages).
- **Contrato vigente: cada push a main despliega.** La rama gh-pages (0147ad4) queda
  como histórico del camino A; ya no se usa.
- Límites del PAT (fine-grained, para el futuro): sin Actions:write (dispatch por API
  → 403) ni Pages:write (PUT /pages → 403) — sobran: el workflow es la fuente de la
  verdad. Rotar el token: vivió pegado en el chat.

## El flujo (probado desde v1.74.1)

El juego entero es cliente (Babylon.js + sim determinista en el navegador): Pages lo
sirve tal cual con un export estático.

1. **`scripts/deploy-pages.sh`** (desde la raíz del repo): export con `NEXT_PAGES=1`
   (`output: 'export'` + `basePath /VECINOS` + `distDir .next-pages` aparte para no
   pisar el `.next` del dev), retira `src/app/api` temporalmente, ajusta el manifest al
   subpath, añade `.nojekyll` y publica la rama **`gh-pages`** como commit huérfano
   (plumbing `GIT_INDEX_FILE`/`GIT_WORK_TREE`: el working tree de main jamás se toca).
2. **Alta de Pages**: HECHA (2026-11-05) y además el workflow vive ya en main, así que
   el alta no se toca más: **cada push a main construye y publica solo**
   (run Actions «Deploy a GitHub Pages», ~2 min). El script y la rama gh-pages quedan
   como camino histórico (B) si algún día se prefiere «Deploy from a branch».
3. Redeploy manual (alternativa al push): volver a correr el script y force-push la
   rama gh-pages — SOLO si Pages se cambiase a «Deploy from a branch» (los commits de
   gh-pages son huérfanos y el push lleva `--force`).

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
