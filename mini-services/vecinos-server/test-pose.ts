/**
 * VECINOS — smoke del protocolo v1.57 (poses de avatares + blindaje de 'move'), hermano de
 * test-client.ts: dos clientes socket.io directos a http://localhost:3010.
 *
 * Asserts:
 *   (a) el invitado emite mp:pose y el anfitrión lo recibe con from = su residente (relay puro).
 *   (b) valores fuera de rango llegan ACOTADOS (x 9999 → ±600, floor −5 → 0): validación del servidor.
 *   (c) el invitado NO puede mover al anfitrión: 'move' con resident ajeno se re-imputa al remitente.
 *   (d) ambos reciben session:state con el MISMO tick (mundo compartido).
 *   (e) los comandos normales del invitado siguen funcionando (move propio OK).
 *
 * PASS/FAIL por consola; process.exit(1) en fallo.
 */
import { io, type Socket } from 'socket.io-client';
import type { World } from '@/game/core/types';

const SERVER_URL = 'http://127.0.0.1:3010'; // IPv4 explícito: bun serve no escucha en ::1

interface StateMsg {
  seq: number;
  world: World;
  events: unknown[];
}
type CreateAck = { ok: true; code: string; isHost: boolean; yourResidentId: string } | { ok: false; error: string };
type JoinAck = { ok: true; code: string; yourResidentId: string } | { ok: false; error: string };

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

function ack<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout esperando ack de ${event}`)), 5000);
    socket.emit(event, payload, (res: T) => {
      clearTimeout(t);
      resolve(res);
    });
  });
}

/** Espera el primer mensaje que cumpla pred (desuscribe al resolver). */
function waitFor<T>(socket: Socket, event: string, pred: (p: T) => boolean, label: string, ms = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const on = (p: T): void => {
      if (!pred(p)) return;
      clearTimeout(t);
      socket.off(event, on);
      resolve(p);
    };
    const t = setTimeout(() => {
      socket.off(event, on);
      reject(new Error(`timeout esperando ${event} (${label})`));
    }, ms);
    socket.on(event, on);
  });
}

const host = await connect();
const guest = await connect();

const createRes = await ack<CreateAck>(host, 'session:create', { scenarioId: 'slice' });
assert(createRes.ok, 'create', createRes.ok ? `sesión ${createRes.code}` : `error ${createRes.error}`);
if (!createRes.ok) process.exit(1);
const hostId = createRes.yourResidentId;

const joinRes = await ack<JoinAck>(guest, 'session:join', { code: createRes.code });
assert(joinRes.ok, 'join', joinRes.ok ? `invitado ${joinRes.yourResidentId}` : `error ${joinRes.error}`);
if (!joinRes.ok) process.exit(1);
const guestId = joinRes.yourResidentId;

// (a) + (b) — relay de poses: el invitado emite normal y abusivo; el anfitrión recibe acotado.
const poseReceived = waitFor<{ from: string; x: number; z: number; floor: number }>(
  host,
  'mp:pose',
  (p) => p.from === guestId,
  'pose del invitado',
);
guest.emit('mp:pose', { x: 1.23, z: -4.56, floor: 0 });
const pose1 = await poseReceived;
assert(
  pose1.from === guestId && pose1.x === 1.23 && pose1.z === -4.56 && pose1.floor === 0,
  'relay',
  `pose fiel recibida por el anfitrión (${JSON.stringify(pose1)})`,
);

const poseClamped = waitFor<{ from: string; x: number; z: number; floor: number }>(
  host,
  'mp:pose',
  (p) => p.from === guestId && p.x !== 9999,
  'pose acotada',
);
guest.emit('mp:pose', { x: 9999, z: -9999, floor: -5 });
const pose2 = await poseClamped;
assert(
  pose2.x === 600 && pose2.z === -600 && pose2.floor === 0,
  'clamp',
  `valores abusivos acotados (${JSON.stringify(pose2)})`,
);

// (c) — el invitado intenta mover AL ANFITRIÓN: el servidor re-imputa el residente.
const stateBefore = await waitFor<StateMsg>(guest, 'session:state', () => true, 'estado previo');
const hostLocBefore = stateBefore.world.residents[hostId]!.location;
const someBlock = Object.keys(stateBefore.world.blocks).find((id) => id !== hostLocBefore)!;
guest.emit('session:command', { cmd: { type: 'move', resident: hostId, to: someBlock } });
const stateAfter = await waitFor<StateMsg>(guest, 'session:state', (s) => s.world.tick >= stateBefore.world.tick, 'estado tras intento');
const hostLocAfter = stateAfter.world.residents[hostId]!.location;
assert(
  hostLocAfter === hostLocBefore,
  'blindaje move',
  `el residente del anfitrión no se movió (${String(hostLocBefore)} → ${String(hostLocAfter)})`,
);

// (e) — el move PROPIO del invitado sigue funcionando.
guest.emit('session:command', { cmd: { type: 'move', resident: guestId, to: someBlock } });
const stateGuest = await waitFor<StateMsg>(
  guest,
  'session:state',
  (s) => s.world.residents[guestId]?.location === someBlock,
  'move propio',
);
assert(stateGuest.world.residents[guestId]!.location === someBlock, 'move propio', `invitado movido a ${someBlock}`);

// (d) — el mismo tick llega a ambos (mundo compartido).
const tickHost = await waitFor<StateMsg>(host, 'session:state', () => true, 'tick anfitrión');
const tickGuest = await waitFor<StateMsg>(guest, 'session:state', () => true, 'tick invitado');
assert(
  tickHost.world.tick === tickGuest.world.tick,
  'mundo compartido',
  `mismo tick en ambos (${tickHost.world.tick})`,
);

host.disconnect();
guest.disconnect();
console.log(failures === 0 ? '\n✔ TODO OK' : `\n✘ ${failures} fallos`);
process.exit(failures === 0 ? 0 : 1);
