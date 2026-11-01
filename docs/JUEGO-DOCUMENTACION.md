# VECINOS — Documentación maestra del juego

> **Versión documentada:** v1.56 (rama `fase-2-coop-competitivo`) · **Plataforma:** navegador (Next.js 16 + TypeScript + Babylon.js 8)
> **Naturaleza del proyecto:** simulador de vecindario 2.5D, cooperativo y competitivo, con simulación **determinista** y contenido **100 % data-driven**.
>
> Este documento es LA referencia del juego. Todo lo que aquí se afirma sale de los archivos reales del repositorio (`public/content/`, `src/game/`, `mini-services/vecinos-server/`, historial git). Si un dato no está aquí, está en el catálogo; si discrepa con el código, manda el código y se actualiza este documento.

---

## Índice

1. [¿Qué es VECINOS?](#1-qué-es-vecinos)
2. [Características completas — mapa de hitos](#2-características-completas--mapa-de-hitos)
3. [Objetivos y misiones](#3-objetivos-y-misiones)
4. [Sistema de recompensas](#4-sistema-de-recompensas)
5. [Modo cooperativo (co-op real)](#5-modo-cooperativo-co-op-real)
6. [Modo competitivo](#6-modo-competitivo)
7. [Canal de voz](#7-canal-de-voz)
8. [Arquitectura técnica](#8-arquitectura-técnica)
9. [Personalización — guía práctica de modificación de datos](#9-personalización--guía-práctica-de-modificación-de-datos)
10. [Especificación de arte para artistas](#10-especificación-de-arte-para-artistas)
11. [Operación](#11-operación)

---

## 1. ¿Qué es VECINOS?

### 1.1 El pitch

Te acabas de mudar a un bloque de vecino español con **el ascensor roto, una presidenta/presidente que lleva la comunidad como si fuera un reino y vecinos con más carácter que un testimonio en la junta**. Tu misión no es salvar el mundo: es **mejorar el edificio, sobrevivir a las juntas y convertirte en «Vecino del mes»** — primero en solitario, y desde v1.56 también acompañado (cooperación) o enfrentado (duelos de minijuegos) con otros vecinos reales.

El tono es el del proyecto: **humor español de rellano**, con frases sacadas directamente del catálogo:

| Quién | Frase real del catálogo |
|---|---|
| El recién llegado (jugador) | *«Viniste por el precio. Te quedas por el drama.»* |
| Dolores, la Cotilla | *«Lo sabe todo. Y lo cuenta.»* |
| Nando, el Okupa | *«Técnicamente, esa vivienda ya está habitada. Por él.»* |
| Sr. Vulture, del Fondo Buitre | *«Compra, reforma, revende. Sonríe.»* |
| Tablón de anuncios | *«SE BUSCA: vecino del karaoke nocturno. Recompensa: silencio.»* |
| Cartel del pasillo | *«La lavandería NO es un lavadero de fortunas: una colada por vecino.»* |
| Pintada real del mural | *«AQUÍ PINTÓ PINTURILLAS» · «LA JUNTA MANDA (a veces)»* |

### 1.2 Géneros y formato

| Aspecto | Valor |
|---|---|
| Género | Simulador de vecindario 2.5D con misiones narrativas, minijuegos y simulación social |
| Modos | Un jugador (campamento completo), **cooperativo real** (misiones co-op con roles), **competitivo** (duelos de minijuegos contrarreloj), marcador comunitario «Vecino del mes» |
| Plataforma | Navegador de escritorio y móvil (PWA instalable con `manifest.webmanifest` + service worker) |
| Render | 2.5D en 3D real: Babylon.js 8 (WebGPU con fallback automático a WebGL2, `src/game/client/engine.ts`) |
| Simulación | Determinista: **1 tick = 1 minuto de juego**, RNG con semilla (mulberry32, `src/game/sim/rng.ts`), reloj de 1440 min/día |
| Contenido | 100 % data-driven: **ningún dato de gameplay vive en el código**, todo en `public/content/*.json` validado con Zod al arrancar |

### 1.3 Cómo se juega

**Controles (datos reales de `src/game/client/controller.ts` y `rules.json`):**

| Entrada | Acción |
|---|---|
| `WASD` / flechas (o mando táctil en móvil, `TouchControls.tsx`) | Moverse por pasillos, plantas y estancias |
| `E` (o Espacio/Enter en contextos) | Interactuar: timbre (`E · timbre de {name}`), entrar (`E · entrar en {block}`), portátil (`E · conectarse al portátil`), siesta (`E · echar una siesta`), buzones, tablón, cuadro de fusibles… |
| `0` | Cámara **Fachada** (`Digit0: 'fachada'`) |
| `1` | Cámara **Edificio** (la vista 3/4 principal) |
| `2` | Cámara **Planta** (corte del pasillo de la planta actual) |
| `3` | Cámara **Estancia** (interior del piso) |
| `Shift` | Correr (`runMultiplier: 1.75`, `runSpeed: 3.9`) |
| Mando (gamepad) y táctil | Totalmente soportados (`src/game/client/gamepad.ts`, `TouchControls.tsx`) |

**El bucle de juego:**

1. **El teléfono suena** (`phone_call`): la inmobiliaria, la administradora Juana, la Cotilla, el Fondo Buitre…
2. **Aceptas la misión** y sigues sus pasos: llegar a una puerta (`reach`), entrar en un bloque (`enter`), pillar a alguien in fraganti (`catch_in_act`).
3. **Eliges** entre opciones con consecuencias reales (`choices`): pagar la derrama, convocar junta, el cubo del salón («Humedad −20. Dignidad −100») o desatascar tú mismo con un minijuego.
4. **Los minijuegos** resuelven el clímax: `timing_bar` (parar el cursor en la zona verde: *«Pulsa ¡AHORA! cuando el cursor pise la zona verde»*), `tap_sequence` (memorizar palancas del cuadro de fusibles), `reflex_targets` (*«Toca las cucarachas antes de que escapen. Las telas NO se tocan»*), `memory_pairs` (buzones revueltos).
5. **El edificio reacciona**: parámetros (`humidity`, `plague`, `condition`, `lighting`, `cleanliness`…) cambian, el clima avanza, la junta vota, los vecinos comentan, y tu reputación/relaciones/marcador se mueven.

**Las 4 cámaras** (`CamMode = 'edificio' | 'fachada' | 'planta' | 'estancia'`) conviven con una regla de vida de calle data-driven: `rules.view.streetLife.cameras` define en cuáles se ve el trajín exterior (en v1.49: `["edificio","fachada","planta","estancia"]`, es decir, en todas).

---

## 2. Características completas — mapa de hitos

Historia extraída del `git log` (110 commits; se listan los hitos versionados). Cada versión es un salto jugable verificado con suites QA (`scripts/qa-v*.ts`) y capturas en `docs/shots/`.

### 2.1 Línea temporal v1.0 → v1.56

| Versión | Hito (resumen del commit real) |
|---|---|
| **v1.0** | Fase E completa: elenco y edificio con arte glTF; fix de convención de ejes (frente = +Z) |
| **v1.1** | Pulido «Steam»: i18n ES/EN, PWA instalable, opciones; cadena del Festival del Portal, canal *chisme*, arquetipos pintora/repartidor |
| **v1.2** | Credibilidad 2.5D: rotación de actores por dirección, estados sociales (run/talk/laugh/argue/phone/sit), correr con Shift, gestos |
| **v1.3** | Giro REAL de actores (fix `rotationQuaternion`), anti-patinaje (`animSync`), ascensor averiado fuera de rutas visuales |
| **v1.4** | Escalera real de dos tramos + descansillo + barandillas; contrato `rules.view.stairs` compartido autoría-runtime |
| **v1.5** | Ascensor creíble: FSM de llamadas/puertas/capacidad/semáforo, cabina dinámica sobre pozo hueco, **malestar vecinal por escaleras** (`grumbleText`: *«🛗 {name} sube por la escalera porque el ascensor sigue averiado. Por el portal ya se oye lo que opina.»*) |
| **v1.6–v1.8** | Placas numeradas en cada puerta, escalera fiel al contrato, service worker corregido (network-first), cache de assets con handshake de versión |
| **v1.9–v1.10** | Cutscenes siempre en cuadro (travelling + fallback + semilla), panel de destino del ascensor, bocadillos de expresión data-driven (`emotes.json`) |
| **v1.11–v1.12** | Cadena de reparación del ascensor verificable; física trapezoidal del ascensor (aceleración `accelFloorsPerSecond2: 1.2`); **visitas entre vecinos con cadenas de consecuencias** (meriendas, serenatas, resacas comunitarias) |
| **v1.14–v1.16** | Rutas imposibles blindadas (ley del pasillo), edificio vivo (vendedores, trastadas, mascota, apagón nocturno), canal polvo con decal, obra con cutscenes; cierre del edificio: trasteros numerados por planta, bajocubierta, tejado a dos aguas, ascensor al ático |
| **v1.17** | **Logros tipo Steam data-driven** (`achievements.json`) + cuaderno del portero + privacidad de viviendas |
| **v1.19–v1.22** | Tercer eje del edificio (apilamiento 3D, pasillos de doble carril), **la calle vive**: tráfico con bus/patrulla, viandantes que entran al portal, manifestaciones con carteles legibles, fusiones de mallas (1021 → 91 draw calls) |
| **v1.23–v1.25** | UI de post-its, **interiores como dioramas de billboards con paralaje**, barrio ilustrado (nubes, árboles recortados), plan abierto, puertas reales |
| **v1.26–v1.28** | «Se ve dentro y se anda derecho»: hideNodes recursivos, juntas anti-coplanar, ventanal del cubo de escalera, orientación definitiva, GlowLayer de bloom, lluvia con cielo cerrado |
| **v1.31–v1.33** | Tráfico con oficio (ruedas con radios, matrículas, faros), **sombras de verdad** (ShadowGenerator PCF data-driven), **vida social** (charla → discusión → pelea → herido), **teatro de la ambulancia** (llegada con sirena, celadores, traslado) |
| **v1.34–v1.36** | Entrar por donde sea (garaje con basculante, lavandería con bombos girando), portal con vestíbulo (buzones/tablón/banco), cristales en su sitio |
| **v1.38–v1.42** | **Director de rendimiento adaptativo** (30/45/60 FPS), **tutorial del primer día** (`onboarding.json`), **música procedural** (`music.json`), linterna nocturna, caza de «context lost», asa de QA `?qaengine=1` |
| **v1.46–v1.48** | Hoja de sprites del personaje con LOD rig↔hoja, **herramienta de referencia de arte `?artref=1`**, `fixedWall` (bloques siempre del color del catálogo) y **cuadro de fusibles** (`mg_fusibles`, rearme + apagón real) |
| **v1.49–v1.53** | Vida de calle en cámara Estancia, halls de entrada con 6 diseños emparejados, fachada en la acera, paredes grises fijas, **tormenta**, portal sin atascos (escape anti-trampa) y **12 variantes de vivienda** (apilamiento 3D multi-sala) |
| **v1.54** | **Invitaciones por enlace de internet**: el anfitrión copia `?join=CODE` y el invitado aterriza con el panel abierto y la tarjeta «Te han invitado» |
| **v1.55** | **«VECINO DEL MES»**: marcador de comunidad sobre la sesión v1 — servidor puntúa (misión completada del anfitrión + duelo de minijuegos por tiempos con solo-mejora-de-récord y rate limit 3 s), chip HUD 🏅, corona en el panel y clasificación en el tablón |
| **v1.56** | **Co-op real + voz**: misiones cooperativas con roles verificables (`coop:*`), canal de voz WebRTC P2P (`voice:*`), **reconexión transparente** (`session:rejoin` con gracia de 30 s) |

### 2.2 Características jugables actuales (checklist)

- **Mudanza con cutscene** (`cut_mudanza`: thud + travelling + vecino subiendo con caja).
- **Ascensor** con FSM, avería, panel de plantas, indicador, y escalera alternativa con coste de ánimo (`stairsMoodCost: 0.05`).
- **Apagón nocturno** real: el evento `ev_apagon_nocturno` del ecosistema apaga las luces, salen los `blackoutJokes` (*«¿Otra vez la luz? Esta comunidad paga la electricidad con monedas de chocolate.»*), se enciende la **linterna** y se arregla **jugando el cuadro de fusibles**.
- **Clima** con ciclo ponderado (sunny 0.4 / cloudy 0.25 / rain 0.22 / storm 0.13), lluvia de 900 gotas (1700 en tormenta), relámpagos cada 5–14 s con trueno diferido, cielo con 9 keyframes de color por hora y atenuación por clima (`weatherDim`).
- **Juntas de vecinos** con orden del día, costes de caja, votos IA ponderados por afinidad y generosidad (`rules.sim.junta`) y acta con humor (*«5 sí, 2 no y una papeleta con un dibujo de un gato»*).
- **Presidencia rotatoria y campañas**: `m_presidencia_voto` → 7 días de mandato (`termDays: 7`) con `presetAgenda` (pintar el portal, engordar la contingencia, campaña de macetas) → `m_veredicto` con finales distintos.
- **Logros tipo Steam** (12 en `achievements.json`), con ocultos (*«Leyenda del portal»: reputación 90 — hasta el Fondo Buitre pide autógrafos en el rellano*).
- **Cutscenes** data-driven (16 definiciones: mudanza, pillar a Pinturillas, inauguración del bar, garaje, wifi, festival, visitas, fin de obra, presidencia…).
- **Música procedural** por franja horaria (mañana 92 BPM / tarde 78 / noche 54, escalas y acordes del catálogo, lluvia filtrada a 720 Hz).
- **Ecosistema vivo**: 7 eventos (`ev_vendedor_semillas`, `ev_vendedor_bombillas`, `ev_trastada_nino`, `ev_mascota_escapada`, `ev_apagon_nocturno`, `ev_deterioro_nocturno`, `ev_vecinos_organizados`), deterioro visual (humedades, hollín, grietas, mugre), luces por presencia, mascota (perro con cola que menea).
- **Editor de interiores** («Mi piso»): 19 muebles, ranuras por estancia, reformas de habitaciones (250 €), reembolso al 50 %, mensajes de error con humor (*«Ese piso no es tuyo. Decorar lo ajeno se llama 'okupar'»*).
- **Multijugador completo** (secciones 5–7): sesión por código de 4 caracteres, invitación por enlace, «Vecino del mes», duelo de fusibles, co-op con roles, voz WebRTC y rejoin.
- **PWA + móvil**: mandos táctiles, `manifest.webmanifest`, textos con escala (87.5 %–125 %), pistas de interacción adaptadas.

---

## 3. Objetivos y misiones

### 3.1 El motor de misiones (`src/game/sim/missions.ts`)

El catálogo vive en `public/content/missions.json` (**49 misiones reales**). El motor es un autómata de pasos con estas piezas:

**Tipos de paso (`steps[].type`):**

| Tipo | Qué exige | Señal que lo completa |
|---|---|---|
| `phone_call` | Atender el teléfono asociado a `dialog` (`dialogs.json`, 35 diálogos) | `call_answered` (colgar en el modal) |
| `reach` | Acercarse a la puerta de un bloque (`target.block` + `slot: "door"`) | `door_approached` |
| `enter` | Entrar dentro de un bloque | `block_entered` |
| `catch_in_act` | Pillar a un residente (rol) en un lugar dentro de una ventana de minutos (`windowMinutes`) | `block_entered` donde esté; si expira → misión `failed` |

**Triggers (`trigger`)** — activan misiones sin que nadie las pida. Condiciones combinables con `all`/`any`:

| Condición | Ejemplo real |
|---|---|
| `mission` + `state` | `{ "mission": "m_presidencia_voto", "state": "done" }` |
| `time` (`after`, opcional `before`; cruza medianoche si `before < after`) | `{ "time": { "after": "21:30" } }` (la fiesta de Kevin) |
| `param` (`gte`/`lte`/`eq`) sobre `bloque.param` | `{ "param": "blk_p3_c.humidity", "gte": 20 }` (el goteo) |
| `dayMin` | `{ "dayMin": 2 }` |
| `role` + `exists` | `{ "role": "kid", "exists": true }` |

**Roles de misión (`roles`)** — enlazan residentes por arquetipo y por parentesco:

```json
"roles": {
  "kid":    { "archetype": "nino_grafitero" },
  "parent": { "relation": "parentOf", "of": "kid" }
}
```

**Choices con efectos** — cuando los pasos terminan, el estado pasa a `awaiting_choice` y el servidor emite `choice_required`. Cada elección aplica `effects` (lista de ops, ver §3.3 y §9.d) y cierra la misión (`completeMission` ejecuta también `onComplete`).

**Detalles de motor que importan:**

- `rules.sim.missionLoopMax: 4` — bucle de activación en cascada limitado por tick (una misión puede disparar otra el mismo minuto, hasta 4 veces).
- Las señales del jugador entran por `notify()`; en multijugador **el servidor sobrescribe `cmd.actor`**, así que solo avanza la misión quien la juega de verdad.
- `catch_in_act` recoloca al objetivo (p. ej. Pinturillas aparece en la cabina de su planta) y falla con `timeout` si se pasa la ventana.
- Tokens estructurales en textos: `{blk:blk_p1_a}`, `{home}`, `{plantas}`, `{viviendas}` se expanden una vez contra el mundo real (`applyStaticTokens`).

### 3.2 Misiones reales del catálogo (ejemplos comentados)

**`m_bienvenida` — el tutorial (3 pasos, teléfono → puerta → entrar):**

```json
{
  "id": "m_bienvenida",
  "title": "Bienvenido al edificio",
  "description": "La inmobiliaria te espera al teléfono. Después: tu puerta. Tu nuevo reino (de 65 m²).",
  "steps": [
    { "id": "llamada", "type": "phone_call", "dialog": "dlg_bienvenida", "hint": "Atiende el teléfono" },
    { "id": "subir",  "type": "reach", "target": { "block": "$home", "slot": "door" }, "hint": "Llega a la puerta de tu piso (3C)" },
    { "id": "entrar", "type": "enter", "target": "$home", "hint": "Entra en tu piso (E)" }
  ],
  "onComplete": [
    { "op": "addFunds", "to": "player", "amount": 200 },
    { "op": "unlock", "target": "blk_p1_b", "occupancy": "occupied", "resident": "res_cotilla_01", "arrival": "mudanza" },
    { "op": "unlock", "target": "blk_p1_b", "resident": "res_nino_01", "arrival": "mudanza" },
    { "op": "toast", "text": "Mudanza en 1B: Dolores la Cotilla y su hijo Pinturillas. El edificio ya no es lo que era. Era mejor.", "tone": "info" }
  ]
}
```

**`m_goteo` — trigger por parámetro y 4 decisiones (incluido minijuego):** se dispara cuando la humedad del 3C llega a 20; puedes pagar 250 €, pedir derrama en junta (400 € de caja, con su propio debate: *«qué es urgente»*), aguantar con el cubo del salón (*«Humedad −20. Dignidad −100»*) o **jugar `mg_desatascar`** tú mismo. Todas las ramas sueltan los 150 € de recompensa.

**`m_okupa` — decisiones con consecuencias de mundo:** acoger a Nando (+afinidad, +reputación del okupa), negociar con minijuego (`mg_trato_vecino`) o **llevarlo a junta**, donde hay DOS puntos votables: `regularizacion_okupa` (contrato retroactivo, «nada de taladros en domingo», 50 € de gestoría) o `desalojo_okupa` (el piso vuelve a cartel con `availability: { mode: "for_sale", price: 46500 }` y Nando a la calle).

**`m_presidencia_voto` → `m_derrama_tuberia` → `m_veredicto` — el arco de campaña:** votación anómala (*«Tú pretendías solo vivir tranquilo»*), 7 días presidiendo (derramas, agenda preset) y veredicto final con `op: "finale"` (dos textos de cierre reales, incluido el que culpa al anterior presidente y se gana su rencor: `affinity: -20`).

**Cadena de consecuencias entre vecinos** (misiones `m_visita_*`): Esperanza merienda en tu casa → acta de humedad; la visita de fiesta termina en `m_resaca_comunitaria`; la lavadora de la visita termina en `m_chisme_lavadora`. Las visitas son eventos del sim (`world.visit`) con llegada en cutscene.

### 3.3 Operaciones (`ops`) disponibles para efectos

Lista completa implementada en `src/game/sim/effects.ts` — **todo lo que un JSON puede pedirle al mundo**:

| Op | Qué hace |
|---|---|
| `setParam` | Cambia un parámetro de bloque(s) por id, defId o `alignGroup`, con `value` o `delta` y clamp según catálogo |
| `unlock` | Desbloquea/ocupa vivienda; con `availability` la pone en venta (`for_sale` + precio); con `resident` hace llegar a un vecino (mudanza) |
| `buy` | Compra un bloque en cartel (valida cartera; *«Te faltan X €. Trabajo hay en el portátil.»*) |
| `addFunds` | Dinero a `player` (o al actor en MP) o a la caja `community` |
| `addReputation` | Reputación de un residente (resuelto por `player`, rol, id o arquetipo), clamp 0–100 |
| `addRelation` | Afinidad/confianza entre dos residentes |
| `startMission` | Encola una misión con `delayMinutes` |
| `grantFavor` | Favores (moneda social) desde un vecino |
| `revealParams` / `hideParams` | Progresión de visibilidad de parámetros (tiers) |
| `openJunta` | Convoca junta con agenda (consumido por presentación) |
| `startMinigame` | Abre un minijuego del catálogo |
| `toast` | Aviso al HUD (`tone: good|bad|info`) |
| `finale` | Cartel de final de arco |

### 3.4 Misiones cooperativas (co-op, v1.56)

Viven en `public/content/multiplayer.json` (no en `missions.json`): son **otro formato** — roles con objetivos verificables y bonus de marcador. Las tres reales:

| Misión | Rol 1 | Rol 2 | Bonus |
|---|---|---|---|
| `coop_apagon` «Apagón en la comunidad» | `electricista`: completa el minijuego `mg_fusibles` | `mediador`: llega (`reach`) a `blk_p0_portal` | +150 pts c/u |
| `coop_goteo` «Operación goteo» | `fontanero`: completa `mg_desatascar` | `paraguas`: llega a la puerta del 2C (`blk_p2_c`) | +150 pts c/u |
| `coop_negociacion` «Mesa de negociación» | `negociador`: completa `mg_trato_vecino` | `notario`: plantado en el portal | +150 pts c/u |

El brief ya explica el diseño (*«Dos manos hacen la faena: una en el cuadro, otra calmando a la gente»*) y el cierre usa tokens: `«🤝 {a} y {b} resolvieron «{title}» en equipo: +{points} pts para cada uno.»`. Flujo completo en la **§5**.

---

## 4. Sistema de recompensas

### 4.1 Moneda interna y economía

| Recompensa | Dónde se toca | Ejemplos reales |
|---|---|---|
| **Dinero (cartera)** | `op: addFunds` (player), `work` (+120 € con cooldown 120 ticks: *«reunión que podía ser un correo»*), alquiler diario (`rent`, 40 €/día), reembolso de muebles (50 %) | +200 € de bienvenida, −250 € del fontanero, +150 € por misión |
| **Caja de la comunidad** | `op: addFunds { to: "community" }` | Derrama votada (−400 € de caja), aportación de contingencia (+440 €) |
| **Reputación** | `op: addReputation` (clamp 0–100) | +8 por pagar la derrama de tu bolsillo; −6 por mirar al techo con dignidad |
| **Relaciones (afinidad/confianza)** | `op: addRelation` | +20 con Esperanza por arreglar el goteo; −25 con Kevin si llamas a la policía |
| **Favores** | `op: grantFavor` | 3 favores de Pinturillas por guardar el secreto |
| **Logros** | `achievements.json`, evaluados en el cliente (perfil de navegador) | `a_acta_firmada` (primera misión), `a_hucha` (1.500 €), `a_semana` (7 días) |
| **Proyecto «Mejorar el edificio»** | `project.json`: 3 niveles (Acogedor → Querido → Orgullo del barrio) con metas de misiones/fondos/reputación y recompensa narrativa | Nivel 3: *«La comunidad te nombra vecino del año»* |

### 4.2 El marcador «Vecino del mes» (v1.55)

Definición **completa y única** en `rules.multiplayer.score` (data-driven; el servidor solo la lee):

```json
"score": {
  "title": "Vecino del mes",
  "missionCompletedPoints": 100,
  "missionBonus": {},
  "minigames": {
    "mg_fusibles": { "label": "rearme de fusibles", "pointsPerRecord": 50, "maxSecs": 600 }
  },
  "recordToast": "⏱️ {name} rearmó el cuadro en {secs} s — ¡mejor marca de la comunidad! (+{points} pts)",
  "firstToast": "⏱️ {name} rearmó el cuadro en {secs} s (+{points} pts)",
  "boardTemplate": "🏅 VECINO DEL MES\n{lines}\nResuelve misiones y gana duelos de minijuegos para sumar puntos.",
  "boardLine": "{pos}. {name} · {points} pts{extra}",
  "boardExtraBest": " · fusibles {secs} s"
}
```

**Cómo se puntúa (lógica verificada en `mini-services/vecinos-server/index.ts`):**

1. **Misión completada: +100** (`missionCompletedPoints`) **+ bonus opcional por misión** (`missionBonus["m_xxx"]`, vacío por defecto). Puntúa el **anfitrión** (`world.playerId`), porque es quien conduce el sim del mundo compartido.
2. **Duelo de minijuegos: +50** (`pointsPerRecord`) por **récord de minijuego** — y solo si **MEJORA tu récord personal** (repetir no puntúa: *no se farmea*). Condiciones server-side:
   - El tiempo llega por `session:minigame_time {id, secs}` (cronómetro del cliente, §6).
   - Debe existir un **éxito reciente del mismo minijuego del mismo vecino** registrado hace ≤ **30 s** (`lastMinigame`).
   - Tiempo válido: `secs > 0.5` y `secs ≤ maxSecs` (600 s) — *«marcas imposibles fuera»*.
   - **Rate limit de 3 s** por participante entre marcas.
3. **Co-op cerrada: +150** (`pointsBonus` de la misión) **para cada rol asignado** (§5).
4. **«Top»**: la fila con más puntos luce la corona; empate → orden alfabético; sin puntos, nadie luce corona (*«el vecindario empieza limpio de cuentas»*).

**Dónde se ve:** chip HUD 🏅 en vivo (`session:score` broadcast), marcador con corona y mejor marca de fusibles en el panel Multijugador, y clasificación pegada en el **tablón de anuncios** del portal con las plantillas `boardTemplate`/`boardLine`. Las filas de quien puntuó y se fue **se congelan con su nombre** — nadie borra tu leyenda por irse a cenar.

---

## 5. Modo cooperativo (co-op real)

### 5.1 Filosofía: NO BLOQUEANTE en solitario

Regla de oro de v1.56 (comentario literal del servidor): *«En solitario (1 participante) el co-op no se ofrece y NADA se bloquea: las misiones normales del sim siguen igual que siempre»*. Todo se rige por `multiplayer.coop`:

```json
"coop": {
  "enabled": true,
  "minPlayers": 2,
  "cooldownSecs": 10,
  "offerToast": "🤝 MISIÓN COOPERATIVA disponible: «{title}». Reclama tu rol en el panel Multijugador."
}
```

El zod lo refuerza: `minPlayers ≥ 2`, `roles` mínimo **2 por misión** (*«sin reparto no hay cooperación»*), `pointsBonus` entero positivo.

### 5.2 Flujo completo (oferta → reclamar → objetivos → cierre)

1. **OFERTA** — En cada tick de sesión, `coopTick()` (servidor) ofrece la siguiente misión **sin completar** del catálogo si: no hay ninguna activa, `participantes ≥ minPlayers` y ha pasado el `cooldownSecs` (10 s) desde la última oferta/completado. El toast de oferta viaja como `ui_toast` del mundo (lo ven todos) y el estado completo viaja por `coop:state { active: { mission, roles[] }, done[] }`. Si se agota el catálogo, **arranca una ronda nueva** (`done = []`; *«el vecino del mes manda»*).
2. **RECLAMAR ROL** — `coop:claim {missionId, roleId}`. Guardias del servidor: la misión debe ser la activa, el rol debe existir y estar libre, y **un vecino = un rol por misión** (*«el reparto ES la cooperación»*). Cada `coop:state` refleja quién lleva cada rol (`residentId`, `name`, `done`).
3. **OBJETIVOS** — cada rol define un objetivo verificable (`mpCoopObjectiveSchema`, solo dos tipos):
   - `{ "type": "minigame", "id": "mg_fusibles" }`: el **cliente del asignado** abre el minijuego del catálogo (`openCoopMinigame`, con overrides de escenario) y, al ganar, manda `coop:progress`.
   - `{ "type": "reach", "block": "blk_p0_portal" }`: el **cliente del asignado** compara en cada estado del servidor la posición autoridad de SU residente (`coopTickLocal()` tras `applyRemoteState`) y marca progreso al llegar.
   - **El servidor verifica contra la asignación** (`coop:progress`): solo el ASIGNADO marca su rol, y una sola vez. *Nadie puede marcar el rol de otro.*
4. **CIERRE** — cuando todos los roles asignados están `done`, `completeCoop()`: bonus `pointsBonus` (+150) **para cada uno** vía marcador, `completeToast` del catálogo con `{a}`, `{b}`… (nombres reales), la misión entra en `done` y arranca el cooldown.

### 5.3 Robustez: roles, salidas y reconexión

- **Salida explícita** (botón «Salir») → `purgeParticipant`: libera sus roles co-op al instante (`coop:state` actualizado) y saca su asiento de voz.
- **Caída del transporte** (pestaña en segundo plano, red móvil) → **gracia de 30 s** (`GRACE_MS = 30_000`): el participante sobrevive como ausente (`present: false`) con roles, voz y fila de marcador **intactos**. Si antes de 30 s llega `session:rejoin {code, residentId}`, se cancela la purga, se re-vincula el MISMO residente y el servidor **re-difunde mundo + marcador + co-op + voz** (*«todo lo que el vecino perdió mientras volaba»*).
- **Salto**: solo el anfitrión puede `coop:skip` la misión activa (vuelve el cooldown y luego se ofrece la siguiente).
- **El sim no se toca**: la orquestación co-op vive en el servidor/orquestación cliente; las misiones normales (`missions.json`) nunca cambian de comportamiento por estar en comunidad.

---

## 6. Modo competitivo

### 6.1 Duelos de minijuegos contrarreloj

El duelo estrella es el **rearme de fusibles** (`mg_fusibles`, tipo `tap_sequence`: memorizar y repetir secuencias de palancas 🔴🟡🟢🔵 con `showMs: 550`, `gapMs: 260`, `inputTimeoutMs: 6000`, `lives: 2`). El flujo completo, tal cual está implementado:

1. **Cronómetro en el cliente**: al abrirse el modal del minijuego, `minigameStartedAt = performance.now()`.
2. **El resultado viaja PRIMERO**: `complete_minigame` (éxito/fallo) — el servidor lo registra en `lastMinigame` aunque el sim lo dedupe, para **autorizar la marca de tiempo** (*«en comunidad todos juegan el mismo minijuego, aunque el sim solo cuente el primero»*). Después viaja `session:minigame_time {id, secs}`.
3. **El servidor valida contra el catálogo** (`rules.multiplayer.score.minigames[id]`): éxito reciente ≤ 30 s, `0.5 < secs ≤ maxSecs`, rate limit 3 s, **solo puntúa mejorar el récord personal** (§4.2). Anuncia la marca con `firstToast` o `recordToast`.
4. **El tablón guarda las mejores marcas**: `boardExtraBest: " · fusibles {secs} s"` en la fila del marcador.

Verificación real del commit v1.55 (E2E con navegador): *4,2 s +50 / 6,5 s rechazado (no mejoró récord) / 3,1 s +50 → 100 pts acumulados, chip y tablón verificados.*

### 6.2 Competitivo «blando» del sim

Además del duelo cronometrado, el juego compite por diseño: el **marcador «Vecino del mes»** ordena a la comunidad entera (misiones + marcas), la **mejor marca de fusibles** de cada vecino es visible en el panel, y los eventos del ecosistema (peleas vecinales, manifestaciones) dan material de comparación social. No hay PvP directo sobre el mundo: la autoridad del sim y la cordura del rellano lo prohíben.

---

## 7. Canal de voz

**WebRTC P2P en malla completa** (`src/game/client/voice.ts`), estrenado en v1.56. Principio de diseño, literal del código: *«El servidor de sesión SOLO reenvía la señalización (offer/answer/ICE dirigida por residentId): el audio nunca pasa por él»*.

| Aspecto | Implementación real |
|---|---|
| Topología | Malla: cada navegador se conecta directo con el resto (`RTCPeerConnection` por vecino) |
| Tamaño | `voice.maxPeers: 4` (zod permite 2–8); canal lleno → `voice:error { message: 'voice_full' }` |
| Señalización | `voice:signal {to, data}` dirigida; el servidor hace **relay puro** (no entiende SDP) |
| ICE | STUN público de Google (`stun:stun.l.google.com:19302`) |
| Anti-glare | **Quien tiene `residentId` MENOR crea la oferta**; el otro responde (orden determinista, sin colisiones) |
| Micrófono | `getUserMedia({ audio: { echoCancellation, noiseSuppression } })` |
| Sin micro | Pista **sintética** con `AudioContext` (oscilador → `MediaStreamDestination`): el pipeline WebRTC necesita un track; fuera de QA el gain es **0** (modo escucha silencioso); en QA (`?qaengine=1`) suena un tono leve (gain 0.08 → RMS ≈ 0.057) para verificar el camino completo E2E |
| Indicador de habla | `AnalyserNode` sobre la pista local: **RMS con histéresis** — se enciende a 0.045, se apaga por debajo de 0.03 tras 1,2 s de silencio; se publica cada 200 ms por `voice:state` |
| Mute | `toggleMute()` habilita/deshabilita el track (la pista no se suelta: reconectar no cuesta) y publica estado forzado |
| Roster | `voice:roster { members: [{id, name, muted, speaking}] }` — el HUD y el panel Multijugador pintan quién está, quién habla y quién está mudo |
| Reconexión | El asiento de voz **sobrevive a la caída**: el `session:rejoin` conserva la entrada y el socket nuevo hereda el asiento (`voiceEntry.socketId = socket.id`); `voice:join` del cliente refresca si hace falta |
| Toasts | Textos del catálogo: *«🎙️ Canal de voz del vecindario abierto. Tus vecinos te oyen (modera el volumen de las quejas).»* / cierre: *«Vuelven los gritos de ventana en ventana.»* / sin micro: *«entras al canal en modo escucha (silencio)»* |

---

## 8. Arquitectura técnica

### 8.1 Diagrama de módulos

```
public/content/*.json ──(fetch + Zod)──► src/game/content/          · catálogos + schemas (3.157 líneas de zod)
                                              │  loadContent() indexa por id y valida referencias
                                              ▼
                                        src/game/sim/               · NÚCLEO DETERMINISTA (congelado)
                                              │  world.ts (createWorld) · tick.ts (1 tick = 1 min)
                                              │  commands.ts (dispatch) · effects.ts (ops) · missions.ts
                                              │  graph.ts (Dijkstra) · influence.ts (ruido/agua/…)
                                              │  extra/: weather.ts · ai.ts · junta.ts · economy.ts
                        ┌─────────────────────┴──────────────────────┐
                        ▼                                            ▼
              src/game/client/                          mini-services/vecinos-server/
              controller.ts (dueño en navegador)         servidor AUTORITATIVO (Bun + socket.io :3010)
              engine.ts (WebGPU→WebGL2) · store.ts (zustand)   usa el MISMO sim + el MISMO loader
              camera/actors/building/… (presentación)    session.ts (modelo de sesión) · index.ts (protocolo)
                        │                                            ▲
                        ▼                                            │ socket.io (websocket/polling)
              src/components/game/* (React + shadcn/ui)  src/game/client/net.ts (NetSession) · voice.ts
```

Claves del reparto:

- **El sim no sabe que existe el render ni la red.** Comandos entran (`dispatch`), eventos salen (`drainEvents`). Única puerta de mutación: `applyEffect`.
- **El servidor autoritativo usa el MISMO núcleo** (`import { createWorld, dispatch, tick } from '@/game/sim'` vía paths de tsconfig) y el **mismo loader de contenido** (Bun resuelve el `fetch` de `public/content/` a `file://`). Un mundo del servidor = una sesión.
- **El cliente multijugador es un espejo**: `applyRemoteState` adopta el mundo del servidor por `seq` monotónico; `reconcile()` corrige desvíos de posición del avatar local forzando `forceLocation` al bloque que dice la autoridad.
- En un jugador, el controlador posee el mundo y llama al sim directamente; en comunidad, cada acción sale por `session:command`.

### 8.2 Protocolo de sesión (contrato v1 + extensión v1.56)

| Dirección | Mensaje | Contenido/notas |
|---|---|---|
| C→S | `session:create {scenarioId?}` (ack) | Crea mundo + código de 4 caracteres (alfabeto `A-Z2-9` **sin 0/O/1/I**); el emisor es anfitrión |
| C→S | `session:join {code}` (ack) | Asigna vivienda `vacant`, crea `res_guest_N` (arquetipo `guestArchetype`, cartera `guestWallet: 300`); `maxPlayers: 4` |
| C→S | `session:command {cmd}` | **El actor lo sobrescribe SIEMPRE el servidor** (el cliente nunca manda actor); dedup de minijuegos vía `pendingMinigame` |
| C→S | `session:minigame_time {id, secs}` | v1.55 — marca del duelo (§6) |
| C→S | `session:set_speed {speed}` | Solo anfitrión; válidas **1 / 3 / 10** (guard estricto `isSpeed`) |
| C→S | `session:leave` | Salida explícita (purga inmediata) |
| C→S | `coop:claim / coop:progress / coop:skip` | v1.56 — co-op (§5) |
| C→S | `voice:join / voice:leave / voice:state / voice:signal` | v1.56 — voz (§7) |
| C→S | `session:rejoin {code, residentId}` (ack) | v1.56 — reconexión transparente |
| S→C | `session:joined` | `{code, isHost, yourResidentId, scenarioId, participants}` |
| S→C | `session:participants` | Lista `{id, name, home}` |
| S→C | `session:state {seq, world, events}` | **Sincronización por bloques**: snapshot completo del mundo por tick + eventos drenados; `seq` monotónico (el cliente descarta seq ≤ aplicada) |
| S→C | `session:score {rows}` | Marcador «Vecino del mes» (§4.2) |
| S→C | `coop:state {active, done}` | Misión co-op activa + historial |
| S→C | `voice:roster / voice:state / voice:signal / voice:error` | Voz |

**Cadencia:** el servidor tickea cada `tickSecondsPerTick` (1 s) multiplicado por la velocidad de la sesión y difunde `session:state` con los eventos drenados. El bucle está blindado: si el sim lanzara una excepción, se registra y **el bucle sigue** (no hay mundo congelado silencioso).

**Sesiones:** sin participantes → TTL de **5 min** antes de destruirse (un `join` a tiempo la rescata); cierre limpio en SIGINT/SIGTERM.

### 8.3 Determinismo y save/load

- **RNG**: mulberry32 con `rngState` en el propio mundo (`seed` del escenario: `slice` usa 12345). La vivienda del jugador se sortea con esa semilla entre `homeCandidates` — misma semilla, misma partida.
- **Reloj**: `world.clock {day, minute}`; 1440 min = 1 día; noche definida en `rules.sim.night` (23:00–07:30).
- **Orden del tick** (`tick.ts`): clima → IA → emisiones (actividades + muebles) → propagación de influencias → economía → misiones.
- **Guardado**: el mundo completo va a `/api/save` (POST JSON) → Prisma → **SQLite** (`db/custom.db`, modelo `GameSave`, slot único `auto`). En multijugador está **desactivado con aviso del catálogo**: *«En comunidad se decide a la vez: guardar no cabe en el acta multijugador.»*

---

## 9. Personalización — guía práctica de modificación de datos

> **Regla general:** el juego se modifica **editando JSON** en `public/content/`. El loader (`src/game/content/index.ts`) valida con Zod **en cada arranque, en cliente y servidor**; un catálogo inválido **aborta el servidor** con el error exacto (`formatIssues`). Los ficheros opcionales (`assets`, `emotes`, `ecosystem`, `achievements`, `multiplayer`, `music`, …) siguen el «patrón emotes»: si no existen, la partida funciona sin esa capa; si existen y son inválidos, error sonoro.

### (a) Añadir una misión co-op nueva a `multiplayer.json`

Pasos: 1) piensa dos roles complementarios (uno de minijuego + uno de presencia es el patrón); 2) añade el objeto a `coop.missions`; 3) listo — el servidor lo rota automáticamente al agotar las anteriores.

```json
{
  "id": "coop_antena",
  "title": "Operación antena",
  "brief": "El wifi del portal ha muerto en pleno capítulo final. Uno sube al tejado, otro planta cara al vecino que odia las antenas.",
  "roles": [
    {
      "id": "antenero",
      "label": "Antenero de guardia",
      "hint": "Orienta la antena: completa el minijuego de precisión",
      "objective": { "type": "minigame", "id": "mg_limpiar_cabina" }
    },
    {
      "id": "escudo",
      "label": "Escudo humano del rellano",
      "hint": "Distrae a la oposición: plantado en la lavandería",
      "objective": { "type": "reach", "block": "blk_p0_lavanderia" }
    }
  ],
  "pointsBonus": 150,
  "completeToast": "🤝 {a} y {b} rescataron «{title}» en equipo: +{points} pts para cada uno."
}
```

Restricciones reales del zod (`multiplayerCatalogSchema`): `roles` mínimo 2, `pointsBonus` entero > 0, toasts con mínimo 1 carácter. Tokens disponibles en `completeToast`: `{a}`, `{b}`…, `{title}`, `{points}`; en `offerToast`: `{title}`. **Límite:** los únicos tipos de objetivo existen tal cual (`minigame` | `reach`); un tercer tipo (p. ej. «recolectar») requiere tocar cliente+servidor+schema.

### (b) Cambiar puntuaciones en `rules.multiplayer.score`

Todo el criterio de «Vecino del mes» se retoca aquí sin tocar código:

```json
"score": {
  "missionCompletedPoints": 150,
  "missionBonus": { "m_fin_de_obra": 200, "m_veredicto": 300 },
  "minigames": {
    "mg_fusibles":         { "label": "rearme de fusibles",  "pointsPerRecord": 50, "maxSecs": 600 },
    "mg_limpiar_cabina":   { "label": "fregatón profesional", "pointsPerRecord": 40, "maxSecs": 300 }
  }
}
```

- `missionBonus` suma puntos extra a misiones concretas (ids de `missions.json`).
- Cualquier minijuego listado aquí entra en el circuito de duelos (§6): el cliente cronometra solo los ids que aparecen (`score.minigames?.[id]`), y el servidor valida con su `maxSecs`.
- Los textos (`recordToast`, `boardLine`…) son plantillas: cambia las palabras, respeta los tokens.

### (c) Crear un minijuego nuevo en `minigames.json`

El tipo `timing_bar` (parar un cursor en zonas verdes) tiene esta configuración validada (`minigameDefSchema`): `rounds`, `cursorSpeed`, `zoneWidth`, `zones` (posiciones 0..1), `accelPerRound`, `lives`.

```json
{
  "id": "mg_contador",
  "name": "El contador del portal",
  "description": "Luz, cámara, lectura: pulsa cuando el cursor cruce el punto de lectura y el acta tendrá todas las firmas.",
  "emoji": "📖",
  "type": "timing_bar",
  "config": {
    "rounds": 4,
    "cursorSpeed": 1.1,
    "zoneWidth": 0.2,
    "zones": [0.3, 0.75],
    "accelPerRound": 0.18,
    "lives": 3
  },
  "onSuccess": [
    { "op": "addReputation", "resident": "player", "amount": 6 },
    { "op": "toast", "text": "Acta firmada por todos. Hasta Pinturillas (con garabato, pero firmada).", "tone": "good" }
  ],
  "onFail": [
    { "op": "addFunds", "to": "player", "amount": -25 },
    { "op": "toast", "text": "Falta la firma del 3B. Otra cita, otra derrama de paciencia.", "tone": "bad" }
  ]
}
```

Otros tipos ya implementados (no se puede inventar un quinto sin código): `tap_sequence` (`pads`, `sequenceStart`, `sequenceGrow`, `showMs`, `gapMs`, `inputTimeoutMs`, `lives`), `reflex_targets` (`targets`, `spawnIntervalMs`, `targetLifeMs`, `radiusPct`, `missesAllowed`, `lives`, `emoji`, `decoyEmoji`, `decoyChance`), `memory_pairs` (`items`, `lives`). El texto de instrucción por tipo sale de `rules.minigames.introByType`. Para que el nuevo minijuego cuente en el marcador, añádelo también a `rules.multiplayer.score.minigames` (punto b). Para offers de escenario existe `scenario.minigameOverrides` (dificultades por escenario).

### (d) Añadir misiones normales a `missions.json`

Receta con los ops existentes (§3.3):

```json
{
  "id": "m_ruta_bici",
  "title": "La bici del pasillo",
  "description": "La bici de Pinturillas lleva tres días bloqueando el carril exterior. El pasillo, indignado.",
  "trigger": {
    "all": [
      { "mission": "m_bienvenida", "state": "done" },
      { "dayMin": 3 }
    ]
  },
  "steps": [
    { "id": "aviso", "type": "phone_call", "dialog": "dlg_ruta_bici", "hint": "Mensaje de la administración" },
    { "id": "bici",  "type": "reach", "target": { "block": "blk_p1_b", "slot": "door" }, "hint": "Habla con Dolores" }
  ],
  "choices": [
    {
      "id": "multa",
      "label": "Multa vecinal (50 €)",
      "hint": "La ley del pasillo es clara",
      "icon": "coins",
      "effects": [
        { "op": "addFunds", "to": "community", "amount": 50 },
        { "op": "addRelation", "a": "player", "b": "kid", "affinity": -10 },
        { "op": "setParam", "target": "pasillo_planta", "param": "cleanliness", "delta": 5 }
      ]
    },
    {
      "id": "taller",
      "label": "Arreglarla tú (minijuego)",
      "hint": "Dos pedales y fe",
      "icon": "wrench",
      "effects": [
        { "op": "startMinigame", "id": "mg_contador" },
        { "op": "addRelation", "a": "player", "b": "kid", "affinity": 8 }
      ]
    }
  ],
  "onComplete": [
    { "op": "addFunds", "to": "player", "amount": 150 },
    { "op": "addReputation", "resident": "player", "amount": 4 }
  ]
}
```

Detalles que evitan sustos: el `trigger` exige que las **roles** se puedan enlazar (si defines `roles`, los arquetipos deben existir y estar `present`); las referencias `$home` se resuelven a la vivienda del jugador; los ids de bloque siguen el patrón `blk_p{planta}_{tag}` del template (`edificio_3p_3v`); y cualquier texto admite tokens (`{blk:...}`, `{home}`). El teléfono suena desde el primer tick: `createWorld` llama a `advanceMissions` al crear el mundo.

### (e) Textos e i18n

- El juego nace en **español**; el inglés es un **overlay plano**: `translations.en.json` (1.059 pares) mapea texto ES → texto EN y se aplica con `applyContentLanguageAsync` al cambiar el idioma (también re-traduce contenido narrativo ya resuelto).
- **Receta:** escribe tus textos nuevos en español; si quieres inglés, añade el par `"tu texto exacto ES": "Your exact EN text"` al overlay. Si no está, esa frase queda en español (no rompe nada).
- Los textos de herramientas de QA/desarrollo (`artref`, prompts de consola) NO son contenido del juego y viven en su módulo, como marca el propio comentario de `artref.ts`.

### (f) Vecinos y arquetipos

Un vecino = entrada en `archetypes.json` (15 hoy) + opcionalmente modelo en `assets.json` + residentes en `scenarios.json`:

```json
{
  "id": "capataz",
  "name": "Marisa, la Capataz",
  "tagline": "Presupuesta en voz alta. Cobra en silencio.",
  "traits": { "sociability": 0.6, "tidiness": 0.7, "noisiness": 0.4 },
  "needs": ["sleep", "social", "fun", "money"],
  "activities": {
    "idle": {},
    "sleep": { "anchor": "bed", "label": "😴 duerme" },
    "obra_en_casa": { "at": "home", "say": ["Nivelando. Como todo en esta vida."], "emits": { "noise": 0.4 } }
  },
  "view": { "color": "#c26d4f", "accent": "#ffd166", "hat": "cap", "prop": "phone", "height": 1.3 }
}
```

- `activities.at` admite `'home'|'corridor'|'core'|'stairs'|'out'` o `'def:<blockDefId>'` (ir al bar, a la lavandería…); `emits` alimenta los canales de influencia; `schedule` acota franjas horarias; `say` son las frases al llamar a su puerta.
- `view` define el **fallback greybox** (color/altura/accesorio). El arte final va en `assets.json` (§10): `"capataz": { "model": "actors/capataz.gltf", "nominalHeight": 1.35, ... }`.
- Para que aparezca: añádelo al array `residents` del escenario (`scenarios.json`), con `home`, `present`, `wallet`, `reputation`, `relations` y opcional `parentOf` (encadena roles de misión como `m_pintadas_ascensor`).

### (g) Ecosistema y eventos

`ecosystem.json` es el «cerebro» de la vida del edificio. Eventos con `kind`, `weight` (sorteo ponderado), `cooldownTicks`, `window` (franja horaria), `when` (condiciones) y `outcomes` (consecuencias). Eventos actuales: vendedor de semillas, vendedor de bombillas, trastada de Pinturillas, mascota escapada, **apagón nocturno** (con `chance` y bloque `blackout`), deterioro nocturno, vecinos organizados. Ajustes finos:

- **Clima**: `rules.sim.weather` (ciclo ponderado + duración 180–480 min).
- **Deterioro visual**: `rules.view.decay` (umbrales de `humidity`, `soot`, `cracks`, `grime`).
- **Luces por presencia**: bloque `lights` del ecosistema (`nightIntensity`, `blackoutOccupiedIntensity`, `lampsPerCorridor`…).
- **Bromas del apagón**: `rules.blackoutJokes.lines` (añadir líneas = añadir cultura vecinal).
- **Vida de calle**: tráfico (`rules.traffic`), viandantes (`rules.pedestrians`), paseos al parque (`rules.paseo`), taxis, ambulancia — todo por catálogo.

### (h) Límites: qué NO se puede tocar sin código

| Zona | Estado | Consecuencia |
|---|---|---|
| `src/game/sim/**` | **Congelada** (determinismo y contrato servidor/cliente) | Cualquier cambio exige actualizar server + cliente + suites QA |
| Ops de efectos, tipos de paso, tipos de objetivo co-op, tipos de minijuego | Cerrados por código + zod (`effects.ts`, `schemas.ts`) | Uno nuevo = código en sim + schemas + presentación |
| `rules.view` (geometría 2.5D: celdas, pasillos, carriles) | Contrato compartido con `building.ts`/`stairs.ts`/`storage.ts` | Cambiar celdas/alturas desalinea la física del jugador |
| Nada más | Libre | JSON a gustos: misiones, textos, economía, clima, vecinos, arte |

Recuerda: **zod valida TODO al cargar** — un typo en `multiplayer.json` no degrada el juego: aborta el arranque con el mensaje exacto. Es la mejor red de seguridad (y el mejor linter de vecinos).

---

## 10. Especificación de arte para artistas

Cómo sustituir la maqueta (*greybox*) por arte final **sin tocar una línea de código**. La maqueta actual ya es mixta (glTF + billboards pintados), pero todas las vías de sustitución están data-driven.

### 10.1 Manifiesto `assets.json` (modelos por arquetipo/bloque)

```json
"actors": {
  "jubilada": {
    "model": "actors/jubilada.gltf",
    "nominalHeight": 1.35,
    "animations": { "idle": "idle", "walk": "walk", "knit": "knit" },
    "defaultAnimation": "idle",
    "walkAnimation": "walk",
    "activityAnimations": { "chair": "knit" },
    "stateAnimations": { "run": "run", "talk": "talk", "laugh": "laugh", "argue": "argue",
                          "phone": "phone", "sit": "sit", "fight": "fight", "hurt": "hurt" }
  }
},
"blocks": {
  "vivienda_estandar": { "model": "blocks/vivienda_estandar.gltf",
                         "nominal": { "w": 4.68, "h": 2.46, "d": 2.8 }, "overlay": true }
}
```

- `base: "/assets/"` + rutas relativas. Sin manifiesto → greybox puro (color/altura del `view` del arquetipo, `actorFallbackColor`/`actorFallbackHeight`).
- `nominal` (bloques) calibra escala del modelo contra la celda real; `tintStrength` cuánta tinta del catálogo acepta el material; `overlay: true` marca bloques con fachada que se desvanece al entrar.
- Los rigs usan un **contrato de clips común**: `idle`, `walk` + específicos por actividad (`dance`, `spray`, `drums`, `drill`, `ride`, `care`, `knit`, `paint`, `work`, `gig`, `obra`, `rock`, `phone`, `appraise`, `inspect`) y los 8 estados sociales (`run/talk/laugh/argue/phone/sit/fight/hurt`).

### 10.2 Hoja de sprites del personaje (retícula 8×8)

Contrato completo en `public/content/character-sprites.json`:

```json
{
  "version": 1,
  "layout": { "frameWidth": 256, "frameHeight": 256, "columns": 8,
               "rows": { "idle": 0, "walk_right": 1, "walk_left": 2, "walk_down": 3,
                          "walk_up": 4, "sit": 5, "talk": 6, "lie": 7 },
               "fps": { "idle": 6, "walk_right": 10, "walk_left": 10, "walk_down": 10, "walk_up": 10, "sit": 3, "talk": 8, "lie": 2 } },
  "sheets": { "jugador_base": "/sprites/jugador.png" },
  "animations": {
    "walk_right": { "cells": [[0,0],[0,1],[0,2]], "fps": 6, "groundMarginPx": 3 },
    "walk_left":  { "cells": [[0,0],[0,1],[0,2]], "mirror": true, "fps": 6, "groundMarginPx": 3 },
    "walk_down":  { "cells": [[0,3],[0,4]], "fps": 5.5, "groundMarginPx": 14 },
    "walk_up":    { "cells": [[0,5],[0,6]], "fps": 5.5, "groundMarginPx": 14 },
    "idle":       { "cells": [[0,7],[1,0]], "fps": 0.7, "groundMarginPx": 10 }
  },
  "alwaysFor": ["jugador_base"],
  "quadM": 1.39
}
```

Reglas (las pinta también la herramienta de referencia):

- **Retícula 8 columnas × 8 filas, frame 256×256 px**, pies abajo (margen 3 %), figura centrada.
- `walk_right` mira a la **DERECHA** de pantalla; `walk_left` es su espejo (`mirror: true`).
- Filas de arriba a abajo: idle · walk_right · walk_left · walk_down (frente) · walk_up (espalda) · sit · talk · lie.
- `groundMarginPx` recorta el contacto con el suelo; `quadM` (1,39 m) calibra el tamaño del quad en metros.
- `alwaysFor` obliga a usar la hoja en cualquier cámara/distancia para los arquetipos listados (hoy, el jugador); el resto conserva LOD rig glTF ↔ hoja de sprites.

### 10.3 Herramienta de referencia `?artref=1`

Abre el juego con `?artref=1` (v1.47): overlay de QA con **la hoja de sprites del arquetipo**, la regla de la retícula escrita al pie, el **PNG limpio descargable**, la hoja **anotada** con etiquetas de fila y el **turnaround de 3 vistas** (perfil/frente/espalda). Incluye botón «Guardar PNGs en /art/preview/» (API `/api/artref-save`). Es exactamente la retícula que el arte externo debe respetar: si tu PNG respeta la retícula y se registra en `character-sprites.json`, **sustituye a la hoja generada automáticamente**.

### 10.4 Dioramas de interiores (`interiors.json`)

Los interiores son **billboards con paralaje** (v1.23+), definidos por estancia:

```json
{
  "artBase": "/art/interiors/raw/",
  "keyColor": "#ffffff", "keyTolerance": 0.15, "processSize": 512, "alphaCutoff": 0.45,
  "rooms": {
    "estancia_estudio_diafano": {
      "wall": "wall_estudio_terracota.png",
      "walls": ["wall_estudio_terracota.png", "wall_estudio_salvia.png", "...13 fondos"],
      "floor": "floor_madera.png",
      "floors": ["floor_madera.png", "floor_hidraulico.png", "...8 suelos"],
      "sets": [[
        { "art": "f_fogones.png",  "w": 1.35, "h": 1.15, "u": 0.42, "v": 0.88, "layer": "back" },
        { "art": "f_sofa.png",     "w": 1.7,  "h": 0.95, "u": 0.2,  "v": 0.42, "layer": "mid" },
        { "art": "f_alfombra.png", "w": 1.8,  "h": 1.15, "u": 0.35, "v": 0.32, "layer": "rug" },
        { "art": "f_planta.png",   "w": 0.75, "h": 1.35, "u": 0.94, "v": 0.18, "layer": "front" }
      ]],
      "furnitureVisible": false
    }
  }
}
```

- `keyColor` + `keyTolerance`: chroma de recorte (fondo blanco puro → alpha) con `alphaCutoff`.
- `walls[]`/`floors[]` alimentan el **sorteo determinista de variedad** por vivienda (12 variantes de vivienda en `rules.dwellingVariants`, 6 diseños de hall en v1.50).
- `sets` son composiciones alternativas de muebles por capas (`back|mid|front|rug`); `u/v` = anclaje normalizado en la pared.
- Convenio de nomenclatura real del repo: `wall_*`, `floor_*`, `f_*` (muebles), `door_*`, `side_wall_*`, `ceiling_*` — respétalo: el pipeline y los scripts (`scripts/gen-interiors.ts`, `gen_interior_walls.py`) lo asumen.

### 10.5 Reglas de la vista y del material

- **Color de bloque**: cada bloque define `view.color` (+ `altColor` opcional); desde v1.48, `fixedWall: true` obliga a que el bloque SIEMPRE se vea del color del catálogo (escalera, pasillos) — nada de tintados dinámicos sobre esas superficies.
- **Sombras** (`rules.shadows`): un único sol con `ShadowGenerator` PCF (`mapSize: 2048`, `darkness: 0.34`); `casters`/`receivers`/`excluded` por **patrones de nombre de malla** (`blk_`, `calle_`, `viandante`… / excluye `vidrio`, `fachada_`, `lluvia`, `decal_`…). Al crear mallas nuevas, nómbralas acorde o añade el patrón.
- **Glow/bloom** (`rules.glow`): `GlowLayer` (intensidad 0.45, kernel 32) sobre emisivos; los canales de influencia pintan con `channelGlow` (ruido naranja, agua azul, odors verde, wifi lila…).
- **LOD** (`rules.lod`): a `dist: 14` se ocultan `edges`; a `24` también `glow`.
- **Cristales/alpha**: usar alpha-test estilo Babylon 8 (`useAlphaFromDiffuseTexture`); el portal lleva doble cara + depth pre-pass (v1.53).

### 10.6 REGLA ANTI z-fighting (superficies nunca coplanares)

Norma del proyecto desde v1.25/v1.27: **dos superficies no pueden compartir el mismo plano**. El catálogo codifica el retardo:

- `privacy.gapFill`: `protrude: -0.03`, `stagger: 0.008` (relleno de juntas retranqueado y desfasado).
- `privacy.solera`: `protrude: 0.034`, `stagger: 0.01` (solera viva sobre el suelo).
- Carteles: `out: 0.012` (venta/alquiler), `out: 0.006` (cartel OKUPA), `lockOnDoor.out: 0.05` (candado).
- Placas de puerta en `plaque.z` con holgura sobre la fachada; juntas anti-coplanar en cubo de escalera.

Si tu arte introduce superficies nuevas, respeta el patrón: retranqueo (`out`/`protrude`) + desfase (`stagger`) por hash, nunca planos gemelos.

### 10.7 Escalera de rendimiento (eco / normal / alta + auto-ajuste)

- **Calidad base** (`src/game/client/options.ts`): `alta` (escala 1), `normal` (1,35), `eco` (1,75) — presupuesto de píxeles por hardware scaling.
- **Auto-ajuste** (`PerfDirector`, v1.38): mide FPS en ventanas de 1,2 s contra el objetivo (30/45/60 o «máximo») y recorre una escalera de **S0 → S8**: sombras cada 2 fotogramas → sin glow → resolución interna ↓ → sin sombras → resolución al mínimo. Recuperación simétrica pero lenta (histéresis: 2 muestras para degradar, 3 para recuperar, cooldowns 4 s/9 s) y el modo «máximo» nunca re-enciende el glow.
- **Regalo nocturno**: con sol apagado el mapa de profundidad de sombras se CONGELA (el sol 2.5D no gira) — ahorro del pase de profundidad ~40 % del ciclo.
- Para el artista: el arte pesado debe sobrevivir a S3+ (resolución reducida); evita detalles que mueran a media resolución y texturas gigantes en billboards frecuentes.

### 10.8 Formatos, pesos y nomenclatura recomendados

| Recurso | Formato | Dónde | Convención |
|---|---|---|---|
| Modelos de personajes/bloques | **glTF** (`.gltf`) | `/public/assets/actors|blocks/` | `actor` = id de arquetipo (`jubilada.gltf`); `block` = id de def (`portal.gltf`) |
| Hoja de sprites personaje | **PNG** con alpha, 2048×2048 (8×8 de 256) | `/public/sprites/` | `jugador.png`; registrado en `character-sprites.json` |
| Billboards de interiores | **PNG** con fondo chroma blanco (lo recorta el pipeline), procesado a 512 | `/public/art/interiors/raw/` | prefijos `wall_`, `floor_`, `f_`, `door_`, `side_wall_`, `ceiling_` |
| Árboles / fachadas backdrop | **PNG** con alpha | `/public/art/trees/`, `/public/content/backdrop/` | nombres descriptivos (`tree_round.png`, `fachada_1_cerca.png`) |
| Audio | **MP3/OGG** | `/public/art/audio/`, catálogo `sounds.json` (40 sonidos, 18 eventos, 4 voces) | ids semánticos (`timbrecasa`) |

Pautas de peso (coherentes con lo ya publicado en el repo): PNG con paleta/recorte generoso para billboards, glTF ligeros (geometría simple + materiales planos), y nada que impida el auto-ajuste llegar a 30 FPS en hardware modesto.

---

## 11. Operación

### 11.1 Cómo arrancar

```bash
# 1) Juego (Next.js) en :3000
bun run dev

# 2) Servidor autoritativo del multijugador en :3010 (puerto FIJO, lo exige el gateway)
cd mini-services/vecinos-server && bun index.ts

# 3) Gateway Caddy en :81 — reenvía :3000 por defecto y ?XTransformPort=N al puerto N
caddy run --config Caddyfile
```

- El cliente multijugador conecta a `/?XTransformPort=3010` (`SERVER_URL` en `net.ts`): **el puerto solo vive en ese parámetro**, nunca en otra parte de la URL ni en un path distinto — es la convención del gateway (mismo patrón que `examples/websocket/`).
- El servidor NO lee `process.env.PORT` a propósito (comentario del código) y usa socket.io con `path: '/'` porque Caddy lo exige.
- `package.json` adicionales: `mini-services/vecinos-server/package.json` (proyecto independiente con su `bun.lock`).

### 11.2 Guardar / cargar

- Slot único `auto` sobre **SQLite vía Prisma** (`prisma/schema.prisma`, modelo `GameSave`; base en `db/custom.db`).
- `POST /api/save { slot, state }` (mundo JSON completo) y `GET /api/save?slot=auto`. El estado guardado pasa por migraciones defensivas al cargar (`migrateRooms`, `world.entry` por defecto).
- Deshabilitado en multijugador (toast del catálogo, §8.3).

### 11.3 QA y verificación

| Herramienta | Qué da |
|---|---|
| `?qaengine=1` | Asa de QA: `window.__vecinosQa` con `getScene/getWorld/getContent/getLogic/getEcosystem/getController/getVoicePeers/getVoiceState/setTouch/qaHold/qaResume` (conducción determinista del jugador congelando el frame loop) |
| `?scenario=qa` | Escenario de pruebas del catálogo (`scenarios.json` tiene `slice` y `qa`) |
| `?artref=1` | Referencia de arte (§10.3) |
| `?join=CODE` | Aterrizaje directo como invitado (v1.54) |
| `window.__vecinos` | `{ store, controller }` para inspección desde consola |
| `mini-services/vecinos-server/test-coop.ts` | Verificación E2E sin navegador del co-op + voz + rejoin (10 grupos de aserciones: oferta, roles, guardias, cierre con bonus, roster de voz, relay de señalización, rejoin) |
| `test-client.ts` | Cliente de protocolo v1 de referencia |
| `scripts/qa-v*.ts`, `smoke-*.ts` | Suites de regresión por versión (una por hito, con capturas en `docs/shots/`) |

### 11.4 Limitaciones conocidas (documentadas, no sorpresas)

| Limitación | Detalle y mitigación |
|---|---|
| **AudioContext headless** | En navegadores sin micro/QA headless, la voz usa pista sintética (silencio fuera de QA; tono audible en QA con `resume()` porque el contexto nace suspendido por la política de autoplay) |
| **Throttling de pestañas en segundo plano** | Chrome ralentiza timers y un intento de reconexión puede tardar ~60 s: por eso la reconexión es **infinita** (`reconnectionAttempts: Infinity`) + **gracia de 30 s** + `session:rejoin` en el servidor (§5.3) |
| **Guardar en comunidad** | Deshabilitado por diseño (coherencia del mundo compartido) |
| **Tamaños** | `maxPlayers: 4`, `voice.maxPeers: 4` (zod hasta 8), TTL de sesión vacía 5 min |
| **Canal lleno / sesión llena** | `voice_full` y `sessionFull` con textos del catálogo (*«La comunidad está completa. Ni los okupas caben ya.»*) |
| **Contexto gráfico perdido** | Overlay amable con recarga (v1.40) en vez de pantalla negra silenciosa |

---

### Apéndice: inventario rápido de catálogos (`public/content/`)

| Fichero | Contenido | Nota |
|---|---|---|
| `rules.json` (2.088 líneas) | Reglas globales: multiplayer+score, sim (noche, clima, junta, campaña, trabajo…), view (geometría 2.5D, sombras, LOD, exterior, tráfico, peatones, backdrop, cielo…), touch, labels, interact, texts | El «constitución» del juego |
| `missions.json` | **49 misiones** | §3 |
| `multiplayer.json` | co-op (3 misiones, roles) + voz | v1.56 |
| `minigames.json` | 6 minijuegos (4 tipos) | §9.c |
| `archetypes.json` | 15 vecinos con humor | §9.f |
| `dialogs.json` | 35 diálogos de teléfono | §3 |
| `achievements.json` | 12 logros | §4 |
| `cutscenes.json` | 16 cutscenes (beats cam/walk/line/sound) | §2 |
| `ecosystem.json` | 7 eventos + luces + deterioro + mascota | §9.g |
| `music.json` | 4 contextos procedurales (mañana/tarde/evening/noche) | §2 |
| `blocks.json` (20 defs) · `rooms.json` (10) · `layouts.json` · `templates.json` (2) · `scenarios.json` (2) | Geometría y escenarios | §9.d |
| `interiors.json` · `assets.json` · `character-sprites.json` | Arte | §10 |
| `furniture.json` (19) · `influences.json` · `emotes.json` · `crossings.json` · `street.json` · `personalities.json` · `character-details.json` · `onboarding.json` · `sounds.json` · `translations.en.json` (1.059 pares) | Vida, expresión, idioma | §9 |

*Documento generado para el equipo VECINOS — todo dato citable a archivo. Última revisión: v1.56 (`14e18e0`).*
