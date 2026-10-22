import { z } from 'zod';
import type { Effect, Condition } from '@/game/core/types';

/**
 * Schemas Zod de los catálogos de contenido. Son la única puerta de entrada:
 * todo JSON de /content/ se valida aquí antes de tocar el sim o la vista.
 */

const paramValue = z.union([z.string(), z.number()]);

export const paramDefSchema = z.object({
  type: z.enum(['number', 'enum']),
  min: z.number().optional(),
  max: z.number().optional(),
  values: z.array(z.string()).optional(),
  default: paramValue,
  tier: z.number().optional(),
  label: z.string().optional(),
});

const viewSchema = z.object({ color: z.string(), altColor: z.string().optional() });

export const blockDefSchema = z.object({
  id: z.string(),
  kind: z.enum(['common', 'dwelling', 'commercial', 'infrastructure']),
  layer: z.enum(['main', 'corridor']),
  size: z.object({ w: z.number(), h: z.number() }),
  traversable: z.boolean().optional(),
  alignGroup: z.string().optional(),
  features: z
    .object({
      stairs: z.boolean().optional(),
      elevator: z.boolean().optional(),
      mailboxes: z.boolean().optional(),
      noticeboard: z.boolean().optional(),
      bench: z.boolean().optional(),
    })
    .optional(),
  params: z.record(z.string(), paramDefSchema).optional(),
  container: z.object({ childKind: z.string(), layout: z.string() }).optional(),
  view: viewSchema,
});

export const furnitureSlotSchema = z.object({
  id: z.string(),
  kind: z.string(),
  pos: z.tuple([z.number(), z.number()]),
});

export const roomDefSchema = z.object({
  id: z.string(),
  kind: z.literal('room'),
  label: z.string().optional(),
  size: z.object({ w: z.number(), h: z.number() }),
  params: z.record(z.string(), paramDefSchema).optional(),
  furnitureSlots: z.array(furnitureSlotSchema).optional(),
  view: viewSchema,
});

export const furnitureDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  emoji: z.string().optional(),
  price: z.number(),
  slots: z.array(z.string()),
  emits: z.record(z.string(), z.number()).optional(),
  params: z.array(z.object({ param: z.string(), delta: z.number() })).optional(),
  view: z.object({ color: z.string(), size: z.tuple([z.number(), z.number(), z.number()]) }),
});

export const layoutDefSchema = z.object({
  id: z.string(),
  rooms: z.array(z.object({ key: z.string(), defId: z.string(), startsUnlocked: z.boolean() })),
});

export const influenceRuleSchema = z.object({
  id: z.string(),
  channel: z.string(),
  label: z.string().optional(),
  emoji: z.string().optional(),
  spread: z.record(z.string(), z.number()),
  attenuatedBy: z.string().optional(),
  decayPerTick: z.number(),
  threshold: z.number(),
  onThreshold: z
    .object({
      emitEvent: z.string(),
      message: z.string().optional(),
      tone: z.enum(['info', 'good', 'bad']).optional(),
      uiLog: z.boolean().optional(),
      setParam: z.object({ param: z.string(), delta: z.number() }).optional(),
    })
    .optional(),
});

const scheduleWindowSchema = z.object({
  from: z.string(),
  to: z.string().optional(),
  chance: z.number().optional(),
  days: z.enum(['all', 'even', 'odd']).optional(),
});

const archetypeViewSchema = z.object({
  color: z.string(),
  accent: z.string(),
  hat: z.enum(['cap', 'bun', 'sunglasses', 'headphones', 'none']),
  prop: z.enum(['binoculars', 'guitar', 'briefcase', 'cart', 'spray', 'phone', 'none']),
  height: z.number(),
});

// ───────────────────────── Efectos (unión discriminada, recursiva por openJunta) ─────────────────────────

const availabilitySchema = z.object({ mode: z.literal('for_sale'), price: z.number() });

const effectSchema: z.ZodType<Effect> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('setParam'), target: z.string(), param: z.string().optional(), value: paramValue.optional(), delta: z.number().optional() }),
    z.object({
      op: z.literal('unlock'),
      target: z.string(),
      occupancy: z.enum(['vacant', 'occupied', 'under_works']).optional(),
      resident: z.string().optional(),
      arrival: z.string().optional(),
      availability: availabilitySchema.optional(),
      lockReason: z.string().optional(),
    }),
    z.object({ op: z.literal('buy'), target: z.string(), price: z.number() }),
    z.object({ op: z.literal('addReputation'), resident: z.string(), amount: z.number() }),
    z.object({ op: z.literal('addRelation'), a: z.string(), b: z.string(), affinity: z.number().optional(), trust: z.number().optional() }),
    z.object({ op: z.literal('startMission'), id: z.string(), delayMinutes: z.number().optional() }),
    z.object({ op: z.literal('startMinigame'), id: z.string() }),
    z.object({ op: z.literal('grantFavor'), from: z.string(), count: z.number() }),
    z.object({
      op: z.literal('openJunta'),
      agenda: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          description: z.string(),
          cost: z.number(),
          effects: z.array(effectSchema),
        }),
      ),
    }),
    z.object({ op: z.literal('addFunds'), to: z.string(), amount: z.number() }),
    z.object({ op: z.literal('revealParams'), tier: z.number().optional(), params: z.array(z.string()).optional() }),
    z.object({ op: z.literal('hideParams'), tier: z.number().optional(), params: z.array(z.string()).optional() }),
    z.object({ op: z.literal('toast'), text: z.string(), tone: z.enum(['info', 'good', 'bad']).optional() }),
    z.object({ op: z.literal('finale'), text: z.string() }),
  ]),
);

const effects = z.array(effectSchema);

export const minigameDefSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    emoji: z.string().optional(),
    instruction: z.string().optional(),
    type: z.literal('timing_bar'),
    config: z.object({
      rounds: z.number(),
      cursorSpeed: z.number(),
      zoneWidth: z.number(),
      zones: z.array(z.number()),
      accelPerRound: z.number(),
      lives: z.number(),
    }),
    onSuccess: effects,
    onFail: effects,
  }),
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    emoji: z.string().optional(),
    instruction: z.string().optional(),
    type: z.literal('tap_sequence'),
    config: z.object({
      rounds: z.number(),
      pads: z.array(z.string()),
      sequenceStart: z.number(),
      sequenceGrow: z.number(),
      showMs: z.number(),
      gapMs: z.number(),
      inputTimeoutMs: z.number(),
      lives: z.number(),
    }),
    onSuccess: effects,
    onFail: effects,
  }),
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    emoji: z.string().optional(),
    instruction: z.string().optional(),
    type: z.literal('reflex_targets'),
    config: z.object({
      targets: z.number(),
      spawnIntervalMs: z.number(),
      targetLifeMs: z.number(),
      radiusPct: z.number(),
      missesAllowed: z.number(),
      lives: z.number(),
      emoji: z.string(),
      decoyEmoji: z.string().optional(),
      decoyChance: z.number().optional(),
    }),
    onSuccess: effects,
    onFail: effects,
  }),
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    emoji: z.string().optional(),
    instruction: z.string().optional(),
    type: z.literal('memory_pairs'),
    config: z.object({
      items: z.array(z.string()),
      lives: z.number(),
    }),
    onSuccess: effects,
    onFail: effects,
  }),
]);

export const archetypeDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string(),
  traits: z.object({
    gossip: z.number().optional(),
    sociability: z.number().optional(),
    tidiness: z.number().optional(),
    noisiness: z.number().optional(),
    generosity: z.number().optional(),
    mischief: z.number().optional(),
  }),
  voteBias: z.number().optional(),
  needs: z.array(z.string()),
  activities: z.record(
    z.string(),
    z.object({
      label: z.string().optional(),
      at: z.enum(['home', 'corridor', 'core', 'out']).optional(),
      say: z.array(z.string()).optional(),
      emits: z.record(z.string(), z.number()).optional(),
      schedule: z.array(scheduleWindowSchema).optional(),
      onStart: effects.optional(),
    }),
  ),
  view: archetypeViewSchema,
});

export const dialogDefSchema = z.object({
  id: z.string(),
  lines: z.array(z.object({ speaker: z.string(), text: z.string() })),
});

// ───────────────────────── Misiones ─────────────────────────

const conditionSchema: z.ZodType<Condition> = z.union([
  z.object({ param: z.string(), eq: paramValue.optional(), gte: z.number().optional(), lte: z.number().optional() }),
  z.object({ role: z.string(), exists: z.boolean() }),
  z.object({ mission: z.string(), state: z.enum(['active', 'done']) }),
  z.object({ time: z.object({ after: z.string(), before: z.string().optional() }) }),
  z.object({ dayMin: z.number() }),
]);

const missionStepSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('phone_call'), dialog: z.string(), hint: z.string().optional() }),
  z.object({ id: z.string(), type: z.literal('reach'), target: z.object({ block: z.string(), slot: z.string().optional() }), hint: z.string().optional() }),
  z.object({ id: z.string(), type: z.literal('enter'), target: z.string(), hint: z.string().optional() }),
  z.object({ id: z.string(), type: z.literal('catch_in_act'), target: z.string(), place: z.string(), windowMinutes: z.number(), hint: z.string().optional() }),
]);

export const missionDefSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  roles: z.record(
    z.string(),
    z.object({ archetype: z.string().optional(), relation: z.literal('parentOf').optional(), of: z.string().optional() }),
  ).optional(),
  trigger: z.object({ all: z.array(conditionSchema).optional(), any: z.array(conditionSchema).optional() }).optional(),
  steps: z.array(missionStepSchema),
  choices: z.array(z.object({ id: z.string(), label: z.string(), hint: z.string().optional(), icon: z.string().optional(), effects })).optional(),
  onComplete: effects.optional(),
});

export const templateDefSchema = z.object({
  id: z.string(),
  grid: z.object({ cols: z.number(), floors: z.number() }),
  rows: z.array(z.object({ floors: z.tuple([z.number(), z.number()]), blocks: z.array(z.object({ col: z.number(), defId: z.string(), tag: z.string() })) })),
});

const controllerSchema = z.union([
  z.object({ type: z.literal('human'), playerId: z.string() }),
  z.object({ type: z.literal('ai'), profile: z.string() }),
  z.object({ type: z.literal('script') }),
]);

export const scenarioDefSchema = z.object({
  id: z.string(),
  world: z.object({
    seed: z.number(),
    clock: z.object({ day: z.number(), minute: z.number() }),
    timeScale: z.number(),
    weather: z.object({ state: z.enum(['sunny', 'cloudy', 'rain', 'storm']), nextChangeMinute: z.number() }),
  }),
  building: z.object({
    id: z.string(),
    template: z.string(),
    community: z.object({ funds: z.number(), presidentId: z.string().nullable() }),
    stateByDef: z.record(z.string(), z.object({ params: z.record(z.string(), paramValue).optional() })).optional(),
  }),
  player: z.object({
    residentId: z.string(),
    archetype: z.string(),
    startBlock: z.string(),
    homeCandidates: z.array(z.string()),
    wallet: z.number(),
    reputation: z.number(),
  }),
  residents: z.array(
    z.object({
      id: z.string(),
      archetype: z.string(),
      home: z.string(),
      present: z.boolean(),
      controller: controllerSchema,
      wallet: z.number(),
      reputation: z.number(),
      relations: z.array(z.object({ with: z.string(), affinity: z.number(), trust: z.number() })),
      parentOf: z.array(z.string()).optional(),
      needs: z.record(z.string(), z.number()).optional(),
    }),
  ),
  progress: z.object({ revealedTier: z.number() }),
  startMissions: z.array(z.string()),
});

export const rulesSchema = z.object({
  startScenario: z.string(),
  sim: z.object({
    night: scheduleWindowSchema,
    aiHopTicks: z.number(),
    missionLoopMax: z.number(),
    defaultNeeds: z.record(z.string(), z.number()),
    economy: z.object({
      rentMinute: z.string(),
      corridorDirtParam: z.string(),
      corridorDirtPerTick: z.number(),
      needDrift: z.record(z.string(), z.object({ base: z.number(), activity: z.record(z.string(), z.number()) })),
    }),
    work: z.object({ pay: z.number(), cooldownTicks: z.number(), funCost: z.number(), toastCooldown: z.string(), toastDone: z.string() }),
    knock: z.object({ affinityGain: z.number(), asleepLine: z.string(), fallbackLines: z.array(z.string()) }),
    weather: z.object({
      cycle: z.array(z.object({ state: z.enum(['sunny', 'cloudy', 'rain', 'storm']), weight: z.number() })),
      durationMinutes: z.object({ min: z.number(), max: z.number() }),
    }),
    junta: z.object({
      baseYes: z.number(),
      affinityDivisor: z.number(),
      generosityFactor: z.number(),
      defaultGenerosity: z.number(),
      moodThreshold: z.number(),
      moodPenalty: z.number(),
      clamp: z.object({ min: z.number(), max: z.number() }),
    }),
  }),
  view: z.object({
    cellW: z.number(),
    cellH: z.number(),
    walkSpeed: z.number(),
    roomSpeed: z.number(),
    stairsSeconds: z.number(),
    elevatorSeconds: z.number(),
    margin: z.number(),
    nearRadius: z.number(),
    laptopOffset: z.number(),
    bedOffset: z.number(),
    itemRadius: z.number(),
    corridorZ: z.number(),
    roomZ: z.number(),
    depth: z.number(),
    wall: z.number(),
    gapW: z.number(),
    gapH: z.number(),
    slab: z.number(),
    sky: z.object({ r: z.number(), g: z.number(), b: z.number() }),
    ambient: z.object({ dir: z.tuple([z.number(), z.number(), z.number()]), intensity: z.number() }),
    sun: z.object({ dir: z.tuple([z.number(), z.number(), z.number()]), intensity: z.number() }),
    lockedColor: z.string(),
    vacantTint: z.number(),
    brokenColor: z.string(),
    lockColor: z.string(),
    homeEdge: z.string(),
    channelGlow: z.record(z.string(), z.string()),
    actorFallbackColor: z.string(),
    actorFallbackHeight: z.number(),
    actorRadius: z.number(),
  }),
  demo: z.object({ resident: z.string(), block: z.string(), noise: z.number(), toast: z.string() }),
  furniture: z.object({
    refundRatio: z.number(),
    roomUnlock: z.object({ price: z.number(), toast: z.string() }),
    errors: z.record(z.string(), z.string()),
  }),
  minigames: z.object({
    winLine: z.string(),
    loseLine: z.string(),
    hitLine: z.string(),
    failLines: z.array(z.string()),
    introByType: z.record(z.string(), z.string()),
  }),
  labels: z.object({ weather: z.record(z.string(), z.string()) }),
});

// ───────────────────────── Listas (los ficheros JSON son arrays; el Content las indexa) ─────────────────────────

export const blockListSchema = z.array(blockDefSchema);
export const roomListSchema = z.array(roomDefSchema);
export const furnitureListSchema = z.array(furnitureDefSchema);
export const minigameListSchema = z.array(minigameDefSchema);
export const layoutListSchema = z.array(layoutDefSchema);
export const influenceListSchema = z.array(influenceRuleSchema);
export const archetypeListSchema = z.array(archetypeDefSchema);
export const dialogListSchema = z.array(dialogDefSchema);
export const missionListSchema = z.array(missionDefSchema);
export const templateListSchema = z.array(templateDefSchema);
export const scenarioListSchema = z.array(scenarioDefSchema);
