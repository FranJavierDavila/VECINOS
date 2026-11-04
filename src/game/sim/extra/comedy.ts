import type { Content, LocalizedText, ResidentInstance, World } from '@/game/core/types';
import { emit } from '../events';
import { nextRandom } from '../rng';
import { inMinuteWindow } from './ai';

/**
 * COMEDIA DE BARRIO (v1.85) — tramas secundarias cómicas entre vecinos IA.
 *
 * El catálogo (social.json → social.comedy.skits) es PURO TEATRO DATA-DRIVEN: cada skit
 * es un mini-sketch con protagonista (línea P1), comparsa opcional (respuesta P2), gesto
 * social, ventana horaria y banco de entradas para el registro. El motor de este módulo
 * es genérico: añadir comedia = añadir JSON, sin tocar el sim.
 *
 *  · ARRANQUE: cada checkEveryTicks, si no hay trama en curso, tira chancePerCheck y elige
 *    una candidata: cooldown vencido + ventana horaria + protagonista IA despierto, presente
 *    y en un bloque PÚBLICO (pasillo o común: portal, lavandería, locales). El
 *    comparsa es LLAMADO A ESCENA: teleport al bloque (precedente gamble/catch_in_act, el
 *    cliente anima la caminata con resident_moved) y ambos actores clavados hasta el telón
 *    (cooldowns['hop'], el mismo gateo que usa la mesa de cartas).
 *  · FASE 1 (comedy_start): el protagonista suelta su línea. Si el JUGADOR está en el
 *    mismo bloque, PRESENCIA la trama: confianza de cada actor hacia él (+witnessTrust),
 *    +witnessReputation de reputación y skitsSeen += 1 (meta-progresión de logros).
 *  · FASE 2 (comedy_phase, phaseMinutes después): el comparsa contesta (si hay P2) y
 *    la pareja deriva su afinidad (+affinityDelta, ambos sentidos).
 *  · CIERRE (comedy_end, lingerMinutes tras la última fase): cooldown para el skit, actores
 *    liberados y comparsa devuelto a casa (precedente sendGuestsHome). Si un actor se duerme
 *    o desaparece, la trama se corta con gracia (reason 'gone') — el teatro no obliga a nadie.
 *
 * Estado: CERO azar fuera de nextRandom(world) (ni Math.random ni Date.now; 1 tick = 1
 * minuto). Todo lo mutable vive en world.skit / world.skitCooldowns / world.skitsSeen —
 * tres campos nuevos de World que serializan al completo en los snapshots de multi y en
 * el persist del servidor (mismo patrón que ProtestState).
 *
 * Sin catálogo (social.json sin comedy), sin skits o sin rules.sim.comedy, este tick no
 * toca nada: el pasillo sigue en su silencio de siempre.
 */

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Línea al azar (determinista por rng del mundo) de un banco localizado. */
function pickLine(pool: LocalizedText[], world: World): LocalizedText {
  return pool[Math.floor(nextRandom(world) * pool.length)]!;
}

/** Relación de `from` hacia `to` (la crea a cero si no existe, patrón común de la capa extra). */
function relationOf(from: ResidentInstance, to: string): { with: string; affinity: number; trust: number } {
  let rel = from.relations.find((x) => x.with === to);
  if (!rel) from.relations.push((rel = { with: to, affinity: 0, trust: 0 }));
  return rel;
}

/**
 * ¿El actor sigue vivo para el teatro? Presente, despierto y no humano. El cooldown 'hop'
 * NO cuenta: es el PROPIO módulo el que clava a sus actores en escena hasta el telón.
 */
function actorAlive(world: World, id: string): boolean {
  const r = world.residents[id];
  return !!r && r.present && r.controller.type !== 'human' && r.activity !== 'sleep';
}

/** Candidatos de un pool de arquetipos: IA, despierto, presente y sin cooldown de hop. */
function candidatesOf(world: World, archetypes: string[], block: string | null): ResidentInstance[] {
  return Object.values(world.residents)
    .filter(
      (r) =>
        r.present &&
        r.controller.type !== 'human' &&
        r.activity !== 'sleep' &&
        world.tick >= (r.cooldowns['hop'] ?? 0) &&
        archetypes.includes(r.archetype) &&
        (block === null || r.location === block),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Tick de la comedia: corre cada tick (tick() lo llama tras gambleTick). */
export function comedyTick(world: World, content: Content): void {
  const cfg = content.rules.sim.comedy;
  const skits = content.social?.comedy?.skits ?? [];
  if (!cfg || skits.length === 0) return;

  // Partidas guardadas ANTES de v1.85 (o snapshots multi viejos): los campos nuevos llegan
  // undefined desde el JSON. Normalización perezosa, idempotente y sin coste en caliente.
  if (world.skitCooldowns === undefined) world.skitCooldowns = {};
  if (world.skitsSeen === undefined) world.skitsSeen = 0;

  const current = world.skit;

  // ── 1) TRAMA EN CURSO: fases y cierre ──────────────────────────────────────────────
  if (current) {
    const skit = skits.find((s) => s.id === current.id);
    if (!skit) {
      // El catálogo cambió bajo los pies (hot reload / save viejo): cierre silencioso.
      world.skit = null;
      return;
    }
    if (!actorAlive(world, current.a) || (current.b !== null && !actorAlive(world, current.b))) {
      // Un actor se durmió o se fue del vecindario: corte con gracia y reparto a casa.
      emit(world, 'comedy_end', { skit: current.id, block: current.block, reason: 'gone', witnessed: current.witnessed });
      releaseActors(world, current.a, current.b);
      world.skit = null;
      return;
    }

    const elapsed = world.tick - current.startTick;
    const phase2At = cfg.phaseMinutes;
    const endAt = phase2At + cfg.lingerMinutes;

    // FASE 2: el comparsa contesta (una sola vez) y la pareja deriva su afinidad.
    if (current.phase === 1 && current.b !== null && elapsed >= phase2At) {
      current.phase = 2;
      const line = skit.linesP2.length > 0 ? pickLine(skit.linesP2, world) : null;
      emit(world, 'comedy_phase', { skit: current.id, block: current.block, resident: current.b, line, gesture: skit.gesture });
      const relAB = relationOf(world.residents[current.a]!, current.b);
      relAB.affinity = clamp(relAB.affinity + cfg.affinityDelta, -100, 100);
      const relBA = relationOf(world.residents[current.b]!, current.a);
      relBA.affinity = clamp(relBA.affinity + cfg.affinityDelta, -100, 100);
    }

    // BONUS DE PRESENCIA (en cualquier fase, una vez por trama): el jugador EN EL BLOQUE.
    const player = world.residents[world.playerId];
    if (!current.witnessed && player && player.location === current.block) {
      current.witnessed = true;
      world.skitsSeen += 1;
      for (const actorId of [current.a, current.b]) {
        if (!actorId) continue;
        const actor = world.residents[actorId];
        if (!actor) continue;
        const rel = relationOf(actor, world.playerId); // la confianza del ACTOR hacia el JUGADOR
        rel.trust = clamp(rel.trust + cfg.witnessTrust, -100, 100);
      }
      player.reputation = clamp(player.reputation + cfg.witnessReputation, 0, 100);
      emit(world, 'reputation_changed', { resident: player.id, reputation: player.reputation });
      emit(world, 'comedy_witness', { skit: current.id, block: current.block, trust: cfg.witnessTrust, reputation: cfg.witnessReputation });
    }

    // CIERRE natural: telón (cooldown del skit, actores libres y comparsa en casa).
    if (elapsed >= endAt) {
      const line = pickLine(skit.logs, world);
      emit(world, 'comedy_end', { skit: current.id, block: current.block, reason: 'curtain', log: line, witnessed: current.witnessed });
      world.skitCooldowns[current.id] = world.tick + (skit.cooldownMinutes ?? cfg.cooldownMinutes);
      releaseActors(world, current.a, current.b);
      world.skit = null;
    }
    return;
  }

  // ── 2) ARRANQUE: candidatas, tirada y reparto de papeles ──────────────────────────
  if (world.tick % cfg.checkEveryTicks !== 0) return;
  if (nextRandom(world) >= cfg.chancePerCheck) return;

  const eligible = skits.filter((s) => {
    if (world.tick < (world.skitCooldowns[s.id] ?? 0)) return false;
    if (s.window && !inMinuteWindow(world.clock.minute, { from: s.window.from, to: s.window.to })) return false;
    return true;
  });
  if (eligible.length === 0) return;

  // Reparto determinista: primer skit viable en el orden del catálogo (el cooldown y la
  // ventana ya reparten el riesgo; el azar decide SI hay trama, no CUÁL).
  for (const skit of eligible) {
    const protagonist = candidatesOf(world, skit.protagonists, null)[0];
    if (!protagonist || protagonist.location === null) continue;
    const stage = world.blocks[protagonist.location];
    // El teatro es PÚBLICO: pasillos y bloques comunes de la casa (portal, lavandería,
    // locales de planta baja). En el salón de cada cual no hay público.
    if (!stage || (stage.layer !== 'corridor' && stage.layer !== 'main')) continue;

    const endTick = world.tick + cfg.phaseMinutes + cfg.lingerMinutes;
    // Comparsa: llamado a escena de donde esté (despierto, libre de mesas de cartas…).
    const coStar = skit.coStars.length > 0 ? candidatesOf(world, skit.coStars, null).find((c) => c.id !== protagonist.id) : undefined;

    world.skit = {
      id: skit.id,
      phase: 1,
      startTick: world.tick,
      a: protagonist.id,
      b: coStar?.id ?? null,
      block: stage.id,
      witnessed: false,
    };

    // Montaje de escena: ambos actores clavados hasta el telón (gateo hop de la IA) y el
    // comparsa teleportado al pasillo del protagonista (precedente gamble/catch_in_act:
    // el cliente anima el paseo con resident_moved).
    protagonist.cooldowns['hop'] = endTick;
    if (coStar) {
      coStar.location = stage.id;
      coStar.cooldowns['hop'] = endTick;
      emit(world, 'resident_moved', { resident: coStar.id, block: stage.id });
    }

    const line = pickLine(skit.linesP1, world);
    emit(world, 'comedy_start', {
      skit: skit.id,
      block: world.skit.block,
      resident: protagonist.id,
      coStar: world.skit.b,
      line,
      gesture: skit.gesture,
      label: skit.label,
    });
    return;
  }
}

/** Telón: actores libres (hop a cero) y comparsa devuelto a SU vivienda (precedente gamble). */
function releaseActors(world: World, aId: string, bId: string | null): void {
  const a = world.residents[aId];
  if (a) a.cooldowns['hop'] = 0;
  const b = bId ? world.residents[bId] : undefined;
  if (b && b.location !== null && b.location !== b.home) {
    b.cooldowns['hop'] = 0;
    b.location = b.home;
    emit(world, 'resident_moved', { resident: b.id, block: b.home });
  } else if (b) {
    b.cooldowns['hop'] = 0;
  }
}
