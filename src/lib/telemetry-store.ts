/**
 * TELEMETRÍA DE VECINOS (v1.75, reconstruida) — almacén AUTOHOSPEDADO en memoria.
 *
 * Reconstrucción del sistema perdido en el rollback del sandbox (fuente v1.74, /tmp vacío).
 * Diseño (notas de la sesión anterior):
 *   - STORE ACOTADO: nada crece sin techo — buffer circular de eventos, mapa de errores
 *     por huella con máximo de entradas, mapa de sesiones con expulsión por antigüedad.
 *   - BUFFER CIRCULAR: los últimos N eventos siempre a mano (los viejos se caen).
 *   - HUELLA FNV-1A: los errores se deduplican por `name|message` (recortado) — un error
 *     que se repite 400× no ocupa 400 filas, sube su contador (los 437× de `nodeOf` del
 *     rollback eran exactamente este caso).
 *   - SNAPSHOT ATÓMICO: cada ingestado escribe /tmp/vecinos-telemetry.json (tmp + rename)
 *     para que el watchdog/QA lo lea sin ver un JSON a medias. Debounced: como mucho una
 *     escritura por segundo.
 *   - UNA VERDAD POR PROCESO: singleton en globalThis (Next dev con HMR reimporta módulos;
 *     sin singleton cada recarga de ruta crearía un store vacío y perderíamos historial).
 *
 * El sim determinista NUNCA se toca: esto solo escucha al cliente.
 */

/** Evento de telemetría tal como viaja del cliente y descansa en el store. */
export interface TelemetryEvent {
  /** epoch ms del cliente (o del servidor si el cliente no la trajo). */
  ts: number;
  /** tipo: 'error' | 'rejection' | 'console' | 'session' | 'custom'. */
  type: string;
  /** id de sesión del cliente (persistente en localStorage). */
  session: string;
  /** huella FNV-1a (solo errores/rejections: la clave de dedup). */
  fp?: string;
  /** mensaje recortado (max 240 chars). */
  msg?: string;
  /** pila recortada (max 600 chars, solo el primer error por huella). */
  stack?: string;
  /** metadatos libres acotados (se serializan, max 400 chars). */
  meta?: Record<string, unknown>;
}

/** FNV-1a 32-bit — la misma técnica del sistema perdido: rápida, determinista, sin deps. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // >>> 0 lo devuelve sin signo; hex con ceros para comparaciones estables.
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Techo de seguridad para strings que entran desde el cliente. */
const clip = (s: unknown, max: number): string => {
  if (typeof s !== 'string') return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

const clipMeta = (meta: unknown): Record<string, unknown> | undefined => {
  if (!meta || typeof meta !== 'object') return undefined;
  try {
    const json = JSON.stringify(meta);
    if (!json || json.length > 400) return { truncated: true };
    return meta as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

/** Fila agregada de un error por huella. */
export interface ErrorAggregate {
  fp: string;
  count: number;
  type: string;
  msg: string;
  stack: string;
  firstTs: number;
  lastTs: number;
  sessions: number;
}

/** Vista de una sesión cliente. */
export interface SessionView {
  session: string;
  firstSeen: number;
  lastSeen: number;
  events: number;
  errors: number;
  lastType: string;
}

/** Snapshot agregado que sirve GET /api/telemetry. */
export interface TelemetrySnapshot {
  boot: number;
  now: number;
  totals: { events: number; errors: number; sessions: number; drops: number };
  errors: ErrorAggregate[];
  sessions: SessionView[];
  recent: TelemetryEvent[];
}

const MAX_EVENTS = 2000;
const MAX_ERROR_KEYS = 240;
const MAX_SESSIONS = 120;
const SNAPSHOT_PATH = '/tmp/vecinos-telemetry.json';
const SNAPSHOT_DEBOUNCE_MS = 1000;

export class TelemetryStore {
  private events: TelemetryEvent[] = [];
  private errors = new Map<string, ErrorAggregate>();
  private sessions = new Map<string, SessionView & { lastType: string }>();
  private totals = { events: 0, errors: 0, drops: 0 };
  private readonly boot = Date.now();
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;

  /** Ingresa un lote validado. Devuelve cuántos eventos aceptó (el resto, drops). */
  ingest(batch: unknown): number {
    if (!Array.isArray(batch)) return 0;
    let accepted = 0;
    for (const raw of batch) {
      if (!raw || typeof raw !== 'object') continue;
      const e = raw as Partial<TelemetryEvent>;
      const type = clip(e.type, 24) || 'custom';
      const session = clip(e.session, 64);
      if (!session) continue;
      const ts = typeof e.ts === 'number' && Number.isFinite(e.ts) && e.ts > 0 ? Math.min(e.ts, Date.now() + 60_000) : Date.now();
      const isError = type === 'error' || type === 'rejection';
      const msg = clip(e.msg, 240);
      const ev: TelemetryEvent = {
        ts,
        type,
        session,
        msg: msg || undefined,
        meta: clipMeta(e.meta),
      };

      if (isError) {
        // Dedup por huella: la que trae el cliente, o la calculamos aquí (misma función).
        const fp = clip(e.fp, 8) || fnv1a(`${type}|${msg}`);
        ev.fp = fp;
        const agg = this.errors.get(fp);
        if (agg) {
          agg.count += 1;
          agg.lastTs = ts;
          agg.sessions += agg.stack || !e.stack ? 0 : 0; // sesiones únicas se ajustan abajo
          if (!agg.msg && msg) agg.msg = msg;
        } else {
          // Techo del mapa de errores: expulsa el de contador mínimo (nunca crece sin fin).
          if (this.errors.size >= MAX_ERROR_KEYS) {
            let minKey: string | null = null;
            let minCount = Infinity;
            for (const [k, v] of this.errors) {
              if (v.count < minCount) {
                minCount = v.count;
                minKey = k;
              }
            }
            if (minKey) this.errors.delete(minKey);
          }
          this.errors.set(fp, {
            fp,
            count: 1,
            type,
            msg,
            stack: clip(e.stack, 600),
            firstTs: ts,
            lastTs: ts,
            sessions: 1,
          });
        }
        this.totals.errors += 1;
      }

      this.events.push(ev);
      if (this.events.length > MAX_EVENTS) {
        this.events.splice(0, this.events.length - MAX_EVENTS);
        this.totals.drops += 1;
      }
      this.totals.events += 1;

      // Sesión: lastSeen latiendo con cada lote (base del playtest FASE T).
      const sess = this.sessions.get(session);
      if (sess) {
        sess.lastSeen = ts;
        sess.events += 1;
        if (isError) sess.errors += 1;
        sess.lastType = type;
      } else {
        if (this.sessions.size >= MAX_SESSIONS) {
          // Expulsa la sesión más vieja por lastSeen.
          let oldest: string | null = null;
          let oldestTs = Infinity;
          for (const [k, v] of this.sessions) {
            if (v.lastSeen < oldestTs) {
              oldestTs = v.lastSeen;
              oldest = k;
            }
          }
          if (oldest) this.sessions.delete(oldest);
        }
        this.sessions.set(session, {
          session,
          firstSeen: ts,
          lastSeen: ts,
          events: 1,
          errors: isError ? 1 : 0,
          lastType: type,
        });
      }
      accepted += 1;
    }
    if (accepted > 0) this.scheduleSnapshot();
    return accepted;
  }

  /** GET /api/telemetry — la vista agregada que lee el humano. */
  snapshot(): TelemetrySnapshot {
    const now = Date.now();
    const errors = [...this.errors.values()].sort((a, b) => b.count - a.count);
    const sessions = [...this.sessions.values()].sort((a, b) => b.lastSeen - a.lastSeen);
    const recent = this.events.slice(-50);
    return {
      boot: this.boot,
      now,
      totals: { ...this.totals, sessions: this.sessions.size },
      errors,
      sessions,
      recent,
    };
  }

  /** Snapshot atómico a /tmp (tmp + rename). Debounced 1 s: un ingestado revienta no es problema. */
  private scheduleSnapshot(): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      this.writeSnapshot();
    }, SNAPSHOT_DEBOUNCE_MS);
    // En Node el timer no debe mantener vivo el proceso: unref si está disponible.
    const t = this.snapshotTimer as unknown as { unref?: () => void };
    if (typeof t.unref === 'function') t.unref();
  }

  private writeSnapshot(): void {
    try {
      // Import perezoso: en el cliente este módulo no se carga; aquí solo corre en servidor.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      const json = JSON.stringify(this.snapshot());
      const tmp = `${SNAPSHOT_PATH}.tmp`;
      fs.writeFileSync(tmp, json, 'utf8');
      fs.renameSync(tmp, SNAPSHOT_PATH);
    } catch {
      // /tmp puede no existir o ser de solo lectura en algún despliegue: la memoria manda.
    }
  }
}

/** Singleton global (sobrevive al HMR de dev; una sola verdad por proceso). */
const globalStore = globalThis as unknown as { __vecinosTelemetry?: TelemetryStore };
export const telemetryStore: TelemetryStore = globalStore.__vecinosTelemetry ?? new TelemetryStore();
globalStore.__vecinosTelemetry = telemetryStore;
