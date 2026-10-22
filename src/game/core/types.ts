/**
 * VECINOS — Contrato central de tipos.
 * Única fuente de verdad para simulación, presentación (Babylon.js) e interfaz (React).
 * Basado en el modelo de datos v0.2 del equipo (hito 1), extendido para el prototipo jugable.
 */

// ───────────────────────── Valores básicos ─────────────────────────

export type Access = 'locked' | 'unlocked';
export type Occupancy = 'vacant' | 'occupied' | 'under_works';
export type Weather = 'sunny' | 'cloudy' | 'rain' | 'storm';
export type ParamValue = string | number;
export type Direction = 'horizontal' | 'up' | 'down' | 'diagonal' | 'corridor';
export type Vote = 'yes' | 'no';

// ───────────────────────── Definiciones (catálogo) ─────────────────────────

export interface ParamDef {
  type: 'number' | 'enum';
  min?: number;
  max?: number;
  values?: string[];
  default: ParamValue;
  /** Nivel de progreso a partir del cual la interfaz lo muestra. Sin tier = oculto hasta revealParams. */
  tier?: number;
  label?: string;
}

export interface BlockView {
  color: string;
  /** Colores alternativos para variedad visual entre viviendas. */
  altColor?: string;
}

export interface BlockDef {
  id: string;
  kind: 'common' | 'dwelling' | 'commercial' | 'infrastructure';
  layer: 'main' | 'corridor';
  size: { w: number; h: number };
  traversable?: boolean;
  alignGroup?: string;
  features?: { stairs?: boolean; elevator?: boolean; mailboxes?: boolean; noticeboard?: boolean; bench?: boolean };
  params?: Record<string, ParamDef>;
  container?: { childKind: string; layout: string };
  view: BlockView;
}

export interface RoomDef {
  id: string;
  kind: 'room';
  size: { w: number; h: number };
  params?: Record<string, ParamDef>;
  /** Hueco del futuro editor de interiores (v0.3). */
  furnitureSlots?: string[];
  view: BlockView;
}

export interface LayoutDef {
  id: string;
  rooms: { key: string; defId: string; startsUnlocked: boolean }[];
}

export interface InfluenceRule {
  id: string;
  channel: string;
  spread: Partial<Record<Direction, number>>;
  attenuatedBy?: string;
  decayPerTick: number;
  threshold: number;
  onThreshold?: { emitEvent: string; setParam?: { param: string; delta: number } };
}

/** Pistas de vista para el renderer: color, complemento y accesorio del personaje. */
export interface ArchetypeView {
  color: string;
  accent: string;
  hat: 'cap' | 'bun' | 'sunglasses' | 'headphones' | 'none';
  prop: 'binoculars' | 'guitar' | 'briefcase' | 'cart' | 'spray' | 'phone' | 'none';
  height: number;
}

export interface ArchetypeDef {
  id: string;
  name: string;
  tagline: string;
  traits: Partial<{ gossip: number; sociability: number; tidiness: number; noisiness: number; generosity: number; mischief: number }>;
  needs: string[];
  /** Actividades: emiten influencias y tienen horario. `say` son frases que suelta al interactuar. */
  activities: Record<string, { emits?: Record<string, number>; at?: 'home' | 'corridor' | 'core' | 'out'; say?: string[] }>;
  view: ArchetypeView;
}

export interface DialogDef {
  id: string;
  lines: { speaker: string; text: string }[];
}

// ───────────────────────── Efectos y misiones ─────────────────────────

export type Effect =
  | { op: 'setParam'; target: string; param?: string; value?: ParamValue; delta?: number }
  | { op: 'unlock'; target: string; occupancy?: Occupancy; resident?: string; arrival?: string; availability?: { mode: 'for_sale'; price: number }; lockReason?: string }
  | { op: 'buy'; target: string; price: number }
  | { op: 'addReputation'; resident: string; amount: number }
  | { op: 'addRelation'; a: string; b: string; affinity?: number; trust?: number }
  | { op: 'startMission'; id: string; delayMinutes?: number }
  | { op: 'startMinigame'; id: string }
  | { op: 'grantFavor'; from: string; count: number }
  | { op: 'openJunta'; agenda: JuntaItem[] }
  | { op: 'addFunds'; to: 'community' | string; amount: number }
  | { op: 'revealParams'; tier?: number; params?: string[] }
  | { op: 'hideParams'; tier?: number; params?: string[] }
  | { op: 'toast'; text: string; tone?: 'info' | 'good' | 'bad' }
  | { op: 'finale'; text: string };

export interface JuntaItem {
  id: string;
  title: string;
  description: string;
  cost: number;
  effects: Effect[];
}

export type Condition =
  | { param: string; eq?: ParamValue; gte?: number; lte?: number }
  | { role: string; exists: boolean }
  | { mission: string; state: 'active' | 'done' }
  | { time: { after: string; before?: string } }
  | { dayMin: number };

export interface MissionRoleDef {
  archetype?: string;
  relation?: 'parentOf';
  of?: string;
}

export type MissionStepDef =
  | { id: string; type: 'phone_call'; dialog: string; hint?: string }
  | { id: string; type: 'reach'; target: { block: string; slot?: string }; hint?: string }
  | { id: string; type: 'enter'; target: string; hint?: string }
  | { id: string; type: 'catch_in_act'; target: string; place: string; windowMinutes: number; hint?: string };

export interface ChoiceDef {
  id: string;
  label: string;
  hint?: string;
  icon?: string;
  effects: Effect[];
}

export interface MissionDef {
  id: string;
  title: string;
  description: string;
  roles?: Record<string, MissionRoleDef>;
  trigger?: { all?: Condition[]; any?: Condition[] };
  steps: MissionStepDef[];
  choices?: ChoiceDef[];
  onComplete?: Effect[];
}

export interface TemplateRow {
  floors: [number, number];
  blocks: { col: number; defId: string; tag: string }[];
}

export interface TemplateDef {
  id: string;
  grid: { cols: number; floors: number };
  rows: TemplateRow[];
}

export interface ScenarioResidentDef {
  id: string;
  archetype: string;
  home: string;
  present: boolean;
  controller: { type: 'human'; playerId: string } | { type: 'ai'; profile: string } | { type: 'script' };
  wallet: number;
  reputation: number;
  relations: { with: string; affinity: number; trust: number }[];
  parentOf?: string[];
  needs?: Record<string, number>;
}

export interface ScenarioDef {
  id: string;
  world: { seed: number; clock: { day: number; minute: number }; timeScale: number; weather: { state: Weather; nextChangeMinute: number } };
  building: { id: string; template: string; community: { funds: number; presidentId: string | null }; stateByDef?: Record<string, { params?: Record<string, ParamValue> }> };
  player: { residentId: string; archetype: string; startBlock: string; homeCandidates: string[]; wallet: number; reputation: number };
  residents: ScenarioResidentDef[];
  progress: { revealedTier: number };
  startMissions: string[];
}

export interface Content {
  blocks: Record<string, BlockDef>;
  rooms: Record<string, RoomDef>;
  layouts: Record<string, LayoutDef>;
  influences: Record<string, InfluenceRule>;
  archetypes: Record<string, ArchetypeDef>;
  missions: Record<string, MissionDef>;
  dialogs: Record<string, DialogDef>;
  templates: Record<string, TemplateDef>;
  scenarios: Record<string, ScenarioDef>;
}

// ───────────────────────── Instancias (estado) ─────────────────────────

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
  /** Bloque en el que está ahora (null si aún no ha llegado o está fuera del edificio). */
  location: string | null;
  /** Actividad en curso (id del arquetipo), p. ej. "party", "sleep", "laundry". */
  activity: string | null;
  parentOf: string[];
  wallet: number;
  reputation: number;
  needs: Record<string, number>;
  relations: Relation[];
  /** Tick hasta el que no puede repetir una acción (p. ej. "work"). */
  cooldowns: Record<string, number>;
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
  step: number;
  roles: Record<string, string>;
  until: number | null;
  choice: string | null;
}

export interface JuntaState {
  agenda: JuntaItem[];
  votes: Record<string, Vote>;
  playerVoted: boolean;
}

export interface World {
  schemaVersion: 1;
  scenarioId: string;
  seed: number;
  rngState: number;
  tick: number;
  clock: { day: number; minute: number };
  playerId: string;
  community: { funds: number; presidentId: string | null };
  weather: { state: Weather; nextChangeMinute: number };
  blocks: Record<string, BlockInstance>;
  residents: Record<string, ResidentInstance>;
  channels: Record<string, Record<string, number>>;
  progress: { revealedTier: number; revealedParams: string[]; hiddenParams: string[] };
  missions: ActiveMission[];
  favors: Record<string, number>;
  junta: JuntaState | null;
  events: GameEvent[];
}

// ───────────────────────── Comandos ─────────────────────────

export type Command =
  | { type: 'move'; resident: string; to: string }
  | { type: 'approach'; resident: string; block: string }
  | { type: 'answer_call'; mission: string }
  | { type: 'choose'; mission: string; choice: string }
  | { type: 'work' }
  | { type: 'buy_block'; block: string }
  | { type: 'junta_vote'; vote: Vote }
  | { type: 'knock'; block: string };

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

// ───────────────────────── Posición del jugador (cliente) ─────────────────────────

export interface PlayerPosition {
  x: number;
  /** Altura en unidades de planta (fraccionaria mientras sube o baja). */
  floor: number;
  mode: 'corridor' | 'inside';
  insideBlock: string | null;
  climbing: boolean;
}

export interface Input {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export type InteractTarget =
  | { kind: 'door'; blockId: string }
  | { kind: 'resident'; residentId: string }
  | { kind: 'mailbox' }
  | { kind: 'noticeboard' }
  | { kind: 'laptop' }
  | { kind: 'bed' };

// ───────────────────────── Etiquetas ─────────────────────────

/** "blk_p1_b" → "1B"; los demás ids se devuelven tal cual. */
export function blockLabel(id: string): string {
  const m = /^blk_p(\d+)_([a-d])$/.exec(id);
  return m ? `${m[1]}${m[2]!.toUpperCase()}` : id;
}
