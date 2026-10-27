import type { DirectionalLight, Mesh, Scene } from '@babylonjs/core';
import type { Content } from '@/game/core/types';
import { B } from './babylon';

/**
 * SOMBRAS DE VERDAD (v1.32) — el vecino: «el fondo me parece muy poco realista, no
 * tenemos ningún tipo de sombras en nuestro edificio».
 *
 * UNA ShadowGenerator sobre el sol direccional del catálogo, con listas de participantes
 * 100% data-driven (rules.view.shadows):
 *  · `casters`  — patrones de nombre de malla que PROYECTAN sombra (edificio, calle,
 *                 árboles, vehículos, vecinos, viandantes…).
 *  · `receivers`— patrones que RECIBEN sombra (suelo del mundo, calle, fachadas y
 *                 forjados del edificio, suelos interiores).
 *  · `excluded` — patrones que jamás participan (planos con alpha-test tipo costados de
 *                 vehículos — proyectarían un rectángulo entero —, cristales, arte 2D).
 *
 * Los recortes ALPHATEST (árboles billboard, maquinaria) proyectan silueta recortada: el
 * pase de profundidad respeta el alpha-test del material. Las mallas que nacen DESPUÉS
 * (rigs glTF asíncronos, pool de tráfico) las caza `refresh()` — barato: compara contra
 * un Set de vistas y solo toca lo nuevo.
 *
 * Solo presentación: el sol no cambia de rumbo (la escena es 2.5D frontal), la intensidad
 * de la sombra la manda la propia luz (de noche y con cielo cerrado se desvanece sola).
 */
export interface ShadowsDirector {
  /** Re-escanea la escena para apuntar mallas nuevas (idempotente, barato). */
  refresh(): void;
  dispose(): void;
}

export function createShadows(scene: Scene, light: DirectionalLight, cfg: Content['rules']['view']['shadows']): ShadowsDirector | null {
  if (!cfg || !cfg.enabled) return null;
  const { ShadowGenerator, RenderTargetTexture } = B();
  const seen = new WeakSet<Mesh>();
  const gen = new ShadowGenerator(cfg.mapSize, light);
  gen.usePercentageCloserFiltering = true;
  gen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  gen.darkness = cfg.darkness;
  gen.bias = cfg.bias;
  gen.normalBias = cfg.normalBias;
  gen.transparencyShadow = true; // los recortes ALPHATEST dejan pasar luz por sus agujeros
  const map = gen.getShadowMap();
  if (map) map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYFRAME;

  const matches = (name: string, patterns: string[]): boolean => patterns.some((p) => name.includes(p));
  const excluded = (name: string): boolean => matches(name, cfg.excluded ?? []);

  const refresh = (): void => {
    for (const mesh of scene.meshes as unknown as Mesh[]) {
      if (seen.has(mesh)) continue;
      seen.add(mesh);
      if (excluded(mesh.name)) continue;
      if (matches(mesh.name, cfg.casters)) gen.addShadowCaster(mesh, false);
      if (matches(mesh.name, cfg.receivers)) mesh.receiveShadows = true;
    }
  };
  refresh();

  return {
    refresh,
    dispose() {
      gen.dispose();
    },
  };
}
