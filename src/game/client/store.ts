'use client';

import { create } from 'zustand';
import type { Access, MinigameDef, Weather } from '@/game/core/types';
import { isMuted } from './audio';

// ───────────────────────── Tipos de la interfaz ─────────────────────────

export type Tone = 'info' | 'good' | 'bad';
export type CamMode = 'edificio' | 'planta' | 'estancia';
export type Speed = 1 | 3 | 10;

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
  choices: ChoiceState | null;
  junta: JuntaItemUi[] | null;
  minigame: MinigameState | null;
  finale: string | null;
  engineError: boolean;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  savedAt: string | null;

  markReady: (backend: string) => void;
  setPaused: (v: boolean) => void;
  setSpeed: (s: Speed) => void;
  setCamMode: (m: CamMode) => void;
  setTouchControls: (v: boolean) => void;
  setSoundMuted: (v: boolean) => void;
  syncHud: (h: HudSnapshot) => void;
  pushToast: (text: string, tone?: Tone) => void;
  dropToast: (id: number) => void;
  pushLog: (text: string, tone?: Tone) => void;
  setPhone: (p: PhoneState | null) => void;
  setChoices: (c: ChoiceState | null) => void;
  setJunta: (items: JuntaItemUi[] | null) => void;
  setMinigame: (m: MinigameState | null) => void;
  setFinale: (text: string | null) => void;
  setEngineError: (v: boolean) => void;
  setSaveState: (s: GameState['saveState'], at?: string) => void;
  resetUi: () => void;
}

let nextId = 1;

/** Modales abiertos = mundo congelado. La derivan phone/choices/junta/minigame/finale. */
export function selectModalOpen(s: Pick<GameState, 'phone' | 'choices' | 'junta' | 'minigame' | 'finale'>): boolean {
  return s.phone !== null || s.choices !== null || s.junta !== null || s.minigame !== null || s.finale !== null;
}

export const useGameStore = create<GameState>((set) => ({
  ready: false,
  backend: '',
  paused: false,
  speed: 1,
  camMode: 'edificio',
  touchVisible: false,
  soundMuted: isMuted(),
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
  choices: null,
  junta: null,
  minigame: null,
  finale: null,
  engineError: false,
  saveState: 'idle',
  savedAt: null,

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
  setChoices: (c) => set({ choices: c }),
  setJunta: (items) => set({ junta: items }),
  setMinigame: (m) => set({ minigame: m }),
  setFinale: (text) => set({ finale: text }),
  setEngineError: (v) => set({ engineError: v }),
  setSaveState: (saveState, at) => set({ saveState, savedAt: at ?? null }),
  resetUi: () =>
    set({
      phone: null,
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
