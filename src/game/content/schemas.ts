import { z } from 'zod';
import type { ActivityDef, Condition, Effect } from '@/game/core/types';

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
    })
    .optional(),
  params: z.record(z.string(), paramDefSchema).optional(),
  container: z.object({ childKind: z.string(), layout: z.string() }).optional(),
  view: viewSchema,
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
      })
      .default({ spanW: 2, doorLocalX: -1.14, entryHalf: 0.45, laneFront: 0.35, laneBack: 1.05, flightRun: 2.19, landingX: 0.5, stepCount: 8, climbSpeed: 1.8 }),
    /** Ascensor creíble (v1.5, presentación): semáforo de permisos con llamadas, puertas que
     *  abren/cierran, espera al embarco y capacidad limitada. TODO en el catálogo, nada a pelo. */
    elevator: z
      .object({
        capacity: z.number().int().min(1).default(4),
        doorWaitMs: z.number().positive().default(5000),
        doorMoveMs: z.number().positive().default(700),
        floorsPerSecond: z.number().positive().default(1.4),
        cabinColor: z.string().default('#aeb8c2'),
        doorColor: z.string().default('#cbd5e1'),
        callColor: z.string().default('#ffd166'),
        brokenColor: z.string().default('#c1666b'),
        rideZ: z.number().default(0.35),
      })
      .default({ capacity: 4, doorWaitMs: 5000, doorMoveMs: 700, floorsPerSecond: 1.4, cabinColor: '#aeb8c2', doorColor: '#cbd5e1', callColor: '#ffd166', brokenColor: '#c1666b', rideZ: 0.35 }),
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
    /** Velocidad (m/s) a partir de la cual un actor en marcha usa el clip "run". */
    runSpeed: z.number().positive().default(4.2),
    /** Multiplicador de velocidad del jugador mientras corre (Shift / botón del mando). */
    runMultiplier: z.number().min(1).default(1.75),
    /** Anclas de actividad en las que el vecino se SIENTA (clip "sit") al llegar. */
    seatAnchors: z.array(z.string()).default(['bed', 'tv', 'desk']),
    roomZ: z.number(),
    depth: z.number(),
    commonDepth: z.number().default(1.4),
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
      z.object({ kind: z.literal('seq'), steps: z.array(soundStepSchema) }),
    ]),
  ),
  events: z.record(z.string(), z.array(z.string())),
});

export type SoundsCatalog = z.infer<typeof soundsCatalogSchema>;

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
