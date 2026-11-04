import type { CommandResult, Content, LocalizedText, Relation, ResidentInstance, World } from '@/game/core/types';
import { emit } from '../events';
import { nextRandom } from '../rng';

/**
 * CAPA SOCIAL (v1.79) — ideas #1 y #7 del backlog FASE T:
 *
 *  1. COTILLEO EN PASILLOS (socialTick): 2+ vecinos IA despiertos en el mismo bloque de
 *     pasillo pueden juntarse a cotillear → evento gossip_started con 1-2 líneas del
 *     catálogo y una pequeña deriva de AFINIDAD entre la pareja (el grafo social dinámico).
 *  2. CONFIANZA POR CONVERSACIÓN (resolveTalk): el comando `talk` (desde el selector de
 *     temas del cliente) resuelve el resultado por tema/arquetipo/afinidad y mueve la
 *     CONFIANZA del vecino hacia el jugador (Relation.trust, leída ahora por el puente de
 *     la junta). El sim es la única verdad: clásico y multijugador comparten este código.
 *
 * Determinismo: SOLO nextRandom(world) — ni Math.random ni Date.now. Igual que junta.ts,
 * este módulo vive en la costura de extensión (extra/) y no toca el núcleo congelado.
 */

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Relación de `from` hacia `to` (la crea a cero si no existe, mismo patrón que knock en commands.ts). */
function relationOf(from: ResidentInstance, to: string): Relation {
  let rel = from.relations.find((x) => x.with === to);
  if (!rel) from.relations.push((rel = { with: to, affinity: 0, trust: 0 }));
  return rel;
}

/** Línea al azar (determinista por rng del mundo) de un banco localizado. */
function pickLine(pool: LocalizedText[], world: World): LocalizedText {
  return pool[Math.floor(nextRandom(world) * pool.length)]!;
}

/**
 * Cotilleo de pasillos: corre cada tick (tick() lo llama tras runAI). Por cada bloque de
 * pasillo, si hay grupo suficiente de vecinos IA despiertos y sin cooldown, la pareja
 * (dos primeros ids) suelta UN cotilleo: evento + deriva de afinidad mutua + cooldown.
 */
export function socialTick(world: World, content: Content): void {
  const cfg = content.rules.sim.social;
  const catalog = content.social;
  // Catálogo o reglas ausentes (o sin frases): pasillos en silencio, la partida funciona igual.
  if (!cfg || !catalog || catalog.topics.length === 0 || catalog.gossip.lines.length === 0) return;

  const corridors = Object.values(world.blocks)
    .filter((b) => b.layer === 'corridor')
    .sort((a, b) => a.id.localeCompare(b.id)); // orden determinista por id
  for (const block of corridors) {
    const group = Object.values(world.residents)
      .filter(
        (r) =>
          r.present &&
          r.location === block.id &&
          r.controller.type !== 'human' &&
          r.activity !== 'sleep' &&
          world.tick >= (r.cooldowns['gossip'] ?? 0),
      )
      .sort((a, b) => a.id.localeCompare(b.id)); // pareja determinista: los dos primeros ids
    if (group.length < cfg.gossipMinGroup) continue;
    if (nextRandom(world) >= cfg.gossipChance) continue;

    const a = group[0]!;
    const b = group[1]!;
    // 1-2 líneas del catálogo: la segunda (distinta) solo si el azar acompaña.
    const lines = [pickLine(catalog.gossip.lines, world)];
    if (catalog.gossip.lines.length > 1 && nextRandom(world) < 0.5) {
      const second = pickLine(catalog.gossip.lines, world);
      if (second !== lines[0]) lines.push(second);
    }
    emit(world, 'gossip_started', { residents: [a.id, b.id], block: block.id, lines });

    // Deriva de afinidad en AMBOS pares ordenados (a→b y b→a): charlar estrecha lazos.
    const relAB = relationOf(a, b.id);
    relAB.affinity = clamp(relAB.affinity + cfg.gossipAffinityDelta, -100, 100);
    const relBA = relationOf(b, a.id);
    relBA.affinity = clamp(relBA.affinity + cfg.gossipAffinityDelta, -100, 100);

    // Cooldown por vecino (1 tick = 1 minuto de sim): nada de cotilleo en bucle.
    a.cooldowns['gossip'] = world.tick + cfg.gossipCooldownMinutes;
    b.cooldowns['gossip'] = world.tick + cfg.gossipCooldownMinutes;
  }
}

/**
 * Resuelve el comando `talk` (v1.79): el jugador charla con un vecino EN SU MISMO BLOQUE
 * sobre un tema del catálogo. El resultado (que la charla siente bien o mal) depende del
 * tema, del arquetipo del vecino (likedBy/dislikedBy) y de la afinidad vigente, y mueve la
 * CONFIANZA del RESIDENTE hacia el ACTOR (Relation.trust). Emite talk_result con la línea
 * del bocadillo y los deltas aplicados. Mismos cierres que el resto de comandos del sim.
 */
export function resolveTalk(
  world: World,
  content: Content,
  cmd: { type: 'talk'; resident: string; topic: string; actor?: string },
): CommandResult {
  const catalog = content.social;
  const topic = catalog?.topics.find((t) => t.id === cmd.topic);
  if (!catalog || !topic) return { ok: false, reason: 'no_topic' };

  // Actor: sin `actor` explícito (partida clásica) manda el jugador del mundo.
  const actorId = cmd.actor !== undefined && world.residents[cmd.actor] ? cmd.actor : world.playerId;
  const actor = world.residents[actorId];
  const resident = world.residents[cmd.resident];
  if (!actor || !resident || resident.id === actor.id) return { ok: false, reason: 'no_resident' };

  // Misma distancia cero: ambos en el mismo bloque (pasillo, portal, vivienda compartida…).
  if (resident.location === null || resident.location !== actor.location) return { ok: false, reason: 'far' };
  if (resident.activity === 'sleep') return { ok: false, reason: 'asleep' };

  const cfg = content.rules.sim.social;
  const cdKey = `talk:${resident.id}`;
  if (cfg && world.tick < (actor.cooldowns[cdKey] ?? 0)) return { ok: false, reason: 'cooldown' };

  // Tirada del resultado: tema + gustos del arquetipo (+/-0.2) + empujón pequeño de afinidad.
  const rel = relationOf(resident, actorId); // la confianza del RESIDENTE hacia el ACTOR
  const actorRel = actor.relations.find((x) => x.with === resident.id);
  let p = topic.gainChance;
  if (topic.likedBy.includes(resident.archetype)) p += 0.2;
  if (topic.dislikedBy.includes(resident.archetype)) p -= 0.2;
  p += clamp(actorRel?.affinity ?? 0, -50, 50) / 500;
  p = clamp(p, 0.05, 0.95);
  const gain = nextRandom(world) < p;

  // Deltas del catálogo (la pérdida golpea confianza Y afinidad; el éxito solo empuja ambas).
  const trustBefore = rel.trust;
  const affinityBefore = rel.affinity;
  rel.trust = clamp(rel.trust + (gain ? topic.trustGain : topic.trustLoss), -100, 100);
  rel.affinity = clamp(rel.affinity + (gain ? Math.round(topic.trustGain / 2) : topic.trustLoss), -100, 100);
  const trustDelta = rel.trust - trustBefore;
  const affinityDelta = rel.affinity - affinityBefore;

  const line = pickLine(gain ? topic.linesGain : topic.linesLoss, world);
  emit(world, 'talk_result', { actor: actorId, resident: resident.id, topic: topic.id, gain, line, trustDelta, affinityDelta });

  if (cfg) actor.cooldowns[cdKey] = world.tick + cfg.talkCooldownMinutes;
  return { ok: true };
}
