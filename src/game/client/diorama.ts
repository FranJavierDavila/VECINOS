'use client';

/**
 * V1.23 — DIORAMAS INTERIORES: capas de billboards con paralaje (estilo diorama).
 * Cada estancia se pinta con arte generado: pared del fondo (quad vertical), suelo
 * (quad tumbado) y 2-3 capas de mobiliario como sprites (quads con recorte alpha)
 * repartidos en profundidad. Los personajes se intercalan entre capas por la prueba
 * de profundidad real: quien camina por delante de un sofá lo tapa; por detrás, el
 * sofá lo tapa a él. La cámara casi fija da el paralaje gratis (planos a distinta z).
 *
 * Los sprites llegan sobre blanco → recorte de fondo por FLOOD-FILL desde los bordes
 * en un canvas intermedio (sin dependencias nativas; el blanco INTERIOR de los objetos
 * sobrevive porque solo se inunda lo conectado al borde). Al recortar se mide la caja
 * del contenido y el quad se reescala preservando aspecto (sin muñecos estirados).
 *
 * Data-driven total: public/content/interiors.json. Sin catálogo, cero dioramas
 * (greybox de siempre) — el juego funciona exactamente igual.
 */

import type { Mesh, Scene, StandardMaterial, DynamicTexture, TransformNode } from '@babylonjs/core';
import type { Content } from '@/game/core/types';
import { B } from './babylon';

export interface DioramaSurface {
  mesh: Mesh;
  mat: StandardMaterial;
}

export interface DioramaRoom {
  wall: DioramaSurface[];
  floor: DioramaSurface | null;
  sprites: DioramaSurface[];
  door: DioramaSurface | null;
}

export interface DioramaDirector {
  /** Crea el diorama de una estancia (rect local en metros desde la esquina frontal-izq). */
  room(
    id: string,
    defId: string,
    rect: { x: number; z: number; w: number; d: number },
    origin: { x0: number; frontZ: number; yBottom: number; yTop: number },
    opts?: { withRearDoor?: boolean; wallGap?: { a: number; b: number } | null; parent?: TransformNode },
  ): DioramaRoom | null;
  dispose(): void;
}

/** Caja del contenido visible (alpha > umbral) del canvas. Exportada: los recortes de
 *  árboles del exterior (v1.24) reutilizan el mismo encaje que los dioramas. */
export function alphaBoundsOf(c: HTMLCanvasElement): { x0: number; y0: number; x1: number; y1: number } | null {
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const { width: W, height: H } = c;
  const d = ctx.getImageData(0, 0, W, H).data;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (d[(y * W + x) * 4 + 3]! > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** Vuelca el blanco de fondo a alpha (flood-fill 4-conexo desde los bordes). Exportado:
 *  v1.24 lo reutiliza para los RECORTEs de árboles del exterior. */
export function stripWhite(c: HTMLCanvasElement, hex: string, tolerance: number, alphaCutoff: number): void {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const W = c.width;
  const H = c.height;
  const img = ctx.getImageData(0, 0, W, H);
  const data = img.data;
  const kr = parseInt(hex.slice(1, 3), 16) || 255;
  const kg = parseInt(hex.slice(3, 5), 16) || 255;
  const kb = parseInt(hex.slice(5, 7), 16) || 255;
  const tol = tolerance * 255;
  const visited = new Uint8Array(W * H);
  const stack: number[] = [];
  const near = (p: number): boolean =>
    Math.abs(data[p * 4]! - kr) < tol && Math.abs(data[p * 4 + 1]! - kg) < tol && Math.abs(data[p * 4 + 2]! - kb) < tol;
  const push = (x: number, y: number): void => {
    const p = y * W + x;
    if (!visited[p] && near(p)) {
      visited[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < W; x++) {
    push(x, 0);
    push(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    push(0, y);
    push(W - 1, y);
  }
  while (stack.length > 0) {
    const p = stack.pop()!;
    data[p * 4 + 3] = 0;
    const x = p % W;
    const y = (p / W) | 0;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }
  // Anti-sierra barato: píxeles opacos casi rodeados de transparencia bajan de alpha.
  const a2 = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) a2[p] = data[p * 4 + 3]!;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (a2[p] === 0) continue;
      const n =
        (a2[p - 1]! < 64 ? 1 : 0) + (a2[p + 1]! < 64 ? 1 : 0) + (a2[p - W]! < 64 ? 1 : 0) + (a2[p + W]! < 64 ? 1 : 0);
      if (n >= 3) data[p * 4 + 3] = Math.round(255 * alphaCutoff * 0.8);
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function createDioramaDirector(scene: Scene, content: Content): DioramaDirector | null {
  const cat = content.interiors;
  if (!cat) return null;
  const { StandardMaterial, Color3, DynamicTexture, MeshBuilder } = B();

  const mats: StandardMaterial[] = [];
  const meshes: Mesh[] = [];
  /** Caché de texturas por (fichero|keyed|uScale|vScale): los pisos repiten layout —
   *  la misma DynamicTexture sirve a decenas de estancias (memoria y subidas). */
  const texCache = new Map<string, { dt: DynamicTexture; ar: number | null; onTrim: Array<(ar: number) => void>; loaded: boolean }>();

  const S = cat.processSize;

  const artTex = (
    name: string,
    file: string,
    keyed: boolean,
    uScale = 1,
    vScale = 1,
    onTrim?: (ar: number) => void,
  ): DynamicTexture => {
    const key = `${file}|${keyed ? 1 : 0}|${uScale}|${vScale}`;
    const hit = texCache.get(key);
    if (hit) {
      if (onTrim) {
        if (hit.loaded && hit.ar !== null) onTrim(hit.ar);
        else hit.onTrim.push(onTrim);
      }
      return hit.dt;
    }
    const dt = new DynamicTexture(name, { width: S, height: S }, scene, true);
    const dctx = dt.getContext() as unknown as CanvasRenderingContext2D;
    dctx.clearRect(0, 0, S, S);
    dt.update(true);
    if (keyed) dt.hasAlpha = true;
    dt.uScale = uScale;
    dt.vScale = vScale;
    const entry: { dt: DynamicTexture; ar: number | null; onTrim: Array<(ar: number) => void>; loaded: boolean } = {
      dt,
      ar: null,
      onTrim: onTrim ? [onTrim] : [],
      loaded: false,
    };
    texCache.set(key, entry);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = S;
      c.height = S;
      const cx = c.getContext('2d', { willReadFrequently: true });
      if (!cx) return;
      cx.drawImage(img, 0, 0, S, S);
      if (keyed) {
        stripWhite(c, cat.keyColor, cat.keyTolerance, cat.alphaCutoff);
        const b = alphaBoundsOf(c);
        if (b) {
          const bw = Math.max(1, b.x1 - b.x0);
          const bh = Math.max(1, b.y1 - b.y0);
          entry.ar = bw / bh;
          dctx.clearRect(0, 0, S, S);
          dctx.drawImage(c, b.x0, b.y0, bw, bh, 0, 0, S, S);
        } else {
          dctx.drawImage(c, 0, 0);
        }
      } else {
        dctx.drawImage(c, 0, 0);
      }
      dt.update(true);
      entry.loaded = true;
      for (const cb of entry.onTrim) cb(entry.ar ?? 1);
      entry.onTrim.length = 0;
    };
    img.onerror = () => console.warn(`diorama: arte no disponible (${file})`);
    img.src = cat.artBase + file;
    return dt;
  };

  const surfMat = (name: string, keyed: boolean): StandardMaterial => {
    const m = new StandardMaterial(name, scene);
    m.specularColor = new Color3(0.02, 0.02, 0.02);
    m.diffuseColor = new Color3(1, 1, 1);
    m.backFaceCulling = true;
    if (keyed) {
      m.transparencyMode = 2; // ALPHATEST: recorte duro, sin líos de orden con los actores
      m.alphaCutOff = cat.alphaCutoff;
    }
    mats.push(m);
    return m;
  };

  const quad = (
    name: string,
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    m: StandardMaterial,
    flat: boolean,
  ): Mesh => {
    const q = MeshBuilder.CreatePlane(name, { width: w, height: h }, scene);
    if (flat) q.rotation.x = Math.PI / 2;
    q.position.set(x, y, z);
    q.material = m;
    q.isPickable = false;
    q.doNotSyncBoundingInfo = true;
    q.alwaysSelectAsActiveMesh = false;
    meshes.push(q);
    return q;
  };

  return {
    room(id, defId, rect, origin, opts) {
      const dio = cat.rooms[defId];
      if (!dio) return null;
      const cx = origin.x0 + rect.x + rect.w / 2;
      const slabTop = origin.yBottom;
      const wallH = origin.yTop - origin.yBottom;
      const backZ = origin.frontZ + rect.z + rect.d;
      const floorY = slabTop + 0.035;
      /** Todos los quads de la estancia cuelgan de esta raíz (visibilidad por bloque). */
      const roomRoot = opts?.parent ?? null;
      const place = (q: Mesh): void => {
        if (roomRoot) q.parent = roomRoot;
      };

      // ── Pared del fondo: quad(s) con el arte (respeta el hueco de la puerta trasera).
      // v1.24: cada tramo se SOLAPA 1 cm por lado — sin costuras blancas entre quads
      // contiguos (estancias vecinas comparten borde y el anti-aliasing abría una raja). ──
      const wall: DioramaSurface[] = [];
      const wallMat = surfMat(`${id}_dio_pared`, false);
      const wallTiles = Math.max(1, Math.round(rect.w / Math.max(0.6, wallH)));
      wallMat.diffuseTexture = artTex(`${id}_dio_pared_tex`, dio.wall, false, wallTiles, 1);
      const gap = opts?.wallGap ?? null;
      const SEAM = 0.01;
      const segs: Array<[number, number]> = gap
        ? [
            [rect.x, gap.a - origin.x0],
            [gap.b - origin.x0, rect.x + rect.w],
          ]
        : [[rect.x, rect.x + rect.w]];
      for (const [a0, b0] of segs) {
        const a = a0 - SEAM;
        const b = b0 + SEAM;
        const sw = b - a;
        if (sw < 0.05) continue;
        const q = quad(`${id}_dio_pared`, sw, wallH, origin.x0 + a + sw / 2, slabTop + wallH / 2, backZ - 0.09, wallMat, false);
        place(q);
        wall.push({ mesh: q, mat: wallMat });
      }

      // ── Puerta trasera (decal sobre la pared cuando hay otro bloque detrás) ──
      let door: DioramaSurface | null = null;
      if (opts?.withRearDoor && cat.doorDecal) {
        const dmat = surfMat(`${id}_dio_puerta`, true);
        const dh = Math.min(cat.doorDecal.h, wallH * 0.96);
        const dw0 = (dh * cat.doorDecal.w) / cat.doorDecal.h;
        dmat.diffuseTexture = artTex(`${id}_dio_puerta_tex`, cat.doorDecal.art, true, 1, 1, (ar) => {
          const nw = Math.min(dw0, dh * ar);
          const nh = nw / ar;
          dm.scaling.set(nw, nh, 1);
          dm.position.y = slabTop + nh / 2 + 0.01;
        });
        const dx = gap ? (gap.a + gap.b) / 2 : cx;
        const dm = quad(`${id}_dio_puerta`, dw0, dh, dx, slabTop + dh / 2 + 0.01, backZ - 0.06, dmat, false);
        place(dm);
        door = { mesh: dm, mat: dmat };
      }

      // ── Suelo: quad tumbado con el arte teselado (sin estirar) ──
      const floorMat = surfMat(`${id}_dio_suelo`, false);
      const fu = Math.max(1, Math.round(rect.w / 2.4));
      const fv = Math.max(1, Math.round(rect.d / 2.4));
      floorMat.diffuseTexture = artTex(`${id}_dio_suelo_tex`, dio.floor, false, fu, fv);
      const fq = quad(`${id}_dio_suelo`, rect.w, rect.d, cx, floorY, origin.frontZ + rect.z + rect.d / 2, floorMat, true);
      place(fq);
      const floor: DioramaSurface = { mesh: fq, mat: floorMat };

      // ── Capas de mobiliario (billboards con paralaje): quad 1×1 reescalado al recorte.
      // La capa 'rug' es distinta: alfombra TUMBADA en el suelo (quad plano), h = calado. ──
      const sprites: DioramaSurface[] = [];
      for (const [i, sp] of dio.sprites.entries()) {
        const m = surfMat(`${id}_dio_sp${i}`, true);
        const z = origin.frontZ + rect.z + sp.v * rect.d;
        const x = origin.x0 + rect.x + sp.u * rect.w;
        if (sp.layer === 'rug') {
          const rq = quad(`${id}_dio_sp${i}`, sp.w, sp.h, x, floorY + 0.012, z, m, true);
          m.diffuseTexture = artTex(`${id}_dio_sp${i}_tex`, sp.art, true, 1, 1, (ar) => {
            // Alfombra: encaja el recorte en la caja w × h (h es calado) sin deformar.
            const boxAr = sp.w / sp.h;
            const nw = boxAr > ar ? sp.h * ar : sp.w;
            const nd = boxAr > ar ? sp.h : sp.w / ar;
            rq.scaling.set(nw, nd, 1);
          });
          place(rq);
          sprites.push({ mesh: rq, mat: m });
          continue;
        }
        const mesh = quad(`${id}_dio_sp${i}`, sp.w, sp.h, x, slabTop + sp.y + sp.h / 2, z, m, false);
        m.diffuseTexture = artTex(`${id}_dio_sp${i}_tex`, sp.art, true, 1, 1, (ar) => {
          // Caja declarada (w, h) → encajar el contenido sin deformar (cobra el mayor eje).
          const boxAr = sp.w / sp.h;
          const nw = boxAr > ar ? sp.h * ar : sp.w;
          const nh = boxAr > ar ? sp.h : sp.w / ar;
          mesh.scaling.set(nw, nh, 1);
          mesh.position.y = slabTop + sp.y + nh / 2;
        });
        place(mesh);
        sprites.push({ mesh, mat: m });
      }

      return { wall, floor, sprites, door };
    },
    dispose() {
      for (const m of mats) m.dispose();
      for (const mesh of meshes) mesh.dispose();
      for (const t of texCache.values()) t.dt.dispose();
      texCache.clear();
      mats.length = 0;
      meshes.length = 0;
    },
  };
}

/** Colección de dioramas de un bloque (tinte nocturno por estancia en building). */
export interface DioramaSet {
  rooms: Map<string, DioramaRoom>;
}

export function newDioramaSet(): DioramaSet {
  return { rooms: new Map() };
}
