import type { Content, World } from '@/game/core/types';
import { nextRandom } from './rng';
import { instantiateRooms } from './rooms';
import { advanceMissions, newMission } from './missions';

const DEFAULT_NEEDS: Record<string, number> = { sleep: 80, social: 50, fun: 55, money: 60 };

/** Crea una partida nueva a partir de un escenario. La vivienda del jugador se elige con la semilla. */
export function createWorld(content: Content, scenarioId: string, overrides: { seed?: number } = {}): World {
  const scenario = content.scenarios[scenarioId];
  if (!scenario) throw new Error(`Escenario desconocido: ${scenarioId}`);
  const template = content.templates[scenario.building.template]!;
  const seed = overrides.seed ?? scenario.world.seed;

  const world: World = {
    schemaVersion: 1,
    scenarioId,
    seed,
    rngState: seed,
    tick: 0,
    clock: { ...scenario.world.clock },
    playerId: scenario.player.residentId,
    community: { ...scenario.building.community },
    weather: { ...scenario.world.weather },
    blocks: {},
    residents: {},
    channels: {},
    progress: { revealedTier: scenario.progress.revealedTier, revealedParams: [], hiddenParams: [] },
    missions: [],
    favors: {},
    junta: null,
    events: [],
  };

  for (const row of template.rows) {
    for (let floor = row.floors[0]; floor <= row.floors[1]; floor++) {
      for (const b of row.blocks) {
        const def = content.blocks[b.defId];
        if (!def) continue;
        const id = `blk_p${floor}_${b.tag}`;
        const params = Object.fromEntries(Object.entries(def.params ?? {}).map(([k, p]) => [k, p.default]));
        Object.assign(params, scenario.building.stateByDef?.[b.defId]?.params ?? {});
        const dwelling = def.kind === 'dwelling';
        world.blocks[id] = {
          id,
          defId: b.defId,
          kind: def.kind,
          layer: def.layer,
          cell: { col: b.col, floor },
          size: def.size,
          access: dwelling ? 'locked' : 'unlocked',
          lockReason: dwelling ? 'for_sale' : null,
          occupancy: 'vacant',
          ownerId: null,
          availability: null,
          params,
          rooms: [],
        };
      }
    }
  }

  // Vecinos del escenario: existen, pero algunos aún no han llegado.
  for (const r of scenario.residents) {
    world.residents[r.id] = {
      id: r.id,
      archetype: r.archetype,
      controller: r.controller,
      home: r.home,
      present: r.present,
      location: r.present ? r.home : null,
      activity: null,
      parentOf: [...(r.parentOf ?? [])],
      wallet: r.wallet,
      reputation: r.reputation,
      needs: { ...DEFAULT_NEEDS, ...(r.needs ?? {}) },
      relations: r.relations.map((x) => ({ ...x })),
      cooldowns: {},
    };
    // Los que ya viven aquí: su vivienda se desbloquea y se amuebla.
    if (r.present) {
      const home = world.blocks[r.home];
      if (home) {
        home.access = 'unlocked';
        home.lockReason = null;
        home.occupancy = 'occupied';
        home.ownerId ??= r.id;
        home.rooms = instantiateRooms(content, home.defId);
      }
    }
  }

  // El jugador: su vivienda se elige al azar (con la semilla) entre las candidatas.
  const candidates = scenario.player.homeCandidates;
  const homeId = candidates[Math.floor(nextRandom(world) * candidates.length)]!;
  const home = world.blocks[homeId]!;
  home.access = 'unlocked';
  home.lockReason = null;
  home.occupancy = 'occupied';
  home.ownerId = scenario.player.residentId;
  home.rooms = instantiateRooms(content, home.defId);
  world.residents[scenario.player.residentId] = {
    id: scenario.player.residentId,
    archetype: scenario.player.archetype,
    controller: { type: 'human', playerId: 'p1' },
    home: homeId,
    present: true,
    location: scenario.player.startBlock,
    activity: null,
    parentOf: [],
    wallet: scenario.player.wallet,
    reputation: scenario.player.reputation,
    needs: { ...DEFAULT_NEEDS },
    relations: [],
    cooldowns: {},
  };

  for (const m of scenario.startMissions) world.missions.push(newMission(m, 0));
  advanceMissions(world, content); // el teléfono del tutorial empieza a sonar desde el primer tick
  return world;
}
