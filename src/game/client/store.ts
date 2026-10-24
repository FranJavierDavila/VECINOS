'use client';

import { create } from 'zustand';
import type { Access, MinigameDef, Weather } from '@/game/core/types';
import { isMuted } from './audio';
import { loadOptions } from './options';
import type { Lang } from './options';

// ───────────────────────── Tipos de la interfaz ─────────────────────────

export type Tone = 'info' | 'good' | 'bad';
export type CamMode = 'edificio' | 'planta' | 'estancia';
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
  /** Contador de FPS visible (opción de gráficos) y último valor medido. */
  fpsVisible: boolean;
  /** Idioma de la interfaz (localización del chrome; persistido en opciones). */
  lang: Lang;
  fps: number;
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
  finale: string | null;
  engineError: boolean;
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

  markReady: (backend: string) => void;
  setPaused: (v: boolean) => void;
  setSpeed: (s: Speed) => void;
  setCamMode: (m: CamMode) => void;
  setTouchControls: (v: boolean) => void;
  setSoundMuted: (v: boolean) => void;
  setOptionsOpen: (v: boolean) => void;
  setFpsVisible: (v: boolean) => void;
  setLang: (l: Lang) => void;
  setFps: (n: number) => void;
  syncHud: (h: HudSnapshot) => void;
  pushToast: (text: string, tone?: Tone) => void;
  dropToast: (id: number) => void;
  pushLog: (text: string, tone?: Tone) => void;
  setPhone: (p: PhoneState | null) => void;
  setCutscene: (c: CutsceneState | null) => void;
  setElevatorPanel: (p: ElevatorPanelState | null) => void;
  setChoices: (c: ChoiceState | null) => void;
  setJunta: (items: JuntaItemUi[] | null) => void;
  setMinigame: (m: MinigameState | null) => void;
  setFinale: (text: string | null) => void;
  setEngineError: (v: boolean) => void;
  setSaveState: (s: GameState['saveState'], at?: string) => void;
  setMpStatus: (v: MpStatus) => void;
  setMpSession: (s: MpSessionInfo | null) => void;
  setMpParticipants: (p: MpParticipant[]) => void;
  setMpPanelOpen: (v: boolean) => void;
  setMpError: (v: string | null) => void;
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
  fpsVisible: loadOptions().fpsVisible,
  lang: loadOptions().lang,
  fps: 0,
  touchHint: '',
  clock: { day: 1, minute: 480 },
  weather: 'sunny',
  funds: 0,
  wallet: 0,
  reputation: 50,
  elevator: 'broken',
  homeLabel: '—',
  travelText: null,
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
  finale: null,
  engineError: false,
  saveState: 'idle',
  savedAt: null,
  mpStatus: 'off',
  mpCode: null,
  mpIsHost: false,
  mpMyResidentId: null,
  mpParticipants: [],
  mpPanelOpen: false,
  mpError: null,

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
  setFpsVisible: (fpsVisible) => set({ fpsVisible }),
  setLang: (lang) => set({ lang }),
  setFps: (fps) => set({ fps }),
  syncHud: (h) => set(h),
  pushToast: (text, tone = 'info') => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3600);
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
  setFinale: (text) => set({ finale: text }),
  setEngineError: (v) => set({ engineError: v }),
  setSaveState: (saveState, at) => set({ saveState, savedAt: at ?? null }),
  setMpStatus: (mpStatus) => set({ mpStatus }),
  setMpSession: (s) =>
    set(s ? { mpCode: s.code, mpIsHost: s.isHost, mpMyResidentId: s.myResidentId } : { mpCode: null, mpIsHost: false, mpMyResidentId: null }),
  setMpParticipants: (mpParticipants) => set({ mpParticipants }),
  setMpPanelOpen: (mpPanelOpen) => set({ mpPanelOpen }),
  setMpError: (mpError) => set({ mpError }),
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
      finale: null,
      toasts: [],
      log: [],
      saveState: 'idle',
      savedAt: null,
    }),
}));
