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
 */
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { formatIssues, loadContent } from '@/game/content';
import { applyEffects, createWorld, dispatch, drainEvents, instantiateRooms, tick } from '@/game/sim';
import { blockLabel, type Command, type World } from '@/game/core/types';
import { generateSessionCode, isSpeed, participantsList, scoreRows, type Participant, type Session } from './session';

/** Puerto FIJO: Caddy reenvía aquí; no se lee process.env.PORT a propósito. */
const PORT = 3010;
/** Una sesión sin participantes se destruye tras este tiempo (join antes del plazo la rescata). */
const SESSION_TTL_MS = 5 * 60 * 1000;

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
});

const sessions = new Map<string, Session>();
const sessionOfSocket = new Map<string, string>(); // socket.id → código de sesión

// ── ACKs del protocolo (formas exactas del contrato) ──
export type CreateAck = { ok: true; code: string; isHost: true; yourResidentId: string; scenarioId: string } | { ok: false; error: string };
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
    timer: setInterval(() => {
      for (let i = 0; i < session.speed; i++) tick(session.world, content);
      broadcastState(session);
    }, content.rules.multiplayer.tickSecondsPerTick * 1000),
    cleanup: null,
    // v1.55 — marcador «Vecino del mes»: el criterio completo vive en rules.multiplayer.score.
    scores: new Map(),
    lastMinigame: null,
    lastRecordAt: new Map(),
  };
  sessions.set(code, session);
  return session;
}

function destroySession(code: string): void {
  const session = sessions.get(code);
  if (!session) return;
  clearInterval(session.timer);
  if (session.cleanup) clearTimeout(session.cleanup);
  sessions.delete(code);
  console.log(`[${code}] sesión destruida (TTL sin participantes)`);
}

// ── v1.55 — MARCADOR «VECINO DEL MES» ──

/** Config de puntuación del catálogo (undefined = feature apagada). */
type ScoreCfg = {
  title: string;
  missionCompletedPoints: number;
  missionBonus: Record<string, number>;
  minigames: Record<string, { label?: string; pointsPerRecord: number; maxSecs?: number }>;
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

/** Drena eventos del mundo y emite session:state a la room; registra el minijuego pendiente si lo hay. */
function broadcastState(session: Session): void {
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
 * leaveToast del catálogo y avisa a la room. Si queda sin participantes, programa su borrado.
 */
function leaveSession(socket: Socket): void {
  const code = sessionOfSocket.get(socket.id);
  if (!code) return;
  sessionOfSocket.delete(socket.id);
  socket.leave(code);
  const session = sessions.get(code);
  const participant = session?.participants.get(socket.id);
  if (!session || !participant) return;
  session.participants.delete(socket.id);
  const resident = session.world.residents[participant.residentId];
  if (resident) resident.present = false;
  applyEffects(session.world, content, [{ op: 'toast', text: content.rules.multiplayer.leaveToast.replace('{name}', participant.name) }], {});
  io.to(code).emit('session:participants', { participants: participantsList(session) });
  console.log(`[${code}] sale ${participant.residentId} (${socket.id}) · quedan ${session.participants.size}`);
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
    const cmd = payload?.cmd;
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') return;
    // El actor SIEMPRE lo impone el servidor: el cliente nunca manda actor.
    (cmd as Command & { actor?: string }).actor = found.participant.residentId;
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

  socket.on('session:leave', () => leaveSession(socket));
  socket.on('disconnect', () => leaveSession(socket));
});

httpServer.listen(PORT, () => {
  console.log(`VECINOS server · puerto ${PORT} · path '/'`);
});

// ── Cierre limpio ──

let closing = false;
function shutdown(signal: string): void {
  if (closing) return;
  closing = true;
  console.log(`${signal} recibido: cierre limpio…`);
  for (const code of [...sessions.keys()]) destroySession(code);
  io.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
