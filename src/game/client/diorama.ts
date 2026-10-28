'use client';

/**
 * V1.23 — DIORAMAS INTERIORES: capas de billboards con paralaje (estilo diorama).
 * Cada estancia se pinta con arte generado: pared del fondo (quad vertical), suelo
 * (quad tumbado) y 2-3 capas de mobiliario como sprites (quads con recorte alpha)
 * repartidos en profundidad. Los personajes se intercalan entre capas por la prueba
 * de profundidad real: quien camina por delante de un sofá lo tapa; por detrás, el
 * sofá lo tapa a él. La cámara casi fija da el paralaje gratis (planos a distinta z).
 *
 * v1.29 — PARALLAX COMPLETO (petición del vecino): «mapear con efecto parallax los
 * interiores de las viviendas nos referíamos a TODAS las paredes interiores: fondo,
 * lados, techo y suelo». El director añade `shell()`: laterales y techo de la
 * VIVIENDA con arte propio (por dwelling, sin recortar las estancias — la vivienda
 * se lee como un único bloque), y las estancias eligen su variante entre
 * walls × floors × sets (más de 10 interiores distintos por tipo, repartidos por
 * hash determinista del bloque — jamás RNG del sim). Los recortes de mobiliario
 * JAMÁS se solapan entre sí ni invaden el hueco de la puerta: reintentos
 * deterministas (el mismo patrón que las macetas con las puertas).
 *
 * Los sprites llegan sobre blanco → recorte de fondo por FLOOD-FILL desde los bordes
 * en un canvas intermedio (sin dependencias nativas; el blanco INTERIOR de los objetos
 * sobrevive porque solo se inunda lo conectado al borde). Al recortar se mide la caja
 * del contenido y el quad se reescala preservando aspecto (sin muñecos estirados).
 *
 * Data-driven total: public/content/interiors.json. Sin catálogo, cero dioramas
 * (greybox de siempre) — el juego funciona exactamente igual.
 */

import type { Mesh, Scene, StandardMaterial, Texture, TransformNode } from '@babylonjs/core';
import type { Content } from '@/game/core/types';
import { hash01 } from '@/game/interior';
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

export interface DioramaVariant {
  /** Tinte multiplicativo de la pared del fondo (variedad aleatoria entre viviendas). */
  tintHex: string;
  /** Espejar el reparto de muebles (u → 1−u). */
  mirror: boolean;
  /** Desplazamiento uniforme de los sprites, en fracciones del rect (±jitter). */
  jitter: number;
  /** Índice de la pared alternativa (dio.walls) para esta estancia. */
  wallIndex: number;
  /** Sal para jitter determinista por estancia (mismo bloque, distinta sal por habitación). */
  salt: number;
}

export interface DioramaDirector {
  /** Crea el diorama de una estancia (rect local en metros desde la esquina frontal-izq). */
  room(
    id: string,
    defId: string,
    rect: { x: number; z: number; w: number; d: number },
    origin: { x0: number; frontZ: number; yBottom: number; yTop: number },
    opts?: {
      withRearDoor?: boolean;
      wallGap?: { a: number; b: number } | null;
      parent?: TransformNode;
      variant?: DioramaVariant;
    },
  ): DioramaRoom | null;
  /**
   * v1.29 — CARCASO de la vivienda: laterales (arte a ambas caras interiores) y techo con
   * arte, UNA vez por bloque de vivienda (las estancias comparten carcaso — un solo bloque).
   * Las caras quedan 2 cm por dentro de los muros estructurales (regla de la casa: nada
   * coplanar) y cuelgan del `parent` del bloque (visibilidad espejo de la fachada).
   */
  shell(
    id: string,
    span: { w: number; d: number },
    origin: { x0: number; frontZ: number; yBottom: number; yTop: number },
    opts?: { parent?: TransformNode; sideGap?: number },
  ): DioramaSurface[];
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

/** Vuelca el fondo de un PNG a alpha (flood-fill 4-conexo desde los bordes) contra una lista
 *  de colores llave. Exportado: los recortes de árboles (v1.24) y las PUERTAS full-bleed
 *  (v1.25) reutilizan la misma maquinaria que los dioramas. */
export function stripBackground(c: HTMLCanvasElement, hexes: string[], tolerance: number, alphaCutoff: number): void {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx || hexes.length === 0) return;
  const W = c.width;
  const H = c.height;
  const img = ctx.getImageData(0, 0, W, H);
  const data = img.data;
  const keys = hexes.map((hex) => ({
    r: parseInt(hex.slice(1, 3), 16) || 255,
    g: parseInt(hex.slice(3, 5), 16) || 255,
    b: parseInt(hex.slice(5, 7), 16) || 255,
  }));
  const tol = tolerance * 255;
  const visited = new Uint8Array(W * H);
  const stack: number[] = [];
  const near = (p: number): boolean => {
    const r = data[p * 4]!;
    const g = data[p * 4 + 1]!;
    const b = data[p * 4 + 2]!;
    for (const k of keys) {
      if (Math.abs(r - k.r) < tol && Math.abs(g - k.g) < tol && Math.abs(b - k.b) < tol) return true;
    }
    return false;
  };
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

/** Recorta el FONDO de una ilustración (pared/suelo cocinados alrededor de una puerta o
 *  mueble) usando los colores de las 4 esquinas como llaves. Exportado para puertas de
 *  vivienda/escalera/ascensor (v1.25): la hoja queda a sangre completa. */
export function stripCorners(c: HTMLCanvasElement, tolerance: number): void {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const W = c.width;
  const H = c.height;
  const px = (x: number, y: number): string => {
    const d = ctx.getImageData(x, y, 1, 1).data;
    return `#${[d[0]!, d[1]!, d[2]!].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  };
  stripBackground(c, [px(1, 1), px(W - 2, 1), px(1, H - 2), px(W - 2, H - 2)], tolerance, 0.45);
}

/** Vuelca el blanco de fondo a alpha (flood-fill 4-conexo desde los bordes). Exportado:
 *  v1.24 lo reutiliza para los RECORTEs de árboles del exterior. */
export function stripWhite(c: HTMLCanvasElement, hex: string, tolerance: number, alphaCutoff: number): void {
  stripBackground(c, [hex], tolerance, alphaCutoff);
}

export function createDioramaDirector(scene: Scene, content: Content): DioramaDirector | null {
  const cat = content.interiors;
  if (!cat) return null;
  const { StandardMaterial, Color3, MeshBuilder } = B();

  const mats: StandardMaterial[] = [];
  const meshes: Mesh[] = [];
  /** Caché de texturas por (fichero|keyed|uScale|vScale): los pisos repiten layout —
   *  la misma textura sirve a decenas de estancias (memoria y subidas).
   *  v1.26 — la subida sale por TEXTURE(dataURL): los DynamicTexture alimentados desde
   *  canvas pierden el canal alpha en esta config (WebGPU/CDN — diagnóstico v1.25: los
   *  píxeles alpha=0 se renderizan a NEGRO) y los recortes con rendijas (plantas, patas
   *  de muebles) se veían con fondo negro. El PNG dataURL decodificado por Image y
   *  subido como Texture conserva el alpha íntegro — verificado en v1.25. */
  const texCache = new Map<string, { dt: Texture; ar: number | null; onTrim: Array<(ar: number) => void>; loaded: boolean }>();

  const S = cat.processSize;

  const artTex = (
    name: string,
    file: string,
    keyed: boolean,
    uScale = 1,
    vScale = 1,
    onTrim?: (ar: number) => void,
  ): Texture => {
    const key = `${file}|${keyed ? 1 : 0}|${uScale}|${vScale}`;
    const hit = texCache.get(key);
    if (hit) {
      if (onTrim) {
        if (hit.loaded && hit.ar !== null) onTrim(hit.ar);
        else hit.onTrim.push(onTrim);
      }
      return hit.dt;
    }
    // invertY=true: igual que el DynamicTexture de siempre — el canvas se dibuja
    // top-down y los quads lo esperan así (las puertas/muebles jamás salieron cabeza abajo).
    // Placeholder PNG 1×1 válido: updateURL(refresco real) llega con el decode del arte.
    const dt = new (B().Texture)(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      scene,
      false,
      true,
    );
    dt.name = name;
    dt.uScale = uScale;
    dt.vScale = vScale;
    if (keyed) dt.hasAlpha = true;
    const entry: { dt: Texture; ar: number | null; onTrim: Array<(ar: number) => void>; loaded: boolean } = {
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
          const c2 = document.createElement('canvas');
          c2.width = S;
          c2.height = S;
          c2.getContext('2d')?.drawImage(c, b.x0, b.y0, bw, bh, 0, 0, S, S);
          dt.updateURL(c2.toDataURL('image/png'));
        } else {
          dt.updateURL(c.toDataURL('image/png'));
        }
      } else {
        dt.updateURL(c.toDataURL('image/png'));
      }
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
    // v1.29 — NOTA: con disableLighting el shader de StandardMaterial ignora el término
    // difuso (solo emissive) y el arte se ve NEGRO — verificado en vivo. El brillo del
    // interior sale de la hemisférica con su groundColor elevado (controller) + el glow
    // nocturno del catálogo; la capa de bloom excluye estas mallas (glowExcluded).
    if (keyed) {
      m.transparencyMode = 2; // ALPHATEST: recorte duro, sin líos de orden con los actores
      m.alphaCutOff = cat.alphaCutoff;
      // v1.26 — CRÍTICO: Babylon 8 dejó el default de useAlphaFromDiffuseTexture en FALSE.
      // Sin esto, el alpha de la textura JAMÁS entra en el alpha del shader (el compilado
      // hace alpha=vDiffuseColor.a y el ALPHATEST ve 1.0 siempre) → los recortes se veían
      // con FONDO NEGRO (la lámpara leía como un tabique; plantas con halo negro).
      m.useAlphaFromDiffuseTexture = true;
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

  /** v1.29 — REPARTO SIN SOLAPES: coloca los u de sprites declarados para que sus cajas
   *  (ancho real en fracción del rect) no se toquen entre sí y queden DENTRO de la
   *  estancia. Determinista: orden por u original, empuje hacia la derecha y vuelta por
   *  los extremos; los sprites de alfombra (rug, tumbados) no participan. */
  const spreadU = (
    items: { u: number; w: number }[],
    rectW: number,
    salt: number,
    id: string,
  ): number[] => {
    const idx = items.map((_, i) => i);
    const half = items.map((sp) => Math.min(0.47, sp.w / Math.max(0.4, rectW) / 2));
    // Orden de colocación: de izquierda a derecha por su u original (estable).
    idx.sort((a, z) => items[a]!.u - items[z]!.u || a - z);
    const placed = new Map<number, number>();
    let cursor = 0.02 + half[idx[0]!]!;
    for (const i of idx) {
      const h = half[i]!;
      let u = Math.max(cursor + h, Math.min(0.98 - h, Math.max(h + 0.02, items[i]!.u)));
      if (u < cursor + h) u = cursor + h; // empujado por el vecino anterior
      placed.set(i, u);
      cursor = u + h + 0.015; // holgura entre muebles (nunca se intersequen)
    }
    // Si al final se sale del rect, segunda pasada hacia atrás (desde el borde derecho).
    if (cursor > 1.0) {
      let rc = 0.98;
      for (let k = idx.length - 1; k >= 0; k--) {
        const i = idx[k]!;
        const h = half[i]!;
        const u = Math.min(rc - h, placed.get(i)!);
        placed.set(i, Math.max(h + 0.02, u));
        rc = placed.get(i)! - h - 0.015;
      }
    }
    // Micro-jitter determinista (±1 cm en fracción) con la sal de la estancia.
    return items.map((_, i) => {
      const j = (hash01(id, 9100 + salt + i) - 0.5) * 0.02;
      const h = half[i]!;
      return Math.min(0.98 - h, Math.max(h + 0.02, placed.get(i)! + j));
    });
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
      // contiguos (estancias vecinas comparten borde y el anti-aliasing abría una raja).
      // v1.25: arte alternativo por `walls` + tinte de la variante (variedad aleatoria). ──
      const variant = opts?.variant ?? null;
      const wall: DioramaSurface[] = [];
      const wallMat = surfMat(`${id}_dio_pared`, false);
      if (variant) wallMat.diffuseColor = Color3.FromHexString(variant.tintHex);
      const wallArt = variant && dio.walls.length > 0 ? dio.walls[variant.wallIndex % dio.walls.length]! : dio.wall;
      // v1.36 — wallTiles del catálogo (artes PANORÁMICOS como el hall del portal se ven UNA
      // vez); sin él, la estimación de siempre (redondeo del rect) para las artes cuadradas.
      const wallTiles = dio.wallTiles ?? Math.max(1, Math.round(rect.w / Math.max(0.6, wallH)));
      wallMat.diffuseTexture = artTex(`${id}_dio_pared_tex`, wallArt, false, wallTiles, 1);
      // v1.29 — PARED COMPLETA: la pared del fondo ya no se parte alrededor de la puerta
      // trasera (el hueco dejaba un VACÍO por el que se veía el fondo urbano a oscuras —
      // la banda negra sobre los interiores). La pared es continua y la puerta trasera es
      // un DECAL pegado encima (su arte trae marco); al activarse el bloque trasero el
      // bloque principal entero se desvanece (apilamiento 3D) y el paso queda libre.
      const SEAM = 0.01;
      const segs: Array<[number, number]> = [[rect.x, rect.x + rect.w]];
      for (const [a0, b0] of segs) {
        const a = a0 - SEAM;
        const b = b0 + SEAM;
        const sw = b - a;
        if (sw < 0.05) continue;
        const q = quad(`${id}_dio_pared`, sw, wallH, origin.x0 + a + sw / 2, slabTop + wallH / 2, backZ - 0.09, wallMat, false);
        place(q);
        wall.push({ mesh: q, mat: wallMat });
      }

      // ── Puerta trasera (decal sobre la pared continua cuando hay otro bloque detrás) ──
      let door: DioramaSurface | null = null;
      if (opts?.withRearDoor && cat.doorDecal) {
        const gap = opts?.wallGap ?? null;
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

      // ── Suelo: quad tumbado con el arte teselado (sin estirar). v1.29: VARIANTE por
      // hash (floors[]) — el vecino pidió variedad de suelos dentro de las ≥10 variaciones. ──
      const floorMat = surfMat(`${id}_dio_suelo`, false);
      const floorArt = dio.floors.length > 0 ? dio.floors[(variant?.wallIndex ?? 0) % dio.floors.length]! : dio.floor;
      const fu = Math.max(1, Math.round(rect.w / 2.4));
      const fv = Math.max(1, Math.round(rect.d / 2.4));
      floorMat.diffuseTexture = artTex(`${id}_dio_suelo_tex`, floorArt, false, fu, fv);
      const fq = quad(`${id}_dio_suelo`, rect.w, rect.d, cx, floorY, origin.frontZ + rect.z + rect.d / 2, floorMat, true);
      place(fq);
      const floor: DioramaSurface = { mesh: fq, mat: floorMat };

      // ── Capas de mobiliario (billboards con paralaje): quad 1×1 reescalado al recorte.
      // La capa 'rug' es distinta: alfombra TUMBADA en el suelo (quad plano), h = calado.
      // v1.25: la variante espeja (u → 1−u) y menea (jitter determinista) el reparto.
      // v1.29: JUEGO DE MOBILIARIO (sets[]) por hash + REPARTO SIN SOLAPES — los recortes
      // jamás se intersecan entre sí (el vecino: «los recortes nunca intersequen ni paredes
      // ni otros muebles») y quedan dentro de la estancia. ──
      const sprites: DioramaSurface[] = [];
      const jit = variant?.jitter ?? 0;
      const setList = dio.sets.length > 0 ? dio.sets : [dio.sprites];
      const chosenSet = setList[(variant?.wallIndex ?? 0) % setList.length]!;
      const standing = chosenSet.filter((sp) => sp.layer !== 'rug');
      const us = spreadU(
        standing.map((sp) => ({ u: variant?.mirror ? 1 - sp.u : sp.u, w: sp.w })),
        rect.w,
        variant?.salt ?? 0,
        id,
      );
      let uCursor = 0;
      for (const [i, sp] of chosenSet.entries()) {
        const m = surfMat(`${id}_dio_sp${i}`, true);
        const z = origin.frontZ + rect.z + sp.v * rect.d;
        let x: number;
        if (sp.layer === 'rug') {
          const u0 = Math.min(0.94, Math.max(0.06, variant?.mirror ? 1 - sp.u : sp.u));
          x = origin.x0 + rect.x + u0 * rect.w;
        } else {
          const u = us[uCursor++]! + jit * (hash01(id, 9000 + (variant?.salt ?? 0)) - 0.5) * 2;
          x = origin.x0 + rect.x + Math.min(0.94, Math.max(0.06, u)) * rect.w;
        }
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

    /** v1.29 — CARCASO de la vivienda (laterales + techo con arte): UNA llamada por bloque. */
    shell(id, span, origin, opts) {
      const dio = cat.shell;
      const out: DioramaSurface[] = [];
      if (!dio) return out;
      const wallH = origin.yTop - origin.yBottom;
      const gap = opts?.sideGap ?? 0.02; // holgura con los muros estructurales (nada coplanar)
      const parent = opts?.parent ?? null;
      const put = (q: Mesh): void => {
        if (parent) q.parent = parent;
      };
      // LATERALES: el arte corre según el calado (uScale por metros); cada cara mira HACIA
      // DENTRO de la vivienda. Arte por hash del id (sideWalls[]) + tinte suave del tinte
      // global del catálogo para que case con el fondo de sus estancias.
      const sideArt = dio.sideWalls.length > 0 ? dio.sideWalls[Math.floor(hash01(id, 7600) * dio.sideWalls.length) % dio.sideWalls.length]! : null;
      const sideTiles = Math.max(1, Math.round(span.d / Math.max(0.6, wallH)));
      if (sideArt && span.d > 0.3) {
        const matL = surfMat(`${id}_dio_lateral_izq`, false);
        matL.diffuseColor = Color3.FromHexString(dio.tint);
        // v1.29 — caras del carcaso mirando hacia dentro (±X): visibles SIEMPRE (doble cara;
        // verificado en vivo) y levantadas por el groundColor de la hemisférica.
        matL.backFaceCulling = false;
        matL.diffuseTexture = artTex(`${id}_dio_lateral_izq_tex`, sideArt, false, sideTiles, 1);
        const qL = quad(`${id}_dio_lateral_izq`, span.d, wallH, origin.x0 + gap, origin.yBottom + wallH / 2, origin.frontZ + span.d / 2, matL, false);
        qL.rotation.y = Math.PI / 2; // mira a +X (hacia dentro)
        put(qL);
        out.push({ mesh: qL, mat: matL });
        const matR = surfMat(`${id}_dio_lateral_der`, false);
        matR.diffuseColor = Color3.FromHexString(dio.tint);
        matR.backFaceCulling = false;
        matR.diffuseTexture = artTex(`${id}_dio_lateral_der_tex`, sideArt, false, sideTiles, 1);
        const qR = quad(`${id}_dio_lateral_der`, span.d, wallH, origin.x0 + span.w - gap, origin.yBottom + wallH / 2, origin.frontZ + span.d / 2, matR, false);
        qR.rotation.y = -Math.PI / 2; // mira a −X (hacia dentro)
        put(qR);
        out.push({ mesh: qR, mat: matR });
      }
      // TECHO: arte por hash (ceilings[]), teselado por metros, mirando HACIA ABAJO y 2 cm
      // por debajo del forjado estructural (nada coplanar). Autoiluminado (caras −Y sin luz).
      // v1.29-FIX: rotation.x = +π/2 — la MISMA convención que el suelo (verificado en vivo:
      // con −π/2 la cara quedaba culled desde abajo y el forjado del bloque se veía NEGRO).
      const ceilArt = dio.ceilings.length > 0 ? dio.ceilings[Math.floor(hash01(id, 7700) * dio.ceilings.length) % dio.ceilings.length]! : null;
      if (ceilArt && span.w > 0.3) {
        const matC = surfMat(`${id}_dio_techo`, false);
        matC.diffuseColor = Color3.FromHexString(dio.tint);
        matC.backFaceCulling = false; // visible desde abajo SIEMPRE (sin líos de orientación)
        matC.diffuseTexture = artTex(`${id}_dio_techo_tex`, ceilArt, false, Math.max(1, Math.round(span.w / 2.4)), Math.max(1, Math.round(span.d / 2.4)));
        const qC = quad(`${id}_dio_techo`, span.w, span.d, origin.x0 + span.w / 2, origin.yTop - 0.02, origin.frontZ + span.d / 2, matC, true);
        put(qC);
        out.push({ mesh: qC, mat: matC });
      }
      return out;
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
  /** v1.29 — carcaso de la vivienda (laterales + techo): mismo tinte nocturno y misma
   *  exclusión del glow que las estancias. */
  shell: DioramaSurface[];
}

export function newDioramaSet(): DioramaSet {
  return { rooms: new Map(), shell: [] };
}
