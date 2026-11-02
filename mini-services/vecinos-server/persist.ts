/**
 * VECINOS — FASE N · PERSISTENCIA DE SESIONES del servidor autoritativo.
 *
 * El servidor muere (deploy, caída, reinicio del sandbox) y sus sesiones morían con él:
 * el vecino que volvía a los 10 s encontraba 'unknown_code'. Ahora cada sesión se
 * fotografía a disco (mundo incluido: el World ya cruza el cable como JSON en cada
 * session:state, así que es serializable por diseño) y al arrancar se REVIVE dentro de
 * su TTL: el session:rejoin del cliente encuentra la partida EXACTA donde estaba.
 *
 * Qué viaja: mundo, seq, velocidad, marcador, co-op, voz y el ROSTER de participantes
 * (con socketId centinela `restored:<residentId>`: el rejoin del socket nuevo sustituye
 * 1:1 al fantasma). Qué NO viaja: sockets (muertos), timers (se re-arma el anfitrión) y
 * gracia (se vuelve a ganar).
 *
 * Escritura ATÓMICA (tmp + rename) cada 5 s y en el cierre limpio. Snapshot más viejo que
 * RESTORE_MAX_AGE_MS no se revive (mundo huérfano). Ruta de infraestructura: /tmp del
 * sandbox (mismo criterio que el log del servicio), no contenido del juego.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { World } from '@/game/core/types';
import type { Session, Speed } from './session';
import { freshMetrics } from './session';

/** Ruta del snapshot (infraestructura del servicio, igual que /tmp/vecinos-server.log). */
export const PERSIST_PATH = '/tmp/vecinos-sessions.json';
/** Un snapshot más viejo que esto no se revive: mejor una partida nueva que un fantasma. */
export const RESTORE_MAX_AGE_MS = 30 * 60 * 1000;
/** Prefijo del socketId centinela de los participantes restaurados. */
export const RESTORED_SOCKET_PREFIX = 'restored:';

/** Sesión en reposo (lo que cruza el disco; contraste con session.ts en memoria). */
export interface PersistedSession {
  v: 2;
  code: string;
  scenarioId: string;
  savedAt: number;
  world: World;
  speed: Speed;
  seq: number;
  guestCounter: number;
  pendingMinigame: string | null;
  participants: { socketId: string; residentId: string; name: string; home: string; isHost: boolean }[];
  scores: [string, { points: number; best: Record<string, number>; name?: string }][];
  lastMinigame: { id: string; actor: string; at: number } | null;
  lastRecordAt: [string, number][];
  coop: {
    activeIdx: number;
    assignments: [string, { residentId: string; name: string; done: boolean }][];
    done: string[];
    lastOfferAt: number;
  };
  voice: [string, { socketId: string; muted: boolean; speaking: boolean }][];
}

export interface PersistedFile {
  v: 2;
  savedAt: number;
  sessions: PersistedSession[];
}

/** Fotografía las sesiones vivas (participants incluidos: el rejoin los necesita). */
export function snapshotSessions(sessions: Map<string, Session>): PersistedFile {
  return {
    v: 2,
    savedAt: Date.now(),
    sessions: [...sessions.values()].map((s) => ({
      v: 2 as const,
      code: s.code,
      scenarioId: s.scenarioId,
      savedAt: Date.now(),
      world: s.world,
      speed: s.speed,
      seq: s.seq,
      guestCounter: s.guestCounter,
      pendingMinigame: s.pendingMinigame,
      participants: [...s.participants.values()].map((p) => ({ ...p })),
      scores: [...s.scores.entries()].map(([id, r]) => [id, { ...r, best: { ...r.best } }] as PersistedSession['scores'][number]),
      lastMinigame: s.lastMinigame ? { ...s.lastMinigame } : null,
      lastRecordAt: [...s.lastRecordAt.entries()],
      coop: {
        activeIdx: s.coop.activeIdx,
        assignments: [...s.coop.assignments.entries()].map(([id, a]) => [id, { ...a }] as PersistedSession['coop']['assignments'][number]),
        done: s.coop.done.slice(),
        lastOfferAt: s.coop.lastOfferAt,
      },
      voice: [...s.voice.entries()].map(([id, v]) => [id, { ...v }] as PersistedSession['voice'][number]),
    })),
  };
}

/**
 * Reconstruye la sesión desde el disco: todo el ESTADO vuelve, ningún RUNTIME (timer a
 * null — el anfitrión lo re-arma tras revivir; sin sockets ni gracia).
 */
export function hydrateSession(saved: PersistedSession): Session {
  const speed: Speed = saved.speed === 3 || saved.speed === 10 ? saved.speed : 1;
  const session: Session = {
    code: saved.code,
    scenarioId: saved.scenarioId,
    world: saved.world,
    speed,
    seq: saved.seq,
    pendingMinigame: saved.pendingMinigame,
    participants: new Map(),
    guestCounter: saved.guestCounter,
    timer: null,
    cleanup: null,
    scores: new Map(saved.scores),
    lastMinigame: saved.lastMinigame ? { ...saved.lastMinigame } : null,
    lastRecordAt: new Map(saved.lastRecordAt),
    coop: {
      activeIdx: saved.coop.activeIdx,
      assignments: new Map(saved.coop.assignments),
      done: saved.coop.done.slice(),
      lastOfferAt: saved.coop.lastOfferAt,
    },
    voice: new Map(saved.voice),
    grace: new Map(),
    // FASE N — runtime de autoridad fresco: las trazas de pose del disco no valen (milis).
    poses: new Map(),
    cmdWindow: new Map(),
    violations: new Map(),
    metrics: freshMetrics(),
    acks: new Map(),
    restoredAt: Date.now(),
  };
  for (const p of saved.participants) {
    session.participants.set(p.socketId.startsWith(RESTORED_SOCKET_PREFIX) ? p.socketId : `${RESTORED_SOCKET_PREFIX}${p.residentId}`, { ...p });
  }
  return session;
}

/** Escritura atómica: tmp + rename (un crash a medias nunca deja el JSON cortado). */
export function writePersistedFile(file: PersistedFile, path: string = PERSIST_PATH): void {
  try {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(file));
    renameSync(tmp, path);
  } catch (e) {
    console.error('persist: no se pudo escribir el snapshot:', e instanceof Error ? e.message : e);
  }
}

/** Lee el snapshot del disco; null si no existe o está corrupto (arrancar limpio es válido). */
export function readPersistedFile(path: string = PERSIST_PATH): PersistedFile | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PersistedFile;
    return parsed?.v === 2 && Array.isArray(parsed.sessions) ? parsed : null;
  } catch {
    return null;
  }
}
