'use client';

/**
 * VECINOS COMO PERSONAJES (v1.39) — nombres propios, gustos y reacciones con carácter.
 * El catálogo (public/content/personalities.json) define personalidades por ARQUETIPO y
 * por RESIDENTE (el override gana), con bancos de reacciones por CONTEXTO (lluvia, sol,
 * noche, saludo, misión…). Dos piezas:
 *
 *  1. RESOLUCIÓN — personalityOf(resident) y residentName(resident): la usan el controlador
 *     (toasts, registros) y el panel de vecinos para que cada vecino suene a persona.
 *  2. COMENTARIOS AMBIENTALES — cada pocos segundos, un vecino despierto cerca del jugador
 *     suelta una línea del banco que encaja con el contexto del mundo (bocadillo con texto).
 *     La elección es determinista por vecino+minuto (mismo estilo que las voces), con
 *     cooldown y tope por minuto. Presentación pura: el sim no cambia por charlar.
 */

import type { Content, LocalizedText, PersonalityDef, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { apartmentLabel } from '@/game/support/texts';
import type { ActorsDirector } from './actors';
import type { BubblesDirector } from './bubbles';
import { selectModalOpen, useGameStore } from './store';

/** Personalidad efectiva de un residente: override por id → arquetipo → defaults. */
export function personalityOf(content: Content, resident: { id: string; archetype: string }): PersonalityDef {
  const p = content.personalities;
  if (!p) return { tastes: [], reactions: {} };
  return p.byResident[resident.id] ?? p.byArchetype[resident.archetype] ?? p.defaults;
}

/**
 * Nombre corto visible de un residente (bocadillos, avisos, panel): personalidad →
 * nombre del arquetipo → id. El controlador usa esta vía en nameOf().
 */
export function residentName(content: Content, residentId: string, archetype: string | undefined): string {
  const p = content.personalities;
  const byResident = p?.byResident[residentId];
  if (byResident?.name) return byResident.name;
  const byArchetype = archetype ? p?.byArchetype[archetype] : undefined;
  if (byArchetype?.name) return byArchetype.name;
  return (archetype && content.archetypes[archetype]?.name) ?? residentId;
}

/** Texto en el idioma vigente del chrome (fallback ES). */
export function loc(text: LocalizedText | undefined, lang: 'es' | 'en'): string {
  if (!text) return '';
  return text[lang] ?? text.es;
}

/**
 * v1.40 — LÍNEA DE SALUDO de un vecino (timbre en su puerta o charla en el pasillo):
 * su banco `reactions.greet` (personalidad por id → arquetipo → defaults), ya en el
 * idioma del chrome. Null si el catálogo no trae saludos (el llamador usa su fallback).
 */
export function greetLineOf(content: Content, resident: { id: string; archetype: string }, lang: 'es' | 'en'): string | null {
  const pool = personalityOf(content, resident).reactions.greet;
  if (!pool || pool.length === 0) return null;
  const line = loc(pool[Math.floor(hash01(resident.id, 7) * pool.length) % pool.length], lang);
  return line.length > 0 ? line : null;
}

export interface ResidentsDirector {
  update(dt: number): void;
  /** El controlador avisa: se completó una misión (contexto «mission» unos segundos). */
  onMissionDone(): void;
  dispose(): void;
}

export function createResidents(
  world: World,
  content: Content,
  actors: ActorsDirector,
  bubbles: BubblesDirector | null,
): ResidentsDirector {
  const cfg = content.personalities;
  if (!cfg || !bubbles) {
    return { update() {}, onMissionDone() {}, dispose() {} };
  }
  const amb = cfg.ambient;
  let acc = 999;
  let missionGlow = 0;
  const cooldown = new Map<string, number>();
  const recent: number[] = [];

  /** Contexto actual del mundo: clima + franja + celebración reciente. */
  const contextOf = (minute: number): string => {
    if (missionGlow > 0) return 'mission';
    const store = useGameStore.getState();
    if (store.weather === 'rain' || store.weather === 'storm') return 'rain';
    if (store.weather === 'sunny' && (minute < 1290 && minute > 300)) return 'sunny';
    if (minute >= 1410 || minute < 330) return 'night';
    return 'morning';
  };

  return {
    onMissionDone() {
      missionGlow = 12; // segundos de ventana «mission» para los comentarios
    },
    update(dt: number) {
      if (missionGlow > 0) missionGlow -= dt;
      for (const [k, v] of [...cooldown]) {
        const nv = v - dt;
        if (nv <= 0) cooldown.delete(k);
        else cooldown.set(k, nv);
      }
      acc += dt;
      if (acc < amb.checkEvery) return;
      acc = 0;
      const store = useGameStore.getState();
      if (selectModalOpen(store) || store.paused) return;
      const now = performance.now() / 1000;
      while (recent.length > 0 && now - recent[0]! > 60) recent.shift();
      if (recent.length >= amb.maxPerMinute) return;

      const player = actors.nodeOf(world.playerId);
      if (!player) return;
      // Candidato: vecino presente, en el mismo plano y no muy lejos (como las voces).
      const candidates: string[] = [];
      for (const r of Object.values(world.residents)) {
        if (!r.present || !r.location || r.id === world.playerId) continue;
        if (actors.isRiding(r.id) || actors.isDirected(r.id) || actors.gestureOf(r.id)) continue;
        if ((cooldown.get(r.id) ?? 0) > 0) continue;
        const node = actors.nodeOf(r.id);
        if (!node) continue;
        if (Math.abs(node.y - player.y) > 0.4) continue;
        if (Math.hypot(node.x - player.x, node.z - player.z) > amb.radius) continue;
        candidates.push(r.id);
      }
      if (candidates.length === 0) return;
      const roll = Math.floor(world.tick / 3);
      const who = candidates[Math.floor(hash01('vecino_habla', roll) * candidates.length) % candidates.length]!;
      if (hash01('vecino_cambia', roll) >= amb.chance) return;

      const resident = world.residents[who];
      if (!resident) return;
      const persona = content.personalities?.byResident[who] ?? content.personalities?.byArchetype[resident.archetype] ?? content.personalities!.defaults;
      const ctx = contextOf(world.clock.minute);
      const pool = persona.reactions[ctx] ?? content.personalities!.defaults.reactions[ctx] ?? [];
      if (pool.length === 0) return;
      const line = pool[Math.floor(hash01('vecino_linea', roll + who.length) * pool.length) % pool.length]!;
      bubbles.sayText(who, loc(line, store.lang), amb.lineSeconds);
      actors.setGesture(who, 'talk', amb.lineSeconds * 0.8);
      cooldown.set(who, amb.cooldownPerResident);
      recent.push(now);
    },
    dispose() {
      cooldown.clear();
      recent.length = 0;
    },
  };
}

/** Foto de los vecinos para la pestaña «Vecinos» del dock (textos ya en el idioma vigente). */
export function residentsUiSnapshot(
  world: World,
  content: Content,
  actorId: string,
  lang: 'es' | 'en',
): import('./store').ResidentUi[] {
  const out: import('./store').ResidentUi[] = [];
  for (const r of Object.values(world.residents)) {
    if (r.id === world.playerId) continue;
    const arch = content.archetypes[r.archetype];
    const persona = content.personalities
      ? (content.personalities.byResident[r.id] ?? content.personalities.byArchetype[r.archetype] ?? undefined)
      : undefined;
    const rel = r.relations.find((x) => x.with === actorId);
    out.push({
      id: r.id,
      name: residentName(content, r.id, r.archetype),
      tagline: arch?.tagline ?? '',
      home: apartmentLabel(r.home) || r.home,
      present: r.present,
      activity: r.activity,
      affinity: rel ? rel.affinity : null,
      // v1.79 — confianza del vecino hacia el jugador (la mueve la charla con tema).
      trust: rel ? rel.trust : null,
      tastes: (persona?.tastes ?? []).map((t) => loc(t, lang)),
      quote: persona?.signature ? loc(persona.signature, lang) : null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
