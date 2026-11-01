# VECINOS — Kit de marketing viral

> **Kit de venta y promoción** para viralizar VECINOS en redes. Tono: el del juego — humor
> español de barra de barrio, cero corporativo, cero clickbait vacío. Cada promesa de este
> documento es REAL en el prototipo (v1.64 «timbre que abre + llamada sin congelar»): misiones
> con decisiones, multijugador por enlace, co-op de 2 roles, duelos de minijuegos, marcador
> «Vecino del mes», canal de voz integrado, sombra de contacto bajo cada personaje y timbre
> que abre la puerta de cualquier vecino presente. Es un juego indie en desarrollo: lo decimos
> siempre, y funciona a nuestro favor.
>
> Estado verificado del producto (fuente: `public/content/*.json`, `mini-services/vecinos-server/`,
> git log): 49 misiones en solitario con decisiones · 3 misiones co-op de 2 roles reales ·
> 6 minijuegos (fusibles, desatasco, diplomacia, cucarachas, buzones, fregatón) · invitación
> por URL `?join=CODE` · voz WebRTC P2P hasta 4 vecinos (solo la señalización pasa por el
> servidor) · marcador comunitario «Vecino del mes» (100 pts/misión, récord de fusibles +50,
> mejor marca E2E actual: **4,2 s**) · 100% data-driven en JSON · corre en el navegador,
> sin instalar ni registrarse.

---

## 1. Pitch en una frase + elevator pitch (30 s)

### 1.1 Pitch en una frase — 3 variantes

**GAMER (ES)**
> «Un sim de vecindario 2.5D en tu navegador: repares fusibles mientras tu colega calma a los vecinos en el portal, por voz, sin instalar nada — y que la junta decida si pagan la derrama.»

**CASUAL (ES)**
> «El juego de tu comunidad de vecinos: la lavadora de Esperanza hace su vida, tu techo empieza a hacer la suya, y tú decides: pagar el arreglo, convocar junta… o un cubo, fe y dos toallas.»

**PRENSA (ES)**
> «VECINOS es un simulador social cómico en el navegador que convierte la epopeya diaria de la comunidad de vecinos española —derramas, juntas infinitas, okupas con taladro— en misiones cooperativas online con voz integrada, todo data-driven y sin instalación.»

**EN versions**
- Gamer: *«A 2.5D neighborhood sim in your browser: fix the fuse box while your friend calms the neighbors down in the lobby — live voice, zero installs, and the owners' meeting gets the final vote.»*
- Casual: *«The game about your homeowners' association: Esperanza's washing machine is living its life, your ceiling has started living its own — pay for the fix, call a meeting, or grab a bucket, faith and two towels.»*
- Press: *«VECINOS is a comedic browser-based social sim that turns the daily epic of Spanish homeowners' associations — levies, endless meetings, squatters with drills — into online co-op missions with built-in voice chat, fully data-driven and install-free.»*

### 1.2 Elevator pitch 30 s

**ES** (hablado, ~75 palabras):
> «VECINOS es un simulador de vecindario que corre en tu navegador: nada que instalar, nada que registrar. Te mudas al 3C de un edificio con personal: Dolores la Cotilla, Kevin el fiestero, Esperanza y su lavadora que hace "su vida". Juegas misiones con decisiones de verdad —pagar la derrama, mirar al techo con dignidad, o convocar junta y que voten—. Y lo mejor: le mandas un ENLACE a un amigo y ya está jugando contigo: misiones co-op de dos roles y canal de voz, sin instalar nada. Es un indie en desarrollo, prototipo jugable, y todo el contenido es editable en JSON: tú puedes proponer tu propia misión.»

**EN** (~70 palabras):
> «VECINOS is a neighborhood simulator that runs in your browser: nothing to install, no account needed. You move into apartment 3C of a building full of characters: Dolores the Gossip, Party Kevin, Esperanza and her washing machine living its best life. Play missions with real choices — pay the levy, stare at the ceiling with dignity, or call a meeting and let them vote. Send a friend a LINK and they're instantly playing with you: two-role co-op missions and a built-in voice channel. It's an indie prototype, fully playable, and 100% data-driven — you can pitch your own mission as JSON.»

---

## 2. Bullets de venta (10) — ES/EN

1. **🚪 Te mudas al 3C. Sin instalación, sin registro.** Un enlace y a jugar. Lo demás lo pone el barrio. / *You move into 3C. No install, no sign-up. One link and you're in. The neighborhood does the rest.*
2. **🤝 Co-op de verdad, no de adorno.** Uno rearma el cuadro de fusibles; el otro baja al portal a calmar a la turba. Dos roles, una misión, +150 pts para cada uno. / *Real co-op, not decoration: one of you rewires the fuse box, the other calms the mob in the lobby. Two roles, one mission, +150 pts each.*
3. **🎙️ Voz integrada, cero Discord.** Canal de voz del vecindario para hasta 4 vecinos, WebRTC directo navegador-a-navegador. «Tus vecinos te oyen (modera el volumen de las quejas)». / *Built-in voice, zero Discord: a neighborhood voice channel for up to 4 neighbors, direct browser-to-browser WebRTC. "Your neighbors can hear you (mind the volume of your complaints)."*
4. **🗳️ La junta de vecinos como jefe final.** Convoca, propone y vota: espuma acústica «del color que elijan en votación», detectores nuevos, desalojo del 2A. El acta puede durar más que las obras. / *The owners' meeting as a final boss: call it, propose it, vote it — acoustic foam "in whatever color the vote picks", new smoke detectors, evicting 2A. The minutes may outlast the renovation.*
5. **⏱️ Duelos contrarreloj con récord comunitario.** «⏱️ {name} rearmó el cuadro en 4,2 s — ¡mejor marca de la comunidad!» Bátelo en vivo delante de tu colega. / *Timed duels with a community record: "⏱️ {name} rearmed the fuse box in 4.2 s — new community best!" Beat it live in front of your friend.*
6. **🏅 Vecino del mes.** Marcador de comunidad en vivo: misiones resueltas y récords de minijuego. Corona incluida, humildad opcional. / *Neighbor of the Month: a live community leaderboard for missions solved and minigame records. Crown included, humility optional.*
7. **🎭 Personajes con expediente.** Dolores lo sabe todo y lo cuenta; Kevin tiene dos volúmenes (fiesta y FESTIVAL); las cucarachas del 2B se han mudado sin fianza y «por lo que sea, se han organizado». / *Characters with a record: Dolores knows everything and tells it; Kevin has two volumes (party and FESTIVAL); the 2B roaches moved in rent-free and "for whatever reason, they've organized."*
8. **🎯 Decisiones con consecuencias (y con dignidad variable).** «Un cubo, fe y dos toallas: Humedad −20, Dignidad −100». Pagar, votar o aguantar: el edificio recuerda. / *Choices with consequences (dignity-adjusted): "A bucket, faith and two towels: Humidity −20, Dignity −100." Pay, vote or endure — the building remembers.*
9. **🛠️ 100% data-driven: el catálogo es el juego.** Misiones, textos, minijuegos y premios viven en JSON. Propones una misión, se edita el JSON, entra en el juego. Comunidad = guionistas. / *100% data-driven: the catalog IS the game. Missions, lines, minigames and rewards live in JSON. You pitch a mission, we edit JSON, it ships. Community = writers' room.*
10. **🪶 Ligero de verdad.** 2.5D con Babylon.js, corre en cualquier portátil (y en móvil). Ni gráficas, ni descargas de 80 GB. Tu portátil de 2015 por fin sirve para algo. / *Genuinely lightweight: 2.5D on Babylon.js, runs on any laptop (mobile too). No GPUs, no 80 GB downloads. Your 2015 laptop finally has a purpose.*

---

## 3. Hilo para X/Twitter

### 3.1 Versión ES (12 tuits)

**T1 — GANCHO** *(captura: fachada del edificio de noche con ventanas encendidas)*
> Me mudé a un piso «luminoso, tranquilo y sin historial... oficialmente».
> A las 48 horas: apagón, cucarachas organizadas, una derrama y un okupa con taladro.
> Hice un juego sobre eso. Y puedes jugarlo CON un amigo por un enlace, con voz.
> Hilo 🧵👇

**T2** *(captura: diálogo de la inmobiliaria, dlg_bienvenida)*
> VECINOS: simulador de vecindario 2.5D en el navegador.
> Sin instalar. Sin registro. Sin piedad.
> El ascensor está roto, la comunidad decide TODO en junta, y si oyes taladros los domingos, no son tuyos.

**T3** *(GIF/captura: m_goteo con el techo del salón)*
> La lavadora de Esperanza hace "su vida". El techo de tu salón también empieza a hacer la suya.
> Tus opciones, como en la vida real:
> 🔧 Pagar el arreglo (250 €)
> 🗳️ Convocar junta y que vote la derrama
> 🪣 Un cubo, fe y dos toallas (Dignidad −100)

**T4** *(captura: panel de multijugador con la URL ?join=CODE)*
> Pero lo bueno es compartir la desdicha: le mandas UN ENLACE (?join=CODE) a tu colega y ya está dentro, con su piso y su personaje.
> Un clic. Sin cuenta. Sin «descarga el launcher». Sin «verifica tu email».

**T5** *(captura: misión co-op «Apagón en la comunidad» con los dos roles)*
> Co-op de verdad: misión «Apagón en la comunidad».
> 🧑‍🔧 ROL 1: rearmar el cuadro (minijuego de fusibles, a contrarreloj)
> 🗣️ ROL 2: plantarse en el portal a calmar a la gente
> Si uno falla, el edificio entero lo nota. +150 pts para cada uno.

**T6** *(clip: los dos jugadores con el indicador de voz activo)*
> ¿Coordinaros por chat? No. Canal de VOZ integrado: WebRTC de navegador a navegador, hasta 4 vecinos.
> Nada de Discord, nada de instalar. Abres el enlace y ya estáis gritando (coordinaos) como vecinos reales.

**T7** *(captura: toast del récord de fusibles)*
> Además: duelos de minijuegos contrarreloj.
> «⏱️ Kevin rearmó el cuadro en 4,2 s — ¡mejor marca de la comunidad! (+50 pts)»
> Batería de 7 palancas, memoria y nervios. Mi récord: 4,2 s. Está ahí. Bátalo.

**T8** *(captura: marcador «Vecino del mes» con la corona)*
> Y como toda comunidad que se precie: marcador de «VECINO DEL MES».
> Misiones resueltas + récords de minijuego = puntos.
> La corona se gana. El puesto se defiende. Dolores ya está investigando.

**T9** *(captura: junta con la votación de la espuma acústica)*
> El jefe final es la JUNTA DE VECINOS.
> Propón espuma acústica «de la buena (y del color que elijan en votación)» y reza.
> Dos vecinos votarán que el ruido «no es cosa de todos». El acta tendrá 6 páginas sobre qué es humo.

**T10** *(captura: Nando el okupa o Dolores)*
> El reparto: Dolores la Cotilla (lo sabe todo y lo cuenta), Kevin el fiestero (volúmenes: fiesta y FESTIVAL), Esperanza y su lavadora, Pinturillas y su purpurina, Nando el okupa («el piso está en venta, pero yo digo que la venta está en mí»).

**T11** *(captura: ficha JSON de una misión / carpeta content)*
> Detalle de friki: el juego es 100% data-driven. Misiones, textos, minijuegos y premios son JSON.
> ¿Qué significa? Que TÚ puedes proponer tu misión, la editamos en el JSON y entra al juego.
> Comunidad = guionistas.

**T12 — CTA** *(captura: portal + botón de invitar)*
> Prototipo jugable, indie en desarrollo, ligero: corre en cualquier portátil.
> ▶️ Juega: [URL-PREVIEW]
> 💻 Código: [URL-GITHUB]
> 🔁 RT si alguna vez has sobrevivido a una junta. Cuéntanos tu peor vecino en respuestas.

### 3.2 Versión EN (condensada, 6 tuits)

**T1 — HOOK** *(shot: night facade)*
> I bought an apartment "bright, quiet, no history... officially."
> Within 48h: blackout, organized roaches, a levy vote, and a squatter with a drill.
> So I made a game about it. Playable WITH a friend via one link, with voice chat. 🧵👇

**T2** *(shot: estate agent dialog)*
> VECINOS — a 2.5D neighborhood sim in your browser. No install. No sign-up. No mercy.
> The elevator is broken, the owners' meeting decides EVERYTHING, and if you hear drills on Sundays, they're not yours.

**T3** *(shot: co-op mission, two roles)*
> Real co-op: in "Blackout" one of you rewires the fuse box under pressure while the other faces the angry crowd in the lobby. Two roles, one mission, +150 pts each.
> Plus a built-in voice channel — browser-to-browser WebRTC, up to 4 neighbors. Zero Discord.

**T4** *(shot: record toast)*
> Timed minigame duels: "⏱️ {name} rearmed the fuse box in 4.2 s — new community best!"
> Beat it live. My record: 4.2 s. It's right there.

**T5** *(shot: meeting vote / leaderboard)*
> The final boss is the HOMEOWNERS' MEETING. Propose acoustic foam "in whatever color the vote picks" and pray.
> Live "Neighbor of the Month" leaderboard. Crown earned, seat defended.

**T6 — CTA** *(shot: lobby + invite button)*
> Playable indie prototype, fully data-driven (missions are JSON — pitch yours and it ships).
> ▶️ Play: [URL-PREVIEW] · 💻 Code: [URL-GITHUB]
> RT if you've ever survived an owners' meeting. Tell me your worst neighbor below 👇

---

## 4. Guiones cortos para TikTok / Reels / Shorts (20–40 s, plano a plano)

### (a) «El vecino tóxico existe» — duelo de fusibles (30 s)

| # | Tiempo | Plano | Audio/V.O. | Texto en pantalla |
|---|--------|-------|------------|-------------------|
| 1 | 0–3 s | Zoom rápido a la cara del jugador 1 (webcam pequeña, esquina) mirando la pantalla | V.O. (seria): «En toda comunidad hay un vecino tóxico…» | «EL VECINO TÓXICO EXISTE» |
| 2 | 3–7 s | Pantalla partida: P1 en el cuadro de fusibles; P2 de camino al portal por el pasillo | Sonido de palancas 🔴🟡🟢🔵 del juego | «él rearma el cuadro…» |
| 3 | 7–12 s | Primer plano del minijuego: secuencia creciendo 2→3→4 palancas, manos temblorosas en teclado | V.O.: «…memoriza la secuencia… sin morirse de nervios» | contador de tiempo visible |
| 4 | 12–17 s | Corte a P2 en el portal con 3 vecinos alrededor, bocadillos de queja; P2 gritando por VOZ «¡TRANQUIOS, QUE VA LA LUZ!» | voz real del canal del juego (micro cortado, distorsión cómica) | «…mientras su colega calma a la turba POR VOZ» |
| 5 | 17–24 s | Montaje rápido: fallo (chispazo, portal a oscuras) → grito de P1 → reintento | pitido del detector de fondo, risas | «intento 1: CHISPAZO 💥» |
| 6 | 24–29 s | Éxito: toast «⏱️ rearma el cuadro en X s — ¡mejor marca de la comunidad!» + abrazo en el pasillo del juego | CLA-CLAC (sonido del juego) + música sube | «CLA-CLAC ✅ +150 pts para cada uno» |
| 7 | 29–30 s | Corte negro con la fachada del edificio | V.O.: «Vecinos. En tu navegador. Por un enlace.» | «🔗 link en bio · sin instalar nada» |

*Gancho alternativo de los primeros 3 s (test A/B): grabar la pantalla con la secuencia de fusibles fallando y el texto «Mi colega tiene 6 segundos para salvar el edificio».*

### (b) «Le mando un link y ya está jugando» — invitación en 1 clic + voz (25 s)

| # | Tiempo | Plano | Audio/V.O. | Texto en pantalla |
|---|--------|-------|------------|-------------------|
| 1 | 0–3 s | Split screen: dos personas en SUAS casas, cada una con su portátil | V.O.: «¿Cómo se juega multijugador en un juego de navegador? Así:» | «sin launcher · sin cuenta · sin Discord» |
| 2 | 3–7 s | Pantalla del anfitrión: panel multijugador → botón «Copiar enlace» (?join=CODE) | clic satisfactorio | «1. Copiar enlace» |
| 3 | 7–11 s | WhatsApp real mandando el link al colega + respuesta «¿???» | sonido de mensaje | «2. Enviar por el grupo como toda la vida» |
| 4 | 11–16 s | Pantalla del invitado: aterriza en el juego CON el panel abierto y la tarjeta «Te han invitado» → un clic | V.O.: «un clic y ya está dentro» | «3. Un clic. Ya está. Ya es vecino.» |
| 5 | 16–21 s | El invitado aparece en el portal del edificio (toast «👥 {name} se muda a 3B. La comunidad crece (y el ruido también)») y se enciende el indicador de VOZ | la propia voz de ambos por el canal del juego | «🎙️ voz integrada, sin instalar nada» |
| 6 | 21–25 s | Los dos en la misión co-op «Operación goteo»: uno con la manivela, otro de paraguas humano ante la puerta del 2C | risa real + música | «co-op real: fontanero arriba, paraguas abajo 🌂🔧» + «link en bio» |

### (c) «Cosas que pasan en mi comunidad de vecinos» — absurdo del catálogo (35–40 s)

*Formato listicle rápido, cada «cosa» es un plano de gameplay real + una frase del juego. El ritmo manda: 4–5 s por cosa.*

| # | Tiempo | «Cosa que pasa» | Plano del juego | Texto en pantalla (frase real del juego) |
|---|--------|-----------------|-----------------|------------------------------------------|
| 1 | 0–4 s | «La inmobiliaria te miente (con cariño)» | diálogo de bienvenida | «Piso luminoso, tranquilo y sin historial... oficialmente.» |
| 2 | 4–9 s | «La lavadora de la de abajo» | goteo en el techo del salón, cubo en el suelo | «La lavadora de Esperanza hace "su vida". El techo de tu salón también empieza a hacer la suya.» |
| 3 | 9–14 s | «El detector de humo que no calla» | rellano, pitido, Kevin con resaca al teléfono | «Mi resaca tiene voz nueva.» — solución real: toalla y cinta aislante |
| 4 | 14–19 s | «Las cucarachas se organizan» | minijuego Exterminio vecinal 🪳 (¡no toques las telas! 🕸️) | «Las cucarachas te han visto. Y, por lo que sea, se han organizado.» |
| 5 | 19–25 s | «La junta vota tu vida» | votación de la espuma acústica | «Espuma acústica de la buena (y del color que elijan en votación). 280 € de caja.» |
| 6 | 25–30 s | «El okupa del 2A» | Nando con el taladro | «Técnicamente el piso está en venta, pero yo digo que la venta está en mí.» |
| 7 | 30–36 s | «La serenata que se movió» | Tomás el músico, multa de 60 € | «Tomás toca ahora SOLO para su pared.» |
| 8 | 36–40 s | Cierre | fachada entera de noche, todas las ventanas | «Todo esto pasa en TU navegador. Link en bio. Sin instalar nada.» |

*Consejo de montaje: en vertical, subtítulos grandes siempre (80% ve sin sonido), y el sonido del juego (CLA-CLAC, pitido, taladro) SIN tapar — es el personaje.*

---

## 5. Posts para Reddit/Discord (honestos, sin spam)

> Regla de oro en Reddit: primero persona, luego promo. El gancho de cada post es un
> APRENDIZAJE técnico o de diseño real del desarrollo, no el juego. Responde TODOS los
> comentarios. Flair correcto en cada sub. Si el sub prohíbe enlaces, deja el preview en
> comentarios cuando lo pidan.

### 5.1 r/IndieDev — título + cuerpo

**Título:** «Hice un sim de vecindario multijugador en el navegador (Next.js + Babylon.js): 6 aprendizajes de llevar un simulación determinista a multijugador con voz P2P»

**Cuerpo:**
> Llevo X meses en VECINOS, un simulador de vecindario cómico 2.5D (estética de diorama, humor de comunidad de vecinos española: derramas, juntas, okupas con taladro). Es un prototipo jugable: [preview]. Hoy quiero compartir lo que aprendí, que es lo que de verdad me habría ahorrado semanas:
>
> 1. **Un núcleo de sim determinista y seedeado es el mejor amigo del multijugador.** El mundo corre con semilla fija por escenario: los clientes reproducen el mismo estado desde los mismos comandos. El servidor no difunde el mundo; difunde COMANDOS y eventos. Menos ancho de banda y menos desyncs.
> 2. **Servidor autoritativo reutilizando el MISMO núcleo.** El mini-servicio (Bun + socket.io) importa literalmente el mismo módulo de simulación que el cliente (paths de tsconfig). Cero duplicación de reglas = cero «en mi máquina sí funciona». El actor de cada comando lo sobrescribe el servidor, siempre.
> 3. **El co-op honesto se diseña con ROLES, no con «estás en la misma sala».** Nuestra misión de apagón tiene dos objetivos paralelos que se necesitan: uno repara el cuadro (minijuego), el otro calma a los vecinos en el portal. Si tu «co-op» es ver al otro jugar, no es co-op.
> 4. **La sesión debe ser protegible contra el caos de pestañas.** Rate limit de puntuación (3 s), récords imposibles fuera de sesión, reconexión transparente (`session:rejoin` re-vincula el mismo residente tras caída de red o pestaña en segundo plano). La gente juega con el móvil en la mano: asume desconexiones.
> 5. **Voz P2P sin servidor de audio es viable y barata.** Solo la señalización (offer/answer/ICE dirigida por residentId) pasa por el servidor; el audio va de navegador a navegador en malla. Detalles que importan: orden determinista de la oferta (quien tiene ID menor la crea, evitas «glare»), y caer a pista sintética si no hay micro para que el modo escucha no rompa la topología.
> 6. **Todo data-driven (misiones/textos/minijuegos en JSON con schemas zod) convierte a tu comunidad en guionistas.**Validamos el contenido con zod al cargar; un JSON roto no tumba el juego, avisa y sale limpio. Y nos deja correr campañas de «propón tu misión» sin tocar código.
>
> Preguntas honestas: ¿os interesa un post profundo sobre la sincronización del sim, o sobre el pipeline de arte 2.5D? El prototipo: [preview]. Crítica dura bienvenida.

### 5.2 r/WebGames — título + cuerpo

**Título:** «Prototipo jugable: sim de vecindario multijugador 100% en el navegador — co-op por enlace (?join=CODE) con voz WebRTC integrada, sin instalar nada»

**Cuerpo:**
> Objetivo del post: que lo juguéis y me digáis dónde duele. No hay registro, no hay descarga: abres, juegas, y si quieres co-op, copias un enlace.
>
> Qué hay dentro del prototipo:
> - Sim de vecindario 2.5D (Babylon.js) con 49 misiones de un jugador con decisiones con consecuencias (economía, reputación, relaciones con 12+ arquetipos de vecino).
> - Multijugador: sesión con código, invitación por URL, hasta 4 jugadores con viviendas propias en el mismo edificio.
> - Co-op real de 2 roles (reparar el cuadro / calmar a la gente en el portal), duelos contrarreloj de minijuegos y marcador de sesión «Vecino del mes».
> - Canal de voz integrado (WebRTC P2P malla, solo señalización por el servidor).
>
> Decisiones técnicas que puedo defender (o retirar): render 2.5D sobre Babylon en vez de canvas 2D (queríamos profundidad real del edificio con coste de sprites), servidor autoritativo Bun + socket.io compartiendo el núcleo de sim con el cliente, y contenido 100% en JSON validado con zod.
>
> Lo que MÁS me interesa: tiempo hasta la primera misión completada sin tutorial, y si el «un clic y ya juegas con tu amigo» se siente así de rápido en tu máquina. [preview] — gracias por echarle un ojo.

### 5.3 r/gaming (es-ES) — título + cuerpo

**Título:** «Cansado de esperar al parche que arregle tu comunidad de vecinos, hice un juego donde la junta es el jefe final (prototipo gratis en el navegador)»

**Cuerpo:**
> Todo el mundo tiene SU historia de comunidad de vecinos: la lavadora de la de abajo, el vecino que ensaya batería de 20 a 22, la junta que discute 6 páginas qué es «urgente». Yo tenía tantas que hice un juego.
>
> VECINOS es un simulador cómico de vecindario que corre en el navegador (sin instalar, sin registro). Te mudas al 3C y te toca vivirlo: Dolores la Cotilla, Kevin el fiestero (dos volúmenes: fiesta y FESTIVAL), un okupa con opiniones sobre el mercado inmobiliario, y una junta con la última palabra en TODO.
>
> Cosas reales del prototipo (nada de humo):
> - Misiones con decisiones de verdad: ¿pagas el arreglo (250 €), convocas junta para votar la derrama, o «un cubo, fe y dos toallas (Dignidad −100)»?
> - Multijugador por ENLACE: le mandas un link a tu colega y ya está jugando en el edificio, con canal de voz integrado. Sin Discord, sin launcher.
> - Misiones co-op de dos roles y duelos de minijuegos contrarreloj con récord comunitario («⏱️ rearmó el cuadro en 4,2 s — ¡mejor marca de la comunidad!»).
>
> Es indie, está en desarrollo, y hay bugs. También hay cariño por cada nota de voz de la lavandería. Jugad y contadme vuestro peor vecino real: las mejores historias acaban en misiones (el juego es data-driven: las misiones son JSON y las vuestras pueden entrar). [preview]

### 5.4 Plantilla de post para Discord (servidores de indies y de gamedev ES/EN)

```
📢 [DEVLOG] VECINOS — sim de vecindario multijugador en el navegador (prototipo jugable)

Qué es: 2.5D + Babylon.js, humor de comunidad de vecinos (ES), co-op de 2 roles por
enlace ?join=CODE, voz WebRTC integrada, marcador «Vecino del mes». 100% data-driven
(misiones en JSON validado con zod).

Lo nuevo (v1.56): co-op real + canal de voz del vecindario. Un jugador repara el
cuadro de fusibles; el otro calma a los vecinos en el portal. Por voz. Sin instalar nada.

Busco: 2-4 personas para una partida de prueba de 15 min + feedback del onboarding
(cuánto tardáis en completar la primera misión).

Jugar: [URL-PREVIEW] · Repo: [URL-GITHUB]
```

---

## 6. Ideas de clips virales (5 micro-momentos con potencial meme)

Todos son momentos REALES del juego (verificados en contenido y logs). Cada clip: 15–30 s, gameplay limpio + la frase del juego como subtítulo. La gracia está en que la frase YA es un meme: solo hay que grabarla en el momento justo.

1. **«La junta rechaza la espuma acústica»** — Llevas a junta la insonorización del 1C («espuma acústica de la buena (y del color que elijan en votación), 280 € de caja»), y los vecinos IA votan según SU afinidad y SU sesgo: la propuesta cae. *Montaje: propuesta en pantalla → pausa dramática → recuento de votos → «RECHAZADA» → zoom a la cara del jugador.* Potencial: cualquier persona que haya pedido algo en junta se siente vista. Variantes infinitas (la derrama del 3B, los detectores «Silencio 3000»).

2. **«El detector que no calla»** — El guiso de Dolores activa el detector del rellano. Pita. PITA. Desde las tres. Soluciones del juego: minijuego del cuadro… o «silenciarlo a lo bruto: una toalla y cinta aislante. Solución de vecinos, patentada». *Montaje: pitido real (del juego) a volumen creciente → la toalla → silencio → plano de Kevin al teléfono con la resaca: «Mi resaca tiene voz nueva».* Potencial: sonido = memoria. El pitido es el nuevo «wi-fi caído».

3. **«La derrama»** — Presidir es decidir quién paga lo que se rompe: la tubería del 3B elige tu semana. Convocas junta, apruebas la derrama de 400 €… y «dos vecinos votan que el agua "no es cosa de todos"». *Montaje: goteo del techo con música épica → votos → acta de «tres páginas de discusión sobre qué es urgente» → tu cartera.* Potencial: la derrama es el miedo universal español. Etiqueta oro: #derrama.

4. **«La serenata que se movió»** — Tomás el músico toca a deshoras. Opciones: mediar (toca de 20:00 a 22:00 y «la comunidad recauda una propina artística») o multa (60 €: «Tomás toca ahora SOLO para su pared»). *Montaje: guitarra alegre → multa → silencio y guitarra triste apagada en off.* Potencial: formato «dos caminos» perfecto para duetos/stitches («yo habría multado», «yo medié y salió el disco»).

5. **«El duelo de fusibles en 4,2 s»** — Nuestro récord E2E real: «⏱️ {name} rearmó el cuadro en 4,2 s — ¡mejor marca de la comunidad!». *Montaje: cronómetro en pantalla, secuencia de palancas a velocidad inhumana, CLA-CLAC, toast de récord, reacción del rival por VOZ.* Potencial: reto replicable y medible — el formato «bate mi marca» se auto-propaga (duetos, rankings, clip del rival rompiendo el 4,2 s). Es el único clip que SÍ debería repetirse cada semana con el récord nuevo.

---

## 7. Hashtags y momentos de publicación

### 7.1 Hashtags

**ES (X/TikTok/Reels):** `#Vecinos` `#indiedev` `#indiegamedev` `#gamedev` `#comunidadDeVecinos` `#derrama` `#juntaDeVecinos` `#hechoEnEspaña` `#indieEspañol` `#prototipo` `#jugandoEnElNavegador` `#derramasYVotaciones` *(tags de conversación española con tráfico real: usar 2 grandes + 2 nicho por post, nunca spam de 20 tags)*

**EN (X/Reddit/TikTok global):** `#indiedev` `#gamedev` `#indiegame` `#webgame` `#browsergame` `#indiegames` `#screenshotsaturday` `#WishlistWednesday` *(cuando haya página de tienda)* `#coopgames` `#madewithbabylon` `#nextjs` *(cross-over dev Twitter: cada post técnico nos trae a los que luego proponen misiones)*

**Etiquetas de conversación (sin hashtag, para buscar hilos donde responder):** «mi comunidad de vecinos», «mi peor vecino», «derrama», «owners meeting horror stories», «HOA», «neighbor from hell».

### 7.2 Mejores momentos de publicación

| Canal | Mejor hora (España, CET) | Notas |
|---|---|---|
| X/Twitter ES | Mar–Jue 10:00–12:00 y 19:00–21:00 | El hueco de 19–21 h captura al «tuiteo con la cena»; #screenshotsaturday sáb por la mañana (EN) |
| TikTok/Reels/Shorts | 13:00–15:00 y 21:00–23:00 | El clip de «vecino tóxico» funciona mejor de noche (público gaming); «cosas de mi comunidad» a la hora de la siesta/comida |
| Reddit | Mar–Jue 09:00–11:00 CET (r/IndieDev, r/WebGames son mayoritariamente EN/US: 14:00–17:00 CET ≈ mañana US) | Postear y QUEDARSE 2 h respondiendo comentarios; los mods de r/IndieDev agradecen feedback dado, no solo pedido |
| Discord | 18:00–22:00 entre semana; domingo tarde para devlogs | Devlog en servidores de gamedev EN domingo ~19:00 CET; test de partidas en servidores ES jueves/viernes 20:00 |

**Comunidades objetivo:** r/IndieDev, r/WebGames, r/gamedev, r/incremental_games (no es incremental, pero hay solape de navegador), r/gaming es-ES y r/es_gaming, r/Espana y r/askSpain (hilos de vecinos: RESPONDER con humor, sin spam), Discord de Babylon.js y Next.js (gancho técnico), servidores de indies españoles (DevHour, GameDev.es), TikTok/IG: público «humor español» + «gaming ligero».

---

## 8. Plan de lanzamiento en 3 fases

### FASE 1 — TEASER (semana −2 a semana 0): «el edificio existe»

- **Objetivo:** que la frase y el edificio sean reconocibles antes de pedir nada.
- Acciones: 3 posts X/IG con el tono puro del juego ( fachada de noche + «El edificio ya no es lo que era. Era mejor.» · el pitido del detector como audio standalone · la nota de la lavandería). Sin link jugable aún, o con «si quieres, te dejo entrar: DM».
- TikTok (a): el clip del detector que no calla. ES primero; si pega >X views, doblaje EN.
- Devlog en Discord propio (crear servidor el día 1 de fase: es el embudo para la Fase 3).
- **Métrica de paso a Fase 2:** ≥300 interacciones sumadas en la semana + lista de 20 personas «quiero probarlo» (DM/Discord).

### FASE 2 — ACCESO ANTICIPADO / PREVIEW LINK (semana 0–4): «un enlace y ya eres vecino»

- **Objetivo:** primeras sesiones multijugador REALES de gente ajena al proyecto + capturas/UGC crudo.
- Acciones: hilo X completo (sección 3) con el link de preview · post r/IndieDev (learnings) y r/WebGames (feedback) en semanas distintas · el clip (b) «le mando un link y ya está jugando» como anuncio del multijugador · **sesiones guiadas**: 2 tardíos fijos (jueves y domingo 20:00) donde nosotros abrimos sala y la gente entra con enlace desde el Discord; grabamos TODO (con permiso) para Fase 3.
- Cada jugador nuevo recibe el «reto del 4,2 s»: bate la marca de fusibles y te clipsamos el momento. El récord se anuncia en X cada semana («⏱️ esta semana la marca ha bajado a X s»).
- **Métrica de paso a Fase 3:** ≥25 personas distintas jugadas, ≥5 sesiones co-op completas con desconocidos, ≥3 clips usables de jugadores reales.

### FASE 3 — UGC: «CREA TU PROPIA MISIÓN CO-OP» (semana 4+): «la comunidad escribe el acta»

- **Objetivo:** convertir a los jugadores en guionistas. El juego es 100% data-driven: misiones, textos, roles co-op y recompensas viven en JSON (`public/content/missions.json`, `multiplayer.json`, `minigames.json`). Una misión propuesta = una PR con JSON validado por schemas zod. Sin tocar código.
- Mecánica: **concurso mensual «Vecino del mes: guionista»** — plantilla pública de misión (formato exacto de `missions.json`: título, breve, pasos, decisiones con efectos, toasts con el tono de la casa), 3 misiones ganadoras entran al juego oficial con el nombre del autor en los créditos y una «placa en el portal» in-game. La misión ganadora co-op entra en `multiplayer.json` con sus DOS roles.
- Contenido de apoyo: tutorial «tu primera misión en 15 minutos (JSON incluido)» · hilo X explicando el pipeline (content → zod → juego) · clips (c) actualizados con misiones de la comunidad.
- Requisito previo honesto: repo público o fork público de contenido + guía de contribución de 1 página (solo JSON, sin builds) y validación automática en PR (zod ya existe: es un script de CI barato).
- **Métrica:** ≥10 misiones propuestas/mes, ≥3 fusionadas, retención de autores (¿vuelven a jugar SU misión?).

---

## 9. CTA y enlaces

- **▶️ Jugar (preview):** `[URL-PREVIEW]` — *(placeholder: sustituir por la URL pública de Caddy; comprobar que el servidor de sesión en el puerto 3010 está arriba antes de publicar NADA).*
- **💻 Repo GitHub:** `[URL-GITHUB]` — *(placeholder: el respaldo se configura con `scripts/backup-github.sh`; hasta que exista remoto, los posts de Reddit/Mastodon anuncian el preview y prometen el repo — NO prometer repo público si no lo es).*
- **📣 Discord de la comunidad:** `[URL-DISCORD]` — *(crear en Fase 1; canal #reto-fusibles para el récord semanal).*
- **Cómo invitar a alguien en 10 segundos (el CTA que hay que grabar en cada vídeo):**
  1. Abre VECINOS → panel Multijugador → «Copiar enlace» (URL con `?join=CODE`).
  2. Pégalo al colega por WhatsApp, como toda la vida.
  3. Él hace clic, ve la tarjeta «Te han invitado», pulsa UNA vez… y ya está dentro del edificio, con voz.
- **CTA estándar de cierre (ES):** «Juega gratis en el navegador: [preview]. Si sobrevives a una junta, cuéntamela.»
- **CTA estándar de cierre (EN):** *«Play free in your browser: [preview]. If you survive an owners' meeting, tell me about it.»*

---

## 10. Métricas de éxito y checklist previo al post

### 10.1 Métricas de éxito (por fase, medibles, sin vanity)

| Métrica | Fase 1 | Fase 2 | Fase 3 |
|---|---|---|---|
| Alcance (views acumuladas) | 10k | 50k | 150k |
| Sesiones únicas en preview | 25 | 100 | 300 |
| Jugadores que llegan a 1ª misión completada | ≥40% | ≥50% | ≥60% |
| Sesiones co-op (2+ jugadores reales) | — | 5 | 20/mes |
| «Reto 4,2 s»: récords batidos por jugadores externos | — | 5 | 15/mes |
| Propuestas de misión (JSON) | — | — | 10/mes |
| Conversaciones respondidas (no posting, RESPONDER) | 100% | 100% | 100% |
| Clips de jugadores reales capturados | 1 | 5 | continuo |

*Nota honesta: con un prototipo, la métrica reina es «¿vuelve alguien a jugar por segundo vez con un amigo?» — medir retención de invitados, no solo clics.*

### 10.2 Checklist ANTES de publicar cualquier post (copiar-pegar)

**Producto**
- [ ] Servidor de sesión arriba (puerto 3010 tras Caddy) y `dev.log` limpio.
- [ ] Preview probado en incognito + móvil: carga, primera misión, sin 404 de assets.
- [ ] Enlace con `?join=CODE` probado con 2 pestañas REALES (anfitrión + invitado) HOY.
- [ ] Canal de voz probado hoy (micrófono real, no QA): entra, se oye, se sale.
- [ ] El récord de fusibles que citas sigue siendo el récord (si batieron el 4,2 s, ACTUALIZA la cifra).
- [ ] Builds/versión anunciada = versión del banner (v1.56 hoy).

**Material**
- [ ] Capturas/GIF recientes y SIN datos de debug (¿qaengine? ¿HUD de QA visible? recortar).
- [ ] Clip grabado y revisado: subtítulos legibles en móvil, sonido del juego audible.
- [ ] Frases citadas = frases EXACTAS del JSON (no parafrasear el tono: el tono YA funciona).
- [ ] Placeholders `[URL-PREVIEW]`/`[URL-GITHUB]` sustituidos por URLs reales y probadas.

**Red/protocolo**
- [ ] Reglas del sub leídas HOY (flair, día de promo permitido, nº de enlaces).
- [ ] Cuenta con karma/participación previa en esa comunidad (primero persona, luego promo).
- [ ] Disponibilidad 2 h después de postear para responder TODO comentario.
- [ ] Plan B si el link cae: tweet de estado + servidor de Discord como punto de aviso.

---

*Cierre del kit: nada de esto funciona si el juego no es divertido en los primeros 60 segundos. El mejor marketing de VECINOS es que Dolores sepa demasiado y lo cuente.*
