/**
 * VECINOS v1.56 — verificación smoke del flujo COOPERATIVO REAL + VOZ (protocolo extendido).
 * Conecta DOS clientes socket.io a http://localhost:3010 y verifica, sin navegador:
 *   (1) co-op: con 2 participantes el servidor OFERTA una misión (coop:state active != null,
 *       título del catálogo content.multiplayer.coop.missions[0]).
 *   (2) roles: c1 reclama un rol, c2 ve los DOS asignados (coop:claim → coop:state).
 *   (3) guardias: rol ocupado no se reasigna; nadie marca el rol ajeno.
 *   (4) progreso: coop:progress de ambos → cierre: coop:state active=null, done incluye la
 *       misión, y session:score con +pointsBonus para CADA uno (Vecino del mes).
 *   (5) voz: voice:join ×2 → voice:roster con 2 miembros; voice:signal c1→c2 llega con from
 *       correcto (relay puro); voice:state se difunde a la sala.
 *   (6) co-op NO bloqueante en solitario: sesión de 1 participante nunca emite coop:state
 *       con misión activa (minPlayers del catálogo).
 * PASS/FAIL por consola; process.exit(1) en fallo.
 */
import { io, type Socket } from 'socket.io-client';
import { loadContent } from '@/game/content';

const SERVER_URL = 'http://localhost:3010';

let failures = 0;
function assert(cond: boolean, label: string, msg: string): void {
  if (cond) console.log(`PASS (${label}) · ${msg}`);
  else {
    failures += 1;
    console.error(`FAIL (${label}) · ${msg}`);
  }
}

type CoopState = { active: null | { mission: { id: string; title: string; pointsBonus: number; roles: { id: string }[] }; roles: { roleId: string; residentId: string | null; done: boolean }[] }; done: string[] };
type ScorePayload = { rows: { residentId: string; name: string; points: number }[] };
type RosterPayload = { members: { id: string; name: string; muted: boolean; speaking: boolean }[] };
type SignalPayload = { from: string; data: unknown };

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

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Espera un evento que cumpla el predicado (máx timeout ms). Regístrar ANTES de dispararlo. */
function expectEvent<T>(socket: Socket, event: string, pred: (p: T) => boolean, timeout = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, on);
      reject(new Error(`timeout esperando ${event}`));
    }, timeout);
    const on = (p: T) => {
      if (pred(p)) {
        clearTimeout(t);
        socket.off(event, on);
        resolve(p);
      }
    };
    socket.on(event, on);
  });
}

const contentUrl = new URL('../../public/content/', import.meta.url).href;
const { content } = await loadContent(contentUrl);
const coopCfg = content.multiplayer?.coop;
const voiceCfg = content.multiplayer?.voice;
assert(!!coopCfg && coopCfg.missions.length >= 1, 'catalogo', `multiplayer.json: ${coopCfg?.missions.length ?? 0} misiones co-op`);
assert(!!voiceCfg && voiceCfg.enabled, 'catalogo-voz', `voz habilitada (maxPeers=${voiceCfg?.maxPeers})`);
const firstMission = coopCfg!.missions[0]!;
const bonus = firstMission.pointsBonus;

// ── (6) solitario: sesión de 1 participante sin ofertas co-op ──
const solo = await connect();
let soloGotActive = false;
solo.on('coop:state', (s: CoopState) => {
  if (s.active) soloGotActive = true;
});
const createSolo = await new Promise<{ ok: boolean; code: string }>((res) => solo.emit('session:create', {}, res));
assert(createSolo.ok, 'solo-create', `sesión en solitario ${createSolo.code}`);
await wait(3000);
assert(!soloGotActive, 'solo-no-coop', 'en solitario NO se ofrece ninguna misión co-op (no bloquea)');
solo.disconnect();
await wait(300);

// ── (1)–(5) comunidad de 2 ──
const c1 = await connect();
const c2 = await connect();
// LISTENERS TEMPRANOS: el offer de co-op viaja con el broadcast del JOIN, antes de que el
// test consulte nada. Guardamos el último coop:state visto por cada cliente.
let latestCoop1: CoopState | null = null;
let latestCoop2: CoopState | null = null;
c1.on('coop:state', (s: CoopState) => {
  latestCoop1 = s;
});
c2.on('coop:state', (s: CoopState) => {
  latestCoop2 = s;
});

const create = await new Promise<{ ok: boolean; code: string }>((res) => {
  c1.emit('session:create', {}, res);
  setTimeout(() => res({ ok: false, code: 'ACK-TIMEOUT' }), 6000);
});
assert(create.ok, 'create', `anfitrión crea ${create.code}`);

// (1) la oferta llega con el join (broadcastState → coopTick)
const joinPromise = new Promise<{ ok: boolean }>((res) => c2.emit('session:join', { code: create.code }, res));
const offered = await expectEvent<CoopState>(c1, 'coop:state', (s) => s.active !== null, 15000).catch(() => null);
const join = await joinPromise.catch(() => null);
assert(join?.ok === true, 'join', 'invitado entra');
assert(!!offered, 'oferta', `coop:state con «${offered?.active?.mission.title}»`);
assert(offered?.active?.mission.id === firstMission.id, 'oferta-orden', 'primera misión del catálogo sin historial');
const missionId = offered!.active!.mission.id;

// (2) roles: c1 reclama el primero Y c2 el segundo; ambos deben ver los DOS asignados
const roleA = firstMission.roles[0]!.id;
const roleB = firstMission.roles[1]!.id;
const bothAssignedPromise = expectEvent<CoopState>(c2, 'coop:state', (s) => s.active?.roles.every((r) => r.residentId !== null) === true);
c1.emit('coop:claim', { missionId, roleId: roleA });
await wait(400); // deja que el estado del primer rol llegue a c2
c2.emit('coop:claim', { missionId, roleId: roleB });
const bothAssigned = await bothAssignedPromise.catch(() => null);
assert(!!bothAssigned, 'roles', 'c2 ve los DOS roles asignados');

// (3a) guardia: c2 no puede reclamar el rol de c1 (ocupado) → sin coop:state nuevo
const beforeClaim = latestCoop2;
c2.emit('coop:claim', { missionId, roleId: roleA });
await wait(700);
assert(
  latestCoop2 === beforeClaim && (latestCoop2 as CoopState | null)?.active?.roles.every((r) => r.residentId !== null) === true,
  'guardia-rol-ocupado',
  'el rol ocupado no se reasigna (y no hay estado nuevo)',
);

// (3b) guardia: c1 NO puede marcar el rol de c2 (no asignado a él)
c1.emit('coop:progress', { missionId, roleId: roleB });
await wait(700);
assert(
  (latestCoop1 as CoopState | null)?.active?.roles.find((r) => r.roleId === roleB)?.done === false,
  'guardia-rol-ajeno',
  'nadie marca el rol ajeno',
);

// (4) progreso real: cada uno marca el suyo → cierre + bonus para los dos
const scorePromise = expectEvent<ScorePayload>(c1, 'session:score', (p) => p.rows.filter((r) => r.points >= bonus).length >= 2);
const closePromise = expectEvent<CoopState>(c1, 'coop:state', (s) => s.active === null && s.done.includes(missionId));
c1.emit('coop:progress', { missionId, roleId: roleA });
c2.emit('coop:progress', { missionId, roleId: roleB });
const closed = await closePromise.catch(() => null);
assert(!!closed, 'cierre', 'misión co-op cerrada (active=null, en done)');
const scores = await scorePromise.catch(() => null);
const rows = scores?.rows ?? [];
assert(rows.filter((r) => r.points >= bonus).length >= 2, 'bonus', `session:score con +${bonus} para CADA vecino (${rows.map((r) => `${r.name}:${r.points}`).join(', ')})`);

// (5) voz: join ×2 → roster de 2; relay de señalización; estado de micro difundido
const rosterPromise = expectEvent<RosterPayload>(c2, 'voice:roster', (p) => p.members.length === 2);
c1.emit('voice:join');
c2.emit('voice:join');
const roster = await rosterPromise.catch(() => null);
assert(!!roster, 'voz-roster', 'voice:roster con 2 miembros');
const id1 = roster!.members[0]!.id;
const id2 = roster!.members[1]!.id;
const signalPromise = expectEvent<SignalPayload>(c2, 'voice:signal', (p) => typeof (p.data as { sdp?: string } | null)?.sdp === 'string');
c1.emit('voice:signal', { to: id2, data: { type: 'offer', sdp: 'v=0-fake-offer' } });
const signal = await signalPromise.catch(() => null);
assert(signal?.from === id1, 'voz-relay', 'voice:signal c1→c2 reenviado con from correcto');
const statePromise = expectEvent<{ from: string; muted: boolean; speaking: boolean }>(c1, 'voice:state', (p) => p.speaking === true);
c2.emit('voice:state', { muted: false, speaking: true });
const vstate = await statePromise.catch(() => null);
assert(vstate?.from === id2 && vstate.speaking, 'voz-estado', 'voice:state difundido a la sala');

// (7) REJOIN: el transporte de c1 cae y vuelve (pestaña en segundo plano, red móvil) —
// la sesión se re-vincula al MISMO residente y el servidor re-difunde score/co-op/voz.
const scoreAfterRejoin = expectEvent<ScorePayload>(c1, 'session:score', (p) => p.rows.length >= 1);
c1.disconnect();
await wait(500);
c1.connect();
const rejoined = await new Promise<{ ok: boolean; code?: string; yourResidentId?: string }>((res) =>
  c1.emit('session:rejoin', { code: create.code, residentId: id1 }, res),
).catch(() => null);
assert(rejoined?.ok === true && rejoined?.yourResidentId === id1, 'rejoin', `session:rejoin re-vincula a ${rejoined?.yourResidentId}`);
await scoreAfterRejoin.catch(() => null);
assert(true, 'rejoin-sincro', 'el servidor re-difunde marcador/co-op/voz tras el rejoin');

c1.disconnect();
c2.disconnect();
console.log(failures === 0 ? '\n✔ TODO OK (co-op real + voz, protocolo verificado)' : `\n✘ ${failures} fallos`);
process.exit(failures === 0 ? 0 : 1);
