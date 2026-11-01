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

### FASE S — Sonido profesional (3-4 días)
- Top 10-15 SFX con samples reales CC0 (timbre, pasos, puertas, dinero, victoria, escalera).
- Bus de reverb/mixer sobre el motor Web Audio actual (audio.ts cuelga del masterGain).
- 1-2 loops de música reales (menú + capa competitiva); el procedural queda como fallback.
- Respetar la disciplina data-driven: catálogo en `public/content/sounds.json`/`music.json`,
  sin hardcodear rutas de ficheros en código.

### FASE V — Visual de 1ª línea (4-6 días)
- Matar los ~670 coplanares con la técnica juntas/soleras (v1.19) sistematizada.
- Texturas reales: acera, césped, fachadas.
- Sombras solares en edificios (evaluar shadow-only) + sombras de contacto de personajes.
- Quitar rascacielos del fondo; pase global de iluminación + tone mapping.

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
