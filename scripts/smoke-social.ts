/**
 * Prueba de humo v1.79 — CAPA SOCIAL (ideas #1 y #7 del backlog FASE T):
 * 1) talk (confianza por conversación): comando por la VÍA ÚNICA — ok + evento talk_result
 *    con la confianza del vecino movida; cooldown inmediato; tema desconocido (no_topic);
 *    lejos (far); dormido (asleep).
 * 2) gossip (cotilleo en pasillos): socialTick con chance forzada (fixture de test) →
 *    gossip_started con 2 vecinos + deriva de afinidad en ambos sentidos; con cooldown no
 *    hay duplicado.
 * 3) Puente junta: la confianza del vecino hacia el jugador pesa en castVotes
 *    (trustWeight del catálogo) — resuelve sin crash; sin trustWeight también.
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, dispatch, drainEvents, tick, applyEffects } from '@/game/sim';
import type { JuntaItem, World } from '@/game/core/types';

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FALLO:', msg);
    process.exit(1);
  }
  console.log('OK ·', msg);
}

const PLAYER = 'res_player_01';
const CORRIDOR_1 = Object.values(createWorld(content, content.rules.startScenario).blocks).find((b) => b.layer === 'corridor' && b.cell.floor === 1)!.id;

/** Congela a un vecino donde está (fixture de test: la IA no lo saca del pasillo). */
function pin(r: { cooldowns: Record<string, number>; activity: string | null }): void {
  r.cooldowns['hop'] = 10_000;
  r.activity = null;
  r.cooldowns['gossip'] = 0;
}

// ══════════════ 1) talk — confianza por conversación ══════════════
{
  const w = createWorld(content, content.rules.startScenario);
  const player = w.residents[PLAYER]!;
  const target = w.residents['res_musico_01']!;
  player.location = CORRIDOR_1; // fixture de test: teletransporte directo
  target.location = CORRIDOR_1;
  pin(player);
  pin(target);

  const r1 = dispatch(w, content, { type: 'talk', resident: target.id, topic: 't_clima' });
  assert(r1.ok, 'talk con tema conocido y en el mismo pasillo resuelve ok');
  const ev = drainEvents(w).find((e) => e.type === 'talk_result');
  assert(!!ev, 'talk_result emitido');
  const d = ev!.data as Record<string, unknown>;
  assert(d.actor === PLAYER && d.resident === target.id && d.topic === 't_clima', 'talk_result lleva actor/residente/tema correctos');
  const gain = d.gain === true;
  const trustDelta = d.trustDelta as number;
  const trustGain = content.social!.topics.find((t) => t.id === 't_clima')!;
  assert(gain ? trustDelta === trustGain.trustGain : trustDelta === trustGain.trustLoss, `el delta de confianza sale del catálogo (gain=${gain}, delta=${trustDelta})`);
  const rel = target.relations.find((x) => x.with === PLAYER)!;
  assert(!!rel && rel.trust === trustDelta, `la relación del vecino hacia el jugador recoge la confianza (trust=${rel?.trust})`);
  assert(!!d.line && typeof (d.line as { es: string }).es === 'string', 'talk_result trae línea localizada para el bocadillo');
  assert(player.cooldowns[`talk:${target.id}`] === w.tick + content.rules.sim.social.talkCooldownMinutes, 'cooldown de charla aplicado al actor (catálogo)');

  const r2 = dispatch(w, content, { type: 'talk', resident: target.id, topic: 't_clima' });
  assert(!r2.ok && r2.reason === 'cooldown', 'segunda charla inmediata al mismo vecino falla limpio (cooldown)');

  const r3 = dispatch(w, content, { type: 'talk', resident: target.id, topic: 'no_existe' });
  assert(!r3.ok && r3.reason === 'no_topic', 'tema desconocido falla limpio (no_topic)');

  // lejos: mundo nuevo, cada uno en su bloque
  const w2 = createWorld(content, content.rules.startScenario);
  const target2 = w2.residents['res_musico_01']!;
  target2.location = CORRIDOR_1; // el jugador sigue en el portal (blk_p0_portal)
  const r4 = dispatch(w2, content, { type: 'talk', resident: target2.id, topic: 't_clima' });
  assert(!r4.ok && r4.reason === 'far', 'charla sin co-localización falla limpio (far)');

  // dormido: misma distancia cero pero actividad sleep
  const w3 = createWorld(content, content.rules.startScenario);
  const p3 = w3.residents[PLAYER]!;
  const t3 = w3.residents['res_musico_01']!;
  p3.location = CORRIDOR_1;
  t3.location = CORRIDOR_1;
  t3.activity = 'sleep';
  const r5 = dispatch(w3, content, { type: 'talk', resident: t3.id, topic: 't_clima' });
  assert(!r5.ok && r5.reason === 'asleep', 'charla con un vecino dormido falla limpio (asleep) y sin cambios');
}

// ══════════════ 2) gossip — cotilleo en pasillos ══════════════
{
  const originalChance = content.rules.sim.social.gossipChance;
  content.rules.sim.social.gossipChance = 1; // fixture de test: el cotilleo es seguro

  const w = createWorld(content, content.rules.startScenario);
  const a = w.residents['res_presidente_01']!;
  const b = w.residents['res_musico_01']!;
  a.location = CORRIDOR_1;
  b.location = CORRIDOR_1;
  pin(a);
  pin(b);
  // Todos los demás, lejos: fuera del edificio (la IA los re-entra por el portal y no
  // estorban en el pasillo de la planta 1 en el primer tick).
  for (const r of Object.values(w.residents)) {
    if (r.controller.type === 'human' || r.id === a.id || r.id === b.id) continue;
    r.location = null;
    r.cooldowns['hop'] = 10_000;
  }
  const affBeforeAB = a.relations.find((x) => x.with === b.id)?.affinity ?? 0;
  const affBeforeBA = b.relations.find((x) => x.with === a.id)?.affinity ?? 0;

  tick(w, content); // 1 tick = 1 minuto: runAI (pinned) → socialTick
  const ev = drainEvents(w).find((e) => e.type === 'gossip_started');
  assert(!!ev, 'socialTick emite gossip_started con chance=1');
  const d = ev!.data as Record<string, unknown>;
  const residents = (d.residents as string[]).sort((x, z) => x.localeCompare(z));
  assert(residents.length === 2 && residents[0] === [a.id, b.id].sort()[0] && residents[1] === [a.id, b.id].sort()[1], `el evento lista la pareja del pasillo (${residents.join(' + ')})`);
  assert(d.block === CORRIDOR_1, 'el evento señala el bloque de pasillo');
  const lines = d.lines as { es: string }[];
  assert(Array.isArray(lines) && lines.length >= 1 && lines.length <= 2, 'el cotilleo trae 1-2 líneas del catálogo');
  const delta = content.rules.sim.social.gossipAffinityDelta;
  const affAfterAB = a.relations.find((x) => x.with === b.id)?.affinity ?? 0;
  const affAfterBA = b.relations.find((x) => x.with === a.id)?.affinity ?? 0;
  assert(affAfterAB - affBeforeAB === delta && affAfterBA - affBeforeBA === delta, `deriva de afinidad +${delta} en AMBOS sentidos (${affBeforeAB}→${affAfterAB}, ${affBeforeBA}→${affAfterBA})`);
  assert(a.cooldowns['gossip'] === w.tick + content.rules.sim.social.gossipCooldownMinutes && b.cooldowns['gossip'] === a.cooldowns['gossip'], 'cooldown de cotilleo aplicado a la pareja');

  tick(w, content); // con el cooldown puesto: la MISMA pareja no repite
  const dup = drainEvents(w).find((e) => e.type === 'gossip_started' && (e.data.residents as string[]).slice().sort().join('|') === residents.join('|'));
  assert(!dup, 'con cooldown activo la pareja no vuelve a cotillear (sin duplicado)');

  content.rules.sim.social.gossipChance = originalChance; // el catálogo queda como estaba
}

// ══════════════ 3) Puente junta — la confianza pesa en el voto ══════════════
{
  const agenda: JuntaItem[] = [{ id: 'j_social', title: 'Buzón nuevo', description: 'Uno que cierre de verdad', cost: 0, effects: [{ op: 'toast', text: 'Buzón aprobado', tone: 'good' }] }];

  /** Fixture: confianza +50 de TODA la IA hacia el jugador (afinidad a 0 para aislar el puente). */
  const seedTrust = (w: World): void => {
    for (const r of Object.values(w.residents)) {
      if (r.controller.type === 'human') continue;
      let rel = r.relations.find((x) => x.with === PLAYER);
      if (!rel) r.relations.push((rel = { with: PLAYER, affinity: 0, trust: 0 }));
      rel.trust = 50;
    }
  };

  // a) Con trustWeight del catálogo (0.25): convoca → vota → resolución limpia.
  const w1 = createWorld(content, content.rules.startScenario);
  seedTrust(w1);
  const rc = dispatch(w1, content, { type: 'convoca_junta' });
  assert(rc.ok && w1.junta !== null, 'convoca_junta abre la junta con confianza sembrada');
  const rv = dispatch(w1, content, { type: 'junta_vote', vote: 'yes' });
  assert(rv.ok && w1.junta === null, 'junta_vote cierra la votación con el puente de confianza activo');
  assert(!!drainEvents(w1).find((e) => e.type === 'junta_result'), 'junta_result llega (resolución sin crash con trustWeight=0.25)');

  // b) Sin trustWeight en el catálogo: comportamiento de siempre (v1.78), sin crash.
  const savedWeight = content.rules.sim.junta.trustWeight;
  delete content.rules.sim.junta.trustWeight;
  const w2 = createWorld(content, content.rules.startScenario);
  seedTrust(w2);
  dispatch(w2, content, { type: 'convoca_junta' });
  const rv2 = dispatch(w2, content, { type: 'junta_vote', vote: 'yes' });
  assert(rv2.ok && w2.junta === null, 'sin trustWeight la votación también se cierra (retro-compat)');
  assert(!!drainEvents(w2).find((e) => e.type === 'junta_result'), 'junta_result llega también sin trustWeight');
  content.rules.sim.junta.trustWeight = savedWeight;

  // c) openJunta (efecto del catálogo) sigue operativo: el flujo clásico no se toca.
  const w3 = createWorld(content, content.rules.startScenario);
  applyEffects(w3, content, [{ op: 'openJunta', agenda }], {});
  assert(w3.junta !== null, 'openJunta clásico intacto junto a la capa social');
  drainEvents(w3);
}

console.log('SMOKE SOCIAL OK');
