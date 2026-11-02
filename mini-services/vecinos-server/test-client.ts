/**
 * VECINOS — verificación estilo smoke del servidor de sesión (protocolo v1), como scripts/smoke-junta.ts.
 * Conecta DOS clientes socket.io directamente a http://localhost:3010 (sin gateway):
 *   c1 = anfitrión (session:create {scenarioId:'slice'}) · c2 = invitado (session:join).
 *
 * Asserts:
 *   (a) el residente del invitado existe en world.residents con controller.type 'human'
 *       y aparece en world.entry (el portal).
 *   (b) el invitado envía {cmd:{type:'work'}} y su cartera sube EXACTAMENTE rules.sim.work.pay
 *       (leído del catálogo, no hardcodeado).
 *   (c) el reloj/tick del mundo avanza entre dos session:state (bucle de tick activo).
 *   (d) el anfitrión recibe session:participants con 2 participantes (él + invitado).
 *   extra: join a código inexistente → ack error 'unknown_code'; set_speed del anfitrión acelera el tick.
 *
 * PASS/FAIL por consola; process.exit(1) en fallo.
 */
import { io, type Socket } from 'socket.io-client';
import { formatIssues, loadContent } from '@/game/content';
import { nextStepTowards } from '@/game/sim/graph';
import type { GameEvent, World } from '@/game/core/types';

const SERVER_URL = 'http://localhost:3010';

interface StateMsg {
  seq: number;
  world: World;
  events: GameEvent[];
}
type CreateAck = { ok: true; code: string; isHost: boolean; yourResidentId: string; scenarioId: string } | { ok: false; error: string };
type JoinAck =
  | { ok: true; code: string; isHost: boolean; yourResidentId: string; scenarioId: string; residentName: string; homeBlock: string }
  | { ok: false; error: string };

let failures = 0;
function assert(cond: boolean, label: string, msg: string): void {
  if (cond) console.log(`PASS (${label}) · ${msg}`);
  else {
    failures += 1;
    console.error(`FAIL (${label}) · ${msg}`);
  }
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(SERVER_URL);
    const t = setTimeout(() => reject(new Error('timeout conectando al servidor')), 5000);
    s.on('connect', () => {
      clearTimeout(t);
      resolve(s);
    });
    s.on('connect_error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

/** Emite y espera el ack (segundo argumento callback del protocolo). */
function ack<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout esperando ack de ${event}`)), 5000);
    socket.emit(event, payload, (res: T) => {
      clearTimeout(t);
      resolve(res);
    });
  });
}

/** Resuelve con el primer session:state que cumpla pred (desuscribe al resolver). */
function waitState(socket: Socket, pred: (s: StateMsg) => boolean, label: string, ms = 10000): Promise<StateMsg> {
  return new Promise((resolve, reject) => {
    const on = (s: StateMsg): void => {
      if (!pred(s)) return;
      clearTimeout(t);
      socket.off('session:state', on);
      resolve(s);
    };
    const t = setTimeout(() => {
      socket.off('session:state', on);
      reject(new Error(`timeout esperando session:state (${label})`));
    }, ms);
    socket.on('session:state', on);
  });
}

/** Resuelve con la primera lista de participantes que cumpla pred. */
function waitParticipants(
  socket: Socket,
  pred: (p: { id: string; name: string; home: string }[]) => boolean,
  label: string,
  ms = 10000,
): Promise<{ id: string; name: string; home: string }[]> {
  return new Promise((resolve, reject) => {
    const on = (msg: { participants: { id: string; name: string; home: string }[] }): void => {
      if (!pred(msg.participants)) return;
      clearTimeout(t);
      socket.off('session:participants', on);
      resolve(msg.participants);
    };
    const t = setTimeout(() => {
      socket.off('session:participants', on);
      reject(new Error(`timeout esperando session:participants (${label})`));
    }, ms);
    socket.on('session:participants', on);
  });
}

const clockMinutes = (s: StateMsg): number => s.world.clock.day * 1440 + s.world.clock.minute;

// ── Contenido: para leer pay del catálogo (cero números hardcodeados) ──
const { content, issues } = await loadContent(new URL('../../public/content/', import.meta.url).href);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}
const pay = content.rules.sim.work.pay;

// ── c1: anfitrión ──
const c1 = await connect();
const created = await ack<CreateAck>(c1, 'session:create', { scenarioId: 'slice' });
if (!created.ok) {
  console.error('FAIL · session:create →', created.error);
  process.exit(1);
}
console.log(`sesión ${created.code} · anfitrión ${created.yourResidentId} · escenario ${created.scenarioId}`);
assert(/^[A-HJ-NP-Z2-9]{4}$/.test(created.code), 'setup', 'código de sesión: 4 caracteres de A-Z2-9 sin 0/O/1/I');
assert(created.isHost === true, 'setup', 'ack de create marca isHost=true');

// Escuchas ANTES del join (las emisiones del servidor llegan justo tras el ack).
const participantsPromise = waitParticipants(c1, (p) => p.length === 2, '2 participantes');

// ── c2: invitado ──
const c2 = await connect();
const firstStatePromise = waitState(c2, () => true, 'primer state del invitado');
const joined = await ack<JoinAck>(c2, 'session:join', { code: created.code });
if (!joined.ok) {
  console.error('FAIL · session:join →', joined.error);
  process.exit(1);
}
assert(joined.isHost === false && joined.code === created.code, 'setup', 'ack de join marca isHost=false y el código coincide');
assert(joined.yourResidentId.startsWith('res_guest_'), 'setup', `invitado ${joined.yourResidentId} · residentName="${joined.residentName}" · homeBlock=${joined.homeBlock}`);
assert(joined.residentName === content.archetypes[content.rules.multiplayer.guestArchetype]?.name, 'setup', 'residentName = nombre del arquetipo invitado del catálogo');

// extra: código inexistente → unknown_code (contrato de errores)
const c3 = await connect();
const badJoin = await ack<JoinAck>(c3, 'session:join', { code: 'ZZZZ' });
assert(!badJoin.ok && badJoin.error === 'unknown_code', 'extra', "join a código inexistente → ack { ok:false, error:'unknown_code' }");
c3.disconnect();

// (a) primer state del invitado: su residente existe, es humano y está en el portal
const first = await firstStatePromise;
const me = first.world.residents[joined.yourResidentId];
assert(!!me && me.controller.type === 'human', 'a', `residente ${joined.yourResidentId} existe en world.residents con controller humano`);
assert(me?.home === joined.homeBlock, 'a', `su vivienda es la del ack (${joined.homeBlock}) y el bloque queda occupied`);
assert(first.world.blocks[joined.homeBlock]?.occupancy === 'occupied' && first.world.blocks[joined.homeBlock]?.ownerId === joined.yourResidentId, 'a', `bloque ${joined.homeBlock} occupancy=occupied ownerId=${joined.yourResidentId}`);
assert(me?.location === first.world.entry, 'a', `el invitado aparece en el portal (world.entry=${first.world.entry})`);

// (b) work del invitado: cartera +rules.sim.work.pay
// v1.39 «el portátil vive en casa»: el sim exige location===home y el invitado nace en el
// portal, así que CAMINA a su vivienda con pasos del grafo del sim (nextStepTowards — misma
// verdad que usa la IA) y después cobra. De paso: moves encadenados por el grafo, contrato
// del router de movimiento en vivo (el humo del antiguo 'work' a distancia se acabó).
{
  let loc: string = me!.location ?? '';
  let guard = 0;
  while (loc !== joined.homeBlock && guard++ < 24) {
    const step = nextStepTowards(first.world, content, loc, joined.homeBlock);
    if (!step) break;
    c2.emit('session:command', { cmd: { type: 'move', resident: joined.yourResidentId, to: step } });
    const st = await waitState(c2, (s) => s.world.residents[joined.yourResidentId]?.location === step, `paso ${step}`);
    loc = st.world.residents[joined.yourResidentId]!.location ?? '';
  }
  assert(loc === joined.homeBlock, 'b', `el invitado caminó a SU vivienda por el grafo (${loc}, ${guard} pasos)`);
  const walletBefore = first.world.residents[joined.yourResidentId]!.wallet;
  c2.emit('session:command', { cmd: { type: 'work' } });
  const afterWork = await waitState(c2, (s) => (s.world.residents[joined.yourResidentId]?.wallet ?? walletBefore) !== walletBefore, 'wallet tras work');
  const walletAfter = afterWork.world.residents[joined.yourResidentId]!.wallet;
  assert(walletAfter === walletBefore + pay, 'b', `cartera del invitado ${walletBefore} → ${walletAfter} (+${pay}, rules.sim.work.pay del catálogo)`);
}

// (c) el reloj del mundo avanza entre dos states (bucle de tick activo)
const s1 = await waitState(c2, () => true, 'state 1 para el reloj');
const s2 = await waitState(c2, (s) => s.world.tick > s1.world.tick, 'state 2 para el reloj');
assert(s2.world.tick > s1.world.tick && clockMinutes(s2) > clockMinutes(s1), 'c', `tick ${s1.world.tick} → ${s2.world.tick} · reloj día ${s1.world.clock.day} ${s1.world.clock.minute}′ → día ${s2.world.clock.day} ${s2.world.clock.minute}′`);

// (d) el anfitrión ve 2 participantes
const participants = await participantsPromise;
assert(participants.length === 2, 'd', `anfitrión recibe session:participants con ${participants.length} participantes`);
assert(
  participants.some((p) => p.id === created.yourResidentId) && participants.some((p) => p.id === joined.yourResidentId),
  'd',
  `participantes = anfitrión (${created.yourResidentId}) + invitado (${joined.yourResidentId})`,
);

// extra: set_speed del anfitrión → el intervalo avanza `speed` ticks por broadcast
c1.emit('session:set_speed', { speed: 10 });
const f1 = await waitState(c1, () => true, 'state 1 con velocidad');
const f2 = await waitState(c1, (s) => s.world.tick > f1.world.tick, 'state 2 con velocidad');
assert(f2.world.tick - f1.world.tick >= 3, 'extra', `con speed=10 el delta de ticks por broadcast es ${f2.world.tick - f1.world.tick} (>=3)`);

c1.disconnect();
c2.disconnect();
console.log(failures === 0 ? 'TEST-CLIENT OK · asserts (a)(b)(c)(d) + extras en PASS' : `TEST-CLIENT con ${failures} fallo(s)`);
process.exit(failures === 0 ? 0 : 1);
