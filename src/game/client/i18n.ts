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
  'header.version': { es: 'v1.16 · trasteros, bajocubierta y tejado', en: 'v1.16 · storage floors, attic & roof' },
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
  'hud.homeAria': { es: 'Tu piso', en: 'Your flat' },
  'weather.sunny': { es: 'Soleado', en: 'Sunny' },
  'weather.cloudy': { es: 'Nublado', en: 'Cloudy' },
  'weather.rain': { es: 'Lluvia', en: 'Rain' },
  'weather.storm': { es: 'Tormenta', en: 'Storm' },

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
  'help.cams': { es: 'Cámara: edificio / planta / estancia', en: 'Camera: building / floor / room' },
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
