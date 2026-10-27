import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { playSoundAt } from './audio';
import type { ActorsDirector } from './actors';
import type { BubblesDirector } from './bubbles';
import { selectModalOpen, useGameStore } from './store';

/**
 * VOCES DE PROXIMIDAD (v1.22) — al pasar AL LADO de un vecino se oye su voz: una queja,
 * un lamento, una risa, un silbido, un cuchicheo, una confesión… Todo del catálogo
 * (sounds.json → voices): bancos de sonidos sintetizados elegidos por su ÁNIMO, con
 * volumen por distancia y antiedad de sobrecarga (cooldown por vecino + tope por minuto).
 * Con captionChance puede soltar un pie de foto mínimo («*suspira*», «fiu-fiu~»).
 * Presentación pura: el sim no cambia por susurrar.
 */

export interface VoicesDirector {
  update(dt: number): void;
  /** Voces soltadas en el último minuto (QA/E2E). */
  recentCount(): number;
  dispose(): void;
}

export function createVoices(world: World, content: Content, actors: ActorsDirector, bubbles: BubblesDirector | null): VoicesDirector {
  const cfg = content.sounds?.voices;
  if (!cfg) {
    return { update() {}, recentCount: () => 0, dispose() {} };
  }
  const prox = cfg.proximity;
  const bucketOf = (id: string): 'good' | 'ok' | 'bad' => {
    const cm = content.crossings?.mood;
    const r = world.residents[id];
    if (!cm || !r) return 'ok';
    let sum = 0;
    let total = 0;
    for (const [k, w] of Object.entries(cm.needs)) {
      const value = r.needs[k];
      if (typeof value === 'number') {
        sum += value * w;
        total += w;
      }
    }
    const m = total > 0 ? sum / total : 50;
    return m >= cm.goodMin ? 'good' : m >= cm.okMin ? 'ok' : 'bad';
  };

  const cooldown = new Map<string, number>();
  const recent: number[] = [];
  let acc = 999;
  let roll = 0;

  return {
    update(dt: number) {
      for (const [k, v] of [...cooldown]) {
        const nv = v - dt;
        if (nv <= 0) cooldown.delete(k);
        else cooldown.set(k, nv);
      }
      const now = performance.now() / 1000;
      while (recent.length > 0 && now - recent[0]! > 60) recent.shift();

      acc += dt;
      if (acc < prox.checkEvery) return;
      acc = 0;
      const store = useGameStore.getState();
      if (selectModalOpen(store) || store.paused) return;
      if (recent.length >= prox.maxPerMinute) return;
      const player = actors.nodeOf(world.playerId);
      if (!player) return;

      // El vecino despierto más cercano al jugador (mismos filtros que las charlas).
      let best: { id: string; d: number } | null = null;
      for (const r of Object.values(world.residents)) {
        if (!r.present || !r.location || r.id === world.playerId) continue;
        if (actors.isRiding(r.id) || actors.isDirected(r.id) || actors.gestureOf(r.id)) continue;
        if ((cooldown.get(r.id) ?? 0) > 0) continue;
        const node = actors.nodeOf(r.id);
        if (!node) continue;
        if (Math.abs(node.y - player.y) > 0.4) continue; // otra planta: no hay proximidad
        const d = Math.hypot(node.x - player.x, node.z - player.z);
        if (d > prox.radius) continue;
        if (!best || d < best.d) best = { id: r.id, d };
      }
      if (!best) return;
      if (hash01('voz_cerca', world.tick + roll++) >= prox.chance) return;

      // Banco por ánimo → sonido concreto; volumen por distancia.
      const moodMap = cfg.moodMap.find((m) => m.mood === bucketOf(best!.id)) ?? cfg.moodMap[0];
      if (!moodMap) return;
      const banks = moodMap.banks.filter((b) => cfg.banks[b]?.length);
      if (banks.length === 0) return;
      const bank = banks[Math.floor(hash01('voz_banco', roll) * banks.length) % banks.length]!;
      const keys = cfg.banks[bank]!;
      const key = keys[Math.floor(hash01('voz_clave', roll) * keys.length) % keys.length]!;
      const t = 1 - best.d / prox.radius;
      const gain = prox.minGain + (1 - prox.minGain) * Math.max(0, Math.min(1, t));
      playSoundAt(key, gain);
      cooldown.set(best.id, prox.cooldownPerResident);
      recent.push(now);
      actors.setGesture(best.id, 'talk', prox.gestureSeconds);
      const caption = cfg.captions[key];
      if (caption && bubbles && hash01('voz_pie', roll) < prox.captionChance) {
        bubbles.sayText(best.id, caption, 1.9);
      }
    },
    recentCount: () => recent.length,
    dispose() {
      cooldown.clear();
      recent.length = 0;
    },
  };
}
