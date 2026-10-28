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
  /** Cutscenes (Fase D): saltar la cinemática en curso (y las encadenadas en cola). */
  cutsceneSkip(): void;
  /** Pulido Steam: siguiente cámara de la rueda (mando Y); calidad de render desde Opciones. */
  cycleCam(): void;
  applyQuality(q: 'eco' | 'normal' | 'alta'): void;
  /** v1.38 — pase de optimización: auto-ajuste de rendimiento y objetivo de FPS desde Opciones. */
  applyPerfAuto(v: boolean): void;
  applyPerfTarget(t: 30 | 45 | 60 | 'max'): void;
  /** v1.39 — música procedural on/off (Opciones) y menú de pausa de verdad. */
  applyMusic(v: boolean): void;
  togglePauseMenu(): void;
  /** Editor de interiores: colocar, quitar y reformar estancias. */
  placeFurniture(block: string, room: string, slot: string, item: string): void;
  removeFurniture(block: string, room: string, slot: string): void;
  renovateRoom(block: string, room: string): void;
  /** Resultado de un minijuego (el modal lo llama al terminar). */
  completeMinigame(id: string, success: boolean): void;
  /** Mandos virtuales: direcciones mantenidas (se combinan con el teclado). */
  setTouchInput(v: Partial<{ left: boolean; right: boolean; up: boolean; down: boolean; run?: boolean }>): void;
  /** Acción de interacción (botón virtual ✋: entrar/salir/usar). */
  interact(): void;
  /** Panel del ascensor (v1.9): elegir planta de destino / cerrar sin llamar. */
  pickElevatorFloor(to: number): void;
  closeElevatorPanel(): void;
  /** Desde el editor: desplazarse a una de tus viviendas. */
  visitHome(blockId: string): void;
  /** Multijugador: crear sesión compartida, unirse por código o salir. */
  hostSession(): void;
  joinSession(code: string): void;
  leaveSession(): void;
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
