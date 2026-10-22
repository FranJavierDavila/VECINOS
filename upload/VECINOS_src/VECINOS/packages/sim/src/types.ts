import type { ParamValue } from '@vecinos/content';

export type Access = 'locked' | 'unlocked';
export type Occupancy = 'vacant' | 'occupied' | 'under_works';

export interface RoomInstance {
  key: string;
  defId: string;
  access: Access;
}

export interface BlockInstance {
  id: string;
  defId: string;
  kind: 'common' | 'dwelling' | 'commercial' | 'infrastructure';
  layer: 'main' | 'corridor';
  cell: { col: number; floor: number };
  size: { w: number; h: number };
  access: Access;
  lockReason: string | null;
  occupancy: Occupancy;
  ownerId: string | null;
  availability: { mode: 'for_sale'; price: number } | null;
  params: Record<string, ParamValue>;
  rooms: RoomInstance[];
}

export interface Relation {
  with: string;
  affinity: number;
  trust: number;
}

export type Controller = { type: 'human'; playerId: string } | { type: 'ai'; profile: string } | { type: 'script' };

export interface ResidentInstance {
  id: string;
  archetype: string;
  controller: Controller;
  home: string;
  present: boolean;
  /** Bloque en el que está ahora (null si aún no ha llegado al edificio). */
  location: string | null;
  parentOf: string[];
  wallet: number;
  reputation: number;
  relations: Relation[];
}

export interface GameEvent {
  tick: number;
  type: string;
  data: Record<string, unknown>;
}

export type MissionState = 'pending' | 'active' | 'awaiting_choice' | 'done' | 'failed';

export interface ActiveMission {
  id: string;
  state: MissionState;
  startAtTick: number;
  /** Índice del paso actual. */
  step: number;
  /** Rol de la misión → id de residente (p. ej. kid → res_nino_01). */
  roles: Record<string, string>;
  /** Tick límite del paso actual, si tiene ventana de tiempo. */
  until: number | null;
  choice: string | null;
}

/** Estado completo de una partida: es JSON puro, así que se guarda y se envía tal cual. */
export interface World {
  schemaVersion: 1;
  scenarioId: string;
  seed: number;
  rngState: number;
  tick: number;
  clock: { day: number; minute: number };
  playerId: string;
  community: { funds: number; presidentId: string | null };
  blocks: Record<string, BlockInstance>;
  residents: Record<string, ResidentInstance>;
  channels: Record<string, Record<string, number>>;
  progress: { revealedTier: number; revealedParams: string[]; hiddenParams: string[] };
  missions: ActiveMission[];
  favors: Record<string, number>;
  events: GameEvent[];
}
