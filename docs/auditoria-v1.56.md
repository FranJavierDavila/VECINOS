# Auditoría v1.56 — VECINOS (co-op real + voz WebRTC + rejoin)

| | |
|---|---|
| **Auditor** | Agente supervisor T7 (READ-ONLY: no se modificó ningún archivo de código) |
| **Fecha** | Auditoría realizada sobre el árbol de trabajo actual |
| **Alcance** | Misiones cooperativas reales, canal de voz WebRTC, reconexión con `session:rejoin` + gracia de 30 s |
| **Estado del repo** | ⚠️ El trabajo v1.56 está **SIN COMMITEAR** en el working tree de `main`. La rama `fase-2-coop-competitivo` apunta al MISMO commit que `main` (`14e18e0`, v1.55) y `git diff main...HEAD --stat` está **vacío**: todo el diff (12 ficheros modificados, +866/−21, y 3 ficheros nuevos) vive solo como cambios locales. |
| **Método** | Lectura del código real (diff completo HEAD↔working tree), re-ejecución del smoke en el servidor vivo, verificación en navegador real vía Caddy `:81` (carga, host de sesión, toggle de voz on/off y limpieza) y sondeos del protocolo. |

---

## 1. Resumen ejecutivo

**VEREDICTO: ✅ APTO para jugar co-op/competitivo** en las condiciones verificadas (2–4 jugadores, LAN/dev vía Caddy `:81`, servidor desplegado en el puerto fijo 3010), **con condiciones**: se recomienda corregir los hallazgos 🟠 antes de dar la versión por cerrada y, sobre todo, **commitear el trabajo en `fase-2-coop-competitivo`** (hoy es irrecuperable ante un descarte del working tree).

**Evidencia acumulada:**

- **Smoke del protocolo re-ejecutado por el auditor contra el servidor vivo**: `✔ TODO OK` — 18/18 asserts PASS (catálogo 3 misiones, voz maxPeers=4, solitario no-oferta, oferta «Apagón en la comunidad», roles, guardias rol-ocupado/rol-ajeno, cierre +bonus +150×2, voz roster/relay/estado, rejoin).
- **Navegador real (verificación propia, 1 sesión vía `http://localhost:81/?qaengine=1`)**: la app carga con el chip «v1.56 · co-op real + voz»; sesión creada vía puente QA; la tarjeta co-op muestra «Sin misión cooperativa activa» en solitario (minPlayers=2 respetado); `voiceToggle()` ON → `{active:true, synthetic:true}` + aviso «modo escucha» (headless sin micro → pista AudioContext, ruta completa correcta); OFF → `{active:false}` y **0 elementos `<audio>` residuales** (limpieza verificada); QA hooks `getVoicePeers()`/`getVoiceState()` operativos.
- **E2E de 2 sesiones reportado por el equipo de desarrollo** (incluido como evidencia del proyecto): oferta co-op visible, roles reclamados sincronizados cruzados, objetivo reach auto-completado (portal), minijuego del rol → cierre con toast «resolvieron «Apagón en la comunidad»» +150×2 (marcador 200), duelo de fusibles +50 (6,3 s), catálogo cicla («Operación goteo» ofertada sola), voz WebRTC `connected` en ambas direcciones con roster completo. Pendiente menor conocido: indicador «hablando» en headless (AudioContext limitado sin gesto de usuario; la ruta de servidor sí verificada en smoke «voz-estado»).

**Resumen de hallazgos**: 0 🔴 · 5 🟠 · 8 🟡 · 6 🔵. Ninguno bloquea la partida estándar; los 🟠 afectan a los caminos de degradación (rejoin fallido, doble toggle de voz, flap de red que mate el P2P, flood del relay) y a la operación del repo.

---

## 2. Hallazgos

Severidades: 🔴 crítico · 🟠 importante · 🟡 menor · 🔵 nota.

### 🟠 H1 — Rejoin fallido deja el multijugador inutilizable hasta recargar (y el micro abierto)

- **Dónde**: `src/game/client/controller.ts:913-927` (fallo de `session:rejoin`) + guardias `controller.ts:829,842` (`hostSession`/`joinSession`: `if (this.net || …) return`).
- **Qué pasa**: si el rejoin falla (sesión expirada por TTL, **reinicio del servidor** — rutinario con `bun --hot`—, o ausencia > gracia+TTL), el cliente fija `mpStatus='error'` con el mensaje «La sesión de la comunidad ya no existe. Crea otra partida…», pero **no desmonta `this.net`**. El panel en estado `error` ofrece «Volver a intentarlo», que fija `mpStatus='off'` y pinta los botones «Crear partida compartida» / «Unirse»; al pulsarlos, `hostSession()`/`joinSession()` retornan en silencio porque `this.net` sigue vivo → **botones muertos**, único escape F5. Además no se llama `stopVoice()`: si el usuario estaba en el canal, el micro queda capturado con peers muertos, y `mpCoop`/`mpVoice` quedan obsoletos. Como `reconnectionAttempts: Infinity`, cada reconexión repite el rejoin fallido.
- **Impacto**: callejón sin salida de UX tras un reinicio del servidor (el caso más común en dev), con micrófono potencialmente abierto.
- **Recomendación**: en la rama de fallo del rejoin, ejecutar la misma limpieza de `leaveSession()` (net.leave+disconnect, `net=null`, `appliedSeq=0`, `stopVoice()`, reset de `mpCoop`/`mpVoice`/`mpSession`) y permitir re-crear; alternativamente, hacer que `hostSession`/`joinSession` desmonten un `net` huérfano cuando `mpSession` ya no existe.

### 🟠 H2 — Carrera en `voiceToggle`: doble clic rápido deja el micrófono capturado con el canal «cerrado»

- **Dónde**: `src/game/client/voice.ts:81-112` (`start()` no comprueba `this.stopped` tras el `await getUserMedia`; línea 110 restaura `stopped=false`) + `src/game/client/controller.ts:1013-1044` (`voiceToggle` crea el canal de forma síncrona; el segundo clic cae en la rama de salida).
- **Qué pasa**: primer clic → `this.voice = channel` y `start()` queda esperando `getUserMedia`. Segundo clic (el botón todavía muestra «Entrar al canal de voz» porque la UI se actualiza cuando `start()` resuelve) → rama de salida: `stopVoice()` + `voiceLeave()`; `stop()` se ejecuta con `localStream` aún nulo (no detiene nada). Cuando `getUserMedia` resuelve, `start()` continúa: captura el micro, arranca el analizador y **resucita el canal** (`stopped=false`); el guardia del `.then` evita el `voiceJoin`, pero la instancia queda huérfana → **el micro permanece abierto indefinidamente** aunque el usuario vea la voz «cerrada» (indicador de privacidad del navegador activo).
- **Impacto**: privacidad (micro activo sin consentimiento aparente) + fuga de tracks/interval.
- **Recomendación**: dentro de `start()`, tras cada `await`, salir si `this.stopped` (deteniendo los tracks obtenidos); o token de generación (`myGeneration`) que invalide los `start()` obsoletos.

### 🟠 H3 — La malla de voz no se repara tras un flap de red que mate el P2P (rejoin «duro»)

- **Dónde**: `src/game/client/voice.ts:114-124` (`setRoster` → `ensurePeer` devuelve la RTCPeerConnection existente) y `178-206` (sin listeners `connectionstatechange`/`iceconnectionstatechange`, sin ICE restart, sin re-oferta).
- **Qué pasa**: el rejoin cubre la caída cliente↔servidor; el P2P navegador↔navegador sobrevive si solo murió el enlace de señalización. Pero si el flap de red (red móvil, suspensión) mató también las conexiones ICE, tras el rejoin el roster re-difundido contiene los MISMOS residentIds → `ensurePeer` reutiliza las PCs en estado `failed` y nadie renegocia: la voz queda muerta en silencio (el roster la muestra «en directo»).
- **Impacto**: en el escenario diana del rejoin (móvil/pestaña en segundo plano) la voz puede no recuperarse sin salir y re-entrar al canal manualmente.
- **Recomendación**: escuchar `pc.onconnectionstatechange`; si `failed`/`disconnected` persistente → `closePeer(id)` + `ensurePeer(id)` (re-oferta del menor id), o reconstruir la malla completa al recibir roster tras un rejoin.

### 🟠 H4 — Relay de voz sin límites de tamaño ni cadencia (voice:signal / voice:state)

- **Dónde**: `mini-services/vecinos-server/index.ts:631-637` (`voice:signal` reenvía `payload.data` tal cual a `to.socketId`) y `617-629` (`voice:state` re-difunde a toda la sala en cada llamada).
- **Qué pasa**: la validación es correcta en destinatario (el `to` se resuelve con `found.session.voice.get(...)` → **no se puede señalar a residentes de otras sesiones** — verificado en código y por diseño del Map por sesión) y en presencia de `data`. Pero no hay tope de tamaño de `data` ni rate-limit: un cliente modificado puede usar el servidor como amplificador (SDPs gigantes a los 3 peers, o `voice:state` a ritmo de red → flood de broadcasts a la sala).
- **Impacto**: amplificación de ancho de banda / CPU en el servidor y en los clientes de la sala. Contexto: juego LAN/amigos con `cors: '*'` — riesgo bajo hoy, pero es el único relay abierto de la app.
- **Recomendación**: capar `JSON.stringify(payload.data).length` (p. ej. ≤ 16–64 KB) y cadencia mínima por socket para `voice:state` (~100–200 ms); mantener la verificación de sesión (ya correcta).

### 🟠 H5 (ops) — El trabajo v1.56 no está commiteado ni en su rama

- **Dónde**: repo completo (`git status`: 12 modificados + 3 nuevos; rama activa `main` @ `14e18e0`; `fase-2-coop-competitivo` en el mismo commit; `git diff main...HEAD --stat` vacío).
- **Impacto**: cualquier operación del workspace (checkout, descarte, otro agente) pierde la v1.56 entera; la trazabilidad de la auditoría queda anclada a un working tree, no a un SHA.
- **Recomendación**: commitear en `fase-2-coop-competitivo` (los ficheros coinciden 1:1 con lo descrito en el plan v1.56) y etiquetar; re-ejecutar smoke tras el commit.

### 🟡 H6 — `destroySession` no limpia los timers de gracia

- **Dónde**: `mini-services/vecinos-server/index.ts:103-110` (solo limpia `timer` y `cleanup`) vs `305-310` (timers de `grace` con `setTimeout` 30 s).
- **Qué pasa**: si la sesión muere por TTL con gracia pendiente, el timer dispara igualmente `purgeParticipant` sobre una sesión huérfana (muta Maps fuera del registro, emite a una room inexistente, y puede programar otro `cleanup` inútil). Los timers están `unref()` → no cuelgan el proceso, pero es basura y mutación post-mortem.
- **Recomendación**: en `destroySession`, iterar `session.grace` y `clearTimeout` de cada entrada.

### 🟡 H7 — Co-op activa con 1 participante tras purga: misión colgada sin salida para el invitado

- **Dónde**: `index.ts:577-586` (`coop:skip` solo anfitrión), `216-225` (`releaseCoopRoles` en purga), `173-192` (`coopTick` no re-oferta con `activeIdx >= 0`).
- **Qué pasa**: si el anfitrión se va (gracia→purga) y queda un solo invitado, la misión activa sigue activa: el rol liberado no puede reclamarlo nadie (`minPlayers` ya no se cumple pero el aborto no existe), `coopTick` está bloqueado y el invitado **no puede saltarla** → co-op congelada hasta que el anfitrión haga rejoin o alguien más entre. Las misiones normales del sim siguen (no bloquea el juego), pero la tarjeta co-op queda en limbo.
- **Recomendación**: en `purgeParticipant`, si `coop.activeIdx >= 0` y `participants.size < coopCfg.minPlayers` → abortar misión (activeIdx=−1, limpiar asignaciones, toast del catálogo + `emitCoopState`).

### 🟡 H8 — `mg_fusibles` hardcodeado en la UI del marcador (regla data-driven)

- **Dónde**: `src/components/game/MultiplayerPanel.tsx:339` (`r.best['mg_fusibles']`, título «Mejor rearme de fusibles») — introducido en v1.55, pero v1.56 añade 3 minijuegos co-op cuyo récord jamás aparecerá.
- **Impacto**: viola la regla de oro (el «qué se muestra» depende de un id clavado en el componente); la ampliación del catálogo de duelos exigiría tocar UI.
- **Recomendación**: iterar `rules.multiplayer.score.minigames` (label/emoji del catálogo) y pintar todas las `best` existentes; mismo tratamiento para `boardExtraBest` de `rules.json`.

### 🟡 H9 — Smoke: 18 asserts reales (no 22) y un assert tautológico

- **Dónde**: `mini-services/vecinos-server/test-coop.ts` — el auditor cuenta **18 `assert()`** (18/18 PASS re-ejecutados); `test-coop.ts:191` es `assert(true, 'rejoin-sincro', …)`: no verifica nada.
- **Qué falta**: `voice_full` (maxPeers), `coop:skip` rechazado a no-anfitrión, retención de roles/voz tras la ventana de gracia (30 s) — hoy el rejoin del smoke es inmediato (500 ms) —, y el aislamiento cross-sesión de `voice:signal`.
- **Recomendación**: sustituir el assert tautológico por checks reales (tras rejoin: `coop:state` con `done` correcto, roster no vacío) y añadir las 4 guardias listadas; actualizar la cifra documentada.

### 🟡 H10 — Objetivos co-op sin validación de contenido + progreso honor-based

- **Dónde**: `src/game/content/index.ts:263+` (`validateContent` no mira `multiplayer`), `mini-services/vecinos-server/index.ts:556-575` (el servidor verifica asignación, no posición/resultado).
- **Qué pasa**: (a) un typo en `objective.block` (`blk_p0_portal`, `blk_p2_c` — verificados existentes hoy) o `objective.id` (`mg_fusibles`, `mg_desatascar`, `mg_trato_vecino` — existentes) haría la misión incerrable sin ningún error; (b) el `coop:progress` confía en el cliente (reach detectado en el mundo espejo del cliente; minijuego auto-declarado). Es coherente con el resto del protocolo (`complete_minigame` también es honor-based) y el servidor ya blinda «nadie marca el rol ajeno», pero conviene explicitarlo.
- **Recomendación**: en `validateContent`, comprobar que cada `reach.block` existe como instancia del escenario y cada `minigame.id` en `content.minigames` (fail-fast como el resto del catálogo). Documentar el modelo de confianza en el contrato.

### 🟡 H11 — Colaterales del minijuego co-op: alimenta el duelo y cierra el apagón local

- **Dónde**: `controller.ts:965-977` (`openCoopMinigame` arranca cronómetro) + `controller.ts:1180-1188` (`completeMinigame` manda `complete_minigame` y `minigameTime` para CUALQUIER minijuego cerrado) + `index.ts:474-480` (el servidor anota `lastMinigame` aunque no haya `pendingMinigame`).
- **Qué pasa**: completar el minijuego de un rol co-op (p. ej. `mg_fusibles`) sin petición del sim (a) autoriza una marca del duelo «Vecino del mes» (+50) por la vía co-op, y (b) dispara `endBlackout()` local aunque el apagón del sim siga vivo en el servidor → inconsistencia visual transitoria entre clientes (el mundo espejo la corrige al siguiente estado).
- **Impacto**: solapamiento de reglas (doble vía de puntuación para el mismo minijuego); sin farmeo ilimitado (un rol por misión, cooldown del catálogo).
- **Recomendación**: marcar el origen co-op en el modal y, si es co-op, saltar `minigameTime`/`endBlackout` (o aceptarlo y documentarlo como comportamiento).

### 🟡 H12 — STUN público de Google y sin TURN

- **Dónde**: `src/game/client/voice.ts:181` (`iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]`).
- **Qué pasa**: dependencia externa para ICE (privacidad: IP de los jugadores expuesta a Google; sin Internet la malla queda limitada a host candidates — mismo host/LAN); sin TURN, NAT simétrico no conectará nunca.
- **Recomendación**: para el despliegue propio, un STUN propio (o `iceServers: []` en LAN pura); documentar el límite y dejar TURN como mejora futura (co-turn/eturnal si se abre a Internet).

### 🟡 H13 — ICE candidates sin buffering

- **Dónde**: `voice.ts:141-146` (`addIceCandidate` fallido se descarta; no hay cola de candidates llegadas antes del SDP remoto).
- **Qué pasa**: hoy el orden socket-FIFO protege (oferta se emite antes que los ICE), pero tras un reemplazo de socket (rejoin) o re-ordenación, candidates tempranas se pierden y la negociación no se recupera hasta el próximo roster/reoferta.
- **Recomendación**: buffer por peer de candidates con `remoteDescription===null` y vaciarlo tras `setRemoteDescription`.

### 🔵 Notas

- **N1 — Compat v1**: cliente v1.55 ↔ servidor v1.56 OK (eventos nuevos ignorados por quien no escucha; `coop:state`/`voice:roster` no molestan). Servidor v1.55 ↔ cliente v1.56: `voiceToggle()` entra al canal sin roster ni error jamás (`voice:join` sin ack; el servidor ignora el evento) → chip «🎙️ Voz (0)» eterno. Mitigado con deploy monolítico; sería trivial añadir ack o timeout de roster.
- **N2 — Socket zombi tras rejoin**: el socket viejo se borra de `participants`/`sessionOfSocket` (`index.ts:652-655`) pero no se saca de la room de socket.io → sigue recibiendo broadcasts si respira. Impacto: ancho de banda menor. Añadir `io.sockets.sockets.get(oldSocketId)?.leave(code)`.
- **N3 — `session:rejoin` sin secreto**: código (4 chars, ~923k combinaciones) + residentId predecible (`res_player_01`, `res_guest_N`) bastan para robar el asiento (incluido el rol de anfitrión). Aceptable en LAN/amigos; si se abre a Internet, token de rejoin entregado en el ack.
- **N4 — Catálogo opcional pero fail-fast**: `multiplayer.json` es opcional en presencia (patrón emotes), pero si existe y es inválido, `loadContent` **lanza** (`content/index.ts:211-220`) → el servidor hace `process.exit(1)` y el cliente no carga contenido. Correcto para integridad (coherente con el resto), aunque «opcional» solo lo es si el fichero no está.
- **N5 — Textos co-op/voz solo en español**: `multiplayer.json` no tiene espejo en `translations.en.json`; jugadores EN verán toasts en ES (patrón preexistente en rules.json; los textos estructurales de panel/HUD sí son bilingües vía i18n.ts).
- **N6 — «Hablando» en headless**: el resume() de AudioContext sin gesto de usuario limita el indicador en QA headless; con gesto real funciona (E2E del equipo). La ruta servidor (voice:state) está verificada en smoke.

### Verificaciones positivas destacadas (lo que está BIEN)

- **Sim congelada**: `git diff HEAD -- src/game/sim/` y `git diff main...fase-2-coop-competitivo -- src/game/sim/` → **vacíos**. ✅
- **Blindaje del bucle de tick**: try/catch con log de stack (`index.ts:79-88`) — el mundo ya no se congela en silencio.
- **Gracia de reconexión**: diseño correcto — `leaveSession(fromDisconnect)` difiere la purga 30 s (`unref`), cancela `present=false`, conserva roles/voz/marcador; el rejoin cancela el purge, restaura `present=true`, re-difunde todo y actualiza el `socketId` de voz (`index.ts:286-340`, `641-692`). Salida explícita purga al instante. Doble disconnect de sockets zombi guardado por `grace.has(...)` (ídem: el socket viejo ya no está en `sessionOfSocket` tras rejoin → `leaveSession` early-return).
- **Guardias del servidor**: rol ocupado, un rol por residente, solo el asignado marca su rol y una sola vez, skip solo anfitrión, `voice_full` (maxPeers 4), misión/roleId validados contra la misión ACTIVA, `voice:signal` aislado por sesión. Concurrencia: handlers de socket.io en el event-loop de Bun → sin carrera real en `coop:claim` (check-then-set atómico a efectos prácticos).
- **Reach sin dobles progresos**: cliente envía 1 progreso por tick (`return` tras el primer match, `controller.ts:995-1005`) y el servidor deduplica con `a.done` (`index.ts:566`).
- **Limpieza cliente**: `leaveSession()` llama `stopVoice()` y resetea `mpCoop`/`mpVoice`/`mpScore`; `resetUi()` del store también; `VoiceChannel.stop()` es idempotente y cierra peers + audio elements + tracks + AudioContext (verificado en vivo: 0 `<audio>` tras salir).
- **Anti-glare determinista** por residentId menor con guardia `signalingState === 'have-local-offer'` para la answer; síntoma de fallback sintético visible en UI («modo escucha») y en QA (`synthetic:true`).
- **Ops respetadas**: puerto fijo 3010 sin `process.env.PORT` y `path: '/'` intactos; Caddy `:81` con `XTransformPort` verificado en vivo; `pingInterval`/`pingTimeout` en defaults (revertido, coherente con la gracia); zod con defaults (`minPlayers≥2`, `maxPeers 2..8`, `cooldownSecs≥0`) y carga opcional con el patrón emotes.

---

## 3. Implicaciones por módulo

| Módulo | Estado | Riesgos principales | Recomendaciones |
|---|---|---|---|
| **Contenido** (`public/content/multiplayer.json`, schemas, loader) | 🟢 Sólido | Zod valida forma pero no referencias (`reach.block`, `minigame.id`) — un typo incerrable sin ruido (H10); textos ES-only (N5); opcional pero fail-fast (N4) | Validación cruzada en `validateContent`; espejo EN futuro; documentar el fail-fast |
| **Servidor** (`index.ts`, `session.ts`) | 🟢 Sólido con matiz | Timers de gracia huérfanos al destruir sesión (H6); co-op colgada con 1 participante (H7); relay sin límites (H4); rejoin sin secreto (N3); zombie en room (N2) | clearTimeout de gracia; aborto de co-op bajo `minPlayers`; caps de tamaño/cadencia; leave(code) del socket viejo |
| **Transporte** (`net.ts`) | 🟢 Correcto | `reconnectionAttempts: Infinity` justificado por rejoin, pero sin teardown en fallo de rejoin (raíz de H1); `voice:join` sin ack impide detectar servidor viejo (N1) | Encapsular la limpieza post-rejoin-fallo en NetSession o controller; ack opcional de voz |
| **Cliente juego** (`voice.ts`, `controller.ts`) | 🟡 Mejorable | Carrera de doble toggle con fuga de micro (H2); malla sin autorreparación (H3); colaterales del minijuego co-op (H11); sin buffering ICE (H13) | Guardia `stopped` tras awaits; listener `connectionstatechange` con rebuild; flag de origen co-op; buffer ICE |
| **UI** (`MultiplayerPanel`, `HudBar`, store, i18n) | 🟢 Correcto | `mg_fusibles` hardcodeado (H8); claim rechazado en silencio (sin feedback hasta el próximo broadcast); aria correcto en chips/botones/iconos | Catálogo-driven para `best`; micro-copy de «rol ocupado» cuando llegue el estado |
| **QA** (`test-coop.ts`, hooks) | 🟡 Mejorable | 18 asserts reales (documentados 22), uno tautológico; faltan guardias de maxPeers/skip/gracia completa/cross-sesión (H9); «hablando» limitado en headless (N6) | Endurecer smoke; añadir assert de retención de roles tras gracia real (30 s) |

---

## 4. Checklist de las 4 reglas del proyecto

| # | Regla | Veredicto | Evidencia |
|---|---|---|---|
| 1 | **100% data-driven** (todo en `public/content/*.json`) | 🟡 PASS con salvedad | Criterio co-op/voz 100% en `multiplayer.json` (3 misiones, roles, `pointsBonus:150`, `cooldownSecs:10`, `minPlayers:2`, toasts; voz `enabled/maxPeers:4`); servidor solo orquesta (`session.ts` «cero datos de gameplay»); zod `multiplayerCatalogSchema` con defaults. **Salvedad**: `r.best['mg_fusibles']` clavado en UI (H8, heredado de v1.55) y textos del JSON sin espejo EN (N5). |
| 2 | **Sim congelada** (`src/game/sim/*` intacto) | ✅ PASS | `git diff HEAD -- src/game/sim/` vacío y `git diff main...fase-2-coop-competitivo -- src/game/sim/` vacío. La orquestación vive en `mini-services/vecinos-server/` + `controller.ts` (el sim recibe solo comandos/efectos por las puertas existentes). |
| 3 | **Anti z-fighting** (superficies no coplanares) | ➖ N/A | v1.56 no toca geometría/Babylon (diff sin ficheros de escena). Nada que auditar. |
| 4 | **Todo «completado» verificado en navegador real** | ✅ PASS (con hueco menor) | E2E 2 sesiones del equipo (co-op completo, voz `connected` bidireccional, catálogo cicla) + verificación del auditor en vivo vía Caddy `:81`: chip v1.56, host de sesión, tarjeta co-op correcta en solitario, voz ON (synthetic) / OFF con limpieza de `<audio>`. Hueco: el indicador «hablando» en headless depende del gesto (N6); voz **tras** un rejoin real no cubierta por E2E (ver H3). |

---

## 5. Anexo — Cómo reproducir

### Smoke de protocolo (servidor vivo en 3010)
```bash
cd mini-services/vecinos-server
bun test-coop.ts          # ✔ TODO OK — 18/18 asserts (v1.56)
bun test-client.ts        # contrato sesión v1 (regresión)
```
Arranque del servidor: `bun mini-services/vecinos-server/index.ts` (o `bun run dev` → `bun --hot`; documentado que `--hot` degrada con sesiones largas — reiniciar tras cambios de código). Puerto fijo 3010, path `/`: **no cambiar**.

### E2E navegador (2 sesiones vía gateway Caddy)
1. Abrir dos pestañas en `http://localhost:81/?qaengine=1` (Caddy reenvía `:3000` la app y `?XTransformPort=3010` el socket).
2. Saltar cutscene/tutorial; en «Jugadores» → «Crear partida compartida»; copiar código o el enlace `?join=CODE`.
3. Pestaña 2: abrir el enlace → «Unirse a la partida». Esperar ≤10 s (cooldown) al toast «🤝 MISIÓN COOPERATIVA disponible».
4. Reclamar un rol cada uno; el rol `reach` se completa apareciendo en el portal (`blk_p0_portal`); el rol `minigame` → «Realizar minijuego» → completar.
5. Verificar: toast «…resolvieron «Apagón en la comunidad»… +150 pts ×2», marcador 200 pts, catálogo cicla a «Operación goteo».
6. Voz: «Entrar al canal de voz» en ambas; en consola: `__vecinosQa.getVoicePeers()` → `{res_…: 'connected'}` en ambos lados; `__vecinosQa.getVoiceState()`.
7. Rejoin: matar el transporte (devtools → offline → online, o pestaña en segundo plano ~45 s con pingTimeout por defecto) → al volver, el panel se re-sincroniza solo (mundo/marcador/co-op/voz); la gracia de 30 s cubre la caída.

### Comandos agent-browser clave usados en la auditoría
```bash
agent-browser open "http://localhost:81/?qaengine=1"
agent-browser eval "window.__vecinosQa.getController().hostSession()"
agent-browser eval "JSON.stringify(window.__vecinosQa.getVoiceState())"   # {active:true, synthetic:true} en headless
agent-browser eval "window.__vecinosQa.getController().voiceToggle()"     # ON → roster 'en directo'; OFF → 0 <audio>
```

### Sondas rápidas de robustez (curl/socket.io)
```bash
# aislamiento del relay: voice:signal {to: idDeOtraSesión} → sin efecto (Map por sesión)
# guardias: coop:claim rol ocupado / doble rol / skip de invitado → ignorados sin crash
# solitario: nunca coop:state activo (minPlayers=2) — verificado en smoke 'solo-no-coop'
```

---

*Fin del informe. El auditor no modificó ningún fichero de código; este documento es el único artefacto generado.*
