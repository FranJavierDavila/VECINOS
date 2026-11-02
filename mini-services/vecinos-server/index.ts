/**
 * VECINOS — servidor autoritativo (mini-servicio Bun + socket.io, proyecto independiente).
 *
 * Implementa el recuadro "Servidor — más adelante, con el mismo núcleo" del documento de
 * arquitectura: reutiliza el MISMO núcleo de simulación (src/game/sim vía paths de tsconfig)
 * y el mismo loader de contenido (src/game/content). Comandos entran → eventos salen.
 *
 * Puerto FIJO 3010 (Caddy reenvía; NUNCA process.env.PORT) y path '/' (igual que
 * examples/websocket/server.ts — Caddy lo exige).
 *
 * Protocolo de sesión v1 (contrato fijo, ver test-client.ts):
 *   C→S  session:create {scenarioId?} (ack) | session:join {code} (ack)
 *        session:command {cmd} (actor SOBRESCRITO por el servidor) | session:minigame_time {id, secs} | session:set_speed {speed} | session:leave
 *   S→C  session:joined | session:participants | session:score {rows} | session:state {seq, world, events} | session:error
 *
 * v1.56 — COOPERATIVA REAL + VOZ (catálogo opcional content.multiplayer):
 *   C→S  coop:claim {missionId, roleId} | coop:progress {missionId, roleId} | coop:skip
 *        voice:join | voice:leave | voice:state {muted, speaking} | voice:signal {to, data}
 *        session:rejoin {code, residentId} (ack) — reconexión transparente tras caída de
 *        transporte (pestaña en segundo plano, red móvil): re-vincula el MISMO residente
 *        y re-difunde score/co-op/voz para sincronizar lo perdido.
 *   S→C  coop:state {active, done} | voice:roster {members} | voice:state {from, muted, speaking}
 *        voice:signal {from, data} | voice:error {message}
 *   El audio NUNCA pasa por el servidor: solo la señalización WebRTC (offer/answer/ICE).
 *   En solitario (1 participante) el co-op no se ofrece y NADA se bloquea: las misiones
 *   normales del sim siguen igual que siempre.
 *
 * FASE N — NETCODE PROFESIONAL (v1.73):
 *   · AUTORIDAD DE SERVIDOR en el movimiento: mp:pose se valida contra la última pose
 *     aceptada (velocidad m/s y plantas/s del catálogo rules.multiplayer.authority);
 *     los teleports se rechazan, violaciones en ventana → expulsión (anti-cheat básico).
 *   · session:command con rate limit por socket (ventana fija de 1 s del catálogo).
 *   · session:ack del cliente → lag de desync en ticks, expuesto en GET /health
 *     (junto a métricas por sesión: poses, rechazos, violaciones, restauradas).
 *   · PERSISTENCIA DE SESIONES: snapshot atómico a /tmp/vecinos-sessions.json cada 5 s
 *     y en el cierre limpio; al arrancar se REVIVEN dentro de su TTL — el rejoin del
 *     cliente encuentra la partida exacta incluso tras reinicio del proceso.
 *   · Reconexión <10 s: ping/pong del engine ajustado (10 s) + rejoin automático.
 *   El sim determinista de src/game/sim NO se toca (regla del proyecto).
 */
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { formatIssues, loadContent } from '@/game/content';
import { applyEffects, createWorld, dispatch, drainEvents, instantiateRooms, tick } from '@/game/sim';
import { blockLabel, type Command, type World } from '@/game/core/types';
import { generateSessionCode, isSpeed, participantsList, scoreRows, type Participant, type Session } from './session';
import { freshMetrics } from './session';
import { allowCmd, authorityOf, buildHealth, noteAck, noteViolation, validatePose } from './authority';
import { hydrateSession, readPersistedFile, snapshotSessions, writePersistedFile, PERSIST_PATH, RESTORE_MAX_AGE_MS } from './persist';

/**
 * Puerto FIJO 3010 (Caddy lo reenvía; el process.env.PORT genérico se IGNORA a propósito).
 * Única excepción: VECINOS_QA_PORT — QA headless que levanta SU PROPIO servidor en un
 * puerto desechable (persistencia/autoridad E2E sin tocar el servicio real). Caddy nunca
 * define esa variable; en producción esto vale siempre 3010.
 */
const PORT = process.env.VECINOS_QA_PORT ? Number(process.env.VECINOS_QA_PORT) : 3010;
/** Una sesión sin participantes se destruye tras este tiempo (join antes del plazo la rescata). */
const SESSION_TTL_MS = 5 * 60 * 1000;
/** Cadencia del snapshot de persistencia (FASE N). */
const PERSIST_INTERVAL_MS = 5000;
/** Fichero de snapshot: canónico para el servicio real (Caddy→3010); puerto propio para QA. */
const PERSIST_FILE = PORT === 3010 ? PERSIST_PATH : `/tmp/vecinos-sessions-${PORT}.json`;
/** Arranque del proceso: para /health. */
const STARTED_AT = Date.now();
/** true durante el cierre: el snapshot final ya se escribió, los destroy no reescriben. */
let closing = false;

// ── Contenido del juego: mismo loader que el cliente (el fetch de Bun resuelve file://) ──
const contentUrl = new URL('../../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(contentUrl);
if (issues.length > 0) {
  console.error(`Contenido inválido (${contentUrl}):\n${formatIssues(issues)}`);
  process.exit(1);
}
console.log(
  `Contenido cargado (${contentUrl}): escenarios=${Object.keys(content.scenarios).length} · maxPlayers=${content.rules.multiplayer.maxPlayers} · tickSecondsPerTick=${content.rules.multiplayer.tickSecondsPerTick}`,
);

const httpServer = createServer();
const io = new Server(httpServer, {
  // NO cambiar el path: Caddy lo exige (mismo setup que examples/websocket/server.ts).
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  // FASE N — reconexión <10 s: detectar vecinos muertos en ~20 s (antes: 25+20 s) sin
  // castigar a redes móviles flacas (la gracia de 30 s y el rejoin absorben el rebote).
  pingInterval: 10_000,
  pingTimeout: 10_000,
});

// FASE N — GET /health: métricas de desync en HTTP plano (watchdog/curioso). El middleware
// corre ANTES del propio engine de socket.io, así que no pisa el path '/' del handshake.
io.engine.use((req: { url?: string }, res: { writeHead: (s: number, h: Record<string, string>) => void; end: (b: string) => void }, next: () => void) => {
  const url = req.url ?? '';
  if (url === '/health' || url.startsWith('/health?')) {
    const body = JSON.stringify(buildHealth(sessions, Date.now() - STARTED_AT));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  next();
});

const sessions = new Map<string, Session>();
const sessionOfSocket = new Map<string, string>(); // socket.id → código de sesión

/** FASE N — config de autoridad del catálogo (null = relay puro, comportamiento v1.57). */
const authorityCfg = (): ReturnType<typeof authorityOf> => authorityOf(content.rules);

// ── ACKs del protocolo (formas exactas del contrato) ──
export type CreateAck = { ok: true; code: string; isHost: true; yourResidentId: string; scenarioId: string } | { ok: false; error: string };
/** v1.56 — rejoin: puede volver el anfitrión o un invitado → isHost es boolean real. */
export type RejoinAck = { ok: true; code: string; isHost: boolean; yourResidentId: string; scenarioId: string } | { ok: false; error: string };
export type JoinAck =
  | { ok: true; code: string; isHost: false; yourResidentId: string; scenarioId: string; residentName: string; homeBlock: string }
  | { ok: false; error: string };

// ── Sesiones ──

function newSession(code: string, scenarioId: string, world: World): Session {
  const session: Session = {
    code,
    scenarioId,
    world,
    speed: 1,
    seq: 0,
    pendingMinigame: null,
    participants: new Map(),
    guestCounter: 0,
    timer: null,
    cleanup: null,
    // v1.55 — marcador «Vecino del mes»: el criterio completo vive en rules.multiplayer.score.
    scores: new Map(),
    lastMinigame: null,
    lastRecordAt: new Map(),
    // v1.56 — co-op + voz (el criterio vive en content.multiplayer; aquí solo estado).
    coop: { activeIdx: -1, assignments: new Map(), done: [], lastOfferAt: 0 },
    voice: new Map(),
    grace: new Map(),
    // FASE N — runtime de autoridad y métricas.
    poses: new Map(),
    cmdWindow: new Map(),
    violations: new Map(),
    metrics: freshMetrics(),
    acks: new Map(),
  };
  sessions.set(code, session);
  return session;
}

/** FASE N — arma el bucle de tick (idéntico para sesión nueva o revivida del disco). */
function attachTimer(session: Session): void {
  session.timer = setInterval(() => {
    // v1.56 — blindaje: si el sim lanzara una excepción, Bun se la tragaría en silencio
    // y el mundo se congelaría sin error visible; se registra y el bucle sigue.
    try {
      for (let i = 0; i < session.speed; i++) tick(session.world, content);
      broadcastState(session);
    } catch (e) {
      console.error(`[${session.code}] 💥 excepción en tick:`, e instanceof Error ? e.stack ?? e.message : e);
    }
  }, content.rules.multiplayer.tickSecondsPerTick * 1000);
}

/**
 * FASE N — REVIVE las sesiones del snapshot de disco (persistencia de sesión):
 * roster fantasma con socketId centinela, bucle re-armado y TTL de limpieza armed:
 * si nadie vuelve (rejoin) en SESSION_TTL_MS, la sesión revive→muere sin dejar basura.
 */
function reviveSessions(): number {
  const file = readPersistedFile(PERSIST_FILE);
  if (!file || file.sessions.length === 0) return 0;
  const now = Date.now();
  let revived = 0;
  for (const saved of file.sessions) {
    if (now - saved.savedAt > RESTORE_MAX_AGE_MS) continue; // mundo huérfano: mejor olvido
    if (!content.scenarios[saved.scenarioId]) continue; // escenario ya no existe
    if (sessions.has(saved.code)) continue;
    const session = hydrateSession(saved);
    sessions.set(session.code, session);
    attachTimer(session);
    // Sin sockets detrás: si nadie re-entra en el TTL, limpieza (el rejoin lo cancela).
    session.cleanup = setTimeout(() => destroySession(session.code), SESSION_TTL_MS);
    session.cleanup.unref();
    revived += 1;
    console.log(`[${session.code}] ♻ sesión REVIVIDA del disco (tick ${session.world.tick}, ${session.participants.size} fantasma(s), seq ${session.seq})`);
  }
  return revived;
}

function destroySession(code: string): void {
  const session = sessions.get(code);
  if (!session) return;
  if (session.timer) clearInterval(session.timer);
  if (session.cleanup) clearTimeout(session.cleanup);
  sessions.delete(code);
  // FASE N — el disco también se entera: sin esto, un reinicio reviviría la sesión muerta.
  if (!closing) writePersistedFile(snapshotSessions(sessions), PERSIST_FILE);
  console.log(`[${code}] sesión destruida (TTL sin participantes)`);
}

// ── v1.55 — MARCADOR «VECINO DEL MES» ──

/** Config de puntuación del catálogo (undefined = feature apagada). */
type ScoreCfg = {
  title: string;
  missionCompletedPoints: number;
  missionBonus: Record<string, number>;
  minigames: Record<string, { label?: string; pointsPerRecord: number; maxSecs?: number }>;
  recordToast: string;
  firstToast: string;
} | undefined;
const scoreCfg = (): ScoreCfg => content.rules.multiplayer?.score as ScoreCfg;

/** Emite session:score a la sala (marcador completo + quién manda). */
function emitScore(session: Session): void {
  io.to(session.code).emit('session:score', { rows: scoreRows(session) });
}

/** Suma puntos a un residente (crea su fila con nombre congelado si no existe) y difunde. */
function award(session: Session, residentId: string, points: number, name?: string): void {
  const row = session.scores.get(residentId) ?? { points: 0, best: {}, name };
  if (name) row.name = name;
  row.points += points;
  session.scores.set(residentId, row);
  emitScore(session);
}

// ── v1.56 — MISIONES COOPERATIVAS REALES ──
// El criterio vive en content.multiplayer.coop (roles con objetivos verificables);
// aquí solo orquestación: oferta, reparto de roles, progreso y bonus. El objetivo de un
// rol lo detecta SU cliente (minijuego completado / bloque alcanzado) y el servidor lo
// verifica contra la asignación (nadie puede marcar el rol de otro).

type CoopCfg = NonNullable<import('@/game/core/types').Content['multiplayer']>['coop'] | undefined;
const coopCfg = (): CoopCfg => content.multiplayer?.coop;

/** Payload exacto de coop:state (misión activa con sus roles + historial). */
function coopStatePayload(session: Session): {
  active: null | { mission: NonNullable<CoopCfg>['missions'][number]; roles: { roleId: string; residentId: string | null; name: string | null; done: boolean }[] };
  done: string[];
} {
  const cfg = coopCfg();
  if (!cfg || session.coop.activeIdx < 0 || session.coop.activeIdx >= cfg.missions.length) {
    return { active: null, done: session.coop.done };
  }
  const mission = cfg.missions[session.coop.activeIdx]!;
  return {
    active: {
      mission,
      roles: mission.roles.map((r) => {
        const a = session.coop.assignments.get(r.id);
        return { roleId: r.id, residentId: a?.residentId ?? null, name: a?.name ?? null, done: a?.done ?? false };
      }),
    },
    done: session.coop.done,
  };
}

function emitCoopState(session: Session): void {
  io.to(session.code).emit('coop:state', coopStatePayload(session));
}

/** Oferta la siguiente misión co-op del catálogo si toca (cooldown + minPlayers + ninguna activa). */
function coopTick(session: Session): void {
  const cfg = coopCfg();
  if (!cfg || !cfg.enabled) return;
  if (session.coop.activeIdx >= 0) return;
  // EN SOLITARIO no se ofrece nada: las misiones normales del sim siguen como siempre.
  if (session.participants.size < cfg.minPlayers) return;
  const now = Date.now();
  if (now - session.coop.lastOfferAt < cfg.cooldownSecs * 1000) return;
  let next = cfg.missions.find((m) => !session.coop.done.includes(m.id));
  if (!next) {
    session.coop.done = []; // catálogo agotado: ronda nueva (el vecino del mes manda)
    next = cfg.missions[0];
  }
  session.coop.activeIdx = cfg.missions.indexOf(next!);
  session.coop.assignments.clear();
  session.coop.lastOfferAt = now;
  applyEffects(session.world, content, [{ op: 'toast', text: cfg.offerToast.replace('{title}', next!.title), tone: 'good' }], {});
  emitCoopState(session);
  console.log(`[${session.code}] 🤝 co-op ofertada: «${next!.title}»`);
}

/** Cierra la misión co-op: bonus a cada rol asignado + toast del catálogo + cooldown. */
function completeCoop(session: Session): void {
  const cfg = coopCfg();
  if (!cfg || session.coop.activeIdx < 0) return;
  const mission = cfg.missions[session.coop.activeIdx]!;
  const names = mission.roles.map((r) => session.coop.assignments.get(r.id)?.name ?? '').filter((n) => n.length > 0);
  for (const a of session.coop.assignments.values()) {
    award(session, a.residentId, mission.pointsBonus, a.name);
  }
  let text = mission.completeToast.replace('{title}', mission.title).replace('{points}', String(mission.pointsBonus));
  names.forEach((n, i) => {
    text = text.replace(`{${String.fromCharCode(97 + i)}}`, n); // {a} {b} {c}…
  });
  applyEffects(session.world, content, [{ op: 'toast', text, tone: 'good' }], {});
  session.coop.done.push(mission.id);
  session.coop.activeIdx = -1;
  session.coop.assignments.clear();
  session.coop.lastOfferAt = Date.now();
  console.log(`[${session.code}] ✅ co-op completada: «${mission.title}» (+${mission.pointsBonus} pts × ${names.length})`);
}

/** Libera los roles co-op de un residente (al salir). true si cambió algo. */
function releaseCoopRoles(session: Session, residentId: string): boolean {
  let changed = false;
  for (const [roleId, a] of session.coop.assignments) {
    if (a.residentId === residentId) {
      session.coop.assignments.delete(roleId);
      changed = true;
    }
  }
  return changed;
}

// ── v1.56 — CANAL DE VOZ (solo señalización WebRTC; el audio es P2P entre navegadores) ──

function voiceRoster(session: Session): { id: string; name: string; muted: boolean; speaking: boolean }[] {
  return [...session.voice.entries()].map(([id, v]) => ({
    id,
    name: [...session.participants.values()].find((p) => p.residentId === id)?.name ?? id,
    muted: v.muted,
    speaking: v.speaking,
  }));
}

function emitVoiceRoster(session: Session): void {
  io.to(session.code).emit('voice:roster', { members: voiceRoster(session) });
}

/** Drena eventos del mundo y emite session:state a la room; registra el minijuego pendiente si lo hay. */
function broadcastState(session: Session): void {
  coopTick(session); // v1.56 — puede ofertar una misión co-op (toast + coop:state propios)
  const events = drainEvents(session.world);
  let awarded = false;
  const cfg = scoreCfg();
  for (const e of events) {
    if (e.type === 'minigame_requested' && typeof e.data.minigame === 'string') session.pendingMinigame = e.data.minigame;
    // v1.55 — misión completada → puntos para quien la lleva (el anfitrión es world.playerId:
    // el sim solo avanza pasos por su señal; el catálogo añade bonus por misión concreta).
    if (cfg && e.type === 'mission_completed' && typeof e.data.mission === 'string') {
      const host = [...session.participants.values()].find((p) => p.residentId === session.world.playerId);
      if (host) {
        const pts = cfg.missionCompletedPoints + (cfg.missionBonus[e.data.mission] ?? 0);
        if (pts > 0) {
          award(session, host.residentId, pts, host.name);
          awarded = true;
        }
      }
    }
  }
  if (awarded) {
    // El premio acaba de emitir session:score; session:state viaja igualmente con los eventos.
  }
  io.to(session.code).emit('session:state', { seq: ++session.seq, world: session.world, events });
}

function lookup(socketId: string): { session: Session; participant: Participant } | null {
  const code = sessionOfSocket.get(socketId);
  const session = code ? sessions.get(code) : undefined;
  const participant = session?.participants.get(socketId);
  return session && participant ? { session, participant } : null;
}

/**
 * Sale de la sesión ('session:leave' o disconnect): marca el residente ausente, aplica el
 * leaveToast del catálogo y avisa a la room.
 *
 * v1.56 — GRACIA DE RECONEXIÓN: si la salida es por DISCONNECT del transporte (pestaña en
 * segundo plano, red móvil que flaquea), el participante SOBREVIVE 30 s como ausente y su
 * purga queda diferida: el session:rejoin del cliente (reconexión + re-vinculación) lo
 * recupera con roles co-op, voz y marcador intactos. La salida EXPLÍCITA (botón «Salir»)
 * purga al instante: es decisión del vecino.
 */
const GRACE_MS = 30_000;

function leaveSession(socket: Socket, fromDisconnect = false): void {
  const code = sessionOfSocket.get(socket.id);
  if (!code) return;
  sessionOfSocket.delete(socket.id);
  socket.leave(code);
  const session = sessions.get(code);
  const participant = session?.participants.get(socket.id);
  if (!session || !participant) return;

  if (fromDisconnect) {
    // GRACIA: el socket murió pero el vecino puede volver. Purga diferida (roles co-op,
    // voz y fila del marcador se conservan intactos para el rejoin).
    if (session.grace.has(participant.residentId)) return; // ya está en gracia (socket zombi)
    const resident = session.world.residents[participant.residentId];
    if (resident) resident.present = false;
    io.to(code).emit('session:participants', { participants: participantsList(session) });
    console.log(`[${code}] ⏳ ${participant.residentId} pierde el transporte · gracia ${GRACE_MS / 1000} s`);
    const purge = setTimeout(() => {
      session.grace.delete(participant.residentId);
      purgeParticipant(session, participant.residentId, participant.name);
    }, GRACE_MS);
    purge.unref();
    session.grace.set(participant.residentId, purge);
    return;
  }

  purgeParticipant(session, participant.residentId, participant.name, socket.id);
  console.log(`[${code}] sale ${participant.residentId} (${socket.id}) · quedan ${session.participants.size}`);
  if (session.participants.size === 0) {
    session.cleanup ??= setTimeout(() => destroySession(code), SESSION_TTL_MS);
    session.cleanup.unref();
  }
}

/** Purga real de un residente: fila de participantes, roles co-op, voz y avisos. */
function purgeParticipant(session: Session, residentId: string, name: string, socketId?: string): void {
  const code = session.code;
  if (socketId) {
    session.participants.delete(socketId);
    session.cmdWindow.delete(socketId); // FASE N — el rate limit muere con el socket
    session.acks.delete(socketId);
  } else {
    const entry = [...session.participants.entries()].find(([, p]) => p.residentId === residentId);
    if (entry) {
      session.participants.delete(entry[0]);
      session.cmdWindow.delete(entry[0]);
      session.acks.delete(entry[0]);
    }
  }
  session.poses.delete(residentId); // FASE N — sin traza, su regreso re-ancla limpio
  session.violations.delete(residentId);
  const resident = session.world.residents[residentId];
  if (resident) resident.present = false;
  applyEffects(session.world, content, [{ op: 'toast', text: content.rules.multiplayer.leaveToast.replace('{name}', name) }], {});
  io.to(code).emit('session:participants', { participants: participantsList(session) });
  if (releaseCoopRoles(session, residentId)) emitCoopState(session);
  if (session.voice.delete(residentId)) emitVoiceRoster(session);
  if (session.participants.size === 0) {
    session.cleanup ??= setTimeout(() => destroySession(code), SESSION_TTL_MS);
    session.cleanup.unref();
  }
}

/** Crea el residente invitado y marca su vivienda (patrón addGuest de scripts/smoke-junta.ts). */
function createGuest(session: Session, socket: Socket, blockId: string): { residentId: string; name: string; homeBlock: string } {
  const world = session.world;
  const block = world.blocks[blockId]!;
  session.guestCounter += 1;
  const id = `res_guest_${session.guestCounter}`;
  const scenario = content.scenarios[session.scenarioId]!;
  const archetype = scenario.multiplayer?.guestArchetype ?? content.rules.multiplayer.guestArchetype;
  const name = content.archetypes[archetype]?.name ?? id;
  world.residents[id] = {
    id,
    archetype,
    controller: { type: 'human', playerId: socket.id },
    home: block.id,
    present: true,
    location: world.entry, // el invitado aparece en el portal
    activity: null,
    parentOf: [],
    wallet: scenario.multiplayer?.guestWallet ?? content.rules.multiplayer.guestWallet,
    reputation: 50,
    needs: { ...content.rules.sim.defaultNeeds },
    relations: [],
    cooldowns: {},
  };
  block.occupancy = 'occupied';
  block.ownerId = id;
  block.access = 'unlocked';
  block.lockReason = null;
  block.availability = null;
  if (block.rooms.length === 0) block.rooms = instantiateRooms(content, block.defId);
  // Aviso de llegada con los marcadores {name}/{block} del catálogo.
  applyEffects(
    world,
    content,
    [{ op: 'toast', text: content.rules.multiplayer.joinToast.replace('{name}', name).replace('{block}', blockLabel(block.id)), tone: 'good' }],
    {},
  );
  return { residentId: id, name, homeBlock: block.id };
}

// ── Conexiones ──

io.on('connection', (socket) => {
  socket.on('session:create', (payload: { scenarioId?: string } | undefined, ack?: (res: CreateAck) => void) => {
    leaveSession(socket); // si el socket ya estaba en otra sesión, sale limpiamente primero
    const scenarioId = payload?.scenarioId ?? content.rules.startScenario;
    if (!content.scenarios[scenarioId]) return ack?.({ ok: false, error: 'unknown_scenario' });
    const world = createWorld(content, scenarioId);
    const code = generateSessionCode(sessions);
    const session = newSession(code, scenarioId, world);
    attachTimer(session); // FASE N — el bucle ya no nace dentro de newSession (revive lo comparte)
    const host = world.residents[world.playerId]!; // el anfitrión ES world.playerId
    const participant: Participant = {
      socketId: socket.id,
      residentId: host.id,
      name: content.archetypes[host.archetype]?.name ?? host.id,
      home: host.home,
      isHost: true,
    };
    session.participants.set(socket.id, participant);
    sessionOfSocket.set(socket.id, code);
    socket.join(code);
    ack?.({ ok: true, code, isHost: true, yourResidentId: host.id, scenarioId });
    socket.emit('session:joined', {
      code,
      isHost: true,
      yourResidentId: host.id,
      scenarioId,
      participants: participantsList(session),
    });
    io.to(code).emit('session:participants', { participants: participantsList(session) });
    broadcastState(session);
    console.log(`[${code}] anfitrión ${host.id} (${socket.id}) · escenario ${scenarioId}`);
  });

  socket.on('session:join', (payload: { code: string } | undefined, ack?: (res: JoinAck) => void) => {
    leaveSession(socket); // si el socket ya estaba en otra sesión, sale limpiamente primero
    const code = (payload?.code ?? '').trim().toUpperCase();
    const session = sessions.get(code);
    if (!session) return ack?.({ ok: false, error: 'unknown_code' });
    if (session.participants.size >= content.rules.multiplayer.maxPlayers) {
      return ack?.({ ok: false, error: content.rules.multiplayer.texts.sessionFull });
    }
    const block = Object.values(session.world.blocks).find((b) => b.kind === 'dwelling' && b.occupancy === 'vacant');
    if (!block) return ack?.({ ok: false, error: content.rules.multiplayer.texts.noVacant });

    if (session.cleanup) {
      clearTimeout(session.cleanup); // alguien llegó antes del plazo: la sesión sigue viva
      session.cleanup = null;
    }
    const guest = createGuest(session, socket, block.id);
    const participant: Participant = {
      socketId: socket.id,
      residentId: guest.residentId,
      name: guest.name,
      home: guest.homeBlock,
      isHost: false,
    };
    session.participants.set(socket.id, participant);
    sessionOfSocket.set(socket.id, code);
    socket.join(code);
    ack?.({
      ok: true,
      code,
      isHost: false,
      yourResidentId: guest.residentId,
      scenarioId: session.scenarioId,
      residentName: guest.name,
      homeBlock: guest.homeBlock,
    });
    socket.emit('session:joined', {
      code,
      isHost: false,
      yourResidentId: guest.residentId,
      scenarioId: session.scenarioId,
      participants: participantsList(session),
    });
    io.to(code).emit('session:participants', { participants: participantsList(session) });
    broadcastState(session);
    console.log(`[${code}] invitado ${guest.residentId} (${socket.id}) → vivienda ${guest.homeBlock}`);
  });

  socket.on('session:command', (payload: { cmd: Command } | undefined) => {
    const found = lookup(socket.id);
    if (!found) return;
    // FASE N — rate limit por socket (ventana fija de 1 s del catálogo): el spam de
    // comandos no llega ni al sim ni al broadcast; solo cabe el ritmo de juego legítimo.
    if (!allowCmd(authorityCfg(), found.session, socket.id, Date.now())) return;
    const cmd = payload?.cmd;
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') return;
    // El actor SIEMPRE lo impone el servidor: el cliente nunca manda actor.
    (cmd as Command & { actor?: string }).actor = found.participant.residentId;
    // v1.57 — blindaje: 'move' también lleva el residente en el payload; nadie mueve al
    // vecino de otro (el cliente manda el suyo vía PlayerLogic.exec; aquí se re-impone).
    if (cmd.type === 'move') (cmd as Command & { resident: string }).resident = found.participant.residentId;
    // Dedup de minijuegos: solo se acepta el resultado del minijuego pendiente de la sesión.
    // v1.55 — el ÉXITO se anota SIEMPRE (aunque el sim lo rechace por dedup) para autorizar
    // la marca de tiempo del duelo: en comunidad todos juegan el mismo minijuego, aunque el
    // sim solo cuente el primero (el tiempo del segundo vale igualmente para el marcador).
    if (cmd.type === 'complete_minigame') {
      if (cmd.success === true) {
        found.session.lastMinigame = { id: cmd.id, actor: found.participant.residentId, at: Date.now() };
      }
      if (!found.session.pendingMinigame || cmd.id !== found.session.pendingMinigame) return;
      found.session.pendingMinigame = null;
    }
    dispatch(found.session.world, content, cmd);
    broadcastState(found.session); // respuesta ágil al comando
  });

  // ── FASE N — POSES CON AUTORIDAD DE SERVIDOR: el movimiento fino NUNCA toca el sim (la
  // autoridad del sim sigue siendo la ubicación por bloque de los 'move'), pero YA NO es
  // client-trusted: cada pose se valida contra la última ACEPTADA del residente (velocidad
  // m/s y plantas/s del catálogo). Teleport → rechazado + violación; spam de ritmo →
  // rechazado; hueco largo de red → re-anclaje sin chequeo. Violaciones en ventana → kick. ──
  socket.on('mp:pose', (payload: { x?: number; z?: number; floor?: number } | undefined) => {
    const found = lookup(socket.id);
    if (!found) return;
    const x = payload?.x;
    const z = payload?.z;
    const floor = payload?.floor;
    if (typeof x !== 'number' || typeof z !== 'number' || typeof floor !== 'number') return;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(floor)) return;
    const cl = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
    const pose = { x: cl(x, -600, 600), z: cl(z, -600, 600), floor: cl(floor, 0, 30) };
    const now = Date.now();
    const verdict = validatePose(authorityCfg(), found.session, found.participant.residentId, pose, now);
    if (!verdict.ok) {
      // Anti-cheat básico: la teleport cuenta como violación (ventana del catálogo); el
      // spam de ritmo solo se descarta. Con el umbral superado, fuera del vecindario.
      const cfg = authorityCfg();
      if (verdict.reason === 'teleport' && cfg && noteViolation(cfg, found.session, found.participant.residentId, now)) {
        console.log(`[${found.session.code}] 🚨 ${found.participant.name} expulsado: ${cfg.kickViolations} violaciones de movimiento en ${cfg.violationWindowSec} s`);
        socket.emit('session:error', { message: 'authority_kick' });
        leaveSession(socket, false);
        socket.disconnect();
        return;
      }
      return; // pose rechazada: NO se reenvía a la sala
    }
    io.to(found.session.code).emit('mp:pose', { from: found.participant.residentId, ...pose });
  });

  // ── FASE N — ACK DE ESTADO: el cliente confirma el último seq aplicado → lag de desync
  // en ticks por participante, visible en /health (nada de gameplay: solo telemetría). ──
  socket.on('session:ack', (payload: { seq?: number } | undefined) => {
    const found = lookup(socket.id);
    if (!found) return;
    const seq = payload?.seq;
    if (typeof seq !== 'number' || !Number.isFinite(seq) || seq < 0) return;
    noteAck(found.session, socket.id, found.participant.residentId, seq, Date.now());
  });

  // ── v1.64 — TIMBRE EN VIVO (relay puro): un vecino llama al timbre de una puerta y el
  // DUEÑO lo oye al instante. El sim NUNCA se toca: el knock de la puerta del anfitrión es
  // presentación local en el cliente que llama (el knock del sim excluye a world.playerId);
  // esto solo avisa en directo. Validación estricta: bloque conocido, longitud acotada. ──
  socket.on('mp:ring', (payload: { block?: string } | undefined) => {
    const found = lookup(socket.id);
    if (!found) return;
    const block = payload?.block;
    if (typeof block !== 'string' || block.length === 0 || block.length > 64) return;
    if (!found.session.world.blocks[block]) return;
    io.to(found.session.code).emit('mp:ring', { from: found.participant.residentId, block });
  });

  // ── v1.55 — DUELO DE MINIJUEGOS: marca de tiempo del rearme (session:minigame_time) ──
  // El cliente cronometra y manda segundos; el servidor valida contra rules.multiplayer.score,
  // premia SOLO la mejora del récord personal (no se farmea repitiendo) con rate limit de 3 s,
  // y anuncia la marca a la sala con un toast del catálogo.
  socket.on('session:minigame_time', (payload: { id: string; secs: number } | undefined) => {
    const found = lookup(socket.id);
    if (!found) return;
    const cfg = scoreCfg();
    const id = payload?.id;
    const secs = payload?.secs;
    if (!cfg || typeof id !== 'string' || typeof secs !== 'number' || !Number.isFinite(secs)) return;
    const mgCfg = cfg.minigames[id];
    if (!mgCfg) return;
    const maxSecs = mgCfg.maxSecs ?? 600;
    if (secs <= 0.5 || secs > maxSecs) return; // tiempos imposibles: fuera
    const now = Date.now();
    // La marca exige un éxito reciente del mismo minijuego por el mismo vecino (≤ 30 s).
    const last = found.session.lastMinigame;
    if (!last || last.id !== id || last.actor !== found.participant.residentId || now - last.at > 30_000) return;
    // Rate limit por participante: 3 s entre marcas (evita spam de toast/puntos).
    const lastAt = found.session.lastRecordAt.get(found.participant.residentId) ?? 0;
    if (now - lastAt < 3_000) return;
    const row = found.session.scores.get(found.participant.residentId) ?? { points: 0, best: {}, name: found.participant.name };
    row.name = found.participant.name;
    const prevBest = row.best[id];
    if (prevBest !== undefined && secs >= prevBest) return; // solo puntúa MEJORAR el récord
    row.best[id] = Math.round(secs * 10) / 10;
    found.session.scores.set(found.participant.residentId, row);
    found.session.lastRecordAt.set(found.participant.residentId, now);
    const text = (prevBest === undefined ? cfg.firstToast : cfg.recordToast)
      .replace('{name}', found.participant.name)
      .replace('{secs}', row.best[id]!.toFixed(1).replace('.', ','))
      .replace('{points}', String(mgCfg.pointsPerRecord));
    applyEffects(found.session.world, content, [{ op: 'toast', text, tone: 'good' }], {});
    award(found.session, found.participant.residentId, mgCfg.pointsPerRecord);
    broadcastState(found.session); // el toast viaja con el próximo estado (y este disparo lo empuja ya)
    console.log(`[${found.session.code}] 🏅 ${found.participant.name}: ${id} ${row.best[id]!.toFixed(1)} s (+${mgCfg.pointsPerRecord})`);
  });

  socket.on('session:set_speed', (payload: { speed: number } | undefined) => {
    const found = lookup(socket.id);
    if (!found || !found.participant.isHost) return; // solo el anfitrión
    const speed = payload?.speed;
    if (isSpeed(speed)) {
      found.session.speed = speed;
      console.log(`[${found.session.code}] velocidad → ${speed}x`);
    } else {
      socket.emit('session:error', { message: 'speed inválida (válidas: 1, 3, 10)' });
    }
  });

  // ── v1.56 — CO-OP: reclamar rol, marcar progreso del PROPIO rol y saltar (anfitrión) ──

  socket.on('coop:claim', (payload: { missionId?: string; roleId?: string } | undefined) => {
    const found = lookup(socket.id);
    if (!found) return;
    const cfg = coopCfg();
    if (!cfg || !cfg.enabled || found.session.coop.activeIdx < 0) return;
    const mission = cfg.missions[found.session.coop.activeIdx]!;
    const roleId = payload?.roleId;
    if (payload?.missionId !== mission.id || typeof roleId !== 'string') return;
    if (!mission.roles.some((r) => r.id === roleId)) return;
    if (found.session.coop.assignments.get(roleId)) return; // rol ocupado
    // Un vecino, un rol por misión (el reparto ES la cooperación).
    const already = [...found.session.coop.assignments.values()].some((a) => a.residentId === found.participant.residentId);
    if (already) return;
    found.session.coop.assignments.set(roleId, { residentId: found.participant.residentId, name: found.participant.name, done: false });
    emitCoopState(found.session);
    console.log(`[${found.session.code}] 🤝 ${found.participant.name} reclama «${roleId}» en ${mission.id}`);
  });

  socket.on('coop:progress', (payload: { missionId?: string; roleId?: string } | undefined) => {
    const found = lookup(socket.id);
    if (!found) return;
    const cfg = coopCfg();
    if (!cfg || found.session.coop.activeIdx < 0) return;
    const mission = cfg.missions[found.session.coop.activeIdx]!;
    const roleId = payload?.roleId;
    if (payload?.missionId !== mission.id || typeof roleId !== 'string') return;
    const a = found.session.coop.assignments.get(roleId);
    // Solo el ASIGNADO marca su rol (y una sola vez): el resto no toca la ajena.
    if (!a || a.residentId !== found.participant.residentId || a.done) return;
    a.done = true;
    const allDone = mission.roles.every((r) => found.session.coop.assignments.get(r.id)?.done === true);
    if (allDone) {
      completeCoop(found.session);
      broadcastState(found.session); // el toast del catálogo viaja con el estado
    }
    emitCoopState(found.session);
    console.log(`[${found.session.code}] 🤝 ${found.participant.name} completa «${roleId}» (${mission.id}${allDone ? ', ¡CIERRE!' : ''})`);
  });

  socket.on('coop:skip', () => {
    const found = lookup(socket.id);
    if (!found || !found.participant.isHost) return;
    if (found.session.coop.activeIdx < 0) return;
    found.session.coop.activeIdx = -1;
    found.session.coop.assignments.clear();
    found.session.coop.lastOfferAt = Date.now();
    emitCoopState(found.session);
    console.log(`[${found.session.code}] 🤝 el anfitrión salta la misión co-op`);
  });

  // ── v1.56 — VOZ: join/leave + estado de micro + señalización WebRTC (relay puro) ──

  socket.on('voice:join', () => {
    const found = lookup(socket.id);
    if (!found) return;
    const cfg = content.multiplayer?.voice;
    if (!cfg || !cfg.enabled) return;
    if (!found.session.voice.has(found.participant.residentId)) {
      if (found.session.voice.size >= cfg.maxPeers) {
        socket.emit('voice:error', { message: 'voice_full' });
        return;
      }
      found.session.voice.set(found.participant.residentId, { socketId: socket.id, muted: false, speaking: false });
    } else {
      found.session.voice.get(found.participant.residentId)!.socketId = socket.id; // reconexión
    }
    emitVoiceRoster(found.session);
    console.log(`[${found.session.code}] 🎙️ ${found.participant.name} entra en el canal (${found.session.voice.size})`);
  });

  socket.on('voice:leave', () => {
    const found = lookup(socket.id);
    if (!found) return;
    if (found.session.voice.delete(found.participant.residentId)) {
      emitVoiceRoster(found.session);
      console.log(`[${found.session.code}] 🎙️ ${found.participant.name} sale del canal`);
    }
  });

  socket.on('voice:state', (payload: { muted?: boolean; speaking?: boolean } | undefined) => {
    const found = lookup(socket.id);
    if (!found) return;
    const entry = found.session.voice.get(found.participant.residentId);
    if (!entry) return;
    if (typeof payload?.muted === 'boolean') entry.muted = payload.muted;
    if (typeof payload?.speaking === 'boolean') entry.speaking = payload.speaking;
    io.to(found.session.code).emit('voice:state', {
      from: found.participant.residentId,
      muted: entry.muted,
      speaking: entry.speaking,
    });
  });

  socket.on('voice:signal', (payload: { to?: string; data?: unknown } | undefined) => {
    const found = lookup(socket.id);
    if (!found) return;
    const to = typeof payload?.to === 'string' ? found.session.voice.get(payload.to) : undefined;
    if (!to || payload?.data === undefined) return;
    // v1.56 (auditoría H4) — tope de tamaño por mensaje de señalización (offer/answer/ICE
    // caben de sobra en 64 KB; algo mayor es abuso o un cliente roto).
    if (JSON.stringify(payload.data).length > 65_536) return;
    io.to(to.socketId).emit('voice:signal', { from: found.participant.residentId, data: payload.data });
  });

  // ── v1.56 — RECONEXIÓN CON REJOIN: re-vincula el MISMO residente tras caída del transporte ──

  socket.on(
    'session:rejoin',
    (payload: { code?: string; residentId?: string } | undefined, ack?: (res: RejoinAck) => void) => {
      const code = (payload?.code ?? '').trim().toUpperCase();
      const residentId = payload?.residentId ?? '';
      const session = sessions.get(code);
      if (!session) {
        console.log(`⚠ rejoin FALLO ${code}: unknown_code (sesiones: ${[...sessions.keys()].join(',') || 'ninguna'})`);
        return ack?.({ ok: false, error: 'unknown_code' });
      }
      const prev = [...session.participants.entries()].find(([, p]) => p.residentId === residentId);
      if (!prev) {
        console.log(`[${code}] ⚠ rejoin FALLO: ${residentId} no está en el roster (${[...session.participants.values()].map((p) => p.residentId).join(',') || 'vacío'})`);
        return ack?.({ ok: false, error: 'not_in_session' });
      }
      const [oldSocketId, participant] = prev;
      // El socket viejo (si aún respira) sale limpio; el nuevo lo sustituye 1:1.
      if (oldSocketId !== socket.id) {
        session.participants.delete(oldSocketId);
        sessionOfSocket.delete(oldSocketId);
      }
      // v1.56 — si estaba en gracia (socket muerto), se cancela la purga: ¡volvió!
      const pendingPurge = session.grace.get(residentId);
      if (pendingPurge) {
        clearTimeout(pendingPurge);
        session.grace.delete(residentId);
      }
      participant.socketId = socket.id;
      session.participants.set(socket.id, participant);
      sessionOfSocket.set(socket.id, code);
      socket.join(code);
      const resident = session.world.residents[residentId];
      if (resident) resident.present = true;
      if (session.cleanup) {
        clearTimeout(session.cleanup);
        session.cleanup = null;
      }
      ack?.({ ok: true, code, isHost: participant.isHost, yourResidentId: residentId, scenarioId: session.scenarioId });
      socket.emit('session:joined', {
        code,
        isHost: participant.isHost,
        yourResidentId: residentId,
        scenarioId: session.scenarioId,
        participants: participantsList(session),
      });
      io.to(code).emit('session:participants', { participants: participantsList(session) });
      // Todo lo que el vecino perdió mientras volaba: mundo, marcador, co-op y voz.
      broadcastState(session);
      emitScore(session);
      emitCoopState(session);
      emitVoiceRoster(session);
      // La entrada de voz sobrevive a la caída: el roster lo conserva y el socket nuevo
      // hereda el asiento (voice:join del cliente refresca el socketId si hiciera falta).
      const voiceEntry = session.voice.get(residentId);
      if (voiceEntry) voiceEntry.socketId = socket.id;
      console.log(`[${code}] reconexión ${residentId} (${socket.id})`);
    },
  );

  socket.on('session:leave', () => leaveSession(socket, false));
  socket.on('disconnect', (reason: string) => {
    // v1.56 — diagnóstico: ¿por qué se va el vecino? (ping timeout, transporte, cliente…)
    const code = sessionOfSocket.get(socket.id);
    if (code) console.log(`[${code}] ⚠ disconnect (${socket.id}): ${reason}`);
    leaveSession(socket, true);
  });
});

httpServer.listen(PORT, () => {
  console.log(`VECINOS server · puerto ${PORT} · path '/'`);
});

// ── Cierre limpio ──

function shutdown(signal: string): void {
  if (closing) return;
  closing = true;
  console.log(`${signal} recibido: cierre limpio…`);
  // FASE N — foto final ANTES de destruir: el próximo arranque revive las sesiones y el
  // rejoin del vecino encuentra su partida exacta (el destroy ya no reescribe el disco).
  writePersistedFile(snapshotSessions(sessions), PERSIST_FILE);
  for (const code of [...sessions.keys()]) destroySession(code);
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── FASE N — PERSISTENCIA: revive sesiones del snapshot y fotografía cada 5 s ──

const revivedCount = reviveSessions();
if (revivedCount > 0) console.log(`♻ ${revivedCount} sesión(es) revivida(s) del disco (rejoin disponible)`);
setInterval(() => {
  if (closing) return;
  writePersistedFile(snapshotSessions(sessions), PERSIST_FILE);
}, PERSIST_INTERVAL_MS).unref();
