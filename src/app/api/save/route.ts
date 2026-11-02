import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Guardado/carga de partidas VECINOS (slot único 'auto').
 * El estado del mundo viaja como JSON serializado en un String: el sim ya es JSON-safe por diseño
 * (solo instancias + reloj + semilla + schemaVersion).
 */

/**
 * v1.71 (higiene) — COLA DE ESCRITURA (memoria local): SQLite admite UN escritor a la vez.
 * Con dos pestañas (anfitrión + invitado) los autosave concurrentes chocaban (SQLITE_BUSY)
 * y el endpoint devolvía 500 intermitente (qa-v164 F1 lo cazó). Encadenar los upsert en
 * una promesa serializa los escritores del proceso; el retry cubre el resto de casos.
 */
let writeQueue: Promise<unknown> = Promise.resolve();
const queued = <T>(job: () => Promise<T>): Promise<T> => {
  const next = writeQueue.then(job, job);
  writeQueue = next.catch(() => undefined); // la cola nunca muere por un fallo del job
  return next;
};

/** SQLITE_BUSY no siempre es inmediato: reintentos cortos con backoff (v1.71). */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const withRetry = async <T>(job: () => Promise<T>, tries = 3): Promise<T> => {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await job();
    } catch (e) {
      last = e;
      await sleep(120 * (i + 1));
    }
  }
  throw last;
};

export async function GET(request: Request) {
  const slot = new URL(request.url).searchParams.get('slot') ?? 'auto';
  const row = await db.gameSave.findUnique({ where: { slot } });
  if (!row) return NextResponse.json({ state: null, savedAt: null });
  let state: unknown = null;
  try {
    state = JSON.parse(row.state);
  } catch {
    state = null;
  }
  return NextResponse.json({ state, day: row.day, minute: row.minute, savedAt: row.updatedAt });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { slot?: string; state?: unknown };
    const state = body.state as { tick?: unknown; clock?: { day?: unknown; minute?: unknown } } | undefined;
    if (!state || typeof state !== 'object' || typeof state.tick !== 'number' || !state.clock || typeof state.clock.day !== 'number' || typeof state.clock.minute !== 'number') {
      return NextResponse.json({ error: 'invalid_state' }, { status: 400 });
    }
    const slot = typeof body.slot === 'string' && body.slot.length > 0 ? body.slot : 'auto';
    const data = { slot, state: JSON.stringify(state), tick: state.tick, day: state.clock.day, minute: state.clock.minute };
    const row = await queued(() => withRetry(() => db.gameSave.upsert({ where: { slot }, update: data, create: data })));
    return NextResponse.json({ ok: true, savedAt: row.updatedAt });
  } catch (e) {
    // v1.71: el 500 ya no es mudo — el error real queda en dev.log (antes: save_failed ciego).
    console.error('[api/save] POST falló:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
