import type { MultiplayerCatalog, StreetCatalog, SoundsCatalog, InteriorsCatalog } from '@/game/content/schemas';

// Re-exportados: los consumidores del contrato importan TODO desde aquí (types.ts es la
// única fuente de verdad; los esquemas Zod son su espejo de validación).
export type { StreetCatalog, SoundsCatalog, InteriorsCatalog, MultiplayerCatalog };

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
  /** v1.48 — pared SIEMPRE del color `color` (sin tintado de estado): pasillos, escaleras
   *  y ascensor en gris fijo; el estado lo cuentan candado/placa/puerta, no la pared. */
  fixedWall?: boolean;
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
  /** v1.61 — TEXTURA DE ACERA: losas de hormigón con juntas (canvas determinista, UV mundo). */
  paving?: {
    tile: number;
    base: string;
    tones: string[];
    joint: string;
    jointW: number;
    sheen: number;
  };
  /** v1.61 — TEXTURA DE CÉSPED: manto de hierba con briznas (canvas determinista, UV mundo). */
  lawn?: {
    tile: number;
    base: string;
    tones: string[];
    blade: string;
    bladeChance: number;
  };
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
  | { type: 'walk'; who: string; from?: CutsceneSpot; to: CutsceneSpot; max?: number; viewH?: number; /** v1.35 — el actor sube con carga (caja de mudanza / paquete). */ carry?: 'box' | 'parcel' }
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
    /** v1.40 — PROXIMIDAD (opcional): solo lucen los bocadillos de vecinos a ≤ N metros
     *  en TU misma planta (el tuyo propio siempre pasa). null/undefined = siempre. */
    nearRadius?: number;
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
      /** v1.34 — patas (alto) y collar del perro. */
      legH?: number;
      collar?: string;
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
    /** v1.80 — LÁMPARAS INTERIORES del pasillo (emisivas, sin luces dinámicas): la planta
     *  se ilumina de noche SOLO donde hay gente (mismo patrón que la actividadLight de la
     *  escalera) y con APAGÓN quedan a cero (circuito común caído). */
    corridorInterior?: {
      enabled: boolean;
      color: string;
      /** Intensidad emisiva con alguien en la planta de noche (0..1). */
      nightIntensity: number;
      /** Segundos de fundido hacia el nivel objetivo. */
      fadeSecs: number;
      /** Lamparitas interiores por bloque de pasillo. */
      lampsPerCorridor: number;
      /** Tamaño (w,h,d en m) de cada lamparita. */
      lampSize: [number, number, number];
      /** Altura de las lámparas como ratio de la altura de planta (0..1). */
      heightRatio: number;
    };
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
  /** v1.32 — escalación social: charla → discusión → pelea (herido + ambulancia).
   *  v1.35 — comedia del vecindario: baile improvisado (clip dance) y quedarse FRITO
   *  en el suelo en mitad de la charla (pose sleep + Zzz), con testigo que comenta. */
  escalation?: {
    argueChance: number;
    fightChance: number;
    injuredChance: number;
    hurtSeconds: number;
    fightLinesSeconds: number;
    argueGroups: Record<string, CrossingTopic[]>;
    fightFight: string[];
    injuryLines: string[];
    witnessLines: string[];
    /** v1.35 — probabilidad de que el cruce acabe en BAILE (y sus líneas). */
    danceChance?: number;
    danceLines?: string[];
    /** v1.35 — probabilidad de que uno se quede DORMIDO en el suelo del pasillo. */
    sleepChance?: number;
    sleepLines?: string[];
    sleepWitnessLines?: string[];
    sleepSeconds?: number;
  };
}

/** Texto bilingüe ES/EN (el español es el idioma de origen del proyecto). */
export interface LocalizedText {
  es: string;
  en: string;
}

/** ── v1.39: Música procedural (music.json, opcional) ───────────────────────────── */
export interface MusicDayPart {
  from: number;
  to: number;
}

export type MusicWave = 'sine' | 'triangle' | 'sawtooth' | 'square';

export interface MusicContext {
  tempo: number;
  root: number;
  scale: number[];
  chords: number[][];
  bassGain: number;
  padGain: number;
  leadGain: number;
  leadDensity: number;
  waves: { pad: MusicWave; lead: MusicWave; bass: MusicWave };
  /** v1.70 — loop grabado del contexto (WAV estéreo en bucle por el bus). Presente → el
   *  director lo prefiere a la síntesis; si el fichero falla, la síntesis de v1.39 manda. */
  file?: string;
  fileGain?: number;
}

export interface MusicCatalog {
  version: 1;
  masterGain: number;
  duckGain: number;
  fadeSeconds: number;
  dayParts: { morning: MusicDayPart; afternoon: MusicDayPart; evening: MusicDayPart; night: MusicDayPart };
  contexts: Record<string, MusicContext>;
  rain: { gain: number; stormGain: number; filterHz: number };
  melodyOctaves: number[];
}

/** ── v1.39: Onboarding «primer día» (onboarding.json, opcional) ───────────────── */
export interface OnboardingStep {
  id: string;
  icon: string;
  title: LocalizedText;
  text: LocalizedText;
}

export interface OnboardingTip {
  id: string;
  icon: string;
  text: LocalizedText;
}

export interface OnboardingCatalog {
  version: 1;
  enabled: boolean;
  welcome: { title: LocalizedText; text: LocalizedText; cta: LocalizedText };
  steps: OnboardingStep[];
  tips: OnboardingTip[];
  doneText: LocalizedText;
}

/** ── v1.39: Proyecto comunitario del edificio (project.json, opcional) ────────── */
export interface ProjectGoal {
  missions?: number;
  funds?: number;
  reputation?: number;
}

export interface ProjectLevel {
  id: string;
  title: LocalizedText;
  goal: ProjectGoal;
  reward: LocalizedText;
}

export interface ProjectCatalog {
  version: 1;
  id: string;
  title: LocalizedText;
  icon: string;
  levels: ProjectLevel[];
}

/** ── v1.39: Personalidades vecinales (personalities.json, opcional) ───────────── */
export interface PersonalityDef {
  name?: string;
  tastes: LocalizedText[];
  signature?: LocalizedText;
  reactions: Record<string, LocalizedText[]>;
}

export interface PersonalitiesCatalog {
  version: 1;
  defaults: PersonalityDef;
  byArchetype: Record<string, PersonalityDef>;
  byResident: Record<string, PersonalityDef>;
  ambient: {
    checkEvery: number;
    radius: number;
    cooldownPerResident: number;
    maxPerMinute: number;
    lineSeconds: number;
    chance: number;
  };
}

/**
 * Catálogo de PERSONAJES DETALLADOS (v1.43, opcional): apariencia del LOD cercano de los
 * vecinos. Lejos mandan los rigs glTF de siempre; cuando la cámara se acerca, el vecino
 * se reconstruye con piezas legibles (silueta reconocible de frente/espalda/perfiles).
 * Sin catálogo, no hay LOD de personaje (todo queda como siempre).
 */
export interface CharacterDetailSpec {
  /** Altura de autoría del personaje detallado (m). La presentación la escala 1:1. */
  height?: number;
  skin: string;
  hairColor: string;
  /** Peinado: calva con laterales (presidente), moño, gorra, cortado, melena, cascos. */
  hairStyle: 'baldSides' | 'bun' | 'cap' | 'short' | 'full' | 'headphones';
  /** Prescripción/bis correctivos sobre la cara. */
  glasses?: 'none' | 'clear' | 'sun';
  top: string;
  /** Prenda superior con solapas y corbata (traje): lectura de «señor serio». */
  suit?: { lapel: string; shirt: string; tie: string } | null;
  bottom: string;
  shoes: string;
  belt?: { strap: string; buckle: string } | null;
  /** Objeto en la mano (accesorio de silueta): portapapeles, maletín, spray, guitarra. */
  prop?: 'none' | 'clipboard' | 'briefcase' | 'spray' | 'guitar' | 'baguette';
  /** Bigote facial (silueta frontal inconfundible). */
  mustache?: string | null;
  /** v1.44 — encorvamiento (0..0.3): postura del señor mayor (hoja del Presidente). */
  hunch?: number;
  /** v1.44 — escala de la cabeza (1 normal; 1.16 corpulento caricaturesco). */
  headScale?: number;
  /** v1.44 — corpulencia del torso (1 normal; 1.2 ancho). */
  bulk?: number;
  /** v1.45 — ARTE RECORTADO de 4 vistas (billboard del LOD cercano): rutas PNG con
   *  transparencia. Presente → el LOD cercano usa este arte; ausente → rig glTF
   *  a todas las distancias (jamás un fallback de primitivas). */
  art?: { front: string; back: string; left: string; right: string };
}

export interface CharacterDetailsCatalog {
  version: 1;
  /** Configuración del LOD de personaje (distancias de cámara en metros). */
  lod: { enabled: boolean; nearDist: number; midDist: number; hysteresis: number };
  /** Especificación por ARQUETIPO (el resto de vecinos usan `defaults`). */
  byArchetype: Record<string, CharacterDetailSpec>;
  /** Especificación genérica (fallback para cualquier arquetipo sin entrada propia). */
  defaults: CharacterDetailSpec;
}

/**
 * v1.46 — Manifiesto de HOJAS DE SPRITES del personaje (opcional): la retícula compartida
 * («la regla para todos») + PNG externos por arquetipo. Si un arquetipo tiene URL en
 * `sheets`, esa hoja MANDA sobre la generada por código; sin fichero, todo se hornea.
 */
export interface CharacterSpritesCatalog {
  version: 1;
  layout: {
    frameWidth: number;
    frameHeight: number;
    columns: number;
    /** Nombre de fila (idle/walk_right/walk_left/walk_down/walk_up/sit/talk/lie) → índice. */
    rows: Record<string, number>;
    /** fps de reproducción por fila. */
    fps: Record<string, number>;
  };
  /** Arquetipo → URL del PNG con la retícula del layout (arte externo). */
  sheets: Record<string, string>;
  /** v1.48 — REGLA DE CELDAS del arte final: animación → celdas [fila, columna] de la
   *  matriz (0,0 → 7,7), espejo opcional (izquierda = derecha volteada) y fps propios.
   *  Presente → la hoja externa reproduce ESTAS casillas; ausente una vista → cae a 'idle'. */
  animations?: Record<
    string,
    { cells: [number, number][]; mirror?: boolean; fps?: number; groundMarginPx?: number }
  >;
  /** v1.48 — arquetipos representados SIEMPRE por su hoja (cualquier cámara/distancia). */
  alwaysFor?: string[];
  /** v1.48 — lado del quad del personaje sprite en metros (por defecto 1.6). */
  quadM?: number;
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
  /** Música ambiental procedural (v1.39, opcional): contextos por franja horaria + lluvia. */
  music?: MusicCatalog;
  /** Onboarding «primer día» (v1.39, opcional): tutorial guiado data-driven. */
  onboarding?: OnboardingCatalog;
  /** Proyecto comunitario de largo plazo (v1.39, opcional): «mejorar el edificio». */
  project?: ProjectCatalog;
  /** Personalidades vecinales (v1.39, opcional): nombres, gustos y reacciones por contexto. */
  personalities?: PersonalitiesCatalog;
  /** Personajes detallados (v1.43, opcional): apariencia del LOD cercano de los vecinos. */
  characterDetails?: CharacterDetailsCatalog;
  /** v1.46 — hojas de sprites animadas del personaje (retícula + PNG externos por arquetipo). */
  characterSprites?: CharacterSpritesCatalog;
  /** v1.56 — misiones cooperativas REALES + canal de voz (opcional): sin catálogo,
   *  el multijugador funciona como en v1.55 y en solitario nada cambia (nunca bloquea). */
  multiplayer?: MultiplayerCatalog;
  /** Capa social (v1.79, opcional): temas de charla y cotilleo de pasillo. Sin catálogo,
   *  la charla queda como siempre (saludo) y los pasillos callan. */
  social?: SocialCatalog;
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
    /** v1.55 — MARCADOR «VECINO DEL MES»: criterio 100% del catálogo. Todo opcional:
     *  sin bloque score la comunidad funciona igual, solo no puntúa. */
    score?: {
      title: string;
      missionCompletedPoints: number;
      missionBonus: Record<string, number>;
      /** FASE D — misiones excluidas del marcador (QA u otras herramientas): nunca puntúan. */
      excluded?: string[];
      minigames: Record<string, { label?: string; pointsPerRecord: number; maxSecs?: number }>;
      recordToast: string;
      firstToast: string;
      boardTemplate: string;
      boardLine: string;
      boardExtraBest?: string;
    };
    /** FASE N — AUTORIDAD DE SERVIDOR: límites de movimiento/ritmo impuestos por el
     *  servidor a las poses (mp:pose) y a los comandos. Opcional: sin bloque, relay puro.
     *  maxSpeed (m/s) deriva de view.runSpeed con margen para ráfagas; maxFloorSpeed
     *  (plantas/s) cubre ascensor/escalera; kickViolations 0 = nunca expulsar. */
    authority?: {
      enabled: boolean;
      maxSpeed: number;
      maxFloorSpeed: number;
      minPoseIntervalMs: number;
      maxPoseGapMs: number;
      maxCmdsPerSec: number;
      violationWindowSec: number;
      kickViolations: number;
    };
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
      /** v1.79 — la confianza del vecino hacia el jugador pesa en su voto: pYes +=
       *  clamp(trust, -50, 50) / 100 · trustWeight. Ausente/0 = comportamiento de siempre. */
      trustWeight?: number;
    };
    /** v1.79 — CAPA SOCIAL: cotilleo de pasillos (socialTick) y confianza por conversación
     *  (comando talk). Defaults en el schema: sin bloque en rules.json nada cambia. */
    social: {
      /** Probabilidad por tick de que una pareja de un pasillo suelte un cotilleo (0..1). */
      gossipChance: number;
      /** Vecinos IA despiertos en el mismo pasillo necesarios para cotillear. */
      gossipMinGroup: number;
      /** Minutos de sim que un vecino no vuelve a cotillear. */
      gossipCooldownMinutes: number;
      /** Deriva de afinidad entre la pareja cotilleadora (ambos sentidos). */
      gossipAffinityDelta: number;
      /** Minutos de sim entre dos charlas con tema del jugador al mismo vecino. */
      talkCooldownMinutes: number;
    };
    /** v1.81 — TORMENTA → DESTROZO DEL TEJADO (idea #4): roofTick (extra/roof.ts) daña el
     *  bloque del tejado durante la tormenta y el goteo sube la humedad de las viviendas de
     *  la planta residencial más alta (la de los áticos) — el gancho climático de la misión
     *  del goteo y de las manchas de humedad. Defaults en el schema: sin bloque, sin daño. */
    roof: {
      /** defId del bloque que hace de tejado (no transitable, cierra el edificio). */
      roofDef: string;
      /** Probabilidad por tick de tormenta de que el tejado ceda (≈1 vez cada 1/chance ticks). */
      damageChancePerTick: number;
      /** Goteo cada N ticks mientras el tejado siga dañado (persiste tras la tormenta). */
      leakEveryTicks: number;
      /** Humedad que sube por goteo en cada vivienda de la planta alta (0..maxHumidity). */
      humidityPerLeak: number;
      /** Coste del comando repair_roof (sale de la hucha y entra en las arcas). */
      repairCost: number;
      /** Afinidad que gana el reparador con cada vecino IA de la planta alta. */
      affinityPerRepair: number;
      /** Tope de humedad por vivienda. */
      maxHumidity: number;
    };
    /** v1.81 — VECINO BORRACHO (idea #5): al volver al edificio de noche, un vecino puede
     *  llegar ebrio (ai.ts): tambaleo errático por los pasillos y faroleo en SU puerta
     *  hasta que entra. Defaults en el schema: sin bloque, todos sobrios. */
    drunk: {
      /** Probabilidad de ebriedad en cada regreso nocturno (0..1). */
      chance: number;
      /** Arquetipos susceptibles ([] = todos). */
      archetypes: string[];
      /** Probabilidad de que cada paso hacia casa sea un trompo (0..1). */
      staggerChance: number;
      /** Faroleos en su puerta antes de conseguir entrar. */
      fumbleTries: number;
      /** Un drunk_stumble cada N pasos de borrachera. */
      lineEveryHops: number;
    };
    /** v1.81 — JUEGO ILEGAL (idea #6): el vecino del arquetipo anfitrión monta partidas de
     *  cartas en SU vivienda de noche (gambleTick): visitas sospechosas y riesgo de redada
     *  con multa (gancho para misiones futuras). Defaults en el schema: sin bloque, no hay
     *  juego. */
    gamble: {
      /** Arquetipo anfitrión (sort by id, el primero que exista). */
      hostArchetype: string;
      /** Ventana nocturna de la partida (cruza medianoche). */
      startMinute: string;
      endMinute: string;
      /** Probabilidad por noche de que haya partida (0..1). */
      chancePerNight: number;
      /** Invitados máximos (teleport al bloque del anfitrión). */
      maxGuests: number;
      /** Probabilidad de redada por tick con la partida en marcha (0..1). */
      raidChancePerTick: number;
      /** Multa al anfitrión en la redada (la hucha nunca baja de 0). */
      fine: number;
      /** Porción de la multa que entra en las arcas de la comunidad (0..1). */
      fundsShare: number;
      /** Días de resaca: tras una redada, no hay partida hasta dentro de N días. */
      cooldownDays: number;
      /** Afinidad que pierde cada invitado hacia el anfitrión cuando cae la redada. */
      guestAffinityPenalty: number;
    };
    /** v1.80 — PROTESTA POR APAGÓN: protestTick (extra/protest.ts) observa el param de luz
     *  del pasillo; por debajo del umbral arma world.protest y termina timbrando en la
     *  puerta de la presidencia. Defaults en el schema: sin bloque, no hay protesta. */
    protest: {
      /** defId de bloque vigilado (el que el apagón deja a oscuras). */
      watchDef: string;
      /** Param de iluminación vigilado. */
      watchParam: string;
      /** Mínimo entre bloques por debajo del cual se arma la protesta. */
      belowThreshold: number;
      /** Minutos de apagón antes de que alguien baje (gracia inicial). */
      delayMinutes: number;
      /** Minutos entre reintentos de recluta si nadie está despierto. */
      recruitEveryMinutes: number;
      /** Minutos entre timbrazos en la puerta del presidente. */
      ringIntervalMinutes: number;
      /** Timbrazos que aguanta el vecino antes de rendirse. */
      maxRings: number;
      /** Afinidad protestante→presidente al ABRIR la puerta. */
      calmAffinity: number;
      /** Confianza protestante→presidente al ABRIR la puerta. */
      calmTrust: number;
      /** Afinidad protestante→presidente al rendirse. */
      tiredAffinity: number;
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
    /** v1.64 — TIMBRE: gracia antirrebote del sonar (segundos): un segundo E sobre la misma
     *  puerta dentro de la ventana no vuelve a sonar ni repite el aviso (entrar no se toca). */
    doorbell: { reRingGraceSecs: number };
    /** v1.64 — TELÉFONO: la llamada de misión no congela el mundo (andar/entrar siguen). */
    phone: { freeMovement: boolean };
  };
  /** Configuración de la presentación placeholder (greybox). El arte final la sustituirá. */
  view: {
    /** v1.49 — VIDA DE CALLE: cámaras desde las que el decorado exterior (bancos, parque
     *  de calistenia, coches, viandantes) se activa. Sin regla: el comportamiento de siempre. */
    streetLife?: { cameras: string[] };
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
    /** v1.53 — VARIANTES DE VIVIENDA: cada vivienda reparte estos layouts (determinista
     *  por rango floor·16+col + desfase seed). Ausente/vacío = todas usan container.layout. */
    dwellingVariants?: { seed: number; layouts: string[] };
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
      /** v1.29 — pared del pozo GRIS OSCURA como el zócalo (fija sobre el arte glTF) y
       *  nodos del glTF del núcleo que desaparecen (el panel del hueco tapaba la cabina). */
      wallColor: string;
      hideNodes?: string[];
      /** v1.29 — interior de cabina de verdad: paneles metálicos, suelo antideslizante,
       *  plafón cálido, pasamanos y luz propia (se ve al abrirse las puertas). */
      interior: {
        panelColor: string;
        panelSeam: string;
        panelTrim: string;
        floorColor: string;
        floorSeam: string;
        ceilingColor: string;
        lightColor: string;
        lightEmissive: number;
        handrail: boolean;
        handrailColor: string;
        lightRange: number;
        lightIntensity: number;
      };
      /** v1.28 — pantallita junto a las puertas con la planta de la cabina (y flecha). */
      indicator?: { w: number; h: number; dx: number; y: number };
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
      /** v1.28 — candado SOBRE la puerta (dx del centro en fracción del ancho, yFrac de la
       *  hoja desde su base — altura del tirador — y out separado del plano de la hoja). */
      lockOnDoor?: { dx: number; yFrac: number; out: number };
      /** v1.47 — FANTASMA DEL VECINO: alpha del muro del pasillo (con premarco/puerta/aplique)
       *  cuando la vivienda está habitada y el jugador fuera (0.5 del catálogo). */
      occupiedAlpha?: number;
      night?: { dayCutoff: number; dioGlow: number; floorGlow: number; lampGlow: number; wallSelf?: number };
      lamp?: { side: -1 | 1; dx: number; dy: number; color: string; glowColor: string };
    };
    roomZ: number;
    /** Suelo de los pasillos (v1.28): losetas cuadradas (~40 cm) gris clarito con junta
     *  del catálogo; `tile` es el lado de la baldosa en metros. v1.30: contrast = alternancia.
     *  v1.35: groutW = grosor de junta y speckle = variación por baldosa (terrazo legible). */
    corridorFloor?: { color: string; grout: string; tile: number; contrast?: number; groutW?: number; speckle?: number };
    /** ── Locales de la planta baja (v1.30) ── portal acristalado con correderas, garaje
     *  definido, trastero comunitario, sala de juntas y lavandería abierta. */
    locals: {
      /** Gris ÚNICO de las paredes que dan al pasillo (cubos, pozo, frentes de locales). */
      corridorWall: string;
      /** Nodos glTF que sobran por defId (los retira el loader). */
      hideNodes: Record<string, string[]>;
      /** v1.47 — locales cuyo interior se ve SIEMPRE tras su fachada (a través del cristal
       *  cerrado — «el interior del portal debería verse siempre a través de las correderas»). */
      seeThrough?: string[];
      /** v1.46/v1.47 — cruce por movimiento: armZ/exitZ del umbral, tolerancia lateral del
       *  vano (doorPad) y armOnEnter (armar la salida al cruzar — entrar y darse la vuelta). */
      walkIn?: { armZ?: number; exitZ?: number; doorPad?: number; armOnEnter?: boolean };
      portalDoors: {
        slide: number;
        openAhead: number;
        openSeconds: number;
        frame: string;
        glass: string;
        sheen: string;
        handle: string;
        alpha: number;
        /** v1.4x — apertura por vecino que pasa: false restaura la franja clásica (intent). */
        intentOpen?: boolean;
        /** Radio X / anticipación Z del NPC que dispara la corredera (franjas NPC). */
        npcXRadius?: number;
        npcOpenAhead?: number;
      };
      garaje: {
        panel: string;
        panelShade: string;
        rail: string;
        window: string;
        sign: string;
        signBg: string;
        signText: string;
        rampDepth: number;
        rampColor: string;
        /** v1.37 — hueco REAL de la basculante: el frente del runtime se parte alrededor
         *  (jambas + dintel) y al levantarse la puerta se ve el interior AL INSTANTE. */
        doorW?: number;
        doorH?: number;
        /** v1.34 — mobiliario del garaje comunitario (interior habitable). */
        furniture?: {
          benchW: number;
          benchH: number;
          benchD: number;
          pegW: number;
          pegH: number;
          shelfW: number;
          shelfH: number;
          shelfD: number;
          shelfTiers: number;
          tireR: number;
          tireCount: number;
          boxW: number;
          boxH: number;
          boxD: number;
          benchColor: string;
          benchTopColor: string;
          tireColor: string;
          shelfColor: string;
          boxColor: string;
          pegColor: string;
          wallColor: string;
        };
      };
      trasteroComunal: {
        doorArt: string;
        doorW: number;
        doorH: number;
        doorDx: number;
        shelfTiers: number;
        sign: string;
        signBg: string;
        signText: string;
      };
      juntaHall: {
        doorW: number;
        sign: string;
        signBg: string;
        signText: string;
        /** v1.83 — intensidad del NEÓN del rótulo: emissive = signBg × signGlow
         *  (0.55 = cartel apagado de siempre; ≥1.2 = neón que arde de noche). */
        signGlow?: number;
        /** v1.83 — PUERTA TRASERA al fondo del local (el bar da paso a la sala de
         *  juntas por detrás, como recuerda el vecino): tabique + hoja con bisagra
         *  + cartel pequeño encima. Visual/simático: nada de colisiones ni rutas nuevas. */
        rearDoor?: {
          enabled: boolean;
          /** z del tabique en coords locales del bloque (desde frontZ). */
          z: number;
          doorW: number;
          doorH: number;
          art: string;
          sign: string;
          signBg: string;
          signText: string;
        };
        tableW: number;
        tableD: number;
        tableZ: number;
        /** Asientos en coords LOCALES del bloque (x desde el borde izquierdo, z desde frontZ). */
        seats: [number, number][];
        /** v1.32 — puestos DE PIE para los asistentes sin silla (coords locales). */
        standSpots?: [number, number][];
        wood: string;
        woodDark: string;
      };
      /** v1.32 — puertas batientes de los locales de planta 0 (trastero común y sala). */
      hallDoors?: {
        enabled: boolean;
        openAhead: number;
        openSeconds: number;
        openAngle: number;
        /** v1.34 — ángulo de levantamiento de la basculante del garaje (rad). */
        liftAngle: number;
        /** v1.36 — la basculante se ANTICIPA más, va más lenta y revela el interior
         *  desde revealAt: «tan pronto se levanta la puerta se ve el interior». */
        garageOpenAhead?: number;
        garageOpenSeconds?: number;
        revealAt?: number;
        /** v1.4x — apertura por vecino que pasa (false = solo intent/jugador). */
        intentOpen?: boolean;
        /** Franjas NPC: radios X y anticipación Z (las de garaje, más generosas). */
        npcXRadius?: number;
        npcOpenAhead?: number;
        garageNpcXRadius?: number;
        garageNpcOpenAhead?: number;
      };
      lavanderia: {
        machines: number;
        art: string;
        artH: number;
        machineColor: string;
        sign: string;
        signBg: string;
        signText: string;
        /** v1.35 — VOLÚMENES apilados: 3 lavadoras abajo + 3 secadoras arriba, frontal
         *  mapeado y bombo que GIRA en las «en marcha» (tirada determinista). */
        stacks?: number;
        machineW?: number;
        washerH?: number;
        dryerH?: number;
        machineD?: number;
        stackGap?: number;
        drumOnChance?: number;
        drumSpeedMin?: number;
        drumSpeedMax?: number;
        bodyColor?: string;
        bodyShade?: string;
        frontColor?: string;
        drumColor?: string;
        drumGlass?: string;
        panelColor?: string;
        accentColor?: string;
        topColor?: string;
      };
      /** v1.35 — vestíbulo del portal. v1.36: el interior es UNA IMAGEN del hall
       *  (wall_portal_hall.png); del catálogo solo quedan los colores del diorama. */
      portal?: {
        /** v1.46 — zona trasera del vestíbulo (W, z local ≥ backZoneZ). SIN efecto desde
         *  v1.75: el exit al pasillo era el «teleport al portal» (cruzaba el muro frontal). */
        backZoneZ?: number;
        lobby?: {
          wallColor: string;
          floorColor: string;
        };
      };
    };
    /** v1.47 — CARTELES de disponibilidad y OKUPAS (todo del catálogo, estados del sim). */
    housing?: {
      signs?: {
        venta: { text: string; bg: string; fg: string };
        alquiler: { text: string; bg: string; fg: string };
        /** Cartel colgado sobre la hoja: dy desde la cima de la puerta (negativo = en la hoja). */
        w: number;
        h: number;
        dy: number;
        out: number;
      };
      okupa?: {
        archetypes: string[];
        text: string;
        color: string;
        w: number;
        h: number;
        dx: number;
        dy: number;
        out: number;
      };
    };
    /** v1.37 — ATRIL del tablón de anuncios (planta 0, extremo del pasillo): la consulta
     *  del tablón vive ahí (interact 'noticeboard' anclado a su posición del mundo). */
    noticeboard?: {
      enabled: boolean;
      floor: number;
      side: 'left' | 'right';
      inset: number;
      /** offset desde la línea del pasillo (corridorZ): negativo = hacia la calle. */
      z: number;
      yaw: number;
      postColor: string;
      postW: number;
      frameColor: string;
      frameW: number;
      corkColor: string;
      boardW: number;
      boardH: number;
      boardY: number;
      deskW: number;
      deskD: number;
      deskY: number;
      deskColor: string;
      deskSlant: number;
      capColor: string;
      headline: string;
      headlineBg: string;
      headlineFg: string;
      paperColors: string[];
      notes: string[];
      /** v1.47 — sólido del atril en el pasillo (no se atraviesa). */
      colliderW?: number;
      colliderD?: number;
    };
    /** v1.37 — PASEO VECINAL: los vecinos salen a la calle, cruzan por el paso de peatones
     *  mirando a ambos lados y van al jardín de enfrente a practicar algo de deporte. */
    paseo?: {
      enabled: boolean;
      everyMin: number;
      everyMax: number;
      maxOut: number;
      /** probabilidad de que el vecino elegido acepte el paseo («algunos si quieren»). */
      chance: number;
      lookSeconds: number;
      doorWait: number;
      crossMargin: number;
      crossX: number;
      curbNearZ: number;
      curbFarZ: number;
      parkX: number;
      parkZ: number;
      exerciseMin: number;
      exerciseMax: number;
      /** clip de gesto del ejercicio (cae al default del rig si el arquetipo no lo tiene). */
      gesture: string;
      bob: number;
      bobRate: number;
      lines: string[];
      /** v1.41 — RUTA LATERAL (perímetro oeste): la única puerta «real» del edificio. */
      sideX: number;
      sideZ: number;
      cornerZ: number;
      frontZ: number;
      portalSideX: number;
      /** v1.41 — planes del paseo: reparto banco/paseo/taxi (resto = parque). */
      benchChance: number;
      strollChance: number;
      taxiChance: number;
      strollMeters: number;
      sitSecondsMin: number;
      sitSecondsMax: number;
    };
    /** v1.35 — GRAFITIS (cabina del ascensor + paredes del cubo/portal): textos y dibujos
     *  graciosos del catálogo; cabinMin = nivel en que aparece el mural de cabina,
     *  spillToWalls = nivel en que también salpican los muros. */
    graffiti?: {
      cabinMin: number;
      spillToWalls: number;
      alpha: number;
      colors: string[];
      outline: string;
      texts: string[];
      doodles: string[];
      wallLines: string[];
    };
    /** v1.35 — DECAY visible (humedades/grietas/hollín/suciedad): umbrales del catálogo;
     *  cada mancha aparece y sube de opacidad según el parámetro del sim. */
    decay?: {
      humidity?: { min: number; max: number; w: number; h: number };
      soot?: { min: number; max: number; w: number; h: number };
      cracks?: { conditionMax: number; w: number; h: number };
      grime?: { cleanlinessMax: number; w: number; h: number };
      /** v1.72 — escalera anti z-fighting entre decales del mismo muro (m por tipo). */
      zStep?: number;
    };
    /** v1.35 — llevar objetos encima (paquetes/mudanzas): actividades del catálogo que
     *  cargan una caja sobre la cabeza, colores y tamaño de la caja. */
    carry?: {
      activities: string[];
      boxColor: string;
      boxTape: string;
      parcelColor: string;
      boxW: number;
      boxH: number;
      boxD: number;
    };
    /** Bloom/glow de las luces (v1.28): halo realista de los materiales emisivos. */
    glow?: { enabled: boolean; intensity: number; blurKernelSize?: number };
    /** v1.40 — LINTERNA del apagón: PointLight que sigue al jugador (radio corto). */
    flashlight?: { range: number; intensity: number; height: number; color: string };
    /** v1.42 — SALIDA DEL JUGADOR A LA CALLE: rects transitables (aceras, paso de peatones,
     *  jardín de enfrente), disparadores del portal SIN tecla E (dirección manda), bancos y
     *  calistenia. El jugador es un vecino más: no puede salir del plano de la cámara lejana. */
    outside?: {
      /** Límites del plano de cámara lejana: las aceras no continúan más allá en el cuadro. */
      xMin: number;
      xMax: number;
      /** Rects transitables (unión; el paso de cebra es el ÚNICO cruce de la calzada). */
      walk: { x0: number; z0: number; x1: number; z1: number }[];
      /** Portal sin E: salir/entrar caminando en la dirección correcta (pared lateral y frente). */
      portal: {
        outFrontZ: number;
        inFrontZ: number;
        sideExitX: number;
        sideEnterX: number;
        sideZ: number;
        wallInnerX: number;
        frontInnerZ: number;
        fadeSeconds: number;
        /** v1.61 — ZONA DE AVISO FRONTAL (x del vano + margen, z al ras de fachada): empujar
         *  aquí suelta el aviso «se entra por el lateral». El vano ya NO es transitable. */
        frontZone?: { x0: number; x1: number; zMin: number };
      };
      /** Banco exterior: radio de sentarse (la pose usa el yaw del catálogo del paseo). */
      benchRadius: number;
      /** Parque de calistenia: punto de ejercicio y parámetros. */
      exercise: { x: number; z: number; radius: number; secondsMin: number; secondsMax: number; moodBoost: number };
      /** Banco: ánimo que sube al contemplar el edificio un rato. */
      sitMoodBoost: number;
      /** Líneas cómicas del jugador al aire libre (bocadillo; data-driven, i18n ES→EN). */
      says: { out: string[]; into: string[]; sit: string[]; exercise: string[] };
    };
    /** v1.42 — ZONAS CIEGAS de la cortina de la vista FACHADA: bandas opacas arriba y abajo
     *  de cada nivel + paneles ciegos deterministas, con el acabado de las fachadas de fondo. */
    fachadaCortina?: {
      bottomBlind: number;
      topBlind: number;
      bandColor: string;
      panelColor: string;
      panelChance: number;
      panelInset: number;
    };
    /** v1.58 — FACHADA DE LADRILLO: los paños grises del exterior (vivienda, locales y
     *  escalera) visten ladrillo con junta clara, el mismo dialecto que las fachadas del
     *  horizonte. tileMeters = lado del mosaico en mundo (UV en espacio mundo, aparejo
     *  continuo entre plantas y bloques); cols/rows = ladrillos por mosaico con fila sorda
     *  alternada; brickTones = variación determinista por ladrillo; sheen = relieve. */
    facadeBrick?: {
      enabled: boolean;
      tileMeters: number;
      cols: number;
      rows: number;
      mortar: string;
      mortarW: number;
      brick: string;
      brickTones: string[];
      sheen: number;
    };
    /** v1.48 — ICONOS DE AVISO en el muro de pasillo de la vivienda afectada (parpadeantes). */
    alerts?: {
      thresholds: { plague: number; humidity: number; noise: number };
      glyphs: { plague: string; humidity: string; noise: string; mission: string };
      size: number;
      yOverDoor: number;
      blinkSecs: number;
      color: string;
    };
    /** v1.48 — ENTRADA FRONTAL CERRADA del portal: aviso con flecha animada al empujar.
     *  v1.61 — SEÑAL FÍSICA en la fachada: placa sobre el vano del portal. */
    sideEntry?: {
      hint: string;
      toast: string;
      cooldownSecs: number;
      hintSecs: number;
      sign?: {
        text: string;
        arrow: string;
        x: number;
        y: number;
        w: number;
        h: number;
        plate: string;
        ink: string;
        edge: string;
      };
    };
    /** v1.48 — BROMAS de los vecinos con el apagón activo (bocadillos ambientales). */
    blackoutJokes?: {
      everySecs: [number, number];
      radius: number;
      lines: string[];
    };
    /** v1.41 — ACCESORIOS DE LA CALLE: paraguas abierto cuando llueve y bolsas de la compra. */
    outdoor?: {
      umbrella?: { color: string; stickColor: string; size: number; openSeconds: number };
      bags?: { colorA: string; colorB: string };
    };
    /** v1.41 — TEATRO DEL TAXI: recogida frente al portal y vuelta con bolsas de la compra. */
    taxi?: {
      enabled: boolean;
      pickupX: number;
      stopLaneZ: number;
      stopX: number;
      waitMin: number;
      waitMax: number;
      rideMin: number;
      rideMax: number;
    };
    /** Sombras de verdad (v1.32): un solo ShadowGenerator sobre el sol del catálogo con
     *  listas de patrones de nombre para casters / receptores / excluidos. */
    shadows?: {
      enabled: boolean;
      mapSize: number;
      darkness: number;
      bias: number;
      normalBias: number;
      casters: string[];
      receivers: string[];
      excluded: string[];
      /** v1.63 — SOMBRA DE CONTACTO (blob): disco oscuro bajo los pies de cada personaje
       *  (jugador, vecinos y avatares remotos). Sigue al cuerpo y se PEGA al suelo real
       *  (raycast hacia abajo con reposo: los parados no re-rayan), de modo que el personaje
       *  parece APOYADO en el suelo aunque la sombra direccional del sol caiga lejos. */
      contact?: {
        enabled: boolean;
        /** Radio del disco en m (los pies del personaje quedan dentro). */
        radius: number;
        /** Opacidad máxima en el centro (0..1). */
        opacity: number;
        /** Tinte del disco (hex; negro = sombra clásica). */
        color: string;
        /** Separación sobre el suelo en m (anti-coplanar: nunca 0). */
        offset: number;
        /** Altura sobre el suelo a la que la sombra ya no se ve (m). */
        maxRise: number;
        /** Ensanchamiento del disco por metro de altura (difusión con la distancia). */
        stretch: number;
        /** Segundos entre raycasts por personaje en movimiento (los parados no re-rayan). */
        rayEvery: number;
        /** Altura del origen del rayo sobre los pies (m). */
        rayUp: number;
      };
    };
    /** v1.32 — palabras ordinales de planta por idioma para los textos data-driven. */
    texts?: {
      ordinals: string[];
      ordinalsEn: string[];
      floorTemplateEs: string;
      floorTemplateEn: string;
    };
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
    ambient: {
      dir: [number, number, number];
      intensity: number;
      /** v1.29 — color de rebote (groundColor): levanta techos/caras inferiores. */
      ground?: string;
    };
    sun: { dir: [number, number, number]; intensity: number };
    /** v1.71 — PASE GLOBAL DE IMAGEN (Fase V): tone mapping + exposición/contraste por la
     *  scene.imageProcessingConfiguration. Presente → el controlador aplica el pase a toda
     *  la escena; ausente → comportamiento clásico (QA headless intacto). */
    imageProcessing?: {
      toneMapping: 'aces' | 'khn' | 'none';
      exposure: number;
      contrast: number;
    };
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
    /** v1.36 — alejamiento de la cámara Estancia: factores de encuadre y margen de borde.
     *  v1.65 — spyViewHFactor: escala del encuadre de planta para la cámara ESPÍA. */
    camera?: { estanciaFloorH: number; estanciaWidthW: number; estanciaEdgeMargin: number; fachadaViewHFactor?: number; spyViewHFactor?: number };
    /** v1.65 — cuaderno sobre el escenario: altura máxima del panel (fracción del
     *  escenario) y alertas post-it on/off (defaults en el zod del contenido).
     *  v1.66 — banner de MÁXIMA PRIORIDAD: bannerShowMs en pantalla y cola máxima. */
    infoDock?: { overlayMaxHeightFactor?: number; alerts?: boolean; bannerShowMs?: number; bannerQueueMax?: number };
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
      /** v1.28 — rectángulos del mundo sin árboles ni arbustos (nada de verde tapando el
       *  portal) y piezas COLOCADAS a mano (el árbol del portal, replantado a la derecha). */
      keepOut?: { x0: number; x1: number; z0: number; z1: number }[];
      forcedTrees?: { x: number; z: number; art?: string; s?: number }[];
      /** v1.37 — PARQUE DE CALISTENIA en el jardín de enfrente: barras, paralelas,
       *  banco de abdominales y suelo de caucho — todo del catálogo. */
      calisthenics?: {
        enabled: boolean;
        x: number;
        z: number;
        w: number;
        d: number;
        ground: string;
        edge: string;
        postColor: string;
        barColor: string;
        boardColor: string;
        sign: string;
        signBg: string;
        signFg: string;
        barH: number;
        dipH: number;
      };
      /** v1.61 — SOMBRA DEL EDIFICIO sobre la escena exterior (aproximación sin luces
       *  ni shadow-maps extra): franjas oscuras translúcidas a la cota de cada tira de
       *  calle, con degradado, longitud y desplazamiento según el sol visible del fondo. */
      buildingShadow?: {
        enabled: boolean;
        color: string;
        alpha: number;
        minLen: number;
        maxLen: number;
        spread: number;
        skew: number;
      };
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
        /** v1.31 — detalle por vehículo: matrícula (textura a canvas), rótulos pintados
         *  en los costados (empresa, línea, POLICÍA), rótulo destino del bus, cartel de
         *  tejado (TAXI), parrilla de techo (furgoneta) y ejes traseros (2 o 3). */
        plate?: string;
        sideText?: string;
        destSign?: string;
        roofSign?: string;
        roofRack?: boolean;
        axles?: number;
      }[];
      /** v1.41 — CORTESÍA AL VOLANTE: frenada en el paso de peatones + distancia de
       *  seguridad con el vehículo de delante. Si el peatón aparece demasiado cerca, la
       *  frenada es imposible → susto/accidente cómico. */
      braking: {
        enabled: boolean;
        zebraHalfWidth: number;
        minStopDist: number;
        brakeDecel: number;
        followGap: number;
        hazardSeconds: number;
      };
      /** v1.32 — AMBULANCIA del teatro de emergencias (opcional). */
      ambulance?: {
        length: number;
        width: number;
        height: number;
        color: string;
        sideText: string;
        stripe: string;
        cross: string;
        beaconA: string;
        beaconB: string;
        stopZ: number;
        stopAhead: number;
        enterFrom: 'left' | 'right';
        speed: number;
        doorSeconds: number;
        medicSpeed: number;
        carryHeight: number;
        medicColor: string;
        medicCapColor: string;
        medicLegColor: string;
      };
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
      /** v1.30 — umbral del portal (z del mundo): entrar/salir cruza POR las correderas. */
      enterZ?: number;
      /** v1.41 — RUTA LATERAL: los viandantes entran/salen cruzando el portal por su
       *  pared izquierda (perímetro oeste) y recorriendo la acera lateral. */
      sideRoute?: {
        sideX: number;
        sideZ: number;
        cornerZ: number;
        frontZ: number;
        portalSideX: number;
      };
      paths: { z: number; x0: number; x1: number; dir: number }[];
      colors: string[];
      hatChance: number;
      hatColors: string[];
      /** v1.25: arquetipos del catálogo de vecinos que prestan su cuerpo a los viandantes. */
      actorArchetypes?: string[];
      /** v1.32 — vida social de acera: charlas, discusiones y peleas entre viandantes
       *  (un herido activa el teatro de la ambulancia del catálogo). */
      social?: {
        enabled: boolean;
        checkEvery: number;
        distance: number;
        maxConcurrent: number;
        talkSeconds: number;
        argueChance: number;
        fightChance: number;
        injuredChance: number;
        hurtSeconds: number;
        pairCooldown: number;
      };
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
        /** v1.49 — PROFUNDIDAD REAL: con depthWrite la capa vira a ALPHATEST (recorte
         *  binario) y ESCRIBE depth: un edificio cercano tapa a los lejanos por buffer. */
        depthWrite?: boolean;
        /** v1.49 — corte alfa del modo ALPHATEST (solo con depthWrite). */
        alphaCutOff?: number;
        /** v1.62 — fracción de sellos que quedan SIN pintar (solares: asoma el cielo). */
        skipChance: number;
        /** NIEBLA (v1.22): desaturación + fundido hacia fogColor (perspectiva aérea). */
        fog: number;
        fogColor: string;
      }[];
      sky: {
        redrawSeconds: number;
        keyframes: { hour: number; top: string; horizon: string; ambient: number; sun: number }[];
        weatherDim: Record<string, number>;
        /** v1.28 — velado de día de lluvia: el cielo se funde hacia estos colores y el
         *  sol/luna se retiran (rain/storm marcan cuánto: 0..1). */
        overcast?: { top: string; horizon: string; rain: number; storm: number };
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
        /** v1.28 — con lluvia las nubes engordan hasta cerrar el cielo (1 = sin cambio). */
        stormScale?: number;
      };
      /** v1.48 — TORMENTA: fogonazos globales, rayos (cámaras exteriores) y trueno retardado. */
      storm?: {
        flashEverySecs: [number, number];
        flashDecay: number;
        boltXRange: [number, number];
        topY: number;
        groundY: number;
        thunderDelaySecs: number;
        thunderGain: number;
      };
      /** Lluvia (v1.21): partículas de trazo cuando el clima es rain/storm.
       *  v1.28: `wash` apaga la ciudad del fondo con el cielo cerrado. */
      rain: {
        count: number;
        stormCount: number;
        fallSpeed: number;
        wind: number;
        color: string;
        alpha: number;
        length: number;
        width: number;
        wash?: { color: string; alpha: number };
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
    /** v1.40 — timbre de una vivienda ajena (E en su puerta) y charla con un vecino. */
    doorbell?: string;
    chat?: string;
    /** v1.80 — protesta en TU puerta (E = abrir, responder a la protesta). */
    answerProtest?: string;
    /** v1.81 — tejado dañado y tú en el pasillo de la planta alta (E = repair_roof). */
    repairRoof?: string;
    /** v1.48 — cuadro de fusibles del garaje: prompt de la E y línea sin apagón. */
    fusebox?: { prompt: string; okLine: string };
    /** v1.42 — calle: banco exterior y parque de calistenia. */
    bench?: string;
    exercise?: string;
    standUp?: string;
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

/** ── v1.79: CAPA SOCIAL (social.json, opcional) ─────────────────────────────── */

/**
 * Tema de charla del selector de conversación: el sim resuelve el resultado por
 * arquetipo/afinidad y mueve la CONFIANZA del vecino hacia el jugador (Relation.trust).
 */
export interface TalkTopic {
  id: string;
  label: LocalizedText;
  icon: string;
  /** Probabilidad base de que la charla siente bien (0..1). */
  gainChance: number;
  /** Delta de confianza si la charla va bien (0..100). */
  trustGain: number;
  /** Delta de confianza si va mal (-100..0). */
  trustLoss: number;
  /** Arquetipos que ADOREN este tema (+0.2 al gainChance) — ids reales del catálogo. */
  likedBy: string[];
  /** Arquetipos a los que el tema les da urticaria (-0.2). */
  dislikedBy: string[];
  linesGain: LocalizedText[];
  linesLoss: LocalizedText[];
}

/** Catálogo social completo: temas de charla + frases de cotilleo de pasillo. */
export interface SocialCatalog {
  topics: TalkTopic[];
  /** {a}/{b} = nombres de los cotilleadores (el que habla y el que escucha). */
  gossip: { lines: LocalizedText[] };
  /** v1.80 — PROTESTA POR APAGÓN: frases del vecino que timbra (una por escalón), la
   *  línea de calma al abrir y la de rendición. Opcional: sin bloque, la protesta
   *  funciona igual pero sin bocadillos. */
  protest?: {
    /** Escalaciones del timbrazo (el cliente elige por nº de timbrazo). */
    ringLines: LocalizedText[];
    /** Línea al ABRIR la puerta (protesta calmada). */
    calmLine: LocalizedText;
    /** Línea al rendirse (maxRings agotados). */
    tiredLine: LocalizedText;
  };
  /** v1.81 — VECINO BORRACHO: frases del ebrio al llegar, al farolear en SU puerta y al
   *  colarse por fin. Opcional: sin bloque, el borracho tambalea en silencio. */
  drunk?: {
    /** Al cruzar el portal de madrugada. */
    linesStart: LocalizedText[];
    /** Faroleo en su puerta (llave que no entra, Lezurra…). */
    linesFumble: LocalizedText[];
    /** Al colarse por fin. */
    linesHome: LocalizedText[];
  };
  /** v1.81 — JUEGO ILEGAL: frases de los invitados que suben y del hostigo de la redada.
   *  Opcional: sin bloque, las visitas suben en silencio. */
  gamble?: {
    /** Bocadillo del invitado camino de la partida. */
    linesVisit: LocalizedText[];
    /** Bocadillo del anfitrión cuando cae la redada. */
    linesRaid: LocalizedText[];
  };
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

/** ── v1.80: PROTESTA POR APAGÓN (world.protest, costura del sim en extra/protest.ts) ── */

/**
 * Máquina de estados del sim: observa el param de luz del pasillo (rules.sim.protest);
 * si cae por debajo del umbral (apagón del ecosistema) y hay vecino despierto, uno baja
 * a la puerta del PRESIDENTE a timbrar hasta que abra (answer_door) o se canse.
 * En multijugador no se arma: el cerebro del ecosistema (que muta el param) es local de
 * cada cliente y el servidor la pisa con sus snapshots — limitación previa del apagón,
 * aquí se hereda a propósito (misma coherencia: si no hay apagón, no hay protesta).
 */
export interface ProtestState {
  /** Tick en que se detectó el apagón (param por debajo del umbral). */
  startTick: number;
  /** Vecino que protesta (null mientras espera a que haya alguien despierto). */
  protester: string | null;
  /** Residente al que se exige la puerta (presidencia de la comunidad). */
  presidentId: string;
  phase: 'marching' | 'ringing';
  /** Timbrazos dados ya en la puerta del presidente. */
  rings: number;
  /** Último timbrazo / reintento de recluta (ritmos del catálogo). */
  lastActionTick: number;
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
  /** v1.80 — protesta por apagón (null = tranquila; la arma extra/protest.ts). */
  protest: ProtestState | null;
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
  | { type: 'convoca_junta'; actor?: string }
  | { type: 'knock'; block: string; actor?: string }
  | { type: 'place_furniture'; block: string; room: string; slot: string; item: string; actor?: string }
  | { type: 'remove_furniture'; block: string; room: string; slot: string; actor?: string }
  | { type: 'renovate_room'; block: string; room: string; actor?: string }
  | { type: 'complete_minigame'; id: string; success: boolean; actor?: string }
  | { type: 'talk'; resident: string; topic: string; actor?: string }
  /** v1.80 — abrir la puerta al vecino que protesta por el apagón (solo presidente). */
  | { type: 'answer_door'; actor?: string }
  /** v1.81 — reparar el tejado dañado por la tormenta (coste del catálogo; los de la
   *  planta alta lo agradecen). */
  | { type: 'repair_roof'; actor?: string };

export interface CommandResult {
  ok: boolean;
  reason?: string;
}

// ───────────────────────── Posición del jugador (cliente) ─────────────────────────

export interface PlayerPosition {
  x: number;
  /** Profundidad en metros dentro de la vivienda (0 = plano frontal de la puerta; solo mode 'inside').
   *  v1.42 — en mode 'outside' la Z es ABSOLUTA del mundo (la acera vive en z negativo). */
  z: number;
  /** Altura en unidades de planta (fraccionaria mientras sube o baja). */
  floor: number;
  /** v1.42 — 'outside': el jugador está en la calle (aceras, paso de peatones, parque). */
  mode: 'corridor' | 'inside' | 'outside';
  insideBlock: string | null;
  climbing: boolean;
  /** v1.42 — fundido del cuerpo al cruzar portal (0 invisible..1 visible): el teatro de
   *  atravesar la pared lateral del portal, igual que los vecinos del paseo. */
  fade: number;
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
  | { kind: 'rearExit' }
  /** v1.48 — cuadro de fusibles del garaje (con apagón: abrir el minijuego de rearme). */
  | { kind: 'fusebox' }
  /** v1.80 — TU puerta con la protesta por el apagón timbrando: E = abrir (answer_door). */
  | { kind: 'answer_protest' }
  /** v1.81 — pasillo de la planta alta con el tejado dañado: E = reparar (repair_roof). */
  | { kind: 'repair_roof' }
  /** v1.42 — calle: banco exterior (sentarse a contemplar el edificio). */
  | { kind: 'bench'; x: number; z: number; yaw: number }
  /** v1.42 — calle: parque de calistenia (hacer ejercicio). */
  | { kind: 'exercise' };

// ───────────────────────── Etiquetas ─────────────────────────

/** "blk_p1_b" → "1B"; los demás ids se devuelven tal cual. */
export function blockLabel(id: string): string {
  const m = /^blk_p(\d+)_([a-d])$/.exec(id);
  return m ? `${m[1]}${m[2]!.toUpperCase()}` : id;
}
