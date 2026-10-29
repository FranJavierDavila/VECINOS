import type { Mesh, Scene, TransformNode } from '@babylonjs/core';
import type { CharacterDetailSpec } from '@/game/core/types';
import { B } from './babylon';

/**
 * PERSONAJE DETALLADO (v1.45) — LOD cercano como ARTE RECORTADO de 4 vistas.
 *
 * Lección aprendida (v1.43/1.44): un personaje construido con primitivas de código
 * NO llega a la calidad de la hoja de personaje. La técnica honesta —la misma que
 * ya usan los árboles y los dioramas del juego— es el BILLBOARD: un quad con el
 * arte recortado del personaje que mira a cámara y CAMBIA DE VISTA (frontal,
 * espalda, perfil izq., perfil der.) según el ángulo entre la cámara y el rumbo
 * del actor. El resultado se ve EXACTAMENTE como la hoja de referencia, porque
 * el arte ES de esa calidad (100% data-driven: character-details.json → art).
 *
 *  · 4 quads hijos (uno por vista), material ALPHATEST (profundidad por píxel:
 *    sin líos de orden con el resto de la escena) y billboardMode Y (siempre
 *    de cara a la cámara, nunca tumbado).
 *  · Animación de "muñeco de papel": rebote al andar + vaivén sutil, respiración
 *    en reposo, balanceo al hablar. Sentado/tumbado NO hay billboard: el rig glTF
 *    muestra sus clips sit/sleep (decisión del bucle de actores).
 *  · Sin arte en el catálogo (spec.art) devuelve null: ese arquetipo se queda
 *    con su rig glTF a TODAS las distancias — jamás un fallback zafio.
 */

/** Estado por frame que la presentación le pasa al billboard. */
export interface DetailFrameState {
  speedH: number;
  gesture: string | null;
  /** Rumbo del actor (rad, convención de rutas: yaw = atan2(−dz, dx)). */
  yaw: number;
  /** Posición de los PIES del actor (el billboard se ancla aquí + rebote). */
  pos: { x: number; y: number; z: number };
  /** Posición de la cámara (para elegir la vista por ángulo). */
  camPos: { x: number; y: number; z: number };
  /** Fundido del actor (0..1) — el mismo del teatro del portal. */
  fade: number;
}

export interface CharacterDetailRig {
  root: TransformNode;
  /** true cuando las 4 vistas están cargadas (quads creados). */
  ready: boolean;
  /** Vista activa ('front'|'back'|'left'|'right') — sonda de verificación. */
  view: string;
  setEnabled(v: boolean): void;
  setFade(v: number): void;
  /** Selección de vista por ángulo + animación de papel. */
  sync(dt: number, state: DetailFrameState): void;
  dispose(): void;
}

type ViewName = 'front' | 'back' | 'left' | 'right';

export function buildCharacterBillboard(scene: Scene, id: string, spec: CharacterDetailSpec, height: number): CharacterDetailRig | null {
  const { Color3, Mesh, MeshBuilder, StandardMaterial, Texture, TransformNode } = B();
  if (!spec || height <= 0 || !spec.art) return null;
  const art = spec.art;

  const root = new TransformNode(`${id}_det_root`, scene);
  const quads = new Map<ViewName, Mesh>();
  let ready = false;
  let view: ViewName = 'front';
  // Signo del lado (perfil izq./der.): se verifica en vivo; el catálogo manda en el arte.
  const SIDE_SIGN = 1;

  let fade = 1;
  let lastFade = -1;

  for (const key of ['front', 'back', 'left', 'right'] as const) {
    const url = art[key];
    if (!url) continue;
    // invertY=true (default de Babylon): sin él, el PNG se pinta boca abajo.
    const tex = new Texture(url, scene, true, true);
    tex.hasAlpha = true;
    const mat = new StandardMaterial(`${id}_det_${key}_mat`, scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.transparencyMode = 1; // ALPHATEST: profundidad por píxel (la lección de los árboles)
    mat.alphaCutOff = 0.35;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;
    tex.onLoadObservable.addOnce(() => {
      if (root.isDisposed()) return;
      const size = tex.getSize();
      const ar = size.width / Math.max(1, size.height);
      const h = height * 1.03; // margen ínfimo sobre la altura del arquetipo
      const q = MeshBuilder.CreatePlane(`${id}_det_${key}`, { width: h * ar, height: h }, scene);
      q.material = mat;
      q.isPickable = false;
      q.position.y = h / 2 - 0.015;
      q.billboardMode = Mesh.BILLBOARDMODE_Y; // siempre de cara a cámara, sin cabecear
      q.setEnabled(false);
      q.visibility = fade;
      q.parent = root;
      quads.set(key, q);
      if (quads.size === 4) ready = true;
    });
  }

  let phase = 0;
  let time = 0;

  return {
    root,
    get ready() {
      return ready;
    },
    get view() {
      return view;
    },
    setEnabled(v: boolean) {
      root.setEnabled(v);
      if (!v) for (const q of quads.values()) q.setEnabled(false);
    },
    setFade(v: number) {
      fade = v;
      if (v === lastFade) return;
      lastFade = v;
      for (const q of quads.values()) q.visibility = v;
    },
    sync(dt: number, state: DetailFrameState) {
      time += dt;
      if (!ready || quads.size === 0) return;

      // ── VISTA por ángulo cámara↔rumbo (convención: facing = (cos yaw, −sin yaw)). ──
      const fx = Math.cos(state.yaw);
      const fz = -Math.sin(state.yaw);
      const dx = state.camPos.x - state.pos.x;
      const dz = state.camPos.z - state.pos.z;
      const len = Math.max(1e-4, Math.hypot(dx, dz));
      const dot = (dx / len) * fx + (dz / len) * fz;
      const side = (fx * (dz / len) - fz * (dx / len)) * SIDE_SIGN;
      const wanted: ViewName = dot > 0.5 ? 'front' : dot < -0.5 ? 'back' : side > 0 ? 'right' : 'left';
      if (wanted !== view || ![...quads.values()].some((q) => q.isEnabled())) {
        view = wanted;
        for (const [k, q] of quads) q.setEnabled(k === view);
      }

      // ── Animación de "muñeco de papel": rebote al andar, balanceo al hablar. ──
      const moving = state.speedH > 0.15;
      if (moving) phase += dt * (3.2 + state.speedH * 1.8);
      const s = Math.sin(phase);
      const bob = moving ? Math.abs(s) * 0.028 * height : 0;
      root.position.set(state.pos.x, state.pos.y + bob, state.pos.z);
      const active = quads.get(view);
      if (active) {
        const g = state.gesture;
        const talk = g === 'talk' || g === 'argue' || g === 'laugh';
        const wobble = moving ? s * 0.05 : talk ? Math.sin(time * 5.2) * 0.045 : Math.sin(time * 0.9) * 0.012;
        active.rotation.z = wobble;
        // Respiración: escala sutil (el quad pivota en los pies gracias al offset y).
        const breath = moving || talk ? 1 : 1 + 0.008 * Math.sin(time * 2.1);
        active.scaling.y = breath;
      }
    },
    dispose() {
      root.dispose(false, true);
      for (const [, q] of quads) {
        const m = q.material as StandardMaterial | null;
        const t = m?.diffuseTexture as Texture | null;
        m?.dispose();
        t?.dispose();
      }
      quads.clear();
    },
  };
}
