import type { AbstractEngine, UniversalCamera, Vector3 } from '@babylonjs/core';
import type { PlayerPosition } from '@/game/core/types';
import { B } from './babylon';

export type CamMode = 'edificio' | 'planta' | 'estancia';
const FOV = 0.55;

/** Tres niveles de zoom (edificio, planta y estancia) con transición suave; en planta y estancia sigue al jugador. */
export class CameraRig {
  mode: CamMode = 'edificio';
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
    if (this.mode === 'edificio') {
      viewH = Math.max(this.floors * this.cellH * 1.25, (width * 1.25) / aspect);
    } else {
      viewH = this.mode === 'planta' ? Math.max(this.cellH * 2.4, (width * 1.1) / aspect) : Math.max(this.cellH * 2.0, (this.cellW * 2.2) / aspect);
      const half = (viewH * aspect) / 2;
      cx = half * 2 >= width ? width / 2 : Math.min(width - half, Math.max(half, p.x));
      cy = (p.floor + 0.5) * this.cellH;
    }
    const dist = viewH / (2 * Math.tan(FOV / 2));
    const k = 1 - Math.exp(-dt * 6);
    this.pos.addInPlace(new Vector3(cx + dist * 0.1, cy + dist * 0.05, -dist).subtract(this.pos).scale(k));
    this.look.addInPlace(new Vector3(cx, cy, 0).subtract(this.look).scale(k));
    this.camera.position.copyFrom(this.pos);
    this.camera.setTarget(this.look);
  }
}
