import { z } from 'zod';

// ───────── Primitivas ─────────
export const Id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id en snake_case (minúsculas, números y _)');
const Scalar = z.union([z.number(), z.string(), z.boolean()]);
const Tier = z.number().int().min(1).optional();
const Size = z.strictObject({ w: z.number().int().min(1), h: z.number().int().min(1) });
const View = z.strictObject({
  prefab: z.string().optional(),
  lodFar: z.string().optional(),
  sprite: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color #rrggbb').optional(),
});

// ───────── Parámetros ─────────
export const ParamDef = z.discriminatedUnion('type', [
  z
    .strictObject({ type: z.literal('number'), min: z.number().optional(), max: z.number().optional(), default: z.number(), tier: Tier })
    .refine((p) => (p.min === undefined || p.default >= p.min) && (p.max === undefined || p.default <= p.max), {
      message: 'default fuera de [min, max]',
    }),
  z
    .strictObject({ type: z.literal('enum'), values: z.array(z.string()).min(1), default: z.string(), tier: Tier })
    .refine((p) => p.values.includes(p.default), { message: 'default no está en values' }),
  z.strictObject({ type: z.literal('boolean'), default: z.boolean(), tier: Tier }),
]);
export type ParamDef = z.infer<typeof ParamDef>;
export type ParamValue = number | string | boolean;
const Params = z.record(z.string(), ParamDef);

// ───────── Bloques, estancias y distribuciones ─────────
export const BlockKind = z.enum(['common', 'dwelling', 'commercial', 'infrastructure']);
export const Layer = z.enum(['main', 'corridor']);
const Slot = z.strictObject({
  id: Id,
  type: z.string(),
  side: z.enum(['front', 'back', 'left', 'right', 'top', 'bottom']),
  connectsTo: z.string().optional(),
});

export const BlockDef = z.strictObject({
  id: Id,
  kind: BlockKind,
  layer: Layer,
  size: Size,
  traversable: z.boolean().optional(),
  alignGroup: z.string().optional(),
  features: z.record(z.string(), z.boolean()).optional(),
  container: z.strictObject({ childKind: z.literal('room'), layout: Id }).optional(),
  slots: z.array(Slot).optional(),
  params: Params.default({}),
  view: View.optional(),
});
export type BlockDef = z.infer<typeof BlockDef>;

export const RoomDef = z.strictObject({
  id: Id,
  kind: z.literal('room'),
  size: Size,
  params: Params.default({}),
  furnitureSlots: z.array(z.unknown()).default([]),
  view: View.optional(),
});
export type RoomDef = z.infer<typeof RoomDef>;

export const LayoutDef = z
  .strictObject({
    id: Id,
    rooms: z.array(z.strictObject({ key: Id, defId: Id, startsUnlocked: z.boolean() })).min(1),
  })
  .refine((l) => new Set(l.rooms.map((r) => r.key)).size === l.rooms.length, { message: 'claves de estancia duplicadas' });
export type LayoutDef = z.infer<typeof LayoutDef>;

// ───────── Reglas de influencia ─────────
export const Direction = z.enum(['horizontal', 'up', 'down', 'diagonal', 'corridor']);
export type Direction = z.infer<typeof Direction>;
export const InfluenceRule = z.strictObject({
  id: Id,
  channel: Id,
  spread: z.partialRecord(Direction, z.number().min(0).max(1)),
  attenuatedBy: z.string().optional(),
  via: z.literal('shaft').optional(), // aceptado por el esquema; aún no usado por la simulación
  decayPerTick: z.number().min(0).max(1),
  threshold: z.number().min(0),
  onThreshold: z
    .strictObject({
      emitEvent: Id,
      setParam: z.strictObject({ param: z.string(), delta: z.number() }).optional(),
    })
    .optional(),
});
export type InfluenceRule = z.infer<typeof InfluenceRule>;

// ───────── Arquetipos de residente ─────────
export const Need = z.enum(['sleep', 'social', 'fun', 'money']);
export const ArchetypeDef = z.strictObject({
  id: Id,
  name: z.string(),
  traits: z.record(z.string(), z.number().min(0).max(1)),
  needs: z.array(Need),
  activities: z
    .record(z.string(), z.strictObject({ emits: z.record(z.string(), z.number().min(0).max(1)).default({}), gossipGain: z.number().optional() }))
    .default({}),
  view: View.optional(),
});
export type ArchetypeDef = z.infer<typeof ArchetypeDef>;

// ───────── Efectos, condiciones y misiones ─────────
const oneOf = (a: unknown, b: unknown) => (a === undefined) !== (b === undefined);
export const Effect = z.discriminatedUnion('op', [
  z
    .strictObject({ op: z.literal('setParam'), target: z.string(), param: z.string().optional(), value: Scalar.optional(), delta: z.number().optional() })
    .refine((e) => oneOf(e.value, e.delta), { message: 'setParam requiere value o delta (solo uno)' }),
  z.strictObject({
    op: z.literal('unlock'),
    target: z.string(),
    occupancy: z.enum(['vacant', 'occupied', 'under_works']).optional(),
    resident: Id.optional(),
    arrival: z.string().optional(),
    availability: z.strictObject({ mode: z.literal('for_sale'), price: z.number().positive() }).optional(),
  }),
  z.strictObject({ op: z.literal('addRelation'), a: z.string(), b: z.string(), affinity: z.number().optional(), trust: z.number().optional() }),
  z.strictObject({ op: z.literal('startMission'), id: Id, delayMinutes: z.number().int().min(0).optional() }),
  z.strictObject({ op: z.literal('startMinigame'), id: Id }),
  z.strictObject({ op: z.literal('grantFavor'), from: z.string(), count: z.number().int().min(1) }),
  z.strictObject({ op: z.literal('openJunta'), agenda: z.array(Id).min(1) }),
  z.strictObject({ op: z.literal('addFunds'), to: z.string(), amount: z.number() }),
  z
    .strictObject({ op: z.literal('revealParams'), tier: z.number().int().min(1).optional(), params: z.array(z.string()).optional() })
    .refine((e) => e.tier !== undefined || (e.params?.length ?? 0) > 0, { message: 'revealParams requiere tier o params' }),
  z
    .strictObject({ op: z.literal('hideParams'), tier: z.number().int().min(1).optional(), params: z.array(z.string()).optional() })
    .refine((e) => e.tier !== undefined || (e.params?.length ?? 0) > 0, { message: 'hideParams requiere tier o params' }),
]);
export type Effect = z.infer<typeof Effect>;

export const Condition = z.union([
  z.strictObject({ param: z.string(), eq: Scalar }),
  z.strictObject({ role: z.string(), exists: z.boolean() }),
  z.strictObject({ mission: Id, state: z.enum(['active', 'done']) }),
  z.strictObject({ time: z.strictObject({ after: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM') }) }),
]);
export type Condition = z.infer<typeof Condition>;
export const Trigger = z.union([z.strictObject({ all: z.array(Condition).min(1) }), z.strictObject({ any: z.array(Condition).min(1) })]);

const Step = z.discriminatedUnion('type', [
  z.strictObject({ id: Id, type: z.literal('phone_call'), dialog: Id }),
  z.strictObject({ id: Id, type: z.literal('reach'), target: z.strictObject({ block: z.string(), slot: z.string().optional() }) }),
  z.strictObject({ id: Id, type: z.literal('enter'), target: z.string() }),
  z.strictObject({ id: Id, type: z.literal('catch_in_act'), target: z.string(), place: z.string(), windowMinutes: z.number().int().positive() }),
]);

export const MissionDef = z
  .strictObject({
    id: Id,
    title: z.string(),
    roles: z.record(z.string(), z.strictObject({ archetype: Id.optional(), relation: z.string().optional(), of: z.string().optional() })).optional(),
    trigger: Trigger.optional(),
    steps: z.array(Step).min(1),
    choices: z.array(z.strictObject({ id: Id, label: z.string(), effects: z.array(Effect).min(1) })).optional(),
    onComplete: z.array(Effect).optional(),
  })
  .refine((m) => new Set(m.steps.map((s) => s.id)).size === m.steps.length, { message: 'ids de paso duplicados' })
  .refine((m) => !m.choices || new Set(m.choices.map((c) => c.id)).size === m.choices.length, { message: 'ids de decisión duplicados' });
export type MissionDef = z.infer<typeof MissionDef>;

// ───────── Diálogos ─────────
export const DialogDef = z.strictObject({
  id: Id,
  lines: z.array(z.strictObject({ speaker: z.string(), text: z.string() })).min(1),
});
export type DialogDef = z.infer<typeof DialogDef>;

// ───────── Plantilla de edificio y escenario ─────────
export const TemplateDef = z
  .strictObject({
    id: Id,
    grid: z.strictObject({ cols: z.number().int().min(1), floors: z.number().int().min(1) }),
    rows: z
      .array(
        z.strictObject({
          floors: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
          blocks: z.array(z.strictObject({ col: z.number().int().min(0), defId: Id, tag: Id })).min(1),
        }),
      )
      .min(1),
  })
  .refine((t) => t.rows.every((r) => r.floors[0] <= r.floors[1]), { message: 'floors debe ser [desde, hasta] con desde <= hasta' });
export type TemplateDef = z.infer<typeof TemplateDef>;

export const ScenarioDef = z.strictObject({
  schemaVersion: z.literal(1),
  id: Id,
  world: z.strictObject({
    seed: z.number().int(),
    clock: z.strictObject({ day: z.number().int().min(1), minute: z.number().int().min(0).max(1439) }),
    timeScale: z.number().positive(),
    weather: z.strictObject({ state: z.enum(['sunny', 'cloudy', 'rain', 'storm']), nextChangeMinute: z.number().int().min(0) }),
  }),
  building: z.strictObject({
    id: Id,
    template: Id,
    community: z.strictObject({ funds: z.number(), presidentId: Id.nullable() }),
    stateByDef: z.record(Id, z.strictObject({ params: z.record(z.string(), Scalar).default({}) })).default({}),
  }),
  player: z.strictObject({
    residentId: Id,
    archetype: Id,
    startBlock: z.string(),
    homeCandidates: z.array(z.string()).min(1),
    wallet: z.number(),
    reputation: z.number(),
  }),
  residents: z.array(
    z.strictObject({
      id: Id,
      archetype: Id,
      home: z.string(),
      present: z.boolean(),
      controller: z.discriminatedUnion('type', [
        z.strictObject({ type: z.literal('ai'), profile: z.string() }),
        z.strictObject({ type: z.literal('script') }),
      ]),
      wallet: z.number(),
      reputation: z.number(),
      parentOf: z.array(Id).default([]),
      relations: z.array(z.strictObject({ with: Id, affinity: z.number(), trust: z.number() })).default([]),
    }),
  ),
  progress: z.strictObject({ revealedTier: z.number().int().min(1) }),
  startMissions: z.array(Id),
});
export type ScenarioDef = z.infer<typeof ScenarioDef>;

// ───────── Catálogo de esquemas por carpeta ─────────
export const FOLDER_SCHEMAS = {
  blocks: BlockDef,
  rooms: RoomDef,
  layouts: LayoutDef,
  influences: InfluenceRule,
  archetypes: ArchetypeDef,
  missions: MissionDef,
  dialogs: DialogDef,
  templates: TemplateDef,
  scenarios: ScenarioDef,
} as const;
export type Folder = keyof typeof FOLDER_SCHEMAS;
export const FOLDERS = Object.keys(FOLDER_SCHEMAS) as Folder[];
