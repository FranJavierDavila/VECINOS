import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Guardado/carga de partidas VECINOS (slot único 'auto').
 * El estado del mundo viaja como JSON serializado en un String: el sim ya es JSON-safe por diseño
 * (solo instancias + reloj + semilla + schemaVersion).
 */
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
    const row = await db.gameSave.upsert({
      where: { slot },
      update: data,
      create: data,
    });
    return NextResponse.json({ ok: true, savedAt: row.updatedAt });
  } catch {
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
