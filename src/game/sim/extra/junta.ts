import type { Content, Vote, World } from '@/game/core/types';
import { emit } from '../events';
import { applyEffects } from '../effects';
import { nextRandom } from '../rng';

/** Los vecinos IA votan según afinidad con el jugador, generosidad y su sesgo propio (voteBias del arquetipo). */
export function castVotes(world: World, content: Content): void {
  if (!world.junta) return;
  const cfg = content.rules.sim.junta;
  for (const r of Object.values(world.residents).sort((a, b) => a.id.localeCompare(b.id))) {
    if (r.controller.type === 'human' || !r.present || world.junta.votes[r.id]) continue;
    const affinity = r.relations.find((x) => x.with === world.playerId)?.affinity ?? 0;
    const traits = content.archetypes[r.archetype]?.traits ?? {};
    let pYes = cfg.baseYes + affinity / cfg.affinityDivisor + (traits.generosity ?? cfg.defaultGenerosity) * cfg.generosityFactor;
    pYes += content.archetypes[r.archetype]?.voteBias ?? 0;
    if ((r.needs['fun'] ?? 50) < cfg.moodThreshold) pYes -= cfg.moodPenalty; // de mal humor
    const vote: Vote = nextRandom(world) < Math.max(cfg.clamp.min, Math.min(cfg.clamp.max, pYes)) ? 'yes' : 'no';
    world.junta.votes[r.id] = vote;
  }
  emit(world, 'junta_votes', { votes: { ...world.junta.votes } });
}

/** Cierra la votación con el voto del jugador y ejecuta las propuestas aprobadas (si hay caja). */
export function resolveJunta(world: World, content: Content, playerVote: Vote): void {
  if (!world.junta) return;
  world.junta.votes[world.playerId] = playerVote;
  world.junta.playerVoted = true;
  for (const item of world.junta.agenda) {
    let yes = 0;
    let no = 0;
    for (const v of Object.values(world.junta.votes)) {
      if (v === 'yes') yes += 1;
      else no += 1;
    }
    const approved = yes > no && world.community.funds >= item.cost;
    emit(world, 'junta_result', { item: item.id, title: item.title, approved, yes, no });
    if (approved) {
      world.community.funds -= item.cost;
      applyEffects(world, content, item.effects, {});
    }
  }
  world.junta = null;
  emit(world, 'junta_closed', {});
}
