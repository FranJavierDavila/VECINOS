import type { StreetCatalog, SoundsCatalog, InteriorsCatalog } from '@/game/content/schemas';

// Re-exportados: los consumidores del contrato importan TODO desde aquí (types.ts es la
// única fuente de verdad; los esquemas Zod son su espejo de validación).
export type { StreetCatalog, SoundsCatalog, InteriorsCatalog };

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

/** Props de bloque EXTERIOR (v1.20): aceras, carreteras y jardines del decorado urbano. */
export interface ExteriorBlockView {
  height: number;
  /** Bordillo (v1.22): '' = sin bordillo. */
  curbColor: string;
  curbW: number;
  /** Paso de cebra (v1.22). */
  zebra: boolean;
  zebraColor: string;
  zebraStripeW: number;
  zebraGap: number;
  benchEvery: number;
  benchColor: string;
  benchLegColor: string;
  lampEvery: number;
  lampColor: string;
  lampHeadColor: string;
  lampH: number;
  binEvery: number;
  binColor: string;
  laneDash: number;
  laneDashColor: string;
  treesPer10m: number;
  bushesPer10m: number;
  /** Dispersión 2D con topes (v1.22) para jardines enormes. */
  gridScatter: boolean;
  maxTrees?: number;
  maxBushes?: number;
  flowerChance: number;
  trunkColor: string;
  leafColors: string[];
  bushColors: string[];
  flowerColors: string[];
  grassColor: string;
}

export interface BlockDef {
  id: string;
  /** Nombre visible para prompt/HUD. */
  label?: string;
  kind: 'common' | 'dwelling' | 'commercial' | 'infrastructure';
  layer: 'main' | 'corridor';
  size: { w: number; h: number };
  traversable?: boolean;
  alignGroup?: string;
  features?: { stairs?: boolean; elevator?: boolean; mailboxes?: boolean; noticeboard?: boolean; bench?: boolean; innerCorridor?: boolean };
  params?: Record<string, ParamDef>;
  container?: { childKind: string; layout: string };
  view: BlockView;
  /** Solo bloques del decorado exterior (v1.20): nunca se instancian en el sim. */
  exterior?: ExteriorBlockView;
}

export interface RoomDef {
  id: string;
  kind: 'room';
  /** Nombre visible en la interfaz (catálogo). */
  label?: string;
  size: { w: number; h: number };
  params?: Record<string, ParamDef>;
  /** Ranuras del editor de interiores: posición [x,z] local a la estancia, categoría y qué cabe en cada una. */
  furnitureSlots?: FurnitureSlotDef[];
  /**
   * Fijaciones interactivas de la estancia (portátil, cama…): pos [x,z] local al rect;
   * el jugador las usa por proximidad 2D y solo responden en su vivienda.
   */
  interactables?: { id: string; kind: 'laptop' | 'bed'; pos: [number, number] }[];
  /** Anclas de actividad de los vecinos (no interactivas): pos [x,z] local al rect de la estancia. */
  anchors?: { id: string; kind: string; pos: [number, number] }[];
  view: BlockView;
}

/** Vista placeholder de un mueble (greybox sustituible por arte final). Tamaño en metros [w, h, d]. */
export interface FurnitureView {
  color: string;
  size: [number, number, number];
}

/** Mueble del editor de interiores: precio, ranuras compatibles, emisiones y efectos de parámetros. */
export interface FurnitureDef {
  id: string;
  name: string;
  description: string;
  emoji?: string;
  price: number;
  /** Categorías de ranura compatibles (RoomDef.furnitureSlots[].kind). */
  slots: string[];
  /** Emisiones persistentes por canal. Valores negativos = absorben (p. ej. un difusor). */
  emits?: Record<string, number>;
  /** Deltas de parámetros aplicados al colocar (a la estancia si el parámetro vive ahí, si no al bloque). */
  params?: { param: string; delta: number }[];
  view: FurnitureView;
}

/** Minijuego tipo "barra de precisión": totalmente data-driven, el tipo vive en el catálogo. */
export interface MinigameTimingBarConfig {
  rounds: number;
  /** Velocidad del cursor (pasadas completas por segundo). */
  cursorSpeed: number;
  /** Ancho de las zonas buenas (fracción de la barra 0..1). */
  zoneWidth: number;
  /** Centros de las zonas buenas (0..1). */
  zones: number[];
  /** Aceleración del cursor por ronda (multiplicador). */
  accelPerRound: number;
  /** Intentos fallidos permitidos. */
  lives: number;
}

/** Minijuego tipo "secuencia" (Simón): memoriza y repite pads del catálogo. */
export interface MinigameTapSequenceConfig {
  /** Secuencias que hay que completar para ganar. */
  rounds: number;
  /** Etiquetas/emojis de los pads (el tablero sale del catálogo, no del código). */
  pads: string[];
  /** Longitud de la primera secuencia. */
  sequenceStart: number;
  /** Pads que crece la secuencia por ronda. */
  sequenceGrow: number;
  /** Duración del destello de cada pad (ms) y pausa entre pads (ms). */
  showMs: number;
  gapMs: number;
  /** Tiempo máximo para completar la repetición (ms). */
  inputTimeoutMs: number;
  /** Errores permitidos. */
  lives: number;
}

/** Minijuego tipo "reflejos": objetivos que aparecen y desaparecen (con señuelos opcionales). */
export interface MinigameReflexTargetsConfig {
  /** Aciertos necesarios para ganar. */
  targets: number;
  spawnIntervalMs: number;
  /** Tiempo que vive cada objetivo antes de escapar (ms). */
  targetLifeMs: number;
  /** Tamaño del objetivo como radio, % del ancho del tablero. */
  radiusPct: number;
  /** Objetivos que pueden escaparse antes de perder. */
  missesAllowed: number;
  /** Errores permitidos (tocar un señuelo). */
  lives: number;
  /** Emoji del objetivo y del señuelo (catálogo). */
  emoji: string;
  decoyEmoji?: string;
  /** Probabilidad (0..1) de que un spawn sea señuelo. */
  decoyChance?: number;
}

/** Minijuego tipo "parejas" (memoria): voltear fichas hasta emparejarlas todas. */
export interface MinigameMemoryPairsConfig {
  /** Un emoji por pareja: el mazo son dos copias barajadas de cada uno. */
  items: string[];
  /** Parejas fallidas permitidas. */
  lives: number;
}

export type MinigameType = 'timing_bar' | 'tap_sequence' | 'reflex_targets' | 'memory_pairs';

/**
 * Overrides numéricos de configuración de minijuegos, por escenario (QA/E2E: facilitar
 * el win-path sin tocar el catálogo de producción). Solo campos numéricos comunes;
 * los emojis/zonas/textos siguen saliendo del catálogo.
 */
export interface MinigameOverrides {
  cursorSpeed?: number;
  zoneWidth?: number;
  rounds?: number;
  lives?: number;
  accelPerRound?: number;
  inputTimeoutMs?: number;
  showMs?: number;
  gapMs?: number;
  sequenceStart?: number;
  sequenceGrow?: number;
  targets?: number;
  spawnIntervalMs?: number;
  targetLifeMs?: number;
  radiusPct?: number;
  missesAllowed?: number;
  decoyChance?: number;
}

export type MinigameConfig =
  | MinigameTimingBarConfig
  | MinigameTapSequenceConfig
  | MinigameReflexTargetsConfig
  | MinigameMemoryPairsConfig;

/** Unión discriminada por `type`: cada runner recibe su config ya estrechada. */
export type MinigameDef = {
  id: string;
  name: string;
  description: string;
  emoji?: string;
  /** Cómo se juega, en una frase (si falta, usa rules.minigames.introByType del catálogo). */
  instruction?: string;
  onSuccess: Effect[];
  onFail: Effect[];
} & (
  | { type: 'timing_bar'; config: MinigameTimingBarConfig }
  | { type: 'tap_sequence'; config: MinigameTapSequenceConfig }
  | { type: 'reflex_targets'; config: MinigameReflexTargetsConfig }
  | { type: 'memory_pairs'; config: MinigameMemoryPairsConfig }
);

export interface LayoutDef {
  id: string;
  rooms: {
    key: string;
    defId: string;
    startsUnlocked: boolean;
    /** Rect de la estancia en metros locales a la vivienda (x desde pared izquierda, z desde plano frontal). */
    rect?: { x: number; z: number; w: number; d: number };
  }[];
  /** Huecos en los tabiques entre pares de estancias (Fase C). */
  doorways?: { a: string; b: string; axis: 'x' | 'z'; at: number; width: number }[];
}

export interface InfluenceRule {
  id: string;
  channel: string;
  /** Etiqueta y emoji para la interfaz (catálogo, no código). */
  label?: string;
  emoji?: string;
  spread: Partial<Record<Direction, number>>;
  attenuatedBy?: string;
  decayPerTick: number;
  threshold: number;
  onThreshold?: {
    emitEvent: string;
    /** Texto para el registro de la interfaz, con {block} como marcador. Si uiLog, la UI lo muestra. */
    message?: string;
    tone?: 'info' | 'good' | 'bad';
    uiLog?: boolean;
    setParam?: { param: string; delta: number };
  };
}

/** Ranura de amueblado de una estancia (editor de interiores). Posición en unidades de estancia. */
export interface FurnitureSlotDef {
  id: string;
  /** Categoría de ranura: los muebles declaran qué categorías encajan (furniture.slots). */
  kind: string;
  /** [x, z] en metros locales a la estancia (rect del layout); y opcional = altura de anclaje. */
  pos: [number, number];
  y?: number;
}

/** Pistas de vista para el renderer: color, complemento y accesorio del personaje. */
export interface ArchetypeView {
  color: string;
  accent: string;
  hat: 'cap' | 'bun' | 'sunglasses' | 'headphones' | 'none';
  prop: 'binoculars' | 'guitar' | 'briefcase' | 'cart' | 'spray' | 'phone' | 'none';
  height: number;
}

/** Ventana horaria de una actividad (HH:MM; si `to` ≤ `from`, cruza medianoche). */
export interface ScheduleWindow {
  from: string;
  to?: string;
  /** Probabilidad por tick de elegir la actividad mientras la ventana está abierta. */
  chance?: number;
  days?: 'all' | 'even' | 'odd';
}

/** Actividad de un arquetipo: qué emite, dónde ocurre, cuándo (schedule) y qué dice. */
export interface ActivityDef {
  /** Etiqueta para el registro de la interfaz (con emoji si procede). */
  label?: string;
  /** Destino: sitio nominal o `def:<blockDefId>` (p. ej. def:local_comercial → el bar del bajo). */
  at?: 'home' | 'corridor' | 'core' | 'stairs' | 'out' | `def:${string}`;
  /** Kind de ancla de estancia donde ocurre (cama, tv, stove…): vida interior de los vecinos. */
  anchor?: string;
  say?: string[];
  emits?: Record<string, number>;
  schedule?: ScheduleWindow[];
  /** Efectos aplicados una vez al empezar la actividad (p. ej. pintar la cabina). */
  onStart?: Effect[];
}

export interface ArchetypeDef {
  id: string;
  name: string;
  tagline: string;
  traits: Partial<{ gossip: number; sociability: number; tidiness: number; noisiness: number; generosity: number; mischief: number }>;
  /** Sesgo propio en las votaciones de junta (p. ej. el presidente vota que sí). */
  voteBias?: number;
  needs: string[];
  activities: Record<string, ActivityDef>;
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

// ───────────────────────── Cutscenes (Fase D) ─────────────────────────

/**
 * Punto de escenario de una cutscene. `block` acepta ids literales y referencias
 * (`$home`, `$entry`, `$event.block`); `at` elige el punto del bloque.
 */
export interface CutsceneSpot {
  block: string;
  at: 'door' | 'center';
}

/**
 * Beat de cutscene: la unión mínima para teatralizar misiones. Todo lo temporal
 * es opcional y cae a rules.cutscene (defaults del catálogo).
 */
export type CutsceneBeat =
  /** Cámara: vuela al encuadre (edificio entero, jugador o bloque) y aguanta `hold` s. */
  | { type: 'cam'; focus: 'wide' | 'player' | CutsceneSpot; viewH?: number; hold?: number }
  /** Actor: se coloca en `from` (si hay) y anda hasta `to` por pozo/interior (nunca teletransporta).
   *  Mientras camina, la cámara le SIGUE (travelling); viewH ajusta lo cerrado del plano. */
  | { type: 'walk'; who: string; from?: CutsceneSpot; to: CutsceneSpot; max?: number; viewH?: number }
  /** Subtítulo cinematográfico con marcadores {resident} y {block}. */
  | { type: 'line'; speaker?: string; text: string; seconds?: number; who?: string; gesture?: string }
  /** Pausa teatral. */
  | { type: 'wait'; seconds: number }
  /** Sonido del catálogo procedural (sounds.json). */
  | { type: 'sound'; id: string };

/**
 * Cutscene data-driven (Fase D): teatro de presentación sobre eventos del sim.
 * El trigger filtra por tipo de evento y (opcional) misión/paso; el resto es secuencia
 * de beats. Cero lógica de juego: al acabar, el mundo sigue exactamente igual.
 */
export interface CutsceneDef {
  id: string;
  trigger: { on: 'neighbor_arrived' | 'mission_activated' | 'step_started' | 'step_completed' | 'mission_completed' | 'mission_failed'; mission?: string; step?: string };
  beats: CutsceneBeat[];
}

// ───────────────────── Bocadillos de expresión (v1.10) ─────────────────────

/**
 * Catálogo de bocadillos (public/content/emotes.json): qué expresión muestra cada
 * personaje sobre su cabeza según su estado — ánimo, actividad, gesto social o eventos
 * del sim. 100% data-driven: el código de presentación solo recita este catálogo.
 */
export interface EmotesCatalog {
  /** Ajustes visuales del bocadillo (proyección, tamaño y ritmo de decisión). */
  bubble: {
    /** Altura del bocadillo sobre la cabeza (m). */
    offsetY: number;
    /** Tamaño del glifo en píxeles CSS. */
    sizePx: number;
    /** Distancia máxima a la cámara (m) para mostrar el bocadillo. */
    maxDistance: number;
    /** Duración de la animación de aparición (ms). */
    popMs: number;
    /** Cadencia de reevaluación del estado (ms): amortigua parpadeos del sim. */
    decisionMs: number;
    /** Vista EDIFICIO (v1.17, opcional): tope de glifos visibles en el plano general —
     *  el edificio entero no se convierte en una sopa de emoticonos. El texto (`say`) se
     *  calla siempre en esa vista. */
    buildingMaxGlyphs?: number;
  };
  /**
   * Bocadillos con TEXTO (v1.15, opcional): las actividades con líneas `say` del arquetipo
   * se dicen en un bocadillo legible sobre la cabeza, ciclando por sus líneas
   * (decir → silencio con glifo → línea siguiente → pausa larga). Sin esta sección,
   * los bocadillos son solo glifos (v1.10).
   */
  speech?: {
    /** Segundos que se muestra cada línea. */
    lineSeconds: number;
    /** Segundos de silencio entre líneas (luce el glifo). */
    gapSeconds: number;
    /** Pausa larga tras decir todas las líneas antes de repetir el ciclo. */
    cycleGap: number;
    /** Ancho máximo del bocadillo de texto (px CSS). */
    maxPx: number;
    /** Tamaño de letra del texto (px CSS). */
    fontSizePx: number;
  };
  /** Qué necesidades componen el "ánimo" (media ponderada 0..100) y con qué peso. */
  mood: { needs: Record<string, number> };
  /** Emotes por banda de ánimo: gana el de mayor prioridad cuyo rango [min,max] contenga el ánimo (rangos abiertos si falta min/max). */
  moods: { id: string; glyph: string; priority: number; label?: string; min?: number; max?: number }[];
  /** Emote por actividad del arquetipo (id de actividad → glifo). Las no listadas no muestran bocadillo. */
  activities: { id: string; glyph: string; priority: number; label?: string }[];
  /** Emote por gesto social en curso (stateAnimations: talk/laugh/argue/phone…). */
  gestures: { id: string; glyph: string; priority: number; label?: string }[];
  /** Emotes temporales por evento del sim (bocadillo que aparece y expira solo). */
  events: {
    /** Tipo de evento del sim (p. ej. stairs_grumble, knock_result). */
    on: string;
    glyph: string;
    priority: number;
    /** A quién le aparece: el residente del evento, el jugador, o los vecinos del bloque. */
    who: 'resident' | 'player' | 'blockResidents';
    /** Segundos que dura el bocadillo. */
    seconds: number;
    /** Glifo alternativo si un campo del evento es truthy (p. ej. asleep en knock_result). */
    altGlyph?: { when: string; glyph: string };
    /** Enfriamiento por residente y emote (s): evita bocadillos en cadena del mismo evento. */
    cooldown?: number;
  }[];
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
  /** Overrides de dificultad de minijuegos para este escenario (QA/E2E). */
  minigameOverrides?: Record<string, MinigameOverrides>;
  /** Ajustes de multijugador del escenario (invitados); si falta, usa rules.multiplayer. */
  multiplayer?: { guestArchetype?: string; guestWallet?: number };
}

// ───────────────────── Manifiesto de assets (arte final) ─────────────────────

/**
 * Entrada de modelo 3D para un arquetipo (personaje). Fichero glTF 2.0 con clips de
 * animación por nombre. El greybox (cápsula) es el fallback cuando no hay entrada o falla la carga.
 */
export interface ActorAssetDef {
  /** Ruta del fichero relativa al `base` del manifiesto (.gltf/.glb). */
  model: string;
  /** Altura nominal con la que se authoró el modelo (metros). El runtime escala a ArchetypeView.height. */
  nominalHeight: number;
  /** Clips de animación del fichero, por nombre lógico → nombre del clip en el fichero. */
  animations?: Record<string, string>;
  /** Clip lógico por defecto cuando el residente no hace nada visible (normalmente "idle"). */
  defaultAnimation?: string;
  /** Clip lógico mientras el residente se desplaza (normalmente "walk"). */
  walkAnimation?: string;
  /** Clip lógico por actividad del arquetipo (p. ej. paint_cabin → "spray"). */
  activityAnimations?: Record<string, string>;
  /** Clip lógico por estado social (run/talk/laugh/argue/phone/sit): gestos de diálogo,
   *  teléfono, cutscenes y sentado en anclas; si falta un clip, el rig cae al default. */
  stateAnimations?: Record<string, string>;
}

/** Entrada de modelo 3D para un tipo de bloque. El runtime lo escala a las dimensiones reales de la celda. */
export interface BlockAssetDef {
  model: string;
  /** Dimensiones nominales del modelo (metros): el modelo se authora a este tamaño y se escala a la celda. */
  nominal: { w: number; h: number; d: number };
  /** 0..1: cuánto se tiñe el modelo con el color de estado (roto/cerrado/vacío) en paint(). */
  tintStrength?: number;
  /**
   * Ancho visual en CELDAS (v1.4, cubo de escalera): el modelo se escala a spanW·cellW−gapW
   * y se ancla al borde izquierdo de la celda lógica (sobresale por la derecha del edificio).
   * Default = el ancho del bloque (sin span).
   */
  spanW?: number;
  /**
   * Overlay: el modelo DECORA sin sustituir la caja greybox (no se oculta nada, el edge de
   * vivienda del jugador se conserva). Pensado para marcos de puerta sobre el corte interior.
   */
  overlay?: boolean;
  /**
   * Clonar materiales por instancia (default true): cada bloque pinta su tinte de estado y su
   * glow de canales SIN contaminar a los hermanos del mismo tipo. false = materiales compartidos.
   */
  cloneMaterials?: boolean;
}

/** Manifiesto del arte final (public/content/assets.json). Opcional: sin él, greybox puro. */
export interface AssetsCatalog {
  /** Base de las rutas de modelos (p. ej. "/assets/"). */
  base: string;
  /** Modelos por arquetipo. */
  actors?: Record<string, ActorAssetDef>;
  /** Modelos por definición de bloque. */
  blocks?: Record<string, BlockAssetDef>;
}

// ───────────────────────── Ecosistema del edificio (v1.14) ─────────────────────────

/**
 * Catálogo de "El edificio está vivo" (public/content/ecosystem.json). El cerebro puro
 * (src/game/ecosystem.ts) evalúa eventos a cadencia y aplica consecuencias SOLO a través
 * del motor de efectos del sim; la capa visual ejecuta el staging del report.
 * Cero datos de gameplay en código: pesos, ventanas, umbrales y colores viven aquí.
 */

/** Estados de una misión tal como los ve el ecosistema ('none' = no existe en el mundo). */
export type EcosystemMissionState = 'none' | 'active' | 'awaiting_choice' | 'done' | 'failed';

/**
 * Condición del ecosistema. `when` de eventos y outcomes es la lista de estas condiciones
 * (todas deben cumplirse). Las condiciones son DEL CEREBRO: nunca amplían el sim.
 */
export type EcosystemWhen =
  | { weather: Weather | Weather[]; not?: boolean }
  | { paramAbove: { block: string; param: string; value: number } }
  | { paramBelow: { block: string; param: string; value: number } }
  | { fundsAbove: number }
  | { fundsBelow: number }
  | { moodAbove: number }
  | { moodBelow: number }
  | { residentPresent: string }
  | { missionState: { mission: string; state: EcosystemMissionState } };

/** Rama ponderada de un evento: impredecibilidad declarada en JSON (pesos, no código). */
export interface EcosystemOutcome {
  id: string;
  /** Peso del sorteo ponderado (relative, 0..∞). */
  weight: number;
  /** Condiciones extra que debe cumplir SOLO esta rama para ser sorteable. */
  when?: EcosystemWhen[];
  /** Vocabulario Effect EXACTO del sim (setParam/unlock/addFunds/startMission/toast…). */
  effects: Effect[];
  /** Texto de aviso vecinal aplicado como efecto toast (tono info). */
  toast?: string;
}

/** Configuración de un evento `vendor`: extra que entra y llama a N puertas. */
export interface EcosystemVendorEvent {
  /** Arquetipo del vendedor (modelo en assets.actors o cápsula de fallback). */
  archetype: string;
  /** Puertas que llama por visita (se recortan a las disponibles de la planta). */
  doors: number;
  /** Sorteo PONDERADO POR CADA LLAMADA: los efectos se aplican al instante (autoridad del sim). */
  perKnockOutcomes: EcosystemOutcome[];
}

/** Configuración de un evento `pet`: la mascota vive mientras su misión esté abierta. */
export interface EcosystemPetEvent {
  /** Misión "mascota perdida" que el cerebro arranca (reach/enter declara el bloque). */
  mission: string;
}

/** Configuración de un evento `blackout`: apagón nocturno con restauración garantizada. */
export interface EcosystemBlackoutEvent {
  /** Duración sorteada del apagón en minutos de juego. */
  durationMinutes: { min: number; max: number };
  /** Bloque (id o defId) del pasillo cuyo param de luz se apaga. */
  corridorBlock: string;
  /** Param de iluminación del pasillo (autoridad del sim). */
  lightingParam: string;
  /** Valor de catálogo al que se restaura al expirar. */
  restoreTo: number;
  /** Aviso al restaurar la luz. */
  restoreToast: string;
}

export type EcosystemEventKind = 'vendor' | 'prank' | 'pet' | 'blackout' | 'drift';

export interface EcosystemEvent {
  id: string;
  kind: EcosystemEventKind;
  /** Peso entre eventos candidatos de la misma evaluación. */
  weight: number;
  /** Ticks que el evento queda en silencio tras dispararse. */
  cooldownTicks: number;
  /** Ventana horaria (minutos del reloj del mundo; `to` ≤ `from` cruza medianoche). */
  window?: { from: string; to: string };
  /** Probabilidad por evaluación (0..1) una vez pasados cooldown/ventana/when. */
  chance?: number;
  /** Condiciones (todas) que deben cumplirse para que el evento sea candidato. */
  when?: EcosystemWhen[];
  vendor?: EcosystemVendorEvent;
  pet?: EcosystemPetEvent;
  blackout?: EcosystemBlackoutEvent;
  /** Ramas ponderadas (prank/drift/pet/blackout); vendor usa perKnockOutcomes. */
  outcomes?: EcosystemOutcome[];
}

/** Regla de deterioro visual: lee params REALES del world y pinta decals cuando se cumplen. */
export interface EcosystemDeteriorationRule {
  id: string;
  /** defId de bloque (todas sus instancias se vigilan). */
  blockDef: string;
  /** Param del bloque que hace de verdad (condition, cleanliness, humidity, soot…). */
  param: string;
  /** La regla se cumple si el param baja de `below` o sube de `above`. */
  below?: number;
  above?: number;
  /** Tipo de decal y su teatro (posición determinista por hash). */
  kind: 'cracks' | 'dirt' | 'damp' | 'soot';
  color: string;
  opacity: number;
  count: number;
  w: number;
  h: number;
}

/** Catálogo del ecosistema. Opcional: sin el fichero, la partida funciona igual (patrón emotes). */
export interface EcosystemContent {
  schemaVersion: 1;
  scheduler: {
    /** Ticks entre evaluaciones del cerebro. */
    evalEveryTicks: number;
  };
  extras: {
    /** Velocidad de crucero de los extras (vendedor), m/s. */
    walkSpeed: number;
    /** Segundos de pausa teatral al llamar a una puerta. */
    vendor: { knockPauseSec: number; floors: number[] };
    /** Mascota: paseo, pausas, manchas y cuerpecito (todo del catálogo). */
    pet: {
      walkSpeed: number;
      strollSeconds: number;
      pauseSeconds: number;
      stainFadeSec: number;
      stainW: number;
      stainH: number;
      stainOpacity: number;
      color: string;
      bodyW: number;
      bodyH: number;
      headScale: number;
    };
  };
  lights: {
    color: string;
    nightIntensity: number;
    blackoutOccupiedIntensity: number;
    dayIntensity: number;
    /** El param lighting del pasillo manda: por debajo de este umbral, lámpara apagada. */
    paramThreshold: number;
    /** Lamparitas por bloque de pasillo. */
    lampsPerCorridor: number;
    /** Tamaño (w,h,d en m) de cada lamparita. */
    lampSize: [number, number, number];
    /** v1.21: de noche, luz solo si la instalación funciona Y hay vecinos en el pasillo. */
    nightRequiresPresence: boolean;
  };
  mood: {
    /** Pesos de necesidades para la media de ánimo de los residentes presentes. */
    needs: Record<string, number>;
  };
  visuals: {
    /** Segundos entre comprobaciones de deterioro (la creación de decals es perezosa). */
    checkSeconds: number;
    deterioration: EcosystemDeteriorationRule[];
  };
  events: EcosystemEvent[];
}

// ───────────────────────── Logros tipo Steam (v1.17, opcional) ─────────────────────────

/**
 * Catálogo de logros (public/content/achievements.json). Perfil de jugador al estilo Steam:
 * los desbloqueos se guardan en el navegador (localStorage) y sobreviven a las partidas.
 * El evaluador es una función PURA (src/game/support/achievements.ts) sobre un snapshot del
 * mundo; el catálogo solo declara nombres, descripciones y la condición de cada logro.
 */

/** Condición de desbloqueo: unión discriminada por `kind` (semántica >= salvo elevator_ok). */
export type AchievementCondition =
  | { kind: 'mission_done'; mission: string }
  | { kind: 'missions_done'; count: number }
  | { kind: 'wallet'; amount: number }
  | { kind: 'funds'; amount: number }
  | { kind: 'reputation'; amount: number }
  | { kind: 'day'; count: number }
  | { kind: 'relation'; affinity: number }
  | { kind: 'elevator_ok' };

export interface AchievementDef {
  id: string;
  /** Emoji que lucen tarjeta y popup. */
  icon: string;
  name: { es: string; en: string };
  desc: { es: string; en: string };
  /** Oculto: bloqueado se pinta como "???" con descripción genérica. */
  hidden?: boolean;
  condition: AchievementCondition;
}

export interface AchievementsCatalog {
  version: 1;
  achievements: AchievementDef[];
}

/** Charla de cruce (v1.20): un tema de conversación entre dos vecinos que se cruzan. */
export interface CrossingTopic {
  id: string;
  /** Líneas alternas: impar habla A, par habla B. {a}/{b} = nombres visibles. */
  lines: string[];
}

/** Catálogo de charlas de cruce (v1.20, opcional): cuando dos vecinos se cruzan, puede
 *  que paren a charlar (o no) según su ánimo; los temas y el ritmo viven en el JSON. */
export interface CrossingsCatalog {
  cadence: {
    checkEvery: number;
    residentCooldown: number;
    pairCooldown: number;
    lineSeconds: number;
    holdAfter: number;
  };
  proximity: { distance: number; maxConcurrent: number };
  chance: { base: number; goodMoodBonus: number; badMoodPenalty: number };
  mood: { goodMin: number; okMin: number; needs: Record<string, number> };
  /** Temas por cubo de ánimo; al cruzarse se elige el grupo del ánimo medio. */
  groups: { id: string; mood: 'good' | 'ok' | 'bad'; topics: CrossingTopic[] }[];
}

export interface Content {
  rules: Rules;
  blocks: Record<string, BlockDef>;
  rooms: Record<string, RoomDef>;
  layouts: Record<string, LayoutDef>;
  influences: Record<string, InfluenceRule>;
  archetypes: Record<string, ArchetypeDef>;
  missions: Record<string, MissionDef>;
  dialogs: Record<string, DialogDef>;
  templates: Record<string, TemplateDef>;
  scenarios: Record<string, ScenarioDef>;
  furniture: Record<string, FurnitureDef>;
  minigames: Record<string, MinigameDef>;
  /** Cutscenes de misión (Fase D): teatro de presentación data-driven. */
  cutscenes: Record<string, CutsceneDef>;
  /** Bocadillos de expresión (v1.10, opcional): emotes por ánimo/actividad/gesto/evento. */
  emotes?: EmotesCatalog;
  /** Manifiesto de arte final (opcional): modelos glTF por arquetipo/bloque con fallback greybox. */
  assets?: AssetsCatalog;
  /** Ecosistema del edificio (v1.14, opcional): eventos vivos, luces y deterioro visual. */
  ecosystem?: EcosystemContent;
  /** Logros tipo Steam (v1.17, opcional): perfil persistente; sin catálogo no hay logros. */
  achievements?: AchievementsCatalog;
  /** Charlas de cruce (v1.20, opcional): humor vecinal cuando dos vecinos se cruzan. */
  crossings?: CrossingsCatalog;
  /** La calle vive (v1.22, opcional): manifestaciones con humor y reacciones vecinales. */
  street?: StreetCatalog;
  /** Catálogo procedural de sonido (v1.22, espejo del que carga audio.ts): el módulo de
   *  voces de proximidad lee su sección `voices`; también lo valida el QA. */
  sounds?: SoundsCatalog;
  /** Dioramas interiores (v1.23, opcional): arte por tipo de estancia para los billboards
   *  con paralaje; sin catálogo, los interiores siguen greybox. */
  interiors?: InteriorsCatalog;
}

// ───────────────────────── Reglas y ajustes (catálogo rules.json) ─────────────────────────

/**
 * Hoja de balance y configuración de presentación. CERO números de gameplay en código:
 * todo lo tunable vive aquí y se recarga con el resto del contenido.
 */
/** Nivel de LOD (nivel de detalle): a partir de `dist` (en metros del foco) se oculta lo marcado. */
export interface LodLevel {
  dist: number;
  hide: ('edges' | 'glow' | 'panels')[];
}

export interface Rules {
  /** Escenario con el que arranca el juego por defecto. */
  startScenario: string;
  /** Multijugador: creación de invitados y textos de la sesión (todo data-driven). */
  multiplayer: {
    /** Arquetipo con el que nace un jugador invitado. */
    guestArchetype: string;
    /** Cartera inicial de un invitado. */
    guestWallet: number;
    /** Máximo de jugadores humanos por sesión (incluido el anfitrión). */
    maxPlayers: number;
    /** Segundos reales por tick de juego en el servidor autoritativo. */
    tickSecondsPerTick: number;
    /** Aviso al unirse un invitado ({name} y {block} como marcadores). */
    joinToast: string;
    /** Aviso cuando un invitado se desconecta ({name}). */
    leaveToast: string;
    texts: { sessionFull: string; noVacant: string; remoteSaveDisabled: string };
  };
  sim: {
    /** Ventana nocturna: si existe actividad "sleep", se impone durante esta ventana. */
    night: ScheduleWindow;
    aiHopTicks: number;
    missionLoopMax: number;
    defaultNeeds: Record<string, number>;
    economy: {
      rentMinute: string;
      corridorDirtParam: string;
      corridorDirtPerTick: number;
      needDrift: Record<string, { base: number; activity: Record<string, number> }>;
    };
    work: { pay: number; cooldownTicks: number; funCost: number; toastCooldown: string; toastDone: string };
    knock: { affinityGain: number; asleepLine: string; fallbackLines: string[] };
    /** Siesta (comando `sleep`): necesidades restauradas (delta con tope 100) y su texto. */
    sleep: { restore: Record<string, number>; toastDone: string };
    weather: { cycle: { state: Weather; weight: number }[]; durationMinutes: { min: number; max: number } };
    junta: {
      baseYes: number;
      affinityDivisor: number;
      generosityFactor: number;
      defaultGenerosity: number;
      moodThreshold: number;
      moodPenalty: number;
      clamp: { min: number; max: number };
    };
    /** Campaña de presidencia (v1.18, presentación/support): HUD del mandato y agenda
     *  convicable desde el tablón. El sim no la consume. */
    campaign?: {
      termMission: string;
      endMission: string;
      termDays: number;
      presidentLabel: string;
      convocationCooldownMinutes: number;
      presetAgenda: { id: string; title: string; description: string; cost: number; effects: Effect[] }[];
    };
    /** Malestar vecinal con el ascensor averiado (v1.5): coste social por tramo de escalera
     *  forzada y resoplido público ocasional (evento stairs_grumble con texto del catálogo). */
    elevator: { stairsMoodCost: number; grumbleChance: number; grumbleCooldownMinutes: number; grumbleText: string };
  };
  /** Configuración de la presentación placeholder (greybox). El arte final la sustituirá. */
  view: {
    cellW: number;
    cellH: number;
    walkSpeed: number;
    roomSpeed: number;
    stairsSeconds: number;
    elevatorSeconds: number;
    margin: number;
    nearRadius: number;
    /** @deprecated sustituido por interactables del catálogo de estancias (Fase C). */
    laptopOffset?: number;
    /** @deprecated sustituido por interactables del catálogo de estancias (Fase C). */
    bedOffset?: number;
    itemRadius: number;
    corridorZ: number;
    /** Calado del pasillo exterior (tiras transitables): saliente hacia la calle. */
    corridorDepth: number;
    /** Altura de la barandilla del pasillo (0 = sin barandilla). */
    corridorRail: number;
    /** Velocidad de crucero de los vecinos (IA) en m/s: la interpolación nunca "teletransporta". */
    npcWalkSpeed: number;
    /** Segundos entre deambulaciones de un vecino en casa sin ancla de actividad (vida interior). */
    npcWanderSeconds: number;
    /** Suavizado del giro del actor hacia su dirección de movimiento (rad/s, 2.5D creíble). */
    actorTurnSpeed: number;
    /** Anti-patinaje (v1.3): velocidad natural de los clips (m/s al ratio 1) y límites del playback. */
    animSync: { walkRefSpeed: number; runRefSpeed: number; minRate: number; maxRate: number };
    /** Escalera de vecinos (v1.4): geometría compartida por la authoría glTF y el runtime
     *  (src/game/stairs.ts). El cubo visual ocupa spanW celdas; la celda lógica queda a la izquierda. */
    stairs: {
      spanW: number;
      doorLocalX: number;
      entryHalf: number;
      laneFront: number;
      laneBack: number;
      flightRun: number;
      landingX: number;
      stepCount: number;
      climbSpeed: number;
      /** Forjado interior continuo del cubo (v1.18): losa a nivel de entrada en cada planta. */
      floorSlab: { enabled: boolean; thickness: number; color: string; topAt: number };
      /** v1.24 — acceso a la escalera DE VERDAD: muro frontal alrededor de la puerta (antes
       *  flotaba sin pared), hoja con arte de zonas comunes + número de planta grande negro
       *  centrado (vinculado a la hoja: bascula al abrirse), bisagras en el lado izquierdo
       *  visto desde el pasillo, y apertura automática al acercarse alguien a entrar/salir. */
      facade: {
        enabled: boolean;
        halfW: number;
        /** v1.26: muro frontal del CUBO COMPLETO — barandillas/peldaños ya no se ven
         *  "a través de la pared" por los laterales abiertos. */
        fullWall?: boolean;
        color: string;
        doorW: number;
        doorH: number;
        doorBottom: number;
        doorZ: number;
        wallT: number;
        art: string;
        numberColor: string;
        hinge: 'left' | 'right';
        openAngle: number;
        openAhead: number;
        openSpeed: number;
        /** v1.27 — VENTANAL del cubo: banda de cristal en el muro frontal (se ve subir y
         *  bajar a los vecinos y la luz), montantes finos delante del vidrio y muro trasero
         *  opcional que cierra el fondo del cubo. */
        window?: {
          enabled: boolean;
          sill: number;
          head: number;
          color: string;
          alpha: number;
          mullions: number;
          mullionW: number;
          frameColor: string;
          rear: boolean;
        };
        /** v1.25: nodos de la authoría glTF que sobran (p. ej. el hueco oscuro viejo). */
        hideNodes?: string[];
      };
      /** v1.24 — iluminación COMPARTIDA de todos los cubos de escalera: de noche se enciende
       *  si algún vecino se mueve por las escaleras (materiales de los sellos de luz del arte).
       *  v1.25: `wallGlow` ilumina TAMBIÉN los materiales del propio cubo (autoiluminación
       *  como en los interiores de vivienda — antes solo brillaba la bombilla). */
      activityLight: {
        enabled: boolean;
        dayCutoff: number;
        glow: number;
        fade: number;
        meshes: string[];
        color: string;
        wallGlow?: number;
      };
    };
    /** Ascensor creíble (v1.5, presentación): llamadas, puertas, espera y capacidad (src/game/client/elevator.ts). */
    elevator: {
      capacity: number;
      doorWaitMs: number;
      doorMoveMs: number;
      floorsPerSecond: number;
      /** Aceleración de cabina (plantas/s², v1.12): perfil trapezoidal del viaje según distancia. */
      accelFloorsPerSecond2: number;
      cabinColor: string;
      doorColor: string;
      /** v1.25: arte full-bleed de las hojas del ascensor (la partida central del arte cae
       *  entre las dos hojas: cada una recibe su mitad). Vacío = color plano. */
      doorArt?: string;
      callColor: string;
      brokenColor: string;
      rideZ: number;
    };
    /** Velocidad (m/s) a partir de la cual un actor en marcha usa el clip "run". */
    runSpeed: number;
    /** Multiplicador de velocidad del jugador mientras corre (Shift / botón del mando). */
    runMultiplier: number;
    /** Anclas de actividad en las que el vecino se SIENTA (clip "sit") al llegar. */
    seatAnchors: string[];
    /** Cartel numerado sobre cada puerta de vivienda (v1.6). */
    plaque: { w: number; h: number; y: number; z: number; bg: string; text: string; fontPx: number };
    /** Trasteros por planta (v1.16): estanterías a ambos lados numeradas con la vivienda
     *  propietaria; reparto secuencial (planta, columna) — building.ts levanta la nave. */
    trasteros: {
      shelvesPerLevel: number;
      margin: number;
      bayW: number;
      frontTiers: number;
      backTiers: number;
      tierH: number;
      shelfD: number;
      plankT: number;
      postW: number;
      junkChance: number;
      floorJunk: number;
      wood: string;
      woodDark: string;
      junk: string[];
      emptyLabel: string;
      ownBg: string;
      ownText: string;
      plaqueW: number;
      plaqueH: number;
      /** Tabiques divisorios entre trasteros (v1.17): panel lateral algo más alto que la
       *  unidad, para que cada ranura se lea como trastero propio. */
      partitionExtra: number;
      partitionColor: string;
      /** Cabecera de cartel sobre la fachada de cada estantería (v1.17): el cartel numerado
       *  se monta en la propia estantería, no flotando. 0 = sin cabecera. */
      headerH: number;
      /** ── Bloques por columna (v1.18): una planta de trasteros por letra, pasillo central,
       *  impares a un lado y pares al otro, compartimentos cerrados, profundidad ×factor. */
      blockDepthFactor: number;
      corridorW: number;
      wallT: number;
      doorW: number;
      doorH: number;
      unitH: number;
      doorColor: string;
      /** Puerta dorada del trastero del propio jugador (v1.19). */
      ownDoorColor: string;
      oddSide: 'left' | 'right';
      blockDefId: string;
      /** Interior presentable de la celda propia (v1.19, apilamiento 3D de bloques). */
      cellRoomDepth: number;
      cellShelfTiers: number;
      cellJunk: number;
      /** Cartel guía exterior sobre el hueco del pasillo central (v1.19): qué trasteros
       *  tienes a cada lado según la profundidad del pasillo en la que caminas. */
      guide: { w: number; h: number; aboveUnit: number; bg: string; text: string; frame: string };
    };
    /** Tejadillo a dos aguas que cierra el edificio (v1.16) sobre la bajocubierta. */
    roof: { pitchH: number; overhang: number; color: string; ridge: string; fascia: string };
    /** Macetas en los pasillos (v1.16): cantidad por planta determinista y colores.
     *  v1.25: recortes billboard (`artH` del recorte dibujado a canvas). */
    pots: {
      perFloorMin: number;
      perFloorMax: number;
      potColor: string;
      soilColor: string;
      plantColor: string;
      plant2Color: string;
      potR: number;
      potH: number;
      art?: string[];
      artH?: number;
      /** v1.26: radio libre delante de cada puerta — nunca una maceta tapando un acceso. */
      doorClearance?: number;
    };
    /** Privacidad de viviendas (v1.17): el interior solo se ve con alguien dentro; vacía,
     *  la fachada se cierra con su puerta al pasillo (propietario, visita… o un ladrón).
     *  v1.24: la puerta es un PLANO con arte real + marco 3D pequeño del color de la puerta
     *  + aplique de luz a un lado; la placa numerada queda por ENCIMA del marco (sin taparse).
     *  `hideNodes` retira del modelo glTF overlay la decoración de puerta antigua. */
    privacy: {
      enabled: boolean;
      doorColor: string;
      handleColor: string;
      doorW: number;
      doorH: number;
      doorArts?: string[];
      frameW?: number;
      frameDepth?: number;
      hideNodes?: string[];
      /** v1.26 — relleno de las juntas entre bloques (mismo color de pared), corte del
       *  zócalo en las puertas y tapa de estancia cerrada con ARTE DE PUERTA.
       *  v1.27 — protrude/stagger anti-coplanaridad + SOLERA en la base de los bloques. */
      gapFill?: { color: string; pad: number; protrude?: number; stagger?: number };
      solera?: { color: string; h: number; protrude?: number; stagger?: number };
      skirtingDoorGap?: boolean;
      coverArt?: string;
      /** v1.25 — acabado de la vivienda: pared gris clarito, zócalo gris y marcos del
       *  color del zócalo (continuidad visual); candado DIBUJADO (nada de cajas) y
       *  luces nocturnas de interiores parametrizadas. */
      wallColor?: string;
      skirtingColor?: string;
      skirtingH?: number;
      lockArt?: string;
      lockW?: number;
      lockH?: number;
      night?: { dayCutoff: number; dioGlow: number; floorGlow: number; lampGlow: number };
      lamp?: { side: -1 | 1; dx: number; dy: number; color: string; glowColor: string };
    };
    roomZ: number;
    /** Calado (profundidad en Z) de las viviendas: doblado en v0.6-b para mobiliario interior. */
    depth: number;
    /** Módulo de profundidad (v1.19): TODOS los bloques crecen 1 módulo hacia el fondo. */
    depthModule: number;
    /** Apilamiento 3D de bloques (v1.19): activación de bloques traseros con fundido del
     *  precedente y contorno rojo en el perímetro frontal del bloque activo. */
    rearBlock: {
      outline: string;
      outlineWidth: number;
      fadeSeconds: number;
      peekSeconds: number;
      peekDistance: number;
      junk: number;
      lampColor: string;
      /** Ventana al fondo del bloque trasero (v1.21): marco + cristal que asoma al paisaje. */
      window: { w: number; h: number; sill: number; frame: string; glass: string; glassAlpha: number };
    };
    /** Calado de los bloques comunes (portal, núcleo, trasteros): mantiene el glTF del núcleo a escala 1. */
    commonDepth: number;
    wall: number;
    gapW: number;
    gapH: number;
    slab: number;
    sky: { r: number; g: number; b: number };
    ambient: { dir: [number, number, number]; intensity: number };
    sun: { dir: [number, number, number]; intensity: number };
    lockedColor: string;
    vacantTint: number;
    brokenColor: string;
    lockColor: string;
    homeEdge: string;
    channelGlow: Record<string, string>;
    actorFallbackColor: string;
    actorFallbackHeight: number;
    actorRadius: number;
    /** Niveles de detalle por distancia (Vista: "prefab por bloque y LOD por distancia"). */
    lod: { enabled: boolean; focus: 'player'; levels: LodLevel[] };
    /** ── Escena exterior (v1.20) ── tiras de calle frente al edificio (aceras,
     *  carretera, jardines) con sus props; defId refiere bloques con `exterior`.
     *  v1.22: orient 'z' (aceras laterales y calle transversal), gridScatter 2D con
     *  topes, bordillos y paso de cebra; la carretera principal se escapa por pantalla. */
    exterior: {
      enabled: boolean;
      rows: {
        defId: string;
        x0: number;
        x1: number;
        z0: number;
        depth: number;
        body: boolean;
        orient: 'x' | 'z';
        gridScatter: boolean;
        maxTrees?: number;
        maxBushes?: number;
      }[];
      ground: { color: string; size: number; backZ: number };
      /** v1.24 — árboles como RECORTEs 2D (billboards de recorte, fundidos por arte).
       *  Presente → sustituye a las esferas 3D; ausente → fallback greybox de siempre. */
      treeArt?: { art: string; w: number; h: number; keyTolerance?: number }[];
    };
    /** ── Tráfico (v1.22) ── vehículos ocasionales (coches, bus, patrulla) por carriles;
     *  solo presentación y solo vista "edificio". */
    traffic: {
      enabled: boolean;
      lanes: { z: number; dir: number; speedMin: number; speedMax: number }[];
      spawnEveryMin: number;
      spawnEveryMax: number;
      maxAlive: number;
      xMin: number;
      xMax: number;
      passX: number;
      passRadius: number;
      vehicles: {
        kind: string;
        chance: number;
        length: number;
        width: number;
        height: number;
        cabin: number;
        colors: string[];
        siren: boolean;
      }[];
    };
    /** ── Viandantes (v1.22) ── paseantes por las aceras; algunos entran al portal. */
    pedestrians: {
      enabled: boolean;
      maxAlive: number;
      spawnEveryMin: number;
      spawnEveryMax: number;
      speedMin: number;
      speedMax: number;
      enterChance: number;
      exitChance: number;
      enterX: number;
      paths: { z: number; x0: number; x1: number; dir: number }[];
      colors: string[];
      hatChance: number;
      hatColors: string[];
      /** v1.25: arquetipos del catálogo de vecinos que prestan su cuerpo a los viandantes. */
      actorArchetypes?: string[];
    };
    /** ── Fondo urbano (v1.20) ── cielo dinámico por hora + capas de fachadas 2D con
     *  parallax natural (planos 3D a distintas z tras el edificio). */
    backdrop: {
      enabled: boolean;
      layers: {
        z: number;
        height: number;
        alpha: number;
        tint: string;
        windowColor: string;
        windowLitColor: string;
        galleryColor: string;
        buildings: number;
        floors: [number, number];
        windowChance: number;
        galleryChance: number;
        nightGlow: number;
        /** Sello PNG RGBA (v1.21): fachada real repetida por la capa (blur horneado). */
        image?: string;
        /** NIEBLA (v1.22): desaturación + fundido hacia fogColor (perspectiva aérea). */
        fog: number;
        fogColor: string;
      }[];
      sky: {
        redrawSeconds: number;
        keyframes: { hour: number; top: string; horizon: string; ambient: number; sun: number }[];
        weatherDim: Record<string, number>;
        sunColorDay: string;
        sunColorLow: string;
        sunSize: number;
        sunArcHeight: number;
        sunZ: number;
        /** Altura (m) de la línea de horizonte del cielo de dos bandas (v1.21). */
        horizonY: number;
        moonColor: string;
        moonSize: number;
        stars: number;
        starColor: string;
      };
      clouds: {
        count: number;
        yMin: number;
        yMax: number;
        z: number;
        speed: number;
        color: string;
        stormColor: string;
        alphaClear: number;
        alphaCloudy: number;
      };
      /** Lluvia (v1.21): partículas de trazo cuando el clima es rain/storm. */
      rain: {
        count: number;
        stormCount: number;
        fallSpeed: number;
        wind: number;
        color: string;
        alpha: number;
        length: number;
        width: number;
      };
    };
  };
  /** Defaults de las cutscenes de misión (Fase D): ritmos que no quieren repetirse en cada beat. */
  cutscene: {
    /** Segundos por defecto de aguante de un encuadre de cámara. */
    hold: number;
    /** Segundos por defecto de un subtítulo. */
    line: number;
    /** Tope de seguridad de un beat walk (nunca cuelga la partida). */
    walkMax: number;
    /** Alto de encuadre (m) por defecto al enfocar un bloque o al jugador. */
    focusViewH: number;
    /** Alto de encuadre (m) del travelling que sigue a un actor durante un beat walk. */
    walkViewH: number;
  };
  /** Datos del botón de demostración "Fiesta" (solo dev/debug, también en catálogo). */
  demo: { resident: string; block: string; noise: number; toast: string };
  /** Reglas del editor de interiores (catálogo, cero números de gameplay en código). */
  furniture: {
    /** Parte del precio que se devuelve al quitar un mueble (0..1). */
    refundRatio: number;
    roomUnlock: { price: number; toast: string };
    /** Textos de error de los comandos de muebles (razón → mensaje). */
    errors: Record<string, string>;
  };
  /** Textos de la interfaz de minijuegos (catálogo; el código no escribe humor, lo recita). */
  minigames: {
    winLine: string;
    loseLine: string;
    hitLine: string;
    failLines: string[];
    /** Instrucción por defecto por tipo de minijuego (la def.instruction del catálogo tiene prioridad). */
    introByType: Partial<Record<MinigameType, string>>;
  };
  /** Controles táctiles (catálogo; el componente virtual lee de aquí, cero constantes en código). */
  touch: {
    /** Radio muerto del stick como fracción de su recorrido (0..1). */
    deadzone: number;
    /** Tamaños del pad en píxeles (base y pulgar). */
    stick: { base: number; thumb: number };
    /** Etiquetas/emojis de los botones virtuales. */
    labels: { interact: string; camera: string; move: string };
    /** Texto del aviso cuando se activan a mano en desktop. */
    hint: string;
  };
  labels: { weather: Record<string, string>; elevator: Record<string, string> };
  /** Interacción con la tecla E: prompts y lecturas (buzón/tablón) del catálogo, cero textos en código. */
  interact: {
    exit: string;
    doorEnter: string;
    doorLocked: string;
    greet: string;
    laptop: string;
    bed: string;
    /** Trastero propio y bloques traseros (v1.19, apilamiento 3D). */
    storageEnter: string;
    storageLocked: string;
    rearExit: string;
    rearRoom: string;
    stairs: string;
    elevator: string;
    elevatorBroken: string;
    mailbox: { prompt: string; lines: string[] };
    noticeboard: { prompt: string; template: string };
  };
}

// ───────────────────────── Instancias (estado) ─────────────────────────

export interface RoomInstance {
  key: string;
  defId: string;
  access: Access;
  /** Parámetros propios de la estancia (p. ej. comfort). */
  params: Record<string, ParamValue>;
  /** Ranura → id de mueble ('' = vacía). */
  furniture: Record<string, string>;
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
  /** Votos registrados: IA y todos los humanos (multijugador) votan por su id de residente. */
  votes: Record<string, Vote>;
  /** true cuando la votación ya se ha cerrado y resuelto. */
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
  /** Bloque de entrada al edificio (de ahí salen y entran los vecinos IA). */
  entry: string;
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

/**
 * Comandos del jugador (o de un jugador invitado en multijugador).
 * `actor` identifica quién actúa: si falta, el núcleo usa world.playerId
 * (partida en solitario, comportamiento idéntico al clásico).
 */
export type Command =
  | { type: 'move'; resident: string; to: string }
  | { type: 'approach'; resident: string; block: string }
  | { type: 'answer_call'; mission: string; actor?: string }
  | { type: 'choose'; mission: string; choice: string; actor?: string }
  | { type: 'work'; actor?: string }
  | { type: 'sleep'; actor?: string }
  | { type: 'buy_block'; block: string; actor?: string }
  | { type: 'junta_vote'; vote: Vote; actor?: string }
  | { type: 'knock'; block: string; actor?: string }
  | { type: 'place_furniture'; block: string; room: string; slot: string; item: string; actor?: string }
  | { type: 'remove_furniture'; block: string; room: string; slot: string; actor?: string }
  | { type: 'renovate_room'; block: string; room: string; actor?: string }
  | { type: 'complete_minigame'; id: string; success: boolean; actor?: string };

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

// ───────────────────────── Posición del jugador (cliente) ─────────────────────────

export interface PlayerPosition {
  x: number;
  /** Profundidad en metros dentro de la vivienda (0 = plano frontal de la puerta; solo mode 'inside'). */
  z: number;
  /** Altura en unidades de planta (fraccionaria mientras sube o baja). */
  floor: number;
  mode: 'corridor' | 'inside';
  insideBlock: string | null;
  climbing: boolean;
  /**
   * Z absoluta del recorrido de escalera (v1.4): mientras el jugador sube por el cubo, la X
   * y la Z varían (tramos y descansillo); null fuera de la escalada (el pasillo manda).
   */
  pathZ: number | null;
  /**
   * Apilamiento 3D (v1.19): mientras el jugador está en un bloque TRASERO (interior de su
   * trastero), la presentación lo planta aquí (x/z absolutos) en vez de en el sim.
   */
  rear: { x: number; z: number } | null;
  /**
   * Regla de cámara del pasillo de trasteros (v1.21): presente cuando el jugador camina por
   * el pasillo central de un bloque de trasteros — la cámara se centra en el MEDIO del
   * pasillo y lo mira de frente para verlo hasta el fondo (null fuera de esos bloques).
   */
  storage: { cx: number; frontZ: number; depth: number } | null;
}

export interface Input {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  /** Correr (Shift / botón del mando): multiplica la velocidad por rules.view.runMultiplier. */
  run: boolean;
}

export type InteractTarget =
  | { kind: 'door'; blockId: string }
  | { kind: 'resident'; residentId: string }
  | { kind: 'mailbox' }
  | { kind: 'noticeboard' }
  | { kind: 'laptop' }
  | { kind: 'bed' }
  | { kind: 'storageCell' }
  | { kind: 'rearExit' };

// ───────────────────────── Etiquetas ─────────────────────────

/** "blk_p1_b" → "1B"; los demás ids se devuelven tal cual. */
export function blockLabel(id: string): string {
  const m = /^blk_p(\d+)_([a-d])$/.exec(id);
  return m ? `${m[1]}${m[2]!.toUpperCase()}` : id;
}
