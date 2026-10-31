'use client';

import { io, type Socket } from 'socket.io-client';
import type { Command, GameEvent, World } from '@/game/core/types';

// ───────────────────────── Tipos del protocolo de sesión v1 ─────────────────────────

/** Participante de una sesión (forma exacta de session:participants / session:joined). */
export interface MpParticipant {
  id: string;
  name: string;
  home: string;
}

/**
 * Ack de session:create / session:join. Las variantes positivas del contrato difieren
 * (join añade residentName y homeBlock), así que se tipan como opcionales aquí.
 */
export type HostJoinResult =
  | { ok: true; code: string; isHost: boolean; yourResidentId: string; scenarioId: string; residentName?: string; homeBlock?: string }
  | { ok: false; error: string };

/** S→C session:joined. */
export interface SessionJoinedPayload {
  code: string;
  isHost: boolean;
  yourResidentId: string;
  scenarioId: string;
  participants: MpParticipant[];
}

/** S→C session:state. */
export interface SessionStatePayload {
  seq: number;
  world: World;
  events: GameEvent[];
}

/** v1.55 — fila del marcador «Vecino del mes» (forma exacta de session:score.rows). */
export interface MpScoreRow {
  residentId: string;
  name: string;
  points: number;
  /** Mejor marca por minijuego (segundos, 1 decimal). */
  best: Record<string, number>;
  /** true = «Vecino del mes» (máxima puntuación de la sala). */
  top: boolean;
}

/** Transporte puro: 'connecting' (conectando/reconectando) → 'connected' → 'disconnected'. */
export type MpNetStatus = 'connecting' | 'connected' | 'disconnected';

export interface NetCallbacks {
  onState?: (s: SessionStatePayload) => void;
  onParticipants?: (participants: MpParticipant[]) => void;
  onJoined?: (payload: SessionJoinedPayload) => void;
  onScore?: (rows: MpScoreRow[]) => void;
  onError?: (message: string) => void;
  onStatus?: (status: MpNetStatus) => void;
}

/** Vencimiento del ack de create/join (patrón timeout de socket.io-client v4). */
const ACK_TIMEOUT_MS = 5000;

/**
 * URL de conexión. IGUAL que examples/websocket/frontend.tsx: el puerto SOLO vive en el
 * parámetro XTransformPort (lo reenvía Caddy); jamás en otra parte de la URL ni path distinto.
 */
const SERVER_URL = '/?XTransformPort=3010';

/** Guardia de forma del ack (el servidor puede responder variante create o join, o un error). */
function isHostJoinResult(v: unknown): v is HostJoinResult {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  if (r.ok === true) {
    return (
      typeof r.code === 'string' &&
      typeof r.isHost === 'boolean' &&
      typeof r.yourResidentId === 'string' &&
      typeof r.scenarioId === 'string'
    );
  }
  return r.ok === false && typeof r.error === 'string';
}

/**
 * Encapsula el socket de la sesión multijugador. SOLO transporte: emite comandos y reparte
 * los mensajes del servidor a los callbacks registrados; no decide nada del juego.
 * Cada instancia abre su propia conexión (forceNew, igual que el ejemplo de websocket).
 */
export class NetSession {
  private readonly socket: Socket;

  constructor(cbs: NetCallbacks = {}) {
    this.socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    // Estado de transporte (la UI decide qué pinta con ello).
    cbs.onStatus?.('connecting');
    this.socket.on('connect', () => cbs.onStatus?.('connected'));
    this.socket.io.on('reconnect_attempt', () => cbs.onStatus?.('connecting'));
    this.socket.on('disconnect', () => cbs.onStatus?.('disconnected'));
    // Mensajes de sesión (protocolo v1, formas exactas del contrato).
    this.socket.on('session:joined', (p: SessionJoinedPayload) => cbs.onJoined?.(p));
    this.socket.on('session:participants', (p: { participants: MpParticipant[] }) => cbs.onParticipants?.(p.participants));
    this.socket.on('session:state', (s: SessionStatePayload) => cbs.onState?.(s));
    // v1.55 — marcador «Vecino del mes» (el servidor lo difunde tras cada premio).
    this.socket.on('session:score', (p: { rows: MpScoreRow[] }) => cbs.onScore?.(Array.isArray(p?.rows) ? p.rows : []));
    this.socket.on('session:error', (p: { message: string }) => cbs.onError?.(p.message));
  }

  /** Crea una sesión compartida (el emisor queda como anfitrión). */
  hostSession(scenarioId?: string): Promise<HostJoinResult> {
    return this.request('session:create', { scenarioId });
  }

  /** Se une a una sesión existente por código. */
  joinSession(code: string): Promise<HostJoinResult> {
    return this.request('session:join', { code });
  }

  /** C→S session:command (sin ack; el servidor impone cmd.actor). */
  command(cmd: Command): void {
    this.socket.emit('session:command', { cmd });
  }

  /** v1.55 — DUELO DE MINIJUEGOS: marca de tiempo (s) de un rearme con éxito reciente. */
  minigameTime(id: string, secs: number): void {
    this.socket.emit('session:minigame_time', { id, secs });
  }

  /** C→S session:set_speed (solo surte efecto si el emisor es el anfitrión). */
  setSpeed(speed: 1 | 3 | 10): void {
    this.socket.emit('session:set_speed', { speed });
  }

  /** C→S session:leave (el servidor marca el residente ausente y avisa a la sala). */
  leave(): void {
    this.socket.emit('session:leave');
  }

  /** Cierra la conexión y suelta todos los listeners (no llegan más callbacks). */
  disconnect(): void {
    this.socket.removeAllListeners();
    this.socket.io.off('reconnect_attempt');
    this.socket.disconnect();
  }

  /** emit con ack y vencimiento: { ok:false, error:'timeout' } si el servidor no responde a tiempo. */
  private request(event: 'session:create' | 'session:join', payload: Record<string, unknown>): Promise<HostJoinResult> {
    return new Promise((resolve) => {
      this.socket.timeout(ACK_TIMEOUT_MS).emit(event, payload, (err: Error | null, res: unknown) => {
        if (err) {
          resolve({ ok: false, error: 'timeout' });
          return;
        }
        resolve(isHostJoinResult(res) ? res : { ok: false, error: 'timeout' });
      });
    });
  }
}
