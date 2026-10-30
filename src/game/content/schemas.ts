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
    /** v1.40 — LINTERNA del vecino: luz real (PointLight) que llevas encima cuando se va
     *  la luz (apagón del ecosistema). Radio corto y planta única: es una linterna, no un
     *  estadio. undefined = sin linterna (comportamiento de siempre). */
    flashlight: z
      .object({
        range: z.number().positive().default(4),
        intensity: z.number().positive().default(1.1),
        height: z.number().positive().default(1.25),
        color: z.string().default('#ffdca8'),
      })
      .optional(),
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
        /** v1.30 — el color del muro del cubo SIEMPRE del catálogo (el vecino pidió todas
         *  las paredes del pasillo del mismo gris; el valor vive en view.locals.corridorWall
         *  y aquí viaja como default del arte). */
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
        /** v1.24 — acceso a la escalera: muro frontal + hoja numerada con apertura automática. */
        facade: z
          .object({
            enabled: z.boolean().default(true),
            halfW: z.number().positive().default(1.2),
            /** v1.26: muro frontal del CUBO COMPLETO (sin laterales abiertos por donde se
             *  veían barandillas y peldaños "a través de la pared"). */
            fullWall: z.boolean().default(true),
            color: z.string().default('#ddd1b8'),
            doorW: z.number().positive().default(0.86),
            doorH: z.number().positive().default(1.84),
            doorBottom: z.number().min(0).default(0.14),
            doorZ: z.number().default(0.08),
            wallT: z.number().positive().default(0.3),
            art: z.string().default('/art/interiors/raw/door_comunal.png'),
            numberColor: z.string().default('#1c1c1c'),
            hinge: z.enum(['left', 'right']).default('left'),
            openAngle: z.number().positive().default(1.75),
            openAhead: z.number().positive().default(1.05),
            openSpeed: z.number().positive().default(3.2),
            /** v1.27 — VENTANAL del cubo de escalera: el muro frontal se abre en BANDA de
             *  cristal (de diafra a cabezal) para ver subir y bajar a los vecinos y la luz
             *  del poche. sill/head acotan la banda (altura desde el suelo del bloque);
             *  el vidrio se parte alrededor de la hoja de la puerta. mullions = montantes
             *  verticales finos DELANTE del vidrio (nada coplanar). rear cierra el fondo. */
            window: z
              .object({
                enabled: z.boolean().default(true),
                sill: z.number().min(0).default(0.5),
                head: z.number().positive().default(2.3),
                color: z.string().default('#cfe3ea'),
                alpha: z.number().min(0.05).max(0.9).default(0.24),
                mullions: z.number().min(0).default(5),
                mullionW: z.number().positive().default(0.045),
                frameColor: z.string().default('#7d7668'),
                rear: z.boolean().default(true),
              })
              .default({
                enabled: true,
                sill: 0.5,
                head: 2.3,
                color: '#cfe3ea',
                alpha: 0.24,
                mullions: 5,
                mullionW: 0.045,
                frameColor: '#7d7668',
                rear: true,
              }),
            /** v1.25: nodos de la authoría glTF del cubo que sobran (el hueco oscuro viejo
             *  flotaba a la derecha de los tramos). Ocultos al cargar el modelo. */
            hideNodes: z.array(z.string()).default([]),
          })
          .default({
            enabled: true,
            halfW: 1.2,
            fullWall: true,
            color: '#ddd1b8',
            doorW: 0.86,
            doorH: 1.84,
            doorBottom: 0.14,
            doorZ: 0.08,
            wallT: 0.3,
            art: '/art/interiors/raw/door_comunal.png',
            numberColor: '#1c1c1c',
            hinge: 'left',
            openAngle: 1.75,
            openAhead: 1.05,
            openSpeed: 3.2,
            window: { enabled: true, sill: 0.5, head: 2.3, color: '#cfe3ea', alpha: 0.24, mullions: 5, mullionW: 0.045, frameColor: '#7d7668', rear: true },
            hideNodes: [],
          }),
        activityLight: z
          .object({
            enabled: z.boolean().default(true),
            dayCutoff: z.number().min(0).max(1).default(0.4),
            glow: z.number().min(0).default(0.9),
            fade: z.number().positive().default(2.4),
            meshes: z.array(z.string()).default(['luz_interior', 'tira_luz']),
            color: z.string().default('#ffedc2'),
            /** v1.25: AUTOILUMINACIÓN del cubo — con alguien en las escaleras de noche, los
             *  materiales del PROPIO bloque (muros, forjados, tramos) se iluminan también,
             *  como los interiores de las viviendas (antes solo brillaba la bombilla). */
            wallGlow: z.number().min(0).default(0.32),
          })
          .default({
            enabled: true,
            dayCutoff: 0.4,
            glow: 0.9,
            fade: 2.4,
            meshes: ['luz_interior', 'tira_luz'],
            color: '#ffedc2',
            wallGlow: 0.32,
          })
      })
      .default({
        spanW: 2, doorLocalX: -1.14, entryHalf: 0.45, laneFront: 0.35, laneBack: 1.05, flightRun: 2.19, landingX: 0.5, stepCount: 8, climbSpeed: 1.8,
        floorSlab: { enabled: true, thickness: 0.14, color: '#b8c0a8', topAt: 0.14 },
        facade: {
          enabled: true, halfW: 1.2, fullWall: true, color: '#ddd1b8', doorW: 0.86, doorH: 1.84, doorBottom: 0.14, doorZ: 0.08, wallT: 0.3,
          art: '/art/interiors/raw/door_comunal.png', numberColor: '#1c1c1c', hinge: 'left', openAngle: 1.75, openAhead: 1.05, openSpeed: 3.2,
          window: { enabled: true, sill: 0.5, head: 2.3, color: '#cfe3ea', alpha: 0.24, mullions: 5, mullionW: 0.045, frameColor: '#7d7668', rear: true },
          hideNodes: [],
        },
        activityLight: { enabled: true, dayCutoff: 0.4, glow: 0.9, fade: 2.4, meshes: ['luz_interior', 'tira_luz'], color: '#ffedc2', wallGlow: 0.32 },
      }),
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
        /** v1.25: arte full-bleed de las hojas del ascensor (izquierda/derecha se recortan
         *  de la MISMA pieza: la partida central del arte cae entre ambas). */
        doorArt: z.string().default(''),
        callColor: z.string().default('#ffd166'),
        brokenColor: z.string().default('#c1666b'),
        rideZ: z.number().default(0.35),
        /** v1.29 — PARES DEL POZO: gris oscuro tipo zócalo (fijado sobre el arte glTF del
         *  núcleo, igual que la pared fija de las viviendas) y nodos del glTF que deben
         *  desaparecer (el panel oscuro del hueco tapaba la cabina al abrirse las puertas). */
        wallColor: z.string().default('#a3a19b'),
        hideNodes: z.array(z.string()).default([]),
        /** v1.29 — INTERIOR DE LA CABINA: las caras interiores son las de un ascensor de
         *  verdad (paneles metálicos, suelo antideslizante, plafón luminoso, pasamanos y
         *  luz propia que se derrama por el pozo al abrirse las puertas). Texturas generadas
         *  a canvas con estos parámetros — nada a pelo en el código. */
        interior: z
          .object({
            panelColor: z.string().default('#cfd6dc'),
            panelSeam: z.string().default('#8f979f'),
            panelTrim: z.string().default('#a9b2ba'),
            floorColor: z.string().default('#5c636b'),
            floorSeam: z.string().default('#474d55'),
            ceilingColor: z.string().default('#e8e6e0'),
            lightColor: z.string().default('#fff3d6'),
            lightEmissive: z.number().min(0).max(2).default(0.9),
            handrail: z.boolean().default(true),
            handrailColor: z.string().default('#8d939c'),
            lightRange: z.number().positive().default(3.2),
            lightIntensity: z.number().min(0).max(2).default(0.55),
          })
          .default({
            panelColor: '#cfd6dc',
            panelSeam: '#8f979f',
            panelTrim: '#a9b2ba',
            floorColor: '#5c636b',
            floorSeam: '#474d55',
            ceilingColor: '#e8e6e0',
            lightColor: '#fff3d6',
            lightEmissive: 0.9,
            handrail: true,
            handrailColor: '#8d939c',
            lightRange: 3.2,
            lightIntensity: 0.55,
          }),
        /** v1.28 — pantallita junto a las puertas: planta de la cabina + flecha de marcha.
         *  dx negativo = al otro lado del botón de llamada; y = altura sobre el forjado. */
        indicator: z
          .object({
            w: z.number().positive().default(0.24),
            h: z.number().positive().default(0.18),
            dx: z.number().default(-0.76),
            y: z.number().default(1.12),
          })
          .default({ w: 0.24, h: 0.18, dx: -0.76, y: 1.12 }),
      })
      .default({
        capacity: 4,
        doorWaitMs: 5000,
        doorMoveMs: 700,
        floorsPerSecond: 1.4,
        accelFloorsPerSecond2: 1.2,
        cabinColor: '#aeb8c2',
        doorColor: '#cbd5e1',
        doorArt: '',
        callColor: '#ffd166',
        brokenColor: '#c1666b',
        rideZ: 0.35,
        wallColor: '#a3a19b',
        hideNodes: [],
        interior: {
          panelColor: '#cfd6dc',
          panelSeam: '#8f979f',
          panelTrim: '#a9b2ba',
          floorColor: '#5c636b',
          floorSeam: '#474d55',
          ceilingColor: '#e8e6e0',
          lightColor: '#fff3d6',
          lightEmissive: 0.9,
          handrail: true,
          handrailColor: '#8d939c',
          lightRange: 3.2,
          lightIntensity: 0.55,
        },
        indicator: { w: 0.24, h: 0.18, dx: -0.76, y: 1.12 },
      }),
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
        /** v1.25: arte de maceta como RECORTE billboard (con fondo se usan cilindros). */
        art: z.array(z.string()).default([]),
        artH: z.number().positive().default(0.62),
        /** v1.26: radio libre delante de cada puerta — jamás una maceta tapando un acceso. */
        doorClearance: z.number().min(0).default(0.95),
      })
      .default({ perFloorMin: 2, perFloorMax: 4, potColor: '#b5651d', soilColor: '#5d4037', plantColor: '#5a9367', plant2Color: '#84a59d', potR: 0.17, potH: 0.26, art: [], artH: 0.62, doorClearance: 0.95 }),
    /** Privacidad de viviendas (v1.17): si una vivienda NO tiene a nadie dentro, el corte
     *  se cierra con su fachada y una puerta al pasillo; el interior solo se ve cuando su
     *  propietario (o cualquier vecino… o un ladrón) está dentro. Colores y medidas de la
     *  puerta del catálogo; enabled=false vuelve al corte siempre abierto.
     *  v1.25: pared gris clarito + zócalo de 25 cm + marcos DEL COLOR del zócalo, candado
     *  dibujado (nada de cajas) y luces nocturnas de interiores parametrizadas. */
    privacy: z
      .object({
        enabled: z.boolean().default(true),
        doorColor: z.string().default('#5d4a3a'),
        handleColor: z.string().default('#ffd166'),
        doorW: z.number().positive().default(0.95),
        doorH: z.number().positive().default(1.85),
        /** v1.24: arte full-bleed de la hoja (variantes por hash), marco fino, nodos del
         *  overlay glTF que se retiran y aplique de luz a un lado.
         *  v1.25: una sola variante → todas las puertas iguales (marrón). */
        doorArts: z.array(z.string()).default([]),
        frameW: z.number().min(0).default(0.075),
        frameDepth: z.number().positive().default(0.1),
        hideNodes: z.array(z.string()).default([]),
        /** v1.26 — relleno de las JUNTAS entre bloques (veían la parte trasera del edificio)
         *  y corte del zócalo en las puertas + tapa de estancia cerrada CON ARTE DE PUERTA
         *  (dejó de leerse como tabique). v1.27 — el relleno SALE hacia la calle (protrude,
         *  medido desde la cara de fachada) con un escalonado determinista por bloque
         *  (stagger): jamás dos caras coplanares — foco de parpadeos. */
        gapFill: z
          .object({
            color: z.string().default('#dbd8d2'),
            pad: z.number().min(0).default(0.04),
            /** v1.35 — puede ser NEGATIVO: el relleno se RETRANQUEA tras la cara frontal de
             *  la fachada (nunca casi-coplano con las soleras, que sobresalen por delante). */
            protrude: z.number().min(-0.25).default(0.012),
            stagger: z.number().min(0).default(0.008),
          })
          .default({ color: '#dbd8d2', pad: 0.04, protrude: 0.012, stagger: 0.008 }),
        /** v1.27 — SOLERA de los bloques: banda en la base de cada bloque (viviendas y resto
         *  de la banda principal) que sella la JUNTA VERTICAL entre un bloque y el siguiente
         *  en altura. protrude/stagger con la misma regla anti-coplanaridad que gapFill. */
        solera: z
          .object({
            color: z.string().default('#c9c6bf'),
            h: z.number().positive().default(0.13),
            protrude: z.number().min(0).default(0.016),
            stagger: z.number().min(0).default(0.008),
          })
          .default({ color: '#c9c6bf', h: 0.13, protrude: 0.016, stagger: 0.008 }),
        skirtingDoorGap: z.boolean().default(true),
        coverArt: z.string().default(''),
        /** v1.25 — acabado de la vivienda: pared gris clarito, banda de zócalo gris desde
         *  el suelo y MARCOS de puerta del mismo color que el zócalo (continuidad). */
        wallColor: z.string().default('#dbd8d2'),
        skirtingColor: z.string().default('#a3a19b'),
        skirtingH: z.number().positive().default(0.25),
        /** v1.25 — candado dibujado (silueta real de candado, nada de cajas). */
        lockArt: z.string().default(''),
        lockW: z.number().positive().default(0.24),
        lockH: z.number().positive().default(0.3),
        /** v1.28 — candado SOBRE la puerta, a la altura del tirador y ligeramente separado
         *  de la hoja (dx del centro en fracción del ancho, yFrac de la hoja, out en metros). */
        lockOnDoor: z
          .object({
            dx: z.number().default(0.22),
            yFrac: z.number().min(0).max(1).default(0.52),
            out: z.number().min(0).default(0.05),
          })
          .default({ dx: 0.22, yFrac: 0.52, out: 0.05 }),
        /** v1.25 — luces nocturnas de interiores: cuánto brilla una estancia habitada
         *  de noche (emissive del diorama, suelos y lámparas). dayCutoff corta el día. */
        night: z
          .object({
            dayCutoff: z.number().min(0).max(1).default(0.4),
            dioGlow: z.number().min(0).default(0.85),
            floorGlow: z.number().min(0).default(0.7),
            lampGlow: z.number().min(0).default(1.6),
            /** v1.29 — autoiluminación sutil de los muros estructurales de la vivienda
             *  (las caras sin luz — fondos altos, forjados — se leían como bandas negras). */
            wallSelf: z.number().min(0).max(1).default(0.3),
          })
          .default({ dayCutoff: 0.4, dioGlow: 0.85, floorGlow: 0.7, lampGlow: 1.6, wallSelf: 0.3 }),
        lamp: z
          .object({
            side: z.union([z.literal(-1), z.literal(1)]).default(1),
            dx: z.number().default(0.68),
            dy: z.number().default(2.1),
            color: z.string().default('#3b3129'),
            glowColor: z.string().default('#ffd166'),
          })
          .default({ side: 1, dx: 0.68, dy: 2.1, color: '#3b3129', glowColor: '#ffd166' }),
      })
      .default({
        enabled: true,
        doorColor: '#5d4a3a',
        handleColor: '#ffd166',
        doorW: 0.95,
        doorH: 1.85,
        doorArts: [],
        frameW: 0.075,
        frameDepth: 0.1,
        hideNodes: [],
        gapFill: { color: '#dbd8d2', pad: 0.04, protrude: 0.012, stagger: 0.008 },
        solera: { color: '#c9c6bf', h: 0.13, protrude: 0.016, stagger: 0.008 },
        skirtingDoorGap: true,
        coverArt: '',
        wallColor: '#dbd8d2',
        skirtingColor: '#a3a19b',
        skirtingH: 0.25,
        lockArt: '',
        lockW: 0.24,
        lockH: 0.3,
        lockOnDoor: { dx: 0.22, yFrac: 0.52, out: 0.05 },
        night: { dayCutoff: 0.4, dioGlow: 0.85, floorGlow: 0.7, lampGlow: 1.6, wallSelf: 0.3 },
        lamp: { side: 1, dx: 0.68, dy: 2.1, color: '#3b3129', glowColor: '#ffd166' },
      }),
    /** Velocidad (m/s) a partir de la cual un actor en marcha usa el clip "run". */
    runSpeed: z.number().positive().default(4.2),
    /** Multiplicador de velocidad del jugador mientras corre (Shift / botón del mando). */
    runMultiplier: z.number().min(1).default(1.75),
    /** Anclas de actividad en las que el vecino se SIENTA (clip "sit") al llegar. */
    seatAnchors: z.array(z.string()).default(['bed', 'tv', 'desk']),
    roomZ: z.number(),
    depth: z.number(),
    /** v1.28 — suelo de los pasillos: losetas cuadradas gris clarito (tile = lado en metros).
     *  v1.30 — contrast: alternancia entre baldosas vecinas (0 = uniforme; el vecino no
     *  distinguía las losetas: «sigue pareciendo un color uniforme»). */
    corridorFloor: z
      .object({
        color: z.string().default('#d8d7d2'),
        grout: z.string().default('#b6b4ac'),
        tile: z.number().positive().default(0.4),
        contrast: z.number().min(0).max(0.35).default(0.1),
        /** v1.35 — junta más gruesa y moteado terrazo por baldosa (se DEBE notar). */
        groutW: z.number().int().min(2).max(24).default(5),
        speckle: z.number().min(0).max(0.6).default(0.12),
      })
      .default({ color: '#d8d7d2', grout: '#b6b4ac', tile: 0.4, contrast: 0.1, groutW: 5, speckle: 0.12 }),
    /** ── LOCALES de la planta baja (v1.30) ── portal acristalado con puertas correderas,
     *  garaje definido, trastero comunitario, sala de juntas de la comunidad y lavandería
     *  abierta. TODO del catálogo: colores, medidas, rótulos y asientos — la sustitución
     *  del arte no toca código. */
    locals: z
      .object({
        /** v1.30 — gris ÚNICO de las paredes que dan al pasillo (el vecino: «deben tener
         *  todas un color uniforme… por ejemplo las del bloque ascensor»). Lo visten los
         *  cubos de escalera, el pozo del ascensor y los frentes nuevos de los locales. */
        corridorWall: z.string().default('#dbd8d2'),
        /** Nodos glTF que sobran por tipo de local (la fachada la levanta el runtime). */
        hideNodes: z.record(z.string(), z.array(z.string())).default({}),
        /** v1.30 — puertas correderas ACRISTALADAS del portal (se separan al acercarse y
         *  se cierran al separarse; por ellas entran y salen vecinos Y visitantes). Las
         *  hojas son los nodos cristal_izq/cristal_der del arte glTF del portal. */
        portalDoors: z
          .object({
            slide: z.number().min(0).default(0.96),
            openAhead: z.number().positive().default(1.7),
            openSeconds: z.number().positive().default(0.8),
            frame: z.string().default('#8fa3ad'),
            glass: z.string().default('#cfe3ea'),
            sheen: z.string().default('#ffffff'),
            handle: z.string().default('#5d6b7a'),
            alpha: z.number().min(0.15).max(1).default(0.72),
            /** v1.45 — APERTURA POR INTENCIÓN: las correderas solo se abren cuando el
             *  jugador INTENTA atravesarlas (empuja hacia ellas desde la calle o hacia la
             *  calle desde el vestíbulo — sin tecla E) o cuando un mover está EN el umbral
             *  (franja NPC estrecha). false = comportamiento clásico de franja ancha. */
            intentOpen: z.boolean().optional(),
            /** v1.45 — franja NPC (vecinos/peatones): profundidad y semiancho X del umbral. */
            npcOpenAhead: z.number().positive().optional(),
            npcXRadius: z.number().positive().optional(),
          })
          .default({ slide: 0.96, openAhead: 1.7, openSeconds: 0.8, frame: '#8fa3ad', glass: '#cfe3ea', sheen: '#ffffff', handle: '#5d6b7a', alpha: 0.72 }),
        /** v1.30 — acceso al GARAJE: puerta basculante texturizada, rampa y rótulo legible.
         *  v1.34 — el garaje es HABITABLE: mobiliario del interior 100% del catálogo. */
        garaje: z
          .object({
            panel: z.string().default('#c9ced6'),
            panelShade: z.string().default('#9aa2ad'),
            rail: z.string().default('#6d747d'),
            window: z.string().default('#dfe9ee'),
            sign: z.string().default('GARAJES'),
            signBg: z.string().default('#3b3129'),
            signText: z.string().default('#ffd166'),
            rampDepth: z.number().positive().default(1.1),
            rampColor: z.string().default('#8f8d86'),
            /** v1.37 — hueco REAL de la basculante: el frente del runtime se parte alrededor
             *  (jambas + dintel) y al levantarse la puerta se ve el interior AL INSTANTE. */
            doorW: z.number().positive().optional(),
            doorH: z.number().positive().optional(),
            furniture: z
              .object({
                benchW: z.number().positive().default(1.35),
                benchH: z.number().positive().default(0.92),
                benchD: z.number().positive().default(0.55),
                pegW: z.number().positive().default(1.1),
                pegH: z.number().positive().default(0.7),
                shelfW: z.number().positive().default(1),
                shelfH: z.number().positive().default(1.6),
                shelfD: z.number().positive().default(0.38),
                shelfTiers: z.number().int().min(1).default(3),
                tireR: z.number().positive().default(0.3),
                tireCount: z.number().int().min(0).default(3),
                boxW: z.number().positive().default(0.52),
                boxH: z.number().positive().default(0.34),
                boxD: z.number().positive().default(0.4),
                benchColor: z.string().default('#6d747d'),
                benchTopColor: z.string().default('#8f8d86'),
                tireColor: z.string().default('#26221e'),
                shelfColor: z.string().default('#8a5a33'),
                boxColor: z.string().default('#c9a66b'),
                pegColor: z.string().default('#4a5560'),
                wallColor: z.string().default('#9aa2ad'),
              })
              .optional(),
          })
          .default({ panel: '#c9ced6', panelShade: '#9aa2ad', rail: '#6d747d', window: '#dfe9ee', sign: 'GARAJES', signBg: '#3b3129', signText: '#ffd166', rampDepth: 1.1, rampColor: '#8f8d86' }),
        /** v1.30 — TRASTERO COMUNITARIO (local de la planta 0): dos puertas mapeadas que
         *  funcionan como las de las viviendas y dentro, estanterías para todos. */
        trasteroComunal: z
          .object({
            doorArt: z.string().default('/art/interiors/raw/door_comunal.png'),
            doorW: z.number().positive().default(0.85),
            doorH: z.number().positive().default(1.72),
            doorDx: z.number().default(0.55),
            shelfTiers: z.number().int().min(1).default(3),
            sign: z.string().default('TRASTERO COMÚN'),
            signBg: z.string().default('#3b3129'),
            signText: z.string().default('#ffd166'),
          })
          .default({ doorArt: '/art/interiors/raw/door_comunal.png', doorW: 0.85, doorH: 1.72, doorDx: 0.55, shelfTiers: 3, sign: 'TRASTERO COMÚN', signBg: '#3b3129', signText: '#ffd166' }),
        /** v1.30 — SALA DE JUNTAS (local de la comunidad): se mapea como local de reuniones
         *  (no como vivienda), con mesa y sillas; convocada una junta, los presentes entran
         *  y se sientan (también acoge fiestas). Asientos en coords LOCALES del bloque. */
        juntaHall: z
          .object({
            doorW: z.number().positive().default(1.05),
            sign: z.string().default('SALA DE JUNTAS'),
            signBg: z.string().default('#3b3129'),
            signText: z.string().default('#ffd166'),
            tableW: z.number().positive().default(2.6),
            tableD: z.number().positive().default(0.95),
            tableZ: z.number().positive().default(1.5),
            seats: z.array(z.tuple([z.number(), z.number()])).default([
              [1.15, 0.72], [2.34, 0.72], [3.53, 0.72],
              [1.15, 2.28], [2.34, 2.28], [3.53, 2.28],
              [0.6, 1.5], [4.08, 1.5],
            ]),
            /** v1.32 — puestos DE PIE (coords locales) para los asistentes sin silla. */
            standSpots: z.array(z.tuple([z.number(), z.number()])).default([
              [1.0, 2.62], [1.85, 2.62], [2.7, 2.62], [3.55, 2.62], [0.5, 0.5], [4.18, 0.5],
            ]),
            wood: z.string().default('#8a5a33'),
            woodDark: z.string().default('#6f4926'),
          })
          .default({
            doorW: 1.05, sign: 'SALA DE JUNTAS', signBg: '#3b3129', signText: '#ffd166',
            tableW: 2.6, tableD: 0.95, tableZ: 1.5,
            seats: [[1.15, 0.72], [2.34, 0.72], [3.53, 0.72], [1.15, 2.28], [2.34, 2.28], [3.53, 2.28], [0.6, 1.5], [4.08, 1.5]],
            standSpots: [[1.0, 2.62], [1.85, 2.62], [2.7, 2.62], [3.55, 2.62], [0.5, 0.5], [4.18, 0.5]],
            wood: '#8a5a33', woodDark: '#6f4926',
          }),
        /** v1.30 — PUERTAS BATIENTES de los locales de planta 0 (v1.32): trastero común y
         *  sala de juntas abren al acercarse cualquiera (movers), como el resto de puertas. */
        hallDoors: z
          .object({
            enabled: z.boolean().default(true),
            openAhead: z.number().positive().default(1.15),
            openSeconds: z.number().positive().default(0.45),
            openAngle: z.number().positive().default(1.0),
            /** v1.34 — ángulo de LEVANTAMIENTO de la basculante del garaje (rad). */
            liftAngle: z.number().positive().default(1.45),
            /** v1.36 — la BASCULANTE del garaje se anticipa MÁS y va más lenta: el interior
             *  se ve DESDE QUE LA PUERTA SE MUEVE, sin esperar a entrar. */
            garageOpenAhead: z.number().positive().optional(),
            garageOpenSeconds: z.number().positive().optional(),
            /** v1.45 — APERTURA POR INTENCIÓN en los locales de planta 0 (trastero común,
             *  sala de juntas, garaje): la hoja solo abre cuando el jugador EMPUJA hacia
             *  ella (avanza hacia la fachada plantado delante — sin tecla E) o cuando un
             *  mover está EN el umbral (franja NPC estrecha). false = franja clásica. */
            intentOpen: z.boolean().optional(),
            /** v1.45 — franja NPC (vecinos): profundidad y semiancho X del umbral; el
             *  garaje (hoja ancha) admite overrides propios. */
            npcOpenAhead: z.number().positive().optional(),
            npcXRadius: z.number().positive().optional(),
            garageNpcOpenAhead: z.number().positive().optional(),
            garageNpcXRadius: z.number().positive().optional(),
            /** v1.36 — fracción de apertura que revela el interior de garaje/portal. */
            revealAt: z.number().min(0).max(1).optional(),
          })
          .default({ enabled: true, openAhead: 1.15, openSeconds: 0.45, openAngle: 1.0, liftAngle: 1.45 }),
        /** v1.30 — LAVANDERÍA comunitaria: local ABIERTO (sin pared frontal) con las
         *  máquinas de lavado comunes dentro (recortes billboard del catálogo). */
        lavanderia: z
          .object({
            machines: z.number().int().min(1).default(4),
            art: z.string().default('/art/interiors/raw/f_lavadora.png'),
            artH: z.number().positive().default(1.02),
            machineColor: z.string().default('#e8e6e0'),
            sign: z.string().default('LAVANDERÍA'),
            signBg: z.string().default('#3b3129'),
            signText: z.string().default('#ffd166'),
            /** v1.35 — VOLÚMENES apilados (3 lavadoras abajo + 3 secadoras arriba) con
             *  frontal mapeado y bombo que GIRA en las «en marcha» (tirada determinista). */
            stacks: z.number().int().min(1).max(6).optional(),
            machineW: z.number().positive().optional(),
            washerH: z.number().positive().optional(),
            dryerH: z.number().positive().optional(),
            machineD: z.number().positive().optional(),
            stackGap: z.number().min(0).max(0.3).optional(),
            drumOnChance: z.number().min(0).max(1).optional(),
            drumSpeedMin: z.number().positive().optional(),
            drumSpeedMax: z.number().positive().optional(),
            bodyColor: z.string().optional(),
            bodyShade: z.string().optional(),
            frontColor: z.string().optional(),
            drumColor: z.string().optional(),
            drumGlass: z.string().optional(),
            panelColor: z.string().optional(),
            accentColor: z.string().optional(),
            topColor: z.string().optional(),
          })
          .default({ machines: 4, art: '/art/interiors/raw/f_lavadora.png', artH: 1.02, machineColor: '#e8e6e0', sign: 'LAVANDERÍA', signBg: '#3b3129', signText: '#ffd166' }),
        /** v1.35 — VESTÍBULO del portal: colores interiores del local. v1.36 — el interior
         *  es UNA IMAGEN del hall (interiors.json → wall_portal_hall.png); del catálogo solo
         *  quedan los colores de pared y suelo del diorama. */
        portal: z
          .object({
            lobby: z
              .object({
                wallColor: z.string().default('#d8d3c8'),
                floorColor: z.string().default('#b9b3a4'),
              })
              .default({ wallColor: '#d8d3c8', floorColor: '#b9b3a4' }),
          })
          .optional(),
      })
      .default({
        corridorWall: '#dbd8d2',
        hideNodes: {},
        portalDoors: { slide: 0.96, openAhead: 1.7, openSeconds: 0.8, frame: '#8fa3ad', glass: '#cfe3ea', sheen: '#ffffff', handle: '#5d6b7a', alpha: 0.72 },
        garaje: { panel: '#c9ced6', panelShade: '#9aa2ad', rail: '#6d747d', window: '#dfe9ee', sign: 'GARAJES', signBg: '#3b3129', signText: '#ffd166', rampDepth: 1.1, rampColor: '#8f8d86' },
        trasteroComunal: { doorArt: '/art/interiors/raw/door_comunal.png', doorW: 0.85, doorH: 1.72, doorDx: 0.55, shelfTiers: 3, sign: 'TRASTERO COMÚN', signBg: '#3b3129', signText: '#ffd166' },
        hallDoors: { enabled: true, openAhead: 1.15, openSeconds: 0.45, openAngle: 1.0, liftAngle: 1.45 },
        juntaHall: {
          doorW: 1.05, sign: 'SALA DE JUNTAS', signBg: '#3b3129', signText: '#ffd166',
          tableW: 2.6, tableD: 0.95, tableZ: 1.5,
          seats: [[1.15, 0.72], [2.34, 0.72], [3.53, 0.72], [1.15, 2.28], [2.34, 2.28], [3.53, 2.28], [0.6, 1.5], [4.08, 1.5]],
          standSpots: [[1.0, 2.62], [1.85, 2.62], [2.7, 2.62], [3.55, 2.62], [0.5, 0.5], [4.18, 0.5]],
          wood: '#8a5a33', woodDark: '#6f4926',
        },
        lavanderia: { machines: 4, art: '/art/interiors/raw/f_lavadora.png', artH: 1.02, machineColor: '#e8e6e0', sign: 'LAVANDERÍA', signBg: '#3b3129', signText: '#ffd166' },
      }),
    /** v1.35 — GRAFITIS: textos y dibujos graciosos del catálogo (spray en cabina y muros).
     *  cabinMin = nivel de cabin_graffiti en que aparece el mural; spillToWalls = nivel en
     *  que también salpican cubo de escalera y vestíbulo. La junta limpia (param a 0). */
    graffiti: z
      .object({
        cabinMin: z.number().min(0).max(100).default(1),
        spillToWalls: z.number().min(0).max(100).default(25),
        alpha: z.number().min(0).max(1).default(0.94),
        colors: z.array(z.string()).min(1).default(['#ff5900']),
        outline: z.string().default('#1c1c1c'),
        texts: z.array(z.string()).min(1).default(['AQUÍ PINTÓ PINTURILLAS']),
        doodles: z.array(z.string()).default(['corona', 'estrella', 'gato', 'flecha', 'carita', 'rayo']),
        wallLines: z.array(z.string()).default([]),
      })
      .optional(),
    /** v1.35 — DECAY visible (humedades/grietas/hollín/mugre): umbrales por parámetro del
     *  sim; la opacidad de cada mancha crece con el valor (o con la CAÍDA del parámetro). */
    decay: z
      .object({
        humidity: z.object({ min: z.number().min(0).default(30), max: z.number().min(1).default(80), w: z.number().positive().default(1.1), h: z.number().positive().default(0.9) }).optional(),
        soot: z.object({ min: z.number().min(0).default(15), max: z.number().min(1).default(70), w: z.number().positive().default(0.8), h: z.number().positive().default(0.55) }).optional(),
        cracks: z.object({ conditionMax: z.number().min(1).default(55), w: z.number().positive().default(1.0), h: z.number().positive().default(1.3) }).optional(),
        grime: z.object({ cleanlinessMax: z.number().min(1).default(45), w: z.number().positive().default(1.0), h: z.number().positive().default(0.7) }).optional(),
      })
      .optional(),
    /** v1.35 — LLEVAR OBJETOS ENCIMA: actividades del catálogo que cargan caja/paquete
     *  sobre la cabeza (reparto, obra, mural…) + colores y tamaño de la carga. */
    carry: z
      .object({
        activities: z.array(z.string()).default([]),
        boxColor: z.string().default('#c9a66b'),
        boxTape: z.string().default('#a47148'),
        parcelColor: z.string().default('#e8e2d2'),
        boxW: z.number().positive().default(0.52),
        boxH: z.number().positive().default(0.34),
        boxD: z.number().positive().default(0.4),
      })
      .optional(),
    /** v1.28 — bloom/glow de las luces: halo realista de los materiales emisivos. */
    glow: z
      .object({
        enabled: z.boolean().default(true),
        intensity: z.number().min(0).default(0.75),
        blurKernelSize: z.number().int().min(8).default(32),
      })
      .default({ enabled: true, intensity: 0.75, blurKernelSize: 32 }),
    /** v1.32 — SOMBRAS DE VERDAD: un ShadowGenerator sobre el sol del catálogo. Las listas
     *  son patrones de NOMBRE de malla (data-driven): quién proyecta, quién recibe y qué
     *  planos quedan fuera (alpha-test que proyectarían rectángulos, cristales, arte 2D). */
    shadows: z
      .object({
        enabled: z.boolean().default(true),
        mapSize: z.number().int().min(256).default(2048),
        darkness: z.number().min(0).max(1).default(0.32),
        bias: z.number().default(0.0008),
        normalBias: z.number().default(0.012),
        casters: z.array(z.string()).default([]),
        receivers: z.array(z.string()).default([]),
        excluded: z.array(z.string()).default([]),
      })
      .default({ enabled: false, mapSize: 2048, darkness: 0.32, bias: 0.0008, normalBias: 0.012, casters: [], receivers: [], excluded: [] }),
    /** v1.32 — TEXTOS data-driven: palabras ordinales de planta por idioma (los textos
     *  del catálogo las usan con tokens {planta:a} — si el edificio cambia de plantas,
     *  los mensajes se adaptan solos). */
    texts: z
      .object({
        ordinals: z.array(z.string()).default(['baja', 'primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta']),
        ordinalsEn: z.array(z.string()).default(['ground', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth']),
        floorTemplateEs: z.string().default('{ordinal} planta'),
        floorTemplateEn: z.string().default('{ordinal} floor'),
      })
      .default({ ordinals: ['baja', 'primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta'], ordinalsEn: ['ground', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'], floorTemplateEs: '{ordinal} planta', floorTemplateEn: '{ordinal} floor' }),
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
    ambient: z.object({
      dir: z.tuple([z.number(), z.number(), z.number()]),
      intensity: z.number(),
      /** v1.29 — color de rebote (groundColor de la hemisférica): levanta techos/caras
       *  inferiores de los interiores (antes negro puro). */
      ground: z.string().optional(),
    }),
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
        /** v1.24 — árboles como recortes 2D (billboards fundidos por arte); vacío = esferas 3D. */
        treeArt: z
          .array(
            z.object({
              art: z.string(),
              w: z.number().positive(),
              h: z.number().positive(),
              keyTolerance: z.number().min(0.02).max(0.5).default(0.12),
            }),
          )
          .default([]),
        /** v1.28 — rectángulos del mundo sin árboles/arbustos (nada de verde tapando el portal). */
        keepOut: z
          .array(z.object({ x0: z.number(), x1: z.number(), z0: z.number(), z1: z.number() }))
          .default([]),
        /** v1.28 — árboles COLOCADOS a mano (posiciones explícitas del mundo): el vecino pidió
         *  desplazar el del portal "a la parte derecha de la imagen". */
        forcedTrees: z
          .array(z.object({ x: z.number(), z: z.number(), art: z.string().optional(), s: z.number().positive().optional() }))
          .default([]),
        /** v1.37 — PARQUE DE CALISTENIA en el jardín de enfrente: suelo de caucho, barra de
         *  dominadas, paralelas, banco de abdominales y cartel — TODO del catálogo. */
        calisthenics: z
          .object({
            enabled: z.boolean().default(true),
            x: z.number(),
            z: z.number(),
            w: z.number().positive(),
            d: z.number().positive(),
            ground: z.string().default('#c26d4f'),
            edge: z.string().default('#8f4a33'),
            postColor: z.string().default('#6f4926'),
            barColor: z.string().default('#b8bfc7'),
            boardColor: z.string().default('#f2ead9'),
            sign: z.string().default('CALISTENIA'),
            signBg: z.string().default('#3b3129'),
            signFg: z.string().default('#ffd166'),
            barH: z.number().positive().default(2.15),
            dipH: z.number().positive().default(1.22),
          })
          .optional(),
      })
      .default({ enabled: false, rows: [], ground: { color: '#a89a7c', size: 220, backZ: 0 }, treeArt: [], keepOut: [], forcedTrees: [] }),
    /** v1.37 — ATRIL del tablón de anuncios (planta 0, extremo del pasillo): tablón con
     *  corcho, notas fijadas y atril inclinado; la consulta del tablón vive ahí. */
    noticeboard: z
      .object({
        enabled: z.boolean().default(true),
        floor: z.number().int().default(0),
        side: z.enum(['left', 'right']).default('left'),
        inset: z.number().positive().default(0.82),
        z: z.number().default(-0.72), // offset desde la línea del pasillo (negativo = hacia la calle)
        yaw: z.number().default(5.11),
        postColor: z.string().default('#6f4926'),
        postW: z.number().positive().default(0.1),
        frameColor: z.string().default('#8a5a33'),
        frameW: z.number().positive().default(0.07),
        corkColor: z.string().default('#c9a877'),
        boardW: z.number().positive().default(1.5),
        boardH: z.number().positive().default(1.04),
        boardY: z.number().positive().default(1.68),
        deskW: z.number().positive().default(0.7),
        deskD: z.number().positive().default(0.44),
        deskY: z.number().positive().default(1.04),
        deskColor: z.string().default('#8a5a33'),
        deskSlant: z.number().min(0).max(1).default(0.42),
        capColor: z.string().default('#6f4926'),
        headline: z.string().default('TABLÓN DE ANUNCIOS'),
        headlineBg: z.string().default('#3b3129'),
        headlineFg: z.string().default('#ffd166'),
        paperColors: z.array(z.string()).min(1).default(['#f6f1e2']),
        notes: z.array(z.string()).min(1).default(['TABLÓN DE ANUNCIOS']),
      })
      .optional(),
    /** v1.37 — PASEO VECINAL: los vecinos salen a la calle, cruzan por el paso de peatones
     *  mirando a ambos lados y van al jardín de enfrente a practicar algo de deporte. */
    paseo: z
      .object({
        enabled: z.boolean().default(true),
        everyMin: z.number().positive().default(40),
        everyMax: z.number().positive().default(110),
        maxOut: z.number().int().min(1).default(2),
        chance: z.number().min(0).max(1).default(0.85),
        lookSeconds: z.number().positive().default(0.95),
        doorWait: z.number().min(0).default(1.1),
        crossMargin: z.number().positive().default(17),
        crossX: z.number().default(13),
        curbNearZ: z.number().default(-5.6),
        curbFarZ: z.number().default(-13.1),
        parkX: z.number().default(12.3),
        parkZ: z.number().default(-15.4),
        exerciseMin: z.number().positive().default(9),
        exerciseMax: z.number().positive().default(20),
        gesture: z.string().default('dance'),
        bob: z.number().min(0).default(0.085),
        bobRate: z.number().positive().default(4.2),
        lines: z.array(z.string()).min(1).default(['A estirar las piernas.']),
        /** v1.41 — RUTA POR EL PERÍMETRO IZQUIERDO: la única puerta «real» del edificio es
         *  la pared lateral del portal (se sale cruzando el portal hacia su lado izquierdo
         *  y se entra al revés, un poco por detrás del bloque de entrada). */
        sideX: z.number().default(-2.9),
        sideZ: z.number().default(0.35),
        cornerZ: z.number().default(-4.9),
        frontZ: z.number().default(-5.7),
        portalSideX: z.number().default(0.3),
        /** v1.41 — PLANES del paseo: reparto entre parque (calistenia), banco (sentarse),
         *  paseo (estirar piernas por la acera frontal) y taxi (vuelve en taxi con bolsas).
         *  El resto relativo lo da 1 − suma. */
        benchChance: z.number().min(0).max(1).default(0.3),
        strollChance: z.number().min(0).max(1).default(0.25),
        taxiChance: z.number().min(0).max(1).default(0.2),
        strollMeters: z.number().positive().default(9),
        sitSecondsMin: z.number().positive().default(8),
        sitSecondsMax: z.number().positive().default(22),
      })
      .optional(),
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
        /** v1.41 — CORTESÍA AL VOLANTE: los coches FRENAN en el paso de peatones si hay
         *  alguien cruzando (y guardan distancia con el de delante). Si el peatón se planta
         *  demasiado cerca, la frenada es imposible → susto/accidente cómico del catálogo. */
        braking: z
          .object({
            enabled: z.boolean().default(true),
            zebraHalfWidth: z.number().positive().default(2.4),
            minStopDist: z.number().positive().default(4.4),
            brakeDecel: z.number().positive().default(13),
            followGap: z.number().positive().default(6.5),
            hazardSeconds: z.number().positive().default(6),
          })
          .default({ enabled: true, zebraHalfWidth: 2.4, minStopDist: 4.4, brakeDecel: 13, followGap: 6.5, hazardSeconds: 6 }),
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
            /** v1.31 — detalle: matrícula pintada (delante/detrás), rótulos laterales,
             *  rótulo destino del bus, cartel de tejado (TAXI), parrilla de techo y
             *  ejes traseros (bus y reparto llevan rueda doble = 3 ejes). */
            plate: z.string().default(''),
            sideText: z.string().default(''),
            destSign: z.string().default(''),
            roofSign: z.string().default(''),
            roofRack: z.boolean().default(false),
            axles: z.number().int().min(2).max(3).default(2),
          }),
        ),
        /** v1.32 — AMBULANCIA del teatro de emergencias (opcional): presente en el catálogo,
         *  el director de la calle puede pedir el rig para recoger heridos del vecindario. */
        ambulance: z
          .object({
            length: z.number().positive().default(4.8),
            width: z.number().positive().default(1.9),
            height: z.number().positive().default(1.9),
            color: z.string().default('#f2f4f4'),
            sideText: z.string().default('AMBULANCIA'),
            stripe: z.string().default('#e8641b'),
            cross: z.string().default('#c0392b'),
            beaconA: z.string().default('#2f6fb8'),
            beaconB: z.string().default('#e8b71b'),
            /** Teatro: carril de parada, frenada frente al herido, lado de entrada y marcha. */
            stopZ: z.number().default(-8.3),
            stopAhead: z.number().positive().default(2.6),
            enterFrom: z.enum(['left', 'right']).default('left'),
            speed: z.number().positive().default(8),
            doorSeconds: z.number().positive().default(0.8),
            medicSpeed: z.number().positive().default(1.5),
            carryHeight: z.number().positive().default(0.72),
            medicColor: z.string().default('#f0f2f0'),
            medicCapColor: z.string().default('#2e8b6e'),
            medicLegColor: z.string().default('#3a4750'),
          })
          .optional(),
      })
      .default({ enabled: false, lanes: [], spawnEveryMin: 8, spawnEveryMax: 24, maxAlive: 4, xMin: -60, xMax: 60, passX: 13.1, passRadius: 22, braking: { enabled: true, zebraHalfWidth: 2.4, minStopDist: 4.4, brakeDecel: 13, followGap: 6.5, hazardSeconds: 6 }, vehicles: [] }),
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
        /** v1.30 — umbral del portal (z del mundo): entrar/salir cruza POR las correderas. */
        enterZ: z.number().default(-1.7),
        /** v1.41 — RUTA LATERAL (la única entrada «real»): los viandantes que entran o salen
         *  cruzan el portal hacia su pared izquierda y recorren la acera lateral (perímetro
         *  oeste) hasta la acera frontal. Sin esto, entran por la frontal como siempre. */
        sideRoute: z
          .object({
            sideX: z.number().default(-2.9),
            sideZ: z.number().default(0.35),
            cornerZ: z.number().default(-4.9),
            frontZ: z.number().default(-5.7),
            portalSideX: z.number().default(0.3),
          })
          .optional(),
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
        /** v1.25: arquetipos del catálogo de vecinos que prestan su cuerpo a los viandantes
         *  (misma estética). Vacío → todos los del manifiesto con clip de andar. */
        actorArchetypes: z.array(z.string()).default([]),
        /** v1.32 — VIDA SOCIAL DE ACERA: dos viandantes que se cruzan pueden parar a
         *  charlar, discutir o pelear; un herido llama al teatro de la ambulancia. */
        social: z
          .object({
            enabled: z.boolean().default(true),
            checkEvery: z.number().positive().default(1.6),
            distance: z.number().positive().default(1.3),
            maxConcurrent: z.number().int().min(1).default(1),
            talkSeconds: z.number().positive().default(4.5),
            argueChance: z.number().min(0).max(1).default(0.2),
            fightChance: z.number().min(0).max(1).default(0.12),
            injuredChance: z.number().min(0).max(1).default(0.75),
            hurtSeconds: z.number().positive().default(4),
            pairCooldown: z.number().min(0).default(240),
          })
          .default({ enabled: true, checkEvery: 1.6, distance: 1.3, maxConcurrent: 1, talkSeconds: 4.5, argueChance: 0.2, fightChance: 0.12, injuredChance: 0.75, hurtSeconds: 4, pairCooldown: 240 }),
      })
      .default({ enabled: false, maxAlive: 6, spawnEveryMin: 5, spawnEveryMax: 16, speedMin: 0.9, speedMax: 1.5, enterChance: 0.25, exitChance: 0.3, enterX: 13.1, enterZ: -1.7, paths: [], colors: ['#5d6b7a'], hatChance: 0.3, hatColors: ['#3b3129'], actorArchetypes: [], social: { enabled: true, checkEvery: 1.6, distance: 1.3, maxConcurrent: 1, talkSeconds: 4.5, argueChance: 0.2, fightChance: 0.12, injuredChance: 0.75, hurtSeconds: 4, pairCooldown: 240 } }),
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
            /** v1.49 — PROFUNDIDAD REAL entre capas (petición del vecino: «cuanto más cerca,
             *  siempre por delante de los que están más lejos»): con depthWrite la capa se
             *  dibuja en ALPHATEST y ESCRIBE depth — la oclusión la decide el buffer de
             *  profundidad (posición de la cámara aparte), no el orden de mezcla. */
            depthWrite: z.boolean().default(true),
            /** Umbral de recorte ALPHATEST (solo con depthWrite): los sellos PNG son alfa
             *  binario (medido: <1% de píxeles intermedios) → el recorte no muerde los sellos. */
            alphaCutOff: z.number().min(0.05).max(1).default(0.4),
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
            /** v1.28 — lavado de la ciudad del fondo con el cielo cerrado (gris azulado). */
            wash: z
              .object({ color: z.string().default('#9aa3ad'), alpha: z.number().min(0).max(1).default(0.34) })
              .default({ color: '#9aa3ad', alpha: 0.34 }),
          })
          .default({ count: 900, stormCount: 1600, fallSpeed: 26, wind: -3.5, color: '#cfe3f2', alpha: 0.5, length: 0.55, width: 0.035, wash: { color: '#9aa3ad', alpha: 0.34 } }),
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
            /** v1.28 — velado de día de lluvia: el cielo se funde hacia estos colores y el
             *  sol/luna se retiran (rain/storm marcan cuánto: 0..1) — cielo CERRADO. */
            overcast: z
              .object({
                top: z.string().default('#8e97a3'),
                horizon: z.string().default('#aeb4ba'),
                rain: z.number().min(0).max(1).default(0.85),
                storm: z.number().min(0).max(1).default(1),
              })
              .default({ top: '#8e97a3', horizon: '#aeb4ba', rain: 0.85, storm: 1 }),
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
            overcast: { top: '#8e97a3', horizon: '#aeb4ba', rain: 0.85, storm: 1 },
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
            /** v1.28 — con lluvia las nubes engordan hasta cerrar el cielo (1 = sin cambio). */
            stormScale: z.number().min(1).default(1.7),
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
            stormScale: 1.7,
          }),
      })
      .default({
        enabled: false,
        layers: [],
        rain: { count: 900, stormCount: 1600, fallSpeed: 26, wind: -3.5, color: '#cfe3f2', alpha: 0.5, length: 0.55, width: 0.035, wash: { color: '#9aa3ad', alpha: 0.34 } },
        sky: {
          redrawSeconds: 6,
          keyframes: [],
          weatherDim: { sunny: 1, cloudy: 0.95, rain: 0.8, storm: 0.6 },
          overcast: { top: '#8e97a3', horizon: '#aeb4ba', rain: 0.85, storm: 1 },
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
          stormScale: 1.7,
        },
      }),
    lod: z.object({
      enabled: z.boolean(),
      focus: z.literal('player'),
      levels: z.array(z.object({ dist: z.number(), hide: z.array(z.enum(['edges', 'glow', 'panels'])) })),
    }),
    /** v1.36 — ALEJAMIENTO de la cámara Estancia (petición: «alejar un poco la cámara
     *  Estancia para que… en el extremo del pasillo de planta 0… lo enfoque»): factores
     *  de encuadre (antes 2.0/2.2) y MARGEN que deja asomar la cámara más allá del borde
     *  del mundo para que el personaje del extremo salga EN CUADRO y no pegado al canto. */
    camera: z
      .object({
        estanciaFloorH: z.number().positive(),
        estanciaWidthW: z.number().positive(),
        estanciaEdgeMargin: z.number().min(0),
        /** v1.41 — CÁMARA FACHADA (tecla 0): factor de alejamiento sobre la vista edificio
         *  (viewH = edificio × factor): se ve el bloque entero CON fachada cerrada. */
        fachadaViewHFactor: z.number().positive().default(1.32),
      })
      .default({ estanciaFloorH: 2.5, estanciaWidthW: 2.9, estanciaEdgeMargin: 2.4, fachadaViewHFactor: 1.32 }),
    /** v1.41 — ACCESORIOS DE LA CALLE: paraguas abierto cuando llueve y bolsas de la
     *  compra al volver. Solo presentación; colores y tiempos del catálogo. */
    outdoor: z
      .object({
        umbrella: z
          .object({
            color: z.string().default('#b8452e'),
            stickColor: z.string().default('#5b4632'),
            size: z.number().positive().default(1.02),
            openSeconds: z.number().positive().default(0.45),
          })
          .default({ color: '#b8452e', stickColor: '#5b4632', size: 1.02, openSeconds: 0.45 }),
        bags: z
          .object({
            colorA: z.string().default('#d8c9a3'),
            colorB: z.string().default('#9fb875'),
          })
          .default({ colorA: '#d8c9a3', colorB: '#9fb875' }),
      })
      .default({ umbrella: { color: '#b8452e', stickColor: '#5b4632', size: 1.02, openSeconds: 0.45 }, bags: { colorA: '#d8c9a3', colorB: '#9fb875' } }),
    /** v1.41 — TEATRO DEL TAXI: vecinos que vuelven en taxi con las bolsas de la compra
     *  (el taxi para frente al portal, se bajan, cruzan y entran por la ruta lateral). */
    taxi: z
      .object({
        enabled: z.boolean().default(true),
        /** Punto de recogida/bajada en la acera frontal (delante del portal). */
        pickupX: z.number().default(4.4),
        /** Carril donde para el taxi y punto exacto de parada. */
        stopLaneZ: z.number().default(-8.3),
        stopX: z.number().default(4.4),
        waitMin: z.number().positive().default(6),
        waitMax: z.number().positive().default(14),
        /** Minutos (sim) que el vecino está «de compras» entre subida y vuelta. */
        rideMin: z.number().positive().default(45),
        rideMax: z.number().positive().default(150),
      })
      .default({ enabled: true, pickupX: 4.4, stopLaneZ: -8.3, stopX: 4.4, waitMin: 6, waitMax: 14, rideMin: 45, rideMax: 150 }),
    /** v1.42 — SALIDA DEL JUGADOR A LA CALLE: rects transitables (aceras, paso de cebra,
     *  jardín de enfrente, entrante del portal), disparadores del portal SIN tecla E
     *  (la dirección correcta ya entra o sale), bancos y calistenia. El jugador es un
     *  vecino más: no puede salir del plano de la cámara lejana (xMin/xMax). */
    outside: z
      .object({
        xMin: z.number().default(-7.5),
        xMax: z.number().default(29),
        walk: z
          .array(z.object({ x0: z.number(), z0: z.number(), x1: z.number(), z1: z.number() }))
          .default([
            { x0: -7.5, z0: -7.0, x1: 29, z1: -4.4 },
            { x0: -6, z0: -7.0, x1: 0, z1: 6.4 },
            { x0: -7.5, z0: -13.8, x1: 29, z1: -11.6 },
            { x0: 10.2, z0: -11.6, x1: 15.8, z1: -7.0 },
            { x0: 7.0, z0: -17.6, x1: 19.0, z1: -13.8 },
            { x0: 0.35, z0: -4.4, x1: 4.45, z1: -1.5 },
          ]),
        portal: z
          .object({
            outFrontZ: z.number().default(-2.2),
            inFrontZ: z.number().default(-1.75),
            sideExitX: z.number().default(-2.9),
            sideEnterX: z.number().default(-0.6),
            sideZ: z.number().default(0.35),
            wallInnerX: z.number().default(0.55),
            frontInnerZ: z.number().default(0.42),
            fadeSeconds: z.number().positive().default(0.35),
          })
          .default({ outFrontZ: -2.2, inFrontZ: -1.75, sideExitX: -2.9, sideEnterX: -0.6, sideZ: 0.35, wallInnerX: 0.55, frontInnerZ: 0.42, fadeSeconds: 0.35 }),
        benchRadius: z.number().positive().default(1.3),
        exercise: z
          .object({
            x: z.number().default(12.9),
            z: z.number().default(-15.4),
            radius: z.number().positive().default(1.7),
            secondsMin: z.number().positive().default(6),
            secondsMax: z.number().positive().default(14),
            moodBoost: z.number().min(0).default(6),
          })
          .default({ x: 12.9, z: -15.4, radius: 1.7, secondsMin: 6, secondsMax: 14, moodBoost: 6 }),
        sitMoodBoost: z.number().min(0).default(4),
        says: z
          .object({
            out: z.array(z.string()).default([]),
            into: z.array(z.string()).default([]),
            sit: z.array(z.string()).default([]),
            exercise: z.array(z.string()).default([]),
          })
          .default({ out: [], into: [], sit: [], exercise: [] }),
      })
      .optional(),
    /** v1.42 — ZONAS CIEGAS de la cortina de la vista FACHADA: bandas opacas arriba y
     *  abajo de cada nivel + paneles ciegos deterministas, con el acabado de las fachadas
     *  de fondo (tint/windowColor del backdrop). NADA coplanar: detrás del vidrio. */
    fachadaCortina: z
      .object({
        bottomBlind: z.number().min(0).default(0.55),
        topBlind: z.number().min(0).default(0.42),
        bandColor: z.string().default('#cfc9bd'),
        panelColor: z.string().default('#7d8ba0'),
        panelChance: z.number().min(0).max(1).default(0.3),
        panelInset: z.number().min(0).default(0.08),
      })
      .optional(),
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
    /** v1.40 — timbre y charla: prompt de la E en la puerta ajena y con un vecino de
     *  paseo por el pasillo. {name} = nombre propio del vecino. */
    doorbell: z.string().optional(),
    chat: z.string().optional(),
    /** v1.42 — calle: banco exterior, calistenia y levantarse (prompt de la E). */
    bench: z.string().optional(),
    exercise: z.string().optional(),
    standUp: z.string().optional(),
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
    /** v1.24: irregularidad de la multitud — jitter longitudinal (m) y ancho de banda (m).
     *  Con ellos la marcha deja de ser una fila exacta: columnas torpeas de gente real. */
    slotJitter: z.number().min(0).default(0.5),
    spreadZ: z.number().min(0).default(1.6),
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
  /** v1.41 — VIDA EN LAS ENTRADAS Y SALIDAS: líneas cómicas del teatro exterior
   *  (paseo por la acera, bancos, paraguas, bolsas, taxi, frenazos y accidentes). */
  outdoor: z
    .object({
      /** Al salir del portal por la lateral. */
      exitLines: z.array(z.string()).min(1).default(['Hasta luego, bloque, que no nos vemos por el pasillo.']),
      /** Al volver a entrar por la lateral. */
      enterLines: z.array(z.string()).min(1).default(['Por la izquierda, que la frontal es de adornos.']),
      /** Sentado en un banco exterior. */
      benchLines: z.array(z.string()).min(1).default(['Este banco tiene las mejores vistas del tráfico.']),
      /** Paseando por la acera frontal. */
      strollLines: z.array(z.string()).min(1).default([' media vuelta a la manzana y a casa.']),
      /** Con el paraguas abierto bajo la lluvia. */
      umbrellaLines: z.array(z.string()).min(1).default(['Paraguas abierto: hoy la lluvia no me moja la siesta.']),
      /** Al volver con las bolsas de la compra. */
      bagsLines: z.array(z.string()).min(1).default(['La compra de todo el pasillo… me la recomiendo.']),
      /** Pide el taxi (a la acera, al teléfono…). */
      taxiHail: z.array(z.string()).min(1).default(['Taxi! Que para escaleras ya estoy mayor.']),
      /** Al subir al taxi (desaparece). */
      taxiBoard: z.array(z.string()).min(1).default(['A la calle de los tarareos, y pise usted la aceleración.']),
      /** Al bajarse del taxi de vuelta. */
      taxiBack: z.array(z.string()).min(1).default(['Aquí mismo está bien. El cambio se lo queda la propina.']),
      /** Frenazo heroico ante un peatón (susto cómico, sin contacto). */
      nearMiss: z.array(z.string()).min(1).default(['¡Pero bueno! ¿Se puede cruzar con un poco de aviso?']),
      /** Accidente cómico: coche no puede frenar y el peatón acaba sentado en la calzada. */
      accident: z.array(z.string()).min(1).default(['Mi espalda… y mi dignidad, por el paso de peatones.']),
      /** Bocina del coche (frenazo/susto). */
      carHorn: z.string().default('¡PIIIIP!'),
    })
    .optional(),
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
    /** v1.40 — PROXIMIDAD: radio (metros) dentro del cual lucen los emoticonos de un
     *  vecino, siempre en tu misma planta. undefined = sin filtro (comportamiento antiguo). */
    nearRadius: z.number().positive().optional(),
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
      /** v1.34 — patas (alto) y collar del perro; si faltan, el cuerpo sale a tierra. */
      legH: z.number().positive().optional(),
      collar: z.string().min(1).optional(),
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
export const localizedTextSchema = z.object({ es: z.string().min(1), en: z.string().min(1) });

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
  /** v1.32 — ESCALACIÓN SOCIAL: un cruce puede terminar en discusión (gesture 'argue',
   *  líneas airadas) o en pelea (clips 'fight' nuevos) que puede dejar a uno en el suelo
   *  (clip 'hurt') hasta que se recupera… o sale a la calle a esperar la ambulancia. */
  escalation: z
    .object({
      argueChance: z.number().min(0).max(1).default(0.22),
      fightChance: z.number().min(0).max(1).default(0.1),
      injuredChance: z.number().min(0).max(1).default(0.55),
      hurtSeconds: z.number().positive().default(9),
      fightLinesSeconds: z.number().positive().default(0.9),
      argueGroups: z.record(z.string(), z.array(z.object({ id: z.string(), lines: z.array(z.string()).min(1) }))).default({}),
      fightFight: z.array(z.string()).default(['¡Toma!', '¡Y esa!']),
      injuryLines: z.array(z.string()).default([]),
      witnessLines: z.array(z.string()).default([]),
    })
    .optional(),
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

/** Diorama de un tipo de estancia: pared del fondo + suelo + capas de mobiliario.
 *  v1.25: `walls` son PAREDES ALTERNATIVAS (misma estancia, otro arte) — el runtime elige
 *  una por hash del bloque: variedad aleatoria entre viviendas sin tocar el sim.
 *  v1.29 — PARALLAX COMPLETO: el diorama mapea TODAS las caras (fondo, laterales, techo y
 *  suelo). `floors`, `sideWalls` y `ceilings` son variantes elegidas por hash; `sets` son
 *  JUEGOS de mobiliario alternativos (mismo catálogo de sprites en varios repartos) — con
 *  paredes × suelos × techos × juegos el número de interiores distintos supera de sobra
 *  las 10 variaciones que pide el vecino. El reparto jamás se solapa (el runtime lo
 *  garantiza con reintentos deterministas, como las macetas con las puertas). */
export const interiorDioramaSchema = z.object({
  wall: z.string().min(1),
  walls: z.array(z.string()).default([]),
  floor: z.string().min(1),
  floors: z.array(z.string()).default([]),
  sideWalls: z.array(z.string()).default([]),
  ceilings: z.array(z.string()).default([]),
  sets: z.array(z.array(interiorSpriteSchema)).default([]),
  sprites: z.array(interiorSpriteSchema).default([]),
  /** v1.41 — interruptor de MOBILIARIO de la estancia: false oculta las capas de sprites
   *  (muebles/alfombras/cuadros) dejando paredes, suelo y techos. El efectivo es el AND
   *  con el flag raíz del catálogo (apagón global en una línea). */
  furnitureVisible: z.boolean().default(true),
  /** v1.36 — repeticiones del arte de pared (uScale). Por defecto el runtime lo estima
   *  del rect (redondeo w/h) para las artes cuadradas; un arte PANORÁMICO (el hall del
   *  portal, 1.75:1) fija wallTiles: 1 para verse UNA sola vez, sin duplicados. */
  wallTiles: z.number().int().min(1).max(6).optional(),
});

/** Catálogo de interiores (OPCIONAL): sin el fichero, los interiores siguen greybox.
 *  v1.25 — variedad aleatoria entre viviendas: cada estancia puede teñir su pared con un
 *  tinte de `wallTints` (hash del bloque), espejar su reparto de muebles (`mirrorChance`)
 *  y moverlos un poco (`jitter`, fracciones del rect). Todo determinista por hash01.
 *  v1.29 — `shell`: arte de la CARCASO de la vivienda (laterales + techo con paralaje,
 *  un solo bloque) — sideWalls/ceilings por hash y tinte neutro que casa con las estancias. */
export const interiorsCatalogSchema = z.object({
  artBase: z.string().default('/art/interiors/raw/'),
  keyColor: z.string().default('#ffffff'),
  keyTolerance: z.number().min(0).max(1).default(0.09),
  processSize: z.number().int().min(64).max(2048).default(512),
  alphaCutoff: z.number().min(0).max(1).default(0.45),
  /** v1.41 — apagón GLOBAL de mobiliario: false oculta TODAS las capas de sprites de todas
   *  las estancias (el AND con furnitureVisible de cada estancia decide). true = cada
   *  estancia manda por su propio flag. */
  furnitureVisible: z.boolean().default(true),
  doorDecal: z.object({ art: z.string().min(1), w: z.number().positive(), h: z.number().positive() }),
  wallTints: z.array(z.string()).default(['#ffffff']),
  mirrorChance: z.number().min(0).max(1).default(0),
  jitter: z.number().min(0).max(0.25).default(0),
  shell: z
    .object({
      sideWalls: z.array(z.string()).default([]),
      ceilings: z.array(z.string()).default([]),
      tint: z.string().default('#ffffff'),
    })
    .default({ sideWalls: [], ceilings: [], tint: '#ffffff' }),
  rooms: z.record(z.string(), interiorDioramaSchema),
});

export type InteriorsCatalog = z.infer<typeof interiorsCatalogSchema>;

// ───────────── Música procedural (v1.39, opcional) ─────────────
// Banda sonora generativa 100% Web Audio: contexto musical por franja horaria
// (mañana/tarde/evening/noche) + capa de lluvia. Sin ficheros de audio: el JSON define
// tempo, escala, acordes y ganancias; el director (client/music.ts) solo ejecuta.

export const musicCatalogSchema = z.object({
  version: z.literal(1),
  /** Ganancia general del bus de música (hereda volumen y silencio del bus de audio). */
  masterGain: z.number().min(0).max(1),
  /** Ganancia a la que se queda la música con el juego en pausa o con modal (ducking). */
  duckGain: z.number().min(0).max(1).default(0.35),
  /** Desvanecido entre contextos (segundos). */
  fadeSeconds: z.number().positive().default(2.5),
  /** Franjas horarias (minutos del día 0..1440; `to` puede ser < `from` cuando cruza medianoche). */
  dayParts: z.object({
    morning: z.object({ from: z.number().min(0).max(1440), to: z.number().min(0).max(1440) }),
    afternoon: z.object({ from: z.number().min(0).max(1440), to: z.number().min(0).max(1440) }),
    evening: z.object({ from: z.number().min(0).max(1440), to: z.number().min(0).max(1440) }),
    night: z.object({ from: z.number().min(0).max(1440), to: z.number().min(0).max(1440) }),
  }),
  contexts: z.record(
    z.string(),
    z.object({
      /** Pulsos por minuto de la base rítmica generativa. */
      tempo: z.number().min(40).max(160),
      root: z.number().min(36).max(84),
      /** Grados de la escala (semitonos desde la tónica) sobre los que improvisa la melodía. */
      scale: z.array(z.number().int().min(-24).max(24)).min(3),
      /** Progresión: cada acorde es una lista de semitonos desde la tónica. */
      chords: z.array(z.array(z.number().int().min(-24).max(24)).min(2)).min(1),
      /** Ganancias por capa (0..0.5). */
      bassGain: z.number().min(0).max(0.5),
      padGain: z.number().min(0).max(0.5),
      leadGain: z.number().min(0).max(0.5),
      /** Densidad de la melodía (0..1): probabilidad de nota en cada corchea. */
      leadDensity: z.number().min(0).max(1),
      waves: z.object({
        pad: z.enum(['sine', 'triangle', 'sawtooth', 'square']).default('triangle'),
        lead: z.enum(['sine', 'triangle', 'sawtooth', 'square']).default('triangle'),
        bass: z.enum(['sine', 'triangle', 'sawtooth', 'square']).default('sine'),
      }),
    }),
  ).refine((c) => ['morning', 'afternoon', 'evening', 'night'].every((k) => k in c), {
    message: 'necesita contextos morning/afternoon/evening/night',
  }),
  /** Capa ambiental de lluvia (ruido filtrado en bucle) + extra con tormenta. */
  rain: z.object({
    gain: z.number().min(0).max(0.5),
    stormGain: z.number().min(0).max(0.5),
    filterHz: z.number().min(100).max(4000),
  }),
  /** Desviaciones de octava con las que la melodía salta (plucks agudos/graves). */
  melodyOctaves: z.array(z.number().int()).default([0, 12]),
});

export type MusicCatalogParsed = z.infer<typeof musicCatalogSchema>;

// ───────────── Onboarding «primer día» (v1.39, opcional) ─────────────
// Tutorial guiado no bloqueante: pasos con condición de cumplimento (el director del
// cliente las marca) + consejos contextuales one-shot al desbloquear sistemas.

export const onboardingCatalogSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean().default(true),
  welcome: z.object({ title: localizedTextSchema, text: localizedTextSchema, cta: localizedTextSchema }),
  steps: z
    .array(
      z.object({
        id: z.string().min(1),
        icon: z.string().min(1),
        title: localizedTextSchema,
        text: localizedTextSchema,
      }),
    )
    .min(1),
  tips: z.array(
    z.object({
      id: z.string().min(1),
      icon: z.string().min(1),
      text: localizedTextSchema,
    }),
  ),
  doneText: localizedTextSchema,
});

export type OnboardingCatalogParsed = z.infer<typeof onboardingCatalogSchema>;

// ───────────── Proyecto comunitario del edificio (v1.39, opcional) ─────────────
// Meta de largo plazo: niveles de mejora del edificio por contribución medida SOLO LECTURA
// del mundo (misiones completadas, arcas de la comunidad, reputación del jugador).

export const projectGoalSchema = z.object({
  missions: z.number().int().min(1).optional(),
  funds: z.number().min(1).optional(),
  reputation: z.number().min(1).max(100).optional(),
});

export const projectCatalogSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  title: localizedTextSchema,
  icon: z.string().min(1).default('🏗️'),
  levels: z
    .array(
      z.object({
        id: z.string().min(1),
        title: localizedTextSchema,
        goal: projectGoalSchema,
        reward: localizedTextSchema,
      }),
    )
    .min(1),
});

export type ProjectCatalogParsed = z.infer<typeof projectCatalogSchema>;

// ───────────── Personalidades vecinales (v1.39, opcional) ─────────────
// Vecinos como personajes: nombre corto, gustos y un banco de reacciones por contexto
// (clima, noche, saludo…) que la presentación suelta como bocadillos. Puede definir
// personalidades por ARQUETIPO (todos los de ese tipo) y por RESIDENTE (override).

const personalityReactionPool = z.record(z.string(), z.array(localizedTextSchema).min(1));

export const personalitySchema = z.object({
  /** Nombre corto visible (bocadillos, toasts, panel de vecinos); si falta, el del arquetipo. */
  name: z.string().min(1).optional(),
  tastes: z.array(localizedTextSchema).default([]),
  signature: localizedTextSchema.optional(),
  reactions: personalityReactionPool.default({}),
});

export const personalitiesCatalogSchema = z.object({
  version: z.literal(1),
  /** Reacciones genéricas para cualquier vecino sin personalidad propia. */
  defaults: personalitySchema.default({ tastes: [], reactions: {} }),
  byArchetype: z.record(z.string(), personalitySchema).default({}),
  byResident: z.record(z.string(), personalitySchema).default({}),
  /** Cadencia de los comentarios ambientales (presentación). */
  ambient: z
    .object({
      checkEvery: z.number().positive().default(7),
      radius: z.number().positive().default(9),
      cooldownPerResident: z.number().min(0).default(120),
      maxPerMinute: z.number().int().min(1).default(4),
      lineSeconds: z.number().positive().default(2.8),
      chance: z.number().min(0).max(1).default(0.65),
    })
    .default({ checkEvery: 7, radius: 9, cooldownPerResident: 120, maxPerMinute: 4, lineSeconds: 2.8, chance: 0.65 }),
});

export type PersonalitiesCatalogParsed = z.infer<typeof personalitiesCatalogSchema>;

// ── v1.43 — PERSONAJES DETALLADOS (LOD cercano de los vecinos) ──────────────────────────

const characterDetailSpecSchema = z.object({
  height: z.number().positive().optional(),
  hunch: z.number().min(0).max(0.3).optional(),
  headScale: z.number().min(0.5).max(2).optional(),
  bulk: z.number().min(0.5).max(2).optional(),
  art: z
    .object({
      front: z.string(),
      back: z.string(),
      left: z.string(),
      right: z.string(),
    })
    .optional(),
  skin: z.string(),
  hairColor: z.string(),
  hairStyle: z.enum(['baldSides', 'bun', 'cap', 'short', 'full', 'headphones']),
  glasses: z.enum(['none', 'clear', 'sun']).default('none'),
  top: z.string(),
  suit: z
    .object({
      lapel: z.string(),
      shirt: z.string(),
      tie: z.string(),
    })
    .nullable()
    .default(null),
  bottom: z.string(),
  shoes: z.string(),
  belt: z
    .object({
      strap: z.string(),
      buckle: z.string(),
    })
    .nullable()
    .default(null),
  prop: z.enum(['none', 'clipboard', 'briefcase', 'spray', 'guitar', 'baguette']).default('none'),
  mustache: z.string().nullable().default(null),
});

export const characterDetailsCatalogSchema = z.object({
  version: z.literal(1),
  lod: z.object({
    enabled: z.boolean().default(true),
    nearDist: z.number().positive().default(10.5),
    midDist: z.number().positive().default(22),
    hysteresis: z.number().min(0).default(3),
  }),
  byArchetype: z.record(z.string(), characterDetailSpecSchema).default({}),
  defaults: characterDetailSpecSchema,
});

export type CharacterDetailsCatalogParsed = z.infer<typeof characterDetailsCatalogSchema>;

/**
 * v1.46 — Manifiesto de HOJAS DE SPRITES del personaje (OPCIONAL). Define la retícula
 * (la «regla para todos») y los PNG externos por arquetipo: si un arquetipo tiene URL,
 * su hoja MANDA sobre la generada por código. Sin el fichero, todo se hornea procedural.
 */
export const characterSpritesCatalogSchema = z.object({
  version: z.literal(1),
  layout: z.object({
    frameWidth: z.number().int().min(32).max(1024).default(256),
    frameHeight: z.number().int().min(32).max(1024).default(256),
    columns: z.number().int().min(2).max(32).default(8),
    rows: z.record(z.string(), z.number().int().min(0).max(31)).default({}),
    fps: z.record(z.string(), z.number().positive()).default({}),
  }),
  sheets: z.record(z.string(), z.string()).default({}),
  // v1.48 — REGLA DE CELDAS del arte final (la del usuario): cada animación es una LISTA de
  // celdas [fila, columna] de la matriz 8×8 (índices 0,0 → 7,7), con espejo opcional (andar
  // a la izquierda = las mismas casillas que a la derecha, volteadas). Si una animación no
  // está definida aquí, la hoja externa cae a las celdas de 'idle'; la procedural usa filas.
  animations: z
    .record(
      z.string(),
      z.object({
        cells: z.array(z.tuple([z.number().int().min(0).max(31), z.number().int().min(0).max(31)])).min(1),
        mirror: z.boolean().default(false),
        fps: z.number().positive().default(6),
        // Margen vacío bajo los pies DENTRO de la celda (px): ancla los pies al suelo por animación.
        groundMarginPx: z.number().min(0).max(128).default(0),
      }),
    )
    .default({}),
  // v1.48 — arquetipos que se representan SIEMPRE con su hoja (cualquier cámara y distancia):
  // el jugador. Los demás conservan el LOD rig↔hoja de v1.46.
  alwaysFor: z.array(z.string()).default([]),
  // v1.48 — lado del quad en metros (calibra el tamaño del personaje sprite; 1.6 por defecto).
  quadM: z.number().positive().default(1.6),
});

export type CharacterSpritesCatalogParsed = z.infer<typeof characterSpritesCatalogSchema>;
