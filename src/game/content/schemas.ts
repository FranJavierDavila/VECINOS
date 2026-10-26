import { z } from 'zod';
import type { ActivityDef, Condition, Effect, EcosystemEvent, EcosystemOutcome, EcosystemWhen } from '@/game/core/types';

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

/**
 * ── Bloques EXTERIORES (v1.20) ── decorado urbano a pie de calle (aceras, carreteras,
 * jardines). Nunca se instancian en el mundo del sim: son catálogo puro y la colocación
 * vive en rules.view.exterior.rows; la presentación levanta el cuerpo y sus props.
 */
export const exteriorBlockSchema = z.object({
  /** Alto del cuerpo del bloque (m): acera 0.12, carretera 0.04, jardín 0.18… */
  height: z.number().min(0).default(0.1),
  /** Bordillo (v1.22): listón fino a lo largo de AMBOS bordes largos (empalme correcto
   *  entre acera y calzada). Vacío = sin bordillo. */
  curbColor: z.string().default(''),
  curbW: z.number().min(0).default(0.16),
  /** Paso de cebra (v1.22): franjas perpendiculares al eje largo (variantes de carretera). */
  zebra: z.boolean().default(false),
  zebraColor: z.string().default('#f2ead9'),
  zebraStripeW: z.number().positive().default(0.5),
  zebraGap: z.number().min(0).default(0.5),
  /** Bancos (aceras): uno cada N metros (0 = sin bancos). */
  benchEvery: z.number().min(0).default(0),
  benchColor: z.string().default('#8a5a33'),
  benchLegColor: z.string().default('#3b3129'),
  /** Farolas: una cada N metros (0 = sin farolas). */
  lampEvery: z.number().min(0).default(0),
  lampColor: z.string().default('#3b3129'),
  lampHeadColor: z.string().default('#ffd166'),
  lampH: z.number().positive().default(3.4),
  /** Papelera junto a cada banco (0 = ninguna). */
  binEvery: z.number().min(0).default(0),
  binColor: z.string().default('#5d6b7a'),
  /** Carretera: línea discontinua al centro, tramo N metros (0 = sin marcas). */
  laneDash: z.number().min(0).default(0),
  laneDashColor: z.string().default('#f4e9d8'),
  /** Vegetación (jardines): árboles y arbustos por cada 10 m de tira. */
  treesPer10m: z.number().min(0).default(0),
  bushesPer10m: z.number().min(0).default(0),
  /** Dispersión 2D (v1.22): reparte la vegetación por TODO el rect de la fila en lugar
   *  de a lo largo del eje; los topes limitan las mallas en jardines enormes. */
  gridScatter: z.boolean().default(false),
  maxTrees: z.number().int().min(0).optional(),
  maxBushes: z.number().int().min(0).optional(),
  flowerChance: z.number().min(0).max(1).default(0.35),
  trunkColor: z.string().default('#6f4926'),
  leafColors: z.array(z.string()).default(['#5a9367', '#84a59d', '#708c5a']),
  bushColors: z.array(z.string()).default(['#5a9367', '#6f9b72', '#8fb573']),
  flowerColors: z.array(z.string()).default(['#e07a5f', '#ffd166', '#f2cc8f', '#e56b6f']),
  /** Césped del jardín (tapa del cuerpo). */
  grassColor: z.string().default('#7fa05f'),
});

export const blockDefSchema = z.object({
  id: z.string(),
  kind: z.enum(['common', 'dwelling', 'commercial', 'infrastructure']),
  /** Nombre visible para el prompt/HUD (p. ej. 'la lavandería'). */
  label: z.string().optional(),
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
      /** Pasillo interior de circulación (v1.18): el bloque se recorre ANDANDO por su
       *  corredor central (trasteros por columna) — el jugador y los NPCs caminan por él. */
      innerCorridor: z.boolean().optional(),
    })
    .optional(),
  params: z.record(z.string(), paramDefSchema).optional(),
  container: z.object({ childKind: z.string(), layout: z.string() }).optional(),
  view: viewSchema,
  /** Props de bloque EXTERIOR (v1.20): solo aceras/carreteras/jardines del decorado. */
  exterior: exteriorBlockSchema.optional(),
});

/**
 * Ranura de mobiliario. `pos` = [x, z] en metros LOCALES a la estancia (0,0 = esquina
 * frontal-izquierda del rect de la estancia en el layout). `y` opcional = altura del punto
 * de anclaje sobre el suelo (muebles de pared); sin y, el mueble se apoya en el suelo.
 */
export const furnitureSlotSchema = z.object({
  id: z.string(),
  kind: z.string(),
  pos: z.tuple([z.number(), z.number()]),
  y: z.number().optional(),
});

export const roomDefSchema = z.object({
  id: z.string(),
  kind: z.literal('room'),
  label: z.string().optional(),
  size: z.object({ w: z.number(), h: z.number() }),
  params: z.record(z.string(), paramDefSchema).optional(),
  furnitureSlots: z.array(furnitureSlotSchema).optional(),
  /**
   * Fijaciones interactivas de la estancia (no son muebles del editor): portátil, cama…
   * `pos` = [x, z] en metros locales al rect de la estancia; el jugador las usa por
   * proximidad 2D (rules.view.itemRadius). Solo responden en la vivienda propia.
   */
  interactables: z
    .array(z.object({ id: z.string(), kind: z.enum(['laptop', 'bed']), pos: z.tuple([z.number(), z.number()]) }))
    .optional(),
  /**
   * Anclas de actividad de los vecinos (no interactivas para el jugador): dónde se colocan
   * dentro de la estancia las actividades que declaran `anchor` con ese kind en el arquetipo
   * (tv, stove, desk, amp…). `pos` = [x, z] en metros locales al rect de la estancia.
   */
  anchors: z.array(z.object({ id: z.string(), kind: z.string(), pos: z.tuple([z.number(), z.number()]) })).optional(),
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

/**
 * Layout interior de una vivienda (Fase C, 100% data-driven). Cada estancia ocupa un rect
 * en metros LOCALES a la planta de la vivienda: x desde la pared izquierda, z desde el
 * plano frontal (la puerta). Los rects deben teselar la huella (size.w * view.cellW de ancho
 * × view.depth de calado para viviendas). Sin rects, el layout cae al comportamiento 1D
 * antiguo (bandas) — compatibilidad con catálogos previos.
 * `doorways`: huecos en los tabiques entre pares de estancias. `axis` = eje QUE CORRE el
 * tabique ('z' = tabique perpendicular a X, se cruza andando en X; 'x' = perpendicular a Z);
 * `at` = coordenada del centro del hueco según ese eje; `width` = anchura del hueco.
 * Entrar en una estancia cerrada (access locked) está bloqueado tenga o no hueco.
 */
export const layoutDefSchema = z.object({
  id: z.string(),
  rooms: z.array(
    z.object({
      key: z.string(),
      defId: z.string(),
      startsUnlocked: z.boolean(),
      rect: z.object({ x: z.number(), z: z.number(), w: z.number(), d: z.number() }).optional(),
    }),
  ),
  doorways: z
    .array(z.object({ a: z.string(), b: z.string(), axis: z.enum(['x', 'z']), at: z.number(), width: z.number() }))
    .optional(),
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
      /** Destino: 'home'|'corridor'|'core'|'stairs'|'out', o 'def:<blockDefId>' para ir a un bloque por tipo (bar, lavandería…). */
      at: z
        .union([z.enum(['home', 'corridor', 'core', 'stairs', 'out']), z.string().regex(/^def:[\w-]+$/, 'debe ser def:<blockDefId>')])
        .optional() as z.ZodType<ActivityDef['at']>,
      /** Kind de ancla de estancia donde ocurre (cama, tv, stove…): vida interior de los vecinos. */
      anchor: z.string().optional(),
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

// ───────────────────────── Cutscenes (Fase D) ─────────────────────────

/** Punto de escenario: bloque (literal o $home/$entry/$event.block) y punto dentro de él. */
const cutsceneSpotSchema = z.object({ block: z.string().min(1), at: z.enum(['door', 'center']) });

export const cutsceneDefSchema = z.object({
  id: z.string(),
  trigger: z.object({
    on: z.enum(['neighbor_arrived', 'mission_activated', 'step_started', 'step_completed', 'mission_completed', 'mission_failed']),
    mission: z.string().optional(),
    step: z.string().optional(),
  }),
  beats: z.array(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('cam'), focus: z.union([z.literal('wide'), z.literal('player'), cutsceneSpotSchema]), viewH: z.number().positive().optional(), hold: z.number().positive().optional() }),
      z.object({ type: z.literal('walk'), who: z.string().min(1), from: cutsceneSpotSchema.optional(), to: cutsceneSpotSchema, max: z.number().positive().optional(), viewH: z.number().positive().optional() }),
      z.object({
        type: z.literal('line'),
        speaker: z.string().optional(),
        text: z.string().min(1),
        seconds: z.number().positive().optional(),
        /** Actor que dice la línea ($event.resident/$role.x/id): hace el gesto mientras habla. */
        who: z.string().optional(),
        /** Estado social del gesto (stateAnimations: talk/laugh/argue/phone…); default 'talk'. */
        gesture: z.string().optional(),
      }),
      z.object({ type: z.literal('wait'), seconds: z.number().positive() }),
      z.object({ type: z.literal('sound'), id: z.string().min(1) }),
    ]),
  ),
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
  multiplayer: z.object({ guestArchetype: z.string().optional(), guestWallet: z.number().optional() }).optional(),
  minigameOverrides: z
    .record(
      z.string(),
      z.object({
        cursorSpeed: z.number().optional(),
        zoneWidth: z.number().optional(),
        rounds: z.number().optional(),
        lives: z.number().optional(),
        accelPerRound: z.number().optional(),
        inputTimeoutMs: z.number().optional(),
        showMs: z.number().optional(),
        gapMs: z.number().optional(),
        sequenceStart: z.number().optional(),
        sequenceGrow: z.number().optional(),
        targets: z.number().optional(),
        spawnIntervalMs: z.number().optional(),
        targetLifeMs: z.number().optional(),
        radiusPct: z.number().optional(),
        missesAllowed: z.number().optional(),
        decoyChance: z.number().optional(),
      }),
    )
    .optional(),
});

export const rulesSchema = z.object({
  startScenario: z.string(),
  multiplayer: z.object({
    guestArchetype: z.string(),
    guestWallet: z.number(),
    maxPlayers: z.number(),
    tickSecondsPerTick: z.number(),
    joinToast: z.string(),
    leaveToast: z.string(),
    texts: z.object({ sessionFull: z.string(), noVacant: z.string(), remoteSaveDisabled: z.string() }),
  }),
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
    sleep: z.object({ restore: z.record(z.string(), z.number()), toastDone: z.string() }),
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
    /** Campaña de presidencia (v1.18, presentación/support): la misión que otorga el cargo,
     *  la que cierra el mandato, su duración en días de juego y la agenda que el presidente
     *  puede convocar desde el tablón. El sim NO la usa; el HUD y el tablón sí. */
    campaign: z
      .object({
        termMission: z.string(),
        endMission: z.string(),
        termDays: z.number().int().min(1).default(7),
        presidentLabel: z.string().default('Presidencia'),
        convocationCooldownMinutes: z.number().int().min(0).default(360),
        presetAgenda: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            description: z.string(),
            cost: z.number(),
            effects: z.array(z.custom<Effect>(() => true as const)),
          }),
        ),
      })
      .optional(),
    /** Malestar vecinal con el ascensor averiado (v1.5): subir por la escalera cuesta ánimo
     *  social y, de vez en cuando, un resoplido público (evento stairs_grumble, texto del catálogo). */
    elevator: z
      .object({
        stairsMoodCost: z.number().min(0).default(0.05),
        grumbleChance: z.number().min(0).max(1).default(0.05),
        grumbleCooldownMinutes: z.number().positive().default(180),
        grumbleText: z.string().default('🛗 {name} sube por la escalera: el ascensor sigue averiado.'),
      })
      .default({ stairsMoodCost: 0.05, grumbleChance: 0.05, grumbleCooldownMinutes: 180, grumbleText: '🛗 {name} sube por la escalera: el ascensor sigue averiado.' }),
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
    /** @deprecated sustituido por interactables del catálogo de estancias (Fase C). */
    laptopOffset: z.number().optional(),
    /** @deprecated sustituido por interactables del catálogo de estancias (Fase C). */
    bedOffset: z.number().optional(),
    itemRadius: z.number(),
    corridorZ: z.number(),
    /** Calado del pasillo exterior (tiras transitables): saliente hacia la calle. */
    corridorDepth: z.number().default(0.5),
    /** Altura de la barandilla del pasillo (0 = sin barandilla). */
    corridorRail: z.number().default(0),
    /** Velocidad de crucero de los vecinos (IA) en m/s: la interpolación nunca "teletransporta". */
    npcWalkSpeed: z.number().default(2.2),
    /** Segundos entre deambulaciones de un vecino en casa sin ancla de actividad (vida interior). */
    npcWanderSeconds: z.number().default(8),
    /** Suavizado del giro del actor hacia su dirección de movimiento (rad/s, 2.5D creíble). */
    actorTurnSpeed: z.number().positive().default(10),
    /** Anti-patinaje (v1.3): velocidad natural de los clips al ratio 1 (m/s) y límites del
     *  ratio de playback. El runtime escala la animación con la velocidad PLANA real del
     *  actor: walkRefSpeed/runRefSpeed deben coincidir con la zancada authorada en los glTF
     *  (WALK_NATURAL_SPEED / RUN_NATURAL_SPEED de scripts/lib/gltf.ts). */
    animSync: z
      .object({
        walkRefSpeed: z.number().positive().default(1.15),
        runRefSpeed: z.number().positive().default(2.2),
        minRate: z.number().positive().default(0.6),
        maxRate: z.number().positive().default(2.65),
      })
      .default({ walkRefSpeed: 1.15, runRefSpeed: 2.2, minRate: 0.6, maxRate: 2.65 }),
    /** Escalera de vecinos (v1.4): geometría compartida por la authoría glTF y el runtime
     *  (src/game/stairs.ts). Metros; spanW en celdas; doorLocalX respecto al centro del cubo
     *  visual; carriles desde el plano frontal del bloque. */
    stairs: z
      .object({
        spanW: z.number().int().min(1).default(2),
        doorLocalX: z.number().default(-1.14),
        entryHalf: z.number().positive().default(0.45),
        laneFront: z.number().positive().default(0.35),
        laneBack: z.number().positive().default(1.05),
        flightRun: z.number().positive().default(2.19),
        landingX: z.number().positive().default(0.5),
        stepCount: z.number().int().min(4).default(8),
        climbSpeed: z.number().positive().default(1.8),
        /** Forjado interior continuo del cubo (v1.18): losa a nivel de entrada que cubre la
         *  huella del cubo en CADA planta — jamás se camina sobre un tramo sin suelo dentro
         *  del bloque de escalera. La authoría glTF conserva su forjado de entrada; esta losa
         *  (runtime) completa el resto hasta los muros. */
        floorSlab: z
          .object({
            enabled: z.boolean().default(true),
            thickness: z.number().positive().default(0.14),
            color: z.string().default('#b8c0a8'),
            topAt: z.number().min(0).default(0.14),
          })
          .default({ enabled: true, thickness: 0.14, color: '#b8c0a8', topAt: 0.14 }),
      })
      .default({ spanW: 2, doorLocalX: -1.14, entryHalf: 0.45, laneFront: 0.35, laneBack: 1.05, flightRun: 2.19, landingX: 0.5, stepCount: 8, climbSpeed: 1.8, floorSlab: { enabled: true, thickness: 0.14, color: '#b8c0a8', topAt: 0.14 } }),
    /** Ascensor creíble (v1.5, presentación): semáforo de permisos con llamadas, puertas que
     *  abren/cierran, espera al embarco y capacidad limitada. TODO en el catálogo, nada a pelo. */
    elevator: z
      .object({
        capacity: z.number().int().min(1).default(4),
        doorWaitMs: z.number().positive().default(5000),
        doorMoveMs: z.number().positive().default(700),
        floorsPerSecond: z.number().positive().default(1.4),
        /** Aceleración de la cabina (plantas/s², v1.12): perfil trapezoidal acelerar→crucero→frenar.
         *  Los viajes cortos ni llegan al crucero (triangulares); la duración SIEMPRE crece con la
         *  distancia — nunca un teletransporte entre plantas. */
        accelFloorsPerSecond2: z.number().positive().default(1.2),
        cabinColor: z.string().default('#aeb8c2'),
        doorColor: z.string().default('#cbd5e1'),
        callColor: z.string().default('#ffd166'),
        brokenColor: z.string().default('#c1666b'),
        rideZ: z.number().default(0.35),
      })
      .default({ capacity: 4, doorWaitMs: 5000, doorMoveMs: 700, floorsPerSecond: 1.4, accelFloorsPerSecond2: 1.2, cabinColor: '#aeb8c2', doorColor: '#cbd5e1', callColor: '#ffd166', brokenColor: '#c1666b', rideZ: 0.35 }),
    /** Cartel numerado sobre cada puerta de vivienda (v1.6): el label sale del id del bloque
     *  (blk_p3_c → "3C") con DynamicTexture; tamaño, posición y colores del catálogo. */
    plaque: z
      .object({
        w: z.number().positive().default(0.62),
        h: z.number().positive().default(0.24),
        y: z.number().default(2.18),
        z: z.number().default(-0.04),
        bg: z.string().default('#3b3129'),
        text: z.string().default('#ffd166'),
        fontPx: z.number().positive().default(64),
      })
      .default({ w: 0.62, h: 0.24, y: 2.18, z: -0.04, bg: '#3b3129', text: '#ffd166', fontPx: 64 }),
    /** Trasteros por planta (v1.16): nave abierta con estanterías a ambos lados del pasillo
     *  interior, numeradas con la vivienda propietaria (cartel dinámico como el plaque). El
     *  reparto es SECUENCIAL por orden de planta y letra: la estantería k de la planta de
     *  trasteros i pertenece a la vivienda k+i·shelvesPerLevel del listado (planta, columna).
     *  Las plantas de trasteros necesarias emergen de la plantilla; con shelvesPerLevel=8 y
     *  28 viviendas hacen falta 4 niveles (contracts con la authoría glTF: bays alineadas). */
    trasteros: z
      .object({
        shelvesPerLevel: z.number().int().min(1).default(8),
        margin: z.number().min(0).default(0.55),
        bayW: z.number().positive().default(2.2),
        frontTiers: z.number().int().min(0).default(2),
        backTiers: z.number().int().min(0).default(3),
        tierH: z.number().positive().default(0.5),
        shelfD: z.number().positive().default(0.45),
        plankT: z.number().positive().default(0.05),
        postW: z.number().positive().default(0.08),
        junkChance: z.number().min(0).max(1).default(0.62),
        floorJunk: z.number().int().min(0).default(3),
        wood: z.string().default('#8a5a33'),
        woodDark: z.string().default('#6f4926'),
        junk: z.array(z.string()).default(['#c9a66b', '#7d8493', '#9c6644', '#84a59d', '#e07a5f', '#b08968']),
        emptyLabel: z.string().default('—'),
        ownBg: z.string().default('#ffd166'),
        ownText: z.string().default('#3b3129'),
        plaqueW: z.number().positive().default(0.52),
        plaqueH: z.number().positive().default(0.18),
        /** Tabiques divisorios entre trasteros (v1.17): cada ranura se lee como trastero
         *  propio. La altura es la del unit + partitionExtra; color propio del catálogo. */
        partitionExtra: z.number().min(0).default(0.22),
        partitionColor: z.string().default('#6f4926'),
        /** Cabecera de cartel sobre la fachada de cada estantería (v1.17): travesaño donde
         *  se monta el cartel numerado "en la propia estantería" (no flotando). */
        headerH: z.number().min(0).default(0.15),
        /** ── Bloques de trasteros por COLUMNA (v1.18) ── Una sola planta de trasteros por
         *  letra: cada bloque guarda los trasteros de TODAS las viviendas de su columna
         *  (impares a la izquierda del pasillo central, pares a la derecha), con
         *  compartimentos CERRADOS (el interior no se ve: qué esconderá cada vecino).
         *  La profundidad del bloque escala la de vivienda (blockDepthFactor). */
        blockDepthFactor: z.number().min(1).default(1),
        corridorW: z.number().positive().default(1.2),
        wallT: z.number().positive().default(0.08),
        doorW: z.number().positive().default(0.82),
        doorH: z.number().positive().default(1.72),
        unitH: z.number().positive().default(2.16),
        doorColor: z.string().default('#7a5230'),
        /** Puerta del trastero del JUGADOR (v1.19): dorada, para encontrar la tuya a la primera. */
        ownDoorColor: z.string().default('#ffd166'),
        oddSide: z.enum(['left', 'right']).default('left'),
        blockDefId: z.string().default('trasteros_columna'),
        /** ── Interior presentable de la celda propia (v1.19, swap de bloques) ── el bloque
         *  principal se desvanece y el interior del trastero aparece como bloque activo. */
        cellRoomDepth: z.number().positive().default(2.8),
        cellShelfTiers: z.number().int().min(1).default(3),
        cellJunk: z.number().int().min(0).default(7),
        /** Cartel guía EXTERIOR (v1.19): sobre el hueco del pasillo central, muestra qué
         *  trasteros tienes a cada lado según la profundidad a la que caminas. */
        guide: z
          .object({
            w: z.number().positive().default(1.9),
            h: z.number().positive().default(0.44),
            aboveUnit: z.number().min(0).default(0.62),
            bg: z.string().default('#3b3129'),
            text: z.string().default('#ffd166'),
            frame: z.string().default('#6f4926'),
          })
          .default({ w: 1.9, h: 0.44, aboveUnit: 0.62, bg: '#3b3129', text: '#ffd166', frame: '#6f4926' }),
      })
      .default({
        shelvesPerLevel: 8,
        margin: 0.55,
        bayW: 2.2,
        frontTiers: 2,
        backTiers: 3,
        tierH: 0.5,
        shelfD: 0.45,
        plankT: 0.05,
        postW: 0.08,
        junkChance: 0.62,
        floorJunk: 3,
        wood: '#8a5a33',
        woodDark: '#6f4926',
        junk: ['#c9a66b', '#7d8493', '#9c6644', '#84a59d', '#e07a5f', '#b08968'],
        emptyLabel: '—',
        ownBg: '#ffd166',
        ownText: '#3b3129',
        plaqueW: 0.52,
        plaqueH: 0.18,
        partitionExtra: 0.22,
        partitionColor: '#6f4926',
        headerH: 0.15,
        blockDepthFactor: 1,
        corridorW: 1.2,
        wallT: 0.08,
        doorW: 0.82,
        doorH: 1.72,
        unitH: 2.16,
        doorColor: '#7a5230',
        ownDoorColor: '#ffd166',
        oddSide: 'left',
        blockDefId: 'trasteros_columna',
        cellRoomDepth: 2.8,
        cellShelfTiers: 3,
        cellJunk: 7,
        guide: { w: 1.9, h: 0.44, aboveUnit: 0.62, bg: '#3b3129', text: '#ffd166', frame: '#6f4926' },
      }),
    /** Tejadillo que cierra el edificio (v1.16): faldones a dos aguas sobre la bajocubierta.
     *  CONTRATO con la authoría glTF (scripts/gen-v16-assets.ts): mismos colores y misma
     *  geometría nominal (una sola verdad). */
    roof: z
      .object({
        pitchH: z.number().positive().default(1.2),
        overhang: z.number().min(0).default(0.35),
        color: z.string().default('#a44a3f'),
        ridge: z.string().default('#7d3b32'),
        fascia: z.string().default('#6f4926'),
      })
      .default({ pitchH: 1.2, overhang: 0.35, color: '#a44a3f', ridge: '#7d3b32', fascia: '#6f4926' }),
    /** Macetas en los pasillos (v1.16): reparto aleatorio DETERMINISTA por hash del id del
     *  pasillo (jamás nextRandom del sim): cantidad por planta y colores del catálogo. */
    pots: z
      .object({
        perFloorMin: z.number().int().min(0).default(2),
        perFloorMax: z.number().int().min(0).default(4),
        potColor: z.string().default('#b5651d'),
        soilColor: z.string().default('#5d4037'),
        plantColor: z.string().default('#5a9367'),
        plant2Color: z.string().default('#84a59d'),
        potR: z.number().positive().default(0.17),
        potH: z.number().positive().default(0.26),
      })
      .default({ perFloorMin: 2, perFloorMax: 4, potColor: '#b5651d', soilColor: '#5d4037', plantColor: '#5a9367', plant2Color: '#84a59d', potR: 0.17, potH: 0.26 }),
    /** Privacidad de viviendas (v1.17): si una vivienda NO tiene a nadie dentro, el corte
     *  se cierra con su fachada y una puerta al pasillo; el interior solo se ve cuando su
     *  propietario (o cualquier vecino… o un ladrón) está dentro. Colores y medidas de la
     *  puerta del catálogo; enabled=false vuelve al corte siempre abierto. */
    privacy: z
      .object({
        enabled: z.boolean().default(true),
        doorColor: z.string().default('#5d4a3a'),
        handleColor: z.string().default('#ffd166'),
        doorW: z.number().positive().default(0.95),
        doorH: z.number().positive().default(1.85),
      })
      .default({ enabled: true, doorColor: '#5d4a3a', handleColor: '#ffd166', doorW: 0.95, doorH: 1.85 }),
    /** Velocidad (m/s) a partir de la cual un actor en marcha usa el clip "run". */
    runSpeed: z.number().positive().default(4.2),
    /** Multiplicador de velocidad del jugador mientras corre (Shift / botón del mando). */
    runMultiplier: z.number().min(1).default(1.75),
    /** Anclas de actividad en las que el vecino se SIENTA (clip "sit") al llegar. */
    seatAnchors: z.array(z.string()).default(['bed', 'tv', 'desk']),
    roomZ: z.number(),
    depth: z.number(),
    /** Módulo de profundidad (v1.19): TODOS los bloques crecen 1 módulo hacia el fondo
     *  (viviendas depth+module; comunes commonDepth+module; naves y tejado igual). */
    depthModule: z.number().min(0).default(0),
    commonDepth: z.number().default(1.4),
    /** ── Apilamiento 3D de bloques (v1.19) ── bloques traseros INACTIVOS (interiores de
     *  trasteros, cuartos traseros de vivienda) que se activan al entrar: el bloque
     *  precedente se desvanece y el nuevo aparece con transparencia hasta visualizarse,
     *  identificado por un contorno ROJO grueso en todo el perímetro frontal. */
    rearBlock: z
      .object({
        outline: z.string().default('#e63946'),
        outlineWidth: z.number().positive().default(16),
        fadeSeconds: z.number().positive().default(0.45),
        peekSeconds: z.number().positive().default(0.5),
        peekDistance: z.number().positive().default(1.05),
        junk: z.number().int().min(0).default(6),
        lampColor: z.string().default('#ffedbe'),
        /** Ventana en la pared del FONDO del bloque trasero (v1.21): se ve el paisaje urbano
         *  del fondo (fachadas parallax y cielo) desde dentro del cuarto trasero/trastero. */
        window: z
          .object({
            w: z.number().positive().default(1.1),
            h: z.number().positive().default(1.0),
            sill: z.number().min(0).default(0.85),
            frame: z.string().default('#6f4926'),
            glass: z.string().default('#bcd8e8'),
            glassAlpha: z.number().min(0).max(1).default(0.18),
          })
          .default({ w: 1.1, h: 1.0, sill: 0.85, frame: '#6f4926', glass: '#bcd8e8', glassAlpha: 0.18 }),
      })
      .default({
        outline: '#e63946',
        outlineWidth: 16,
        fadeSeconds: 0.45,
        peekSeconds: 0.5,
        peekDistance: 1.05,
        junk: 6,
        lampColor: '#ffedbe',
        window: { w: 1.1, h: 1.0, sill: 0.85, frame: '#6f4926', glass: '#bcd8e8', glassAlpha: 0.18 },
      }),
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
    /** ── Escena exterior (v1.20) ── tiras de calle frente al edificio: aceras, carretera,
     *  jardines. defId refiere blocks.json (defs con `exterior`); x0/x1/z0/depth en metros
     *  de mundo (z negativo = hacia la calle). La presentación levanta cuerpo + props. */
    exterior: z
      .object({
        enabled: z.boolean().default(false),
        rows: z.array(
          z.object({
            defId: z.string(),
            x0: z.number(),
            x1: z.number(),
            z0: z.number(),
            depth: z.number().positive(),
            /** false = solo props sobre la tira previa (sin cuerpo propio). */
            body: z.boolean().default(true),
            /** Orientación (v1.22): 'x' = tira a lo largo de X (calle frente al edificio);
             *  'z' = tira a lo largo de Z (aceras laterales, calle transversal bifurcada). */
            orient: z.enum(['x', 'z']).default('x'),
            /** Dispersión 2D de la vegetación por todo el rect (con topes del bloque). */
            gridScatter: z.boolean().default(false),
            maxTrees: z.number().int().min(0).optional(),
            maxBushes: z.number().int().min(0).optional(),
          }),
        ),
        /** Suelo del mundo bajo todo el decorado (cierra el horizonte). backZ: hasta qué z
         *  llega por DETRÁS del edificio — más allá, cielo (el suelo no debe hacer de muralla
         *  entre el edificio y las capas de fachadas del fondo). */
        ground: z
          .object({ color: z.string().default('#a89a7c'), size: z.number().positive().default(220), backZ: z.number().default(0) })
          .default({ color: '#a89a7c', size: 220, backZ: 0 }),
      })
      .default({ enabled: false, rows: [], ground: { color: '#a89a7c', size: 220, backZ: 0 } }),
    /** ── Tráfico (v1.22) ── vehículos ocasionales por los carriles de la carretera:
     *  coches, furgonetas, autobús y patrulla con sirena. Solo presentación (nunca sim)
     *  y solo visibles en la vista "edificio". */
    traffic: z
      .object({
        enabled: z.boolean().default(false),
        lanes: z.array(
          z.object({
            z: z.number(),
            /** +1 = hacia +X; −1 = hacia −X. */
            dir: z.number().min(-1).max(1),
            speedMin: z.number().positive(),
            speedMax: z.number().positive(),
          }),
        ),
        spawnEveryMin: z.number().positive().default(8),
        spawnEveryMax: z.number().positive().default(24),
        maxAlive: z.number().int().min(1).default(4),
        xMin: z.number(),
        xMax: z.number(),
        /** Punto de "paso" para el sonido del motor al pasar frente al portal. */
        passX: z.number().default(13.1),
        passRadius: z.number().positive().default(22),
        vehicles: z.array(
          z.object({
            kind: z.string(),
            chance: z.number().min(0).max(1),
            length: z.number().positive(),
            width: z.number().positive(),
            height: z.number().positive(),
            /** Fracción trasera del cuerpo ocupada por la cabina (0.5 = coche, 0.1 = bus). */
            cabin: z.number().min(0).max(1).default(0.4),
            colors: z.array(z.string()).min(1),
            /** Patrulla: barra de luces roja/azul alternando. */
            siren: z.boolean().default(false),
          }),
        ),
      })
      .default({ enabled: false, lanes: [], spawnEveryMin: 8, spawnEveryMax: 24, maxAlive: 4, xMin: -60, xMax: 60, passX: 13.1, passRadius: 22, vehicles: [] }),
    /** ── Viandantes (v1.22) ── paseantes por las aceras; algunos entran al edificio
     *  (desaparecen en el portal) y otros salen. Solo presentación y solo vista edificio. */
    pedestrians: z
      .object({
        enabled: z.boolean().default(false),
        maxAlive: z.number().int().min(1).default(6),
        spawnEveryMin: z.number().positive().default(5),
        spawnEveryMax: z.number().positive().default(16),
        speedMin: z.number().positive().default(0.9),
        speedMax: z.number().positive().default(1.5),
        enterChance: z.number().min(0).max(1).default(0.25),
        exitChance: z.number().min(0).max(1).default(0.3),
        enterX: z.number().default(13.1),
        paths: z.array(
          z.object({
            z: z.number(),
            x0: z.number(),
            x1: z.number(),
            dir: z.number().min(-1).max(1),
          }),
        ),
        colors: z.array(z.string()).min(1),
        hatChance: z.number().min(0).max(1).default(0.3),
        hatColors: z.array(z.string()).default(['#3b3129']),
      })
      .default({ enabled: false, maxAlive: 6, spawnEveryMin: 5, spawnEveryMax: 16, speedMin: 0.9, speedMax: 1.5, enterChance: 0.25, exitChance: 0.3, enterX: 13.1, paths: [], colors: ['#5d6b7a'], hatChance: 0.3, hatColors: ['#3b3129'] }),
    /** ── Fondo urbano (v1.20) ── cielo dinámico (sol/luna/estrellas/nubes según la hora)
     *  + capas de fachadas 2D a distintas distancias (parallax natural: planos 3D reales
     *  tras el edificio). Luz global (ambiente + sol) evoluciona con los keyframes. */
    backdrop: z
      .object({
        enabled: z.boolean().default(false),
        layers: z.array(
          z.object({
            z: z.number().positive(),
            height: z.number().positive(),
            alpha: z.number().min(0).max(1).default(0.5),
            tint: z.string(),
            windowColor: z.string().default('#8a94a6'),
            windowLitColor: z.string().default('#ffd166'),
            galleryColor: z.string().default('#9fb8c8'),
            buildings: z.number().int().min(1).default(6),
            floors: z.tuple([z.number(), z.number()]).default([3, 6]),
            windowChance: z.number().min(0).max(1).default(0.75),
            galleryChance: z.number().min(0).max(1).default(0.3),
            nightGlow: z.number().min(0).max(1).default(0.35),
            /** Imagen de sello (v1.21): PNG RGBA de fachada en public/content/backdrop/.
             *  Presente → la capa se pinta REPITIENDO el sello (edificios reales, blur horneado
             *  por distancia). Ausente → el pintado procedural de ventanas/galerías de v1.20. */
            image: z.string().optional(),
            /** NIEBLA (v1.22): desatura la capa y la funde hacia fogColor — los bloques del
             *  fondo se intuyen (perspectiva aérea) sin robar atención al edificio. */
            fog: z.number().min(0).max(1).default(0),
            fogColor: z.string().default('#dfe4e6'),
          }),
        ),
        /** LLUVIA (v1.21): partículas de trazo que caen cuando el clima es rain/storm.
         *  Comportamiento realista con look cartoon: velocidades y viento del catálogo. */
        rain: z
          .object({
            count: z.number().int().min(0).default(900),
            stormCount: z.number().int().min(0).default(1600),
            fallSpeed: z.number().positive().default(26),
            wind: z.number().default(-3.5),
            color: z.string().default('#cfe3f2'),
            alpha: z.number().min(0).max(1).default(0.5),
            length: z.number().positive().default(0.55),
            width: z.number().positive().default(0.035),
          })
          .default({ count: 900, stormCount: 1600, fallSpeed: 26, wind: -3.5, color: '#cfe3f2', alpha: 0.5, length: 0.55, width: 0.035 }),
        sky: z
          .object({
            /** El gradiente del cielo se repinta a cadencia (barato) y por cambio de clima. */
            redrawSeconds: z.number().positive().default(6),
            /** Keyframes por hora (0..24): colores del cielo + intensidad de luces + sol. */
            keyframes: z.array(
              z.object({
                hour: z.number().min(0).max(24),
                top: z.string(),
                horizon: z.string(),
                ambient: z.number(),
                sun: z.number(),
              }),
            ),
            /** Atenuación del sol por clima (sunny pleno; tormenta apaga). */
            weatherDim: z
              .record(z.string(), z.number())
              .default({ sunny: 1, cloudy: 0.95, rain: 0.8, storm: 0.6 }),
            sunColorDay: z.string().default('#ffd166'),
            sunColorLow: z.string().default('#f08a4b'),
            sunSize: z.number().positive().default(2.4),
            sunArcHeight: z.number().positive().default(30),
            sunZ: z.number().positive().default(64),
            /** Altura (m) de la línea de horizonte del cielo de dos bandas. */
            horizonY: z.number().default(18),
            moonColor: z.string().default('#e8ecf4'),
            moonSize: z.number().positive().default(1.6),
            stars: z.number().int().min(0).default(110),
            starColor: z.string().default('#dfe7f2'),
          })
          .default({
            redrawSeconds: 6,
            keyframes: [],
            weatherDim: { sunny: 1, cloudy: 0.95, rain: 0.8, storm: 0.6 },
            sunColorDay: '#ffd166',
            sunColorLow: '#f08a4b',
            sunSize: 2.4,
            sunArcHeight: 30,
            sunZ: 64,
            horizonY: 18,
            moonColor: '#e8ecf4',
            moonSize: 1.6,
            stars: 110,
            starColor: '#dfe7f2',
          }),
        clouds: z
          .object({
            count: z.number().int().min(0).default(7),
            yMin: z.number().default(18),
            yMax: z.number().default(34),
            z: z.number().positive().default(58),
            speed: z.number().default(0.4),
            color: z.string().default('#f6f4ee'),
            stormColor: z.string().default('#9aa0a8'),
            alphaClear: z.number().min(0).max(1).default(0.14),
            alphaCloudy: z.number().min(0).max(1).default(0.7),
          })
          .default({
            count: 7,
            yMin: 18,
            yMax: 34,
            z: 58,
            speed: 0.4,
            color: '#f6f4ee',
            stormColor: '#9aa0a8',
            alphaClear: 0.14,
            alphaCloudy: 0.7,
          }),
      })
      .default({
        enabled: false,
        layers: [],
        rain: { count: 900, stormCount: 1600, fallSpeed: 26, wind: -3.5, color: '#cfe3f2', alpha: 0.5, length: 0.55, width: 0.035 },
        sky: {
          redrawSeconds: 6,
          keyframes: [],
          weatherDim: { sunny: 1, cloudy: 0.95, rain: 0.8, storm: 0.6 },
          sunColorDay: '#ffd166',
          sunColorLow: '#f08a4b',
          sunSize: 2.4,
          sunArcHeight: 30,
          sunZ: 64,
          horizonY: 18,
          moonColor: '#e8ecf4',
          moonSize: 1.6,
          stars: 110,
          starColor: '#dfe7f2',
        },
        clouds: {
          count: 7,
          yMin: 18,
          yMax: 34,
          z: 58,
          speed: 0.4,
          color: '#f6f4ee',
          stormColor: '#9aa0a8',
          alphaClear: 0.14,
          alphaCloudy: 0.7,
        },
      }),
    lod: z.object({
      enabled: z.boolean(),
      focus: z.literal('player'),
      levels: z.array(z.object({ dist: z.number(), hide: z.array(z.enum(['edges', 'glow', 'panels'])) })),
    }),
  }),
  demo: z.object({ resident: z.string(), block: z.string(), noise: z.number(), toast: z.string() }),
  cutscene: z.object({
    hold: z.number().positive(),
    line: z.number().positive(),
    walkMax: z.number().positive(),
    focusViewH: z.number().positive(),
    walkViewH: z.number().positive().default(6.4),
  }),
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
  touch: z.object({
    deadzone: z.number(),
    stick: z.object({ base: z.number(), thumb: z.number() }),
    labels: z.object({ interact: z.string(), camera: z.string(), move: z.string() }),
    hint: z.string(),
  }),
  labels: z.object({ weather: z.record(z.string(), z.string()), elevator: z.record(z.string(), z.string()).default({ ok: 'funciona' }) }),
  interact: z.object({
    exit: z.string(),
    doorEnter: z.string(),
    doorLocked: z.string(),
    greet: z.string(),
    laptop: z.string(),
    bed: z.string(),
    /** Trastero propio y bloques traseros (v1.19, apilamiento 3D). */
    storageEnter: z.string().default('E · abrir tu trastero'),
    storageLocked: z.string().default('Trastero ajeno · cada uno guarda lo suyo'),
    rearExit: z.string().default('E · salir'),
    rearRoom: z.string().default('Cuarto trasero'),
    stairs: z.string(),
    elevator: z.string(),
    elevatorBroken: z.string(),
    mailbox: z.object({ prompt: z.string(), lines: z.array(z.string()).min(1) }),
    noticeboard: z.object({ prompt: z.string(), template: z.string() }),
  }),
});

// ───────────────────────── Catálogo de sonido (procedural, Web Audio) ─────────────────────────

const soundStepSchema = z.object({
  wave: z.enum(['sine', 'square', 'triangle', 'sawtooth']).default('sine'),
  freq: z.number(),
  freqEnd: z.number().optional(),
  durMs: z.number(),
  gain: z.number(),
  attackMs: z.number().default(5),
  atMs: z.number().default(0),
});

export const soundsCatalogSchema = z.object({
  masterGain: z.number(),
  sounds: z.record(
    z.string(),
    z.discriminatedUnion('kind', [
      soundStepSchema.extend({ kind: z.literal('tone') }),
      z.object({ kind: z.literal('noise'), durMs: z.number(), gain: z.number(), filterHz: z.number().default(1200), atMs: z.number().default(0) }),
      z.object({
        kind: z.literal('seq'),
        /** v1.22: una secuencia puede MEZCLAR tonos y ráfagas de ruido (suspiros, motores). */
        steps: z.array(z.union([soundStepSchema, z.object({ kind: z.literal('noise'), durMs: z.number(), gain: z.number(), filterHz: z.number().default(1200), atMs: z.number().default(0) })])),
      }),
    ]),
  ),
  events: z.record(z.string(), z.array(z.string())),
  /** VOCES DE PROXIMIDAD (v1.22): al pasar al lado de un vecino se oye su voz — queja,
   *  lamento, risa, silbido, cuchicheo… bancos de sonidos del propio catálogo elegidos
   *  por su ánimo, con cadencia y antiedad de sobrecarga. Opcional: sin sección no hay voces. */
  voices: z
    .object({
      proximity: z.object({
        radius: z.number().positive(),
        checkEvery: z.number().positive(),
        chance: z.number().min(0).max(1),
        cooldownPerResident: z.number().min(0),
        maxPerMinute: z.number().int().min(1),
        minGain: z.number().min(0).max(1).default(0.3),
        gestureSeconds: z.number().positive().default(1.6),
        captionChance: z.number().min(0).max(1).default(0),
      }),
      banks: z.record(z.string(), z.array(z.string()).min(1)),
      /** Pies de foto opcionales por clave de sonido (bocadillo mínimo). */
      captions: z.record(z.string(), z.string()).default({}),
      moodMap: z.array(z.object({ mood: z.enum(['good', 'ok', 'bad']), banks: z.array(z.string()).min(1) })),
    })
    .optional(),
});

export type SoundsCatalog = z.infer<typeof soundsCatalogSchema>;

// ───────────────── La calle vive (v1.22): manifestaciones y comentarios ─────────────────

/**
 * Catálogo de la calle (public/content/street.json, opcional): manifestaciones con humor
 * vecinal — antidesahucios, reivindicaciones curiosas de trabajadores — y las reacciones
 * de los vecinos que las ven. Solo presentación: el sim jamás lee este catálogo.
 */
export const streetCatalogSchema = z.object({
  version: z.number().int().min(1),
  manifestation: z.object({
    enabled: z.boolean().default(true),
    everyMin: z.number().positive(),
    everyMax: z.number().positive(),
    /** Primera manifestación (s): retraso de gracia desde el arranque. */
    firstMin: z.number().min(0).default(20),
    firstMax: z.number().min(0).default(45),
    minDuration: z.number().positive(),
    maxDuration: z.number().positive(),
    minPeople: z.number().int().min(10),
    maxPeople: z.number().int().min(10),
    spacing: z.number().positive().default(0.75),
    speed: z.number().positive().default(0.55),
    lanes: z.array(z.object({ z: z.number(), x0: z.number(), x1: z.number() })).min(1),
    placard: z.object({
      w: z.number().positive(),
      h: z.number().positive(),
      stickH: z.number().positive(),
      liftY: z.number().positive().default(1.5),
      bg: z.string(),
      ink: z.string(),
      accent: z.string(),
      fontSizePx: z.number().positive(),
      carryEvery: z.number().int().min(1).default(2),
    }),
    megaphoneColor: z.string().default('#e0b54e'),
    chantEveryMin: z.number().positive().default(5),
    chantEveryMax: z.number().positive().default(11),
    commentDelayMin: z.number().min(0).default(4),
    commentDelayMax: z.number().positive().default(12),
    maxComments: z.number().int().min(1).default(3),
    colors: z.array(z.string()).min(1),
  }),
  topics: z
    .array(
      z.object({
        id: z.string(),
        /** Grito del portavoz (suena como voz de megáfono). */
        chant: z.string(),
        placards: z.array(z.string()).min(1),
      }),
    )
    .min(1),
  reactions: z.object({
    bad: z.array(z.string()).min(1),
    ok: z.array(z.string()).min(1),
    good: z.array(z.string()).min(1),
  }),
});

export type StreetCatalog = z.infer<typeof streetCatalogSchema>;

// ───────────────────────── Manifiesto de assets (arte final sustituible, opcional) ─────────────────────────

export const actorAssetSchema = z.object({
  model: z.string().min(1),
  nominalHeight: z.number().positive(),
  animations: z.record(z.string(), z.string()).optional(),
  defaultAnimation: z.string().optional(),
  walkAnimation: z.string().optional(),
  activityAnimations: z.record(z.string(), z.string()).optional(),
  /** Clips por ESTADO social (run/talk/laugh/argue/phone/sit): el runtime los usa para
   *  gestos del controlador y cutscenes; un estado sin clip cae al default con elegancia. */
  stateAnimations: z.record(z.string(), z.string()).optional(),
});

export const blockAssetSchema = z.object({
  model: z.string().min(1),
  nominal: z.object({ w: z.number().positive(), h: z.number().positive(), d: z.number().positive() }),
  tintStrength: z.number().min(0).max(1).optional(),
  /** Ancho visual en celdas (v1.4, cubo de escalera): escala a spanW·cellW−gapW y ancla al
   *  borde izquierdo de la celda lógica (la torre sobresale por la derecha del edificio). */
  spanW: z.number().int().min(1).optional(),
  /** Overlay: decora sin ocultar el greybox (marcos de puerta sobre el corte interior). */
  overlay: z.boolean().optional(),
  /** Clonar materiales por instancia (default true): tinte/glow por bloque sin contaminar hermanos. */
  cloneMaterials: z.boolean().optional(),
});

export const assetsCatalogSchema = z.object({
  base: z.string().min(1),
  actors: z.record(z.string(), actorAssetSchema).optional(),
  blocks: z.record(z.string(), blockAssetSchema).optional(),
});

export type AssetsCatalogParsed = z.infer<typeof assetsCatalogSchema>;

// ───────────────────────── Bocadillos de expresión (v1.10, opcional) ─────────────────────────

const emoteDefSchema = z.object({
  id: z.string().min(1),
  glyph: z.string().min(1),
  priority: z.number(),
  label: z.string().optional(),
});

export const emotesCatalogSchema = z.object({
  bubble: z.object({
    offsetY: z.number().min(0),
    sizePx: z.number().min(8),
    maxDistance: z.number().positive(),
    popMs: z.number().min(0),
    decisionMs: z.number().min(50),
    /** Vista EDIFICIO (v1.17): sin texto y con tope de glifos — el plano general no se
     *  convierte en una sopa de emoticonos. undefined = comportamiento de siempre. */
    buildingMaxGlyphs: z.number().int().min(0).optional(),
  }),
  // ── Bocadillos con TEXTO (v1.15): las actividades con líneas `say` del arquetipo se
  // dicen en un bocadillo legible sobre la cabeza (alternando con el glifo). Opcional:
  // sin sección, los bocadillos son solo glifos como en v1.10. Todo en JSON.
  speech: z
    .object({
      /** Segundos que se muestra cada línea. */
      lineSeconds: z.number().positive(),
      /** Segundos de silencio entre líneas (el glifo vuelve a lucir). */
      gapSeconds: z.number().min(0),
      /** Pausa larga (segundos) tras decir TODAS las líneas de la actividad antes de repetir. */
      cycleGap: z.number().min(0),
      /** Ancho máximo del bocadillo de texto (px CSS). */
      maxPx: z.number().positive(),
      fontSizePx: z.number().min(8),
    })
    .optional(),
  mood: z.object({
    needs: z.record(z.string(), z.number()),
  }),
  moods: z.array(emoteDefSchema.extend({ min: z.number().optional(), max: z.number().optional() })),
  activities: z.array(emoteDefSchema),
  gestures: z.array(emoteDefSchema),
  events: z.array(
    z.object({
      on: z.string().min(1),
      glyph: z.string().min(1),
      priority: z.number(),
      who: z.enum(['resident', 'player', 'blockResidents']),
      seconds: z.number().positive(),
      altGlyph: z.object({ when: z.string().min(1), glyph: z.string().min(1) }).optional(),
      cooldown: z.number().min(0).optional(),
    }),
  ),
});

export type EmotesCatalogParsed = z.infer<typeof emotesCatalogSchema>;

// ───────────────────────── Ecosistema del edificio (v1.14) ─────────────────────────

const weatherState = z.enum(['sunny', 'cloudy', 'rain', 'storm']);

export const ecoWhenSchema: z.ZodType<EcosystemWhen> = z.union([
  z.object({ weather: z.union([weatherState, z.array(weatherState)]), not: z.boolean().optional() }),
  z.object({ paramAbove: z.object({ block: z.string().min(1), param: z.string().min(1), value: z.number() }) }),
  z.object({ paramBelow: z.object({ block: z.string().min(1), param: z.string().min(1), value: z.number() }) }),
  z.object({ fundsAbove: z.number() }),
  z.object({ fundsBelow: z.number() }),
  z.object({ moodAbove: z.number() }),
  z.object({ moodBelow: z.number() }),
  z.object({ residentPresent: z.string().min(1) }),
  z.object({ missionState: z.object({ mission: z.string().min(1), state: z.enum(['none', 'active', 'awaiting_choice', 'done', 'failed']) }) }),
]);

export const ecoOutcomeSchema: z.ZodType<EcosystemOutcome> = z.object({
  id: z.string().min(1),
  weight: z.number().positive(),
  when: z.array(ecoWhenSchema).optional(),
  effects,
  toast: z.string().min(1).optional(),
});

export const ecoEventSchema: z.ZodType<EcosystemEvent> = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['vendor', 'prank', 'pet', 'blackout', 'drift']),
    weight: z.number().positive(),
    cooldownTicks: z.number().int().min(0),
    window: z.object({ from: z.string().min(1), to: z.string().min(1) }).optional(),
    chance: z.number().min(0).max(1).optional(),
    when: z.array(ecoWhenSchema).optional(),
    vendor: z
      .object({
        archetype: z.string().min(1),
        doors: z.number().int().min(1),
        perKnockOutcomes: z.array(ecoOutcomeSchema).min(1),
      })
      .optional(),
    pet: z.object({ mission: z.string().min(1) }).optional(),
    blackout: z
      .object({
        durationMinutes: z.object({ min: z.number().positive(), max: z.number().positive() }),
        corridorBlock: z.string().min(1),
        lightingParam: z.string().min(1),
        restoreTo: z.number(),
        restoreToast: z.string().min(1),
      })
      .optional(),
    outcomes: z.array(ecoOutcomeSchema).optional(),
  })
  .superRefine((ev, ctx) => {
    if (ev.kind === 'vendor' && !ev.vendor) ctx.addIssue({ code: 'custom', message: 'un evento vendor necesita su bloque vendor' });
    if (ev.kind === 'pet' && !ev.pet) ctx.addIssue({ code: 'custom', message: 'un evento pet necesita su bloque pet (misión)' });
    if (ev.kind === 'blackout' && !ev.blackout) ctx.addIssue({ code: 'custom', message: 'un evento blackout necesita su bloque blackout' });
    if ((ev.kind === 'prank' || ev.kind === 'drift' || ev.kind === 'blackout') && (!ev.outcomes || ev.outcomes.length === 0))
      ctx.addIssue({ code: 'custom', message: `un evento ${ev.kind} necesita outcomes ponderados` });
  });

export const ecosystemContentSchema = z.object({
  schemaVersion: z.literal(1),
  scheduler: z.object({ evalEveryTicks: z.number().int().min(1) }),
  extras: z.object({
    walkSpeed: z.number().positive(),
    vendor: z.object({ knockPauseSec: z.number().positive(), floors: z.array(z.number().int().min(0)) }),
    pet: z.object({
      walkSpeed: z.number().positive(),
      strollSeconds: z.number().positive(),
      pauseSeconds: z.number().min(0),
      stainFadeSec: z.number().positive(),
      stainW: z.number().positive(),
      stainH: z.number().positive(),
      stainOpacity: z.number().min(0).max(1),
      color: z.string().min(1),
      bodyW: z.number().positive(),
      bodyH: z.number().positive(),
      headScale: z.number().positive(),
    }),
  }),
  lights: z.object({
    color: z.string().min(1),
    nightIntensity: z.number().min(0),
    blackoutOccupiedIntensity: z.number().min(0),
    dayIntensity: z.number().min(0),
    paramThreshold: z.number().min(0).max(100),
    lampsPerCorridor: z.number().int().min(1),
    lampSize: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
    /** v1.21: de noche las luces de pasillo SOLO si la instalación funciona Y hay algún
     *  vecino en ese pasillo (nadie pasea a oscuras por gusto). */
    nightRequiresPresence: z.boolean().default(false),
  }),
  mood: z.object({ needs: z.record(z.string(), z.number()) }),
  visuals: z.object({
    checkSeconds: z.number().positive(),
    deterioration: z.array(
      z.object({
        id: z.string().min(1),
        blockDef: z.string().min(1),
        param: z.string().min(1),
        below: z.number().optional(),
        above: z.number().optional(),
        kind: z.enum(['cracks', 'dirt', 'damp', 'soot']),
        color: z.string().min(1),
        opacity: z.number().min(0).max(1),
        count: z.number().int().min(1),
        w: z.number().positive(),
        h: z.number().positive(),
      }),
    ),
  }),
  events: z.array(ecoEventSchema),
});

export type EcosystemContentParsed = z.infer<typeof ecosystemContentSchema>;

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
export const cutsceneListSchema = z.array(cutsceneDefSchema);
export const templateListSchema = z.array(templateDefSchema);
export const scenarioListSchema = z.array(scenarioDefSchema);

// ───────────────────────── Logros tipo Steam (v1.17, opcional) ─────────────────────────

// Catálogo puro de logros (public/content/achievements.json): nombres/descripciones ES/EN y
// una condición discriminada por `kind`. El evaluador (src/game/support/achievements.ts) es
// una función pura sobre un snapshot del mundo; aquí solo declaramos la forma del JSON.

/** Texto localizable del chrome de logros: el par de idiomas que viaja en el JSON. */
const localizedTextSchema = z.object({ es: z.string().min(1), en: z.string().min(1) });

export const achievementConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mission_done'), mission: z.string().min(1) }),
  z.object({ kind: z.literal('missions_done'), count: z.number().int().min(1) }),
  z.object({ kind: z.literal('wallet'), amount: z.number().min(0) }),
  z.object({ kind: z.literal('funds'), amount: z.number().min(0) }),
  z.object({ kind: z.literal('reputation'), amount: z.number() }),
  z.object({ kind: z.literal('day'), count: z.number().int().min(1) }),
  z.object({ kind: z.literal('relation'), affinity: z.number().min(0).max(100) }),
  z.object({ kind: z.literal('elevator_ok') }),
]);

export const achievementDefSchema = z.object({
  id: z.string().min(1),
  icon: z.string().min(1),
  name: localizedTextSchema,
  desc: localizedTextSchema,
  /** Oculto: bloqueado se muestra como "???" (como en Steam), desbloqueado se revela. */
  hidden: z.boolean().optional(),
  condition: achievementConditionSchema,
});

export const achievementsCatalogSchema = z.object({
  version: z.literal(1),
  achievements: z.array(achievementDefSchema).min(1),
});

export type AchievementConditionParsed = z.infer<typeof achievementConditionSchema>;
export type AchievementDefParsed = z.infer<typeof achievementDefSchema>;
export type AchievementsCatalogParsed = z.infer<typeof achievementsCatalogSchema>;

// ───────────────────────── Charlas de cruce (v1.20, opcional) ─────────────────────────

// Cuando dos vecinos se cruzan, PUEDE que se paren a charlar (o no): lo decide su ánimo.
// Todo vive en public/content/crossings.json; la presentación (chats.ts) solo ejecuta.
// Las líneas alternan A/B y admiten {a}/{b} = nombres visibles de los dos vecinos.

export const crossingsCatalogSchema = z.object({
  cadence: z
    .object({
      /** Segundos entre rastreos de cruces. */
      checkEvery: z.number().positive().default(2.2),
      /** Segundos que un vecino no repite charla; lo mismo por PAREJA. */
      residentCooldown: z.number().min(0).default(50),
      pairCooldown: z.number().min(0).default(160),
      /** Duración de cada línea del bocadillo y pausa tras la charla. */
      lineSeconds: z.number().positive().default(3),
      holdAfter: z.number().min(0).default(1.2),
    })
    .default({ checkEvery: 2.2, residentCooldown: 50, pairCooldown: 160, lineSeconds: 3, holdAfter: 1.2 }),
  proximity: z
    .object({
      /** Distancia (m) a la que dos vecinos "se cruzan". */
      distance: z.number().positive().default(1.6),
      /** Charlas simultáneas máximas (anti-sobrecarga de bocadillos). */
      maxConcurrent: z.number().int().min(1).default(2),
    })
    .default({ distance: 1.6, maxConcurrent: 2 }),
  chance: z
    .object({
      base: z.number().min(0).max(1).default(0.6),
      /** Buen ánimo suma opción de charla; mal ánimo resta (y saca los gruñidos). */
      goodMoodBonus: z.number().min(0).default(0.3),
      badMoodPenalty: z.number().min(0).default(0.45),
    })
    .default({ base: 0.6, goodMoodBonus: 0.3, badMoodPenalty: 0.45 }),
  mood: z
    .object({
      /** Umbrales del ánimo medio (0..100): ≥ goodMin → 'good'; ≥ okMin → 'ok'; si no 'bad'. */
      goodMin: z.number().default(55),
      okMin: z.number().default(30),
      /** Necesidades que promedian el ánimo y su peso (espejo de emotes.mood.needs). */
      needs: z.record(z.string(), z.number()).default({ sleep: 1, social: 1, fun: 1 }),
    })
    .default({ goodMin: 55, okMin: 30, needs: { sleep: 1, social: 1, fun: 1 } }),
  /** Grupos de temas por cubo de ánimo: al cruzarse se elige el grupo del ánimo medio. */
  groups: z.array(
    z.object({
      id: z.string(),
      mood: z.enum(['good', 'ok', 'bad']),
      topics: z.array(z.object({ id: z.string(), lines: z.array(z.string()).min(1) })),
    }),
  ),
});

export type CrossingsCatalogParsed = z.infer<typeof crossingsCatalogSchema>;


// ───────────────────────── Dioramas interiores (v1.23) ─────────────────────────

/** Capa de billboard de mobiliario: un sprite con paralaje dentro de la estancia.
 *  u/v son fracciones del rect de la estancia (0..1); w/h en METROS reales. */
export const interiorSpriteSchema = z.object({
  art: z.string().min(1),
  w: z.number().positive(),
  h: z.number().positive(),
  u: z.number().min(0).max(1),
  v: z.number().min(0).max(1),
  layer: z.enum(['back', 'mid', 'front', 'rug']).default('mid'),
  /** Elevación del pie del sprite sobre el suelo (m): cosas de pared o colgadas. */
  y: z.number().min(0).default(0),
});

/** Diorama de un tipo de estancia: pared del fondo + suelo + capas de mobiliario. */
export const interiorDioramaSchema = z.object({
  wall: z.string().min(1),
  floor: z.string().min(1),
  sprites: z.array(interiorSpriteSchema).default([]),
});

/** Catálogo de interiores (OPCIONAL): sin el fichero, los interiores siguen greybox. */
export const interiorsCatalogSchema = z.object({
  artBase: z.string().default('/art/interiors/raw/'),
  keyColor: z.string().default('#ffffff'),
  keyTolerance: z.number().min(0).max(1).default(0.09),
  processSize: z.number().int().min(64).max(2048).default(512),
  alphaCutoff: z.number().min(0).max(1).default(0.45),
  doorDecal: z.object({ art: z.string().min(1), w: z.number().positive(), h: z.number().positive() }),
  rooms: z.record(z.string(), interiorDioramaSchema),
});

export type InteriorsCatalog = z.infer<typeof interiorsCatalogSchema>;
