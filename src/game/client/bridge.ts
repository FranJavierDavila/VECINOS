'use client';

/**
 * Puente entre la UI React y el controlador del juego.
 * El controlador (que depende de Babylon) se carga dinámicamente en el cliente;
 * la página y los componentes solo conocen esta interfaz, sin importar Babylon.
 */

export type CamModeBridge = 'edificio' | 'planta' | 'estancia';
export type SpeedBridge = 1 | 3 | 10;

export interface GameControllerApi {
  onKeyDown(code: string): void;
  onKeyUp(code: string): void;
  togglePause(): void;
  setSpeed(speed: SpeedBridge): void;
  setCamMode(mode: CamModeBridge): void;
  partyDemo(): void;
  skipTime(): void;
  phoneNext(): void;
  choose(choiceId: string): void;
  juntaVote(vote: 'yes' | 'no'): void;
  finaleClose(): void;
  /** Editor de interiores: colocar, quitar y reformar estancias. */
  placeFurniture(block: string, room: string, slot: string, item: string): void;
  removeFurniture(block: string, room: string, slot: string): void;
  renovateRoom(block: string, room: string): void;
  /** Resultado de un minijuego (el modal lo llama al terminar). */
  completeMinigame(id: string, success: boolean): void;
  /** Mandos virtuales: direcciones mantenidas (se combinan con el teclado). */
  setTouchInput(v: Partial<{ left: boolean; right: boolean; up: boolean; down: boolean }>): void;
  /** Acción de interacción (botón virtual ✋: entrar/salir/usar). */
  interact(): void;
  /** Desde el editor: desplazarse a una de tus viviendas. */
  visitHome(blockId: string): void;
  save(): Promise<void>;
  load(): Promise<void>;
}

let current: GameControllerApi | null = null;

export function setController(c: GameControllerApi | null): void {
  current = c;
}

export function getController(): GameControllerApi | null {
  return current;
}
