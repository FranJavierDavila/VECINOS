import { NextResponse } from 'next/server';
import { telemetryStore } from '@/lib/telemetry-store';

/**
 * TELEMETRÍA DE VECINOS — ingesta (POST) y vista agregada (GET).
 *
 * POST /api/telemetry  { session, events: [...] }  → lote del cliente (flush periódico
 * o beacon de pagehide). NUNCA lanza: la telemetría jamás debe molestar al juego.
 * GET  /api/telemetry  → snapshot agregado { totals, errors por huella, sesiones, recent }.
 * Las escrituras atómicas a /tmp/vecinos-telemetry.json las hace el store (v1.75).
 */

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { events?: unknown };
    const accepted = telemetryStore.ingest(body?.events);
    return NextResponse.json({ ok: true, accepted });
  } catch {
    // Un lote roto no es un error del juego: 200 con accepted 0 y a otra cosa.
    return NextResponse.json({ ok: false, accepted: 0 });
  }
}

export async function GET() {
  try {
    return NextResponse.json(telemetryStore.snapshot());
  } catch {
    return NextResponse.json({ ok: false, error: 'snapshot' }, { status: 500 });
  }
}
