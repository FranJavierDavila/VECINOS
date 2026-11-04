import type { Content, ResidentInstance, World } from '@/game/core/types';
import { emit } from '../events';

/**
 * PROTESTA POR APAGÓN (v1.80) — idea #3 del backlog FASE T:
 *
 * Si el apagón dura y hay algún vecino despierto, uno baja a la puerta del PRESIDENTE
 * y TIMBRA hasta que el jugador abre (`answer_door`) o se cansa (maxRings). El módulo
 * arma la protesta OBSERVANDO el param de luz del pasillo (rules.sim.protest.watchDef/
 * watchParam, el que ev_apagon_nocturno del ecosistema deja a 0) — el cerebro es teatro
 * y el sim es la única verdad que muta world.protest, así que en clásico Y en el servidor
 * autoritativo de multi este código es el mismo.
 *
 * NOTA MULTI: el apagón en sí es del cerebro del ecosistema (local de cada cliente, pisado
 * por los snapshots del servidor — limitación PREVIA de v1.14, no se arregla aquí). Por eso
 * en multijugador el param no baja y la protesta simplemente nunca se arma: coherente con
 * el apagón que la motiva (si no hay apagón visible para el sim, no hay protesta).
 *
 * Determinismo: cero azar — el recluta es el PRIMER despierto por (distancia de planta a la
 * vivienda del presidente, id). Ni Math.random ni Date.now (1 tick = 1 minuto de sim).
 */

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Relación de `from` hacia `to` (la crea a cero si no existe, mismo patrón que social.ts). */
function relationOf(from: ResidentInstance, to: string): { with: string; affinity: number; trust: number } {
  let rel = from.relations.find((x) => x.with === to);
  if (!rel) from.relations.push((rel = { with: to, affinity: 0, trust: 0 }));
  return rel;
}

/** Pasillo (bloque de capa 'corridor') de una planta — réplica local del corridorOf de ai.ts (la costura no importa del vecino). */
function corridorOf(world: World, floor: number): string | null {
  return Object.values(world.blocks).find((b) => b.layer === 'corridor' && b.cell.floor === floor)?.id ?? null;
}

/**
 * Tick de la protesta: corre cada tick (tick() lo llama tras socialTick). Sin bloque
 * `protest` en rules no hay protesta (defaults del schema la traen siempre; un rules.json
 * viejo sin el campo entero tampoco rompe: Zod pone los defaults).
 */
export function protestTick(world: World, content: Content): void {
  const cfg = content.rules.sim.protest;
  if (!cfg) return;

  // 1) Param vigilado: mínimo entre los bloques del defId vigilado (default 100 si el
  //    template no tiene esos bloques o el param no existe → nunca se arma).
  const watched = Object.values(world.blocks).filter((b) => b.defId === cfg.watchDef);
  const values = watched.map((b) => b.params[cfg.watchParam]).filter((v): v is number => typeof v === 'number');
  const minLighting = values.length > 0 ? Math.min(...values) : 100;

  // 2) Sin protesta: apagón detectado (param por debajo del umbral) → armar.
  if (world.protest === null) {
    if (minLighting < cfg.belowThreshold) {
      // ¿A quién timbra el vecino? «Ante el JUGADOR que ejerza de PRESIDENTE» (idea #3):
      // si el jugador ya completó la misión de acceso al cargo (rules.sim.campaign.
      // termMission, world.missions conserva state 'done'), la protesta baja a SU puerta;
      // si no, al presidente del escenario (IA). Sin catálogo de campaña, playerId de
      // recurso. En multi el invitado nunca tiene el mandato → variante ambiental en la
      // puerta del presidente IA (los anillos no suenan en puertas ajenas).
      const camp = content.rules.sim.campaign;
      const termDone = camp ? world.missions.some((m) => m.id === camp.termMission && m.state === 'done') : false;
      world.protest = {
        startTick: world.tick,
        protester: null,
        presidentId: (termDone ? world.playerId : world.community.presidentId) ?? world.playerId,
        phase: 'marching',
        rings: 0,
        lastActionTick: world.tick, // delayMinutes corre desde aquí (primer recluta)
      };
      emit(world, 'protest_armed', {}); // log-only en el cliente
    }
    return;
  }

  const protest = world.protest;

  // 3) Armada pero la luz volvió (rearme del fusibles o restore del cerebro) → disolver.
  if (minLighting >= cfg.belowThreshold) {
    if (protest.protester !== null || protest.rings > 0) emit(world, 'protest_ended', { resident: protest.protester, reason: 'power' });
    world.protest = null;
    return;
  }

  // 4) Recluta: si nadie protesta aún y toca reintento, el primer IA despierto más cercano
  //    a la planta del presidente (por su vivienda). La gracia inicial es delayMinutes
  //    («si el apagón DURA»): hasta entonces nadie baja; después, reintento cada
  //    recruitEveryMinutes. De noche casi todos duermen: sin candidato se reprograma el
  //    reintento y se sigue esperando ("haya vecino despierto" — o nada).
  if (
    protest.protester === null &&
    world.tick - protest.startTick >= cfg.delayMinutes &&
    world.tick - protest.lastActionTick >= cfg.recruitEveryMinutes
  ) {
    const president = world.residents[protest.presidentId];
    const presFloor = president ? (world.blocks[president.home]?.cell.floor ?? 0) : 0;
    const candidates = Object.values(world.residents)
      .filter(
        (r) =>
          r.controller.type !== 'human' &&
          r.present &&
          r.location !== null && // 'out' = location null: no puede bajar de donde no está
          r.activity !== 'sleep' &&
          r.id !== protest.presidentId,
      )
      .sort((a, b) => {
        const fa = Math.abs((world.blocks[a.home]?.cell.floor ?? 0) - presFloor);
        const fb = Math.abs((world.blocks[b.home]?.cell.floor ?? 0) - presFloor);
        return fa - fb || a.id.localeCompare(b.id);
      });
    const pick = candidates[0];
    if (pick) {
      protest.protester = pick.id;
      emit(world, 'protest_recruited', { resident: pick.id });
    }
    // Con o sin candidato: el reintento espera su intervalo (sin candidato no hay bucle caliente).
    protest.lastActionTick = world.tick;
  }

  const protester = protest.protester ? world.residents[protest.protester] : undefined;
  if (!protester || !protester.present) {
    // El reclutado se fue del vecindario (o aún no llegó): soltar y volver a reclutar.
    if (protest.protester !== null) protest.protester = null;
    return;
  }

  // 5) Marcha: TELEPORT una vez al pasillo de la planta del presidente (precedente:
  //    catch_in_act teletransporta roles; el cliente anima el paseo, presentación pura).
  if (protest.phase === 'marching') {
    const president = world.residents[protest.presidentId];
    const presFloor = president ? (world.blocks[president.home]?.cell.floor ?? 0) : 0;
    const target = corridorOf(world, presFloor) ?? president?.home ?? null;
    if (!target) return; // sin destino posible: se reintenta el próximo tick
    protester.location = target;
    emit(world, 'resident_moved', { resident: protester.id, block: target });
    protest.phase = 'ringing';
    protest.rings = 0;
    protest.lastActionTick = world.tick;
  }

  // 6) Timbrazos: cada ringIntervalMinutes, un timbre; al agotar maxRings, rendición
  //    (protest_ended con línea del catálogo) y castigo de afinidad del protestante.
  if (world.tick - protest.lastActionTick >= cfg.ringIntervalMinutes) {
    protest.rings += 1;
    protest.lastActionTick = world.tick;
    if (protest.rings > cfg.maxRings) {
      const line = content.social?.protest?.tiredLine ?? null;
      emit(world, 'protest_ended', { resident: protester.id, reason: 'tired', line });
      const rel = relationOf(protester, protest.presidentId);
      rel.affinity = clamp(rel.affinity + cfg.tiredAffinity, -100, 100);
      world.protest = null;
    } else {
      emit(world, 'protest_ring', { resident: protester.id, block: protester.location, ring: protest.rings, name: null }); // el cliente pone el nombre
    }
  }
}
