/**
 * VECINOS — FASE N · AUTORIDAD DE SERVIDOR (netcode profesional).
 *
 * El movimiento fino (mp:pose) era un relay puro client-trusted (v1.57): cualquier cliente
 * podia teletransportarse. Aqui vive la validacion: velocidad maxima y velocidad de planta
 * contra la ULTIMA POSE ACEPTADA del residente, rate limit de comandos por socket, libro de
 * violaciones con ventana deslizante y el payload /health con metricas de desync.
 *
 * TODO umbral sale del catalogo (rules.multiplayer.authority): sin bloque authority el
 * servidor vuelve al relay puro (comportamiento v1.57). El sim determinista NO se toca.
 */
import type { Rules } from '@/game/core/types';
import type { Session } from './session';

export type AuthorityCfg = NonNullable<Rules['multiplayer']['authority']>;

/** Veredicto de una pose entrante. 'spam' = ritmo imposible (no cuenta como abuso grave). */
export interface PoseVerdict {
  ok: boolean;
  reason: 'spam' | 'teleport' | null;
}

/** Config del catalogo; null = autoridad apagada (relay puro, metricas basicas). */
export function authorityOf(rules: Rules): AuthorityCfg | null {
  const a = rules.multiplayer?.authority;
  return a && a.enabled ? a : null;
}

/**
 * Valida la pose entrante contra la traza previa del residente:
 *  - dt < minPoseIntervalMs → 'spam' (no re-ancla: el vecino queda donde estaba).
 *  - dt <= maxPoseGapMs     → chequeo de velocidad (m/s y plantas/s contra el catálogo).
 *  - dt >  maxPoseGapMs     → hueco de red/pestaña en segundo plano: reancla sin chequeo.
 * La traza SOLO avanza con poses aceptadas: el tramposo queda anclado a su última posición.
 */
export function validatePose(cfg: AuthorityCfg | null, session: Session, residentId: string, p: { x: number; z: number; floor: number }, now: number): PoseVerdict {
  session.metrics.posesIn += 1;
  const prev = session.poses.get(residentId);
  if (cfg && prev) {
    const dt = now - prev.at;
    if (dt < cfg.minPoseIntervalMs) {
      session.metrics.posesRejected += 1;
      return { ok: false, reason: 'spam' };
    }
    if (dt <= cfg.maxPoseGapMs) {
      const dtSec = dt / 1000;
      const v = Math.hypot(p.x - prev.x, p.z - prev.z) / dtSec;
      const vFloor = Math.abs(p.floor - prev.floor) / dtSec;
      if (v > cfg.maxSpeed || vFloor > cfg.maxFloorSpeed) {
        session.metrics.posesRejected += 1;
        return { ok: false, reason: 'teleport' };
      }
    }
  }
  session.poses.set(residentId, { x: p.x, z: p.z, floor: p.floor, at: now });
  return { ok: true, reason: null };
}

/**
 * Anota una violación ('teleport') en la ventana del residente. Devuelve true SOLO cuando
 * hay que expulsar (kickViolations > 0 y la ventana supera el umbral del catálogo).
 */
export function noteViolation(cfg: AuthorityCfg, session: Session, residentId: string, now: number): boolean {
  session.metrics.violations += 1;
  const windowMs = cfg.violationWindowSec * 1000;
  const book = session.violations.get(residentId);
  if (!book || now - book.windowStart > windowMs) {
    session.violations.set(residentId, { count: 1, windowStart: now });
    return false;
  }
  book.count += 1;
  return cfg.kickViolations > 0 && book.count >= cfg.kickViolations;
}

/** Rate limit de session:command por socket: ventana fija de 1 s (catálogo). */
export function allowCmd(cfg: AuthorityCfg | null, session: Session, socketId: string, now: number): boolean {
  session.metrics.cmdsIn += 1;
  if (!cfg) return true;
  const sec = Math.floor(now / 1000);
  const cur = session.cmdWindow.get(socketId);
  if (!cur || cur.sec !== sec) {
    session.cmdWindow.set(socketId, { sec, n: 1 });
    return true;
  }
  cur.n += 1;
  if (cur.n > cfg.maxCmdsPerSec) {
    session.metrics.cmdsRejected += 1;
    return false;
  }
  return true;
}

/** Anota el session:ack de un participante (resync confirmado) para las métricas de lag. */
export function noteAck(session: Session, socketId: string, residentId: string, seq: number, now: number): void {
  session.metrics.acksIn += 1;
  session.acks.set(socketId, { residentId, lastSeq: seq, at: now });
}

// ── /health — métricas de desync del vecindario (para humanos y para el watchdog) ──

export interface HealthPayload {
  ok: true;
  service: 'vecinos-server';
  uptimeSec: number;
  now: number;
  sessions: {
    code: string;
    scenarioId: string;
    seq: number;
    speed: number;
    participants: number;
    restored: boolean;
    scoreRows: number;
    coop: 'active' | 'idle';
    voice: number;
    metrics: Session['metrics'];
    ackLag: { max: number; avg: number };
    acks: { residentId: string; lastSeq: number; lag: number; ageMs: number }[];
  }[];
  totals: {
    sessions: number;
    participants: number;
    posesIn: number;
    posesRejected: number;
    violations: number;
    cmdsRejected: number;
  };
}

export function buildHealth(sessions: Map<string, Session>, uptimeMs: number): HealthPayload {
  const now = Date.now();
  const list = [...sessions.values()].map((s) => {
    const acks = [...s.acks.values()].map((a) => ({
      residentId: a.residentId,
      lastSeq: a.lastSeq,
      lag: s.seq - a.lastSeq,
      ageMs: now - a.at,
    }));
    const max = acks.length ? Math.max(...acks.map((a) => a.lag)) : 0;
    const avg = acks.length ? acks.reduce((t, a) => t + a.lag, 0) / acks.length : 0;
    return {
      code: s.code,
      scenarioId: s.scenarioId,
      seq: s.seq,
      speed: s.speed,
      participants: s.participants.size,
      restored: s.restoredAt !== undefined,
      scoreRows: s.scores.size,
      coop: (s.coop.activeIdx >= 0 ? 'active' : 'idle') as 'active' | 'idle',
      voice: s.voice.size,
      metrics: { ...s.metrics },
      ackLag: { max, avg: Math.round(avg * 100) / 100 },
      acks,
    };
  });
  return {
    ok: true,
    service: 'vecinos-server',
    uptimeSec: Math.round(uptimeMs / 1000),
    now,
    sessions: list,
    totals: {
      sessions: list.length,
      participants: list.reduce((t, s) => t + s.participants, 0),
      posesIn: list.reduce((t, s) => t + s.metrics.posesIn, 0),
      posesRejected: list.reduce((t, s) => t + s.metrics.posesRejected, 0),
      violations: list.reduce((t, s) => t + s.metrics.violations, 0),
      cmdsRejected: list.reduce((t, s) => t + s.metrics.cmdsRejected, 0),
    },
  };
}
