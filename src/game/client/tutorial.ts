'use client';

/**
 * ONBOARDING «PRIMER DÍA» (v1.39) — tutorial guiado NO bloqueante, data-driven.
 * El catálogo (public/content/onboarding.json) define bienvenida, pasos (moverse, tablón,
 * tarea, vecino) y consejos contextuales one-shot (teléfono, junta, ascensor, minijuego,
 * proyecto). El director recibe señales del controlador (movimiento, interacciones,
 * eventos del sim) y marca los pasos; la persistencia vive en localStorage (perfil del
 * navegador, igual que los logros), así que recargar no repite el sermón.
 * Si el catálogo falta o está desactivado, no hay tutorial y la partida funciona igual.
 */

import type { OnboardingCatalog } from '@/game/core/types';
import { useGameStore, type TutorialUi } from './store';

const KEY = 'vecinos.tutorial';

interface TutorialSave {
  welcomeSeen: boolean;
  steps: string[];
  tips: string[];
  /** true cuando el jugador pulsó «omitir»: no vuelve a molestar. */
  skipped: boolean;
}

function loadSave(): TutorialSave {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { welcomeSeen: false, steps: [], tips: [], skipped: false };
    const p = JSON.parse(raw) as Partial<TutorialSave>;
    return {
      welcomeSeen: p.welcomeSeen === true,
      steps: Array.isArray(p.steps) ? p.steps.filter((s) => typeof s === 'string') : [],
      tips: Array.isArray(p.tips) ? p.tips.filter((s) => typeof s === 'string') : [],
      skipped: p.skipped === true,
    };
  } catch {
    return { welcomeSeen: false, steps: [], tips: [], skipped: false };
  }
}

function persist(s: TutorialSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento: el tutorial solo vive en sesión */
  }
}

export interface TutorialDirector {
  /** Señales discretas que marcan pasos: interacción usada, evento del sim. */
  notify(signal: TutorialSignal): void;
  /** Metros caminados por el jugador (acumula y da el paso «move» por cumplido). */
  moved(meters: number): void;
  /** Consejo contextual one-shot (el controlador lo llama al abrir cada sistema). */
  tip(id: string): void;
  /** Bienvenida vista (botón «¡Vamos allá!»). */
  acceptWelcome(): void;
  /** «Omitir tutorial»: da todos los pasos por hechos (los consejos siguen). */
  skip(): void;
  /** Re-publica la tarjeta vigente en el store (tras restart o cambio de idioma). */
  refresh(): void;
}

export type TutorialSignal = 'used:noticeboard' | 'used:resident' | 'mission_completed';

let current: TutorialDirector | null = null;

/** El controlador registra el director vigente; la UI lo usa para omitir/aceptar. */
export function setCurrentTutorial(d: TutorialDirector): void {
  current = d;
}

export function getTutorial(): TutorialDirector | null {
  return current;
}

export function createTutorial(catalog: OnboardingCatalog | undefined, lang: () => 'es' | 'en'): TutorialDirector {
  let save = loadSave();
  let movedDistance = 0;
  const movedNeeded = 2.5; // metros caminados para dar el paso por cumplido

  const publish = (): void => {
    const store = useGameStore.getState();
    if (!catalog || !catalog.enabled || save.skipped) {
      store.setTutorial(null);
      return;
    }
    const t = lang();
    // Tarjeta vigente: bienvenida → primer paso no cumplido → cierre.
    if (!save.welcomeSeen) {
      const ui: TutorialUi = {
        mode: 'welcome',
        index: 0,
        total: catalog.steps.length,
        icon: '🏠',
        title: catalog.welcome.title[t],
        text: catalog.welcome.text[t],
        cta: catalog.welcome.cta[t],
      };
      store.setTutorial(ui);
      return;
    }
    const idx = catalog.steps.findIndex((s) => !save.steps.includes(s.id));
    if (idx === -1) {
      // Todo cumplido: cierre una sola vez (queda guardado como paso especial).
      if (save.steps.includes('__done__')) {
        store.setTutorial(null);
        return;
      }
      save.steps.push('__done__');
      persist(save);
      store.setTutorial({
        mode: 'done',
        index: catalog.steps.length,
        total: catalog.steps.length,
        icon: '🎉',
        title: catalog.doneText[t],
        text: '',
        cta: null,
      });
      window.setTimeout(() => {
        if (useGameStore.getState().tutorial?.mode === 'done') useGameStore.getState().setTutorial(null);
      }, 9000);
      return;
    }
    const step = catalog.steps[idx]!;
    store.setTutorial({
      mode: 'step',
      index: idx,
      total: catalog.steps.length,
      icon: step.icon,
      title: step.title[t],
      text: step.text[t],
      cta: null,
    });
  };

  const stepDone = (id: string): void => {
    if (!catalog) return;
    const step = catalog.steps.find((s) => s.id === id);
    if (!step || save.steps.includes(id)) return;
    save.steps.push(id);
    persist(save);
    publish();
  };

  return {
    moved(meters: number) {
      if (!catalog || !catalog.enabled || save.skipped) return;
      movedDistance += meters;
      if (movedDistance >= movedNeeded) stepDone('move');
    },
    notify(signal: TutorialSignal) {
      if (!catalog || !catalog.enabled || save.skipped) return;
      const map: Record<string, string> = {
        'used:noticeboard': 'noticeboard',
        'used:resident': 'neighbor',
        mission_completed: 'task',
      };
      const stepId = map[signal];
      if (stepId) stepDone(stepId);
    },
    tip(id: string) {
      if (!catalog || !catalog.enabled || save.skipped) return;
      if (save.tips.includes(id)) return;
      const tip = catalog.tips.find((tp) => tp.id === id);
      if (!tip) return;
      save.tips.push(id);
      persist(save);
      const t = lang();
      useGameStore.getState().pushToast(`${tip.icon} ${tip.text[t]}`, 'info');
    },
    acceptWelcome() {
      save.welcomeSeen = true;
      persist(save);
      publish();
    },
    skip() {
      if (!catalog) return;
      save.skipped = true;
      for (const s of catalog.steps) if (!save.steps.includes(s.id)) save.steps.push(s.id);
      if (!save.steps.includes('__done__')) save.steps.push('__done__');
      persist(save);
      useGameStore.getState().setTutorial(null);
    },
    refresh() {
      publish();
    },
  };
}

/** Director nulo (sin catálogo): las llamadas del controlador no explotan. */
export function createNullTutorial(): TutorialDirector {
  return {
    notify() {},
    moved() {},
    tip() {},
    acceptWelcome() {},
    skip() {},
    refresh() {},
  };
}
