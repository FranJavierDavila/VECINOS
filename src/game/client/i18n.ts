'use client';

/**
 * Localización del chrome de UI (pulido Steam): ES/EN para la interfaz (cabecera, botones,
 * paneles, opciones). El CONTENIDO del juego (misiones, diálogos, cutscenes) se mantiene en
 * el idioma en que fue escrito en /content/*.json — el seam para traducirlo en el futuro es
 * este mismo catálogo ampliado con claves de contenido.
 *
 * Persistencia: `lang` vive dentro de las mismas opciones que volumen/calidad (localStorage).
 * El sim nunca se entera: traducir no toca gameplay.
 */

import { useGameStore } from './store';
import type { Lang } from './options';

export type { Lang } from './options';

export const LANGUAGES: ReadonlyArray<{ value: Lang; label: string }> = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
];

/** Diccionario plano: clave → { es, en }. El español es el idioma de origen del proyecto. */
const DICT: Record<string, { es: string; en: string }> = {
  // ── Cabecera / pie ──
  'header.subtitle': {
    es: 'Mudanzas, ruido, olores, wifi, plagas, humo y derramas: el simulador de vecindario.',
    en: 'Move-ins, noise, smells, wifi, pests, smoke and levies: the neighborhood simulator.',
  },
  'header.version': { es: 'v1.81 · tejado que gotea, borracho de madrugada y cartas ilegales', en: 'v1.81 · leaky roof, midnight drunk & illegal cards' },
  // ── Apagón de assets (v1.47: servidor de arte caído → mundo vacío/cápsulas) ──
  'assets.outage': {
    es: '⚠ No se pudo cargar el arte del juego (¿servidor caído?). El vecindario se recargará en {n} s…',
    en: '⚠ Game art could not load (server down?). The neighborhood will reload in {n} s…',
  },
  // ── Post-its (v1.23: mandos agrupados dibujados a bolígrafo) ──
  'postit.time': { es: 'Tiempo', en: 'Time' },
  'postit.options': { es: 'Opciones', en: 'Options' },
  'postit.game': { es: 'Partida', en: 'Game' },
  'postit.help': { es: 'Ayuda', en: 'Help' },
  'postit.players': { es: 'Jugadores', en: 'Players' },
  'postit.cameras': { es: 'Cámara', en: 'Camera' },
  'postit.openPanel': { es: 'Abrir panel', en: 'Open panel' },
  // ── v1.65: MENÚ acordeón + postit de cámara con teclas + selector de espiado ──
  'postit.menu': { es: 'MENÚ', en: 'MENU' },
  'postit.menuAria': { es: 'Menú del juego: tiempo, opciones, partida, ayuda y multijugador', en: 'Game menu: time, options, game, help and multiplayer' },
  'ctrl.cam.espia': { es: 'Espía', en: 'Spy' },
  'ctrl.camTooltip': { es: 'Teclas: 1 Estancia · 2 Planta · 3 Edificio · 4 Fachada · 5 Espía (otra vez 5: siguiente vecino)', en: 'Keys: 1 Room · 2 Floor · 3 Building · 4 Facade · 5 Spy (press 5 again: next neighbor)' },
  'ctrl.camSpyPick': { es: 'Espiar a…', en: 'Spy on…' },
  'ctrl.camSpyHere': { es: 'Sigue a {name}', en: 'Follows {name}' },
  'ev.spyFollow': { es: '🎥 Cámara espía: siguiendo a {name}', en: '🎥 Spy cam: following {name}' },
  'ev.spyNone': { es: '🎥 Cámara espía: no hay vecinos presentes ahora mismo', en: '🎥 Spy cam: no neighbors around right now' },
  // ── Economía siempre visible (v1.23) ──
  'money.funds': { es: 'Arcas {n} €', en: 'Funds {n} €' },
  'money.wallet': { es: 'Hucha {n} €', en: 'Piggy {n} €' },
  'money.fundsAria': { es: 'Arcas del edificio: {n} euros', en: 'Building funds: {n} euros' },
  'money.walletAria': { es: 'Tu hucha: {n} euros', en: 'Your piggy bank: {n} euros' },
  // ── Mi casa: mobiliario 3D retirado por dioramas (v1.23) ──
  'casa.retired': { es: 'El mobiliario 3D está de reforma: los interiores se pintan ahora con dioramas de billboards (paredes, suelos y muebles ilustrados con paralaje). La colocación de muebles volverá cuando la nueva técnica esté afinada.', en: "3D furniture is under rework: interiors are now painted with billboard dioramas (illustrated walls, floors and furniture with parallax). Furniture placement will return once the new technique is polished." },
  'hud.campaign': { es: '{label} · Día {d}/{n}', en: '{label} · Day {d}/{n}' },
  // v1.55 — chip del marcador de comunidad (HudBar)
  'hud.mpScore': { es: '🏅 {name} lidera ({top} pts) · tú {mine}', en: '🏅 {name} leads ({top} pts) · you {mine}' },
  'hud.mpScoreAria': { es: 'Marcador de la comunidad: vecino del mes', en: 'Community scoreboard: neighbor of the month' },
  'hud.mpCoop': { es: '🤝 {title}', en: '🤝 {title}' },
  'hud.mpCoopAria': { es: 'Misión cooperativa activa', en: 'Active co-op mission' },
  'hud.mpVoice': { es: '🎙️ Voz ({n})', en: '🎙️ Voice ({n})' },
  'hud.mpVoiceAria': { es: 'Canal de voz del vecindario', en: 'Neighborhood voice channel' },
  'hud.campaignAria': { es: 'Días de mandato restantes', en: 'Days of your term remaining' },
  'hud.campaignOver': { es: '{label} · Día {d}/{n} · ¡juzgado pronto!', en: '{label} · Day {d}/{n} · judged soon!' },
  'footer.text': {
    es: 'VECINOS · prototipo jugable — sim determinista (1 tick = 1 minuto) + render Babylon.js (WebGPU/WebGL2) + editor con drag & drop + catálogo de minijuegos + guardado en SQLite. Construyéndolo por hitos, juntos.',
    en: 'VECINOS · playable prototype — deterministic sim (1 tick = 1 minute) + Babylon.js rendering (WebGPU/WebGL2) + drag & drop editor + minigame catalog + SQLite saves. Built milestone by milestone, together.',
  },

  // ── ControlsBar ──
  'ctrl.resume': { es: 'Reanudar', en: 'Resume' },
  'ctrl.pause': { es: 'Pausa', en: 'Pause' },
  'ctrl.pauseAria': { es: 'Reanudar la simulación', en: 'Resume the simulation' },
  'ctrl.pauseAriaOn': { es: 'Pausar la simulación', en: 'Pause the simulation' },
  'ctrl.speedGroup': { es: 'Velocidad de simulación', en: 'Simulation speed' },
  'ctrl.speedAria': { es: 'Velocidad {s}', en: 'Speed {s}' },
  'ctrl.camGroup': { es: 'Modo de cámara', en: 'Camera mode' },
  'ctrl.cam.edificio': { es: 'Edificio', en: 'Building' },
  'ctrl.cam.fachada': { es: 'Fachada', en: 'Facade' },
  'ctrl.cam.planta': { es: 'Planta', en: 'Floor' },
  'ctrl.cam.estancia': { es: 'Estancia', en: 'Room' },
  'ctrl.camAria': { es: 'Cámara: {c}', en: 'Camera: {c}' },
  'ctrl.party': { es: 'Fiesta demo', en: 'Demo party' },
  'ctrl.partyTitle': { es: 'Activa la fiesta del 2B para ver el ruido', en: 'Start the 2B party to see the noise' },
  'ctrl.partyAria': { es: 'Fiesta demo del 2B', en: '2B demo party' },
  'ctrl.skip': { es: '+10 min', en: '+10 min' },
  'ctrl.skipAria': { es: 'Avanzar 10 minutos', en: 'Advance 10 minutes' },
  'ctrl.save': { es: 'Guardar', en: 'Save' },
  'ctrl.saveAria': { es: 'Guardar partida', en: 'Save game' },
  'ctrl.saveTitle': { es: 'Guardar partida', en: 'Save game' },
  'ctrl.saveTitleSaving': { es: 'Guardando...', en: 'Saving...' },
  'ctrl.saveTitleSaved': { es: 'Partida guardada a las {t}', en: 'Game saved at {t}' },
  'ctrl.load': { es: 'Cargar', en: 'Load' },
  'ctrl.loadAria': { es: 'Cargar partida', en: 'Load game' },
  'ctrl.touch': { es: 'Táctil', en: 'Touch' },
  'ctrl.touchShow': { es: 'Mostrar mandos táctiles', en: 'Show touch controls' },
  'ctrl.touchHide': { es: 'Ocultar mandos táctiles', en: 'Hide touch controls' },
  'ctrl.soundOn': { es: 'Sonido', en: 'Sound' },
  'ctrl.soundOff': { es: 'Silencio', en: 'Muted' },
  'ctrl.soundAriaOn': { es: 'Activar sonido', en: 'Unmute' },
  'ctrl.soundAriaOff': { es: 'Silenciar', en: 'Mute' },
  'ctrl.options': { es: 'Opciones', en: 'Options' },
  'ctrl.optionsAria': { es: 'Abrir opciones del juego', en: 'Open game options' },
  'ctrl.multiplayer': { es: 'Multijugador', en: 'Multiplayer' },
  'ctrl.multiAria': { es: 'Abrir panel de multijugador', en: 'Open multiplayer panel' },

  // ── HUD ──
  'hud.day': { es: 'Día {d}', en: 'Day {d}' },
  'hud.clockAria': { es: 'Reloj del edificio', en: 'Building clock' },
  'hud.weatherAria': { es: 'Clima: {w}', en: 'Weather: {w}' },
  'hud.fundsAria': { es: 'Fondos de la comunidad', en: 'Community funds' },
  'hud.walletAria': { es: 'Tu cartera', en: 'Your wallet' },
  'hud.repAria': { es: 'Reputación en el vecindario', en: 'Neighborhood reputation' },
  'hud.elevOk': { es: 'Ascensor operativo', en: 'Elevator working' },
  'hud.elevBroken': { es: 'Ascensor fuera de servicio', en: 'Elevator out of service' },

  // ── Panel del ascensor (v1.9) ──
  'elev.title': { es: '¿A qué planta?', en: 'Which floor?' },
  'elev.subtitle': { es: 'Elige destino: la cabina vendrá a por ti.', en: 'Pick a destination: the cabin will come for you.' },
  'elev.floor': { es: 'Planta {n}', en: 'Floor {n}' },
  'elev.floorAria': { es: 'Ir a la planta {n}', en: 'Go to floor {n}' },
  'elev.here': { es: 'estás aquí', en: 'you are here' },
  'elev.cancel': { es: 'Cancelar', en: 'Cancel' },
  'elev.unreachable': { es: 'El ascensor no llega hasta esa planta.', en: 'The elevator does not reach that floor.' },
  'door.vacant': { es: 'Nadie vive ahí: no puedes entrar en una vivienda vacía.', en: 'Nobody lives there: you cannot enter an empty home.' },
  'door.lockedGeneric': { es: 'Puerta con candado: no puedes pasar.', en: 'Locked door: you cannot enter.' },
  // ── v1.40 — timbre, charla y linterna ──
  'door.noAnswer': {
    es: '🔔 Timbre sonado… y silencio. No hay nadie dentro que pueda abrir.',
    en: '🔔 Doorbell rung… and silence. Nobody inside to answer it.',
  },
  // v1.64 — timbre EN VIVO (multijugador): el dueño oye SU timbre cuando un vecino llama.
  'ev.someoneAtDoor': {
    es: '🔔 ¡Timbre! Alguien llama a tu puerta.',
    en: '🔔 Doorbell! Someone is at your door.',
  },
  'chat.fallback': { es: '¡Buenas! ¿Todo en orden por aquí?', en: 'Hey! All quiet around here?' },
  'lost.title': {
    es: 'Se fue la luz del portal (y del navegador)',
    en: 'The lights went out — in the lobby and in the browser',
  },
  'lost.text': {
    es: 'El navegador nos quitó el motor gráfico (suele pasar por memoria, o con la pestaña en segundo plano). Tu partida está a salvo: recarga y sigues donde estabas.',
    en: 'The browser took the graphics engine away (usually memory, or a backgrounded tab). Your save is safe: reload and carry on where you were.',
  },
  'lost.reload': { es: 'Encender las luces (recargar)', en: 'Lights back on (reload)' },
  // ── v1.40 — avisos del sim que antes vivían en duro (ahora EN/ES por clave) ──
  'ev.doorLocked': { es: 'puerta con candado', en: 'locked door' },
  'ev.forSale': { es: '(a la venta por {n} €)', en: '(for sale for €{n})' },
  'ev.neighborArrived': { es: 'Nuevo vecino en {block}: {name}', en: 'New neighbor in {block}: {name}' },
  'ev.neighborArrivedLog': {
    es: '{name} se muda a {block}. El edificio ya no es lo que era. Era mejor.',
    en: '{name} moves into {block}. The building is not what it used to be. It was better.',
  },
  'ev.missionDone': { es: 'Misión completada: {m}', en: 'Mission complete: {m}' },
  'ev.missionDoneLog': { es: '✔ Misión completada: {m}', en: '✔ Mission complete: {m}' },
  'ev.missionFailed': { es: 'Misión fallida: {m}', en: 'Mission failed: {m}' },
  'ev.missionFailedLog': { es: '✘ Misión fallida: {m}', en: '✘ Mission failed: {m}' },
  'ev.blockUnlocked': { es: '{block} desbloqueado', en: '{block} unlocked' },
  'ev.rentCollected': { es: '+{n} € de alquiler ({block})', en: '+€{n} rent collected ({block})' },
  'ev.workDone': {
    es: '💻 Cerrada una "reunión que podía ser un correo": +{n} €',
    en: '💻 Closed a "meeting that could have been an email": +€{n}',
  },
  'ev.juntaPresidentOnly': {
    es: 'Solo la presidencia convoca juntas. De momento, eres un vecino más (con suerte).',
    en: 'Only the presidency calls meetings. For now, you are just another neighbor (good luck).',
  },
  'ev.juntaCooldown': {
    es: 'Juana dice que la última junta fue hace poco. Próxima disponible en {n} min. La democracia necesita descansos.',
    en: 'Juana says the last meeting was recent. Next slot in {n} min. Democracy needs rest.',
  },
  // ── v1.41 — AVISOS del controlador, todos por el diccionario (nada de castellano en código) ──
  'ev.contentInvalid': { es: 'Contenido inválido: {n} errores de validación', en: 'Invalid content: {n} validation errors' },
  'ev.juntaConvocada': { es: '🗳️ Junta extraordinaria convocada desde el tablón. Los vecinos, en camino.', en: '🗳️ Extraordinary meeting called from the noticeboard. Neighbors on their way.' },
  'ev.soloResumed': { es: 'Has vuelto a tu partida en solitario.', en: 'Back to your solo game.' },
  'ev.autoRejoined': { es: '👥 De vuelta a la comunidad: tu partida compartida te esperaba.', en: '👥 Back in the community: your shared session was waiting for you.' },
  'ev.authorityKick': { es: '🚨 Expulsado de la comunidad: el servidor detectó movimiento imposible (teletransportes).', en: '🚨 Kicked from the community: the server detected impossible movement (teleports).' },
  'ev.saved': { es: 'Partida guardada. El acta queda en el tablón (y en SQLite).', en: 'Game saved. The minutes are on the noticeboard (and in SQLite).' },
  'ev.saveFailed': { es: 'No se pudo guardar la partida. ¿El administrador se habrá ido a comer?', en: 'Could not save the game. Perhaps the administrator went out for lunch?' },
  'ev.noSave': { es: 'Todavía no hay ninguna partida guardada.', en: 'There is no saved game yet.' },
  'ev.contentLoading': { es: 'El contenido todavía se está cargando. Espera un momento.', en: 'Content is still loading. Give it a moment.' },
  'ev.loaded': { es: 'Partida cargada. El vecindario, exactamente como lo dejaste.', en: 'Game loaded. The neighborhood, exactly as you left it.' },
  'ev.loadFailed': { es: 'No se pudo cargar la partida.', en: 'Could not load the game.' },
  'ev.juntaPending': { es: '⚖️ Decisión pendiente: {t}', en: '⚖️ Decision pending: {t}' },
  // ── v1.79 — capa social: charla con tema y cotilleo de pasillo ──
  'talk.title': { es: '¿De qué habláis?', en: 'What shall you talk about?' },
  'talk.hint': {
    es: 'Cada tema sienta distinto según el vecino: la charla buena sube su confianza, la pifia la baja.',
    en: "Each topic lands differently per neighbor: a good chat raises their trust, a dud lowers it.",
  },
  'talk.cooldown': { es: 'Ya habláis bastante por ahora: al vecino le falta aire.', en: "That's enough chatting for now: your neighbor needs some air." },
  'toast.trustUp': { es: '{name} confía más en ti (+{n})', en: '{name} trusts you more (+{n})' },
  'toast.trustDown': { es: '{name} confía menos en ti (−{n})', en: '{name} trusts you less (−{n})' },
  'ev.talk': { es: '🗣️ Charla con {name} sobre {topic}.', en: '🗣️ Chatted with {name} about {topic}.' },
  'ev.gossip': { es: '🗣️ {a} y {b} cotillean en el pasillo', en: '🗣️ {a} and {b} gossip in the corridor' },
  // ── v1.80 — protesta por apagón (idea #3) ──
  'ev.protestRing': { es: '{name} timbra tu puerta: protesta por el apagón (abre con E)', en: '{name} is ringing your door: blackout protest (open with E)' },
  'ev.protestCalm': { es: '🤝 Protesta calmada: la luz volverá. El vecino agradece que abrieras.', en: '🤝 Protest calmed: the lights will return. Your neighbor thanks you for opening.' },
  'ev.protestTired': { es: '📣 La protesta por el apagón termina: {name} se vuelve a su casa.', en: '📣 The blackout protest ends: {name} heads back home.' },
  'ev.protestLog': { es: '📣 Protesta vecinal por el apagón en el pasillo.', en: '📣 Blackout protest brewing in the corridor.' },
  // ── v1.81 — tejado (idea #4): tormenta → daño → goteo → reparación ──
  'ev.roofDamaged': { es: '⛈️ La tormenta ha destrozado el tejado. La planta alta, en cuclillas.', en: '⛈️ The storm wrecked the roof. The top floor is bracing.' },
  'ev.roofDamagedLog': { es: '⛈️ Tejado dañado ({block}): goteo en los áticos hasta repararlo.', en: '⛈️ Roof damaged ({block}): top-floor leaks until repaired.' },
  'ev.roofLeak': { es: '💧 Gotea sobre {block}: humedad {n}/100. El cubo hace horas extra.', en: '💧 Dripping over {block}: damp {n}/100. The bucket works overtime.' },
  'ev.roofRepaired': { es: '🔧 Tejado reparado ({n} € de la hucha a las arcas). Los áticos respiran (y secan).', en: '🔧 Roof repaired (€{n} from your piggy to the funds). The attics breathe (and dry).' },
  'ev.roofRepairedLog': { es: '🔧 Tejado reparado por {n} €: el goteo cesa en la planta alta.', en: '🔧 Roof repaired for €{n}: the top-floor leak stops.' },
  'ev.roofPoor': { es: '🔧 No llega para el tejado ({n} €): el portátil sigue pagando a plazos.', en: '🔧 Short for the roof (€{n}): the laptop keeps paying in installments.' },
  // ── v1.81 — borracho (idea #5): regreso nocturno con tambaleo ──
  'ev.drunkStarted': { es: '🥴 {name} vuelve… elocuente esta noche. Y zigzagueante.', en: '🥴 {name} is back… unusually eloquent tonight. And zigzagging.' },
  'ev.drunkFumble': { es: '🥴 {name} farolea ante SU puerta. La llave, nerviosa.', en: '🥴 {name} fumbles at THEIR door. The key is nervous.' },
  'ev.drunkHome': { es: '🥴 {name} consigue entrar en casa. El sofá, en guardia.', en: '🥴 {name} made it inside. The couch braces for impact.' },
  // ── v1.81 — juego ilegal (idea #6): mesas nocturnas, visitas y redadas ──
  'ev.gambleNight': { es: '🃏 «Reunión de vecinos» en {block}: la mesa de {name} ya está abierta.', en: '🃏 "Neighbors meeting" at {block}: {name}\u2019s table is open.' },
  'ev.gambleVisit': { es: '🃏 {name} sube a casa de {host}. A «ver un cuadro».', en: '🃏 {name} heads up to {host}\u2019s place. To "see a painting".' },
  'ev.gambleRaid': { es: '🚨 Redada en la mesa de {name}: multa de {n} €. Las arcas agradecen.', en: '🚨 Raid on {name}\u2019s table: €{n} fine. The funds say thanks.' },
  'ev.gambleOver': { es: '🃏 Se acabó la partida de {name}: cada cual a su cama.', en: '🃏 {name}\u2019s card game is over: everyone to bed.' },
  'ev.missionNew': { es: '📋 Nueva misión: {m}', en: '📋 New mission: {m}' },
  'ev.blockBought': { es: '🔑 {block} comprado por {price} €', en: '🔑 {block} bought for €{price}' },
  'ev.forSaleSign': { es: '🪧 Cartel de "SE VENDE" en {block} ({price} €)', en: '🪧 "FOR SALE" sign on {block} (€{price})' },
  'ev.asleepSay': { es: '😴 {name}: «{line}»', en: '😴 {name}: “{line}”' },
  'ev.greetSay': { es: '🗣️ {name}: «{line}»', en: '🗣️ {name}: “{line}”' },
  'ev.noiseOver': { es: '🔊 Ruido por encima del límite en {block}. Alguien aprieta los dientes.', en: '🔊 Noise above the limit in {block}. Someone is gritting their teeth.' },
  'ev.leak': { es: '💧 Goteo detectado en {block}. El cubo del salón hace ojitos.', en: '💧 Leak detected in {block}. The living-room bucket is batting its eyes.' },
  'ev.furniturePlaced': { es: '{e} {name} colocado en {block} ({room}).', en: '{e} {name} placed in {block} ({room}).' },
  'ev.furnitureRemoved': { es: '{e} {name} retirado de {block} (+{n} €).', en: '{e} {name} removed from {block} (+€{n}).' },
  'ev.roomRenovated': { es: '🧱 Reforma terminada en {block}. Hay estancia nueva que amueblar.', en: '🧱 Renovation finished in {block}. A new room awaits furniture.' },
  'ev.weatherChange': { es: 'El cielo cambia: {state}', en: 'The sky is changing: {state}' },
  'ev.activity': { es: '{n} {a}', en: '{n} is {a}' },
  'ev.voteCast': { es: '🗳️ {name} ha depositado su voto. Pendientes: {n}', en: '🗳️ {name} has cast their vote. Pending: {n}' },
  'ev.minigameWin': { es: '🎮 Minijuego superado: {m}', en: '🎮 Minigame cleared: {m}' },
  'ev.minigameLose': { es: '🎮 Minijuego fallido: {m}', en: '🎮 Minigame failed: {m}' },
  'hud.homeAria': { es: 'Tu piso', en: 'Your flat' },
  'weather.sunny': { es: 'Soleado', en: 'Sunny' },
  'weather.cloudy': { es: 'Nublado', en: 'Cloudy' },
  'weather.rain': { es: 'Lluvia', en: 'Rain' },
  'weather.storm': { es: 'Tormenta', en: 'Storm' },

  // ── Cuaderno del vecino (v1.62 — dock de información como pestañas post-it) ──
  // Fuera "Mi casa" (nota conservada dentro de Edificio) y fuera "Ayuda" (duplicada
  // del post-it superior). Claves legacy dock.tab.home / dock.tab.help retiradas.
  'dock.title': { es: 'Cuaderno del vecino', en: "Neighbor's notebook" },
  'dock.toggleHint': { es: 'Pulsa para abrir o plegar', en: 'Click to open or fold' },
  'dock.hint': { es: 'Pulsa otra vez la pestaña activa para plegar el cuaderno.', en: 'Click the active tab again to fold the notebook.' },
  'dock.tab.missions': { es: 'Misiones', en: 'Missions' },
  'dock.tab.building': { es: 'Edificio', en: 'Building' },
  'dock.tab.neighbors': { es: 'Vecinos', en: 'Neighbors' },
  'dock.tab.achievements': { es: 'Logros', en: 'Achievements' },
  // ── v1.65: panel sobre el escenario (postits con pase de hoja + alertas) ──
  'dock.close': { es: 'Cerrar el panel', en: 'Close the panel' },
  'dock.alertAria': { es: '{n} novedades en {tab}', en: '{n} updates in {tab}' },
  'dock.alert': { es: '¡Novedades!', en: 'New stuff!' },
  // ── v1.66: banner de MÁXIMA PRIORIDAD (misión/logro/decisión imposible de ignorar) ──
  'banner.missionNew': { es: 'NUEVA MISIÓN', en: 'NEW MISSION' },
  'banner.missionDone': { es: '¡MISIÓN CONSEGUIDA!', en: 'MISSION COMPLETED!' },
  'banner.missionFailed': { es: 'MISIÓN FALLIDA', en: 'MISSION FAILED' },
  'banner.decision': { es: '¡DECISIÓN PENDIENTE!', en: 'DECISION REQUIRED!' },
  'banner.achievement': { es: '¡LOGRO DESBLOQUEADO!', en: 'ACHIEVEMENT UNLOCKED!' },
  'banner.open': { es: 'Abrir', en: 'Open' },
  'banner.openAria': { es: 'Abrir {tab} para ver el detalle', en: 'Open {tab} to see details' },
  'banner.dismiss': { es: 'Cerrar aviso', en: 'Dismiss notice' },
  'banner.aria': { es: 'Aviso importante: {t}', en: 'Important notice: {t}' },
  'missions.page.active': { es: 'En curso', en: 'In progress' },
  'missions.page.archive': { es: 'Archivo', en: 'Archive' },
  'missions.archiveEmpty': { es: 'Aún no hay misiones terminadas.', en: 'No finished missions yet.' },
  'ach.page.unlocked': { es: 'Conseguidos', en: 'Unlocked' },
  'ach.page.locked': { es: 'Por lograr', en: 'To unlock' },
  'ach.unlockedEmpty': { es: 'Todavía ningún logro conseguido. ¡A por ellos!', en: 'No achievements yet. Go get them!' },
  'ach.lockedEmpty': { es: '¡Todos los logros conseguidos!', en: 'All achievements unlocked!' },
  'edificio.page.params': { es: 'Parámetros', en: 'Parameters' },
  'edificio.page.log': { es: 'Registro', en: 'Log' },
  'edificio.page.project': { es: 'Proyecto', en: 'Project' },
  'pager.prev': { es: 'Página anterior', en: 'Previous page' },
  'pager.next': { es: 'Página siguiente', en: 'Next page' },
  'pager.pageAria': { es: 'Página {n} de {total}', en: 'Page {n} of {total}' },

  // ── v1.39 — Vecinos como personajes ──
  'neighbors.empty': { es: 'El vecindario se está mudando… pronto habrá fichas.', en: 'The neighborhood is moving in… profiles coming soon.' },
  'neighbors.moving': { es: 'en camino', en: 'on the way' },
  'neighbors.affinity': { es: 'Afinidad contigo', en: 'Affinity with you' },
  'neighbors.trust': { es: 'Confianza', en: 'Trust' },
  'neighbors.tastes': { es: 'Le gusta', en: 'Likes' },
  'neighbors.unknown': { es: 'sin conocer', en: 'not met yet' },
  'neighbors.home': { es: 'Vive en', en: 'Lives at' },

  // ── v1.39 — Proyecto del edificio (meta de largo plazo) ──
  'project.goal.missions': { es: 'misiones', en: 'missions' },
  'project.goal.funds': { es: 'arcas', en: 'funds' },
  'project.goal.reputation': { es: 'reputación', en: 'reputation' },
  'project.completed': { es: 'proyecto completado', en: 'project completed' },
  'project.goalsAria': { es: 'Objetivos del nivel en curso', en: 'Current level goals' },

  // ── v1.39 — Menú de pausa ──
  'pause.title': { es: 'Menú de pausa', en: 'Pause menu' },
  'pause.gamePaused': { es: 'Partida en pausa', en: 'Game paused' },
  'pause.subtitle': { es: 'El vecindario contiene la respiración.', en: 'The neighborhood is holding its breath.' },
  'pause.resume': { es: 'Reanudar', en: 'Resume' },
  'pause.options': { es: 'Opciones', en: 'Options' },
  'pause.exit': { es: 'Guardar y salir', en: 'Save & quit' },
  'pause.exitFallback': {
    es: 'Partida guardada. Cierra la pestaña cuando quieras (tu navegador decide si deja).',
    en: 'Game saved. Close the tab whenever you like (your browser decides if it lets you).',
  },
  'pause.hint': { es: 'Escape o Start del mando abren y cierran este menú.', en: 'Escape or the gamepad Start button open and close this menu.' },

  // ── v1.39 — Tutorial «primer día» ──
  'tutorial.aria': { es: 'Tutorial del primer día', en: 'First-day tutorial' },
  'tutorial.stepOf': { es: 'Paso {n} de {total}', en: 'Step {n} of {total}' },
  'tutorial.skip': { es: 'omitir', en: 'skip' },

  // ── Tracker de misión (v1.17) ──
  'tracker.noMission': { es: 'Sin misión activa', en: 'No active mission' },
  'tracker.active': { es: '{n} en curso', en: '{n} in progress' },
  'tracker.decisions': { es: '{n} decisión(es) pendiente(s)', en: '{n} pending decision(s)' },

  // ── v1.39 — objetivo y HUD (antes hardcodeados en el controlador) ──
  'obj.awaiting': {
    es: 'El edificio contiene la respiración. Decide qué hacer.',
    en: 'The building is holding its breath. Decide what to do.',
  },
  'obj.remaining': { es: ' · quedan {n} min', en: ' · {n} min left' },
  'obj.phone': { es: 'Suena el teléfono. Atiéndelo.', en: 'The phone is ringing. Answer it.' },
  'obj.reach': { es: 'Llega a la puerta ({b}).', en: 'Get to the door ({b}).' },
  'obj.enter': { es: 'Entra en tu piso con E.', en: 'Enter your flat with E.' },
  'obj.catch': { es: 'Pilla al responsable in fraganti', en: 'Catch the culprit red-handed' },
  'hud.remaining': { es: 'quedan {n} min', en: '{n} min left' },
  'hud.travel': { es: 'del portal a tu puerta: {n} min', en: 'from lobby to your door: {n} min' },

  // ── Logros tipo Steam (v1.17) ──
  'ach.title': { es: 'Logros', en: 'Achievements' },
  'ach.progress': { es: '{x} / {y}', en: '{x} / {y}' },
  'ach.done': { es: 'logrado', en: 'unlocked' },
  'ach.doneCount': { es: '{n} logrados', en: '{n} unlocked' },
  'ach.lockedCount': { es: '{n} por descubrir', en: '{n} to discover' },
  'ach.hiddenName': { es: '???', en: '???' },
  'ach.hiddenDesc': { es: 'Logro oculto', en: 'Hidden achievement' },
  'ach.empty': {
    es: 'El tablón de logros está vacío: el presidente guardó las placas en un trastero.',
    en: 'The achievements board is empty: the president locked the plaques in a storage unit.',
  },
  'ach.popupTitle': { es: '¡Logro desbloqueado!', en: 'Achievement unlocked!' },

  // ── Paneles ──
  'obj.title': { es: 'Objetivo', en: 'Objective' },
  'obj.empty': {
    es: 'Sin misiones activas. Disfruta del edificio... pronto sonará algo.',
    en: 'No active missions. Enjoy the building... something will ring soon.',
  },
  'missions.title': { es: 'Misiones', en: 'Missions' },
  'missions.empty': { es: 'Todavía nada en el tablón.', en: 'Nothing on the noticeboard yet.' },
  'missions.state.pending': { es: 'programada', en: 'scheduled' },
  'missions.state.active': { es: 'en curso', en: 'in progress' },
  'missions.state.awaiting': { es: '¡decide!', en: 'decide!' },
  'missions.state.done': { es: 'completada', en: 'completed' },
  'missions.state.failed': { es: 'fallida', en: 'failed' },
  'params.title': { es: 'Tu piso · {home}', en: 'Your flat · {home}' },
  'params.empty': {
    es: 'Los inspectores aún no han pasado por aquí.',
    en: 'The inspectors have not been around yet.',
  },
  'log.title': { es: 'Registro del vecindario', en: 'Neighborhood log' },
  'log.empty': { es: 'El vecindario está extrañamente tranquilo...', en: 'The neighborhood is strangely quiet...' },

  // ── Ayuda ──
  'help.title': { es: 'Controles', en: 'Controls' },
  'help.move': { es: 'Moverte por la planta', en: 'Move around the floor' },
  'help.vertical': { es: 'Subir y bajar: en la escalera o en el ascensor', en: 'Go up and down: stairs or elevator' },
  'help.interact': { es: 'Entrar, salir y usar cosas cercanas', en: 'Enter, exit and use nearby things' },
  'help.cams': { es: 'Cámara: estancia / planta / edificio / fachada / espía', en: 'Camera: room / floor / building / facade / spy' },
  'help.dialog': { es: 'Avanzar los diálogos del teléfono', en: 'Advance phone dialogues' },
  'help.note1': {
    es: 'El tiempo corre solo: 1 segundo real = 1 minuto de juego (x1). Las fiestas de Kevin empiezan a las 21:30. Tú fuiste advertido.',
    en: 'Time runs on its own: 1 real second = 1 game minute (x1). Kevin\'s parties start at 21:30. You were warned.',
  },
  'help.note2': {
    es: 'Nuevo: ARRASTRA muebles del catálogo al plano (clic largo en móvil), minijuegos nuevos (secuencias, reflejos y parejas) y los canales plagas 🐜 y humo 💨: el guiso quemado de Dolores sube pisos y la fiesta de Kevin baja cucarachas. Todo data-driven, sin tocar código.',
    en: 'New: DRAG furniture from the catalog onto the plan (long press on mobile), new minigames (sequences, reflexes, pairs) and the pests 🐜 and smoke 💨 channels: Dolores\'s burnt stew climbs floors and Kevin\'s party drops cockroaches. All data-driven, zero code.',
  },

  // ── Opciones ──
  'opt.title': { es: 'Opciones', en: 'Options' },
  'opt.desc': {
    es: 'Se aplican al momento y quedan guardadas para tus próximas visitas.',
    en: 'Applied instantly and saved for your next visits.',
  },
  'opt.sound': { es: 'Sonido', en: 'Sound' },
  'opt.volume': { es: 'Volumen maestro', en: 'Master volume' },
  'opt.volumeAria': { es: 'Volumen maestro del juego', en: 'Game master volume' },
  'opt.mute': { es: 'Silenciar todo', en: 'Mute everything' },
  'opt.muteAria': { es: 'Silenciar el juego', en: 'Mute the game' },
  'opt.graphics': { es: 'Gráficos', en: 'Graphics' },
  'opt.quality': { es: 'Calidad de render', en: 'Render quality' },
  'opt.quality.alta': { es: 'Alta — resolución nativa', en: 'High — native resolution' },
  'opt.quality.normal': { es: 'Normal — equilibrada', en: 'Normal — balanced' },
  'opt.quality.eco': { es: 'Eco — máxima fluidez', en: 'Eco — max smoothness' },
  'opt.qualityHelp': { es: 'Baja la resolución interna a cambio de fluidez.', en: 'Lowers internal resolution in exchange for smoothness.' },
  'opt.fps': { es: 'Contador de FPS', en: 'FPS counter' },
  'opt.fpsAria': { es: 'Mostrar contador de FPS', en: 'Show FPS counter' },
  'opt.language': { es: 'Idioma de la interfaz', en: 'Interface language' },
  'opt.languageAria': { es: 'Idioma de la interfaz', en: 'Interface language' },
  'opt.languageHelp': {
    es: 'El chrome de la interfaz se traduce al momento. Las misiones y diálogos se escriben en su idioma original.',
    en: 'The UI chrome switches instantly. Missions and dialogues are written in their original language.',
  },
  'opt.gamepadLine': {
    es: 'Mando: stick/cruceta mueve · A interactúa · Y cambia cámara · Start pausa',
    en: 'Gamepad: stick/d-pad moves · A interacts · Y switches camera · Start pauses',
  },
  'opt.backend': { es: 'Render: {b}', en: 'Render: {b}' },
  // ── v1.38 — pase de optimización: auto-ajuste de rendimiento ──
  'opt.perfAuto': { es: 'Auto-ajuste de rendimiento', en: 'Adaptive performance' },
  'opt.perfAutoAria': { es: 'Activar el auto-ajuste de rendimiento', en: 'Enable adaptive performance' },
  'opt.perfAutoHelp': {
    es: 'Mide los FPS y ajusta sombras, brillo y resolución para cumplir el objetivo. Nunca toca la partida.',
    en: 'Measures FPS and tunes shadows, glow and resolution to hit the target. Never touches the save.',
  },
  'opt.perfTarget': { es: 'Objetivo de FPS', en: 'FPS target' },
  'opt.perfTargetAria': { es: 'Objetivo de FPS que el auto-ajuste garantiza', en: 'FPS target the optimizer guarantees' },
  'opt.perf.max': { es: 'Máximo rendimiento', en: 'Max performance' },
  'opt.perf.60': { es: '60 FPS', en: '60 FPS' },
  'opt.perf.45': { es: '45 FPS', en: '45 FPS' },
  'opt.perf.30': { es: '30 FPS (mínimo garantizado)', en: '30 FPS (guaranteed minimum)' },
  'opt.perf.status': { es: 'Rendimiento: {n} FPS · {s}', en: 'Performance: {n} FPS · {s}' },
  'opt.perf.statusManual': { es: 'Auto-ajuste desactivado — manda tu calidad elegida', en: 'Adaptive off — your chosen quality rules' },
  'opt.perf.level.0': { es: 'calidad completa', en: 'full quality' },
  'opt.perf.level.1': { es: 'sombras cada 2 fotogramas', en: 'shadows every 2 frames' },
  'opt.perf.level.2': { es: 'sin halo de luces (glow off)', en: 'no light glow' },
  'opt.perf.level.3': { es: 'resolución reducida ×1.2', en: 'reduced resolution ×1.2' },
  'opt.perf.level.4': { es: 'resolución reducida ×1.4', en: 'reduced resolution ×1.4' },
  'opt.perf.level.5': { es: 'resolución ×1.65 · sombras cada 3', en: 'resolution ×1.65 · shadows every 3' },
  'opt.perf.level.6': { es: 'sin sombras', en: 'no shadows' },
  'opt.perf.level.7': { es: 'resolución ×1.95 · sin sombras', en: 'resolution ×1.95 · no shadows' },
  'opt.perf.level.8': { es: 'resolución mínima ×2.3 · sin sombras', en: 'min resolution ×2.3 · no shadows' },
  // ── v1.39 — música + accesibilidad ──
  'opt.music': { es: 'Música', en: 'Music' },
  'opt.musicAria': { es: 'Activar la música ambiental procedural', en: 'Enable the procedural ambient music' },
  'opt.musicHelp': {
    es: 'Banda sonora generada en vivo: cambia con la hora del día y suena lluvia cuando llueve.',
    en: 'Live-generated soundtrack: it changes with the time of day and rain plays when it rains.',
  },
  'opt.accessibility': { es: 'Accesibilidad', en: 'Accessibility' },
  'opt.textScale': { es: 'Tamaño de texto', en: 'Text size' },
  'opt.textScaleAria': { es: 'Tamaño del texto de toda la partida', en: 'Text size for the whole game' },
  'opt.textScale.small': { es: 'Pequeño', en: 'Small' },
  'opt.textScale.normal': { es: 'Normal', en: 'Normal' },
  'opt.textScale.large': { es: 'Grande', en: 'Large' },
  'opt.textScale.huge': { es: 'Enorme', en: 'Huge' },
  'opt.colorblind': { es: 'Modo daltónico', en: 'Colorblind mode' },
  'opt.colorblindAria': { es: 'Filtro de daltonismo sobre el juego', en: 'Colorblind filter over the game' },
  'opt.colorblind.off': { es: 'Desactivado', en: 'Off' },
  'opt.colorblind.protanopia': { es: 'Protanopía', en: 'Protanopia' },
  'opt.colorblind.deuteranopia': { es: 'Deuteranopía', en: 'Deuteranopia' },
  'opt.colorblind.tritanopia': { es: 'Tritanopía', en: 'Tritanopia' },
  'opt.reduceMotion': { es: 'Reducir animaciones', en: 'Reduce motion' },
  'opt.reduceMotionAria': { es: 'Reducir las animaciones de la interfaz', en: 'Reduce interface animations' },
};

/** Interpola {vars} simples sobre una plantilla. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** Hook de traducción: devuelve t() fija al idioma actual del store (re-renderiza al cambiar). */
export function useT(): TFn {
  const lang = useGameStore((s) => s.lang);
  return (key, vars) => translate(lang, key, vars);
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const entry = DICT[key];
  if (!entry) return key;
  return interpolate(entry[lang] ?? entry.es, vars);
}

export type TFn = (key: string, vars?: Record<string, string | number>) => string;
