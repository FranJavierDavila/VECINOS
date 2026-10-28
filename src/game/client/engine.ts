import type { AbstractEngine } from '@babylonjs/core';
import { B } from './babylon';

/**
 * Motor de render: WebGPU si está disponible (con antialias); WebGL2 como red de seguridad.
 * El resto del código solo ve un AbstractEngine, así que no le importa el backend.
 *
 * v1.39 — MODO QA (?qaengine=1): NullEngine de Babylon (render nulo) para verificar el
 * juego COMPLETO en navegadores headless, donde el WebGL por software agota la memoria del
 * sandbox (OOM mata el proceso del navegador). Con NullEngine corre todo igual — sim, UI,
 * audio, tutorial, menús — solo no se pintan píxeles. Patrón idéntico al ?scenario= de QA.
 */
export async function createEngine(canvas: HTMLCanvasElement): Promise<{ engine: AbstractEngine; backend: string }> {
  const babylon = B();
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('qaengine')) {
    return { engine: new babylon.NullEngine(), backend: 'NullEngine·QA' };
  }
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
