# Worklog — Vecinos (prototipo jugable en Next.js)

Proyecto: vertical slice del juego "VECINOS" dentro del proyecto Next.js 16 existente.
Fuente de verdad: `/home/z/my-project/upload/VECINOS_src/VECINOS` (hito 1 del equipo: monorepo content/sim/client).

---
Task ID: 1
Agent: main (Z.ai Code)
Task: Analizar uploads, instalar Babylon.js, definir contratos y portar contenido+sim

Work Log:
- Extraído el ZIP `VECINOS.zip` (43 MB, node_modules incluidos) → solo código fuente en `upload/VECINOS_src/VECINOS`.
- Estudiado hito 1: sim determinista (tick 1 min, influencias ruido/agua por adyacencia, motor de misiones con steps phone_call/reach/enter/catch_in_act y choices con efectos, grafo de circulación con Dijkstra, RNG mulberry32), content con esquemas Zod, visor Babylon básico (cajas + HUD DOM).
- Instalado `@babylonjs/core@8.56.2` en el proyecto Next.js.
- Decisión: fijar vivienda del jugador en `blk_p3_c` (determinista, como el ejemplo del documento) para que las misiones puedan referenciarla.
- Escritas las estadísticas/vistas de arquetipos y el catálogo extendido en `src/game/core/types.ts` + `src/game/content/*`.
- Portado el sim a `src/game/sim/*` con hooks para los módulos extra (clima, IA de vecinos, junta).

Stage Summary:
- Contrato compartido en `src/game/core/types.ts` (lo usan sim, render y UI).
- Contenido en `src/game/content/` (datos TS + validación Zod al arrancar).
- Sim en `src/game/sim/` + `player-logic.ts` portado.
- Pendiente: módulos extra del sim (T2-a), render Babylon (T2-b), UI React (T2-c), integración (T3).
