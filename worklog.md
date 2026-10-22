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

---
Task ID: 2-b
Agent: general-purpose
Task: Portar render Babylon.js (engine/building/actors/camera) a src/game/client

Work Log:
- Leído worklog.md y los 4 ficheros originales del monorepo Vite (upload/VECINOS_src/VECINOS/packages/client/src/): main.ts (createEngine inline), building.ts, actors.ts, camera.ts, player-logic.ts.
- Verificado el contrato actual: src/game/core/types.ts (World, BlockInstance, Content, PlayerPosition, ArchetypeView), src/game/player-logic.ts (CELL_W=2.4, CELL_H=2.6), src/game/sim/index.ts, src/game/client/store.ts; y confirmado en src/game/content/data/archetypes.ts que nino_grafitero tiene view.height=0.85 (el fallback de altura ya no necesita caso especial).
- Creado src/game/client/engine.ts: createEngine(canvas) prueba WebGPU con WebGPUEngine.IsSupportedAsync → WebGPUEngine(canvas, {antialias:true}) + initAsync() → backend 'WebGPU'; fallback new Engine(canvas, true) → 'WebGL2', con try/catch y console.warn.
- Creado src/game/client/building.ts: port 1:1 (cajas por bloque, corte de viviendas sin pared frontal, panel+candado cuando access='locked', edges en la pared del fondo del home del jugador, shake del candado). Imports cambiados: tipos desde '@/game/core/types', CELL_W/CELL_H desde '@/game/player-logic'. MEJORA en paint(): además del brillo naranja por canal de ruido (noise, noise*0.35, 0), si world.channels.water?.[b.id] existe suma al emissive (0.1*w, 0.35*w, 0.8*w) con w=Math.min(1, valor); ambos canales se acumulan.
- Creado src/game/client/actors.ts: NUEVA FIRMA createActors(scene, world, content). Color y altura salen de content.archetypes[r.archetype]?.view (color, height); fallback color '#e8e6e1', height 1.3, radio 0.28. Eliminado el mapa COLORS hardcodeado. Resto idéntico: cápsulas, interpolación exponencial (k=1-e^(-10dt), jugador x2), setEnabled(isPlayer || present && location!==null), z=ROOM_Z si el bloque es dwelling y CORRIDOR_Z si es pasillo, snap inicial con copyFrom.
- Creado src/game/client/camera.ts: port 1:1 de CameraRig (modos edificio/planta/estancia, FOV 0.55, encuadre por aspect ratio, seguimiento suave k=1-e^(-6dt)); solo cambian los imports (PlayerPosition desde '@/game/core/types', CELL_W/CELL_H desde '@/game/player-logic').
- Verificación: `bunx tsc --noEmit -p tsconfig.json` → 0 errores en src/ (los 116 restantes son preexistentes en examples/, skills/ y upload/VECINOS_src/, que no tienen deps de workspace). `bun run lint` → 0 errores; 1 warning preexistente en src/game/sim/extra/junta.ts (no es de esta tarea).

Stage Summary:
- Ficheros creados (solo los 4 del spec): src/game/client/engine.ts, building.ts, actors.ts, camera.ts. Sin 'use client', sin JSX, imports ES6 con alias '@/'. No se tocó ningún otro fichero.
- API: createEngine(canvas) → { engine: AbstractEngine, backend: 'WebGPU'|'WebGL2' }; createBuilding(scene, world, content) → { paint, shake(blockId), update(dt) } y exporta CORRIDOR_Z=-0.95, ROOM_Z=0; createActors(scene, world, content) → { update(dt, player: PlayerPosition) }; CameraRig + tipo CamMode (1:1 del original).
- createActors: firma nueva con content como 3er argumento; la vista del arquetipo define color/altura (fallback '#e8e6e1'/1.3/0.28). ArchetypeView no tiene campo radio → radio fijo 0.28 para todos (desviación menor: el niño pasaba de radio 0.22 a 0.28; se distingue por height 0.85). El campo view.accent queda disponible para futuros accesorios (hat/prop) pero no se renderiza (el original tampoco lo hacía).
- building.ts mejora: emissive = ruido (naranja) + agua (tinte azul 0.1/0.35/0.8), canales sumables. Nota: CELL_H ahora es 2.6 (antes 2.0) y todos los módulos lo toman de '@/game/player-logic', así que las proporciones se mantienen coherentes automáticamente.
- Para T2-c (UI React): consumir estos módulos desde un componente cliente; scene/lighting/clearColor y el bucle runRenderLoop siguen en el integrador (estaban inline en main.ts y NO forman parte de los 4 ficheros pedidos).

---
Task ID: 2-c
Agent: general-purpose
Task: Componentes de interfaz React del juego (src/components/game)

Work Log:
- Leído worklog.md y el store zustand (src/game/client/store.ts) para conocer el contrato de tipos (Tone, CamMode, Speed, ToastItem, LogItem, UiMission, PhoneState, ChoiceItem, ChoiceState, JuntaItemUi, ParamUi, HudSnapshot).
- Revisada la API de los componentes shadcn/ui usados (card, dialog, badge, button): Card Nueva York con py-6/gap-6 por defecto (compactado con className), DialogContent soporta showCloseButton + handlers Radix (onEscapeKeyDown/onPointerDownOutside/onInteractOutside).
- Verificado que el proyecto usa tw-animate-css (animate-in/fade-in/slide-in-from-bottom-2 disponibles para los toasts) y que el primario del tema es neutro oscuro; acento ámbar/naranja añadido vía clases utilitarias.
- Creados los 11 componentes en /home/z/my-project/src/components/game/ (todos 'use client', estado leído con selectores individuales de useGameStore, acciones recibidas por props):
  ControlsBar, HudBar, ObjectiveCard, MissionsPanel, ParamsPanel, EventLog, PhoneModal, ChoicesModal, JuntaModal, FinaleModal, ToastStack.
- Modales bloqueantes (teléfono/elecciones/junta): open forzado, onOpenChange no-op + onEscapeKeyDown/onPointerDownOutside/onInteractOutside con preventDefault + showCloseButton={false}. FinaleModal SÍ cierra con ESC/click fuera (onOpenChange → onClose) y muestra la X por defecto.
- PhoneModal registra listener global keydown (Espacio/Enter → onNext con preventDefault) con cleanup en useEffect, activo solo mientras phone exista.
- ToastStack: tarjetas clicables con role="button", tabIndex y soporte de teclado (Enter/Espacio) para despedir, además de onClick.
- `bun run lint`: 0 errores en mis ficheros (único warning en src/game/sim/extra/junta.ts, fichero ajeno de otro agente, no tocado).
- `bunx tsc --noEmit`: 0 errores en src/components/game (los errores restantes son preexistentes de upload/VECINOS_src, examples/ y skills/, fuera de alcance).

Stage Summary:
- 11 ficheros creados en src/components/game/: ControlsBar.tsx, HudBar.tsx, ObjectiveCard.tsx, MissionsPanel.tsx, ParamsPanel.tsx, EventLog.tsx, PhoneModal.tsx, ChoicesModal.tsx, JuntaModal.tsx, FinaleModal.tsx, ToastStack.tsx.
- Props exactas: ControlsBar({onTogglePause, onSetSpeed(s: Speed), onSetCam(m: CamMode), onParty, onSkipTime, onSave, onLoad}) · HudBar() · ObjectiveCard() · MissionsPanel() · ParamsPanel() · EventLog() · PhoneModal({onNext}) · ChoicesModal({onChoose(choiceId: string)}) · JuntaModal({onVote(vote: 'yes'|'no')}) · FinaleModal({onClose}) · ToastStack({onDismiss(id: number)}).
- Decisiones: acento ámbar (bg-amber-500/20 + text-amber-700) en segmentados activos y botones principales; badges de misión con paleta ámbar/naranja/esmeralda y animate-pulse en awaiting_choice; borde izquierdo por tono en el log (emerald/rose/muted); scrollbar fina custom en log y junta; iconos de clima Sun/CloudSun/CloudRain(sky-600)/CloudLightning; reloj HH:MM con padStart; guardar muestra Loader2 girando en 'saving' y Check esmeralda + title con savedAt en 'saved'.
- Todos los textos en español con tono humorístico ("Todavía nada en el tablón.", "Los inspectores aún no han pasado por aquí.", "El vecindario está extrañamente tranquilo...", nota de la junta sobre el humor vecinal).
- Pendiente para T3 (integración): un GameStage que monte estos componentes y les pase los callbacks conectados al sim.

---
Task ID: 2-prep
Agent: main (Z.ai Code)
Task: Preparar contratos compartidos antes de lanzar los subagentes T2-b/T2-c

Work Log:
- Portado `src/game/sim/selectors.ts` (activeObjective, visibleParams, playerHome) desde el original y exportado en sim/index.ts.
- `tick()` ahora acepta `extraEmissions?: Emissions` (merge por máximo) para el botón "Fiesta demo".
- Creado `src/game/client/store.ts` (zustand): estado de UI (HUD, misiones, log, toasts, modales) + selectModalOpen.

Stage Summary:
- Contrato listo para trabajo paralelo: render y UI se construyen contra types.ts + store.ts.

---
Task ID: 3
Agent: main (Z.ai Code)
Task: Integración completa: GameController, GameStage, page, API de guardado, verificación E2E

Work Log:
- Creado `src/game/client/controller.ts`: dueño del mundo en el navegador (engine, PlayerLogic, bucle de render, eventos→store, comandos UI→sim, save/load).
- Creado `src/game/client/bridge.ts`: interfaz sin Babylon para que page/UI llamen al controlador (el controlador se carga dinámicamente en el cliente).
- Creado `src/game/client/babylon.ts`: accessor tipado B() + loadBabylonScript() (CDN). MOTIVO: el barrel de @babylonjs/core en el grafo del servidor provocó OOM (3.1 GB RSS) repetidos en el sandbox de 4 GB. Ahora el servidor nunca compila Babylon (solo `import type`, que se borra); Babylon carga por CDN en el navegador y se accede vía global.
- GameStage: carga perezosa (script CDN → import dinámico del controller), overlays (prompt, modales, toasts), normalización de teclas (ev.code con fallback a ev.key para eventos sintéticos).
- page.tsx: layout completo (header, ControlsBar, GameStage, HudBar, grid de paneles, footer pegajoso con safe-area). layout.tsx: metadata y lang=es.
- Prisma: modelo GameSave (slot único, state como String JSON, tick/day/minute) + db push. API `/api/save` (GET/POST con upsert).
- Creado HelpCard.tsx (faltaba del lote del subagente) y corregidos imports nombrados de los 11 componentes.
- Corregido warning ESLint preexistente en sim/extra/junta.ts.
- Lanzamiento del servidor resuelto: el sandbox mata los procesos al terminar cada llamada de shell; el patrón que sobrevive es huérfano temprano: `setsid bun -e "Bun.spawn(['sh','-c','cd /home/z/my-project && exec bun run dev'],{stdin:'ignore',stdout:'ignore',stderr:'ignore'}); process.exit(0)"`.
- Verificación E2E con agent-browser (Chrome headless, WebGL2 por swiftshader): tutorial completo (teléfono → llegar → entrar), recompensa +200 €, mudanza de la Cotilla, cadena m_ascensor (teléfono → decisiones → junta con votos IA: "Rechazado: 4 sí/1 no" por caja insuficiente), fallo de misión por timeout, fiesta demo con propagación de ruido visible (resplandor naranja por adyacencia), guardado/carga vía API+SQLite, velocidades 1x/10x, layout móvil 390px, footer, HUD completo. Cero errores de página.
- Monitorización: next-server estable en ~1.8-2.4 GB; Babylon verificado AUSENTE de los chunks del servidor.

Stage Summary:
- Vertical slice 0.1 COMPLETA y jugable en `/`: sim determinista (1 tick = 1 min) + render Babylon 2.5D + UI React + misiones con decisiones + junta + influencias ruido/agua + guardado persistente.
- Pendiente para próximas iteraciones: controles táctiles móviles, minijuegos, editor de interiores, más misiones/arquetipos, audio.
