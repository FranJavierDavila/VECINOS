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
  // ── v1.55 — MARCADOR «VECINO DEL MES» (todo el criterio vive en rules.multiplayer.score) ──
  /** Puntos y mejores marcas por residente (sobrevive a reconexiones; el nombre se congela). */
  scores: Map<string, { points: number; best: Record<string, number>; name?: string }>;
  /** Último resultado de minijuego recibido (guardia anti-spam de marcas de tiempo). */
  lastMinigame: { id: string; actor: string; at: number } | null;
  /** Última marca aceptada por participante (rate limit del duelo de fusibles). */
  lastRecordAt: Map<string, number>;
  // ── v1.56 — MISIONES COOPERATIVAS (catálogo rules→content.multiplayer.coop) ──
  coop: {
    /** Índice de la misión activa en el catálogo (-1 = ninguna activa). */
    activeIdx: number;
    /** Asignación por roleId (solo roles de la misión activa; null = libre). */
    assignments: Map<string, { residentId: string; name: string; done: boolean }>;
    /** Ids de misiones co-op ya completadas (no se repiten hasta agotar el catálogo). */
    done: string[];
    /** Instante (ms) de la última oferta/completado: gobierna el cooldown del catálogo. */
    lastOfferAt: number;
  };
  // ── v1.56 — CANAL DE VOZ (WebRTC P2P; aquí SOLO se reenvía la señalización) ──
  /** Residentes en el canal, con su estado de micro (el audio va P2P, nunca por el servidor). */
  voice: Map<string, { socketId: string; muted: boolean; speaking: boolean }>;
  // ── v1.56 — GRACIA DE RECONEXIÓN: participante cuyo socket murió; purga diferida ──
  /** residentId → timer de purga (30 s). Si rejoin llega antes, se cancela. */
  grace: Map<string, ReturnType<typeof setTimeout>>;
}

/** Lista plana de participantes con el formato exacto del protocolo ({ id, name, home }). */
export function participantsList(session: Session): { id: string; name: string; home: string }[] {
  return [...session.participants.values()].map((p) => ({ id: p.residentId, name: p.name, home: p.home }));
}

/** Fila del marcador con el formato exacto del protocolo session:score. */
export interface ScoreRow {
  residentId: string;
  name: string;
  points: number;
  /** Mejor marca por minijuego del catálogo (segundos, 1 decimal). */
  best: Record<string, number>;
  /** true si es el «Vecino del mes» (mayor puntuación; empate → orden alfabético). */
  top: boolean;
}

/**
 * Construye el marcador de la sesión: participantes conectados + filas de quien puntuó y
 * se fue (su nombre se congela con el que tenía al salir). «Top» = más puntos; sin
 * puntos nadie luce corona (el vecindario empieza limpio de cuentas).
 */
export function scoreRows(session: Session): ScoreRow[] {
  const nameOf = (id: string): string =>
    session.scores.get(id)?.name ?? [...session.participants.values()].find((x) => x.residentId === id)?.name ?? id;
  const ids = new Set<string>([...session.scores.keys(), ...[...session.participants.values()].map((p) => p.residentId)]);
  const rows: ScoreRow[] = [...ids]
    .map((residentId) => {
      const s = session.scores.get(residentId);
      return { residentId, name: nameOf(residentId), points: s?.points ?? 0, best: s?.best ?? {}, top: false };
    })
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  const top = rows.find((r) => r.points > 0);
  if (top) top.top = true;
  return rows;
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
