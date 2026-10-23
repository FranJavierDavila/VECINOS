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

---
Task ID: 4
Agent: main (Z.ai Code)
Task: Refactor 100% data-driven: eliminar todo hardcodeo (directriz del usuario: juego agnóstico, arte final sustituible)

Work Log:
- Auditoría de hardcodeo en las 3 capas: (1) contenido en módulos TS en vez de JSON externo; (2) sim: horarios de IA en switch por arquetipo, constantes de economía/clima/junta/trabajo/llamadas, DEFAULT_NEEDS, bucle de misiones; (3) client: CELL_W/CELL_H, velocidades, colores de greybox, glows de canales, 'slice', 'blk_p0_portal', 'blk_p1_nucleo', labels de actividades/clima, partyDemo con ids fijos.
- Creado catálogo `rules.json` (hoja de balance): sim (night, aiHopTicks, missionLoopMax, defaultNeeds, economy con rentMinute/needDrift/corridorDirt, work, knock, weather cycle+duration, junta con clamp y factors) + view (geometría greybox, velocidades, sky/luces, lockedColor/brokenColor/lockColor, channelGlow noise/water, actor fallbacks) + demo + labels.weather.
- Nuevo campo por catálogo: `archetypes: activities[].schedule` (ventanas HH:MM con chance y days even/odd, cruce de medianoche), `activities[].label` (emojis del log), `activities[].onStart` (efectos al iniciar actividad, p. ej. pintar cabina), `archetypes.voteBias` (sustituye al special-casing presidente/fondo_buitre en junta).
- Migrados los 9 catálogos TS → JSON externos en `public/content/` (blocks, rooms, layouts, influences, archetypes, dialogs, missions, templates, scenarios, rules). Eliminado `src/game/content/data/`.
- Creado `src/game/content/schemas.ts` (Zod v4: efecto/condición/paso como unions discriminadas, rules completo) y reescrito `content/index.ts`: `loadContent(baseUrl)` async (fetch + parse + indexado + validación cruzada ampliada: startScenario, attenuatedBy, canales de activities), cache en promesa.
- Sim genérico: ai.ts (scheduler por datos con prioridad = orden del catálogo; entry desde world.entry; hop desde rules), economy.ts (drift por tabla de rules; suciedad aplicada a cualquier bloque que tenga el parámetro), weather.ts (ciclo/duración de rules), junta.ts (fórmula de rules + voteBias), commands.ts (work/knock de rules, toastDone con {amount}), world.ts (defaultNeeds de rules + world.entry), missions.ts (missionLoopMax de rules).
- Client data-driven: player-logic.ts (sin CELL_W/CELL_H exportados; todo de rules.view), building.ts (geometría + colores + glows de rules.view, emissive acumulativo por canal con color del catálogo), actors.ts (fallbacks/radio de rules.view), camera.ts (cellW/cellH por parámetro), controller.ts (carga async de contenido, getter con error claro, labels de activities desde arquetipo y clima desde rules, demo de rules, ascensor localizado por presencia de parámetro, viaje desde world.entry, migración de guardados antiguos sin entry, sky/luces de rules).
- smoke-sim.ts actualizado: loadContent vía file:// con URL de import.meta y escenario desde rules.
- Verificación: tsc 0 errores en src/, lint 0 errores, SMOKE OK (28 bloques, 9 residentes, tutorial completo → m_bienvenida done +200 €), E2E con agent-browser: teléfono → subir 3 plantas → puerta 3C → entrar; cadena m_ascensor → junta (4 sí/1 no, rechazada por caja insuficiente, voteBias OK) → m_pintadas activa; Fiesta demo (ruido propagado a 2A/3B/1B/pasillo, Kevin mudado); Guardar/Cargar OK; móvil 390px OK; sin errores de consola.

Stage Summary:
- El juego ya es 100% data-driven: CERO ids/constantes de gameplay en código. Añadir un vecino, misión, edificio o rebalancear = editar JSON en public/content/ (validado por Zod al vuelo, sin tocar código).
- La costura para el arte final está en rules.view (geometría/colores greybox) + block.view/archetype.view: sustituir cajas/cápsulas por prefabs/glTF no toca sim ni lógica.
- World gana `entry` (con migración de guardados antiguos); guardar/cargar sigue funcionando.
- Pendientes futuros: editor de interiores, minijuegos, más canales (olor/plagas/wifi), audio, multiplayer.

---
Task ID: 5-ui
Agent: frontend-styling-expert
Task: Componentes UI v0.2: InteriorEditorPanel (editor de interiores) y MinigameModal (minijuego barra de precisión)

Work Log:
- Leído worklog.md (Tasks 1..4), store.ts, bridge.ts, content/index.ts + core/types.ts (Content.furniture / influences) y los modales de referencia PhoneModal/JuntaModal para copiar el patrón de modal bloqueante.
- Creado src/components/game/InteriorEditorPanel.tsx: Card ámbar "Mi piso"; texto gracioso si homes está vacío ("Aún no tienes piso. El portal, de momento, es tuyo."); catálogo cargado UNA vez con loadContent() en useEffect (cancelación al desmontar + estado de error; spinner "Subiendo el catálogo del barrio..." mientras tanto); selector de vivienda (Select) si hay varias; Tabs por estancia con candado (Lock) y CTA "Reformar (X €)" (furnitureConfig.roomUnlockPrice, disabled sin fondos con title="Sin fondos") en cerradas; plano de estancia relativo (h-40 sm:h-48, bg-muted/50, border) con ranuras posicionadas left/bottom en %, vacías = botón circular punteado con Plus (ring ámbar al seleccionar) y ocupadas = chip con emoji+nombre (color del mueble con alpha 0.85 vía helper withAlpha, texto blanco); fila inline "Quitar (+X €)" (refund = round(price * refundRatio), price del catálogo furniture[item.id]) y catálogo filtrado por slot.kind en ScrollArea max-h-72 (scrollbar fina ámbar) con precio, descripción, badges de emisiones (emoji/label del canal desde influences; positivo naranja, negativo esmeralda) y de params (nombre + delta con signo), botón "Colocar" por item (disabled sin fondos). Tras colocar, deselecciona la ranura. Solo llama al bridge (placeFurniture/removeFurniture/renovateRoom); aria-labels descriptivos en todas las acciones.
- Creado src/components/game/MinigameModal.tsx: modal bloqueante igual que PhoneModal/JuntaModal (showCloseButton={false}, preventDefault en onEscapeKeyDown/onPointerDownOutside/onInteractOutside, onOpenChange no-op), visible cuando s.minigame != null; barra h-10 rounded-full bg-muted con zonas buenas (emerald-500/40 + borde emerald-600, left/width clamp 0..100) y cursor ámbar de 3px (bg-amber-400, transition-none, centrado con -translate-x-1/2); ping-pong con requestAnimationFrame (dt clamp 0.1, rebote en 0/1) a cursorSpeed * (1 + aciertos * accelPerRound) pasadas/segundo, con refs para no reconectar el efecto; intentos vía botón "¡AHORA!", pointerdown en la barra y keydown global (Space/Enter, preventDefault + anti-autorepeat); aciertos como dots ámbar rellenos/vacíos y vidas como corazones lucide Heart (fill-rose-500 / apagados); status "Aciertos: X/Y · Intentos restantes: Z" con aria-live + micro-mensajes aleatorios al fallar ("Casi. Como el wifi del portal.", ...) y "¡Otra ronda!" al acertar; rAF y listeners limpiados al desmontar.
- Corregido error ESLint react-hooks/set-state-in-effect: la partida vive en un runner interno montado con key={minigame.id} (estado fresco por partida, sin efecto de reset con setState síncrono).
- Ajuste por trabajo en paralelo: store.ts aún no declara homes/furnitureConfig en GameState (están en HudSnapshot; la otra tarea los está añadiendo). Los selectores del panel usan una porción tolerante (EditorStateSlice con wallet de ancla + opcionales con defaults 0.5/250) que compila hoy y seguirá compilando cuando el store los exponga. Nota: MinigameState.emoji se lee tal cual del store (requerido ahí).
- Verificación: bunx tsc --noEmit → 0 errores en los 2 ficheros nuevos (los errores restantes pertenecen a ficheros en edición de la tarea paralela: controller.ts, content/index.ts, schemas.ts, sim/commands.ts, sim/rooms.ts); bun run lint → exit 0, 0 errores y 0 warnings. Sin `any`, sin azul/índigo (solo ámbar/naranja/esmeralda/rose/muted).

Stage Summary:
- Ficheros creados (EXACTAMENTE estos 2, ningún otro tocado): src/components/game/InteriorEditorPanel.tsx y src/components/game/MinigameModal.tsx.
- Props exactas: InteriorEditorPanel() (sin props; lee homes/wallet/furnitureConfig del store y llama SOLO al bridge) · MinigameModal({ onFinish }: { onFinish?: (success: boolean) => void }).
- Contrato de onFinish: SIN onFinish (por defecto) → useGameStore.getState().setMinigame(null) + getController()?.completeMinigame(id, success) con el id capturado del store antes de cerrar. CON onFinish → el modal delega en él y NO cierra ni completa: GameStage debe llamar setMinigame(null) (y/o completeMinigame); doneRef bloquea intentos tras terminar mientras tanto.
- Decisiones: sub-componentes de módulo (SlotChip, CatalogItemCard, LockedRoomBody, MinigameRunner) sin exports; selección de ranura global { roomKey, slotId } con toggle y reset al cambiar de tab/vivienda; catálogo ordenado por precio; dedos táctiles cubiertos (touch-none select-none en la barra); muebles centrados sobre su coordenada con -translate-x-1/2 translate-y-1/2.
- Nota de integración para T6: montar <InteriorEditorPanel /> en la grid de paneles de page.tsx y <MinigameModal /> junto al resto de modales en GameStage; si GameStage pasa onFinish, asume el cierre del modal.

---
Task ID: 5
Agent: main (Z.ai Code)
Task: Vertical slice 0.2 — editor de interiores, minijuegos y nuevos canales (100% data-driven, cero hardcode)

Work Log:
- Contratos: types.ts (FurnitureDef/MinigameDef/FurnitureSlotDef, RoomInstance.params+furniture, Command place/remove/renovate/complete_minigame, InfluenceRule con label/emoji/message/tone/uiLog, Rules.furniture); schemas.ts (furnitureSlotSchema, furnitureDefSchema, minigameDefSchema — movido tras `effects` por TDZ —, onThreshold ampliado, rulesSchema.furniture); store.ts (MinigameState, HomeUi/SlotUi, selectModalOpen con minigame, HUD con homes+furnitureConfig); bridge.ts (placeFurniture/removeFurniture/renovateRoom/completeMinigame).
- Contenido nuevo: furniture.json (14 muebles con humor; emiten canales y algunos ABSORBEN con valores negativos: difusor, plantas, placas acústicas), minigames.json (3 timing_bar: mg_limpiar_cabina, mg_desatascar, mg_trato_vecino), influences.json ampliado con odors y wifi (label/emoji + message data-driven + uiLog), rooms.json con labels y ranuras (salon_suelo/pared, dorm_suelo/mesa, bano_suelo), rules.json (channelGlow odors/wifi + rules.furniture con refundRatio 0.5, roomUnlock 250 € y textos de error), archetypes.json (guiso de Dolores emite odors 0.7; la fiesta de Kevin también emite odors), missions.json (limpiar ahora pasa por el minijuego; nuevas choices desatascar y negociar; misión m_salon_vacio que desbloquea tier 2), dialogs.json (dlg_decoracion).
- Sim: rooms.ts (instantiateRooms con params+furniture por defecto y migrateRooms para guardados v0.1), influence.ts (emissionsFromFurniture + absorción local de emisiones negativas en propagate), tick.ts (merge de emisiones actividades+muebles+extra), commands.ts (applyFurnitureParam con clamp a estancia o bloque; place_furniture/remove_furniture/renovate_room/complete_minigame con textos de error del catálogo), content/index.ts (FILES furniture+minigames y validación cruzada: categorías de ranura, canales de muebles, zonas de minijuegos, startMinigame referenciados).
- Cliente: controller.ts (migración de estancias al cargar, 4 métodos nuevos + furnitureFail con textos del catálogo, eventos furniture_placed/removed, room_renovated, minigame_requested→modal, minigame_finished, umbral de canales 100% data-driven por uiLog, homesUi() con posiciones en %), building.ts (greybox de muebles: una caja por ranura de TODAS las viviendas desde el layout del catálogo, escala/color/tamaño desde furniture.view al pintar), GameStage (MinigameModal montado), page.tsx (badge 0.2 + InteriorEditorPanel + subtítulo/footer), HelpCard (nota nueva), MinigameModal (aria-describedby para silenciar warning Radix).
- Verificación: `bun run lint` → 0 errores; tsc → 0 errores en src/ (solo preexistentes en upload/); smoke-sim.ts extendido y OK (router en pared → wifi_shared y canales wifi en 9 bloques vecinos; olla → odor_complaint; rechazos de ranura duplicada/equivocada; reembolso 50%; renovate_room; minijuegos aplican onSuccess/onFail sobre humidity); E2E agent-browser: teléfono → panel Mi piso (tabs/ranuras/catálogo filtrado por kind) → colocar router (800→620 €, canal wifi propagando en vivo) → reforma del dormitorio (800→550 €, access unlocked, toast del catálogo) → colocar sofá (550→430 €) y sofá rosa visible en el greybox 3D del 3C → minijuego con aciertos/vidas → victoria → cierre automático + efectos onSuccess + log → Guardar/Cargar persiste muebles y reformas → móvil 390px correcto con footer pegado. Nota: los refs de agent-browser no llegan a botones portaled de Radix (limitación de la herramienta; clicks DOM/teclado nativos funcionan bien).
- Stage Summary:
- V0.2 jugable: editor de interiores completo (comprar/colocar/quitar/reformar con economía), minijuegos data-driven integrados en misiones, y canales de influencia ampliados (noise, water, odors, wifi) donde añadir un canal nuevo = editar JSON.
- La costura del arte final se mantiene: muebles con view (color/size) sustituibles por prefabs; el editor y el sim no saben nada de geometría.
- Pendientes futuros: drag&drop en el editor, más tipos de minijuego en el catálogo (solo timing_bar), canales plagas/smoke, multi-vivienda destacada en el edificio, audio.

---
Task ID: 6-a
Agent: frontend-styling-expert
Task: Reescribir MinigameModal.tsx para soportar 4 tipos de minijuego data-driven (timing_bar, tap_sequence, reflex_targets, memory_pairs)

Work Log:
- Leído worklog.md (Tasks 1..5), store.ts (MinigameState unión discriminada por type, verificado que se exporta), bridge.ts (completeMinigame(id, success)), content/index.ts (loadContent cacheada), core/types.ts (los 4 configs de minijuego + Rules.minigames con winLine/loseLine/hitLine/failLines/introByType) y public/content/minigames.json + rules.json (tono vecinal y textos del catálogo).
- Reescrito EXCLUSIVAMENTE src/components/game/MinigameModal.tsx (ningún otro fichero tocado). Estructura: MinigameModal (Dialog bloqueante idéntico al anterior: showCloseButton={false}, onOpenChange no-op, preventDefault en onEscapeKeyDown/onPointerDownOutside/onInteractOutside, max-w-md, aria-describedby={undefined}; key={minigame.id} en el runner) → MinigameRunner (switch por minigame.type con config ya estrechada por TS) → 4 runners internos sin exports.
- Contrato de finalización unificado en hook useMinigameFinish(onFinish): doneRef + finish(success); CON onFinish delega y no cierra; SIN onFinish captura el id del store ANTES de cerrar (setMinigame(null) + getController()?.completeMinigame(id, success)). Idéntico al comportamiento previo.
- Textos 100% del catálogo: loadContent() UNA vez en el Modal (useEffect con flag cancelled, setState solo en .then; catch silencioso) → estado texts; mientras carga, runners funcionan con EMPTY_TEXTS ('' y failLines: []). Cero frases de humor en código (borradas las constantes INTRO_LINE/HIT_LINE/WIN_LINE/LOSE_LINE/FAIL_LINES del fichero antiguo). Instrucción visible = minigame.instruction ?? introByType[type] ?? '', siempre renderizada bajo la descripción (text-xs text-muted-foreground, aria-live="polite").
- Status data-driven: fallo → pickLine(failLines); acierto intermedio → hitLine; victoria → winLine; derrota → loseLine; status con aria-live="polite".
- Piezas comunes: RunnerHeader (emoji circular ámbar + Badge font-mono con progreso por tipo), ProgressDots (ámbar, role="img"), LivesHearts (lucide Heart fill-rose-500/apagados), StatusLine, InstructionLine. Sin azul/índigo en todo el fichero.
- TimingBarRunner: conservado 1:1 del fichero anterior (ping-pong rAF con dt clamp 0.1 y rebote 0/1, velocidad cursorSpeed*(1+hits*accelPerRound), zonas emerald-500/40+borde emerald-600 con left/width clampPct, cursor ámbar 3px con sombra, botón ¡AHORA! h-12 bg-amber-600, pointerdown en barra + Space/Enter globales anti e.repeat, touch-none select-none).
- TapSequenceRunner (Simón): secuencia = sequenceStart + ronda*sequenceGrow índices aleatorios (useState inicial + regeneración al avanzar ronda); fase showing con cadena de setTimeouts en useEffect (refs + flag cancelled; setState SOLO en callbacks temporales; timeoutsRef con todos los ids, limpieza al desmontar y al reintentar) → fase input; pads del catálogo con grid por cardinalidad (2→cols-2, 3→cols-3, 4→cols-2 sm:cols-4, resto→cols-3), size-16 sm:size-20 rounded-2xl, flash ámbar (bg-amber-400 text-neutral-900 scale-[1.05] shadow-lg), opacity-60 cursor-not-allowed con aria-disabled en showing; inputTimeoutMs como efecto sobre [phase, progress] (reset por pulsación), fallo/timeout = vida-1, 0 vidas → loseLine+finish(false), si no → failLine y REINTENTA la misma secuencia; teclado Digit1..Digit6 (listener global con cleanup y anti e.repeat); dots ámbar por ronda completada, badge ronda+1/rounds.
- ReflexTargetsRunner: tablero h-56 relative rounded-lg border bg-muted/50 overflow-hidden touch-none select-none; targets {id,x:5..95,y:8..92,decoy,bornAt} con setInterval spawnIntervalMs (decoy = decoyEmoji && decoyChance > Math.random()); UN rAF barre caducados (targetLifeMs, cuenta escapes no-señuelo en escapedRef → escaped > missesAllowed → finish(false)) y refresca `now` para animate-pulse en el último 25% de vida; refs espejo targetsRef + commit() como única puerta de escritura (el rAF nunca llama finish/setState dentro del updater); hit con onPointerDown + stopPropagation: señuelo → vida-1, objetivo → hitsRef, hits >= targets → winLine+finish(true); target = button absolute -translate-x/y-1/2 aspect-square width=radiusPct*2% rounded-full bg-background/85 border shadow, animate-in zoom-in-50 duration-150; fila secundaria "Escapados: X/Y" en text-xs; clic fuera no penaliza.
- MemoryPairsRunner: mazo = 2 copias de items barajadas Fisher-Yates una vez (useState inicial); flipped máx 2, lockRef durante la resolución; pareja buena → matched (todas → winLine+finish(true), si no hitLine); fallida → lock + 700ms (setTimeout en ref, limpiado al desmontar) → desvoltea + vida-1 (0 → loseLine+finish(false), si no failLine); grid-cols-4 max-w-xs gap-2; boca abajo bg-amber-500/15 border-amber-500/40 con "?", boca arriba bg-background text-2xl, matched opacity-60 ring-emerald-500/50; hover/focus-visible solo en clicables.
- ESLint/tipos: sin any, sin setState síncrono en cuerpo de efecto, cleanup completo de rAF/intervals/timeouts/listeners, useCallback en handlers usados por efectos; verificado `bunx tsc --noEmit` → 0 errores en src/ (solo preexistentes en upload/VECINOS_src) y `bun run lint` → exit 0 sin errores ni warnings.

Stage Summary:
- Fichero reescrito (EXACTAMENTE uno): src/components/game/MinigameModal.tsx. Sigue exportando `MinigameModal` nombrado con props { onFinish?: (success: boolean) => void }; GameStage no necesita cambios (<MinigameModal /> sin onFinish usa la vía setMinigame(null)+completeMinigame).
- Los 4 tipos del catálogo quedan jugables: mg_limpiar_cabina/mg_desatascar/mg_trato_vecino (timing_bar), mg_fumigar (reflex_targets con señuelo 🕸️), mg_fusibles (tap_sequence 🔴🟡🟢🔵 con timeout y reintentos de la misma secuencia), mg_buzones (memory_pairs 6 parejas). Añadir otro minijuego = editar JSON, sin tocar código.
- Cero hardcode de textos/números de gameplay: todas las líneas de estado salen de rules.minigames y la instrucción de def.instruction ?? introByType; la única constante de presentación en código es el retardo de 700 ms del desvolteo (pedido en el spec).
- Decisiones: progreso por tipo en el badge (hits/rounds, ronda+1/rounds, hits/targets, matchedPairs/totalPairs) y dots ámbar comunes; pads y fichas con onClick (accesibles por Enter/Space) y solo barra/reflex con pointerdown según spec; "Escapados: X/Y" como fila funcional (no humor) porque el catálogo no trae etiqueta para esa métrica.
- Pendiente para integradores: si GameStage pasa onFinish, debe cerrar el modal él mismo (el runner no cierra mientras exista onFinish); los textos vacíos durante la carga inicial son neutros y se rellenan al resolver loadContent (normalmente ya cacheada por GameStage).

---
Task ID: 6 (integración y verificación; completa 6-b que expiró sin worklog)
Agent: main (Z.ai Code)
Task: Vertical slice 0.3 — drag & drop en el editor, catálogo de minijuegos (4 tipos) y canales plagas/smoke (100% data-driven)

Work Log:
- Contratos (6-prep): types.ts (MinigameTapSequenceConfig/ReflexTargets/MemoryPairs + MinigameType/MinigameConfig + MinigameDef como unión discriminada por `type` + Rules.minigames), schemas.ts (minigameDefSchema = discriminatedUnion con 4 ramas + rulesSchema.minigames), content/index.ts (validación cruzada por tipo: zonas/pads/radius/decoy/pares únicos + introByType debe cubrir cada tipo usado), store.ts (MinigameState = DistOmit<MinigameDef,'emoji'|'instruction'> & {emoji, instruction}), controller.ts (minigame_requested hace spread de la def con emoji/instruction resueltos).
- Contenido (6-content): influences.json +smoke (sube 0.9, decae 0.12, umbral 0.45 → smoke_alarm + soot+15) y +plagas (baja 0.55, decae 0.03, umbral 0.15 → plague_sighting + plague+25); furniture.json +5 muebles (plancha humo 0.6, incienso humo 0.3/odors -0.25, caja de trastos plagas 0.55, trampas plagas -0.3, campana extractora humo -0.3/odors -0.15); archetypes.json +actividad quema_guiso de la cotilla (humo 0.85, 13-15h, chance 0.22) y fiesta de Kevin emite plagas 0.45; blocks.json +params plague/soot (tier 2) en vivienda_estandar (setParam solo aplica params declarados); minigames.json +mg_fumigar (reflex_targets 🪳 con señuelo 🕸️ 20%), mg_fusibles (tap_sequence 🔴🟡🟢🔵, 3 rondas 2→4), mg_buzones (memory_pairs 6 parejas, 5 vidas); missions.json +m_plagas_1b (trigger blk_p1_b.plague≥20 → teléfono → fumigar/derrama/culpar), m_humo_detector (blk_p2_b.soot≥10 → fusibles/ventilar/junta detectores), m_correos (dayMin 3 → mg_buzones/profesional/caos); dialogs.json +dlg_plagas/dlg_humo/dlg_correos; rules.json +channelGlow smoke #9aa5b1 y plagas #8bc34a + rules.minigames (winLine/loseLine/hitLine/failLines/introByType, cero textos de humor en código).
- UI 6-a (subagente, completada): MinigameModal reescrito con 4 runners data-driven; tsc/lint limpios; verificado en E2E (ver abajo).
- UI 6-b (subagente expiró a mitad; código completado y revisado por main): InteriorEditorPanel con drag & drop por pointer events (umbral ratón 6px, long-press táctil 260ms con cancelación por scroll >8px, touchmove no pasivo solo durante drag activo), fantasma fijo con emoji+nombre+precio siguiendo al puntero (imperativo, sin re-render por frame), hover por elementFromPoint con data-slot-*, anillos esmeralda (compatible vacía) y rosa (incompatible/ocupada), drop SIEMPRE delega en place_furniture (el sim valida con los errores graciosos del catálogo), limpieza total en unmount, flujo de clic intacto (Colocar con stopPropagation). Mejora de main: catálogo SIEMPRE visible (filtrado por ranura seleccionada o completo para arrastrar).
- Bug de layout detectado en E2E y corregido: el catálogo completo (19 items) desbordaba el ScrollArea (max-h-72 en el Root no limita al Viewport con h-full en padre auto) y empujaba el footer ~1900px; fix con [&>[data-slot=scroll-area-viewport]]:max-h-[inherit]. docH móvil vuelve a 2410px.
- Verificación: smoke-sim extendido (plagas a 9 bloques con plague+25 y 4 eventos de umbral; smoke con soot+15 en 4C y 6 eventos; rechazo plancha en pared; mg_fumigar/mg_buzones/mg_fusibles aplican onSuccess/onFail; m_humo_detector se auto-dispara por el guiso quemado de Dolores en plena simulación); lint 0, tsc 0 en src/; E2E agent-browser: tutorial completo, drag & drop real con ratón (trastos 30 € → ranura 1 y 2, cartera 800→770, fantasma/anillos en capturas), cadena plagas completa (fiesta 21:30 → plagas en 1B → plague 25 → m_plagas_1b → teléfono Dolores → elección → minijuego reflex_targets en pantalla con cucarachas/señuelos/vidas/escapados), tap_sequence (pads del catálogo, fases showing/input, fallo por timeouts → onFail condición -5), memory_pairs (tablero 12 fichas, parejas con anillo esmeralda, fallos restan vidas), glow 3D de plagas (lima) y smoke (gris) mezclándose con ruido (naranja), Guardar/Cargar persiste los 6 canales y el tick, móvil 390px con footer pegado tras el fix. Nota honesta: el win-path E2E de los minijuegos nuevos no se completó por latencia del tooling (los input timeouts de 6s compiten con ~1,5s por orden CDP); el camino de fallo sí está verificado E2E y el de éxito a nivel sim (smoke) — el código del win-path es simétrico al de fallo. En sesión interactiva humana se juega sin problema.
- Stage Summary:
- V0.3 jugable: editor con drag & drop (ratón+táctil, fantasma, resaltado por compatibilidad, el sim sigue siendo el juez), catálogo de minijuegos de 4 tipos (añadir un tipo de PARTIDA concreta = editar minigames.json), y canales de influencia plagas/smoke con emisores y absorbentes en el catálogo de muebles y actividades de arquetipos.
- Cero hardcodeo mantenido: textos de minijuegos en rules.minigames, configs por tipo en cada def, umbrales/spreads de canales en influences.json, params nuevos declarados en blocks.json.
- Pendientes futuros: controles táctiles del juego, audio, multi-vivienda destacada, win-path E2E automatizable (bajar tiempos del catálogo en un scenario de test), más arquetipos/misiones.
---
Task ID: 7
Agent: main (Z.ai Code)
Task: Preparar copia de respaldo del proyecto en GitHub y el mecanismo para mantenerla actualizada

Work Log:
- Auditado el estado git del sandbox: repo local sano (rama main, working tree limpio, 256 ficheros trackeados, 6 commits), SIN remote configurado, sin gh CLI y sin credenciales de GitHub en el entorno → el push exige credenciales del usuario (su cuenta/token); nada de esto se puede suplir desde el sandbox.
- Creado scripts/backup-github.sh (ejecutable): un comando hace add -A + commit (mensaje automático con timestamp o -m "mensaje") + push a origin/main; modos --check (estado sin subir) y -m; valida remote ausente con mensaje accionable; diagnostica fallos de push (token caducado 401/403, red, permisos) y oculta el token al imprimir la URL del remote.
- Creada docs/BACKUP-GITHUB.md (español): Paso 1 crear repo vacío en GitHub (private, sin README/gitignore/license), Paso 2 fine-grained PAT (solo ese repo, Contents: Read and write, 90 días, revocable), Paso 3 conexión (Opción A: usuario pega repo+token en el chat y yo lo conecto y hago el primer push; Opción B: comandos manuales), mantenimiento ("sube los cambios a GitHub" en chat o el script), caducidad/rotación del token, notas de contenido (upload/VECINOS.zip 43 MB < límite 100 MB sube sin LFS; tool-results/ y db/custom.db incluidos por decisión del usuario, con opción de .gitignore), y cómo restaurar el proyecto desde GitHub (clone + bun install + bun run dev, la partida db/custom.db viaja con el repo).
- Probado el script: bash -n OK y el camino sin remote muestra el mensaje accionable correcto (exit 1 esperado).
- Commit de la herramienta con mensaje limpio: "chore(backup): script backup-github.sh y guía de respaldo en GitHub" (cae0119). Historial queda en 7 commits, tree limpio.

Stage Summary:
- Respaldo 100% preparado en el lado sandbox: falta ÚNICAMENTE que el usuario cree el repo en GitHub y facilite URL + fine-grained PAT (con Contents: Read and write); con eso, primer push inmediato (sube historial completo incluida v0.3) y de ahí en adelante "mantener actualizado" = un comando o pedírmelo en el chat.
- Artefactos: scripts/backup-github.sh, docs/BACKUP-GITHUB.md, commit cae0119.
- Riesgo/limitación: no puedo crear la cuenta/repo ni autenticarme por mi cuenta; sin token no hay push. Ofrecida rotación y revocación del token como control de seguridad.
---
Task ID: 8
Agent: main (Z.ai Code)
Task: Conectar el sandbox a GitHub (repo FranJavierDavila/VECINOS) y ejecutar el primer push de respaldo

Work Log:
- El usuario facilitó un fine-grained PAT en el chat. Verificada la conectividad de salida del sandbox: github.com 200 OK; api.github.com sin auth devolvía 403 por rate-limit anónimo, con token responde 200.
- Identificado el propietario vía GET /user → login FranJavierDavila (id 196038989). GET /user/repos con el token devolvió 4 repos con push habilitado; seleccionado FranJavierDavila/VECINOS (privado, default branch main) por nombre coincidente con el proyecto. NOTA de seguridad comunicada: el token alcanza también CrazyPP, archviz-api-v2 y AppMente → recomendado re-escopar a "Only select repositories" = VECINOS.
- GET /commits del repo remoto devolvió 409 "Git Repository is empty" → repo vacío, sin riesgo de historiales en conflicto.
- Configurado remote origin = https://FranJavierDavila:<PAT>@github.com/FranJavierDavila/VECINOS.git (token en .git/config del sandbox, tal y como se acordó; revocable desde GitHub en cualquier momento).
- Ejecutado scripts/backup-github.sh → push inicial correcto: * [new branch] main -> main, tracking configurado. Sin commits nuevos pendientes en ese momento.
- Verificación triple: (1) git ls-remote → HEAD remoto 26b57b4 == HEAD local; (2) GET /commits → 8 commits visibles, top = Task 7 y tooling de backup; (3) GET /git/trees?recursive=1 → 258 blobs, truncated=false, presentes los ficheros clave: public/content/*.json (minigames, influences...), src/components/game/InteriorEditorPanel.tsx y MinigameModal.tsx, docs/BACKUP-GITHUB.md, scripts/backup-github.sh, db/custom.db, upload/VECINOS.zip, prisma/schema.prisma, src/game/sim/influence.ts.
- Este mismo entry de worklog se commitea y push-ea inmediatamente después de escribirlo como demostración del flujo "mantener actualizado" (Task ID 8 en el propio commit).

Stage Summary:
- Respaldo ACTIVO: todo el proyecto (código, contenido data-driven, partida guardada, docs, historial de 8 commits) está en github.com/FranJavierDavila/VECINOS (privado).
- Mantenimiento: "sube los cambios a GitHub" en chat, o ./scripts/backup-github.sh [-m "mensaje"]. Rotación de token: git remote set-url origin https://<NUEVO>@github.com/FranJavierDavila/VECINOS.git.
- Pendiente opcional para el usuario: re-escopar el PAT solo a VECINOS (ahora cubre 4 repos) y, si quiere vincular los commits a su perfil, configurar user.email con su email noreply de GitHub.
---
Task ID: 9
Agent: main (Z.ai Code)
Task: Recuperar la conexión con GitHub tras la invalidación del primer token (nuevo PAT) y sincronizar todo

Work Log:
- Incidencia (Task 8, pendiente de registrar): el segundo push falló con "remote: Invalid username or token" y GET /user confirmó 401 Bad credentials para el primer PAT, minutos después de un push exitoso. Descartada fuga del token en el historial (git log -S 'github_pat_11BOXV' = 0 resultados → no fue secret-scanning por nuestro push). Causa más probable: cuenta de GitHub recién creada (id 196038989) con email sin verificar → GitHub auto-revoca los fine-grained PAT de cuentas sin verificar. El respaldo principal NO estuvo en riesgo: el primer push (historial completo, 258 ficheros) ya se había completado y verificado.
- El usuario regeneró el token y confirmó la URL del repo (https://github.com/FranJavierDavila/VECINOS.git). Nuevo PAT validado vía API: GET /user → 200 (FranJavierDavila) y GET /repos/FranJavierDavila/VECINOS → push: true.
- Actualizado el remote: git remote set-url origin https://FranJavierDavila:<NUEVO-PAT>@github.com/FranJavierDavila/VECINOS.git.
- Push del commit pendiente 27ee397 (worklog Task 8): 26b57b4..27ee397 main -> main. Verificado ls-remote == HEAD local.
- Este entry (Task 9) se commitea y push-ea como sync final; tras él, local y remoto quedan idénticos.

Stage Summary:
- Respaldo 100% operativo y sincronizado: github.com/FranJavierDavila/VECINOS (privado) == /home/z/my-project (rama main), con historial completo y tooling de backup (scripts/backup-github.sh + docs/BACKUP-GITHUB.md).
- Lección registrada: con cuentas nuevas, VERIFICAR EL EMAIL de GitHub antes de generar el PAT (si no, GitHub revoca el token automáticamente). Si el token muere de nuevo → regenerarlo y pedir "actualiza el token" en chat, o git remote set-url.
- Recomendaciones pendientes para el usuario: verificar email de GitHub; re-escopar el PAT a "Only select repositories" = VECINOS; opcionalmente configurar user.email con su email noreply para vincular commits a su perfil.
---
Task ID: 10
Agent: main (Z.ai Code)
Task: Vincular los commits al perfil de GitHub del usuario (identidad git = FranJavierDavila <trabajosen3d@gmail.com>)

Work Log:
- Backup de seguridad antes de tocar historial: git bundle en /tmp/vecinos-pre-rewrite.bundle (--all) + rama local backup/pre-rewrite. Estado previo verificado: 10 commits, 258 ficheros, autor "Z User <z@container>".
- Configurada la identidad a nivel repo y global: user.name=FranJavierDavila, user.email=trabajosen3d@gmail.com (todos los commits futuros saldrán ya con esta autoría).
- Re-atribución del historial completo con git filter-branch --env-filter (author+committer) sobre --all: 10/10 commits reescritos. Integridad verificada tras el rewrite: mismos 10 commits y 258 ficheros, working tree limpio, único autor del historial = FranJavierDavila <trabajosen3d@gmail.com>.
- Push forzado y verificado: + 2a15700...c0f49b2 main -> main (forced update); ls-remote == HEAD local (c0f49b2).
- Worklog Task 10 creado con la nueva identidad (este commit es el primero nacido ya atribuido al usuario) y push normal.
- NOTA: los hashes citados en entries anteriores (cae0119, 26b57b4, 27ee397, 2a15700) quedaron obsoletos por el rewrite; el contenido es idéntico. Local y remoto sincronizados.

Stage Summary:
- Todo el historial del repo (10 commits) aparece ahora en GitHub con la autoría FranJavierDavila <trabajosen3d@gmail.com>; los commits se vincularán a su perfil en cuanto el email esté verificado en GitHub (pendiente crítico: verificar trabajosen3d@gmail.com en Settings → Emails, también necesario para que GitHub deje de revocar los PAT).
- Artefactos: bundle de seguridad /tmp/vecinos-pre-rewrite.bundle y rama local backup/pre-rewrite (eliminables cuando el usuario confirme que todo se ve bien en GitHub).
---
Task ID: 12-a
Agent: frontend-styling-expert
Task: TouchControls.tsx — mandos táctiles data-driven (stick virtual + botones)

Work Log:
- Leído worklog.md (Tasks 1..10, estilo y convenciones), store.ts (touchVisible/setTouchControls con persistencia en 'vecinos.touch', camMode, selectModalOpen derivada de phone/choices/junta/minigame/finale), bridge.ts (setTouchInput direcciones mantenidas, interact, setCamMode), content/index.ts (loadContent cacheada con issues), core/types.ts (Rules.touch: deadzone 0..1, stick.base/thumb px, labels interact/camera/move, hint) y controller.ts (interact es private pero existe en runtime; setCamMode sincroniza rig Y store). Verificado rules.json → touch { deadzone 0.35, base 124, thumb 52, ✋/🎥/Mover }.
- Creado EXCLUSIVAMENTE src/components/game/TouchControls.tsx (ningún otro fichero tocado). 'use client' una sola vez, export nombrado TouchControls() sin props.
- VISIBILIDAD: selector useGameStore(s => s.touchVisible); efecto de arranque con guard bootstrappedRef (una sola vez, inmune a StrictMode): si localStorage('vecinos.touch') existe restaura la preferencia (solo '1' → setTouchControls(true); '0' no hace falta), si NO existe auto-detección window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window → setTouchControls(auto). Si visible=false → return null DESPUÉS de todos los hooks (orden estable).
- CATÁLOGO: loadContent() una vez en useEffect (flag cancelled, catch silencioso) → useState TouchConfig = Rules['touch']; espejo touchRef (actualizado solo en el .then) para que los handlers useCallback([]) nunca cierren sobre config obsoleta. Defaults defensivos mientras carga: deadzone 0.35, base 124, thumb 52, labels {interact:'✋', camera:'🎥', move:'Mover'}; render idéntico desde el primer frame.
- STICK (pointer-events-auto absolute bottom-4 left-4, tamaño rules.touch.stick.base px inline, rounded-full bg-black/40 border-white/15 backdrop-blur-sm touch-none select-none, role="application" aria-label={labels.move}): pulgar circular stick.thumb px centrado con márgenes negativos (no transform), desplazado por style.transform translate3d imperativo acotado al radio (base-thumb)/2 — cero re-renders por frame. Pointer events: down (captura con setPointerCapture + try/catch, guarda pointerId, cachea getBoundingClientRect, posiciona pulgar bajo el dedo), move (si activo y no modal: normaliza por (base-thumb)/2, magnitud>1 → normaliza, muere dentro de deadzone NORMALIZADO: left= nx<-dz, right= nx>dz, up= ny<-dz, down= ny>dz con dy positivo hacia abajo), up/cancel/lostpointercapture → releaseStick idempotente por pointerId (try/catch en releasePointerCapture, pulgar al centro, setTouchInput a cero). Guard dirsRef: setTouchInput SOLO cuando cambia alguna dirección. Segundo dedo ignorado (activePointerRef).
- BOTONES (columna bottom-4 right-4, touch-none select-none, pointerdown preventDefault anti doble-disparo): ✋ size-16 bg-amber-500/90 text-neutral-900 text-2xl shadow-lg active:scale-95, onClick → guard modal + getController()?.interact(), aria-label="Interactuar (entrar, salir o usar)"; 🎥 size-14 bg-neutral-800/80 text-xl border-white/15, onClick → cicla CAM_ORDER edificio→planta→estancia leyendo useGameStore.getState().camMode y llama controller.setCamMode (sincroniza rig+store) con fallback a store.setCamMode si el puente aún no existe, aria-label="Cambiar cámara".
- MODALES: en pointerdown/pointermove del stick y onClick de ambos botones se consulta selectModalOpen(useGameStore.getState()) EN EL EVENTO → entrada ignorada (el mundo está congelado). pointerup/cancel siempre liberan (poner direcciones a cero es seguro incluso congelado).
- LIMPIEZA: sin listeners de window; captura liberada y dirsRef/activePointerRef/baseRectRef reseteados; efecto sobre [visible] con cleanup que suelta direcciones (getController()?.setTouchInput({left/right/up/down:false})) al ocultarse o desmontar con un dedo a medio arrastre; sin setState síncrono en cuerpo de efecto (setState solo dentro del .then del catálogo); sin any.
- Verificación: `bunx tsc --noEmit` → 0 errores en TouchControls (quedan SOLO los 3 preexistentes ajenos: 2 de Prisma en src/app/api/save/route.ts y el de src/game/client/controller.ts:630 porque GameController aún no implementa setTouchInput/visitHome del bridge). `bun run lint` → exit 0 limpio. Dev server no arrancado; sin E2E (los hará el integrador).

Stage Summary:
- Contrato exportado: `export function TouchControls()` ('use client', sin props) en src/components/game/TouchControls.tsx. Montaje: <TouchControls /> dentro del div relative de GameStage (como ToastStack); se posiciona solo (absolute inset-0 z-20 pointer-events-none con clústeres pointer-events-auto). Los modales (portal z-50) quedan por encima.
- Data-driven 100%: deadzone, tamaños del stick y emojis/etiquetas salen de rules.touch; añadir/ajustar mandos = editar rules.json. Las únicas constantes de código son estructurales (ciclo de cámara edificio→planta→estancia del contrato, clave de persistencia 'vecinos.touch' ya escrita por store.setTouchControls, y defaults defensivos de arranque). rules.touch.hint no se renderiza aquí: es el texto del toggle de la barra (lo pintará quien monte el conmutador).
- Decisiones: deadzone comparado sobre el valor NORMALIZADO del recorrido (es 0..1, dx en px no lo es); restauración de preferencia '1' guardada además de la auto-detección de primera visita (si no, la persistencia del store nunca tendría efecto al recargar); thumb movido imperativamente (sin re-render por frame); 🎥 delega en controller.setCamMode con fallback al store.
- Nota para el integrador: bridge.setTouchInput ya está tipado pero GameController aún no lo implementa (error tsc preexistente en controller.ts:630, junto a visitHome); hasta que el controlador lo sume, los mandos se ven y los botones ✋/🎥 funcionan, pero el stick no mueve al personaje. Guard de modal duplica la política del teclado (onKeyDown de controller).
