import type { AbstractEngine } from '@babylonjs/core';
import { B } from './babylon';

/**
 * Motor de render: WebGPU si está disponible (con antialias); WebGL2 como red de seguridad.
 * El resto del código solo ve un AbstractEngine, así que no le importa el backend.
 */
export async function createEngine(canvas: HTMLCanvasElement): Promise<{ engine: AbstractEngine; backend: string }> {
  const babylon = B();
  try {
    if (await babylon.WebGPUEngine.IsSupportedAsync) {
      const e = new babylon.WebGPUEngine(canvas, { antialias: true });
      await e.initAsync();
      return { engine: e, backend: 'WebGPU' };
    }
  } catch (err) {
    console.warn('WebGPU no disponible, uso WebGL2', err);
  }
  return { engine: new babylon.Engine(canvas, true), backend: 'WebGL2' };
}
