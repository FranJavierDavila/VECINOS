import type { Content, LocalizedText, ResidentInstance, World } from '@/game/core/types';
import { emit } from '../events';
import { nextRandom } from '../rng';
import { inMinuteWindow } from './ai';

/**
 * JUEGO ILEGAL (v1.81) — idea #6 del backlog FASE T:
 *
 * El vecino del arquetipo anfitrión (rules.sim.gamble.hostArchetype, el `fondo_buitre`
 * del catálogo: compra, reforma, revende… y ahora también reparte cartas) monta partidas
 * de noche en SU vivienda, dentro de la ventana del catálogo (22:00→03:00, cruza
 * medianoche). Con `chancePerNight` abre mesa: convoca hasta maxGuests vecinos IA
 * despiertos (los más cercanos a su planta primero), los TELEPORTA a su salón (precedente
 * catch_in_act) y los sienta clavados hasta la hora de cierre (cooldowns['hop'] = fin de
 * la partida: sus saltos de IA están gateados por ese cooldown). Mientras la mesa está
 * abierta, cada tick puede caer REDADA: multa al anfitrión (hucha nunca bajo 0), una
 * porción para las arcas de la comunidad, invitados devueltos a casa y −2 de afinidad
 * con el anfitrión. Gancho para misiones futuras: hoy es ambiente (y riesgo), mañana
 * misión.
 *
 * Estado: CERO campos nuevos en World — todo vive en los cooldowns del anfitrión
 * ('gamble' fin de partida, 'gambleDay' día de la última mesa, 'gambleOver' marcador del
 * cierre natural, 'gambleRaidDay' resaca tras redada) que sincronizan bien en los
 * snapshots de multi. Los invitados NO se guardan: en redada/cierre son «los IA presentes
 * en el bloque del anfitrión» (solo este módulo teleporta ahí por la noche).
 *
 * Determinismo: SOLO nextRandom(world) — ni Math.random ni Date.now (1 tick = 1 minuto).
 * Sin bloque `gamble` en rules (o sin anfitrión con ese arquetipo) este tick no toca nada.
 */

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Línea al azar (determinista por rng del mundo) de un banco localizado; null si no hay catálogo. */
function pickLine(pool: LocalizedText[] | undefined, world: World): LocalizedText | null {
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(nextRandom(world) * pool.length)]!;
}

/** Relación de `from` hacia `to` (la crea a cero si no existe, patrón común de la capa extra). */
function relationOf(from: ResidentInstance, to: string): { with: string; affinity: number; trust: number } {
  let rel = from.relations.find((x) => x.with === to);
  if (!rel) from.relations.push((rel = { with: to, affinity: 0, trust: 0 }));
  return rel;
}

/** Invitados EN MESA: vecinos IA (no humanos) presentes en el bloque del anfitrión, sin contarle a él. */
function guestsAt(world: World, host: ResidentInstance): ResidentInstance[] {
  return Object.values(world.residents)
    .filter((r) => r.present && r.controller.type !== 'human' && r.id !== host.id && r.location === host.home)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Devuelve a cada invitado a SU vivienda (teleport + resident_moved: el cliente anima) y lo libera. */
function sendGuestsHome(world: World, host: ResidentInstance): void {
  for (const g of guestsAt(world, host)) {
    g.location = g.home;
    g.cooldowns['hop'] = 0;
    emit(world, 'resident_moved', { resident: g.id, block: g.home });
  }
}

/**
 * Tick del juego ilegal: corre cada tick (tick() lo llama tras roofTick). Sin anfitrión
 * vivo no hay mesa; sin bloque `gamble` en rules, tampoco (defaults del schema lo traen
 * siempre; un rules.json viejo sin el campo entero tampoco rompe: Zod pone los defaults).
 */
export function gambleTick(world: World, content: Content): void {
  const cfg = content.rules.sim.gamble;
  if (!cfg) return;
  const host = Object.values(world.residents)
    .filter((r) => r.present && r.controller.type !== 'human' && r.archetype === cfg.hostArchetype)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!host) return;

  const partyEnd = host.cooldowns['gamble'] ?? 0;

  // 1) Mesa ABIERTA: redada posible cada tick (el ambiente aprieta).
  if (partyEnd > world.tick) {
    if (nextRandom(world) >= cfg.raidChancePerTick) return;
    const line = pickLine(content.social?.gamble?.linesRaid, world);
    emit(world, 'gamble_raid', { host: host.id, block: host.home, fine: cfg.fine, line });
    // Los invitados EN MESA se capturan ANTES de devolverlos a casa (después ya no están ahí).
    const caught = guestsAt(world, host);
    sendGuestsHome(world, host);
    host.wallet = Math.max(0, host.wallet - cfg.fine);
    world.community.funds += Math.round(cfg.fine * cfg.fundsShare); // la comunidad se queda su parte (precedente junta)
    for (const g of caught) {
      const rel = relationOf(g, host.id);
      rel.affinity = Math.min(100, Math.max(-100, rel.affinity + cfg.guestAffinityPenalty));
    }
    host.cooldowns['gamble'] = 0; // la mesa se cierra por la fuerza
    host.cooldowns['gambleDay'] = world.clock.day; // esta noche no se reabre
    host.cooldowns['gambleRaidDay'] = world.clock.day; // y `cooldownDays` de resaca
    return;
  }

  // 2) Cierre NATURAL: la partida expira justo este tick (una sola vez, marcador aparte).
  if (partyEnd === world.tick && host.cooldowns['gambleOver'] !== world.tick) {
    host.cooldowns['gambleOver'] = world.tick;
    sendGuestsHome(world, host);
    emit(world, 'gamble_over', { host: host.id });
    return;
  }

  // 3) Apertura: dentro de la ventana, sin mesa, sin mesa HOY y sin resaca de redada.
  if (!inMinuteWindow(world.clock.minute, { from: cfg.startMinute, to: cfg.endMinute })) return;
  if (host.cooldowns['gambleDay'] === world.clock.day) return;
  const raidDay = host.cooldowns['gambleRaidDay'] ?? -9999;
  if (world.clock.day - raidDay < cfg.cooldownDays) return;
  if (nextRandom(world) >= cfg.chancePerNight) return;

  // Duración: hasta la hora de cierre del catálogo (la ventana cruza medianoche sin problema).
  const now = world.clock.minute;
  const end = toMinutes(cfg.endMinute);
  const remaining = end > now ? end - now : 1440 - now + end;
  host.cooldowns['gamble'] = world.tick + Math.max(1, remaining);
  host.cooldowns['gambleDay'] = world.clock.day;

  // Invitados: vecinos IA despiertos y presentes (no humanos), los de SU planta primero.
  const hostFloor = world.blocks[host.home]?.cell.floor ?? 0;
  const guests = Object.values(world.residents)
    .filter((r) => r.present && r.controller.type !== 'human' && r.id !== host.id && r.activity !== 'sleep' && r.location !== null)
    .sort((a, b) => {
      const fa = Math.abs((world.blocks[a.home]?.cell.floor ?? 0) - hostFloor);
      const fb = Math.abs((world.blocks[b.home]?.cell.floor ?? 0) - hostFloor);
      return fa - fb || a.id.localeCompare(b.id);
    })
    .slice(0, cfg.maxGuests);

  emit(world, 'gamble_night', { host: host.id, block: host.home, guests: guests.map((g) => g.id) });
  for (const g of guests) {
    g.location = host.home; // teleport (precedente catch_in_act): el cliente anima la subida
    g.cooldowns['hop'] = host.cooldowns['gamble']!; // sentados hasta la hora de cierre
    emit(world, 'gamble_visit', { guest: g.id, host: host.id, block: host.home });
  }
}
