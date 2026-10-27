import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import type { ActorsDirector } from './actors';
import type { BubblesDirector } from './bubbles';
import { selectModalOpen, useGameStore } from './store';
import { resolveTokens } from '@/game/support/texts';

/**
 * CHARLAS DE CRUCE (v1.20 → v1.32 «el vecindario respira») — la calle y los pasillos
 * están vivos.
 *
 * Cuando dos vecinos SE CRUZAN, PUEDE que paren… o no: lo decide su ÁNIMO (media ponderada
 * de necesidades, umbrales del catálogo) y una tirada con bonus/penalización. Y lo que
 * pasa después TAMBIÉN lo decide el catálogo (crossings.escalation, v1.32):
 *  · CHARLA   — lo de siempre: bocadillos alternos con el clip 'talk'.
 *  · DISCUSIÓN— clip 'argue' + líneas airadas del catálogo (mild si el ánimo tira, hot si
 *               viene mal).
 *  · PELEA    — clips 'fight' (nuevos en los rigs): intercambio de golpes con bocadillos
 *               de combate; al acabar, tirada de herido: el perdedor se queda EN EL SUELO
 *               (clip 'hurt') un rato, un testigo comenta… y se recupera (levantarse es
 *               soltar el gesto: el rig vuelve a reposo). En la CALLE la emergencia la
 *               lleva el teatro de la ambulancia (pedestrians + ambulance).
 *
 * Presentación pura: el sim jamás se entera. Anti-sobrecarga: máx. eventos simultáneos,
 * cooldown por vecino y por pareja.
 */

interface ActiveChat {
  a: string;
  b: string;
  kind: 'talk' | 'argue' | 'fight';
  lines: string[];
  /** Siguiente línea a decir (par → A, impar → B). */
  idx: number;
  t: number;
  /** Tras la última línea: mirándose un momento antes de soltarse. */
  after: number;
  /** v1.32 — perdedor de la pelea (clave del actor) y cuenta atrás de su recuperación. */
  injured: string | null;
  hurtLeft: number;
  /** Testigo pendiente de comentar la pelea. */
  witness: { at: number; who: string } | null;
}

export interface ChatsDirector {
  update(dt: number): void;
  dispose(): void;
}

export function createChats(
  world: World,
  content: Content,
  actors: ActorsDirector,
  bubbles: BubblesDirector | null,
): ChatsDirector {
  const cfg = content.crossings;
  if (!cfg || !bubbles) {
    return { update() {}, dispose() {} };
  }
  const cad = cfg.cadence;
  const esc = cfg.escalation;
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

  const pickLine = (pool: string[], salt: string): string =>
    pool.length > 0 ? pool[Math.floor(hash01(salt, lap * 7 + world.tick) * pool.length) % pool.length]! : '';

  const startChat = (a: string, b: string): void => {
    const bucket = bucketOf((moodOf(a) + moodOf(b)) / 2);
    const key = keyOf(a, b);
    const now = performance.now() / 1000;
    resUntil.set(a, now + cad.residentCooldown);
    resUntil.set(b, now + cad.residentCooldown);
    pairUntil.set(key, now + cad.pairCooldown);

    // v1.32 — ESCALACIÓN (catálogo): la tirada decide si esta charla degenera.
    let kind: ActiveChat['kind'] = 'talk';
    let lines: string[] = [];
    const group = cfg.groups.find((g) => g.mood === bucket) ?? cfg.groups[0];
    const topic = group?.topics[Math.floor(hash01(`${a}~${b}~${world.tick}`, lap) * group.topics.length) % Math.max(1, group.topics.length)];
    lines = topic ? topic.lines.map((l) => l) : [];
    if (esc) {
      const roll = hash01(`${b}~${a}~escala`, lap);
      if (roll < esc.fightChance) {
        kind = 'fight';
        lines = esc.fightFight.filter(Boolean);
        if (lines.length === 0) lines = ['¡Toma!', '¡Y esa!'];
      } else if (roll < esc.fightChance + esc.argueChance) {
        kind = 'argue';
        const pool = esc.argueGroups[bucket === 'bad' ? 'hot' : 'mild'] ?? esc.argueGroups[Object.keys(esc.argueGroups)[0] ?? ''] ?? [];
        const at = pool[Math.floor(hash01(`${a}~${b}~discute`, lap) * pool.length) % Math.max(1, pool.length)];
        lines = at ? at.lines.map((l) => l) : [];
      }
    }
    if (lines.length === 0) return;
    const total = kind === 'fight' ? lines.length * (esc?.fightLinesSeconds ?? 0.9) + 2 : lines.length * cad.lineSeconds + cad.holdAfter;
    active.set(key, { a, b, kind, lines, idx: 0, t: 0, after: kind === 'fight' ? 1.2 : cad.holdAfter, injured: null, hurtLeft: 0, witness: null });
    actors.setHold(a, total);
    actors.setHold(b, total);
  };

  /** Comentario de un testigo (un tercero cercano y libre) tras una pelea. */
  const scheduleWitness = (ch: ActiveChat, pa: { x: number; z: number }, hurtSeconds: number): void => {
    if (!esc || esc.witnessLines.length === 0) return;
    const candidates = Object.values(world.residents).filter((r) => {
      if (!r.present || !r.location || r.id === world.playerId || r.id === ch.a || r.id === ch.b) return false;
      if (actors.isRiding(r.id) || actors.isDirected(r.id) || actors.gestureOf(r.id)) return false;
      if ((resUntil.get(r.id) ?? 0) > performance.now() / 1000) return false;
      const p = actors.nodeOf(r.id);
      if (!p) return false;
      return Math.hypot(p.x - pa.x, p.z - pa.z) < 3.4;
    });
    if (candidates.length === 0) return;
    const who = candidates[Math.floor(hash01('testigo', lap * 5 + world.tick) * candidates.length) % candidates.length]!;
    ch.witness = { at: hurtSeconds * 0.45, who: who.id };
  };

  return {
    update(dt: number) {
      // 1) Avanzar eventos en curso.
      for (const [key, ch] of [...active]) {
        const pa = actors.nodeOf(ch.a);
        const pb = actors.nodeOf(ch.b);
        // Si uno de los dos desaparece de escena (se va, se esconde en el trastero…), se corta.
        if (!pa || !pb || !world.residents[ch.a] || !world.residents[ch.b]) {
          endChat(key);
          continue;
        }
        // v1.32 — HERIDO: cuenta atrás de recuperación; el testigo suelta su comentario.
        if (ch.injured) {
          ch.hurtLeft -= dt;
          if (ch.witness) {
            ch.witness.at -= dt;
            if (ch.witness.at <= 0) {
              const line = pickLine(esc?.witnessLines ?? [], 'testigo_linea');
              if (line && !actors.isRiding(ch.witness.who) && !actors.isDirected(ch.witness.who)) {
                bubbles.sayText(ch.witness.who, line, 4);
                actors.setGesture(ch.witness.who, 'talk', 3.5);
              }
              ch.witness = null;
            }
          }
          if (ch.hurtLeft <= 0) {
            // Se levanta: soltar el gesto devuelve al rig a reposo (postura de pie).
            actors.setGesture(ch.injured, null);
            ch.injured = null;
          }
          continue;
        }
        ch.t -= dt;
        if (ch.t > 0) continue;
        if (ch.idx < ch.lines.length) {
          const speaker = ch.idx % 2 === 0 ? ch.a : ch.b;
          const other = speaker === ch.a ? ch.b : ch.a;
          const po = actors.nodeOf(other);
          // v1.32 — tokens data-driven: {a}/{b} nombres, {planta:x}/{vivienda:x} datos reales.
          const text = resolveTokens(ch.lines[ch.idx]!, world, content, { a: ch.a, b: ch.b });
          bubbles.sayText(speaker, text, ch.kind === 'fight' ? (esc?.fightLinesSeconds ?? 0.9) : cad.lineSeconds);
          if (ch.kind === 'fight') {
            // Los DOS pelean: el golpeador lanza, el otro está en guardia (mismo clip).
            actors.setGesture(speaker, 'fight', (esc?.fightLinesSeconds ?? 0.9) + 0.2);
            actors.setGesture(other, 'fight', (esc?.fightLinesSeconds ?? 0.9) + 0.35);
          } else {
            // v1.32 — la discusión usa 'argue' (gesto que ya traía el catálogo y nadie tocaba).
            actors.setGesture(speaker, ch.kind === 'argue' ? 'argue' : 'talk', cad.lineSeconds + 0.5);
          }
          if (po) {
            actors.faceToward(ch.a, pb.x, pb.z);
            actors.faceToward(ch.b, pa.x, pa.z);
          }
          ch.idx += 1;
          ch.t = ch.kind === 'fight' ? esc?.fightLinesSeconds ?? 0.9 : cad.lineSeconds;
        } else if (ch.kind === 'fight' && ch.after > 0) {
          // Fin del intercambio: tirada de herido (catálogo).
          ch.after -= dt;
          if (ch.after <= 0 && esc) {
            actors.setGesture(ch.a, null);
            actors.setGesture(ch.b, null);
            if (esc.injuryLines.length > 0 && hash01(`${ch.a}~herido~${world.tick}`, lap) < esc.injuredChance) {
              const loser = hash01(`${ch.b}~perdedor`, lap) < 0.5 ? ch.a : ch.b;
              const winner = loser === ch.a ? ch.b : ch.a;
              ch.injured = loser;
              ch.hurtLeft = esc.hurtSeconds;
              actors.setGesture(loser, 'hurt', esc.hurtSeconds + 0.4);
              const line = pickLine(esc.injuryLines, 'herido_linea');
              if (line) bubbles.sayText(loser, line, 3.4);
              actors.setGesture(winner, 'argue', 2.6);
              const pw = actors.nodeOf(loser);
              if (pw) scheduleWitness(ch, pw, esc.hurtSeconds);
              actors.setHold(loser, esc.hurtSeconds + 1.2); // el vencedor se queda mirando
              actors.setHold(winner, 2.8);
            }
          }
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
