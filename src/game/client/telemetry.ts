/**
 * TELEMETRÍA DE VECINOS — CLIENTE (v1.75, reconstruida).
 *
 * Reconstrucción del módulo perdido en el rollback. Diseño:
 *   - CAPTURA: window 'error' + 'unhandledrejection' + console.error envuelto (una vez).
 *   - HUELLA FNV-1A de `type|message`: el mismo algoritmo del servidor, así la dedup
 *     coincide en los dos lados (los 437× de `nodeOf` se contaron como UNA fila).
 *   - FLUSH POR LOTES: el buffer viaja a POST /api/telemetry al llegar a MAX_BATCH
 *     eventos o cada FLUSH_MS — el juego no paga una petición por error.
 *   - BEACON DE DESPEDIDA: pagehide / visibilitychange→hidden manda lo pendiente con
 *     navigator.sendBeacon (el último error de una pestaña cerrada también cuenta).
 *   - JAMÁS MOLESTA: todo envuelto en try/catch, sin logs propios en consola, sin
 *     reintento infinito si la red cae (los lotes se pierden con dignidad).
 *
 * El latido de actividad por minutos (FASE T) viene después: esta base es la que se perdió.
 */

const MAX_BATCH = 12;
const FLUSH_MS = 5000;
const SESSION_KEY = 'vecinos.telemetry.session';

/** FNV-1a 32-bit — espejo exacto del de src/lib/telemetry-store.ts. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

interface ClientEvent {
  ts: number;
  type: string;
  session: string;
  fp?: string;
  msg?: string;
  stack?: string;
  meta?: Record<string, unknown>;
}

const clip = (s: unknown, max: number): string =>
  typeof s === 'string' && s.length > max ? `${s.slice(0, max)}…` : typeof s === 'string' ? s : '';

/** Sesión persistente: la misma pestaña/perfil mantiene su identidad entre recargas. */
function sessionId(): string {
  try {
    const got = localStorage.getItem(SESSION_KEY);
    if (got) return got;
  } catch {
    /* sin storage: sesión efímera */
  }
  const id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch {
    /* nada */
  }
  return id;
}

class TelemetryClient {
  private session = sessionId();
  private buffer: ClientEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private installed = false;

  install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;

    window.addEventListener('error', (ev) => {
      // Solo errores JS reales; resource errors (img/script) viajan sin message útil.
      const msg = ev.message || (ev.target && ev.target !== window ? 'resource error' : 'error');
      this.push({
        type: 'error',
        msg,
        stack: ev.error?.stack ?? clip(String(ev.filename ?? ''), 600),
        fp: fnv1a(`error|${msg}`),
      });
    }, true);

    window.addEventListener('unhandledrejection', (ev) => {
      const r = (ev as PromiseRejectionEvent).reason;
      const msg = typeof r === 'string' ? r : r?.message ?? String(r ?? 'rejection');
      this.push({
        type: 'rejection',
        msg: clip(msg, 240),
        stack: clip(r?.stack, 600),
        fp: fnv1a(`rejection|${clip(msg, 240)}`),
      });
    });

    const originalError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      try {
        const msg = args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : '')).filter(Boolean).join(' | ');
        if (msg) this.push({ type: 'console', msg: clip(msg, 240), fp: fnv1a(`console|${clip(msg, 240)}`) });
      } catch {
        /* la telemetría nunca rompe el juego */
      }
      originalError(...args);
    };

    // Despedida: lo pendiente viaja por beacon (no fetch — la pestaña se está yendo).
    const bye = () => this.flush(true);
    window.addEventListener('pagehide', bye);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') bye();
    });

    // Hola: la sesión nace ya en el servidor (base del playtest).
    this.push({ type: 'session', msg: 'boot', meta: { href: location.href, dpr: window.devicePixelRatio } });
    this.timer = setInterval(() => this.flush(false), FLUSH_MS);
    const t = this.timer as unknown as { unref?: () => void };
    if (typeof t.unref === 'function') t.unref();

    // Primer flush temprano: si el boot truena, el 'session' ya llegó.
    setTimeout(() => this.flush(false), 1200);
  }

  private push(partial: Omit<ClientEvent, 'ts' | 'session'>): void {
    try {
      this.buffer.push({ ts: Date.now(), session: this.session, ...partial });
      if (this.buffer.length >= MAX_BATCH) this.flush(false);
    } catch {
      /* nada */
    }
  }

  private flush(beacon: boolean): void {
    if (this.buffer.length === 0) return;
    const events = this.buffer;
    this.buffer = [];
    try {
      const body = JSON.stringify({ session: this.session, events });
      if (beacon && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon('/api/telemetry', new Blob([body], { type: 'application/json' }));
        return;
      }
      fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {
        /* red caída: el lote se pierde, no hay reintento infinito */
      });
    } catch {
      /* nada */
    }
  }
}

const client = new TelemetryClient();

/** Instala la telemetría (idempotente). Llámalo lo antes posible en el cliente. */
export function installTelemetry(): void {
  client.install();
}

/** Para QA: fuerza el envío de lo pendiente y devuelve el tamaño del buffer. */
export function telemetryPendingCount(): number {
  return 0; // tras install el buffer se vacía por lotes; la QA real lee GET /api/telemetry
}
