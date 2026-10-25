import type { AbstractEngine, UniversalCamera, Vector3 } from '@babylonjs/core';
import type { PlayerPosition } from '@/game/core/types';
import { B } from './babylon';

export type CamMode = 'edificio' | 'planta' | 'estancia';
const FOV = 0.55;

/** Encuadre cinematográfico (cutscenes, Fase D): a dónde vuela la cámara y con qué alto de vista. */
export interface CinematicFrame {
  cx: number;
  cy: number;
  cz: number;
  viewH: number;
}

/** Tres niveles de zoom (edificio, planta y estancia) con transición suave; en planta y estancia sigue al jugador. */
export class CameraRig {
  mode: CamMode = 'edificio';
  /** Mientras no es null (cutscene en curso), update() vuela hacia este encuadre en vez del modo. */
  cinematic: CinematicFrame | null = null;
  /** Plano frontal y calado del edificio (v1.20): para encuadrar los bloques traseros
   *  (apilamiento 3D) a la MISMA distancia que las estancias exteriores. */
  metric: { frontZ: number; depth: number } = { frontZ: 0, depth: 4 };
  /** Encuadre especial de la regla del pasillo de trasteros (v1.21): pitch y offset X
   *  propios — cámara elevada mirando el pasillo de frente para verlo hasta el fondo. */
  framing: { pitch: number; xOff: number } | null = null;
  private readonly pos: Vector3;
  private readonly look: Vector3;

  constructor(
    readonly camera: UniversalCamera,
    private readonly engine: AbstractEngine,
    private readonly cols: number,
    private readonly floors: number,
    private readonly cellW: number,
    private readonly cellH: number,
  ) {
    const { Vector3 } = B();
    this.pos = new Vector3(8, 8, -40);
    this.look = new Vector3(6, 5, 0);
    camera.fov = FOV;
    camera.minZ = 0.1;
  }

  update(dt: number, p: PlayerPosition) {
    const { Vector3 } = B();
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    const width = this.cols * this.cellW;
    let viewH: number;
    let cx = width / 2;
    let cy = (this.floors * this.cellH) / 2;
    let cz = 0; // profundidad del punto de interés (solo estancia: sigue parcialmente al jugador)
    this.framing = null;
    if (this.cinematic) {
      // Cutscene (Fase D): el encuadre lo manda el director; mismo suavizado → transiciones de cine.
      ({ cx, cy, cz, viewH } = this.cinematic);
    } else if (p.storage) {
      // Regla del PASILLO DE TRASTERO (v1.21): perspectiva FRONTAL a nivel, centrada en el
      // eje del pasillo y a media altura — túnel de un punto de fuga: se ve TODO el pasillo
      // hasta el fondo (el personaje llega al final) desde fuera. La fachada del bloque se
      // desvanece mientras el jugador está dentro (building.update) para no tapar la vista.
      // Al salir, p.storage pasa a null y la cámara recupera su comportamiento normal.
      viewH = Math.max(this.cellH * 1.25, 3.2);
      cx = p.storage.cx;
      cy = Math.round(p.floor) * this.cellH + 1.0;
      cz = p.storage.frontZ + 2.2;
      this.framing = { pitch: 0.12, xOff: 0 };
    } else if (this.mode === 'edificio') {
      viewH = Math.max(this.floors * this.cellH * 1.25, (width * 1.25) / aspect);
    } else {
      viewH = this.mode === 'planta' ? Math.max(this.cellH * 2.4, (width * 1.1) / aspect) : Math.max(this.cellH * 2.0, (this.cellW * 2.2) / aspect);
      const half = (viewH * aspect) / 2;
      cx = half * 2 >= width ? width / 2 : Math.min(width - half, Math.max(half, p.x));
      cy = (p.floor + 0.5) * this.cellH;
      // Fase C: en estancia, la cámara se asoma al fondo siguiendo en parte la profundidad (z).
      // v1.20: en un bloque TRASERO (apilamiento 3D, z > calado del bloque principal) la cámara
      // se adelanta hasta el plano del bloque activo: misma distancia de vista que una estancia
      // exterior — el interior no se ve desde lejos ni detrás de la pared divisoria.
      if (this.mode === 'estancia') {
        cz = p.z > this.metric.depth + 0.05
          ? this.metric.frontZ + Math.min(p.z, this.metric.depth + 2.8)
          : Math.min(1.2, Math.max(0, p.z)) * 0.45;
      }
    }
    const dist = viewH / (2 * Math.tan(FOV / 2));
    const k = 1 - Math.exp(-dt * 6);
    const pitch = this.framing ? this.framing.pitch : 0.05;
    const xOff = this.framing ? this.framing.xOff : 0.1;
    this.pos.addInPlace(new Vector3(cx + dist * xOff, cy + dist * Math.sin(pitch), cz - dist * Math.cos(pitch)).subtract(this.pos).scale(k));
    this.look.addInPlace(new Vector3(cx, cy, cz).subtract(this.look).scale(k));
    this.camera.position.copyFrom(this.pos);
    this.camera.setTarget(this.look);
  }

  // ── Encuadres para el director de cutscenes (Fase D) ──

  /** Edificio entero: el mismo marco que el modo 'edificio'. */
  wideFrame(): CinematicFrame {
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    const width = this.cols * this.cellW;
    return {
      cx: width / 2,
      cy: (this.floors * this.cellH) / 2,
      cz: 0,
      viewH: Math.max(this.floors * this.cellH * 1.25, (width * 1.25) / aspect),
    };
  }

  /** Un bloque: centro de su celda a la altura de su planta (viewH en metros). */
  blockFrame(col: number, w: number, floor: number, viewH: number): CinematicFrame {
    return { cx: (col + w / 2) * this.cellW, cy: (floor + 0.5) * this.cellH, cz: 0, viewH };
  }

  /** El jugador: misma regla de recorte horizontal que el modo 'planta'. */
  playerFrame(p: PlayerPosition, viewH: number): CinematicFrame {
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    const width = this.cols * this.cellW;
    const half = (viewH * aspect) / 2;
    const cx = half * 2 >= width ? width / 2 : Math.min(width - half, Math.max(half, p.x));
    return { cx, cy: (p.floor + 0.5) * this.cellH, cz: 0, viewH };
  }

  /**
   * Travelling de cutscene (v1.9): sigue a un ACTOR por su posición de nodo viva (x, y en metros).
   * La altura de mira sale directamente de la Y del nodo (con un pequeño alzado hacia el pecho),
   * así el plano acompaña también los cambios de planta (pozos y escaleras) sin saltos.
   */
  actorFrame(x: number, y: number, viewH: number): CinematicFrame {
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    const width = this.cols * this.cellW;
    const half = (viewH * aspect) / 2;
    const cx = half * 2 >= width ? width / 2 : Math.min(width - half, Math.max(half, x));
    return { cx, cy: y + this.cellH * 0.15, cz: 0, viewH };
  }
}
