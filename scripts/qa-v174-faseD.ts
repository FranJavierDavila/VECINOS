/**
 * VECINOS — QA FASE D · DISEÑO DE RETENCIÓN (v1.74), estilo qa-v173-netcode.
 *
 * Dos partes:
 *  U — UNIDAD (sin red): matemática de la economía balanceada (tarifa de trabajo dentro
 *      del presupuesto de diseño, coste total del mobiliario, horizonte > 1 sesión,
 *      cartera de invitado útil), catálogo de puntos «Vecino del mes» (exclusiones QA
 *      automáticas, bonus de saga existentes, LOS 6 minijuegos catalogados, tokens
 *      {label} en toasts y tablón) y co-op con recompensa (fundsBonus + {funds}).
 *  E — E2E contra SU PROPIO servidor (VECINOS_QA_PORT=3017, nunca toca el :3010 real):
 *      misión EXCLUIDA (m_qa_1, escenario 'qa') → 0 pts; misión normal → +100;
 *      récord de minijuego catalogado (mg_buzones) → +50, mejora → +50, marca peor →
 *      sin puntos; CO-OP completa → +150 pts y +100 € POR ROL (wallet visible en el
 *      mundo) con toast del catálogo; trabajo → +90 € exactos (economía nueva).
 *
 * PASS/FAIL por consola; process.exit(1) en fallo.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { loadContent, formatIssues } from '@/game/content';
import { nextStepTowards } from '@/game/sim/graph';
import type { World } from '@/game/core/types';

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

// U·economía — tarifa de trabajo y horizonte del mobiliario según el one-pager.
{
  const work = content.rules.sim.work;
  const tickSecs = content.rules.multiplayer.tickSecondsPerTick;
  const rate = work.pay / (work.cooldownTicks * tickSecs) * 60; // €/min de grinding activo
  assert(work.pay === 90 && work.cooldownTicks === 150, 'U·economía', `trabajo = ${work.pay} € / ${work.cooldownTicks} ticks (antes 120/120: 60 €/min compraba el edificio en 40 min)`);
  assert(rate > 30 && rate < 45, 'U·economía', `tarifa ${rate.toFixed(0)} €/min dentro del presupuesto de diseño (30–45)`);
  const furnitureTotal = Object.values(content.furniture).reduce((s, f) => s + f.price, 0);
  assert(furnitureTotal > 2600 && furnitureTotal < 2900, 'U·economía', `mobiliario total ${furnitureTotal} € (objetivo one-pager: 2.765)`);
  // Horizonte: el set COMPLETO no cabe en una sesión de 60 min ni puro grinding (60 × 36 = 2160).
  assert(furnitureTotal > 60 * rate, 'U·economía', `set completo (${furnitureTotal} €) exige > 1 sesión de 60 min: hay horizonte`);
  const cheapest = Math.min(...Object.values(content.furniture).map((f) => f.price));
  const guestWallet = content.rules.multiplayer.guestWallet;
  assert(cheapest * 2 <= guestWallet, 'U·economía', `invitado (${guestWallet} €) compra ≥ 2 piezas baratas (mínima ${cheapest} €): arranque con meta`);
}

// U·puntos — catálogo «Vecino del mes» completo y exclusiones correctas.
{
  const score = content.rules.multiplayer.score;
  assert(!!score, 'U·puntos', 'rules.multiplayer.score presente');
  if (!score) process.exit(1);
  const missionIds = new Set(Object.keys(content.missions));
  const qaIds = [...missionIds].filter((id) => id.startsWith('m_qa'));
  const excluded = new Set(score.excluded ?? []);
  assert(qaIds.length > 0 && qaIds.every((id) => excluded.has(id)), 'U·puntos', `todas las misiones QA excluidas (${qaIds.join(', ')})`);
  assert([...excluded].every((id) => missionIds.has(id)), 'U·puntos', 'excluded no referencia misiones inexistentes (catálogo limpio)');
  const bonusIds = Object.keys(score.missionBonus);
  assert(bonusIds.length === 8 && bonusIds.every((id) => missionIds.has(id)), 'U·puntos', `8 bonus de saga/historia y todos existentes (${bonusIds.join(', ')})`);
  const mgIds = Object.keys(content.minigames);
  const scored = Object.keys(score.minigames);
  assert(mgIds.every((id) => scored.includes(id)), 'U·puntos', `LOS ${mgIds.length} minijuegos del catálogo puntúan (antes solo mg_fusibles: 5 daban 0)`);
  assert(Object.values(score.minigames).every((m) => m.pointsPerRecord >= 1 && !!m.label), 'U·puntos', 'cada minijuego con label y pointsPerRecord ≥ 1');
  assert(score.recordToast.includes('{label}') && score.firstToast.includes('{label}'), 'U·puntos', 'toasts de récord nombran el minijuego ({label})');
  assert((score.boardExtraBest ?? '').includes('{label}') && (score.boardExtraBest ?? '').includes('{secs}'), 'U·puntos', 'tablón con marca genérica {label} {secs}');
}

// U·co-op — las 3 misiones pulidas: pts ≥ 150, dinero por rol y toast con {funds}.
{
  const coop = content.multiplayer?.coop;
  assert(!!coop && coop.missions.length === 3, 'U·co-op', '3 misiones cooperativas (pulidas > 20 mediocres)');
  if (!coop) process.exit(1);
  for (const m of coop.missions) {
    assert(m.pointsBonus >= 150, 'U·co-op', `${m.id}: +${m.pointsBonus} pts por rol`);
    assert((m.fundsBonus ?? 0) >= 100, 'U·co-op', `${m.id}: +${m.fundsBonus} € por rol (antes 0 €)`);
    assert(m.completeToast.includes('{funds}') && m.completeToast.includes('{points}'), 'U·co-op', `${m.id}: toast anuncia pts y €`);
    assert(m.roles.length >= 2, 'U·co-op', `${m.id}: ${m.roles.length} roles (hay reparto)`);
  }
}

// ═══════════════════════════ E — E2E (servidor propio :3017) ═══════════════════════════

const QA_PORT = 3017;
const QA_URL = `http://127.0.0.1:${QA_PORT}`;
const SNAP = `/tmp/vecinos-sessions-${QA_PORT}.json`;
rmSync(SNAP, { force: true }); // el QA nace limpio (el :3010 usa el suyo, canónico)

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
  await Promise.race([exited, sleep(4000)]);
  if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
  server = null;
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
  events: { type: string; data: Record<string, unknown> }[];
}
function waitState(socket: Socket, pred: (s: StateMsg) => boolean, label: string, ms = 15_000): Promise<StateMsg> {
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

interface ScoreMsg {
  rows: { residentId: string; name: string; points: number; best: Record<string, number>; top: boolean }[];
}
/** Espera el siguiente session:score y devuelve la fila de un residente (con predicado opcional). */
function waitScore(socket: Socket, residentId: string, label: string, ms = 8000, want?: (row: ScoreMsg['rows'][number]) => boolean): Promise<ScoreMsg['rows'][number]> {
  return new Promise((resolve, reject) => {
    const on = (p: ScoreMsg): void => {
      const row = p.rows?.find((r) => r.residentId === residentId);
      if (!row) return;
      if (want && !want(row)) return;
      clearTimeout(t);
      socket.off('session:score', on);
      resolve(row);
    };
    const t = setTimeout(() => {
      socket.off('session:score', on);
      reject(new Error(`timeout session:score (${label})`));
    }, ms);
    socket.on('session:score', on);
  });
}

type CreateAck = { ok: true; code: string; isHost: boolean; yourResidentId: string } | { ok: false; error: string };
type JoinAck = { ok: true; code: string; isHost: boolean; yourResidentId: string; homeBlock: string } | { ok: false; error: string };
type CoopMsg = { active: { mission: { id: string; title: string }; roles: { roleId: string; residentId: string | null; done: boolean }[] } | null; done: string[] };

/** Camina a un residente hasta `target` con pasos del grafo del sim (misma verdad que la IA). */
async function walk(socket: Socket, residentId: string, target: string): Promise<void> {
  let world = (await waitState(socket, () => true, 'estado para caminar')).world;
  for (let i = 0; i < 60; i++) {
    const loc: string = world.residents[residentId]!.location ?? '';
    if (loc === target) return;
    const step = nextStepTowards(world, content, loc, target);
    if (!step) throw new Error(`sin ruta de grafo ${loc} → ${target}`);
    socket.emit('session:command', { cmd: { type: 'move', resident: residentId, to: step } });
    const nxt = await waitState(socket, (s) => s.world.residents[residentId]!.location !== loc, 'paso de grafo', 5000);
    world = nxt.world;
  }
  throw new Error(`caminata agotada hacia ${target}`);
}

try {
  await startServer();
  assert(true, 'E·arranque', `servidor QA vivo en :${QA_PORT} (VECINOS_QA_PORT)`);

  // ── SESIÓN 1 · escenario 'qa' (qa_mode=1 → m_qa_1 activa de fábrica, EXCLUIDA del ranking) ──
  const c1 = await connect();
  const created = await ack<CreateAck>(c1, 'session:create', { scenarioId: 'qa' });
  assert(created.ok, 'E·create', created.ok ? `sesión ${created.code} con escenario 'qa'` : `error ${created.error}`);
  if (!created.ok) process.exit(1);
  const hostId = created.yourResidentId;
  const c2 = await connect();
  const joined = await ack<JoinAck>(c2, 'session:join', { code: created.code });
  assert(joined.ok, 'E·join', joined.ok ? `invitado ${joined.yourResidentId} en ${joined.homeBlock}` : `error ${joined.error}`);
  if (!joined.ok) process.exit(1);
  const guestId = joined.yourResidentId;
  const guestHome = joined.homeBlock;

  // E·excluida — m_qa_1 completada (llamada → elección) y NO puntúa: 0 pts para el anfitrión.
  {
    c1.emit('session:command', { cmd: { type: 'answer_call', mission: 'm_qa_1' } });
    const st = await waitState(
      c1,
      (s) => s.world.missions.some((m) => m.id === 'm_qa_1' && m.state === 'awaiting_choice'),
      'm_qa_1 en espera de elección',
    );
    assert(st.world.missions.find((m) => m.id === 'm_qa_1')?.state === 'awaiting_choice', 'E·excluida', 'm_qa_1 activa y esperando elección (llamada respondida)');
    c1.emit('session:command', { cmd: { type: 'choose', mission: 'm_qa_1', choice: 'jugar' } });
    await waitState(c1, (s) => s.events.some((e) => e.type === 'mission_completed' && e.data.mission === 'm_qa_1'), 'm_qa_1 completada');
    await sleep(400); // márgen para un session:score espurio
    const row = await waitScore(c1, hostId, 'marcador tras m_qa_1', 3000).catch(() => null);
    assert(row === null || row.points === 0, 'E·excluida', `m_qa_1 completada → ${row?.points ?? 0} pts (excluida por score.excluded)`);
  }

  // E·récord — mg_buzones catalogado (v1.73 solo tenía mg_fusibles): éxito → +50; mejorar → +50; empeorar → nada.
  {
    // el toast del PRIMER récord nombra el minijuego ({label} del catálogo)
    const toastP = waitState(c2, (s) => s.events.some((e) => e.type === 'ui_toast' && String(e.data.text).includes('buzones revueltos')), 'toast con label', 8000).catch(() => null);
    c2.emit('session:command', { cmd: { type: 'complete_minigame', id: 'mg_buzones', success: true } });
    c2.emit('session:minigame_time', { id: 'mg_buzones', secs: 42.3 });
    let row = await waitScore(c2, guestId, 'récord inicial');
    assert(row.points === 50 && Math.abs((row.best['mg_buzones'] ?? 0) - 42.3) < 0.01, 'E·récord', `mg_buzones 42,3 s → ${row.points} pts, mejor marca ${row.best['mg_buzones']}`);
    // mejorar la marca: +50 otra vez (el rate limit del catálogo exige 3 s entre marcas)
    await sleep(3_200);
    c2.emit('session:command', { cmd: { type: 'complete_minigame', id: 'mg_buzones', success: true } });
    c2.emit('session:minigame_time', { id: 'mg_buzones', secs: 30 });
    row = await waitScore(c2, guestId, 'récord mejorado');
    assert(row.points === 100 && row.best['mg_buzones'] === 30, 'E·récord', `mejora a 30,0 s → ${row.points} pts (solo puntúa MEJORAR)`);
    // marca peor: sin puntos ni cambio de marca
    c2.emit('session:command', { cmd: { type: 'complete_minigame', id: 'mg_buzones', success: true } });
    c2.emit('session:minigame_time', { id: 'mg_buzones', secs: 55 });
    await sleep(1500);
    const stale = await toastP;
    const scoreNow = await new Promise<ScoreMsg>((resolve) => {
      c2.once('session:score', resolve);
      setTimeout(() => resolve({ rows: [] }), 1200);
    });
    const rowNow = scoreNow.rows.find((r) => r.residentId === guestId);
    assert(rowNow === undefined || (rowNow.points === 100 && rowNow.best['mg_buzones'] === 30), 'E·récord', `marca peor (55 s) ignorada: sigue con ${rowNow?.points ?? 100} pts y marca ${rowNow?.best['mg_buzones'] ?? 30} s`);
    assert(stale !== null, 'E·récord', 'el toast de récord nombra el minijuego ({label} del catálogo: «buzones revueltos»)');
  }

  // E·co-op — reparto de roles, cierre, y RECOMPENSA: +150 pts y +100 € por rol (wallet real).
  {
    const coopDoneP = new Promise<CoopMsg>((resolve) => {
      const h = (p: CoopMsg): void => {
        if (p.done?.includes('coop_apagon')) {
          c2.off('coop:state', h);
          resolve(p);
        }
      };
      c2.on('coop:state', h);
    });
    const bonus = content.multiplayer!.coop.missions[0]!.pointsBonus;
    const rowGP = waitScore(c2, guestId, 'pts co-op invitado', 8000, (r) => r.points >= bonus + 100);
    const rowHP = waitScore(c1, hostId, 'pts co-op anfitrión', 8000, (r) => r.points >= bonus);
    const beforeP = waitState(c2, () => true, 'estado pre-co-op');
    const toastP = waitState(c2, (s) => s.events.some((e) => e.type === 'ui_toast' && String(e.data.text).includes('+150 pts y +100 €')), 'toast co-op con pts y €', 8000).catch(() => null);
    const missionId = 'coop_apagon';
    c1.emit('coop:claim', { missionId, roleId: 'electricista' });
    c2.emit('coop:claim', { missionId, roleId: 'mediador' });
    await sleep(400);
    const walletBefore = (await beforeP).world.residents[guestId]!.wallet;
    const afterWalletP = waitState(c2, (s) => s.world.residents[guestId]!.wallet > walletBefore, 'wallet tras co-op');
    c1.emit('coop:progress', { missionId, roleId: 'electricista' });
    c2.emit('coop:progress', { missionId, roleId: 'mediador' });
    const [rowH, rowG, after, doneState, doneToast] = await Promise.all([rowHP, rowGP, afterWalletP, coopDoneP, toastP]);
    const funds = content.multiplayer!.coop.missions[0]!.fundsBonus ?? 0;
    assert(rowH.points === 0 + bonus && rowG.points === 100 + bonus, 'E·co-op', `cierre en equipo: anfitrión ${rowH.points} pts, invitado ${rowG.points} pts (+${bonus} por rol)`);
    const gained = after.world.residents[guestId]!.wallet - walletBefore;
    assert(gained === funds, 'E·co-op', `invitado cobra +${gained} € en SU cartera (fundsBonus ${funds}: el dinero en equipo existe)`);
    assert(doneState.done.includes('coop_apagon'), 'E·co-op', 'historial co-op: coop_apagon archivada');
    assert(!!doneToast, 'E·co-op', `toast del catálogo: «+${bonus} pts y +${funds} € para cada uno»`);
  }

  // E·work — la tarifa nueva (90 €) llega intacta al mundo: el invitado camina a casa y cobra.
  {
    const before = await waitState(c2, () => true, 'estado pre-work');
    const walletBefore = before.world.residents[guestId]!.wallet;
    await walk(c2, guestId, guestHome);
    c2.emit('session:command', { cmd: { type: 'work' } });
    const after = await waitState(c2, (s) => s.events.some((e) => e.type === 'work_done'), 'work_done');
    const pay = after.world.residents[guestId]!.wallet - walletBefore;
    assert(pay === content.rules.sim.work.pay, 'E·work', `trabajo paga +${pay} € (tarifa nueva del catálogo: ${content.rules.sim.work.pay}, antes 120)`);
  }
  c1.disconnect();
  c2.disconnect();

  // ── SESIÓN 2 · escenario 'slice' — E·normal: m_bienvenida completa → +100 pts base ──
  {
    const c3 = await connect();
    const created2 = await ack<CreateAck>(c3, 'session:create', { scenarioId: 'slice' });
    assert(created2.ok, 'E·normal', created2.ok ? `sesión ${created2.code} con escenario 'slice'` : `error ${created2.error}`);
    if (!created2.ok) process.exit(1);
    const host2 = created2.yourResidentId;
    const home2 = (await waitState(c3, () => true, 'estado slice')).world.residents[host2]!.home;
    // 1) teléfono del tutorial (paso phone_call)
    c3.emit('session:command', { cmd: { type: 'answer_call', mission: 'm_bienvenida' } });
    await waitState(c3, (s) => s.world.missions.find((m) => m.id === 'm_bienvenida')?.step === 1, 'paso reach de bienvenida');
    // 2) caminar a casa y tocar la puerta (paso reach: door_approached)
    await walk(c3, host2, home2);
    c3.emit('session:command', { cmd: { type: 'approach', resident: host2, block: home2 } });
    await waitState(c3, (s) => s.world.missions.find((m) => m.id === 'm_bienvenida')?.step === 2, 'paso enter de bienvenida');
    // 3) salir un paso y volver a entrar (paso enter: block_entered en $home)
    const world2 = (await waitState(c3, () => true, 'estado antes de salir')).world;
    const out = nextStepTowards(world2, content, home2, 'blk_p0_portal');
    const rowP = waitScore(c3, host2, 'marcador tras misión normal'); // attach ANTES del cierre
    if (out) {
      c3.emit('session:command', { cmd: { type: 'move', resident: host2, to: out } });
      await waitState(c3, (s) => s.world.residents[host2]!.location !== home2, 'salir de casa', 5000);
    }
    c3.emit('session:command', { cmd: { type: 'move', resident: host2, to: home2 } });
    await waitState(c3, (s) => s.events.some((e) => e.type === 'mission_completed' && e.data.mission === 'm_bienvenida'), 'm_bienvenida completada');
    const row = await rowP;
    assert(row.points === content.rules.multiplayer.score!.missionCompletedPoints, 'E·normal', `m_bienvenida completa → ${row.points} pts (base ${content.rules.multiplayer.score!.missionCompletedPoints}, sin bonus de saga)`);
    c3.disconnect();
  }
} catch (e) {
  failures += 1;
  console.error('FAIL (E·fatal) ·', e instanceof Error ? e.message : e);
  console.error('--- stdout del servidor ---\n' + outLog.slice(-4000));
  console.error('--- stderr del servidor ---\n' + errLog.slice(-4000));
} finally {
  await stopServer();
  rmSync(SNAP, { force: true }); // el QA limpia su snapshot (el :3010 usa el suyo, canónico)
}

console.log(failures === 0 ? '\nQA-V174 FASE D · TODO VERDE' : `\nQA-V174 FASE D · ${failures} fallo(s)`);
process.exit(failures === 0 ? 0 : 1);
