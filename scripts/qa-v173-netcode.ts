/**
 * VECINOS — QA FASE N · NETCODE PROFESIONAL (v1.73), estilo qa-v164-multi / qa-v170-audio.
 *
 * Dos partes:
 *  U — UNIDAD (sin red): validatePose (velocidad/teleport/spam/re-anclaje/plantas),
 *      noteViolation (ventana + kick), allowCmd (rate limit), noteAck + buildHealth,
 *      y round-trip COMPLETO de persistencia (snapshot → JSON → hydrate: mundo, marcador,
 *      co-op, voz, roster centinela, runtime fresco).
 *  E — E2E contra SU PROPIO servidor (VECINOS_QA_PORT=3017, nunca toca el :3010 real):
 *      relay fiel, teleport rechazado, spam de ritmo, rate limit de comandos,
 *      session:ack → /health (lag 0), PERSISTENCIA REAL (SIGTERM → relanzar → rejoin del
 *      anfitrión y del invitado con mundo/marcador intactos) y KICK por 120 teleports.
 *
 * PASS/FAIL por consola; process.exit(1) en fallo.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, statSync } from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld } from '@/game/sim';
import type { World } from '@/game/core/types';
import { allowCmd, authorityOf, buildHealth, noteAck, noteViolation, validatePose, type AuthorityCfg, type HealthPayload } from '../mini-services/vecinos-server/authority';
import { hydrateSession, snapshotSessions, type PersistedFile } from '../mini-services/vecinos-server/persist';
import { freshMetrics, type Session } from '../mini-services/vecinos-server/session';

let failures = 0;
function assert(cond: boolean, label: string, msg: string): void {
  if (cond) console.log(`PASS (${label}) · ${msg}`);
  else {
    failures += 1;
    console.error(`FAIL (${label}) · ${msg}`);
  }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── Contenido real del juego (misma verdad que cliente y servidor) ──
const { content, issues } = await loadContent(new URL('../public/content/', import.meta.url).href);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}

// ═══════════════════════════ U — UNIDAD ═══════════════════════════

const cfg: AuthorityCfg | null = authorityOf(content.rules);
assert(cfg !== null, 'U·catálogo', 'rules.multiplayer.authority presente y enabled (data-driven)');
if (!cfg) process.exit(1);
assert(cfg.maxSpeed > 3.9 && cfg.maxSpeed < 30, 'U·catálogo', `maxSpeed=${cfg.maxSpeed} m/s — margen sobre view.runSpeed=3.9 sin permitir abusos`);
assert(cfg.kickViolations > 0, 'U·catálogo', `kickViolations=${cfg.kickViolations} (anti-cheat activo)`);

function fakeSession(world: World): Session {
  return {
    code: 'TEST',
    scenarioId: 'slice',
    world,
    speed: 1,
    seq: 7,
    pendingMinigame: null,
    participants: new Map([
      ['sock-1', { socketId: 'sock-1', residentId: world.playerId, name: 'Anfitrión', home: world.residents[world.playerId]!.home, isHost: true }],
    ]),
    guestCounter: 2,
    timer: null,
    cleanup: null,
    scores: new Map([['res_x', { points: 12, best: { mg_fusibles: 3.4 }, name: 'Ana' }]]),
    lastMinigame: { id: 'mg_fusibles', actor: 'res_x', at: 12345 },
    lastRecordAt: new Map([['res_x', 12345]]),
    coop: {
      activeIdx: 0,
      assignments: new Map([['electricista', { residentId: 'res_x', name: 'Ana', done: true }]]),
      done: ['coop_apagon'],
      lastOfferAt: 999,
    },
    voice: new Map([['res_x', { socketId: 'sock-1', muted: true, speaking: false }]]),
    grace: new Map(),
    poses: new Map(),
    cmdWindow: new Map(),
    violations: new Map(),
    metrics: freshMetrics(),
    acks: new Map(),
  };
}

// U·persistencia — round-trip completo SIN red: snapshot → JSON → hydrate.
{
  const world = createWorld(content, 'slice');
  world.tick = 4321; // marca inconfundible para el round-trip
  const s = fakeSession(world);
  const snap = snapshotSessions(new Map([[s.code, s]]));
  const back = JSON.parse(JSON.stringify(snap)) as PersistedFile;
  const revived = hydrateSession(back.sessions[0]!);
  assert(revived.code === 'TEST' && revived.scenarioId === 'slice' && revived.seq === 7, 'U·persistencia', 'código/escenario/seq intactos tras el disco');
  assert(revived.world.tick === 4321, 'U·persistencia', `mundo intacto (tick ${revived.world.tick})`);
  assert(JSON.stringify(revived.world) === JSON.stringify(world), 'U·persistencia', 'world serializa 1:1 (JSON stringify igual)');
  assert(revived.scores.get('res_x')?.points === 12 && revived.scores.get('res_x')?.best.mg_fusibles === 3.4, 'U·persistencia', 'marcador «Vecino del mes» intacto (puntos + récord)');
  assert(revived.coop.assignments.get('electricista')?.done === true && revived.coop.done[0] === 'coop_apagon', 'U·persistencia', 'co-op intacta (asignación + historial)');
  assert(revived.voice.get('res_x')?.muted === true, 'U·persistencia', 'canal de voz intacto (el asiento sobrevive al reinicio)');
  const roster = [...revived.participants.keys()];
  assert(roster.length === 1 && roster[0]!.startsWith('restored:'), 'U·persistencia', `roster con socketId centinela (${String(roster[0])}) — el rejoin lo sustituye 1:1`);
  assert(revived.timer === null && revived.cleanup === null, 'U·persistencia', 'runtime sin armar (timer/cleanup): el anfitrión los re-arma');
  assert(revived.metrics.posesIn === 0 && revived.poses.size === 0 && revived.violations.size === 0, 'U·persistencia', 'runtime de autoridad fresco (trazas de pose del disco no valen)');
  assert(revived.lastMinigame?.id === 'mg_fusibles' && revived.lastRecordAt.get('res_x') === 12345, 'U·persistencia', 'antispam de minijuegos intacto');
}

// U·validatePose — velocidad, teleport, spam, re-anclaje y plantas.
{
  const world = createWorld(content, 'slice');
  const s = fakeSession(world);
  const t0 = 1_000_000;
  const v1 = validatePose(cfg, s, 'r1', { x: 0, z: 0, floor: 0 }, t0);
  assert(v1.ok && !v1.reason, 'U·validatePose', 'primera pose sin ancla: aceptada (y ancla puesta)');
  const v2 = validatePose(cfg, s, 'r1', { x: 0.5, z: 0, floor: 0 }, t0 + 100);
  assert(v2.ok, 'U·validatePose', 'paseo legítimo 5 m/s: aceptado');
  const v3 = validatePose(cfg, s, 'r1', { x: 100, z: 0, floor: 0 }, t0 + 150);
  assert(!v3.ok && v3.reason === 'teleport', 'U·validatePose', 'salto de 99,5 m en 50 ms → TELEPORT rechazado');
  const v4 = validatePose(cfg, s, 'r1', { x: 100, z: 0, floor: 0 }, t0 + 160);
  assert(!v4.ok && v4.reason === 'teleport', 'U·validatePose', 'reintento: el ancla NO se movió (el tramposo queda clavado)');
  const v5 = validatePose(cfg, s, 'r1', { x: 0.5, z: 0.01, floor: 0 }, t0 + 110);
  assert(!v5.ok && v5.reason === 'spam', 'U·validatePose', 'dt 10 ms < minPoseIntervalMs → SPAM descartado (sin contar violación)');
  const v6 = validatePose(cfg, s, 'r1', { x: 0.6, z: 0, floor: 1 }, t0 + 3200);
  assert(v6.ok, 'U·validatePose', 'hueco de red 3 s > maxPoseGapMs → re-anclaje sin chequeo (pestaña en segundo plano)');
  const v7 = validatePose(cfg, s, 'r1', { x: 0.6, z: 0, floor: 6 }, t0 + 3500);
  assert(!v7.ok && v7.reason === 'teleport', 'U·validatePose', '10 plantas/s > maxFloorSpeed → TELEPORT vertical rechazado');
  assert(s.metrics.posesIn === 7 && s.metrics.posesRejected === 4, 'U·validatePose', `métricas coherentes (in=${s.metrics.posesIn}, rejected=${s.metrics.posesRejected}: 3 teleports + 1 spam)`);
}

// U·noteViolation — ventana deslizante y expulsión.
{
  const world = createWorld(content, 'slice');
  const s = fakeSession(world);
  const kick3: AuthorityCfg = { ...cfg, kickViolations: 3, violationWindowSec: 60 };
  const t0 = 2_000_000;
  assert(noteViolation(kick3, s, 'r9', t0) === false, 'U·anti-cheat', 'violación 1: sin expulsión');
  assert(noteViolation(kick3, s, 'r9', t0 + 500) === false, 'U·anti-cheat', 'violación 2: sin expulsión');
  assert(noteViolation(kick3, s, 'r9', t0 + 900) === true, 'U·anti-cheat', 'violación 3 (umbral): EXPULSIÓN');
  assert(noteViolation(kick3, s, 'r9', t0 + 61_000) === false, 'U·anti-cheat', 'ventana caducada: el contador se reinicia (nadie carga culpas eternas)');
  assert(s.metrics.violations === 4, 'U·anti-cheat', `métricas de violaciones=${s.metrics.violations}`);
}

// U·allowCmd + noteAck + buildHealth — rate limit, lag de desync y /health.
{
  const world = createWorld(content, 'slice');
  const s = fakeSession(world);
  const rate3: AuthorityCfg = { ...cfg, maxCmdsPerSec: 3 };
  const t0 = 3_000_000;
  const sec = Math.floor(t0 / 1000) * 1000;
  const results = [0, 1, 2, 3].map((i) => allowCmd(rate3, s, 'sock-1', sec + i));
  assert(results[0] && results[1] && results[2] && !results[3], 'U·allowCmd', '3 comandos/s ok, el 4º rechazado (ventana fija de 1 s)');
  assert(allowCmd(rate3, s, 'sock-1', sec + 1100) === true, 'U·allowCmd', 'segundo siguiente: ventana nueva, vuelve a aceptar');
  noteAck(s, 'sock-1', world.playerId, 5, t0);
  assert(s.acks.get('sock-1')?.lastSeq === 5, 'U·ack', 'session:ack anotado (último seq aplicado = 5)');
  const health = buildHealth(new Map([[s.code, s]]), 12_345);
  assert(health.ok && health.totals.sessions === 1, 'U·health', '/health vivo (1 sesión)');
  const row = health.sessions[0]!;
  assert(row.ackLag.max === 2 && row.acks[0]?.lag === 2, 'U·health', `lag de desync = seq(${s.seq}) − ack(5) = ${row.ackLag.max}`);
  assert(row.metrics.cmdsRejected === 1 && row.metrics.acksIn === 1, 'U·health', 'métricas de comandos/acks expuestas');
}

// ═══════════════════════════ E — E2E (servidor propio :3017) ═══════════════════════════

const QA_PORT = 3017;
const QA_URL = `http://127.0.0.1:${QA_PORT}`;
const SNAP = `/tmp/vecinos-sessions-${QA_PORT}.json`;
rmSync(SNAP, { force: true });

let server: ChildProcess | null = null;
let outLog = '';
let errLog = '';
const drain = (s: NodeJS.ReadableStream | null, into: (t: string) => void): void => {
  if (!s) return;
  s.on('data', (chunk: Buffer | string) => {
    into(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  });
};

async function startServer(): Promise<void> {
  server = spawn('bun', ['index.ts'], {
    cwd: '/home/z/my-project/mini-services/vecinos-server',
    env: { ...process.env, VECINOS_QA_PORT: String(QA_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  drain(server.stdout, (t) => (outLog += t));
  drain(server.stderr, (t) => (errLog += t));
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${QA_URL}/health`);
      if (r.ok) return;
    } catch {
      /* aún no escucha */
    }
    if (Date.now() - t0 > 15_000) throw new Error(`servidor QA no arrancó\n${outLog}\n${errLog}`);
    await sleep(300);
  }
}

async function stopServer(): Promise<void> {
  if (!server) return;
  const p = server;
  const exited = new Promise<void>((resolve) => p.once('exit', () => resolve()));
  p.kill('SIGTERM');
  await Promise.race([exited, sleep(4000)]); // el cierre limpio escribe el snapshot final
  if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
  server = null;
}

async function health(): Promise<HealthPayload> {
  const r = await fetch(`${QA_URL}/health`);
  return (await r.json()) as HealthPayload;
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(QA_URL);
    const t = setTimeout(() => reject(new Error('timeout conectando')), 6000);
    s.on('connect', () => {
      clearTimeout(t);
      resolve(s);
    });
    s.on('connect_error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function ack<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ack ${event}`)), 6000);
    socket.emit(event, payload, (res: T) => {
      clearTimeout(t);
      resolve(res);
    });
  });
}

interface StateMsg {
  seq: number;
  world: World;
  events: unknown[];
}
function waitState(socket: Socket, pred: (s: StateMsg) => boolean, label: string, ms = 10_000): Promise<StateMsg> {
  return new Promise((resolve, reject) => {
    const on = (s: StateMsg): void => {
      if (!pred(s)) return;
      clearTimeout(t);
      socket.off('session:state', on);
      resolve(s);
    };
    const t = setTimeout(() => {
      socket.off('session:state', on);
      reject(new Error(`timeout session:state (${label})`));
    }, ms);
    socket.on('session:state', on);
  });
}

type CreateAck = { ok: true; code: string; isHost: boolean; yourResidentId: string } | { ok: false; error: string };
type JoinAck = { ok: true; code: string; isHost: boolean; yourResidentId: string } | { ok: false; error: string };

try {
  await startServer();
  assert(true, 'E·arranque', `servidor QA vivo en :${QA_PORT} (VECINOS_QA_PORT)`);

  const c1 = await connect();
  const created = await ack<CreateAck>(c1, 'session:create', { scenarioId: 'slice' });
  assert(created.ok, 'E·create', created.ok ? `sesión ${created.code}` : `error ${created.error}`);
  if (!created.ok) process.exit(1);
  const hostId = created.yourResidentId;
  const c2 = await connect();
  const joined = await ack<JoinAck>(c2, 'session:join', { code: created.code });
  assert(joined.ok, 'E·join', joined.ok ? `invitado ${joined.yourResidentId}` : `error ${joined.error}`);
  if (!joined.ok) process.exit(1);
  const guestId = joined.yourResidentId;

  // E·relay — pose legítima del invitado llega fiel al anfitrión.
  {
    const echo = new Promise<{ x: number; z: number; floor: number }>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('sin eco de pose')), 5000);
      c1.once('mp:pose', (p: { from: string; x: number; z: number; floor: number }) => {
        if (p.from !== guestId) return;
        clearTimeout(t);
        resolve(p);
      });
    });
    c2.emit('mp:pose', { x: 1.2, z: -4.5, floor: 0 });
    const p = await echo;
    assert(p.x === 1.2 && p.z === -4.5 && p.floor === 0, 'E·relay', `pose legítima reenviada fiel (${JSON.stringify(p)})`);
  }

  // E·teleport — salto imposible: NO llega a la sala y queda en /health.
  {
    let echo = false;
    const onEcho = (p: { from: string }): void => {
      if (p.from === guestId) echo = true;
    };
    c1.on('mp:pose', onEcho);
    await sleep(150); // ancla del invitado bien puesta
    c2.emit('mp:pose', { x: 400, z: 400, floor: 0 });
    await sleep(700);
    c1.off('mp:pose', onEcho);
    assert(!echo, 'E·teleport', 'salto de ~570 m en 150 ms NO reenviado (autoridad de servidor)');
    const h = await health();
    const row = h.sessions.find((x) => x.code === created.code)!;
    assert(row.metrics.posesRejected >= 1 && row.metrics.violations >= 1, 'E·health', `/health: posesRejected=${row.metrics.posesRejected}, violations=${row.metrics.violations}`);
  }

  // E·spam de ritmo — ráfaga a 8 ms: descartada sin volver al ancla; violaciones NO suben.
  {
    const h0 = (await health()).sessions.find((x) => x.code === created.code)!;
    c2.emit('mp:pose', { x: 1.25, z: -4.5, floor: 0 }); // ancla fresca (legítima)
    await sleep(200);
    for (let i = 0; i < 5; i++) {
      c2.emit('mp:pose', { x: 1.3 + i * 0.01, z: -4.5, floor: 0 });
      await sleep(8);
    }
    await sleep(120);
    const h1 = (await health()).sessions.find((x) => x.code === created.code)!;
    assert(h1.metrics.posesRejected - h0.metrics.posesRejected >= 3, 'E·spam', `ráfaga de ritmo descartada (+${h1.metrics.posesRejected - h0.metrics.posesRejected} rechazos)`);
    assert(h1.metrics.violations === h0.metrics.violations, 'E·spam', 'el spam de ritmo NO cuenta como violación (solo teleports)');
  }

  // E·rate limit de comandos — 40 'work' de golpe: la ventana de 1 s del catálogo frena.
  {
    for (let i = 0; i < 40; i++) c2.emit('session:command', { cmd: { type: 'work' } });
    await sleep(400);
    const h = (await health()).sessions.find((x) => x.code === created.code)!;
    assert(h.metrics.cmdsRejected >= 20, 'E·rate', `comandos rechazados por rate limit: ${h.metrics.cmdsRejected}/40`);
    const st = await waitState(c2, () => true, 'estado tras burst');
    assert(typeof st.world.tick === 'number', 'E·rate', 'el sim sigue vivo tras el burst (broadcast normal)');
  }

  // E·ack — cliente confirma seq: /health refleja lag 0.
  {
    const st = await waitState(c1, () => true, 'seq para ack');
    c1.emit('session:ack', { seq: st.seq });
    c2.emit('session:ack', { seq: st.seq });
    await sleep(300);
    const row = (await health()).sessions.find((x) => x.code === created.code)!;
    assert(row.ackLag.max === 0, 'E·ack', `lag de desync 0 tras ack (${row.acks.length} vecinos confirmaron seq ${st.seq})`);
  }

  // E·persistencia — SIGTERM, relanzar y REJOIN del anfitrión y del invitado.
  let seqBefore = 0;
  {
    const st = await waitState(c2, () => true, 'seq previa al reinicio');
    seqBefore = st.seq;
    const guestHome = st.world.residents[guestId]!.home;
    await stopServer();
    assert(statSync(SNAP).size > 0, 'E·persistencia', `snapshot en disco tras SIGTERM (${SNAP})`);
    await startServer();
    const h = await health();
    const row = h.sessions.find((x) => x.code === created.code);
    assert(!!row && row.restored === true, 'E·persistencia', `sesión ${created.code} REVIVIDA del disco (restored=true, tick=${row?.seq ?? '—'})`);
    // el invitado vuelve con un socket NUEVO (como tras una recarga de página)
    const c3 = await connect();
    const rj = await ack<JoinAck>(c3, 'session:rejoin', { code: created.code, residentId: guestId });
    assert(rj.ok && rj.isHost === false, 'E·persistencia', 'rejoin del invitado tras reinicio: ok');
    const st3 = await waitState(c3, () => true, 'estado tras rejoin invitado');
    assert(st3.world.residents[guestId]?.present === true && st3.world.residents[guestId]?.home === guestHome, 'E·persistencia', `invitado de vuelta en SU vivienda (${guestHome}) y presente`);
    assert(st3.seq > seqBefore, 'E·persistencia', `seq continuó tras el reinicio (${seqBefore} → ${st3.seq})`);
    // el anfitrión también (mundo, marcador y co-op re-difundidos)
    const c4 = await connect();
    const rjh = await ack<JoinAck>(c4, 'session:rejoin', { code: created.code, residentId: hostId });
    assert(rjh.ok && rjh.isHost === true, 'E·persistencia', 'rejoin del ANFITRIÓN tras reinicio: ok (sigue mandando)');
    await sleep(200);
    const row2 = (await health()).sessions.find((x) => x.code === created.code)!;
    assert(row2.participants === 2, 'E·persistencia', `roster restaurado: ${row2.participants}/2 vecinos re-vinculados`);
    c3.disconnect();
    c4.disconnect();
  }

  // E·kick — 120 teleports (~30 ms entre sí): expulsión por anti-cheat.
  {
    const c5 = await connect();
    const j5 = await ack<JoinAck>(c5, 'session:join', { code: created.code });
    assert(j5.ok, 'E·kick', `vecino truhan entra (${j5.ok ? j5.yourResidentId : j5.error})`);
    if (j5.ok) {
      const kicked = new Promise<string>((resolve) => {
        c5.once('session:error', (p: { message: string }) => resolve(p.message));
      });
      // el ancla del truhán: una pose legítima primero
      c5.emit('mp:pose', { x: 2, z: -4, floor: 0 });
      await sleep(150);
      for (let i = 0; i < Number(cfg.kickViolations) + 5; i++) {
        c5.emit('mp:pose', { x: 300 + i, z: 300, floor: 0 });
        await sleep(30); // > minPoseIntervalMs: cada intento cuenta como TELEPORT
      }
      const msg = await kicked;
      assert(msg === 'authority_kick', 'E·kick', `expulsión con ${cfg.kickViolations} teleports → session:error "${msg}"`);
    }
    c5.disconnect();
  }

  c1.disconnect();
  c2.disconnect();
} catch (e) {
  failures += 1;
  console.error('FAIL (E·fatal) ·', e instanceof Error ? e.message : e);
  console.error('--- stdout del servidor ---\n' + outLog.slice(-4000));
  console.error('--- stderr del servidor ---\n' + errLog.slice(-4000));
} finally {
  await stopServer();
  rmSync(SNAP, { force: true }); // el QA limpia su snapshot (el :3010 usa el suyo, canónico)
}

console.log(failures === 0 ? '\nQA-V173 NETCODE · TODO VERDE' : `\nQA-V173 NETCODE · ${failures} fallo(s)`);
process.exit(failures === 0 ? 0 : 1);
