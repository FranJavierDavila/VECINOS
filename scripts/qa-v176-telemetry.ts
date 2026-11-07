/**
 * QA v1.76 — TELEMETRÍA DE PLAYTEST (FASE T).
 *
 * UNIDAD (store directo, sin servidor): huella FNV-1a determinista, dedup de errores por
 * huella con sesiones únicas, latidos → activeMins, buffer circular acotado, expulsión de
 * sesiones viejas, rechazo de lotes malformados y forma del snapshot (sin filtrar lo interno).
 * E2E (HTTP contra :3000, el dev real): POST ingesta → GET vista agregada con la sesión QA
 * (activeMins ≥ 1, lastType) + snapshot atómico en /tmp/vecinos-telemetry.json parseable.
 *
 * Uso: bun scripts/qa-v176-telemetry.ts   (0 argumentos; :3000 solo para el bloque E2E)
 */

import { TelemetryStore, fnv1a } from '../src/lib/telemetry-store';

let ok = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra?: string): void => {
  if (cond) {
    ok += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

const ev = (session: string, type: string, extra: Partial<{ msg: string; fp: string; stack: string; ts: number }> = {}) => ({
  ts: extra.ts ?? Date.now(),
  type,
  session,
  ...(extra.msg ? { msg: extra.msg } : {}),
  ...(extra.fp ? { fp: extra.fp } : {}),
  ...(extra.stack ? { stack: extra.stack } : {}),
});

console.log('── 1. Huella FNV-1a ──');
check('determinista (misma entrada → misma salida)', fnv1a('error|prueba') === fnv1a('error|prueba'));
check('formato 8 hex', /^[0-9a-f]{8}$/.test(fnv1a('error|prueba')));
check('distinta entrada → distinta huella', fnv1a('error|a') !== fnv1a('error|b'));

console.log('── 2. Ingesta y dedup de errores ──');
{
  const s = new TelemetryStore();
  const accepted = s.ingest([
    ev('qa_a', 'error', { msg: 'X Explotó', stack: 'at a' }),
    ev('qa_a', 'error', { msg: 'X Explotó', stack: 'at a' }),
    ev('qa_b', 'error', { msg: 'X Explotó', stack: 'at b' }),
    ev('qa_b', 'error', { msg: 'Y Otro fallo' }),
  ]);
  check('acepta los 4 eventos', accepted === 4, `aceptó ${accepted}`);
  const snap = s.snapshot();
  check('2 huellas distintas', snap.errors.length === 2, `hay ${snap.errors.length}`);
  const top = snap.errors[0]!;
  check('la huella repetida manda (count 3, orden desc)', top.count === 3, `count=${top.count}`);
  check('sesiones únicas del error = 2 (qa_a + qa_b)', top.sessions === 2, `sessions=${top.sessions}`);
  check('pila conservada del primer avistamiento', top.stack === 'at a');
  check('totals.errors = 4 (por evento, no por huella)', snap.totals.errors === 4);
}

console.log('── 3. Latido de actividad (activeMins) ──');
{
  const s = new TelemetryStore();
  s.ingest([ev('qa_lat', 'session', { msg: 'boot' })]);
  s.ingest([ev('qa_lat', 'heartbeat', { msg: 'min' })]);
  s.ingest([ev('qa_lat', 'heartbeat', { msg: 'min' })]);
  s.ingest([ev('qa_lat', 'error', { msg: 'E1' })]);
  const sess = s.snapshot().sessions.find((x) => x.session === 'qa_lat')!;
  check('sesión presente', !!sess);
  check('activeMins = 2 (solo heartbeats)', sess.activeMins === 2, `activeMins=${sess?.activeMins}`);
  check('events = 4, errors = 1', sess.events === 4 && sess.errors === 1);
  check('lastType = error', sess.lastType === 'error');
  check('sesión sin latidos → activeMins 0', (() => {
    const s2 = new TelemetryStore();
    s2.ingest([ev('qa_sin', 'session', { msg: 'boot' })]);
    return s2.snapshot().sessions[0]!.activeMins === 0;
  })());
}

console.log('── 4. Acotado: buffer circular y expulsión de sesiones ──');
{
  const s = new TelemetryStore();
  const flood: ReturnType<typeof ev>[] = [];
  for (let i = 0; i < 2010; i++) flood.push(ev(`qa_flood`, 'heartbeat', { msg: 'min' }));
  s.ingest(flood);
  const snap = s.snapshot();
  check('eventos en memoria ≤ 2000', snap.recent.length <= 50 && snap.totals.events === 2010, `events=${snap.totals.events}`);
  check('drops contados (10 recortados)', snap.totals.drops === 10, `drops=${snap.totals.drops}`);
  check('UNA sola sesión aunque repita id (sin growth)', snap.sessions.length === 1);

  const s2 = new TelemetryStore();
  const many: ReturnType<typeof ev>[] = [];
  for (let i = 0; i < 125; i++) many.push(ev(`qa_s${i}`, 'session', { msg: 'boot' }));
  s2.ingest(many);
  check('techos de sesiones: 125 ids → ≤ 120 sesiones', s2.snapshot().sessions.length <= 120, `sesiones=${s2.snapshot().sessions.length}`);
}

console.log('── 5. Rechazo de basura ──');
{
  const s = new TelemetryStore();
  check('lote no-array → 0', s.ingest('basura') === 0);
  check('evento sin session → rechazado', s.ingest([{ ts: Date.now(), type: 'error', msg: 'sin sesion' }]) === 0);
  check('evento no-objeto → rechazado', s.ingest([42, null, 'x']) === 0);
  const snap = s.snapshot();
  check('nada entró (0 eventos, 0 sesiones)', snap.totals.events === 0 && snap.sessions.length === 0);
}

console.log('── 6. Forma del snapshot (nada interno se filtra) ──');
{
  const s = new TelemetryStore();
  s.ingest([ev('qa_shape', 'error', { msg: 'F', stack: 'at f' })]);
  const json = JSON.stringify(s.snapshot());
  check('sin fuga del set interno "seen"', !json.includes('"seen"'));
  check('claves aggregate correctas', (() => {
    const e = s.snapshot().errors[0]!;
    return ['fp', 'count', 'type', 'msg', 'stack', 'firstTs', 'lastTs', 'sessions'].every((k) => k in e);
  })());
  check('claves sesión correctas', (() => {
    const x = s.snapshot().sessions[0]!;
    return ['session', 'firstSeen', 'lastSeen', 'events', 'errors', 'activeMins', 'lastType'].every((k) => k in x);
  })());
}

console.log('── 7. E2E contra :3000 (dev real) ──');
{
  const base = 'http://127.0.0.1:3000';
  const sid = `qa_v176_${Date.now().toString(36)}`;
  // POST: boot + 2 heartbeats + 1 error
  const post = await fetch(`${base}/api/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session: sid,
      events: [
        ev(sid, 'session', { msg: 'boot' }),
        ev(sid, 'heartbeat', { msg: 'min' }),
        ev(sid, 'heartbeat', { msg: 'min' }),
        ev(sid, 'error', { msg: 'qa-v176 error sintético E2E', stack: 'at qa' }),
      ],
    }),
  });
  const pj = (await post.json()) as { ok: boolean; accepted: number };
  check('POST /api/telemetry 200 ok', post.status === 200 && pj.ok === true);
  check('accepted = 4', pj.accepted === 4, `accepted=${pj.accepted}`);

  const get = await fetch(`${base}/api/telemetry`);
  const gj = (await get.json()) as {
    totals: { events: number; sessions: number };
    sessions: { session: string; activeMins: number; lastType: string }[];
    errors: { msg: string; count: number; sessions: number }[];
  };
  check('GET 200 con vista agregada', get.status === 200 && Array.isArray(gj.sessions));
  const mine = gj.sessions.find((x) => x.session === sid);
  check('sesión QA visible en la vista', !!mine);
  check('activeMins de la sesión QA = 2 (latidos contados)', mine?.activeMins === 2, `activeMins=${mine?.activeMins}`);
  check('lastType = error', mine?.lastType === 'error');
  const synth = gj.errors.find((e) => e.msg?.includes('qa-v176 error sintético'));
  check('error sintético dedup-agregado con sessions=1', !!synth && synth.count === 1 && synth.sessions === 1);
}

console.log('── 8. Snapshot atómico en /tmp ──');
{
  // El POST del bloque anterior dispara la escritura debounced (1 s).
  await new Promise((r) => setTimeout(r, 1600));
  const fs = await import('node:fs');
  const exists = fs.existsSync('/tmp/vecinos-telemetry.json');
  check('/tmp/vecinos-telemetry.json existe', exists);
  if (exists) {
    const parsed = JSON.parse(fs.readFileSync('/tmp/vecinos-telemetry.json', 'utf8')) as { totals: { events: number } };
    check('snapshot parseable con totals', typeof parsed.totals?.events === 'number');
  }
}

console.log(`\n═══ QA v1.76 telemetría: ${ok} ✓ / ${fail} ✗ ═══`);
process.exit(fail === 0 ? 0 : 1);
