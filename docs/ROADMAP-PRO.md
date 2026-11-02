# ROADMAP PROFESIONAL — VECINOS

> Memoria persistente del plan hacia nivel profesional (acordado 2026-11-02).
> Regla de avance: una fase → implementada → testeada → commit → siguiente.

## Estado al firmar el plan

- Arquitectura profesional ya existente: sim determinista TS, contenido 100% data-driven
  (29 JSON en `public/content/`), servidor socket.io (`mini-services/vecinos-server`, :3010),
  QA headless (`scripts/qa-*.ts`) + navegador (`?qaengine=1`, `window.__vecinosQa`).
- Audio procedural Web Audio v1.39 (música generativa por franja horaria, lluvia, ducking).
- Baseline defectos al firmar: **tsc 275 errores**, 4 suites QA rotas (v137, v140, v141, v123),
  ~670 caras coplanares, netcode client-trusted, sin CI, sin analítica.

## Las 7 fases (en orden de ejecución)

### FASE H — Higiene técnica ✅ COMPLETADA (2026-11-02) — tsc 275 → **0**
- tsc: errores del árbol propio (`src/` + `scripts/`) → **0** (caché incremental servía ~60%
  diagnósticos obsoletos; en CI se verifica con `--incremental false`).
- Fixes reales en producción: `roll` sin definir en paseo.ts (crash latente → `world.tick`
  determinista), unión `InteractResult` sin `fusebox`, `ArtRefStrings` incompleta,
  `receiveShadows` sobre Material (no existe), narrowing `objective.id`, re-export
  `MultiplayerCatalog`; en scripts/ los 106 con casts mínimos y outputs verificados idénticos.
- Reparadas las 4 suites rotas — AHORA VERDES: qa-v137 47✓/0, qa-v140 44·0, qa-v141 68·0, qa-v123 OK.
- CI: `.github/workflows/ci.yml` ESCRITO Y VERIFICADO por pasos localmente (lint + tsc 0 sin
  caché + QA headless v123/v127/v130/v137/v140/v141). ⚠️ Pendiente de pushear: los PAT
  disponibles carecen de scope `workflow` (lo concede el dueño de la cuenta). El fichero
  queda en disco listo para `git add .github && git push` en cuanto el token lo tenga.
- Verificación navegador: `/` renderiza, sin overlay de error, NullEngine + `__vecinosQa` vivos,
  sim corriendo (27 bloques / 15 residentes / tick avanza), diálogo de intro interactivo.
- Deuda documentada pre-existente (no era de Fase H): qa-v128 2✗, qa-v129 2✗, qa-v142 15✗ (paseos E2E).
- **Addendum (depuración E2E profunda de esta sesión, commit 11c89c1)**: 2 bugs de producto
  REALES cazados gracias a la higiene — (1) reconexión transparente v1.56 NUNCA funcionó
  (`store.mpSession` no existía en el store → `mpCode`); (2) el visitante que entraba por
  timbre a una vivienda ajena era EXPULSADO a los ~4 s (sync() en interior apuntaba a
  zone() — que excluye viviendas — así que la cadena legal del router terminaba en el cubo
  de escalera/trasteros y reconcile force-extraía con cada session:state; además la rama
  interior era la única sin sync() y tryEnterDoor no renovaba moveRetryAt). Fix + sonda de
  telemetría con stacks: scripts/probe-t4.ts. qa-v164-multi TODO VERDE (T2c Δ=3.42 m; T4c/T4d).

### FASE S — Sonido profesional ✅ COMPLETADA (2026-11-02)
- 22 SFX clave renderizados como WAV reales (public/art/audio/sfx/*.wav, 2.3 MB): puertas,
  dinero (coins/hucha), victoria/derrota, minijuegos, mazo, sello, taladro, teléfono, viento,
  sirena, claxon, frenazo, pelea, trueno, UI. DSP enriquecido: parciales aditivos/FM,
  transitorios filtrados, reverb Schroeder, limitador + normalización −1 dBFS.
- 4 loops de música reales por contexto horario (morning/afternoon/evening/night, estéreo
  32 kHz, 4 compases, loop perfecto por foldback) compuestos con las REGLAS de music.json.
- Renderizador offline determinista `scripts/gen-audio-v170.ts` (semilla fija → bytes
  reproducibles; verificado por qa-v170 con triple hash). Cero licencias, cero red.
- Contrato data-driven intacto: `sounds.json` (kind:'file' + gain) y `music.json`
  (context.file + fileGain, opcional) siguen siendo la única verdad; sin rutas en código.
- Degradación elegante intacta: si un fichero falta, la síntesis procedural de v1.39/1.48
  cubre esa clave (audio.ts ya soportaba kind:'file' desde v1.48 con caché; music.ts v1.70
  añade la vía de loops con cross-fade en borde de compás y fallback).
- QA nueva: `scripts/qa-v170-audio.ts` (33 checks: esquemas, WAV sanos, cobertura de
  eventos, 22 upgrades, 4 loops, determinismo, timbre v1.48 preservado) — 33/0 VERDE.
- qa-v123 actualizado: hucha_in/out ahora «reproducible» (seq o file) en vez de exigir seq.
- Verificado en navegador: el AudioContext real decodifica SFX mono y loops estéreo
  (mismo sampleRate/duración), 0 errores de consola; tsc 0 · eslint limpio.

### FASE V — Visual de 1ª línea ✅ COMPLETADA (2026-11-02, v1.61→v1.72)
- ~~Matar los ~670 coplanares~~ ✅ **CERRADO CON EVIDENCIA (v1.71-1.72)**:
  · Ventanas traseras + lavandería (v1.67): 0 pares vmarco/vidrio.
  · DECAY decales (v1.72): los 3 tipos (humedad/hollín/grietas) compartían el plano
    backZ exacto y peleaban donde solapaban → escalera de profundidad por tipo
    (rules.view.decay.zStep=0.006): auditor 1214→1197, **0 pares decal_* **.
  · Auditor MEJORADO (v1.72): reporta MATERIAL de cada par — de 629 activos↔activos,
    168 son de MISMO material (píxeles idénticos al pelear: benignos) y 461 de distinto.
  · VEREDICTO POR PÍXELES (qa-v172-flicker.ts, WebGL real + sim congelado + diff A/B
    de frames en cámaras edificio/fachada/planta): **CERO z-fighting visible** — todo el
    diff son nubes a la deriva y rigs de vecinos (presentación en reloj de pared). Los
    461 candidatos geométricos quedan clasificados benignos por oclusión (caras
    enterradas en forjados/muros vecinos — juntas/soleras v1.27 ya los diseñó así).
  · Sistematización completa: cualquier par futuro sale del auditor con su material y
    el detector de píxeles da el veredicto en minutos (antes: días de triage a mano).
- ~~Texturas reales: acera, césped, fachadas~~ ✅ (acera/césped v1.61, fachadas
  facadeBrick v1.62).
- ~~Sombras solares en edificios + sombras de contacto de personajes~~ ✅ (v1.32
  ShadowGenerator data-driven + v1.63 blob shadows con raycast al suelo real).
- ~~Quitar rascacielos del fondo~~ ✅ (v1.21-1.62: parallax de sellos reales + huecos de
  cielo «solares» deterministas).
- ~~Pase global de iluminación + tone mapping~~ ✅ **v1.71**: `rules.view.imageProcessing`
  (ACES + exposición 1.12 + contraste 1.04) aplicado por `scene.imageProcessingConfiguration`
  (una verdad para todos los materiales, emisivos incluidos; GlowLayer compone encima).
  Keyframes nocturnos compensados al pipeline (ambient noche 0.40-0.58 → 0.48-0.65):
  la noche gana negros reales y ventanas encendidas SIN perder legibilidad de puertas.
  A/B con WebGL real (swiftshader) en docs/shots/v171-*.png: día más rico (cielo/ladrillo/
  techo más profundos, blancos sin quemar), noche cinematográfica y legible.
  QA: qa-v171-imageproc.ts 10/10 VERDE + qa-v170-audio 33/0 (regresión de contenido).

### FASE N — Netcode profesional (4-6 días)
- Autoridad de servidor en movimiento (validar velocidad/teleports) en vecinos-server.
- Reconexión <10s con resync de estado; persistencia de sesión.
- Métricas de desync; anti-cheat básico. El sim determinista de `src/game/sim/` NO se toca.

### FASE D — Diseño de retención (continuo)
- Bucle de juego en 1 página (sesiones 30/60/90 min); economía balanceada.
- Reglas competitivas claras con ranking; 3 misiones co-op pulidas > 20 mediocres.

### FASE P — Producción (3-5 días)
- Hosting estable + dominio; error tracking; analítica de embudo; PWA instalable
  (manifest.webmanifest y sw.js ya existen en `public/`).

### FASE T — Playtesting (1 semana)
- 5-10 jugadores humanos reales; observar en silencio; iterar sobre evidencia.

## Reglas inquebrantables (de todo el proyecto)

1. 100% data-driven: contenido en `public/content/*.json`, prohibido hardcodear.
2. Sim determinista intacto: no editar `src/game/sim/*` (sí `mini-services/vecinos-server`).
3. Prohibido el coplanar (z-fighting).
4. Todo "hecho" se verifica en navegador/HeadlessQA antes de decir "hecho".
5. QA: real WebGL con timeout; NullEngine + `window.__vecinosQa` es el camino fiable.
6. `git add` siempre con ficheros explícitos (hay PNG basura `--timeout` trackeado en la raíz).
