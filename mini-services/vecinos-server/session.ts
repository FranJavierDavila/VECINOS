/**
 * VECINOS — modelo de sesión del servidor autoritativo.
 * Una sesión = un mundo del núcleo (createWorld de '@/game/sim') + participantes conectados
 * por socket. Cero datos de gameplay aquí: los números y textos salen de rules.multiplayer.
 */

export type Speed = 1 | 3 | 10;
export const SPEEDS = [1, 3, 10] as const;

/** Guard estricto para la velocidad recibida por el protocolo. */
export function isSpeed(v: unknown): v is Speed {
  return v === 1 || v === 3 || v === 10;
}

export interface Participant {
  socketId: string;
  /** Residente del mundo que controla (anfitrión = world.playerId; invitado = res_guest_N). */
  residentId: string;
  /** Nombre visible (nombre del arquetipo, del catálogo). */
  name: string;
  /** Vivienda asignada (id de bloque). */
  home: string;
  isHost: boolean;
}

export interface Session {
  code: string;
  scenarioId: string;
  world: import('@/game/core/types').World;
  /** Multiplicador de ticks por disparo del intervalo (solo lo cambia el anfitrión). */
  speed: Speed;
  /** Número de secuencia de los broadcast de estado. */
  seq: number;
  /** Minijuego pendiente de resolver (id del catálogo) o null. */
  pendingMinigame: string | null;
  /** Participantes conectados, indexados por socket.id. */
  participants: Map<string, Participant>;
  /** Contador de invitados creados en esta sesión (ids res_guest_N). */
  guestCounter: number;
  /** Bucle de tick de la sesión (setInterval de node). */
  timer: ReturnType<typeof setInterval>;
  /** Borrado diferido cuando la sesión se queda sin participantes. */
  cleanup: ReturnType<typeof setTimeout> | null;
}

/** Lista plana de participantes con el formato exacto del protocolo ({ id, name, home }). */
export function participantsList(session: Session): { id: string; name: string; home: string }[] {
  return [...session.participants.values()].map((p) => ({ id: p.residentId, name: p.name, home: p.home }));
}

/** 4 caracteres de A-Z2-9 sin 0/O/1/I, únicos entre las sesiones activas (Set o Map de sesiones). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateSessionCode(taken: { has(key: string): boolean }): string {
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  } while (taken.has(code));
  return code;
}
