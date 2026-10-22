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
