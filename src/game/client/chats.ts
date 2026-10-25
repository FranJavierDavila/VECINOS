import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import type { ActorsDirector } from './actors';
import type { BubblesDirector } from './bubbles';
import { selectModalOpen, useGameStore } from './store';

/**
 * CHARLAS DE CRUCE (v1.20) — la calle y los pasillos están vivos.
 *
 * Cuando dos vecinos SE CRUZAN, PUEDE que paren a charlar… o no: lo decide su ÁNIMO
 * (media ponderada de necesidades, umbrales del catálogo) y una tirada con bonus/penalización
 * del ánimo. Si charlan, se giran el uno hacia el otro, conversan con bocadillos de TEXTO
 * (humor del catálogo crossings.json) y se sueltan. Presentación pura: el sim jamás se
 * entera (los vecinos no cambian de ubicación ni de relaciones por una charla de acera).
 * Anti-sobrecarga: máx. charlas simultáneas, cooldown por vecino y por pareja, y en vista
 * 'edificio' los bocadillos ya están capados por el propio sistema de emotes.
 */

interface ActiveChat {
  a: string;
  b: string;
  lines: string[];
  /** Siguiente línea a decir (par → A, impar → B). */
  idx: number;
  t: number;
  /** Tras la última línea: mirándose un momento antes de soltarse. */
  after: number;
}

export interface ChatsDirector {
  update(dt: number): void;
  dispose(): void;
}

export function createChats(world: World, content: Content, actors: ActorsDirector, bubbles: BubblesDirector | null): ChatsDirector {
  const cfg = content.crossings;
  if (!cfg || !bubbles) {
    return { update() {}, dispose() {} };
  }
  const cad = cfg.cadence;
  const nameOf = (id: string): string => content.archetypes[world.residents[id]?.archetype ?? '']?.name ?? id;

  /** Ánimo medio del vecino (mismas necesidades que los emotes del catálogo de cruces). */
  const moodOf = (id: string): number => {
    const r = world.residents[id];
    if (!r) return 50;
    let sum = 0;
    let total = 0;
    for (const [k, w] of Object.entries(cfg.mood.needs)) {
      const value = r.needs[k];
      if (typeof value === 'number') {
        sum += value * w;
        total += w;
      }
    }
    return total > 0 ? sum / total : 50;
  };
  const bucketOf = (m: number): 'good' | 'ok' | 'bad' => (m >= cfg.mood.goodMin ? 'good' : m >= cfg.mood.okMin ? 'ok' : 'bad');

  const active = new Map<string, ActiveChat>();
  const resUntil = new Map<string, number>();
  const pairUntil = new Map<string, number>();
  let acc = 999;
  let lap = 0;

  const keyOf = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

  /** Libera una charla en curso (sus dos vecinos dejan de estar en pausa). */
  const endChat = (key: string): void => {
    const ch = active.get(key);
    if (!ch) return;
    actors.setHold(ch.a, 0);
    actors.setHold(ch.b, 0);
    active.delete(key);
  };

  const startChat = (a: string, b: string): void => {
    const bucket = bucketOf((moodOf(a) + moodOf(b)) / 2);
    const group = cfg.groups.find((g) => g.mood === bucket) ?? cfg.groups[0];
    if (!group || group.topics.length === 0) return;
    const topic = group.topics[Math.floor(hash01(`${a}~${b}~${world.tick}`, lap) * group.topics.length) % group.topics.length]!;
    const lines = topic.lines.map((l) => l);
    const key = keyOf(a, b);
    const now = performance.now() / 1000;
    active.set(key, { a, b, lines, idx: 0, t: 0, after: cad.holdAfter });
    resUntil.set(a, now + cad.residentCooldown);
    resUntil.set(b, now + cad.residentCooldown);
    pairUntil.set(key, now + cad.pairCooldown);
    const total = lines.length * cad.lineSeconds + cad.holdAfter;
    actors.setHold(a, total);
    actors.setHold(b, total);
  };

  return {
    update(dt: number) {
      // 1) Avanzar charlas en curso (una línea cada lineSeconds, alternando A/B).
      for (const [key, ch] of [...active]) {
        const pa = actors.nodeOf(ch.a);
        const pb = actors.nodeOf(ch.b);
        // Si uno de los dos desaparece de escena (se va, se esconde en el trastero…), se corta.
        if (!pa || !pb || !world.residents[ch.a] || !world.residents[ch.b]) {
          endChat(key);
          continue;
        }
        ch.t -= dt;
        if (ch.t > 0) continue;
        if (ch.idx < ch.lines.length) {
          const speaker = ch.idx % 2 === 0 ? ch.a : ch.b;
          const text = ch.lines[ch.idx]!.replaceAll('{a}', nameOf(ch.a)).replaceAll('{b}', nameOf(ch.b));
          bubbles.sayText(speaker, text, cad.lineSeconds);
          actors.setGesture(speaker, 'talk', cad.lineSeconds + 0.5);
          actors.faceToward(ch.a, pb.x, pb.z);
          actors.faceToward(ch.b, pa.x, pa.z);
          ch.idx += 1;
          ch.t = cad.lineSeconds;
        } else if (ch.after > 0) {
          ch.after -= dt;
        } else {
          endChat(key);
        }
      }

      // 2) Rastreo de cruces a cadencia (pausa y modales congelan la vida social).
      acc += dt;
      if (acc < cad.checkEvery) return;
      acc = 0;
      const store = useGameStore.getState();
      if (selectModalOpen(store) || store.paused) return;
      if (active.size >= cfg.proximity.maxConcurrent) return;
      lap += 1;
      const now = performance.now() / 1000;
      const present = Object.values(world.residents).filter((r) => {
        if (!r.present || !r.location || r.id === world.playerId) return false;
        // El cruce pasa AL ANDAR: pueden estar en ruta (se pausan al charlar y al soltar
        // siguen), pero jamás en viaje de ascensor, en teatro de cutscene o ya hablando.
        if (actors.isRiding(r.id) || actors.isDirected(r.id)) return false;
        if (actors.gestureOf(r.id)) return false; // ya está hablando por otro motivo
        if ((resUntil.get(r.id) ?? 0) > now) return false;
        return actors.nodeOf(r.id) !== null;
      });
      for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          const a = present[i]!;
          const b = present[j]!;
          if (active.size >= cfg.proximity.maxConcurrent) break;
          const key = keyOf(a.id, b.id);
          if ((pairUntil.get(key) ?? 0) > now) continue;
          const pa = actors.nodeOf(a.id)!;
          const pb = actors.nodeOf(b.id)!;
          if (Math.abs(pa.y - pb.y) > 0.25) continue; // plantas distintas: no se cruzan
          if (Math.hypot(pa.x - pb.x, pa.z - pb.z) > cfg.proximity.distance) continue;
          // El ánimo manda: buen ánimo anima la charla, mal ánimo la evita (y gruñe).
          const bucket = bucketOf((moodOf(a.id) + moodOf(b.id)) / 2);
          const chance =
            cfg.chance.base + (bucket === 'good' ? cfg.chance.goodMoodBonus : 0) - (bucket === 'bad' ? cfg.chance.badMoodPenalty : 0);
          if (hash01(`${a.id}~${b.id}~${world.tick}`, lap) >= chance) continue;
          startChat(a.id, b.id);
        }
      }
    },

    dispose() {
      for (const key of [...active.keys()]) endChat(key);
      active.clear();
      resUntil.clear();
      pairUntil.clear();
    },
  };
}
