'use client';

import { create } from 'zustand';
import type { Access, MinigameDef, Weather } from '@/game/core/types';
import { isMuted } from './audio';
import { loadOptions } from './options';
import type { ColorblindMode, Lang, PerfTarget, TextScale } from './options';

// ───────────────────────── Tipos de la interfaz ─────────────────────────

export type Tone = 'info' | 'good' | 'bad';
export type CamMode = 'edificio' | 'fachada' | 'planta' | 'estancia';
export type Speed = 1 | 3 | 10;

/** Estado de la sesión multijugador en la interfaz ('off' = sin sesión). */
export type MpStatus = 'off' | 'connecting' | 'connected' | 'error';

/** Participante de la sesión (forma del protocolo session:participants). */
export interface MpParticipant {
  id: string;
  name: string;
  home: string;
}

/** Datos de la sesión propia: código, rol y residente asignado por el servidor. */
export interface MpSessionInfo {
  code: string;
  isHost: boolean;
  myResidentId: string;
}

export interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
  /** v1.30 — post-it de CELEBRACIÓN (misión completada): se pliega como origami y suelta
   *  estrellitas que caen al suelo hasta desaparecer, sobre la fanfarria. */
  celebrate?: boolean;
  /** performance.now() al nacer (el plegado arranca al final de su vida). */
  bornAt?: number;
}

/** Chip de presidencia del HUD (v1.18, support/campaign): día de mandato y término. */
export interface CampaignHud {
  active: boolean;
  dayOfTerm: number;
  termDays: number;
  label: string;
  over: boolean;
}

/** ── v1.39: tutorial guiado (onboarding) tal y como lo pinta la tarjeta ── */
export interface TutorialUi {
  /** 'welcome' = tarjeta de bienvenida; 'step' = paso activo; 'done' = cierre. */
  mode: 'welcome' | 'step' | 'done';
  index: number;
  total: number;
  icon: string;
  title: string;
  text: string;
  cta: string | null;
}

/** ── v1.39: proyecto comunitario del edificio (meta de largo plazo) ── */
export interface ProjectGoalUi {
  label: string;
  have: number;
  need: number;
  done: boolean;
}

export interface ProjectUi {
  icon: string;
  title: string;
  /** Nivel CONSEGUIDO (0 = ninguno aún). */
  level: number;
  totalLevels: number;
  levelTitle: string;
  /** Objetivos del nivel en curso (o vacío si todo completado). */
  goals: ProjectGoalUi[];
  /** 0..1 del nivel en curso. */
  progress: number;
  reward: string | null;
  completed: boolean;
}

/** Claves de objetivo (para iconografía/aria); los textos ya llegan traducidos. */
export type ProjectGoalKey = 'missions' | 'funds' | 'reputation';

/** ── v1.39: vecinos como personajes (pestaña «Vecinos» del dock) ── */
export interface ResidentUi {
  id: string;
  name: string;
  tagline: string;
  home: string;
  present: boolean;
  activity: string | null;
  /** Afinidad con el jugador (0..100) o null si aún no hay relación. */
  affinity: number | null;
  tastes: string[];
  quote: string | null;
}

export interface LogItem {
  id: number;
  tick: number;
  text: string;
  tone: Tone;
}

export interface UiMission {
  id: string;
  title: string;
  state: 'pending' | 'active' | 'awaiting_choice' | 'done' | 'failed';
  hint: string | null;
  remaining: string | null;
}

/** Logro tal y como lo ve la UI (v1.17): textos ya resueltos al idioma del store `lang`. */
export interface AchievementUi {
  id: string;
  icon: string;
  name: string;
  desc: string;
  /** Oculto en el catálogo: bloqueado se pinta como "???" con descripción genérica. */
  hidden: boolean;
  unlocked: boolean;
  /** Recién desbloqueado: el popup estilo Steam lo encola (uno a la vez). */
  newly?: boolean;
}

export interface PhoneState {
  mission: string;
  speaker: string;
  text: string;
  isLast: boolean;
}

/** Teatro de cutscene (Fase D): qué subtítulo mostrar; speaker/text null = solo bandas de cine. */
export interface CutsceneState {
  id: string;
  speaker: string | null;
  text: string | null;
}

/** Panel de destino del ascensor (v1.9): paradas operativas del pozo donde espera el jugador. */
export interface ElevatorPanelState {
  col: number;
  current: number;
  floors: number[];
}

export interface ChoiceItem {
  id: string;
  label: string;
  hint: string | null;
}

export interface ChoiceState {
  mission: string;
  title: string;
  choices: ChoiceItem[];
}

export interface JuntaItemUi {
  id: string;
  title: string;
  description: string;
  cost: number;
}

export interface ParamUi {
  name: string;
  label: string;
  value: string;
}

/** Mueble colocado en una ranura (foto para el editor de interiores). */
export interface PlacedItemUi {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

/** Ranura de amueblado con posición ya normalizada (porcentajes 0..100). */
export interface SlotUi {
  id: string;
  kind: string;
  left: number;
  bottom: number;
  item: PlacedItemUi | null;
}

export interface HomeRoomUi {
  key: string;
  label: string;
  access: Access;
  slots: SlotUi[];
}

/** Vivienda del jugador (o comprada) para el editor de interiores. */
export interface HomeUi {
  id: string;
  label: string;
  rooms: HomeRoomUi[];
}

/** Minijuego activo en pantalla: la definición del catálogo (unión discriminada por `type`) con emoji/instrucción resueltos. */
type DistOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type MinigameState = DistOmit<MinigameDef, 'emoji' | 'instruction'> & {
  emoji: string;
  instruction: string | null;
};

/** Foto del HUD que el bucle de juego manda a la interfaz (throttled). */
export interface HudSnapshot {
  clock: { day: number; minute: number };
  weather: Weather;
  funds: number;
  wallet: number;
  reputation: number;
  elevator: string;
  homeLabel: string;
  travelText: string | null;
  objective: { title: string; text: string } | null;
  prompt: string | null;
  params: ParamUi[];
  missions: UiMission[];
  homes: HomeUi[];
  furnitureConfig: { refundRatio: number; roomUnlockPrice: number };
}

interface GameState {
  ready: boolean;
  backend: string;
  paused: boolean;
  speed: Speed;
  camMode: CamMode;
  /** Mandos táctiles visibles (auto en pantallas táctiles, conmutado desde la barra). */
  touchVisible: boolean;
  /** Sonido silenciado (persistido por el motor de audio). */
  soundMuted: boolean;
  /** Menú de opciones abierto (pulido Steam). */
  optionsOpen: boolean;
  /** v1.39 — menú de pausa a pantalla completa (Reanudar/Opciones/Guardar/Salir). */
  pauseMenuOpen: boolean;
  setPauseMenuOpen: (v: boolean) => void;
  /** Contador de FPS visible (opción de gráficos) y último valor medido. */
  fpsVisible: boolean;
  /** Idioma de la interfaz (localización del chrome; persistido en opciones). */
  lang: Lang;
  // ── v1.38 — pase de optimización: estado del auto-ajuste de rendimiento (solo lectura UI) ──
  /** Auto-ajuste de rendimiento activo (persistido en opciones; la UI lo conmuta vía controlador). */
  perfAuto: boolean;
  /** Objetivo de FPS del auto-ajuste (persistido en opciones; la UI lo conmuta vía controlador). */
  perfTarget: PerfTarget;
  /** Peldaño vigente de la escalera de optimización (0 = calidad completa). */
  perfLevel: number;
  fps: number;
  // ── v1.39 — preferencias nuevas (espejo de options; la UI las conmuta en vivo) ──
  music: boolean;
  textScale: TextScale;
  colorblind: ColorblindMode;
  reduceMotion: boolean;
  // ── v1.39 — onboarding / proyecto / vecinos ──
  tutorial: TutorialUi | null;
  project: ProjectUi | null;
  residentsUi: ResidentUi[];
  /** Aviso del catálogo al activar los mandos a mano (rules.touch.hint). */
  touchHint: string;
  clock: { day: number; minute: number };
  weather: Weather;
  funds: number;
  wallet: number;
  reputation: number;
  elevator: string;
  homeLabel: string;
  travelText: string | null;
  /** Campaña de presidencia (v1.18): chip del HUD; null = sin mandato activo. */
  campaign: CampaignHud | null;
  objective: { title: string; text: string } | null;
  prompt: string | null;
  params: ParamUi[];
  missions: UiMission[];
  log: LogItem[];
  toasts: ToastItem[];
  phone: PhoneState | null;
  cutscene: CutsceneState | null;
  /** Panel de destino del ascensor (v1.9): abierto mientras el jugador elige planta. */
  elevatorPanel: ElevatorPanelState | null;
  choices: ChoiceState | null;
  junta: JuntaItemUi[] | null;
  minigame: MinigameState | null;
  /** v1.48 — flecha animada del LATERAL del portal (entrada frontal cerrada): texto activo
   *  o null. La pinta GameStage y la limpia el controlador al caducar. */
  sideHint: string | null;
  finale: string | null;
  engineError: boolean;
  /** v1.40 — el motor perdió el contexto gráfico (WebGL/WebGPU): el lienzo se queda negro
   *  mientras el DOM sigue vivo. Overlay amable con botón de recarga (ver GameStage). */
  engineLost: boolean;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  savedAt: string | null;

  // ── Multijugador (protocolo v1): solo refleja el transporte y la sesión, sin lógica de juego ──
  mpStatus: MpStatus;
  mpCode: string | null;
  mpIsHost: boolean;
  mpMyResidentId: string | null;
  mpParticipants: MpParticipant[];
  mpPanelOpen: boolean;
  mpError: string | null;
  /** v1.54 — código de invitación recibido por ENLACE (?join=CODE): el panel lo muestra
   *  como tarjeta «Te han invitado» y se limpia al entrar (o al salir de sesión). */
  mpInviteCode: string | null;

  // ── Campaña de presidencia (v1.18): chip del HUD; la lógica vive en support/campaign ──
  setCampaign: (c: CampaignHud | null) => void;

  // ── Logros tipo Steam (v1.17): perfil persistente; resetUi CONSERVA los desbloqueos ──
  achievements: AchievementUi[];
  /** Popup en pantalla (UNO a la vez): la cola de `newly` la gestiona AchievementPopup. */
  achievementPopup: AchievementUi | null;

  markReady: (backend: string) => void;
  setPaused: (v: boolean) => void;
  setSpeed: (s: Speed) => void;
  setCamMode: (m: CamMode) => void;
  setTouchControls: (v: boolean) => void;
  setSoundMuted: (v: boolean) => void;
  setOptionsOpen: (v: boolean) => void;
  setFpsVisible: (v: boolean) => void;
  setLang: (l: Lang) => void;
  /** v1.38 — espejo de preferencias del optimizador (la UI las guarda además en localStorage). */
  setPerfAuto: (v: boolean) => void;
  setPerfTarget: (t: PerfTarget) => void;
  setPerfLevel: (n: number) => void;
  setFps: (n: number) => void;
  // ── v1.39 — setters de preferencias nuevas ──
  setMusic: (v: boolean) => void;
  setTextScale: (v: TextScale) => void;
  setColorblind: (v: ColorblindMode) => void;
  setReduceMotion: (v: boolean) => void;
  // ── v1.39 — datos de sistemas de presentación ──
  setTutorial: (t: TutorialUi | null) => void;
  setProject: (p: ProjectUi | null) => void;
  setResidentsUi: (r: ResidentUi[]) => void;
  syncHud: (h: HudSnapshot) => void;
  pushToast: (text: string, tone?: Tone, opts?: { celebrate?: boolean }) => void;
  dropToast: (id: number) => void;
  pushLog: (text: string, tone?: Tone) => void;
  setPhone: (p: PhoneState | null) => void;
  setCutscene: (c: CutsceneState | null) => void;
  setElevatorPanel: (p: ElevatorPanelState | null) => void;
  setChoices: (c: ChoiceState | null) => void;
  setJunta: (items: JuntaItemUi[] | null) => void;
  setMinigame: (m: MinigameState | null) => void;
  /** v1.48 — aviso animado de «gira la esquina» (null = oculto). */
  setSideHint: (text: string | null) => void;
  setFinale: (text: string | null) => void;
  setEngineError: (v: boolean) => void;
  /** v1.40 — contexto gráfico perdido (sin argumento: idempotente). */
  setEngineLost: () => void;
  setSaveState: (s: GameState['saveState'], at?: string) => void;
  setMpStatus: (v: MpStatus) => void;
  setMpSession: (s: MpSessionInfo | null) => void;
  setMpParticipants: (p: MpParticipant[]) => void;
  setMpPanelOpen: (v: boolean) => void;
  setMpError: (v: string | null) => void;
  setMpInviteCode: (v: string | null) => void;
  setAchievements: (list: AchievementUi[]) => void;
  setAchievementPopup: (p: AchievementUi | null) => void;
  /** Marca un logro como ya-anunciado (quita `newly`): el popup lo llama al mostrarlo. */
  clearAchievementNewly: (id: string) => void;
  resetUi: () => void;
}

let nextId = 1;

/** Modales abiertos = mundo congelado. La derivan phone/choices/junta/minigame/finale, las cutscenes (Fase D) y el panel del ascensor (v1.9). */
export function selectModalOpen(s: Pick<GameState, 'phone' | 'choices' | 'junta' | 'minigame' | 'finale' | 'cutscene' | 'elevatorPanel'>): boolean {
  return s.phone !== null || s.choices !== null || s.junta !== null || s.minigame !== null || s.finale !== null || s.cutscene !== null || s.elevatorPanel !== null;
}

export const useGameStore = create<GameState>((set) => ({
  ready: false,
  backend: '',
  paused: false,
  speed: 1,
  camMode: 'edificio',
  touchVisible: false,
  soundMuted: isMuted(),
  optionsOpen: false,
  pauseMenuOpen: false,
  fpsVisible: loadOptions().fpsVisible,
  lang: loadOptions().lang,
  perfAuto: loadOptions().perfAuto,
  perfTarget: loadOptions().perfTarget,
  perfLevel: 0,
  fps: 0,
  music: loadOptions().music,
  textScale: loadOptions().textScale,
  colorblind: loadOptions().colorblind,
  reduceMotion: loadOptions().reduceMotion,
  tutorial: null,
  project: null,
  residentsUi: [],
  touchHint: '',
  clock: { day: 1, minute: 480 },
  weather: 'sunny',
  funds: 0,
  wallet: 0,
  reputation: 50,
  elevator: 'broken',
  homeLabel: '—',
  travelText: null,
  campaign: null,
  objective: null,
  prompt: null,
  params: [],
  missions: [],
  homes: [],
  furnitureConfig: { refundRatio: 0.5, roomUnlockPrice: 250 },
  log: [],
  toasts: [],
  phone: null,
  cutscene: null,
  elevatorPanel: null,
  choices: null,
  junta: null,
  minigame: null,
  sideHint: null,
  finale: null,
  engineError: false,
  engineLost: false,
  saveState: 'idle',
  savedAt: null,
  mpStatus: 'off',
  mpCode: null,
  mpIsHost: false,
  mpMyResidentId: null,
  mpParticipants: [],
  mpPanelOpen: false,
  mpError: null,
  mpInviteCode: null,
  achievements: [],
  achievementPopup: null,

  markReady: (backend) => set({ ready: true, backend }),
  setPaused: (v) => set({ paused: v }),
  setSpeed: (s) => set({ speed: s }),
  setCamMode: (m) => set({ camMode: m }),
  setTouchControls: (v) => {
    try {
      localStorage.setItem('vecinos.touch', v ? '1' : '0');
    } catch {
      /* almacenamiento no disponible: la preferencia solo vive en sesión */
    }
    set({ touchVisible: v });
  },
  setSoundMuted: (v) => set({ soundMuted: v }),
  setOptionsOpen: (optionsOpen) => set({ optionsOpen }),
  setPauseMenuOpen: (pauseMenuOpen) => set({ pauseMenuOpen }),
  setFpsVisible: (fpsVisible) => set({ fpsVisible }),
  setLang: (lang) => set({ lang }),
  setPerfAuto: (perfAuto) => set({ perfAuto }),
  setPerfTarget: (perfTarget) => set({ perfTarget }),
  setPerfLevel: (perfLevel) => set({ perfLevel }),
  setFps: (fps) => set({ fps }),
  setMusic: (music) => set({ music }),
  setTextScale: (textScale) => set({ textScale }),
  setColorblind: (colorblind) => set({ colorblind }),
  setReduceMotion: (reduceMotion) => set({ reduceMotion }),
  setTutorial: (tutorial) => set({ tutorial }),
  setProject: (project) => set({ project }),
  setResidentsUi: (residentsUi) => set({ residentsUi }),
  syncHud: (h) => set(h),
  pushToast: (text, tone = 'info', opts) => {
    const id = nextId++;
    const celebrate = opts?.celebrate === true;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone, celebrate, bornAt: performance.now() }] }));
    // v1.29 — los avisos DURAN MÁS (petición del vecino: «que duren un poco más de tiempo
    // en pantalla y que aparezcan como Post its»): 7.5 s — se pueden cerrar con un clic.
    // v1.30 — el post-it de misión completada vive 12 s: los últimos ~3 s se pliega como
    // origami y deja caer sus estrellitas (la animación vive en ToastStack).
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, celebrate ? 12000 : 7500);
  },
  dropToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  pushLog: (text, tone = 'info') =>
    set((s) => ({
      log: [...s.log.slice(-59), { id: nextId++, tick: s.clock.day * 1440 + s.clock.minute, text, tone }],
    })),
  setPhone: (p) => set({ phone: p }),
  setCutscene: (cutscene) => set({ cutscene }),
  setElevatorPanel: (elevatorPanel) => set({ elevatorPanel }),
  setChoices: (c) => set({ choices: c }),
  setJunta: (items) => set({ junta: items }),
  setMinigame: (m) => set({ minigame: m }),
  setSideHint: (sideHint) => set({ sideHint }),
  setFinale: (text) => set({ finale: text }),
  setEngineError: (v) => set({ engineError: v }),
  /** v1.40 — solo se marca una vez; la recuperación es recargar (overlay con botón). */
  setEngineLost: () => set((s) => (s.engineLost ? s : { engineLost: true })),
  setSaveState: (saveState, at) => set({ saveState, savedAt: at ?? null }),
  setMpStatus: (mpStatus) => set({ mpStatus }),
  setMpSession: (s) =>
    set(s ? { mpCode: s.code, mpIsHost: s.isHost, mpMyResidentId: s.myResidentId } : { mpCode: null, mpIsHost: false, mpMyResidentId: null }),
  setMpParticipants: (mpParticipants) => set({ mpParticipants }),
  setMpPanelOpen: (mpPanelOpen) => set({ mpPanelOpen }),
  setMpError: (mpError) => set({ mpError }),
  setMpInviteCode: (mpInviteCode) => set({ mpInviteCode }),
  setCampaign: (campaign) => set({ campaign }),
  setAchievements: (achievements) => set({ achievements }),
  setAchievementPopup: (achievementPopup) => set({ achievementPopup }),
  // Sin cambio de verdad → sin set: si siempre devolviera un array nuevo, el efecto que lo
  // llama re-renderizaría en bucle (Maximum update depth exceeded, cazado en E2E v1.17).
  clearAchievementNewly: (id) =>
    set((s) => {
      const target = s.achievements.find((a) => a.id === id);
      if (!target || !target.newly) return {};
      return { achievements: s.achievements.map((a) => (a.id === id ? { ...a, newly: false } : a)) };
    }),
  /**
   * Limpia la UI de partida (al (re)crear el mundo). NO toca el estado de multijugador:
   * restart() se ejecuta también al ADOPTAR el mundo del servidor, y el cierre explícito
   * de sesión lo hace leaveSession() del controlador reseteando mp a la vez.
   */
  resetUi: () =>
    set({
      phone: null,
      cutscene: null,
      elevatorPanel: null,
      choices: null,
      junta: null,
      minigame: null,
      sideHint: null,
      finale: null,
      campaign: null,
      toasts: [],
      log: [],
      achievementPopup: null,
      saveState: 'idle',
      savedAt: null,
    }),
}));
