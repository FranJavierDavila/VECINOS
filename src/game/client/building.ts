import type { Color3, Color4, DynamicTexture, Mesh, Scene, StandardMaterial, Texture, TransformNode } from '@babylonjs/core';
import { blockLabel } from '@/game/core/types';
import type { BlockInstance, Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { storageCorridorX, storageGeomOf, storageUnitPlan, storageUnitZ } from '@/game/storage';
import { B } from './babylon';
import {
  alphaBoundsOf,
  createDioramaDirector,
  newDioramaSet,
  stripCorners,
  type DioramaDirector,
  type DioramaSet,
  type DioramaVariant,
} from './diorama';
import { instantiateBlockAsset, type BlockMat } from './assets';

interface BlockView {
  /** Cajas greybox estructurales (se ocultan cuando llega el modelo glTF; panel/candado NO van aquí). */
  greybox: Mesh[];
  /** Materiales que reciben glow de canales y tintado de estado (1 en greybox, N en modelos). */
  mats: BlockMat[];
  /** Emissive base por material (lo que paint() deja sin canales); lo usa el LOD 'glow'. */
  baseEmissive: Color3[];
  /** Color base por material (view.color en greybox; albedo capturado en modelos). */
  baseColor: Color3[];
  /** Fuerza del tintado de estado: 1 = color plano (greybox), 0..1 = mezcla sobre el arte (modelos). */
  tintStrength: number;
  /** Raíz del modelo glTF si este bloque ya lo lleva (null = greybox). */
  model: TransformNode | null;
  front: Mesh | null; // fachada que cierra la vivienda (candado o privacidad)
  /** v1.28 — la fachada PARTIDA alrededor del hueco de la puerta (izq/der/dintel/umbral):
   *  los personajes entran y salen POR EL HUECO, nunca a través de la pared. */
  frontParts: Mesh[];
  /** Puerta y picaporte de la fachada de privacidad (v1.17): la vivienda vacía se ve cerrada. */
  door: Mesh | null;
  handle: Mesh | null;
  lock: Mesh | null;
  lockBase: { x: number; y: number };
  // ── LOD por distancia (rules.view.lod) ──
  /** Centro X del bloque en metros (dx del LOD: |centerX − focus.x|). */
  centerX: number;
  /** Planta del bloque (dy del LOD: |floor − focus.floor| * view.cellH). */
  floor: number;
  /** Pared del fondo de la vivienda (la única malla que puede llevar edgesRendering) o null;
   *  el EdgesRenderer activo solo existe en las paredes destacadas del jugador. */
  edgesMesh: Mesh | null;
  /** true mientras el LOD fuerza baseEmissive (al soltarlo se repinta el cálculo de paint una vez). */
  glowForced: boolean;
  /** true mientras el LOD oculta panel+candado; la visibilidad efectiva es la de paint() && !esto. */
  lodHiddenPanels: boolean;
  /** Segunda pared con edges (v1.19): la pared del fondo se parte si hay puerta a sala trasera. */
  edgesMesh2: Mesh | null;
  /** v1.24: decoración de la puerta de privacidad (marco + aplique) — se activa junto a view.door.
   *  v1.32: también las BISAGRAS de las hojas de los locales de planta 0 (TransformNode). */
  doorDecor: (Mesh | TransformNode)[];
  /** v1.25: color FIJO de la vivienda (pared gris clarito) — el tintado de estado no la repinta;
   *  el emissive de canales (ruido/agua) sigue funcionando. null = tintado clásico. */
  fixedDiffuse: Color3 | null;
  /** v1.29 — AUTOILUMINACIÓN SUTIL de los muros estructurales de la vivienda (el "material
   *  autoiluminado" que pide el vecino): las caras que miran ABAJO (fondos altos, forjados
   *  superiores) no reciben luz y se leían como BANDAS NEGRAS sobre los interiores abiertos.
   *  Se suma al emissive de canales en applyEmissive. null = sin autoiluminación. */
  selfGlow: Color3 | null;
}

/** Interior 2D de una vivienda (Fase C): suelo por estancia + lámparas + diorama.
 *  v1.29 — SIN TAPAS: la vivienda se lee como UN solo bloque abierto (el vecino: «debe ser
 *  1 único bloque del doble de tamaño… que no exista ninguna pared divisoria entre ellos»). */
interface InteriorView {
  /** Suelo tintado por estancia (color del catálogo; lockedColor si está cerrada). */
  floors: { roomKey: string; defId: string; mesh: Mesh; mat: StandardMaterial }[];
  /** Lamparita de techo por estancia (v1.21): se enciende de noche si hay gente despierta. */
  lamps: { roomKey: string; mesh: Mesh; mat: StandardMaterial }[];
  /** Diorama v1.23: billboards con paralaje (pared/suelo/mobiliario) por estancia. */
  dio: DioramaSet;
  /** Materiales del diorama del bloque (tinte nocturno idéntico a suelos/lámparas). */
  dioMats: StandardMaterial[];
  /** Raíz de los quads de diorama (visibilidad espejo de la fachada en applyPanels). */
  dioRoot: TransformNode | null;
}

/**
 * Una caja por bloque (placeholder greybox del futuro prefab) y, si el manifiesto de assets
 * (Content.assets.blocks) declara un modelo glTF para el tipo de bloque, el modelo en su lugar
 * (con la caja oculta). TODA la geometría y los colores salen de content.rules.view +
 * block.view + assets: sustituir el greybox por arte final no toca este código.
 * Las viviendas se dibujan en corte (interior visible) SOLO mientras hay alguien dentro;
 * vacías, la fachada se cierra con su puerta al pasillo (rules.view.privacy) — y las
 * bloqueadas, con panel y candado como siempre.
 */
export function createBuilding(scene: Scene, world: World, content: Content) {
  const { Color3, Color4, MeshBuilder, StandardMaterial, TransformNode } = B();
  const v = content.rules.view;
  const glow = Object.fromEntries(Object.entries(v.channelGlow).map(([k, hex]) => [k, Color3.FromHexString(hex)])) as Record<string, Color3>;
  const views = new Map<string, BlockView>();
  const shakes = new Map<string, number>();
  /** Raíz de escena por bloque (v1.19): colgar aquí TODA malla del bloque permite el
   *  desvanecimiento completo del bloque principal en el apilamiento 3D (swap de bloques). */
  const roots = new Map<string, TransformNode>();
  const attach = (blockId: string, mesh: Mesh): Mesh => {
    const r = roots.get(blockId);
    if (r) mesh.parent = r;
    return mesh;
  };
  /** Interiores 2D (Fase C) por bloque: suelos de estancia + lámparas + diorama. */
  const interiors = new Map<string, InteriorView>();
  /** Foco del LOD (posición del jugador): lo alimenta update() y lo consume paint(). */
  let lastFocus: { x: number; floor: number } | null = null;
  // Plano frontal de las estancias: la cara de la puerta. Con viviendas del doble de calado
  // (v0.6-b), el extra crece hacia el FONDO (+Z) para no envolver el pasillo ni al núcleo.
  // v1.19: los calados del catálogo YA incluyen el +1 módulo (rules.view.depthModule) —
  // depth 4.2 en viviendas y commonDepth 2.8 en comunes son los valores finales.
  const frontZ = v.roomZ - v.commonDepth / 2;
  /** Calado por bloque: viviendas 2× (mobiliario interior); naves del cierre (v1.16) y el
   *  tejado (con aleros) a calado de vivienda; bloques comunes, el de siempre. */
  const depthOf = (b: BlockInstance): number => {
    if (b.kind === 'dwelling') return v.depth;
    if (b.defId === 'trasteros_planta' || b.defId === 'bajocubierta') return v.depth;
    if (b.defId === v.trasteros.blockDefId) return v.depth * v.trasteros.blockDepthFactor;
    if (b.defId === 'tejado') return v.depth + v.roof.overhang * 2;
    return v.commonDepth;
  };
  const mat = (name: string) => new StandardMaterial(name, scene);
  // ── v1.30 — LOCALES de la planta 0 (portal acristalado, garaje, trastero común, sala de
  //  juntas, lavandería). Estado y piezas que viven MÁS ALLÁ del bucle por bloque: las
  //  hojas correderas del portal (nodos del arte glTF), los asientos de la sala y los
  //  bloques con interior que siguen la regla de privacidad de las viviendas.
  const loc = v.locals;
  const tr = v.trasteros;
  /** v1.32 — HOJAS DE LOS LOCALES con bisagra (trastero común y sala de juntas): se abren
   *  al acercarse cualquiera (los mismos movers que el resto de puertas del edificio) y se
   *  cierran solas. La fachada del local SOLO se desvanece cuando el jugador entra (o con
   *  la junta activa): las paredes del pasillo ya no se levantan porque un vecino pase
   *  por dentro. */
  const hallDoors: { hinge: TransformNode; openT: number; doorX: number; doorZ: number; floorY: number; side: 1 | -1; lift?: boolean }[] = [];
  /** Hojas de cristal del portal: nodo vivo del arte + baseX + sentido de deslizamiento. */
  const portalLeaves: { mesh: Mesh; baseX: number; dir: number }[] = [];
  let portalDoorX = 0;
  let portalDoorZ = 0;
  let portalOpen = 0;
  /** Bloques con interior habitable que usan la regla de privacidad (fachada cerrada si
   *  no hay nadie dentro): trastero comunitario y sala de juntas. */
  const halls = new Set<string>();
  /** Sala de juntas activa (junta convocada): fachada abierta y asientos ocupados. */
  let juntaHallId: string | null = null;
  /** Asientos y PUESTOS DE PIE de la sala por bloque (mundo): el controlador manda a los
   *  vecinos aquí. v1.32: los que no caben en silla quedan DE PIE en puntos del catálogo
   *  (nunca apilados sobre una silla ocupada). */
  const hallSeats = new Map<string, { seats: { x: number; z: number; yaw: number }[]; stands: { x: number; z: number; yaw: number }[] }>();
  /** Rótulos texturizados (garaje/trasteros/sala): DynamicTexture reutilizable. */
  const signTex = (name: string, text: string, bg: string, fg: string): DynamicTexture => {
    const dt = new (B().DynamicTexture)(`${name}_tex`, { width: 512, height: 96 }, scene, true);
    const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 96);
    ctx.font = 'bold 56px Arial, sans-serif';
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 52);
    dt.update(true);
    return dt;
  };
  /** Textura de HOJA ACRISTALADA del portal (marco de aluminio, travesaños, tirador y
   *  brillos): canvas pintado — el cristal translúcido deja leer el interior del portal. */
  const glassDoorTex = (): DynamicTexture => {
    const pd = loc.portalDoors;
    const dt = new (B().DynamicTexture)('portal_hoja_tex', { width: 256, height: 512 }, scene, true);
    const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
    const W = 256;
    const H = 512;
    ctx.fillStyle = pd.glass;
    ctx.fillRect(0, 0, W, H);
    // Brillos diagonales del cristal.
    ctx.strokeStyle = pd.sheen;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 14;
    for (let i = -1; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 70 + 30, H);
      ctx.lineTo(i * 70 + 30 + H * 0.45, 0);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Marco perimetral + travesaños (aluminio).
    ctx.strokeStyle = pd.frame;
    ctx.lineWidth = 18;
    ctx.strokeRect(9, 9, W - 18, H - 18);
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(0, 96); ctx.lineTo(W, 96);
    ctx.moveTo(0, H - 118); ctx.lineTo(W, H - 118);
    ctx.stroke();
    // Zócalo bajo (rodapié metálico).
    ctx.fillStyle = pd.frame;
    ctx.fillRect(0, H - 64, W, 64);
    // Tirador vertical largo (una barra por hoja, hacia el lado de encuentro).
    ctx.fillStyle = pd.handle;
    ctx.fillRect(W - 46, H * 0.32, 12, H * 0.34);
    dt.update(true);
    return dt;
  };
  /** Textura de la PUERTA BASCULANTE del garaje: paneles horizontales con raíles, travesaño
   *  de ventanillas y tirador — el bloque se lee como acceso de garajes (petición expresa). */
  const garageDoorTex = (): DynamicTexture => {
    const g = loc.garaje;
    const dt = new (B().DynamicTexture)('garaje_puerta_tex', { width: 512, height: 512 }, scene, true);
    const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
    const W = 512;
    const H = 512;
    ctx.fillStyle = g.panel;
    ctx.fillRect(0, 0, W, H);
    // Cuatro paneles horizontales con sombra inferior (basculante de verdad).
    const rows = 4;
    for (let i = 0; i < rows; i++) {
      const y0 = (H / rows) * i;
      ctx.fillStyle = i % 2 === 0 ? g.panel : g.panelShade;
      ctx.fillRect(0, y0, W, H / rows);
      ctx.strokeStyle = g.rail;
      ctx.lineWidth = 7;
      ctx.strokeRect(3, y0 + 3, W - 6, H / rows - 6);
    }
    // Travesaño de ventanillas en el panel superior.
    ctx.fillStyle = g.window;
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(38 + i * 116, 34, 92, 56);
      ctx.strokeStyle = g.rail;
      ctx.lineWidth = 5;
      ctx.strokeRect(38 + i * 116, 34, 92, 56);
    }
    // Tirador central.
    ctx.fillStyle = g.rail;
    ctx.fillRect(W / 2 - 34, H - 92, 68, 18);
    dt.update(true);
    return dt;
  };
  /** Materiales compartidos de los locales (gris de pasillo + interior más claro). */
  const hallFrontMat = mat('local_frente_mat');
  hallFrontMat.diffuseColor = Color3.FromHexString(loc.corridorWall);
  hallFrontMat.specularColor = new Color3(0.02, 0.02, 0.02);
  const hallInnerMat = mat('local_interior_mat');
  hallInnerMat.diffuseColor = Color3.FromHexString(v.privacy.wallColor ?? '#dbd8d2').scale(1.06);
  hallInnerMat.emissiveColor = Color3.FromHexString(v.privacy.wallColor ?? '#dbd8d2').scale(0.18);
  hallInnerMat.specularColor = new Color3(0.02, 0.02, 0.02);
  const hallLaundryMat = mat('local_lavanderia_mat');
  hallLaundryMat.diffuseColor = Color3.FromHexString('#ece9e2');
  hallLaundryMat.specularColor = new Color3(0.02, 0.02, 0.02);
  // v1.35 — AUTOILUMINACIÓN SUTIL de los interiores de locales (mismo oficio que las
  // viviendas v1.29): en sombra el interior se lee como un agujero oscuro — con el
  // emissive bajo se ve DENTRO aunque el sol no dé en la cara.
  hallLaundryMat.emissiveColor = Color3.FromHexString('#ece9e2').scale(0.18);
  const hallGarajeMat = mat('local_garaje_mat');
  hallGarajeMat.diffuseColor = Color3.FromHexString(loc.garaje.furniture?.wallColor ?? '#9aa2ad');
  hallGarajeMat.specularColor = new Color3(0.02, 0.02, 0.02);
  hallGarajeMat.emissiveColor = Color3.FromHexString(loc.garaje.furniture?.wallColor ?? '#9aa2ad').scale(0.18);
  /** v1.36 — VESTÍBULO DEL PORTAL: el cuerpo cerrado del arte glTF se retira (hideNodes)
   *  y el interior es UNA IMAGEN del hall (diorama, wall_portal_hall.png — buzones, tablón,
   *  banco, plantas, ascensor y escalera pintados). A través del cristal del portal SE VE
   *  el vestíbulo (adiós a la «pared oscura»). */
  const hallPortalMat = mat('local_portal_mat');
  hallPortalMat.diffuseColor = Color3.FromHexString(loc.portal?.lobby?.wallColor ?? '#d8d3c8');
  hallPortalMat.specularColor = new Color3(0.02, 0.02, 0.02);
  hallPortalMat.emissiveColor = Color3.FromHexString(loc.portal?.lobby?.wallColor ?? '#d8d3c8').scale(0.2);
  /** v1.35 — bombos de la lavandería que GIRAN (lavadoras/secadoras «en marcha»): el update
   *  avanza su rotation.z; la tirada es determinista por bloque+máquina (hash01 del catálogo). */
  const laundryDrums: { mesh: Mesh; speed: number }[] = [];
  /** v1.35 — estado de apertura de la basculante del garaje (0..1): revela el interior
   *  ANTES de entrar (el vecino: «al abrirse se ve cerrado por una pared oscura»). */
  let garajeLiftT = 0;
  /** v1.37 — OBSTÁCULOS andables por bloque (mundo): las lavadoras/secadoras de la
   *  lavandería no se atraviesan (ni el jugador ni los vecinos). Los registra el branch
   *  que levanta las máquinas; player-logic y actors.ts los aplican. */
  const blockObstacles = new Map<string, { x0: number; z0: number; w: number; d: number }[]>();
  /** v1.37 — posición (mundo) del ATRIL del tablón de anuncios (planta 0, extremo del
   *  pasillo): el interact 'noticeboard' se ancla aquí. null si el catálogo no lo activa. */
  let noticeboardSpot: { x: number; z: number; floor: number } | null = null;
  /** v1.35 — textura de LOSETAS compartida (pasillos + locales + vestíbulo): 2×2 baldosas
   *  con alternancia ajedrezada, VARIACIÓN por baldosa (terrazo) y veteado/suciedad leve —
   *  el vecino: «se debe notar las losetas del suelo». Todo del catálogo (corridorFloor):
   *  contrast, groutW (grosor de junta) y speckle (moteado). uScale/vScale en metros reales. */
  const tileTexCache = new Map<string, DynamicTexture>();
  const makeTileTex = (id: string, wMeters: number, dMeters: number): { tex: DynamicTexture; ready: boolean } => {
    const key = `${id}|${wMeters.toFixed(2)}|${dMeters.toFixed(2)}`;
    const hit = tileTexCache.get(key);
    if (hit) return { tex: hit, ready: true };
    const cf = v.corridorFloor!;
    const tex = new (B().DynamicTexture)(`${id}_tex`, { width: 256, height: 256 }, scene, true);
    tileTexCache.set(key, tex);
    const tctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const half = 128;
    const base = Color3.FromHexString(cf.color);
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        const idx = ty * 2 + tx;
        // Alternancia ajedrezada + variación determinista por baldosa (cada una su tinte).
        const checker = (tx + ty) % 2 === 0 ? 1 : 1 - (cf.contrast ?? 0.1);
        const jitter = 1 - (cf.speckle ?? 0.12) * 0.5 * hash01(id, 910 + idx);
        const shade = checker * jitter;
        tctx.fillStyle = `rgb(${Math.round(base.r * 255 * shade)},${Math.round(base.g * 255 * shade)},${Math.round(base.b * 255 * shade)})`;
        tctx.fillRect(tx * half, ty * half, half, half);
        // Moteado tipo terrazo (puntitos oscuros/claros deterministas).
        const speckles = 26;
        for (let s = 0; s < speckles; s++) {
          const sx = tx * half + hash01(id, 920 + idx * 40 + s) * half;
          const sy = ty * half + hash01(id, 930 + idx * 40 + s) * half;
          const dark = hash01(id, 940 + idx * 40 + s) < 0.5;
          tctx.fillStyle = dark ? 'rgba(60,58,54,0.24)' : 'rgba(255,255,255,0.28)';
          tctx.beginPath();
          tctx.arc(sx, sy, 0.8 + hash01(id, 950 + idx * 40 + s) * 1.8, 0, Math.PI * 2);
          tctx.fill();
        }
      }
    }
    const gw = cf.groutW ?? 5;
    tctx.strokeStyle = cf.grout;
    tctx.lineWidth = gw;
    tctx.strokeRect(0.5, 0.5, 255, 255); // junta exterior (cada baldosa cierra contra su vecina)
    tctx.beginPath();
    tctx.moveTo(half, 0); tctx.lineTo(half, 256);
    tctx.moveTo(0, half); tctx.lineTo(256, half);
    tctx.stroke();
    tex.update(true);
    tex.uScale = Math.max(1, Math.round(wMeters / (cf.tile * 2)));
    tex.vScale = Math.max(1, Math.round(dMeters / (cf.tile * 2)));
    return { tex, ready: true };
  };
  /** Recorte billboard genérico (máquinas de la lavandería): PNG → stripWhite → Texture
   *  (dataURL, conserva alpha — mismo camino verificado de las macetas). */
  const keyedTexCache = new Map<string, { dt: Texture; ar: number; onTrim: Array<(ar: number) => void>; loaded: boolean }>();
  const keyedSpriteTex = (name: string, file: string): { dt: Texture; ar: number; onTrim: Array<(ar: number) => void>; loaded: boolean } => {
    const hit = keyedTexCache.get(file);
    if (hit) return hit;
    const dt = new (B().Texture)(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      scene,
      false,
      true,
    );
    dt.name = name;
    dt.hasAlpha = true;
    const entry = { dt, ar: 0.8, onTrim: [] as Array<(ar: number) => void>, loaded: false };
    keyedTexCache.set(file, entry);
    const img = new Image();
    img.onload = () => {
      const big = document.createElement('canvas');
      big.width = Math.max(1, img.naturalWidth);
      big.height = Math.max(1, img.naturalHeight);
      const bx = big.getContext('2d', { willReadFrequently: true });
      if (!bx) return;
      bx.drawImage(img, 0, 0);
      stripCorners(big, 0.14);
      const bnd = alphaBoundsOf(big);
      const out = document.createElement('canvas');
      if (bnd) {
        out.width = Math.max(1, bnd.x1 - bnd.x0);
        out.height = Math.max(1, bnd.y1 - bnd.y0);
      } else {
        out.width = big.width;
        out.height = big.height;
      }
      const octx = out.getContext('2d');
      if (!octx) return;
      if (bnd) octx.drawImage(big, bnd.x0, bnd.y0, out.width, out.height, 0, 0, out.width, out.height);
      else octx.drawImage(big, 0, 0);
      entry.dt.updateURL(out.toDataURL('image/png'));
      entry.ar = Math.max(0.05, out.width / Math.max(1, out.height));
      entry.loaded = true;
      for (const cb of entry.onTrim) cb(entry.ar);
      entry.onTrim.length = 0;
    };
    img.onerror = () => console.warn(`locals: arte no disponible (${file})`);
    img.src = file;
    return entry;
  };
  /**
   * V1.26 — OPACIDAD TOTAL para hojas de puerta: los DynamicTexture con píxeles alpha=0 se
   * renderizan a NEGRO en esta config (WebGPU/CDN — diagnóstico v1.25). Las artes de puerta
   * traen sombras cocinadas que el flood-fill de esquinas deja a medias: las rendijas
   * transparentes sobrevivientes dentro del recorte se rellenan con el color opaco más
   * cercano (dilatación horizontal en dos pasadas) — la textura queda 100% opaca y el
   * perímetro de la hoja deja de verse negro/rojizo.
   */
  const dilateOpaque = (c: HTMLCanvasElement): void => {
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const W = c.width;
    const H = c.height;
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let pr = -1;
      let pg = -1;
      let pb = -1;
      for (let x = 0; x < W; x++) {
        const p = (row + x) * 4;
        if (d[p + 3]! > 250) {
          pr = d[p]!;
          pg = d[p + 1]!;
          pb = d[p + 2]!;
        } else if (pr >= 0) {
          d[p] = pr;
          d[p + 1] = pg!;
          d[p + 2] = pb!;
          d[p + 3] = 255;
        }
      }
      pr = -1;
      pg = -1;
      pb = -1;
      for (let x = W - 1; x >= 0; x--) {
        const p = (row + x) * 4;
        if (d[p + 3]! > 250) {
          pr = d[p]!;
          pg = d[p + 1]!;
          pb = d[p + 2]!;
        } else if (pr >= 0) {
          d[p] = pr;
          d[p + 1] = pg!;
          d[p + 2] = pb!;
          d[p + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  };
  /**
   * V1.27 — ENCAJE PERFECTO DE HOJAS DE PUERTA (arregla «dos puertas pegadas» y el estirado
   * de las puertas de escalera). Pipeline único, UN solo vuelco:
   *   1) stripCorners quita el fondo cocinado alrededor de la hoja (flood-fill de esquinas);
   *   2) alphaBoundsOf recorta a la caja del contenido;
   *   3) ENCAJE SIN ESTIRAR: la caja se re-encaja a la PROPORCIÓN EXACTA del plano con recorte
   *      centrado del exceso (cover) — las proporciones de la hoja jamás se deforman;
   *   4) se vuelca UNA vez al canvas final (el bug v1.24..v1.26 volcaba DOS veces: el recorte
   *      escalado y LUEGO la imagen entera encima — la hoja estirada se colaba alrededor de la
   *      hoja real y se leía como «dos puertas pegadas»);
   *   5) dilateOpaque rellena rendijas alpha (perímetro negro fuera).
   * `draw` permite rotular encima (el número de planta de las puertas de escalera).
   */
  const doorLeafCanvas = (
    img: HTMLImageElement,
    outW: number,
    outH: number,
    opts: { draw?: (ctx: CanvasRenderingContext2D) => void } = {},
  ): HTMLCanvasElement => {
    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    if (!ctx) return out;
    const big = document.createElement('canvas');
    big.width = Math.max(1, img.naturalWidth || img.width);
    big.height = Math.max(1, img.naturalHeight || img.height);
    const bx = big.getContext('2d', { willReadFrequently: true });
    if (!bx) return out;
    bx.drawImage(img, 0, 0);
    stripCorners(big, 0.14);
    const b = alphaBoundsOf(big);
    const sx = b ? b.x0 : 0;
    const sy = b ? b.y0 : 0;
    const sw = b ? b.x1 - b.x0 : big.width;
    const sh = b ? b.y1 - b.y0 : big.height;
    const targetAr = outW / outH;
    const srcAr = sw / Math.max(1, sh);
    let cw = sw;
    let ch = sh;
    let cx = sx;
    let cy = sy;
    if (srcAr > targetAr) {
      cw = sh * targetAr;
      cx = sx + (sw - cw) / 2;
    } else {
      ch = sw / targetAr;
      cy = sy + (sh - ch) / 2;
    }
    ctx.drawImage(big, cx, cy, Math.max(1, cw), Math.max(1, ch), 0, 0, outW, outH);
    if (opts.draw) opts.draw(ctx);
    dilateOpaque(out);
    return out;
  };
  /** Texturas de puerta cacheadas por fichero (v1.24→v1.27): full-bleed, OPACA y con la
   *  proporción EXACTA del plano de la puerta (sin estirar, sin doble vuelco). */
  const doorArtCache = new Map<string, DynamicTexture>();
  const doorArtTexSized = (sc: Scene, file: string, pw: number, ph: number): DynamicTexture => {
    const key = `${file}@${pw.toFixed(2)}x${ph.toFixed(2)}`;
    const hit = doorArtCache.get(key);
    if (hit) return hit;
    const H = 768;
    const W = Math.round((H * pw) / ph);
    const dt = new (B().DynamicTexture)(`puerta_tex_${doorArtCache.size}`, { width: W, height: H }, sc, true);
    doorArtCache.set(key, dt);
    const img = new Image();
    img.onload = () => {
      const c = doorLeafCanvas(img, W, H);
      const dctx = dt.getContext() as unknown as CanvasRenderingContext2D;
      dctx.clearRect(0, 0, W, H);
      dctx.drawImage(c, 0, 0);
      dt.update(true);
    };
    img.src = file;
    return dt;
  };
  const doorArtTex = (sc: Scene, file: string): DynamicTexture => doorArtTexSized(sc, file, v.privacy.doorW, v.privacy.doorH);
  /** Candado DIBUJADO (v1.25→v1.26): silueta real de candado — nada de cajas 3D. Colores
   *  del catálogo (lockColor); grillete de acero fijo. v1.26: la subida sale por
   *  TEXTURE(dataURL) — los DynamicTexture desde canvas pierden el canal alpha en esta
   *  config (WebGPU/CDN: píxeles alpha=0 → NEGRO) y el candado se veía con halo negro. */
  let lockTex: Texture | null = null;
  let lockTexAr = 0.8;
  const canvasTex = (name: string, c: HTMLCanvasElement): Texture => {
    const t = new (B().Texture)(c.toDataURL('image/png'), scene, false, true);
    t.name = name;
    t.hasAlpha = true;
    return t;
  };
  const padlockTex = (): Texture => {
    if (lockTex) return lockTex;
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      const fallback = canvasTex('candado_tex', c);
      lockTex = fallback;
      return fallback;
    }
    ctx.clearRect(0, 0, 128, 128);
    const body = Color3.FromHexString(v.lockColor).toHexString();
    // Grillete: arco de acero.
    ctx.strokeStyle = '#8d939c';
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.arc(64, 52, 26, Math.PI, 0);
    ctx.stroke();
    // Cuerpo de latón con borde.
    ctx.fillStyle = body;
    ctx.strokeStyle = 'rgba(60,40,10,0.9)';
    ctx.lineWidth = 4;
    const r = 12;
    ctx.beginPath();
    ctx.moveTo(24, 124);
    ctx.lineTo(24, 66 + r);
    ctx.arcTo(24, 66, 24 + r, 66, r);
    ctx.lineTo(104 - r, 66);
    ctx.arcTo(104, 66, 104, 66 + r, r);
    ctx.lineTo(104, 124);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Ojo de la cerradura.
    ctx.fillStyle = 'rgba(50,32,8,0.95)';
    ctx.beginPath();
    ctx.arc(64, 90, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(60, 90, 8, 20);
    // Recorte a la caja del contenido: el quad queda del tamaño exacto de la silueta.
    const b = alphaBoundsOf(c);
    const out = document.createElement('canvas');
    out.width = 128;
    out.height = 128;
    const octx = out.getContext('2d');
    if (b && octx) {
      const bw = Math.max(1, b.x1 - b.x0);
      const bh = Math.max(1, b.y1 - b.y0);
      lockTexAr = bw / bh;
      octx.drawImage(c, b.x0, b.y0, bw, bh, 0, 0, bw, bh);
    } else {
      octx?.drawImage(c, 0, 0);
    }
    lockTex = canvasTex('candado_tex', out);
    return lockTex;
  };
  /** Apliques de las puertas de vivienda: el foco cálido amaanece con la noche (update). */
  const doorLampMats: { mat: StandardMaterial; hex: string }[] = [];
  /** Dioramas interiores (v1.23): null sin catálogo interiors.json — greybox como siempre. */
  const diro: DioramaDirector | null = createDioramaDirector(scene, content);
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, m: StandardMaterial) => {
    const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    return mesh;
  };

  for (const b of Object.values(world.blocks)) {
    const m = mat(`${b.id}_mat`);
    const cx = (b.cell.col + b.size.w / 2) * v.cellW;
    const bottom = b.cell.floor * v.cellH;
    const w = b.size.w * v.cellW - v.gapW;
    const h = v.cellH - v.gapH;
    const d = depthOf(b);
    const cz = frontZ + d / 2;
    const view: BlockView = {
      greybox: [],
      mats: [m],
      baseEmissive: [m.emissiveColor.clone()],
      baseColor: [Color3.FromHexString(content.blocks[b.defId]!.view?.color ?? '#cccccc')],
      tintStrength: 1,
      model: null,
      front: null,
      frontParts: [],
      door: null,
      handle: null,
      lock: null,
      lockBase: { x: cx, y: bottom + v.cellH / 2 - 0.2 },
      centerX: cx,
      floor: b.cell.floor,
      edgesMesh: null,
      edgesMesh2: null,
      glowForced: false,
      lodHiddenPanels: false,
      doorDecor: [],
      fixedDiffuse: null,
      selfGlow: null,
    };
    const root = new TransformNode(`${b.id}_root`, scene);
    roots.set(b.id, root);
    // v1.29 — POZO DEL ASCENSOR GRIS OSCURO: el vecino pidió «la pared gris oscura como el
    // zócalo». El color se FIJA sobre el arte glTF (mismo mecanismo que la pared fija de las
    // viviendas) con el valor del catálogo (rules.view.elevator.wallColor). El estado de la
    // avería lo cuentan el botón rojo y la pantallita (✕), no la pared.
    if (content.blocks[b.defId]!.features?.elevator === true) {
      view.fixedDiffuse = Color3.FromHexString(v.elevator.wallColor);
    }
    // (v1.29: la autoiluminación vive en el material INTERIOR mi — ver dwelling — no en el
    //  compartido: con el compartido las fachadas se lavaban a blanco.)
    if (b.layer === 'corridor') {
      // Pasillo exterior (data-driven): tira transitable saliente hacia la calle, con el borde
      // trasero a ras de fachada (frontZ) y barandilla baja en el borde exterior — sitio de
      // sobra para que los personajes se crucen o charlen sin bailar el vacío.
      const d = v.corridorDepth;
      view.greybox.push(box(b.id, b.size.w * v.cellW, v.slab * 2, d, cx, bottom + v.slab, frontZ - d / 2, m));
      // ── SUELO DE LOSETAS (v1.28): gris clarito con baldosas cuadradas de ~40 cm (catálogo).
      //  Plano propio SOBRE la losa (4 mm, nada coplanar) con textura de 2×2 baldosas y
      //  uScale/vScale derivados del metro real: la junta mide tile metros en el mundo.
      //  Fuera del greybox a propósito: sobrevive al arte glTF del pasillo y acompaña al
      //  bloque en el swap (cuelga de su raíz).
      const cf = v.corridorFloor;
      if (cf) {
        // v1.35 — helper compartido (locales/vestíbulo usan la MISMA textura): ajedrez +
        // variación por baldosa + moteado terrazo + junta más gruesa (se DEBE notar).
        const tile = makeTileTex(`${b.id}_losas`, b.size.w * v.cellW, d);
        const fmat = mat(`${b.id}_losas_mat`);
        fmat.diffuseTexture = tile.tex;
        fmat.specularColor = new Color3(0.03, 0.03, 0.03);
        const floor = MeshBuilder.CreateGround(`${b.id}_losas`, { width: b.size.w * v.cellW, height: d }, scene);
        floor.position.set(cx, bottom + v.slab * 2 + 0.004, frontZ - d / 2);
        floor.material = fmat;
        floor.isPickable = false;
        floor.parent = root;
      }
      if (v.corridorRail > 0) {
        view.greybox.push(
          box(`${b.id}_barandilla`, b.size.w * v.cellW, v.corridorRail, v.wall, cx, bottom + v.slab * 2 + v.corridorRail / 2, frontZ - d, m),
        );
      }
      // ── v1.37 — ATRIL DEL TABLÓN DE ANUNCIOS (planta 0, extremo del pasillo) ──
      // El vecino consulta el tablón AHÍ: tablón de corcho con notas fijadas y atril
      // inclinado. Posición/orientación del catálogo (noticeboard.side/inset/z/yaw); la
      // consulta (interact 'noticeboard') se ancla a esta posición del mundo.
      const nbCfg = v.noticeboard;
      if (nbCfg?.enabled && b.cell.floor === nbCfg.floor) {
        const spanWc = b.size.w * v.cellW;
        const nbX = cx - spanWc / 2 + (nbCfg.side === 'left' ? nbCfg.inset : spanWc - nbCfg.inset);
        const nbZ = v.corridorZ + nbCfg.z; // offset desde la línea de paseo (negativo = hacia la calle)
        noticeboardSpot = { x: nbX, z: nbZ, floor: nbCfg.floor };
        const nbRoot = new (B().TransformNode)(`${b.id}_atril`, scene);
        nbRoot.position.set(nbX, bottom + v.slab * 2, nbZ);
        nbRoot.rotation.y = nbCfg.yaw;
        nbRoot.parent = root;
        const postM = mat(`${b.id}_atril_poste_mat`);
        postM.diffuseColor = Color3.FromHexString(nbCfg.postColor);
        const frameM = mat(`${b.id}_atril_marco_mat`);
        frameM.diffuseColor = Color3.FromHexString(nbCfg.frameColor);
        const capM = mat(`${b.id}_atril_tapa_mat`);
        capM.diffuseColor = Color3.FromHexString(nbCfg.capColor);
        const corkM = mat(`${b.id}_atril_corcho_mat`);
        corkM.diffuseColor = Color3.FromHexString(nbCfg.corkColor);
        corkM.specularColor = new Color3(0.02, 0.02, 0.02);
        const deskM = mat(`${b.id}_atril_mesa_mat`);
        deskM.diffuseColor = Color3.FromHexString(nbCfg.deskColor);
        // Cara del corcho con el ARTE del tablón (titular + notas fijadas, del catálogo).
        const corkW = nbCfg.boardW - nbCfg.frameW * 2;
        const corkH = nbCfg.boardH - nbCfg.frameW * 2;
        const texW = 512;
        const texH = Math.max(128, Math.round((texW * corkH) / corkW));
        const nbTex = new (B().DynamicTexture)(`${b.id}_atril_tex`, { width: texW, height: texH }, scene, true);
        const nc = nbTex.getContext() as unknown as CanvasRenderingContext2D;
        nc.fillStyle = nbCfg.corkColor;
        nc.fillRect(0, 0, texW, texH);
        for (let i = 0; i < 260; i++) {
          // Moteado del corcho (determinista por bloque).
          nc.fillStyle = hash01(b.id, 7100 + i) < 0.5 ? 'rgba(120,84,46,0.16)' : 'rgba(246,232,204,0.14)';
          nc.fillRect(hash01(b.id, 5100 + i) * texW, hash01(b.id, 6100 + i) * texH, 3, 2);
        }
        const bandH = Math.round(texH * 0.2);
        nc.fillStyle = nbCfg.headlineBg;
        nc.fillRect(0, 0, texW, bandH);
        nc.fillStyle = nbCfg.headlineFg;
        nc.font = `bold ${Math.round(bandH * 0.5)}px Arial, sans-serif`;
        nc.textAlign = 'center';
        nc.textBaseline = 'middle';
        nc.fillText(nbCfg.headline, texW / 2, bandH * 0.55);
        // Notas fijadas (2×2, rotadas al azar determinista, con chincheta y garabatos).
        const nbNotes = nbCfg.notes.slice(0, 4);
        const cellWn = texW / 2;
        const cellHn = (texH - bandH) / 2;
        nbNotes.forEach((_note, i) => {
          const pad = 14;
          const wN = cellWn - pad * 2;
          const hN = cellHn - pad * 2;
          nc.save();
          nc.translate((i % 2) * cellWn + pad + wN / 2, bandH + Math.floor(i / 2) * cellHn + pad + hN / 2);
          nc.rotate((hash01(b.id, 8100 + i) - 0.5) * 0.12);
          nc.fillStyle = nbCfg.paperColors[i % nbCfg.paperColors.length]!;
          nc.fillRect(-wN / 2, -hN / 2, wN, hN);
          nc.strokeStyle = 'rgba(60,52,40,0.55)';
          nc.lineWidth = 3;
          for (let li = 0; li < 3; li++) {
            const ly = -hN / 2 + hN * (0.34 + (0.5 * li) / 3);
            nc.beginPath();
            nc.moveTo(-wN / 2 + 10, ly);
            nc.lineTo(wN / 2 - 10 - (li === 2 ? wN * 0.28 : 0), ly);
            nc.stroke();
          }
          nc.fillStyle = '#c9564c';
          nc.beginPath();
          nc.arc(0, -hN / 2 + 9, 6, 0, Math.PI * 2);
          nc.fill();
          nc.restore();
        });
        nbTex.update(true);
        const faceM = mat(`${b.id}_atril_cara_mat`);
        faceM.diffuseTexture = nbTex;
        faceM.specularColor = new Color3(0.03, 0.03, 0.03);
        faceM.backFaceCulling = false; // el dorso (que es lo que ven jugador y cámara) SÍ se pinta
        // v1.37 — la cara es UN PLANO con culling OFF (la convención de la casa, como los
        // carteles de las manifestaciones: la textura se lee CORRECTA desde su DORSO). El
        // plano vive 2.5 mm por delante del dorso del corcho y mira al NOROESTE (yaw del
        // catálogo π/2+0.4+π): jugador y cámara (ambos al SE) leen el tablón sin espejo.
        const facePlane = MeshBuilder.CreatePlane(`${b.id}_atril_cara`, { width: corkW, height: corkH }, scene);
        facePlane.position.set(0, nbCfg.boardY, -0.02);
        facePlane.material = faceM;
        facePlane.isPickable = false;
        facePlane.parent = nbRoot;
        const postH = nbCfg.boardY + nbCfg.boardH / 2;
        const gnb = (name: string, w2: number, h2: number, d2: number, x2: number, y2: number, z2: number, mm: StandardMaterial): Mesh => {
          const mesh = box(name, w2, h2, d2, 0, 0, 0, mm);
          mesh.position.set(x2, y2, z2);
          mesh.parent = nbRoot;
          mesh.isPickable = false;
          return mesh;
        };
        for (const sx of [-1, 1] as const) {
          gnb(`${b.id}_atril_poste_${sx > 0 ? 'd' : 'i'}`, nbCfg.postW, postH, nbCfg.postW, sx * (nbCfg.boardW / 2 - nbCfg.postW / 2 + 0.03), postH / 2, 0, postM);
        }
        // Tablón: cuerpo de corcho + marco (canto 6 cm frente a los 3.5 cm del corcho:
        // nada coplanar) + cara ilustrada 3 mm por delante del cuerpo.
        gnb(`${b.id}_atril_corcho`, corkW, corkH, 0.035, 0, nbCfg.boardY, 0, corkM);
        gnb(`${b.id}_atril_cara`, corkW, corkH, 0.002, 0, nbCfg.boardY, 0.02, faceM);
        gnb(`${b.id}_atril_marco_sup`, nbCfg.boardW, nbCfg.frameW, 0.06, 0, nbCfg.boardY + corkH / 2 + nbCfg.frameW / 2, 0, frameM);
        gnb(`${b.id}_atril_marco_inf`, nbCfg.boardW, nbCfg.frameW, 0.06, 0, nbCfg.boardY - corkH / 2 - nbCfg.frameW / 2, 0, frameM);
        gnb(`${b.id}_atril_marco_i`, nbCfg.frameW, corkH, 0.06, -nbCfg.boardW / 2 + nbCfg.frameW / 2, nbCfg.boardY, 0, frameM);
        gnb(`${b.id}_atril_marco_d`, nbCfg.frameW, corkH, 0.06, nbCfg.boardW / 2 - nbCfg.frameW / 2, nbCfg.boardY, 0, frameM);
        const capNb = gnb(`${b.id}_atril_tapa`, nbCfg.boardW + 0.12, 0.05, 0.16, 0, postH + 0.025, 0, capM);
        capNb.rotation.x = 0.1;
        // ATRIL: tabla inclinada hacia el lector + panel frontal + dos patas.
        const deskTop = gnb(`${b.id}_atril_mesa`, nbCfg.deskW, 0.04, nbCfg.deskD, 0, nbCfg.deskY, 0.17, deskM);
        // Con el yaw del tablón al NO, la leyenda se inclina hacia el lector (el canto SE baja).
        deskTop.rotation.x = -nbCfg.deskSlant;
        gnb(`${b.id}_atril_mesa_frente`, nbCfg.deskW, Math.max(0.05, nbCfg.deskY - 0.62), 0.035, 0, (nbCfg.deskY + 0.62) / 2, -(0.17 + nbCfg.deskD / 2 + 0.018), deskM);
        for (const sx of [-1, 1] as const) {
          gnb(`${b.id}_atril_pata_${sx > 0 ? 'd' : 'i'}`, 0.05, nbCfg.deskY - 0.02, 0.05, sx * (nbCfg.deskW / 2 - 0.06), (nbCfg.deskY - 0.02) / 2, 0.17 - nbCfg.deskD / 4, deskM);
        }
      }
    } else if (b.kind === 'dwelling') {
      const y = bottom + v.cellH / 2;
      const pv = v.privacy;
      // v1.25 — acabado de la vivienda: pared GRIS CLARITO fija (el tintado de estado no la
      // repinta; el glow de canales sigue) + ZÓCALO gris de 25 cm desde el suelo + marcos de
      // puerta DEL COLOR del zócalo. Todo del catálogo (rules.view.privacy).
      view.fixedDiffuse = Color3.FromHexString(pv.wallColor ?? '#dbd8d2');
      // ── Puerta a sala TRASERA (v1.19, apilamiento 3D): la pared del fondo se parte con el
      // hueco del layout (doorway hacia una estancia más profunda que el bloque principal).
      const layoutId0 = content.blocks[b.defId]?.container?.layout;
      const layout0 = layoutId0 ? content.layouts[layoutId0] : undefined;
      const rearKeys = new Set((layout0?.rooms ?? []).filter((r) => r.rect && r.rect.z + r.rect.d > v.depth + 0.01).map((r) => r.key));
      const rearDoor = (layout0?.doorways ?? []).find((dw) => dw.axis === 'x' && rearKeys.has(dw.b));
      const x0w = cx - w / 2;
      const x1w = cx + w / 2;
      // v1.29 — MUROS A CÉLULA COMPLETA: las paredes del fondo y laterales suben hasta el
      // canto del bloque (cellH). Antes medían cellH − gapH y por el hueco del forjado se
      // colaba el fondo oscuro de la ciudad a través de los interiores abiertos (la banda
      // negra sobre el techo). La solera del vecino de arriba sella la junta por fuera.
      const hFull = v.cellH;
      const yFull = bottom + v.cellH / 2;
      // v1.29 — MATERIAL INTERIOR: mismo gris que la fachada pero con AUTOILUMINACIÓN sutil
      // (privacy.night.wallSelf): las caras que miran ABAJO (fondos altos, forjados de la
      // vivienda de arriba) no reciben luz y se leían como BANDAS NEGRAS sobre los
      // interiores abiertos. El material compartido `m` (fachadas, zócalo) queda intacto.
      const mi = mat(`${b.id}_muro_int_mat`);
      mi.diffuseColor = view.fixedDiffuse ?? Color3.FromHexString(pv.wallColor ?? '#dbd8d2');
      mi.specularColor = new Color3(0.02, 0.02, 0.02);
      mi.emissiveColor = Color3.FromHexString(pv.wallColor ?? '#dbd8d2').scale(pv.night?.wallSelf ?? 0.3);
      if (rearDoor) {
        const gapA = Math.max(x0w, x0w + rearDoor.at - rearDoor.width / 2);
        const gapB = Math.min(x1w, x0w + rearDoor.at + rearDoor.width / 2);
        const doorH = Math.min(h - 0.15, 1.95);
        // v1.29 — el dintel de la puerta trasera sube hasta el CANTO del bloque: antes
        // terminaba en cellH − gapH y por la rendija (sobre el arte del diorama) se veía el
        // fondo urbano a oscuras a través del interior abierto (la banda negra del techo).
        const doorTopY = bottom + v.slab + v.wall + doorH;
        const lintelH = Math.max(0.02, bottom + v.cellH - doorTopY);
        view.edgesMesh = box(`${b.id}_fondo_i`, gapA - x0w, hFull, v.wall, (x0w + gapA) / 2, yFull, frontZ + d, mi);
        view.edgesMesh2 = box(`${b.id}_fondo_d`, x1w - gapB, hFull, v.wall, (gapB + x1w) / 2, yFull, frontZ + d, mi);
        view.greybox.push(
          view.edgesMesh,
          view.edgesMesh2,
          box(`${b.id}_fondo_dintel`, gapB - gapA, lintelH, v.wall, (gapA + gapB) / 2, doorTopY + lintelH / 2, frontZ + d, mi),
          box(`${b.id}_izq`, v.wall, hFull, d, cx - w / 2, yFull, cz, mi),
          box(`${b.id}_der`, v.wall, hFull, d, cx + w / 2, yFull, cz, mi),
          box(`${b.id}_suelo`, w, v.wall, d, cx, bottom + v.slab + v.wall / 2, cz, mi),
          box(`${b.id}_techo`, w, v.wall, d, cx, bottom + v.cellH - v.slab - v.wall / 2, cz, mi),
        );
      } else {
        view.edgesMesh = box(`${b.id}_fondo`, w, hFull, v.wall, cx, yFull, frontZ + d, mi);
        view.greybox.push(
          view.edgesMesh,
          box(`${b.id}_izq`, v.wall, hFull, d, cx - w / 2, yFull, cz, mi),
          box(`${b.id}_der`, v.wall, hFull, d, cx + w / 2, yFull, cz, mi),
          box(`${b.id}_suelo`, w, v.wall, d, cx, bottom + v.slab + v.wall / 2, cz, mi),
          box(`${b.id}_techo`, w, v.wall, d, cx, bottom + v.cellH - v.slab - v.wall / 2, cz, mi),
        );
      }
      // ── FACHADA PARTIDA (v1.28): la pared frontal se abre con el HUECO REAL de la puerta
      //  (privacy.doorW × doorH en el centro, la misma caja que la hoja de privacidad).
      //  Antes la fachada era un muro sólido y el vecino ENTRABA A TRAVÉS de él cuando la
      //  x del objetivo no coincidía con la puerta. Ahora: tramos laterales + dintel +
      //  umbral; con la vivienda cerrada el hueco queda tapado por la hoja (mismo plano
      //  puerta) y con alguien dentro es un acceso de verdad. Nada coplanar: los tramos
      //  ABUTAN contra la hoja sin compartirla (la hoja vive en doorZ, delante del canto).
      const doorGapW = pv.doorW;
      const doorFloorY = bottom + v.slab + v.wall; // nivel del suelo interior (base de la hoja)
      const gapL = Math.max(x0w, cx - doorGapW / 2);
      const gapR = Math.min(x1w, cx + doorGapW / 2);
      const doorTopY = Math.min(y + h / 2, doorFloorY + pv.doorH);
      const frontPiece = (name: string, pw: number, ph: number, px: number, py: number): void => {
        if (pw < 0.02 || ph < 0.02) return;
        const piece = box(name, pw, ph, v.wall, px, py, frontZ, m);
        view.frontParts.push(piece);
        if (!view.front) view.front = piece;
      };
      frontPiece(`${b.id}_puerta_i`, gapL - x0w, h, (x0w + gapL) / 2, y); // tramo izquierdo completo
      frontPiece(`${b.id}_puerta_d`, x1w - gapR, h, (gapR + x1w) / 2, y); // tramo derecho completo
      frontPiece(`${b.id}_puerta_dintel`, gapR - gapL, y + h / 2 - doorTopY, (gapL + gapR) / 2, (doorTopY + y + h / 2) / 2); // dintel
      frontPiece(`${b.id}_puerta_umbral`, gapR - gapL, doorFloorY - (y - h / 2), (gapL + gapR) / 2, (doorFloorY + y - h / 2) / 2); // umbral bajo la hoja
      // ── ZÓCALO (v1.25→v1.26): banda gris de ~25 cm desde el suelo, CORTADA en la puerta
      //  (dos tramos, sin cruzar el acceso — petición expresa del vecino). Continúa en el
      //  MARCO de la puerta (mismo material). Todo del catálogo (rules.view.privacy).
      const skH = pv.skirtingH ?? 0.25;
      const skMat = mat(`${b.id}_zocalo_mat`);
      skMat.diffuseColor = Color3.FromHexString(pv.skirtingColor ?? '#a3a19b');
      skMat.specularColor = new Color3(0.02, 0.02, 0.02);
      const ySk = bottom + v.slab + v.wall + skH / 2;
      const cutSkirting = pv.skirtingDoorGap ?? false;
      const skL = cutSkirting ? Math.max(x0w, cx - pv.doorW / 2) : x0w;
      const skR = cutSkirting ? Math.min(x1w, cx + pv.doorW / 2) : x1w;
      if (skL - x0w > 0.02) {
        view.greybox.push(attach(b.id, box(`${b.id}_zocalo_frente_i`, skL - x0w, skH, v.wall + 0.02, (x0w + skL) / 2, ySk, frontZ, skMat)));
      }
      if (x1w - skR > 0.02) {
        view.greybox.push(attach(b.id, box(`${b.id}_zocalo_frente_d`, x1w - skR, skH, v.wall + 0.02, (skR + x1w) / 2, ySk, frontZ, skMat)));
      }
      view.greybox.push(
        attach(b.id, box(`${b.id}_zocalo_izq`, v.wall + 0.02, skH, d - 2 * v.wall, cx - w / 2 + v.wall / 2, ySk, cz, skMat)),
        attach(b.id, box(`${b.id}_zocalo_der`, v.wall + 0.02, skH, d - 2 * v.wall, cx + w / 2 - v.wall / 2, ySk, cz, skMat)),
      );
      // Plano de la hoja de privacidad (compartido por candado y puerta): ligeramente
      // delante del canto de la fachada para no compartir plano con ella (regla de la casa).
      const doorZ = frontZ - v.wall / 2 - 0.035;
      // Candado DIBUJADO (v1.25): quad con silueta real de candado — los candados en forma
      // de caja desaparecen. Cuelga de la puerta de privacidad y sigue sacudiéndose.
      // v1.28 — SOBRE LA PUERTA, a la altura del tirador y ligeramente separada de la hoja
      // (petición del vecino): nada del candado flotando al lado de la puerta.
      const lh = pv.lockH ?? 0.28;
      const lw = lh * Math.max(0.5, Math.min(1.2, lockTexAr));
      const lockMat = mat(`${b.id}_candado_mat`);
      lockMat.diffuseTexture = padlockTex();
      lockMat.emissiveColor = Color3.FromHexString(v.lockColor).scale(0.22);
      lockMat.specularColor = new Color3(0, 0, 0);
      lockMat.transparencyMode = 1; // ALPHATEST (1, no 2=ALPHABLEND): recorte duro del candado
      lockMat.alphaCutOff = 0.35;
      lockMat.useAlphaFromDiffuseTexture = true; // v1.26: alpha de la textura → shader (ver diorama)
      view.lock = MeshBuilder.CreatePlane(`${b.id}_candado`, { width: lw, height: lh }, scene);
      view.lock.material = lockMat;
      view.lock.isPickable = false;
      const ld = pv.lockOnDoor;
      const lockX = ld ? cx + pv.doorW * ld.dx : cx - pv.doorW / 2 - 0.32;
      const lockY = ld ? doorFloorY + pv.doorH * ld.yFrac : view.lockBase.y;
      const lockZ = ld ? doorZ - ld.out : frontZ - v.wall / 2 - 0.07;
      view.lock.position.set(lockX, lockY, lockZ);
      view.lockBase = { x: lockX, y: lockY }; // el sacudido respeta el ancla nueva
      view.lock.setEnabled(false);

      // ── Privacidad (v1.24→v1.26): la puerta es un PLANO con arte real (full-bleed y
      //  opaco — dilateOpaque mata las rendijas negras). SIN marco 3D con frameW 0: el
      //  arte ya lleva su marco pintado y el gris que se veía alrededor era el overlay
      //  glTF (oculto por hideNodes). Aplique de luz a un lado (brilla de noche).
      //  Se activan/desactivan cada frame según haya alguien dentro (propietario, visita…
      //  o un ladrón); medidas y colores del catálogo (rules.view.privacy).
      view.door = MeshBuilder.CreatePlane(`${b.id}_puerta_priv`, { width: pv.doorW, height: pv.doorH }, scene);
      view.door.position.set(cx, bottom + v.slab + v.wall + pv.doorH / 2, doorZ);
      const doorMat = mat(`${b.id}_puerta_priv_mat`);
      doorMat.specularColor = new Color3(0, 0, 0);
      // Arte: una variante por hash del id (3 puertas del catálogo); textura cacheada por fichero.
      const artFile = pv.doorArts?.length ? pv.doorArts[Math.floor(hash01(b.id, 3) * pv.doorArts.length) % pv.doorArts.length]! : null;
      if (artFile) doorMat.diffuseTexture = doorArtTex(scene, artFile);
      else doorMat.diffuseColor = Color3.FromHexString(pv.doorColor);
      view.door.material = doorMat;
      view.door.isPickable = true; // v1.29: la hoja cerrada OCULTA bocadillos (rayo de oclusión)
      view.door.setEnabled(false);
      // Marco DEL COLOR DEL ZÓCALO (v1.25) — v1.26: SOLO si el catálogo pide grosor
      // (frameW > 0); con frameW 0 la hoja queda a sangre (el arte ya trae su marco
      // pintado y el "marco gris clarito" que se veía alrededor era el overlay glTF,
      // hoy oculto de verdad por hideNodes recursivo).
      const fw = pv.frameW ?? 0.075;
      const fz = frontZ - v.wall / 2 - 0.045;
      if (fw > 0.001) {
        const fd = pv.frameDepth ?? 0.1;
        const frameMat = mat(`${b.id}_marco_puerta_mat`);
        frameMat.diffuseColor = Color3.FromHexString(pv.skirtingColor ?? '#a3a19b');
        frameMat.specularColor = new Color3(0.03, 0.03, 0.03);
        const jambL = box(`${b.id}_marco_izq`, fw, pv.doorH + fw * 2, fd, cx - pv.doorW / 2 - fw / 2, bottom + v.slab + v.wall + pv.doorH / 2, fz, frameMat);
        const jambR = box(`${b.id}_marco_der`, fw, pv.doorH + fw * 2, fd, cx + pv.doorW / 2 + fw / 2, bottom + v.slab + v.wall + pv.doorH / 2, fz, frameMat);
        const lintel = box(`${b.id}_marco_sup`, pv.doorW + fw * 2, fw, fd, cx, bottom + v.slab + v.wall + pv.doorH + fw / 2, fz, frameMat);
        for (const j of [jambL, jambR, lintel]) {
          j.isPickable = false;
          j.setEnabled(false);
          view.doorDecor.push(j);
        }
      }
      // Aplique de luz ENCIMA a un lado (catálogo): cuerpo oscuro + foco cálido que amaanece de noche.
      if (pv.lamp) {
        const bodyMat = mat(`${b.id}_aplique_mat`);
        bodyMat.diffuseColor = Color3.FromHexString(pv.lamp.color);
        const lampBody = box(`${b.id}_aplique`, 0.1, 0.14, 0.08, cx + pv.lamp.side * pv.lamp.dx, bottom + pv.lamp.dy, fz - 0.02, bodyMat);
        lampBody.isPickable = false;
        lampBody.setEnabled(false);
        view.doorDecor.push(lampBody);
        const glowMat = mat(`${b.id}_aplique_foco_mat`);
        glowMat.diffuseColor = Color3.FromHexString(pv.lamp.glowColor);
        glowMat.emissiveColor = Color3.FromHexString(pv.lamp.glowColor).scale(0.06);
        doorLampMats.push({ mat: glowMat, hex: pv.lamp.glowColor });
        const lampGlow = box(`${b.id}_aplique_foco`, 0.06, 0.07, 0.06, cx + pv.lamp.side * pv.lamp.dx, bottom + pv.lamp.dy - 0.08, fz - 0.05, glowMat);
        lampGlow.isPickable = false;
        lampGlow.setEnabled(false);
        view.doorDecor.push(lampGlow);
      }

      // ── Cartel numerado (v1.6): rótulo sobre la puerta con el identificador de la vivienda
      // (blk_p3_c → "3C", blockLabel). Textura dinámica con colores/fuente del catálogo
      // (rules.view.plaque); se añade a greybox porque la vivienda usa modelo OVERLAY (el
      // greybox no se oculta) y no entra en mats: es señalización, no tinte ni glow.
      const pl = v.plaque;
      const plate = MeshBuilder.CreatePlane(`${b.id}_cartel`, { width: pl.w, height: pl.h, sideOrientation: B().Mesh.DOUBLESIDE }, scene);
      const tex = new (B().DynamicTexture)(`${b.id}_cartel_tex`, { width: 256, height: 96 }, scene, true);
      const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
      ctx.fillStyle = pl.bg;
      ctx.fillRect(0, 0, 256, 96);
      ctx.font = `bold ${pl.fontPx}px Arial, sans-serif`;
      ctx.fillStyle = pl.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(blockLabel(b.id), 128, 52);
      // update(true): el flag es invertY. Con false el canvas se sube SIN voltear y el texto
      // sale CABEZA ABAJO (la "A" se ve como "V"; B/C/D pasan por simétricas y esquivan el ojo).
      tex.update(true);
      const pmat = new StandardMaterial(`${b.id}_cartel_mat`, scene);
      pmat.diffuseTexture = tex;
      pmat.emissiveColor = Color3.FromHexString(pl.bg).scale(0.55); // legible en fachada norte
      pmat.specularColor = new Color3(0, 0, 0);
      plate.material = pmat;
      plate.position.set(cx, bottom + pl.y, frontZ + pl.z);
      view.greybox.push(plate);

      // ── Interior 2D (Fase C): suelos por estancia + lámparas + diorama. ──
      // TODO sale del layout del catálogo (rects + doorways); sin rects no hay interior 2D.
      // v1.29 — UN ÚNICO BLOQUE: NADA de tabiques ni tapas entre estancias. El vecino:
      // «me da la sensación que resultan de la unión de dos bloques pequeños y que por eso
      // existe una pared entre ambos… debe ser 1 único bloque del doble de tamaño de los
      // pequeños para que no exista ninguna pared divisoria entre ellos». Las estancias se
      // leen por su SUELO tintado (cerrada = lockedColor) y por el arte del diorama; la
      // verdad de accesibilidad vive en el sim (walkable), no en una hoja de puerta visual.
      const layoutId = content.blocks[b.defId]?.container?.layout;
      const layout = layoutId ? content.layouts[layoutId] : undefined;
      // Apilamiento 3D (v1.19): las salas TRASERAS no se pintan en el bloque principal — viven
      // en su propio bloque trasero (más abajo, se activan al entrar).
      const geoRooms = (layout?.rooms ?? []).filter((r) => r.rect !== undefined && r.rect!.z + r.rect!.d <= v.depth + 0.01);
      if (geoRooms.length > 0 && layout) {
        const interior: InteriorView = { floors: [], lamps: [], dio: newDioramaSet(), dioMats: [], dioRoot: null };
        const x0 = b.cell.col * v.cellW;
        // Suelo tintado por estancia (plancha fina sobre el suelo, alpha suave).
        for (const lr of geoRooms) {
          const r = lr.rect!;
          const fmat = mat(`${b.id}_${lr.key}_suelo_mat`);
          fmat.diffuseColor = Color3.FromHexString(content.rooms[lr.defId]?.view?.color ?? '#cccccc');
          fmat.alpha = 0.32;
          const fm = attach(b.id, box(`${b.id}_${lr.key}_suelo`, r.w, 0.02, r.d, x0 + r.x + r.w / 2, bottom + v.slab + v.wall + 0.02, frontZ + r.z + r.d / 2, fmat));
          interior.floors.push({ roomKey: lr.key, defId: lr.defId, mesh: fm, mat: fmat });
          // Lamparita de techo (v1.21): apagada de día; de noche ilumina la estancia si hay
          // alguien dentro despierto (sin propietario despierto, la estancia vive a oscuras).
          const lmat = mat(`${b.id}_${lr.key}_lampara_mat`);
          lmat.emissiveColor = Color3.FromHexString(v.privacy.handleColor); // cálido del catálogo
          const lm = attach(b.id, box(`${b.id}_${lr.key}_lampara`, Math.min(0.9, r.w * 0.4), 0.05, 0.22, x0 + r.x + r.w / 2, bottom + v.cellH - v.slab - v.wall - 0.05, frontZ + r.z + r.d / 2, lmat));
          lm.setEnabled(false);
          interior.lamps.push({ roomKey: lr.key, mesh: lm, mat: lmat });
        }
        interiors.set(b.id, interior);
        // ── DIORAMA (v1.23): pared ilustrada + suelo + capas de mobiliario billboard. Los
        // quads cuelgan de dioRoot (visibilidad espejo de la fachada en applyPanels) y del
        // root del bloque (se desvanecen con él en el apilamiento 3D).
        if (diro) {
          const dioRoot = new TransformNode(`${b.id}_dio_root`, scene);
          dioRoot.parent = roots.get(b.id)!;
          interior.dioRoot = dioRoot;
          const x0w = x0 + v.gapW / 2; // margen de la caja del bloque (cx − w/2)
          const x1w = x0 + b.size.w * v.cellW - v.gapW / 2;
          // v1.25 — VARIEDAD ALEATORIA entre viviendas (determinista por hash01 del bloque,
          // jamás RNG del sim): tinte de pared del catálogo, espejo del reparto, jitter y
          // pared alternativa (dio.walls). Cada vivienda se ve distinta; el sim no se entera.
          const catI = content.interiors;
          const mkVariant = (salt: number): DioramaVariant | undefined => {
            if (!catI) return undefined;
            const tints = catI.wallTints.length > 0 ? catI.wallTints : ['#ffffff'];
            return {
              tintHex: tints[Math.floor(hash01(b.id, 7700 + salt) * tints.length) % tints.length]!,
              mirror: hash01(b.id, 7800 + salt) < (catI.mirrorChance ?? 0),
              jitter: (catI.jitter ?? 0) * (hash01(b.id, 7900 + salt) - 0.5) * 2,
              wallIndex: Math.floor(hash01(b.id, 8000 + salt) * 1000),
              salt,
            };
          };
          geoRooms.forEach((lr, ri) => {
            const r = lr.rect!;
            // ¿La puerta a la sala trasera cae DENTRO de esta estancia? → pared con hueco + puerta pintada.
            const gapCenter = rearDoor ? x0w + rearDoor.at : NaN;
            const hostsDoor = !!rearDoor && gapCenter >= x0 + r.x && gapCenter <= x0 + r.x + r.w;
            const wallGap = hostsDoor && rearDoor
              ? { a: Math.max(x0w, x0w + rearDoor.at - rearDoor.width / 2), b: Math.min(x1w, x0w + rearDoor.at + rearDoor.width / 2) }
              : null;
            const room = diro.room(
              `${b.id}_${lr.key}`,
              lr.defId,
              r,
              { x0, frontZ, yBottom: bottom + v.slab + v.wall, yTop: bottom + v.cellH - v.slab - v.wall },
              { withRearDoor: hostsDoor, wallGap, parent: dioRoot, variant: mkVariant(ri * 13) },
            );
            if (room) {
              interior.dio.rooms.set(lr.key, room);
              for (const s of room.wall) interior.dioMats.push(s.mat);
              if (room.floor) interior.dioMats.push(room.floor.mat);
              if (room.door) interior.dioMats.push(room.door.mat);
              for (const s of room.sprites) interior.dioMats.push(s.mat);
            }
          });
          // v1.29 — CARCASO (petición del vecino): el parallax cubre TODAS las caras del
          // interior — laterales y techo con arte, UNA vez por vivienda (un solo bloque:
          // los laterales no cortan las estancias). El carcaso corre ENTRE las caras
          // interiores de los muros estructurales (x0w+wall/2 … x1w−wall/2) con 2 cm de
          // holgura (nada coplanar); cuelga del dioRoot (visibilidad de fachada).
          const shellSurfs = diro.shell(
            b.id,
            { w: x1w - x0w - v.wall, d: v.depth - v.wall },
            {
              x0: x0w + v.wall / 2,
              frontZ: frontZ + v.wall / 2,
              yBottom: bottom + v.slab + v.wall,
              yTop: bottom + v.cellH - v.slab - v.wall,
            },
            { parent: dioRoot },
          );
          interior.dio.shell.push(...shellSurfs);
          for (const s of shellSurfs) interior.dioMats.push(s.mat);
        }
      }
    } else if (b.defId === 'trasteros_planta' || b.defId === 'bajocubierta' || b.defId === v.trasteros.blockDefId) {
      // Nave de trasteros / sala de instalaciones (v1.16): forjado + trasera. El arte glTF
      // añade pilares (trasteros) o maquinaria (bajocubierta); las estanterías, trastos y
      // carteles numerados los levanta SIEMPRE el runtime desde rules.view.trasteros.
      // El bloque por COLUMNA (v1.18) comparte estructura: sus compartimentos los levanta
      // el runtime más abajo (pasillo central + celdas cerradas impares/pares).
      view.greybox.push(
        box(`${b.id}_forjado`, w, v.slab * 2, d, cx, bottom + v.slab, frontZ + d / 2, m),
        box(`${b.id}_trasera`, w, h, v.wall, cx, bottom + v.cellH / 2, frontZ + d - v.wall / 2, m),
      );
    } else if (b.defId === 'tejado') {
      // Tejadillo (v1.16): fallback = canto de cerramiento (el glTF trae faldones, cumbrera,
      // chimenea y antena).
      view.greybox.push(box(`${b.id}_canto`, w, v.slab * 2, d, cx, bottom + v.slab, frontZ + d / 2, m));
    } else if (b.defId === 'trasteros' || b.defId === 'local_comercial' || b.defId === 'lavanderia_comunal' || b.defId === 'garaje' || b.defId === 'portal') {
      // ── v1.30 — LOCALES DE LA PLANTA 0 con interior de verdad (v1.34: también el GARAJE;
      //  v1.35: también el PORTAL) ──
      //  · TRASTERO COMUNITARIO: dos puertas mapeadas que funcionan como las de las
      //    viviendas (abren al entrar alguien) y dentro, estanterías para todos los vecinos.
      //  · SALA DE JUNTAS: mapeada como local de reuniones (no vivienda) con mesa y sillas;
      //    convocada una junta, los vecinos entran y se sientan (también fiestas).
      //  · LAVANDERÍA: local ABIERTO sin pared frontal con las máquinas comunes dentro.
      //  · GARAJE (v1.34 — petición: «entrar por una puerta de la planta 0 debe dejar
      //    entrar en el bloque y ocultar la pared como en las viviendas»): la FACHADA es
      //    el arte glTF (puerta basculante que se LEVANTA al acercarse, rótulo y faroles);
      //    al entrar, la fachada se desvanece entera y queda el interior con mesa de
      //    trabajo, estantería, pila de ruedas y caja de herramientas (todo del catálogo).
      //  · PORTAL (v1.35 — «al abrirse se ven cerradas por una especie de pared oscura»):
      //    el cuerpo cerrado del arte glTF se RETIRA (hideNodes del catálogo) y el interior
      //    es UNA IMAGEN del hall (v1.36: diorama estancia_portal → wall_portal_hall.png):
      //    a través del cristal (y con las puertas abiertas) SE VE DENTRO.
      //  El arte glTF conserva zócalo/rótulo/faroles (hideNodes del catálogo retira el
      //  cuerpo cerrado); la fachada y el interior los levanta SIEMPRE el runtime con el
      //  gris de pasillo (locals.corridorWall) — mismo dialecto que las viviendas.
      const isLaundry = b.defId === 'lavanderia_comunal';
      const isGaraje = b.defId === 'garaje';
      const isPortal = b.defId === 'portal';
      const tc = loc.trasteroComunal;
      const jh = loc.juntaHall;
      const x0 = cx - w / 2; // borde izquierdo del bloque (los rects del layout son locales)
      const baseY = bottom + v.slab * 2;
      const H = v.cellH - v.slab * 2;
      const frontMat = hallFrontMat;
      const intMat = isLaundry || isGaraje ? (isGaraje ? hallGarajeMat : hallLaundryMat) : isPortal ? hallPortalMat : hallInnerMat;
      // Carcasa: forjado + fondo + laterales + techo (la lavandería SIN pared frontal).
      view.greybox.push(
        box(`${b.id}_forjado`, w, v.slab * 2, d, cx, bottom + v.slab, cz, m),
        box(`${b.id}_fondo`, w, H, v.wall, cx, baseY + H / 2, frontZ + d - v.wall / 2, intMat),
        box(`${b.id}_lado_i`, v.wall, H, d, cx - w / 2 + v.wall / 2, baseY + H / 2, cz, intMat),
        box(`${b.id}_lado_d`, v.wall, H, d, cx + w / 2 - v.wall / 2, baseY + H / 2, cz, intMat),
        box(`${b.id}_techo`, w, v.wall, d, cx, baseY + H - v.wall / 2, cz, intMat),
      );
      // Lámpara interior (caliente, como las de las viviendas; se enciende de noche si hay
      // alguien dentro o con la junta activa — el bucle de interiores la gobierna).
      const lampM = mat(`${b.id}_lampara_int_mat`);
      lampM.emissiveColor = Color3.FromHexString(v.privacy.handleColor);
      const lamp = box(`${b.id}_lampara_int`, Math.min(0.9, w * 0.4), 0.05, 0.22, cx, baseY + H - 0.05, frontZ + d * 0.55, lampM);
      lamp.setEnabled(false);
      // Fachada: paredes al gris de pasillo con el HUECO/S de puerta reales (la lavandería
      // se queda abierta de par en par; el garaje la pone el ARTE glTF — basculante — y el
      // runtime no duplica nada). Nada coplanar: la hoja vive delante del canto.
      const doorZHall = frontZ - v.wall / 2 - 0.035;
      const gapWs: number[] = [];
      // v1.37 — medidas del HUECO por bloque: trastero/sala usan sus puertas; el GARAJE usa
      // el hueco REAL de la basculante (catálogo locals.garaje.doorW/doorH).
      const gapDoorW = b.defId === 'trasteros' ? tc.doorW : isGaraje ? loc.garaje.doorW ?? 2.16 : jh.doorW;
      const gapDoorH = b.defId === 'trasteros' ? tc.doorH : isGaraje ? loc.garaje.doorH ?? 1.92 : v.privacy.doorH;
      if (isLaundry || isPortal) {
        // abierta (lavandería) o fachada del arte (portal): sin tramos ni hoja del runtime
      } else if (b.defId === 'trasteros') {
        gapWs.push(cx - tc.doorDx, cx + tc.doorDx);
      } else {
        // v1.37 — el GARAJE ENTRA AQUÍ (antes quedaba fuera y el frente final levantaba una
        // pared ENTERA: la «pared oscura» que seguía viéndose con la basculante levantada).
        // El frente se PARTE alrededor del hueco (jambas + dintel): la basculante del arte
        // cubre el hueco al cerrarse y al LEVANTARSE se ve el interior AL INSTANTE.
        gapWs.push(cx);
      }
      let prevEdge = cx - w / 2;
      const fp = (name: string, pw: number, ph: number, px: number, py: number): void => {
        if (pw < 0.02 || ph < 0.02) return;
        const mesh = box(name, pw, ph, v.wall, px, py, frontZ, frontMat);
        view.frontParts.push(mesh);
        if (!view.front) view.front = mesh;
      };
      for (const gx of gapWs) {
        const gL = gx - gapDoorW / 2;
        const gR = gx + gapDoorW / 2;
        const doorH = gapDoorH;
        fp(`${b.id}_frente_${gx.toFixed(2)}`, gL - prevEdge, H, (prevEdge + gL) / 2, baseY + H / 2);
        fp(`${b.id}_dintel_${gx.toFixed(2)}`, gR - gL, H - doorH, gx, baseY + doorH + (H - doorH) / 2);
        prevEdge = gR;
      }
      if (!isLaundry && !isPortal) fp(`${b.id}_frente_d`, cx + w / 2 - prevEdge, H, (prevEdge + cx + w / 2) / 2, baseY + H / 2);
      // Hoja/S de puerta con arte (solo trastero y sala — la lavandería no cierra y el
      // portal trae sus hojas de cristal en el arte glTF).
      // v1.32: las hojas cuelgan de BISAGRAS y se abren al acercarse (mismos movers que
      // las puertas de escalera y el portal) — ya no son planos fijos pegados al hueco.
      // v1.35 — hojas SOLO donde hay HUECO real (trastero y sala): el garaje (basculante del
      // arte) y el portal (cristal del arte) no llevan hoja del runtime — v1.34 generaba aquí
      // una hoja fantasma con gapWs vacío (hinge en NaN).
      if (b.defId === 'trasteros' || b.defId === 'local_comercial') {
        const leafWs = b.defId === 'trasteros' ? [tc.doorW, tc.doorW] : [jh.doorW];
        const leafHs = b.defId === 'trasteros' ? [tc.doorH, tc.doorH] : [v.privacy.doorH];
        const arts = b.defId === 'trasteros' ? [tc.doorArt, tc.doorArt] : ['/art/interiors/raw/door_casa_a.png'];
        leafWs.forEach((lw, li) => {
          const gx = gapWs[li]!;
          const lh = leafHs[li]!;
          // v1.35 — BISAGRAS IGUALES (petición del vecino: «la de la derecha debería abrir
          // exactamente igual que la de la izquierda si atendemos a su dibujo y donde está
          // el pomo»): AMBAS hojas del trastero cuelgan por su lado IZQUIQUIERDO con el MISMO
          // arte — el pomo del dibujo cae lejos de la bisagra en las dos, y el vaivén es
          // idéntico (antes la segunda alternaba y su pomo quedaba pegado al eje).
          const side: 1 | -1 = 1;
          const hinge = new TransformNode(`${b.id}_hoja_hinge_${li}`, scene);
          hinge.position.set(side > 0 ? gx - lw / 2 : gx + lw / 2, baseY, doorZHall);
          const leaf = MeshBuilder.CreatePlane(`${b.id}_hoja_${li}`, { width: lw, height: lh }, scene);
          const lmat = mat(`${b.id}_hoja_${li}_mat`);
          lmat.specularColor = new Color3(0, 0, 0);
          lmat.diffuseTexture = doorArtTexSized(scene, arts[li]!, lw, lh);
          leaf.material = lmat;
          leaf.isPickable = true; // v1.29: la hoja cerrada oculta bocadillos (rayo de oclusión)
          leaf.position.set((side > 0 ? 1 : -1) * (lw / 2), lh / 2, 0);
          leaf.parent = hinge;
          view.doorDecor.push(hinge);
          hallDoors.push({ hinge, openT: 0, doorX: gx, doorZ: doorZHall, floorY: baseY, side });
        });
      }
      // Interiores 2D + diorama + carcaso (las mismas tripas que una vivienda: suelos
      // tintados, lámpara y paredes con paralaje — el catálogo elige el arte).
      const layoutIdH = content.blocks[b.defId]?.container?.layout;
      const layoutH = layoutIdH ? content.layouts[layoutIdH] : undefined;
      const roomDef = layoutH?.rooms[0];
      if (layoutH && roomDef?.rect) {
        const interior: InteriorView = { floors: [], lamps: [], dio: newDioramaSet(), dioMats: [], dioRoot: null };
        interior.lamps.push({ roomKey: roomDef.key, mesh: lamp, mat: lampM });
        const rect = roomDef.rect;
        const fmatH = mat(`${b.id}_suelo_int_mat`);
        fmatH.diffuseColor = Color3.FromHexString(content.rooms[roomDef.defId]?.view?.color ?? '#cccccc');
        fmatH.alpha = 0.32;
        const fh = attach(b.id, box(`${b.id}_suelo_int`, rect.w, 0.02, rect.d, x0 + rect.x + rect.w / 2, baseY + 0.02, frontZ + rect.z + rect.d / 2, fmatH));
        interior.floors.push({ roomKey: roomDef.key, defId: roomDef.defId, mesh: fh, mat: fmatH });
        // v1.35 — LOSETAS VISIBLES también dentro de los locales y el vestíbulo: plano de
        // baldosas (misma textura que los pasillos) 6 mm SOBRE el suelo tintado — el tinte
        // de estado (cerrada = lockedColor) sigue leyéndose a través del alpha de las losas.
        const cfLoc = v.corridorFloor;
        if (cfLoc) {
          const locTex = makeTileTex(`${b.id}_losas_int`, rect.w, rect.d);
          const lmat = mat(`${b.id}_losas_int_mat`);
          lmat.diffuseTexture = locTex.tex;
          lmat.specularColor = new Color3(0.03, 0.03, 0.03);
          lmat.alpha = 0.62;
          const losasInt = attach(b.id, MeshBuilder.CreateGround(`${b.id}_losas_int`, { width: rect.w, height: rect.d }, scene));
          losasInt.position.set(x0 + rect.x + rect.w / 2, baseY + 0.042, frontZ + rect.z + rect.d / 2);
          losasInt.material = lmat;
          losasInt.isPickable = false;
          void locTex.ready;
        }
        interiors.set(b.id, interior);
        if (diro) {
          const dioRootH = new TransformNode(`${b.id}_dio_root`, scene);
          dioRootH.parent = root;
          interior.dioRoot = dioRootH;
          const roomH = diro.room(
            `${b.id}_int`,
            roomDef.defId,
            rect,
            { x0, frontZ, yBottom: baseY, yTop: baseY + H },
            { parent: dioRootH, variant: { tintHex: '#ffffff', mirror: false, jitter: 0, wallIndex: Math.floor(hash01(b.id, 8100) * 1000), salt: 0 } },
          );
          if (roomH) {
            interior.dio.rooms.set(roomDef.key, roomH);
            for (const s of roomH.wall) interior.dioMats.push(s.mat);
            if (roomH.floor) interior.dioMats.push(roomH.floor.mat);
            for (const s of roomH.sprites) interior.dioMats.push(s.mat);
          }
          const shellSurfsH = diro.shell(
            b.id,
            { w: w - v.wall, d: d - v.wall },
            { x0: cx - w / 2 + v.wall / 2, frontZ: frontZ + v.wall / 2, yBottom: baseY, yTop: baseY + H },
            { parent: dioRootH },
          );
          interior.dio.shell.push(...shellSurfsH);
          for (const s of shellSurfsH) interior.dioMats.push(s.mat);
        }
        // ── MOBILIARIO PROPIO de cada local (todo del catálogo) ──
        if (b.defId === 'trasteros') {
          // Estantería comunitaria del fondo: dos bahías con baldas, trastos y cartel.
          const woodM = mat(`${b.id}_est_madera_mat`);
          woodM.diffuseColor = Color3.FromHexString(v.trasteros.wood);
          const woodDarkM = mat(`${b.id}_est_madera_oscura_mat`);
          woodDarkM.diffuseColor = Color3.FromHexString(v.trasteros.woodDark);
          const junkMatsH = tr.junk.map((hex, i) => {
            const jm = mat(`${b.id}_trasto_${i}_mat`);
            jm.diffuseColor = Color3.FromHexString(hex);
            return jm;
          });
          const shelfZ = frontZ + d - v.wall - v.trasteros.shelfD / 2;
          for (const side of [-1, 1] as const) {
            const bx = cx + side * (w * 0.22);
            for (const sx of [-1, 1] as const) {
              view.greybox.push(box(`${b.id}_est_poste_${side}_${sx}`, v.trasteros.postW, tc.shelfTiers * tr.tierH, tr.shelfD, bx + sx * (v.trasteros.bayW * 0.32), baseY + (tc.shelfTiers * tr.tierH) / 2, shelfZ, woodDarkM));
            }
            for (let t = 1; t <= tc.shelfTiers; t++) {
              view.greybox.push(box(`${b.id}_est_balda_${side}_${t}`, v.trasteros.bayW * 0.64, v.trasteros.plankT, tr.shelfD, bx, baseY + t * tr.tierH - v.trasteros.plankT / 2, shelfZ, woodM));
              if (hash01(b.id, 3200 + side * 10 + t) < v.trasteros.junkChance) {
                const jw = 0.3 + hash01(b.id, 3300 + side * 10 + t) * 0.45;
                const jh2 = 0.18 + hash01(b.id, 3400 + side * 10 + t) * 0.2;
                const jm = junkMatsH[Math.floor(hash01(b.id, 3500 + side * 10 + t) * junkMatsH.length) % junkMatsH.length]!;
                view.greybox.push(box(`${b.id}_trasto_${side}_${t}`, jw, jh2, tr.shelfD * 0.7, bx + (hash01(b.id, 3600 + side * 10 + t) - 0.5) * 0.4, baseY + (t - 1) * tr.tierH + v.trasteros.plankT + jh2 / 2, shelfZ, jm));
              }
            }
          }
        } else if (b.defId === 'local_comercial') {
          // MESA LARGA + SILLAS de la junta (asientos del catálogo en coords locales).
          const woodM = mat(`${b.id}_mesa_madera_mat`);
          woodM.diffuseColor = Color3.FromHexString(jh.wood);
          const woodDarkM = mat(`${b.id}_mesa_patamat`);
          woodDarkM.diffuseColor = Color3.FromHexString(jh.woodDark);
          const tableZ = frontZ + jh.tableZ;
          view.greybox.push(
            box(`${b.id}_mesa_tapa`, jh.tableW, 0.06, jh.tableD, cx, baseY + 0.74, tableZ, woodM),
            box(`${b.id}_mesa_pata_i`, 0.08, 0.74, jh.tableD * 0.8, cx - jh.tableW / 2 + 0.25, baseY + 0.37, tableZ, woodDarkM),
            box(`${b.id}_mesa_pata_d`, 0.08, 0.74, jh.tableD * 0.8, cx + jh.tableW / 2 - 0.25, baseY + 0.37, tableZ, woodDarkM),
          );
          const seatsW: { x: number; z: number; yaw: number }[] = [];
          jh.seats.forEach(([sx, sz], si) => {
            const wx = x0 + sx;
            const wz = frontZ + sz;
            // Miran a la mesa (el centro de la tapa): el yaw sale de la dirección real.
            const fx = cx - wx;
            const fz = tableZ - wz;
            const len = Math.max(0.001, Math.hypot(fx, fz));
            const ux = fx / len;
            const uz = fz / len;
            const yaw = Math.atan2(-uz, ux);
            seatsW.push({ x: wx, z: wz, yaw });
            // Silla: asiento + respaldo DETRÁS de la persona + 4 patas (nada de billboards:
            // el vecino debe LEERSE sentado en ella desde la cámara frontal).
            view.greybox.push(
              box(`${b.id}_silla_${si}_asiento`, 0.44, 0.05, 0.44, wx, baseY + 0.46, wz, woodM),
              box(`${b.id}_silla_${si}_respaldo`, 0.44, 0.52, 0.05, wx - ux * 0.2, baseY + 0.72, wz - uz * 0.2, woodM),
            );
            for (const dx of [-0.18, 0.18]) {
              for (const dz of [-0.18, 0.18]) {
                view.greybox.push(box(`${b.id}_silla_${si}_pata_${dx}_${dz}`, 0.05, 0.46, 0.05, wx + dx, baseY + 0.23, wz + dz, woodDarkM));
              }
            }
          });
          // v1.32 — PUESTOS DE PIE del catálogo (mundo, mirando a la mesa): los asistentes
          // sin silla se reparten por aquí dentro del local, sin solapar a los sentados.
          const standsW: { x: number; z: number; yaw: number }[] = [];
          for (const [sx, sz] of jh.standSpots ?? []) {
            const wx = x0 + sx;
            const wz = frontZ + sz;
            const fx = cx - wx;
            const fz = tableZ - wz;
            const len = Math.max(0.001, Math.hypot(fx, fz));
            standsW.push({ x: wx, z: wz, yaw: Math.atan2(-fz / len, fx / len) });
          }
          hallSeats.set(b.id, { seats: seatsW, stands: standsW });
        } else if (b.defId === 'portal') {
          // v1.36 — el VESTÍBULO ya no lleva muebles 3D: el vecino pidió que el interior
          // del portal sea UNA IMAGEN del hall («una imagen del hall de un Portal de un
          // edificio, lo que se ve dentro») — el arte del diorama (interiors.json,
          // estancia_portal → wall_portal_hall.png) pinta buzones, tablón, banco, plantas,
          // ascensor y escalera; aquí solo quedan el suelo tintado, las losetas y la
          // lámpara que ya levanta el branch de locales.
        } else if (b.defId === 'garaje') {
          // v1.34 — GARAJE COMUNITARIO HABITABLE: mesa de trabajo con tablero de herramientas,
          // estantería con botes, pila de ruedas y caja de herramientas — TODO del catálogo
          // (locals.garaje.furniture). Al entrar, la fachada glTF se desvanece y esto se ve.
          const gf = loc.garaje.furniture;
          if (gf) {
            const benchM = mat(`${b.id}_g_banco_mat`);
            benchM.diffuseColor = Color3.FromHexString(gf.benchColor);
            benchM.emissiveColor = Color3.FromHexString(gf.benchColor).scale(0.14);
            const topM = mat(`${b.id}_g_tablero_mat`);
            topM.diffuseColor = Color3.FromHexString(gf.benchTopColor);
            topM.emissiveColor = Color3.FromHexString(gf.benchTopColor).scale(0.14);
            const tireM = mat(`${b.id}_g_rueda_mat`);
            tireM.diffuseColor = Color3.FromHexString(gf.tireColor);
            const shelfM = mat(`${b.id}_g_estante_mat`);
            shelfM.diffuseColor = Color3.FromHexString(gf.shelfColor);
            shelfM.emissiveColor = Color3.FromHexString(gf.shelfColor).scale(0.14);
            const boxM = mat(`${b.id}_g_caja_mat`);
            boxM.diffuseColor = Color3.FromHexString(gf.boxColor);
            const pegM = mat(`${b.id}_g_panel_mat`);
            pegM.diffuseColor = Color3.FromHexString(gf.pegColor);
            pegM.emissiveColor = Color3.FromHexString(gf.pegColor).scale(0.12);
            // Mesa de trabajo contra el fondo, a la izquierda; tablero perforado encima.
            const benchZ = frontZ + d - v.wall - gf.benchD / 2 - 0.05;
            const benchX = x0 + 0.25 + gf.benchW / 2;
            view.greybox.push(
              box(`${b.id}_g_banco_tapa`, gf.benchW, 0.06, gf.benchD, benchX, baseY + gf.benchH, benchZ, topM),
              box(`${b.id}_g_banco_cuerpo`, gf.benchW - 0.1, gf.benchH - 0.06, gf.benchD - 0.08, benchX, baseY + (gf.benchH - 0.06) / 2, benchZ, benchM),
              box(`${b.id}_g_panel`, gf.pegW, gf.pegH, 0.03, benchX, baseY + gf.benchH + 0.06 + gf.pegH / 2, frontZ + d - v.wall - 0.04, pegM),
              // Herramientas colgadas del tablero (llaves estilizadas, deterministas).
              box(`${b.id}_g_herr_1`, 0.05, 0.3, 0.02, benchX - gf.pegW * 0.25, baseY + gf.benchH + 0.3, frontZ + d - v.wall - 0.02, benchM),
              box(`${b.id}_g_herr_2`, 0.05, 0.24, 0.02, benchX + gf.pegW * 0.05, baseY + gf.benchH + 0.27, frontZ + d - v.wall - 0.02, benchM),
              box(`${b.id}_g_herr_3`, 0.05, 0.34, 0.02, benchX + gf.pegW * 0.32, baseY + gf.benchH + 0.32, frontZ + d - v.wall - 0.02, benchM),
            );
            // Caja de herramientas sobre la mesa.
            view.greybox.push(box(`${b.id}_g_caja`, gf.boxW, gf.boxH, gf.boxD, benchX + 0.32, baseY + gf.benchH + 0.03 + gf.boxH / 2, benchZ + 0.04, boxM));
            // Estantería a la derecha del fondo con botes.
            const shelfX = x0 + w - v.wall - 0.12 - gf.shelfD / 2;
            for (let t = 1; t <= gf.shelfTiers; t++) {
              view.greybox.push(box(`${b.id}_g_balda_${t}`, gf.shelfW, 0.04, gf.shelfD, shelfX, baseY + (t * gf.shelfH) / (gf.shelfTiers + 1), frontZ + d - v.wall - 0.12, shelfM));
              if (hash01(b.id, 7200 + t) < 0.8) {
                const jw = 0.14 + hash01(b.id, 7300 + t) * 0.1;
                view.greybox.push(box(`${b.id}_g_bote_${t}`, jw, 0.18 + hash01(b.id, 7400 + t) * 0.1, jw, shelfX + (hash01(b.id, 7500 + t) - 0.5) * (gf.shelfW - jw - 0.05), baseY + (t * gf.shelfH) / (gf.shelfTiers + 1) + 0.13, frontZ + d - v.wall - 0.12, boxM));
              }
            }
            for (const sx of [-1, 1]) {
              view.greybox.push(box(`${b.id}_g_poste_${sx > 0 ? 'd' : 'i'}`, 0.06, gf.shelfH, 0.06, shelfX + sx * (gf.shelfW / 2 - 0.03), baseY + gf.shelfH / 2, frontZ + d - v.wall - 0.12, shelfM));
            }
            // Pila de ruedas en la esquina frontal derecha (neumáticos apilados de verdad).
            const tireX = x0 + w - v.wall - 0.35;
            const tireZ = frontZ + 0.42;
            for (let t = 0; t < gf.tireCount; t++) {
              const tire = attach(b.id, MeshBuilder.CreateCylinder(`${b.id}_g_neumatico_${t}`, { diameter: gf.tireR * 2, height: 0.19, tessellation: 16 }, scene));
              tire.position.set(tireX, baseY + 0.095 + t * 0.19, tireZ);
              tire.material = tireM;
              tire.isPickable = false;
              view.greybox.push(tire);
            }
          }
        } else {
          // LAVANDERÍA v1.35 — MÁQUINAS DE VERDAD (petición: «mapear volúmenes con el
          // frontal de la lavadora, 3 abajo y 3 arriba que sean secadoras, y que algunas
          // veas girar el bombo»): columnas apiladas de VOLUMEN — cuerpo + frontal mapeado
          // (canvas con tambor transparente) + BOMBO (disco) que GIRA en las «en marcha».
          // Nada coplanar: el frontal sale 12 mm del cuerpo y el bombo vive 3 cm detrás.
          const lv = loc.lavanderia;
          const stacks = Math.max(1, lv.stacks ?? 3);
          const mW = lv.machineW ?? 0.64;
          const wH = lv.washerH ?? 0.86;
          const dH = lv.dryerH ?? 0.78;
          const mD = lv.machineD ?? 0.6;
          const gapY = lv.stackGap ?? 0.05;
          const usableW = w - 0.72;
          const colStep = usableW / stacks;
          const zBack = frontZ + d - v.wall - mD / 2 - 0.08;
          // v1.37 — COLISIÓN: las máquinas son SÓLIDAS (el vecino: «que no puedan atravesar
          // las lavadoras»). Rects en MUNDO que player-logic (jugador dentro) y actors.ts
          // (vecinos) respetan — las mismas cajas que se ven son las que estorban.
          const blockers = blockObstacles.get(b.id) ?? [];
          blockObstacles.set(b.id, blockers);
          const bodyM = mat(`${b.id}_lav_cuerpo_mat`);
          bodyM.diffuseColor = Color3.FromHexString(lv.bodyColor ?? '#e8e6e0');
          const topM = mat(`${b.id}_lav_tapa_mat`);
          topM.diffuseColor = Color3.FromHexString(lv.topColor ?? '#f2f0ea');
          const drumMat = mat(`${b.id}_lav_bombo_mat`);
          drumMat.diffuseColor = Color3.FromHexString(lv.drumGlass ?? '#8fa3ad');
          drumMat.emissiveColor = Color3.FromHexString(lv.drumGlass ?? '#8fa3ad').scale(0.35);
          drumMat.specularColor = new Color3(0.3, 0.3, 0.3);
          drumMat.backFaceCulling = false;
          /** v1.36 — CARA del bombo con CRUCETAS y PERNOS: un disco liso girando es invisible
           *  (el vecino: «no se mueven los bombos») — con radios que giran se LEE el giro.
           *  Una sola textura compartida por todas las máquinas. */
          const drumFaceTex = (): DynamicTexture => {
            const dt = new (B().DynamicTexture)('lav_bombo_cara_tex', { width: 256, height: 256 }, scene, true);
            const c = dt.getContext() as unknown as CanvasRenderingContext2D;
            const R = 128;
            // Cubo metálico con brillo descentrado (el cristal del bombo).
            const grad = c.createRadialGradient(R - 40, R - 44, 12, R, R, R);
            grad.addColorStop(0, lv.drumGlass ?? '#8fa3ad');
            grad.addColorStop(0.55, '#76858f');
            grad.addColorStop(1, '#57646e');
            c.fillStyle = grad;
            c.fillRect(0, 0, 256, 256);
            // Crucetas: TRES radios a 120° (el giro se ve con una sola ojeada).
            c.strokeStyle = '#4a5560';
            c.lineWidth = 17;
            c.lineCap = 'round';
            for (let k = 0; k < 3; k++) {
              const a = (k * Math.PI * 2) / 3;
              c.beginPath();
              c.moveTo(R, R);
              c.lineTo(R + Math.cos(a) * (R - 16), R + Math.sin(a) * (R - 16));
              c.stroke();
            }
            // Hub central + pernos del aro (más referencia de rotación).
            c.fillStyle = '#3d4650';
            c.beginPath();
            c.arc(R, R, 22, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = '#6d7a85';
            for (let k = 0; k < 8; k++) {
              const a = (k * Math.PI * 2) / 8 + 0.39;
              c.beginPath();
              c.arc(R + Math.cos(a) * (R - 26), R + Math.sin(a) * (R - 26), 7, 0, Math.PI * 2);
              c.fill();
            }
            dt.update(true);
            return dt;
          };
          drumMat.diffuseTexture = drumFaceTex();
          /** Frontal de máquina (canvas): panel de mandos, perillas y PUERTA con el centro
           *  TRANSPARENTE (por el agujero se ve el bombo girando detrás). */
          const machineFrontTex = (kind: 'washer' | 'dryer', seed: number): DynamicTexture => {
            const dt = new (B().DynamicTexture)(`lav_frontal_${kind}_${seed}_tex`, { width: 256, height: 320 }, scene, true);
            const c = dt.getContext() as unknown as CanvasRenderingContext2D;
            const W = 256;
            const H = 320;
            c.fillStyle = lv.frontColor ?? '#d8d6cf';
            c.fillRect(0, 0, W, H);
            // Bisel superior (tapa) + panel de mandos.
            c.fillStyle = lv.topColor ?? '#f2f0ea';
            c.fillRect(0, 0, W, 26);
            c.fillStyle = lv.panelColor ?? '#5d6b7a';
            c.fillRect(10, 36, W - 20, 44);
            c.fillStyle = '#f4e9d8';
            c.fillRect(18, 46, 74, 24); // display
            c.fillStyle = kind === 'washer' ? (lv.accentColor ?? '#84a59d') : '#c97b5a';
            for (const kx of [176, 218]) {
              c.beginPath();
              c.arc(kx, 58, 13, 0, Math.PI * 2);
              c.fill();
            }
            // Puerta circular: aro metálico + cristal; el CENTRO se borra (alpha 0).
            const cx0 = W / 2;
            const cy0 = 206;
            const rOut = 88;
            c.fillStyle = '#b8b6ae';
            c.beginPath();
            c.arc(cx0, cy0, rOut, 0, Math.PI * 2);
            c.fill();
            c.fillStyle = lv.drumColor ?? '#4a5560';
            c.beginPath();
            c.arc(cx0, cy0, rOut - 12, 0, Math.PI * 2);
            c.fill();
            c.save();
            c.beginPath();
            c.arc(cx0, cy0, rOut - 20, 0, Math.PI * 2);
            c.clip();
            c.fillStyle = 'rgba(90,110,125,0.92)';
            c.fillRect(cx0 - rOut, cy0 - rOut, rOut * 2, rOut * 2);
            c.restore();
            // Agujero transparente: por aquí se ve el bombo (disco 3D girando).
            c.clearRect(cx0 - (rOut - 24), cy0 - (rOut - 24), (rOut - 24) * 2, (rOut - 24) * 2);
            // Bisagra y tirador de la escotilla.
            c.fillStyle = '#7d7668';
            c.fillRect(W - 16, cy0 - 10, 10, 20);
            c.beginPath();
            c.arc(14, cy0, 9, 0, Math.PI * 2);
            c.fill();
            if (kind === 'dryer') {
              // Rejilla de pelusa bajo el panel (diferencia visual de la secadora).
              c.fillStyle = '#a3a199';
              for (let i = 0; i < 5; i++) c.fillRect(24, 96 + i * 7, W - 48, 3);
            }
            dt.update(true);
            dt.hasAlpha = true;
            return dt;
          };
          for (let s = 0; s < stacks; s++) {
            const mx = x0 + 0.36 + colStep * (s + 0.5);
            blockers.push({ x0: mx - mW / 2 - 0.02, z0: zBack - mD / 2 - 0.02, w: mW + 0.04, d: mD + 0.04 });
            // LAVADORA (abajo) + SECADORA (arriba): cuerpos, tapas y frontales mapeados.
            const bodies: { kind: 'washer' | 'dryer'; h: number; y0: number }[] = [
              { kind: 'washer', h: wH, y0: baseY },
              { kind: 'dryer', h: dH, y0: baseY + wH + gapY },
            ];
            for (const bd of bodies) {
              const mid = bd.y0 + bd.h / 2;
              view.greybox.push(
                box(`${b.id}_lav_${bd.kind}_${s}_cuerpo`, mW, bd.h, mD, mx, mid, zBack, bodyM),
                box(`${b.id}_lav_${bd.kind}_${s}_tapa`, mW * 0.98, 0.03, mD * 0.96, mx, bd.y0 + bd.h - 0.015, zBack, topM),
              );
              const fm = mat(`${b.id}_lav_${bd.kind}_${s}_frontal_mat`);
              fm.diffuseTexture = machineFrontTex(bd.kind, s);
              fm.specularColor = new Color3(0.08, 0.08, 0.08);
              fm.transparencyMode = 1; // ALPHATEST: frontal de lavadora recortado
              fm.alphaCutOff = 0.3;
              fm.useAlphaFromDiffuseTexture = true;
              fm.backFaceCulling = false;
              const front = attach(b.id, MeshBuilder.CreatePlane(`${b.id}_lav_${bd.kind}_${s}_frontal`, { width: mW * 0.94, height: bd.h * 0.96 }, scene));
              front.position.set(mx, mid, zBack - mD / 2 - 0.012);
              front.material = fm;
              front.isPickable = false;
              // BOMBO: disco con crucetas que gira (determinista: hash01 < drumOnChance).
              const on = hash01(`${b.id}:lav:${s}:${bd.kind}`, 3300) < (lv.drumOnChance ?? 0.5);
              if (on) {
                const drum = attach(b.id, MeshBuilder.CreateDisc(`${b.id}_lav_${bd.kind}_${s}_bombo`, { radius: (mW * 0.94) * 0.185, tessellation: 24 }, scene));
                drum.position.set(mx, mid - bd.h * 0.06, zBack - mD / 2 - 0.03);
                drum.material = drumMat;
                drum.isPickable = false;
                const speed = (lv.drumSpeedMin ?? 2.2) + hash01(`${b.id}:lavspd:${s}:${bd.kind}`, 3400) * ((lv.drumSpeedMax ?? 4.4) - (lv.drumSpeedMin ?? 2.2));
                laundryDrums.push({ mesh: drum, speed: (s % 2 === 0 ? 1 : -1) * speed });
              }
            }
          }
        }
      }
      if (!isLaundry) halls.add(b.id);
    } else {
      view.greybox.push(box(b.id, w, h, d, cx, bottom + v.cellH / 2, cz, m));
      if (b.defId === 'garaje') {
        // v1.30 — acceso de garajes MEJOR DEFINIDO: pilastras flanqueando la puerta
        // basculante (el bloque se lee como acceso de garajes, petición del vecino).
        const g = loc.garaje;
        const pilMat = mat(`${b.id}_pilastra_mat`);
        pilMat.diffuseColor = Color3.FromHexString(g.rail);
        pilMat.specularColor = new Color3(0.04, 0.04, 0.04);
        for (const s of [-1, 1] as const) {
          view.greybox.push(box(`${b.id}_pilastra_${s}`, 0.14, h, 0.14, cx + s * 1.06, bottom + v.cellH / 2, frontZ - v.wall / 2 - 0.06, pilMat));
        }
      }
    }
    // v1.19: toda malla estructural del bloque cuelga de su raíz (swap de bloques).
    for (const mesh of view.greybox) mesh.parent = root;
    for (const p of view.frontParts) p.parent = root; // v1.28: fachada partida entera
    for (const dd of view.doorDecor) dd.parent = root; // v1.30: hojas de los locales también
    if (view.lock) view.lock.parent = root;
    if (view.door) view.door.parent = root;
    if (view.handle) view.handle.parent = root;
    views.set(b.id, view);
  }

  // ── RELLENO DE JUNTAS ENTRE BLOQUES (v1.26→v1.27): entre bloque y bloque queda una ranura
  //  de gapW por la que se veía la parte trasera del edificio. Una tapa del color de la pared
  //  (privacy.gapFill) cierra cada hueco de la banda principal — data-driven, sin tocar el
  //  catálogo de bloques: cualquier reordenación re-crea los rellenos sola.
  //  v1.27 — NADA COPLANAR: la tapa SALE hacia la calle hasta delante de la cara de fachada
  //  (protrude) y su cara frontal lleva un escalonado determinista por bloque (stagger de
  //  hash01): dos rellenos (o relleno y solera) vecinos jamás comparten plano — los elementos
  //  coplanares son foco de parpadeos/artefactos y el vecino los cazó en vivo. Sus caras
  //  laterales quedan ESCONDIDAS dentro del volumen de los muros laterales vecinos (pad < wall/2).
  {
    const gf = v.privacy.gapFill;
    if (gf) {
      const fillMat = mat('junta_relleno_mat');
      fillMat.diffuseColor = Color3.FromHexString(gf.color);
      fillMat.specularColor = new Color3(0.02, 0.02, 0.02);
      const mainBlocks = Object.values(world.blocks).filter((b) => b.layer === 'main');
      const byFloor = new Map<number, BlockInstance[]>();
      for (const b of mainBlocks) {
        const arr = byFloor.get(b.cell.floor) ?? [];
        arr.push(b);
        byFloor.set(b.cell.floor, arr);
      }
      for (const [floor, arr] of byFloor) {
        arr.sort((a, z) => a.cell.col - z.cell.col);
        for (let i = 1; i < arr.length; i++) {
          const prev = arr[i - 1]!;
          const cur = arr[i]!;
          const prevRight = (prev.cell.col + prev.size.w) * v.cellW - v.gapW / 2;
          const curLeft = cur.cell.col * v.cellW + v.gapW / 2;
          const a = prevRight - gf.pad;
          const z = curLeft + gf.pad;
          if (z - a <= 0.02) continue;
          const dep = Math.max(depthOf(prev), depthOf(cur));
          const out = (gf.protrude ?? 0.012) + hash01(`junta_p${floor}_${i}`, 41) * (gf.stagger ?? 0.008);
          const zFront = frontZ - v.wall / 2 - out;
          attach(cur.id, box(`junta_p${floor}_${i}`, z - a, v.cellH - v.gapH, frontZ + dep - zFront, (a + z) / 2, floor * v.cellH + (v.cellH - v.gapH) / 2, zFront + (frontZ + dep - zFront) / 2, fillMat));
        }
      }
    }
  }

  // ── SOLERA DE LOS BLOQUES (v1.27): banda en la BASE de cada bloque de la banda principal
  //  (viviendas y compañeros de fila) que sella la JUNTA VERTICAL entre un bloque y el
  //  siguiente en altura — por la ranura de gapH se veía a través del edificio. La solera
  //  cubre la ranura completa (baja hasta el canto superior del bloque inferior) y asoma un
  //  listón por encima del arranque del bloque, leyéndose como plinto. Misma regla anti-
  //  coplanaridad que las juntas: cara frontal SALIENDO al frente con escalonado por hash,
  //  caras laterales cubriendo las ranuras horizontales (solapan dentro del vecino).
  {
    const so = v.privacy.solera;
    if (so) {
      const soMat = mat('solera_mat');
      soMat.diffuseColor = Color3.FromHexString(so.color);
      soMat.specularColor = new Color3(0.02, 0.02, 0.02);
      for (const b of Object.values(world.blocks)) {
        if (b.layer !== 'main') continue;
        if (b.defId === 'tejado' || b.defId === 'bajocubierta') continue; // remates: sin solera
        // v1.35 — los bloques que VISUALMENTE abarcan spanW celdas (los cubos de escalera)
        // llevan la solera a lo ancho REAL: antes cubría solo size.w y la mitad derecha
        // del cubo quedaba sin plinto (junta abierta visible junto a la vivienda C).
        const isStairsBlk = content.blocks[b.defId]!.features?.stairs === true;
        const spanCells = isStairsBlk ? v.stairs.spanW ?? b.size.w : b.size.w;
        const x0 = b.cell.col * v.cellW - v.gapW / 2 - 0.004;
        const x1 = (b.cell.col + spanCells) * v.cellW + v.gapW / 2 + 0.004;
        const yBot = b.cell.floor * v.cellH - v.gapH / 2;
        const yTop = b.cell.floor * v.cellH + v.gapH / 2 + so.h;
        const dep = depthOf(b);
        const out = (so.protrude ?? 0.016) + hash01(b.id, 43) * (so.stagger ?? 0.008);
        const zFront = frontZ - v.wall / 2 - out;
        attach(b.id, box(`${b.id}_solera`, x1 - x0, yTop - yBot, frontZ + dep - zFront, (x0 + x1) / 2, (yBot + yTop) / 2, zFront + (frontZ + dep - zFront) / 2, soMat));
      }
    }
  }

  // ── DECALS DE DRAMA (v1.35): GRAFITIS + HUMEDADES/GRIETAS/HOLLÍN/SUCIEDAD ──
  //  · GRAFITIS (petición: «cuando se hacen pintadas en ascensor o paredes que aparezca
  //    un grafiti con texto o dibujo gracioso»): el nivel de `cabin_graffiti` del núcleo
  //    (lo sube Pinturillas al pintar la cabina) salpica también los MUROS del cubo de
    //  escalera y el vestíbulo del portal cuando pasa el umbral del catálogo
  //  (graffiti.spillToWalls). La junta los limpia (param a 0) y desaparecen solos.
  //  · DECAY (petición: «humo, humedades, grietas etc. que se vean claramente, aportan
  //    dramatismo»): cada vivienda pinta manchas de humedad/hollín/grietas según sus
  //    parámetros del sim (humidity/soot/condition) y el pasillo, mugre en el suelo según
  //    cleanliness. Opacidad proporcional al valor: cuanto peor, más se ve.
  //  Nada coplanar: los decals viven 12 mm delante de la cara que los soporta.
  const graffitiCfg = v.graffiti;
  const decayCfg = v.decay;
  /** Manchas de decay por bloque: paint() calcula su alpha con el parámetro del sim.
   *  invert=true → la mancha crece cuando el parámetro BAJA (condición/limpieza). */
  const decayDecals: { mesh: Mesh; blockId: string; param: string; from: number; to: number; invert: boolean }[] = [];
  /** Grafitis de muro (cubos de escalera + vestíbulo): el alpha lo fija paint() con el
   *  nivel de cabin_graffiti del núcleo (spillToWalls del catálogo). */
  const graffitiWalls: Array<(alpha: number) => void> = [];
  if (graffitiCfg || decayCfg) {
    // v1.40 — RECORTE DE VERDAD: los decals se pintan en un canvas SUELTO y suben por
    // TEXTURE(dataURL) con hasAlpha. Los DynamicTexture desde canvas pierden el canal alpha
    // en esta config (WebGPU/CDN: píxeles alpha=0 → NEGRO, bug documentado en el candado
    // v1.26) — por eso los grafitis y las manchas se veían con «caja negra» alrededor.
    // El patrón bueno ya estaba en casa: padlockTex() lo usa desde v1.26.
    const decalMat = (name: string, tex: Texture, alpha: number): StandardMaterial => {
      const m = mat(name);
      m.diffuseTexture = tex;
      m.specularColor = new Color3(0, 0, 0);
      m.emissiveColor = new Color3(0.22, 0.22, 0.22);
      m.alpha = alpha;
      m.backFaceCulling = false;
      // v1.41 — RECORTE DE VERDAD (II): sin esto, Babylon 8 NO pasa el alpha de la textura
      // al shader (default false) y el quad se veía como caja translúcida alrededor del
      // motivo — los grafitis «mal recortados». Con la bandera, el alpha del canvas manda.
      m.useAlphaFromDiffuseTexture = true;
      return m;
    };
    /** v1.41 — subida de decal con RECORTE a la caja del contenido (mismo trato que el
     *  candado desde v1.26): el quad del catálogo enmarca exactamente el motivo, sin halo
     *  vacío alrededor. El pad 6 px conserva la pluma del spray. */
    const decalTex = (name: string, src: HTMLCanvasElement): Texture => {
      const b = alphaBoundsOf(src);
      if (!b) return canvasTex(name, src);
      const pad = 6;
      const x0 = Math.max(0, b.x0 - pad);
      const y0 = Math.max(0, b.y0 - pad);
      const w = Math.min(src.width - x0, b.x1 - b.x0 + pad * 2);
      const h = Math.min(src.height - y0, b.y1 - b.y0 + pad * 2);
      const out = document.createElement('canvas');
      out.width = Math.max(2, Math.round(w));
      out.height = Math.max(2, Math.round(h));
      const octx = out.getContext('2d');
      if (!octx) return canvasTex(name, src);
      octx.drawImage(src, x0, y0, w, h, 0, 0, w, h);
      return canvasTex(name, out);
    };
    /** Canvas 2D suelto (nada de DynamicTexture: ver nota v1.40 arriba). */
    const decalCanvas = (name: string, w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null => {
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      return { c: cv, ctx };
    };
    /** Manchas de HUMEDAD: placas marrones superpuestas con chorretones hacia abajo. */
    const humidityTex = (): Texture => {
      const got = decalCanvas('decal_humedad', 256, 256);
      const fallback = canvasTex('decal_humedad_vacio', document.createElement('canvas'));
      if (!got) return fallback;
      const c = got.ctx;
      for (let i = 0; i < 5; i++) {
        const bx = 60 + hash01('hum', i) * 130;
        const by = 40 + hash01('hum', 20 + i) * 60;
        const r = 34 + hash01('hum', 40 + i) * 40;
        const g = c.createRadialGradient(bx, by, 4, bx, by, r);
        g.addColorStop(0, 'rgba(96,72,48,0.75)');
        g.addColorStop(0.6, 'rgba(110,86,58,0.4)');
        g.addColorStop(1, 'rgba(110,86,58,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(bx, by, r, 0, Math.PI * 2);
        c.fill();
        for (let d = 0; d < 3; d++) {
          const dx = bx + (hash01('chor', i * 7 + d) - 0.5) * r;
          c.fillStyle = 'rgba(96,72,48,0.5)';
          c.fillRect(dx, by + r * 0.4, 3 + hash01('chor', i * 9 + d) * 3, 40 + hash01('chor', i * 11 + d) * 70);
        }
      }
      return decalTex('decal_humedad_tex', got.c);
    };
    /** GRIETAS: trazos oscuros ramificados con tramos en zigzag. */
    const crackTex = (): Texture => {
      const got = decalCanvas('decal_grieta', 256, 256);
      const fallback = canvasTex('decal_grieta_vacio', document.createElement('canvas'));
      if (!got) return fallback;
      const c = got.ctx;
      c.lineCap = 'round';
      const branch = (x: number, y: number, dir: number, len: number, w: number, depth: number): void => {
        c.strokeStyle = `rgba(30,26,22,${0.55 + depth * 0.1})`;
        c.lineWidth = w;
        c.beginPath();
        c.moveTo(x, y);
        let px = x;
        let py = y;
        const steps = 7;
        for (let s = 0; s < steps; s++) {
          px += Math.cos(dir) * (len / steps) + (hash01('gri', depth * 100 + s) - 0.5) * 7;
          py += Math.sin(dir) * (len / steps) + (hash01('gri', depth * 200 + s) - 0.5) * 7;
          c.lineTo(px, py);
        }
        c.stroke();
        if (depth < 2) {
          branch(px, py, dir + 0.7 + hash01('gri', depth) * 0.5, len * 0.55, w * 0.6, depth + 1);
          branch(px, py, dir - 0.8 - hash01('gri', 30 + depth) * 0.5, len * 0.5, w * 0.55, depth + 1);
        }
      };
      branch(128, 24, Math.PI / 2 + 0.15, 200, 5, 0);
      branch(70, 120, Math.PI / 2 - 0.5, 110, 3.4, 1);
      return decalTex('decal_grieta_tex', got.c);
    };
    /** HOLLÍN: penacho gris oscuro que sube (humo viejo sobre fogones/chimenea). */
    const sootTex = (): Texture => {
      const got = decalCanvas('decal_hollin', 256, 256);
      const fallback = canvasTex('decal_hollin_vacio', document.createElement('canvas'));
      if (!got) return fallback;
      const c = got.ctx;
      for (let i = 0; i < 7; i++) {
        const bx = 128 + (hash01('hol', i) - 0.5) * 70;
        const by = 210 - i * 26;
        const r = 66 - i * 6;
        const g = c.createRadialGradient(bx, by, 3, bx, by, Math.max(8, r));
        g.addColorStop(0, 'rgba(28,26,24,0.72)');
        g.addColorStop(1, 'rgba(28,26,24,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(bx, by, Math.max(8, r), 0, Math.PI * 2);
        c.fill();
      }
      return decalTex('decal_hollin_tex', got.c);
    };
    /** Mugre del pasillo: charcos grises/verdosos en el suelo. */
    const grimeTex = (): Texture => {
      const got = decalCanvas('decal_mugre', 256, 256);
      const fallback = canvasTex('decal_mugre_vacio', document.createElement('canvas'));
      if (!got) return fallback;
      const c = got.ctx;
      for (let i = 0; i < 4; i++) {
        const bx = 50 + hash01('mug', i) * 156;
        const by = 50 + hash01('mug', 30 + i) * 156;
        const r = 30 + hash01('mug', 60 + i) * 44;
        const g = c.createRadialGradient(bx, by, 2, bx, by, r);
        g.addColorStop(0, 'rgba(64,60,40,0.66)');
        g.addColorStop(1, 'rgba(64,60,40,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(bx, by, r, 0, Math.PI * 2);
        c.fill();
      }
      return decalTex('decal_mugre_tex', got.c);
    };
    /** GRAFITI: texto en spray con contorno, goteos y un dibujo (corona, estrella, gato,
     *  flecha, carita, rayo) — todo gracioso y del catálogo. Cache por variante: el dataURL
     *  solo se calcula una vez aunque la mancha se repita en varios muros. */
    const graffitiCache = new Map<string, Texture>();
    const graffitiTex = (text: string, colorHex: string, doodle: string, gCfg: NonNullable<typeof v.graffiti>): Texture => {
      const key = `${text}|${colorHex}|${doodle}`;
      const hit = graffitiCache.get(key);
      if (hit) return hit;
      const got = decalCanvas('decal_grafiti', 512, 256);
      const fallback = canvasTex('decal_grafiti_vacio', document.createElement('canvas'));
      if (!got) return fallback;
      const c = got.ctx;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      // Nube de spray de fondo (halo del color).
      const col = Color3.FromHexString(colorHex);
      const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
      const g = c.createRadialGradient(256, 128, 30, 256, 128, 240);
      g.addColorStop(0, `rgba(${rgb},0.34)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      c.fillStyle = g;
      c.fillRect(0, 0, 512, 256);
      // Texto en spray: dos pasadas (contorno oscuro + relleno) con fuente trazo grueso.
      const words = text.split(' ');
      const lines: string[] = [];
      let cur = '';
      for (const w of words) {
        if ((cur + ' ' + w).trim().length > 14) { lines.push(cur.trim()); cur = w; }
        else cur = (cur + ' ' + w).trim();
      }
      if (cur) lines.push(cur.trim());
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = 'italic bold 52px "Comic Sans MS", Arial, sans-serif';
      lines.forEach((ln, li) => {
        const ty = 70 + li * 62;
        c.lineWidth = 14;
        c.strokeStyle = gCfg.outline;
        c.strokeText(ln, 256, ty);
        c.lineWidth = 7;
        c.strokeStyle = `rgba(${rgb},1)`;
        c.strokeText(ln, 256, ty);
        c.fillStyle = 'rgba(255,255,255,0.85)';
        c.font = 'italic bold 46px "Comic Sans MS", Arial, sans-serif';
        c.fillText(ln, 256, ty);
        c.font = 'italic bold 52px "Comic Sans MS", Arial, sans-serif';
      });
      // Goteos de pintura desde las letras.
      c.fillStyle = `rgba(${rgb},0.8)`;
      for (let i = 0; i < 6; i++) {
        const dx = 60 + hash01('gota', i) * 390;
        c.fillRect(dx, 110 + hash01('gota', 20 + i) * 90, 5, 22 + hash01('gota', 40 + i) * 40);
        c.beginPath();
        c.arc(dx + 2.5, 132 + hash01('gota', 40 + i) * 40 + 22, 4, 0, Math.PI * 2);
        c.fill();
      }
      // Dibujo gracioso en una esquina.
      c.strokeStyle = gCfg.outline;
      c.fillStyle = `rgba(${rgb},0.9)`;
      c.lineWidth = 6;
      const dx0 = 60 + hash01('dib', 5) * 390;
      const dy0 = 200;
      if (doodle === 'corona') {
        c.beginPath();
        c.moveTo(dx0 - 26, dy0 + 14);
        c.lineTo(dx0 - 26, dy0 - 12);
        c.lineTo(dx0 - 13, dy0 + 2);
        c.lineTo(dx0, dy0 - 18);
        c.lineTo(dx0 + 13, dy0 + 2);
        c.lineTo(dx0 + 26, dy0 - 12);
        c.lineTo(dx0 + 26, dy0 + 14);
        c.closePath();
        c.fill();
        c.stroke();
      } else if (doodle === 'estrella') {
        c.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? 24 : 11;
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const px = dx0 + Math.cos(a) * r;
          const py = dy0 + Math.sin(a) * r;
          if (i === 0) c.moveTo(px, py);
          else c.lineTo(px, py);
        }
        c.closePath();
        c.fill();
        c.stroke();
      } else if (doodle === 'gato') {
        c.beginPath();
        c.arc(dx0, dy0, 20, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.beginPath();
        c.moveTo(dx0 - 16, dy0 - 14); c.lineTo(dx0 - 22, dy0 - 30); c.lineTo(dx0 - 6, dy0 - 20);
        c.moveTo(dx0 + 16, dy0 - 14); c.lineTo(dx0 + 22, dy0 - 30); c.lineTo(dx0 + 6, dy0 - 20);
        c.stroke();
        c.fillStyle = '#1c1c1c';
        c.beginPath(); c.arc(dx0 - 7, dy0 - 2, 2.6, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(dx0 + 7, dy0 - 2, 2.6, 0, Math.PI * 2); c.fill();
      } else if (doodle === 'flecha') {
        c.beginPath();
        c.moveTo(dx0 - 26, dy0);
        c.lineTo(dx0 + 14, dy0);
        c.moveTo(dx0 + 4, dy0 - 12);
        c.lineTo(dx0 + 20, dy0);
        c.lineTo(dx0 + 4, dy0 + 12);
        c.stroke();
      } else if (doodle === 'rayo') {
        c.beginPath();
        c.moveTo(dx0 + 4, dy0 - 26);
        c.lineTo(dx0 - 10, dy0 + 2);
        c.lineTo(dx0 + 2, dy0 + 2);
        c.lineTo(dx0 - 6, dy0 + 26);
        c.lineTo(dx0 + 14, dy0 - 6);
        c.lineTo(dx0 + 2, dy0 - 6);
        c.closePath();
        c.fill();
        c.stroke();
      } else {
        // carita sonriente con dientes torcidos
        c.beginPath();
        c.arc(dx0, dy0, 20, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = '#1c1c1c';
        c.beginPath(); c.arc(dx0 - 7, dy0 - 5, 2.6, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(dx0 + 7, dy0 - 5, 2.6, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#1c1c1c';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(dx0, dy0 + 2, 10, 0.15 * Math.PI, 0.85 * Math.PI);
        c.stroke();
        c.beginPath();
        c.moveTo(dx0 - 6, dy0 + 8); c.lineTo(dx0 - 2, dy0 + 12); c.moveTo(dx0, dy0 + 9); c.lineTo(dx0 + 4, dy0 + 13);
        c.stroke();
      }
      const out = decalTex('decal_grafiti_tex', got.c);
      graffitiCache.set(key, out);
      return out;
    };
    const humTex = decayCfg?.humidity ? humidityTex() : null;
    const grTex = decayCfg?.cracks ? crackTex() : null;
    const soTex = decayCfg?.soot ? sootTex() : null;
    const muTex = decayCfg?.grime ? grimeTex() : null;
    // ── GRAFITIS en los MUROS: uno por planta de cubo de escalera (muro del fondo del
    //  cubo, visible a través del ventanal) + uno en el vestíbulo del portal.
    if (graffitiCfg) {
      const wallSpots: { blockId: string; x: number; y: number; z: number; w: number; h: number }[] = [];
      for (const b of Object.values(world.blocks)) {
        const f = content.blocks[b.defId]!.features;
        if (!f || f.stairs !== true) continue;
        const dep = depthOf(b);
        const y0 = b.cell.floor * v.cellH;
        const spanCells = v.stairs.spanW ?? b.size.w;
        const sw = spanCells * v.cellW - v.gapW;
        const left = b.cell.col * v.cellW + v.gapW / 2;
        wallSpots.push({
          blockId: b.id,
          x: left + sw * (0.3 + hash01(b.id, 61) * 0.4),
          y: y0 + 1.35 + (hash01(b.id, 62) - 0.5) * 0.3,
          z: frontZ + dep - v.stairs.facade.wallT - 0.012,
          w: 1.5,
          h: 0.75,
        });
      }
      const portalBlk = Object.values(world.blocks).find((b) => b.defId === 'portal');
      if (portalBlk) {
        const dep = depthOf(portalBlk);
        wallSpots.push({
          blockId: portalBlk.id,
          x: portalBlk.cell.col * v.cellW + portalBlk.size.w * v.cellW * 0.62,
          y: portalBlk.cell.floor * v.cellH + 1.5,
          z: frontZ + dep - v.wall - 0.012,
          w: 1.8,
          h: 0.9,
        });
      }
      wallSpots.forEach((sp, i) => {
        const text = graffitiCfg.texts[i % graffitiCfg.texts.length]!;
        const color = graffitiCfg.colors[i % graffitiCfg.colors.length]!;
        const doodle = graffitiCfg.doodles[i % graffitiCfg.doodles.length]!;
        const dmesh = attach(sp.blockId, MeshBuilder.CreatePlane(`decal_grafiti_${i}`, { width: sp.w, height: sp.h }, scene));
        dmesh.position.set(sp.x, sp.y, sp.z);
        dmesh.material = decalMat(`decal_grafiti_${i}_mat`, graffitiTex(text, color, doodle, graffitiCfg), 0);
        dmesh.isPickable = false;
        dmesh.setEnabled(false);
        graffitiWalls.push((alpha) => {
          (dmesh.material as StandardMaterial).alpha = graffitiCfg.alpha * alpha;
          dmesh.setEnabled(alpha > 0.01);
        });
      });
    }
    // ── DECAY por VIVIENDA: manchas en la pared del fondo del interior (corte abierto).
    if (decayCfg) {
      for (const b of Object.values(world.blocks)) {
        if (b.kind !== 'dwelling') continue;
        const dep = depthOf(b);
        const backZ = frontZ + dep - v.wall - 0.012;
        const y0 = b.cell.floor * v.cellH + v.slab * 2;
        const kinds: { key: string; tex: Texture | null; from: number; to: number; invert?: boolean; w: number; h: number }[] = [];
        if (decayCfg.humidity && humTex) kinds.push({ key: 'humedad', tex: humTex, from: decayCfg.humidity.min, to: decayCfg.humidity.max, w: decayCfg.humidity.w, h: decayCfg.humidity.h });
        if (decayCfg.soot && soTex) kinds.push({ key: 'hollin', tex: soTex, from: decayCfg.soot.min, to: decayCfg.soot.max, w: decayCfg.soot.w, h: decayCfg.soot.h });
        if (decayCfg.cracks && grTex) kinds.push({ key: 'grietas', tex: grTex, from: 0, to: decayCfg.cracks.conditionMax, invert: true, w: decayCfg.cracks.w, h: decayCfg.cracks.h });
        for (const k of kinds) {
          if (!k.tex) continue;
          const sx = 0.5 + (hash01(b.id, 71 + k.key.length) - 0.5) * Math.max(0.1, b.size.w * v.cellW - k.w - 0.5);
          const sy = y0 + 1.05 + (hash01(b.id, 81 + k.key.length) - 0.5) * 0.5;
          const dm = attach(b.id, MeshBuilder.CreatePlane(`decal_${k.key}_${b.id}`, { width: k.w, height: k.h }, scene));
          dm.position.set(b.cell.col * v.cellW + sx, sy, backZ);
          dm.material = decalMat(`decal_${k.key}_${b.id}_mat`, k.tex, 0);
          dm.isPickable = false;
          dm.setEnabled(false);
          decayDecals.push({
            mesh: dm,
            blockId: b.id,
            param: k.invert ? 'condition' : k.key === 'hollin' ? 'soot' : 'humidity',
            from: k.from,
            to: k.to,
            invert: k.invert === true,
          });
        }
      }
      // Mugre del PASILLO en el suelo (limpieza baja).
      if (muTex && decayCfg.grime) {
        for (const b of Object.values(world.blocks)) {
          if (b.layer !== 'corridor') continue;
          const d = v.corridorDepth;
          for (let i = 0; i < 3; i++) {
            const sx = b.cell.col * v.cellW + 1.2 + hash01(b.id, 91 + i) * Math.max(0.1, b.size.w * v.cellW - 2.4);
            const sz = frontZ - 0.5 - hash01(b.id, 95 + i) * (d - 1);
            const dm = attach(b.id, MeshBuilder.CreateGround(`decal_mugre_${b.id}_${i}`, { width: decayCfg.grime.w, height: decayCfg.grime.h }, scene));
            dm.position.set(sx, b.cell.floor * v.cellH + v.slab * 2 + 0.011, sz);
            dm.material = decalMat(`decal_mugre_${b.id}_${i}_mat`, muTex, 0);
            dm.isPickable = false;
            dm.setEnabled(false);
            decayDecals.push({ mesh: dm, blockId: b.id, param: 'cleanliness', from: 0, to: decayCfg.grime.cleanlinessMax, invert: true });
          }
        }
      }
    }
  }

  // ── Forjado interior CONTINUO del cubo de escalera (v1.18): a nivel de entrada de cada
  //  planta, una losa que cubre la huella completa del cubo (spanW celdas). La authoría glTF
  //  solo trae el forjado de la puerta; sin esta losa se camina (y se ve el vacío) entre la
  //  puerta y los tramos. Malla propia que SOBREVIVE a la carga del modelo (no está en el
  //  greybox, que se oculta) — 5 mm por debajo del forjado del arte: cero z-fighting.
  const stCfg = v.stairs.floorSlab;
  /** v1.25: materiales estructurales de los cubos de escalera (autoiluminación nocturna). */
  const stairWallMats: { mat: BlockMat }[] = [];
  /** Color compartido del glow de muros (cero allocations por frame). */
  const stairWallGlow = new Color3(0, 0, 0);
  if (stCfg.enabled) {
    const stMat = mat('escalera_forjado_mat');
    stMat.diffuseColor = Color3.FromHexString(stCfg.color);
    stairWallMats.push({ mat: stMat as unknown as BlockMat });
    for (const b of Object.values(world.blocks)) {
      const f = content.blocks[b.defId]!.features;
      if (!f || f.stairs !== true) continue;
      const spanW = v.stairs.spanW;
      const sw = spanW * v.cellW - v.gapW;
      const sx = b.cell.col * v.cellW + sw / 2;
      attach(b.id, box(`${b.id}_forjado_interior`, sw, stCfg.thickness, v.commonDepth, sx, b.cell.floor * v.cellH + stCfg.topAt - stCfg.thickness / 2 - 0.005, frontZ + v.commonDepth / 2, stMat));
    }
  }

  // ── ACCESO A LA ESCALERA (v1.24): hasta ahora la puerta flotaba sin pared. Ahora:
  //  · MURO FRONTAL alrededor de la puerta (dos tramos + dintel, color del catálogo) que
  //    enmarca el hueco real por donde cruzan los vecinos (la celda lógica del pozo).
  //  · HOJA con arte de zonas comunes y el GRAN NÚMERO de planta centrado (negro), pintado
  //    EN la textura de la hoja: al abrirse/cerrarse, el número bascula con ella.
  //  · Bisagras a la IZQUIERDA vista desde el pasillo (x mayor; la cámara mira +z).
  //  · Apertura automática: el update abre la hoja antes de que crucen (mover cerca).
  //  · ILUMINACIÓN COMPARTIDA de todos los cubos: de noche se enciende si algún vecino
  //    se mueve por las escaleras (materiales de los sellos de luz del arte glTF).
  const stF = v.stairs.facade;
  const stairDoors: { hinge: TransformNode; openT: number; doorX: number; doorZ: number; floorY: number }[] = [];
  const stairFootprints: { x0: number; x1: number; floorY: number }[] = [];
  const stairLightMats: { mat: { emissiveColor: Color3 } }[] = [];
  let stairLightLevel = 0;
  if (stF.enabled) {
    const wallMat = mat('escalera_fachada_mat');
    wallMat.diffuseColor = Color3.FromHexString(stF.color);
    wallMat.specularColor = new Color3(0.02, 0.02, 0.02);
    stairWallMats.push({ mat: wallMat as unknown as BlockMat }); // v1.27: el muro también se autoilumina
    /** Textura de la hoja por PLANTA: arte de zonas comunes + gran número centrado.
     *  v1.27: ENCAJE PERFECTO — doorLeafCanvas recorta el arte a la caja de la hoja y lo
     *  re-encaja a la proporción EXACTA del plano (doorW/doorH del catálogo) sin estirarlo:
     *  el arte llena el plano de lado a lado con sus proporciones intactas. */
    const stairDoorTexCache = new Map<number, DynamicTexture>();
    const stairDoorTex = (art: string, numberColor: string, floor: number): DynamicTexture => {
      const hit = stairDoorTexCache.get(floor);
      if (hit) return hit;
      // v1.28 — ENCAJE PERFECTO DE VERDAD: el canvas respeta la proporción RETRATO del plano
      // (doorW 0.86 × doorH 1.84). v1.27 lo tenía AL REVÉS (384×apaisado): el cover-fit
      // recortaba el arte a panorama y el vuelco al plano vertical lo APLASTABA — la hoja
      // se veía estirada y mal colocada. Mismo patrón que doorArtTex (H fijo 768, W proporcional).
      const TH = 768;
      const TW = Math.max(32, Math.round((TH * stF.doorW) / stF.doorH));
      const dt = new (B().DynamicTexture)(`puerta_esc_${floor}_tex`, { width: TW, height: TH }, scene, true);
      stairDoorTexCache.set(floor, dt);
      const img = new Image();
      img.onload = () => {
        const c = doorLeafCanvas(img, TW, TH, {
          draw: (cctx) => {
            // Gran número de planta, centrado en la hoja (vinculado a la puerta: bascula con ella).
            cctx.font = `bold ${Math.round(TH * 0.3)}px Arial, sans-serif`;
            cctx.textAlign = 'center';
            cctx.textBaseline = 'middle';
            cctx.fillStyle = numberColor;
            cctx.fillText(String(floor), TW / 2, TH / 2);
          },
        });
        const dctx = dt.getContext() as unknown as CanvasRenderingContext2D;
        dctx.clearRect(0, 0, TW, TH);
        dctx.drawImage(c, 0, 0);
        dt.update(true);
      };
      img.src = art;
      return dt;
    };
    for (const b of Object.values(world.blocks)) {
      const f = content.blocks[b.defId]!.features;
      if (!f || f.stairs !== true) continue;
      const spanW = v.stairs.spanW;
      const sw = spanW * v.cellW - v.gapW;
      const left = b.cell.col * v.cellW + v.gapW / 2;
      const right = left + sw;
      const doorX = (b.cell.col + b.size.w / 2) * v.cellW; // entrada real (el pozo del sim)
      const y0 = b.cell.floor * v.cellH;
      const zF = frontZ + stF.doorZ;
      // v1.26 — MURO GRUESO: los peldaños/barandillas del arte glTF asoman por delante del
      // plano de la pared (z del arte −1.38..−1.21 frente al muro fino −1.31..−1.21) y se
      // veían "a través de la pared" cuando la fachada vecina estaba abierta. Con wallT 0.3
      // el muro envuelve esas geometrías y la HOJA se monta DELANTE del canto (leafZ).
      // v1.27 — el muro cubre la CÉLULA COMPLETA (y0..y0+cellH): entre cubos apilados ya no
      // queda la ranura de gapH por la que se colaba el exterior; los cubos vecinos abutan
      // (caras opuestas, una culled) y la solera de la vivienda de arriba cierra el resto.
      const leafZ = zF - stF.wallT / 2 - 0.015;
      const hFull = v.cellH;
      const dL = doorX - stF.doorW / 2;
      const dR = doorX + stF.doorW / 2;
      const dTop = y0 + stF.doorBottom + stF.doorH;
      const wv = stF.window;
      const wallSeg = (x0: number, x1: number, yA: number, yB: number): void => {
        if (x1 - x0 < 0.02 || yB - yA < 0.02) return;
        attach(b.id, box(`${b.id}_fachada_${x0.toFixed(2)}_${yA.toFixed(2)}`, x1 - x0, yB - yA, stF.wallT, (x0 + x1) / 2, yA + (yB - yA) / 2, zF, wallMat));
      };
      // Muro trasero del cubo (v1.27, catálogo): con el ventanal abierto, sin fondo se veía
      // el horizontal a través del vidrio; el muro trasero devuelve la caja cerrada (la luz
      // nocturna del cubo rebota y se LEE desde la calle).
      if (wv?.rear) {
        const dep = depthOf(b);
        attach(b.id, box(`${b.id}_fondo_cubo`, right - left, hFull, stF.wallT, (left + right) / 2, y0 + hFull / 2, frontZ + dep - stF.wallT / 2, wallMat));
      }
      if (!wv?.enabled) {
        // Comportamiento v1.26 intacto si el ventanal viene apagado del catálogo.
        wallSeg(Math.max(left, stF.fullWall === false ? dL - stF.halfW : left), dL, y0, y0 + hFull);
        wallSeg(dR, Math.min(right, stF.fullWall === false ? dR + stF.halfW : right), y0, y0 + hFull);
        wallSeg(dL, dR, dTop, y0 + hFull);
      } else {
        // VENTANAL (v1.27): banda de vidrio sill..head partida alrededor de la columna de la
        // puerta; peanas de muro debajo y encima; umbral bajo la puerta y vidrio sobre ella.
        // El vidrio es un PLANO con alpha (cristal suave) a doble cara; los montantes van
        // DELANTE del plano del vidrio (nunca coplanares: la regla de la casa).
        const ySill = y0 + wv.sill;
        const yHead = Math.min(y0 + wv.head, y0 + hFull - 0.06);
        wallSeg(left, dL, y0, ySill);
        wallSeg(dR, right, y0, ySill);
        wallSeg(dL, dR, y0, y0 + stF.doorBottom); // umbral bajo la hoja
        wallSeg(left, right, yHead, y0 + hFull);
        const glassMat = mat(`${b.id}_ventanal_mat`);
        glassMat.diffuseColor = Color3.FromHexString(wv.color);
        glassMat.alpha = wv.alpha;
        glassMat.specularColor = new Color3(0.32, 0.32, 0.32);
        glassMat.backFaceCulling = false; // cristal visto desde dentro y desde fuera
        stairWallMats.push({ mat: glassMat as unknown as BlockMat }); // el vidrio brilla con la luz del cubo
        const glassPane = (x0: number, x1: number, yA: number, yB: number): void => {
          if (x1 - x0 < 0.02 || yB - yA < 0.02) return;
          const pane = attach(b.id, MeshBuilder.CreatePlane(`${b.id}_vidrio_${x0.toFixed(2)}_${yA.toFixed(2)}`, { width: x1 - x0, height: yB - yA, sideOrientation: B().Mesh.DOUBLESIDE }, scene));
          pane.position.set((x0 + x1) / 2, yA + (yB - yA) / 2, zF);
          pane.material = glassMat;
          pane.isPickable = false;
        };
        glassPane(left, dL, ySill, yHead);
        glassPane(dR, right, ySill, yHead);
        glassPane(dL, dR, dTop, yHead); // sobre la hoja, hasta el cabezal
        // Montantes verticales finos repartidos por la banda (marcos de ventana reales):
        // profundidad 0.06 centrada en zF → sobresalen 15 mm del plano del vidrio.
        if (wv.mullions > 0) {
          const mullMat = mat(`${b.id}_ventanal_marcos_mat`);
          mullMat.diffuseColor = Color3.FromHexString(wv.frameColor);
          mullMat.specularColor = new Color3(0.05, 0.05, 0.05);
          for (let i = 1; i <= wv.mullions; i++) {
            const mx = left + ((right - left) * i) / (wv.mullions + 1);
            if (mx > dL - wv.mullionW && mx < dR + wv.mullionW) continue; // la columna de puerta lleva su hoja
            attach(b.id, box(`${b.id}_montante_${i}`, wv.mullionW, yHead - ySill, 0.06, mx, (ySill + yHead) / 2, zF, mullMat));
          }
        }
      }
      // Hoja: bisagras en el lado izquierdo VISTO desde el pasillo (= x mayor mirando +z).
      const hingeAtRightX = stF.hinge === 'left';
      const hinge = new TransformNode(`${b.id}_puerta_hinge`, scene);
      hinge.position.set(hingeAtRightX ? dR : dL, y0 + stF.doorBottom, leafZ);
      hinge.parent = roots.get(b.id) ?? null;
      const leaf = MeshBuilder.CreatePlane(`${b.id}_puerta_hoja`, { width: stF.doorW, height: stF.doorH }, scene);
      const leafMat = new StandardMaterial(`${b.id}_puerta_hoja_mat`, scene);
      leafMat.diffuseTexture = stairDoorTex(stF.art, stF.numberColor, b.cell.floor);
      leafMat.emissiveColor = new Color3(0.16, 0.16, 0.16); // legible en fachada norte
      leafMat.specularColor = new Color3(0, 0, 0);
      leaf.material = leafMat;
      leaf.isPickable = true; // v1.29: la hoja cerrada del cubo oculta bocadillos (rayo de oclusión)
      leaf.position.set(((hingeAtRightX ? -1 : 1) * stF.doorW) / 2, stF.doorH / 2, 0);
      leaf.parent = hinge;
      stairDoors.push({ hinge, openT: 0, doorX, doorZ: zF, floorY: y0 });
      stairFootprints.push({ x0: left, x1: right, floorY: y0 });
    }
  }

  // ── Arte final (opcional): modelo glTF por TIPO de bloque (manifiesto assets.blocks). ──
  // Cada instancia se clona del contenedor cacheado y escala a la celda real; si carga, la
  // caja greybox estructural se oculta (el panel/candado de viviendas sigue siendo greybox).
  const blockAssets = content.assets?.blocks;
  if (blockAssets && content.assets) {
    for (const b of Object.values(world.blocks)) {
      const entry = blockAssets[b.defId];
      if (!entry) continue;
      void instantiateBlockAsset(scene, entry, content.assets.base).then((model) => {
        // La escena pudo morir mientras cargaba (restart/Cargar partida): no tocar vistas viejas.
        if (model && scene.isDisposed) {
          model.root.dispose(false, false);
          return;
        }
        if (!model) return; // fallback greybox permanente
        const view = views.get(b.id);
        if (!view || view.model) {
          model.root.dispose(false, false); // bloque ya servido: no dejar instancias sueltas
          return;
        }
        // Dimensiones reales de la celda: el pasillo (tira saliente) tiene geometría propia,
        // espejo exacto de su greybox (ancho completo, canto slab*2, calado corridorDepth).
        // Con spanW (v1.4, cubo de escalera) el modelo escala a spanW celdas y se ancla al
        // borde IZQUIERDO de la celda lógica: sobresale por la derecha como torre real.
        const isCorridor = b.layer === 'corridor';
        const spanCells = entry.spanW ?? b.size.w;
        const w = isCorridor ? b.size.w * v.cellW : spanCells * v.cellW - v.gapW;
        const h = isCorridor ? v.slab * 2 : v.cellH - v.gapH;
        const d = isCorridor ? v.corridorDepth : depthOf(b);
        const cz = isCorridor ? frontZ - d / 2 : frontZ + d / 2;
        const y = isCorridor ? b.cell.floor * v.cellH + v.slab : b.cell.floor * v.cellH;
        // El modelo se authora a dimensiones nominales con la base en y=0 y centrado en x/z.
        model.root.scaling.set(w / entry.nominal.w, h / entry.nominal.h, d / entry.nominal.d);
        model.root.position.set(b.cell.col * v.cellW + w / 2, y, cz);
        model.root.parent = roots.get(b.id) ?? null; // v1.19: el arte también se desvanece con el bloque
        view.model = model.root;
        // v1.24: retirar la decoración de puerta antigua del overlay (marco gris que tapaba
        // la placa y no contorneaba la hoja) — lista hideNodes del catálogo. Los clones del
        // loader llevan prefijo "Clone of ": se compara por sufijo.
        // v1.25: los cubos de escalera ocultan TAMBIÉN sus nodos sobrantes (el hueco oscuro
        // viejo flotaba a la derecha de los tramos — stairs.facade.hideNodes).
        // v1.26 — BÚSQUEDA RECURSIVA: el loader cuelga los nodos nombrados bajo
        // "__root__ → Root", y el bucle de hijos directos jamás los veía (los hideNodes
        // eran un no-op silencioso: jambas, la repisa sobre la puerta y el hueco oscuro
        // flotante seguían en escena — la raíz de las quejas del vecino).
        const hideList = [
          ...(v.privacy.hideNodes ?? []),
          ...(content.blocks[b.defId]!.features?.stairs === true ? (v.stairs.facade.hideNodes ?? []) : []),
          // v1.29 — NÚCLEO: el panel oscuro del hueco (hueco_puerta) tapaba la cabina al
          // abrirse las puertas (el interior era un agujero negro); el catálogo lo retira
          // (rules.view.elevator.hideNodes) y detrás queda la cabina con su luz.
          ...(content.blocks[b.defId]!.features?.elevator === true ? (v.elevator.hideNodes ?? []) : []),
          // v1.30 — LOCALES: el cuerpo cerrado y las máquinas/persianas pegadas a la fachada
          // sobran (la fachada y el interior los levanta el runtime); el catálogo decide.
          ...(loc.hideNodes[b.defId] ?? []),
        ];
        const hideTree = (node: { name: string }, suffix: string): void => {
          if (node.name === suffix || node.name.endsWith(suffix)) {
            (node as unknown as { setEnabled(v: boolean): void }).setEnabled(false);
            return; // con el padre oculto, su subárbol desaparece entero
          }
          const kids = (node as unknown as { getChildren?: () => unknown[] }).getChildren?.() ?? [];
          for (const k of kids) hideTree(k as never, suffix);
        };
        for (const nodeName of hideList) {
          for (const child of model.root.getChildren()) {
            hideTree(child as never, nodeName);
          }
        }
        // v1.25: materiales del PROPIO cubo de escalera — la autoiluminación nocturna
        // (activityLight.wallGlow) ilumina los muros/tramos, no solo la bombilla.
        if (content.blocks[b.defId]!.features?.stairs === true) {
          stairWallMats.push(...model.mats.map((m) => ({ mat: m })));
        }
        // v1.24: materiales de la ILUMINACIÓN COMPARTIDA de los cubos de escalera.
        if (content.blocks[b.defId]!.features?.stairs === true && v.stairs.activityLight.enabled) {
          for (const mesh of model.root.getChildMeshes()) {
            if (v.stairs.activityLight.meshes.some((n) => mesh.name === n || mesh.name.endsWith(n)) && mesh.material) {
              stairLightMats.push({ mat: (mesh.material as unknown as { emissiveColor: Color3 }) });
            }
          }
        }
        // ── v1.30 — LOCALES: hojas correderas del portal, puerta del garaje y rótulos. ──
        const meshBySuffix = (suffix: string): Mesh | null =>
          (model.root.getChildMeshes().find((m) => m.name === suffix || m.name.endsWith(suffix)) as Mesh | undefined) ?? null;
        if (b.defId === 'portal') {
          const pd = loc.portalDoors;
          const cxM = b.cell.col * v.cellW + w / 2; // centro X del bloque en el callback
          const gmat = mat(`${b.id}_cristal_mat`);
          gmat.diffuseTexture = glassDoorTex();
          gmat.specularColor = new Color3(0.25, 0.25, 0.25);
          gmat.alpha = pd.alpha; // cristal translúcido: se lee el portal detrás al abrirse
          for (const suffix of ['cristal_izq', 'cristal_der']) {
            const leaf = meshBySuffix(suffix);
            if (!leaf) continue;
            leaf.material = gmat;
            leaf.isPickable = false;
            const baseX = leaf.position.x;
            portalLeaves.push({ mesh: leaf, baseX, dir: baseX >= 0 ? 1 : -1 });
          }
          portalDoorX = cxM;
          portalDoorZ = frontZ - 0.15; // el plano de las hojas, un pelín hacia la calle
        }
        if (b.defId === 'garaje') {
          const g = loc.garaje;
          const doorMesh = meshBySuffix('puerta_basculante');
          if (doorMesh) {
            const dmat = mat(`${b.id}_puerta_basculante_mat`);
            dmat.diffuseTexture = garageDoorTex();
            dmat.specularColor = new Color3(0.08, 0.08, 0.08);
            doorMesh.material = dmat;
            // v1.34 — la basculante SE LEVANTA al acercarse (bisagra en el canto superior,
            // la hoja y sus nervios cuelgan de ella): entra con el resto de las puertas.
            const liftHinge = new TransformNode(`${b.id}_basculante_hinge`, scene);
            // Canto superior de la hoja, en el MISMO espacio local del arte (el loader niega
            // la Z: se toma la posición viva del nodo, no la nominal del glTF).
            liftHinge.position.set(doorMesh.position.x, doorMesh.position.y + 1.86 / 2, doorMesh.position.z);
            liftHinge.parent = model.root;
            const under = (mesh: Mesh): void => {
              const p = mesh.position.clone();
              mesh.parent = liftHinge;
              mesh.position.set(p.x - liftHinge.position.x, p.y - liftHinge.position.y, p.z - liftHinge.position.z);
            };
            under(doorMesh);
            for (const nv of ['nervio_1', 'nervio_2', 'nervio_3']) {
              const nm = meshBySuffix(nv);
              if (nm) under(nm);
            }
            hallDoors.push({ hinge: liftHinge, openT: 0, doorX: b.cell.col * v.cellW + w / 2, doorZ: frontZ - 0.12, floorY: b.cell.floor * v.cellH, side: 1, lift: true });
          }
          const rotulo = meshBySuffix('rotulo');
          if (rotulo) {
            const rmat = mat(`${b.id}_rotulo_mat`);
            rmat.diffuseTexture = signTex(`${b.id}_rotulo`, g.sign, g.signBg, g.signText);
            rmat.emissiveColor = Color3.FromHexString(g.signBg).scale(0.55);
            rotulo.material = rmat;
          }
        }
        if (b.defId === 'trasteros' || b.defId === 'local_comercial' || b.defId === 'lavanderia_comunal') {
          const sign = b.defId === 'trasteros'
            ? { t: loc.trasteroComunal.sign, bg: loc.trasteroComunal.signBg, fg: loc.trasteroComunal.signText }
            : b.defId === 'local_comercial'
              ? { t: loc.juntaHall.sign, bg: loc.juntaHall.signBg, fg: loc.juntaHall.signText }
              : { t: loc.lavanderia.sign, bg: loc.lavanderia.signBg, fg: loc.lavanderia.signText };
          const rotulo = meshBySuffix('rotulo');
          if (rotulo) {
            const rmat = mat(`${b.id}_rotulo_mat`);
            rmat.diffuseTexture = signTex(`${b.id}_rotulo`, sign.t, sign.bg, sign.fg);
            rmat.emissiveColor = Color3.FromHexString(sign.bg).scale(0.55);
            rotulo.material = rmat;
          }
        }
        if (entry.overlay) {
          // Overlay (marco de puerta sobre el corte interior): DECORA — el greybox estructural
          // sigue visible con sus materiales (tinte de estado y glow intactos), y el edge de
          // vivienda del jugador (edgesMesh) no se toca. El overlay no entra en tintado/glow.
        } else {
          view.mats = model.mats;
          view.baseEmissive = model.mats.map((mm) => new Color3(mm.emissiveColor.r, mm.emissiveColor.g, mm.emissiveColor.b));
          view.baseColor = model.baseColor.map((c) => new Color3(c.r, c.g, c.b));
          view.tintStrength = entry.tintStrength ?? 0.6;
          view.edgesMesh = null; // el modelo no lleva EdgesRenderer (no hay pared destacada greybox)
          view.edgesMesh2 = null;
          for (const mesh of view.greybox) mesh.setEnabled(false);
        }
      });
    }
  }

  // ── Multi-vivienda destacada: borde blanco en la pared del fondo de TODAS las viviendas del jugador ──
  // (la actual del jugador además recibe el doble de grosor; el criterio es el ownerId, no el catálogo).
  // v1.19: la pared del fondo puede estar PARTIDA (puerta a sala trasera) — edges en ambos tramos.
  const homeId = world.residents[world.playerId]!.home;
  for (const b of Object.values(world.blocks)) {
    if (b.kind !== 'dwelling' || b.ownerId !== world.playerId) continue;
    const view = views.get(b.id)!;
    for (const wall of [view.edgesMesh, view.edgesMesh2]) {
      if (!wall) continue;
      wall.enableEdgesRendering();
      wall.edgesWidth = b.id === homeId ? 14 : 8;
      wall.edgesColor = Color4.FromHexString(v.homeEdge + 'ff');
    }
  }

  // ── Trasteros por planta (v1.16): nave abierta con estanterías a AMBOS LADOS del pasillo
  // interior. Cada estantería lleva cartel dinámico con la vivienda propietaria (blockLabel,
  // patrón del plaque) y trastos deterministas (hash01 del id de la vivienda — jamás
  // nextRandom del sim). El reparto es SECUENCIAL: estantería k del nivel i → vivienda
  // k + i·shelvesPerLevel del listado de viviendas ordenado por (planta, columna); así
  // "todos los vecinos tienen su trastero" y sobran ranuras donde las haya. TODO sale de
  // rules.view.trasteros (nada a pelo): añadir viviendas o cambiar shelvesPerLevel re-crea
  // el mapa solo. La estantería del JUGADOR luce colores propios (ownBg/ownText).
  // (v1.30: `tr` se declara ARRIBA, junto a `loc` — los locales nuevos lo usan antes.)
  const dwellingsOrdered = Object.values(world.blocks)
    .filter((b) => b.kind === 'dwelling')
    .sort((a, b) => a.cell.floor - b.cell.floor || a.cell.col - b.cell.col);
  const storageLevels = Object.values(world.blocks)
    .filter((b) => b.defId === 'trasteros_planta')
    .sort((a, b) => a.cell.floor - b.cell.floor);
  if (storageLevels.length > 0 && dwellingsOrdered.length > 0) {
    const matPost = mat('trasteros_poste_mat');
    matPost.diffuseColor = Color3.FromHexString(tr.woodDark);
    const matPlank = mat('trasteros_tabla_mat');
    matPlank.diffuseColor = Color3.FromHexString(tr.wood);
    const matPart = mat('trasteros_tabique_mat');
    matPart.diffuseColor = Color3.FromHexString(tr.partitionColor);
    const matJunk = tr.junk.map((hex, i) => {
      const jm = mat(`trasteros_trasto_${i}_mat`);
      jm.diffuseColor = Color3.FromHexString(hex);
      return jm;
    });
    /** Cartel numerado (DynamicTexture, MISMO patrón verificado del plaque de vivienda:
     *  update(true) — con false el texto sale cabeza abajo). */
    const shelfPlate = (name: string, label: string, own: boolean): Mesh => {
      const plate = MeshBuilder.CreatePlane(name, { width: tr.plaqueW, height: tr.plaqueH, sideOrientation: B().Mesh.DOUBLESIDE }, scene);
      const tex = new (B().DynamicTexture)(`${name}_tex`, { width: 160, height: 56 }, scene, true);
      const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
      ctx.fillStyle = own ? tr.ownBg : v.plaque.bg;
      ctx.fillRect(0, 0, 160, 56);
      ctx.font = 'bold 34px Arial, sans-serif';
      ctx.fillStyle = own ? tr.ownText : v.plaque.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 80, 30);
      tex.update(true);
      const pm = new StandardMaterial(`${name}_mat`, scene);
      pm.diffuseTexture = tex;
      pm.emissiveColor = Color3.FromHexString(own ? tr.ownBg : v.plaque.bg).scale(0.55);
      pm.specularColor = new Color3(0, 0, 0);
      plate.material = pm;
      return plate;
    };
    storageLevels.forEach((lvl, li) => {
      const bottom = lvl.cell.floor * v.cellH;
      const baseY = bottom + v.slab * 2; // ras del forjado de la nave
      const x0 = lvl.cell.col * v.cellW;
      const wTot = lvl.size.w * v.cellW - v.gapW;
      const perSide = Math.max(1, Math.floor(tr.shelvesPerLevel / 2));
      const pitch = (wTot - tr.margin * 2) / perSide;
      // Dos filas por nivel ("a ambos lados" del pasillo interior): frontal baja y trasera
      // alta — los carteles de la trasera se ven por encima de la frontal. Numeración: la
      // mitad baja de la lista en la fila frontal y el resto en la de fondo.
      const rows = [
        { key: 'frente', front: true, tiers: tr.frontTiers, zC: frontZ + v.wall + tr.shelfD / 2 },
        { key: 'fondo', front: false, tiers: tr.backTiers, zC: frontZ + v.depth - v.wall - tr.shelfD / 2 },
      ] as const;
      for (let s = 0; s < tr.shelvesPerLevel; s++) {
        const row = s < perSide ? rows[0]! : rows[1]!;
        const sideIdx = s % perSide;
        const bx = x0 + tr.margin + pitch * (sideIdx + 0.5);
        const dwelling = dwellingsOrdered[li * tr.shelvesPerLevel + s] ?? null;
        const own = !!dwelling && dwelling.id === homeId;
        const label = dwelling ? blockLabel(dwelling.id) : tr.emptyLabel;
        const unitH = row.tiers * tr.tierH;
        for (const side of ['a', 'b'] as const) {
          const px = bx + (side === 'a' ? -1 : 1) * (tr.bayW / 2);
          box(`${lvl.id}_est_${s}_${row.key}_poste_${side}`, tr.postW, unitH, tr.shelfD, px, baseY + unitH / 2, row.zC, matPost);
          // Tabique divisorio (v1.17): panel lateral algo más alto que la unidad — cada
          // ranura se lee como trastero propio, no como baldas sueltas.
          const pH = unitH + tr.partitionExtra;
          box(`${lvl.id}_est_${s}_${row.key}_tabique_${side}`, tr.postW * 1.3, pH, tr.shelfD, px, baseY + pH / 2, row.zC, matPart);
        }
        for (let t = 1; t <= row.tiers; t++) {
          box(`${lvl.id}_est_${s}_${row.key}_balda_${t}`, tr.bayW, tr.plankT, tr.shelfD, bx, baseY + t * tr.tierH - tr.plankT / 2, row.zC, matPlank);
        }
        // Trastos deterministas de la vivienda (paquetes y cacharros viejos): nada en las
        // baldas de ranuras vacías.
        if (dwelling) {
          for (let t = 0; t < row.tiers; t++) {
            if (hash01(`${dwelling.id}:${row.key}:${t}`, 41) >= tr.junkChance) continue;
            const jw = 0.4 + hash01(dwelling.id, 61 + t) * 0.7;
            const jh = 0.2 + hash01(dwelling.id, 71 + t) * 0.2;
            const jm = matJunk[Math.floor(hash01(dwelling.id, 81 + t) * matJunk.length) % matJunk.length]!;
            const jy = baseY + t * tr.tierH + (t > 0 ? tr.plankT : 0) + jh / 2;
            const jx = bx + (hash01(dwelling.id, 91 + t) - 0.5) * Math.max(0, tr.bayW - jw - 0.2);
            box(`${lvl.id}_est_${s}_${row.key}_trasto_${t}`, jw, jh, tr.shelfD * 0.7, jx, jy, row.zC, jm);
          }
        }
        // Cartel: montado EN LA PROPIA ESTANTERÍA (v1.17) — travesaño de cabecera sobre la
        // fachada de la unidad y placa sobre él, mirando al pasillo (ambas filas).
        if (tr.headerH > 0) {
          box(`${lvl.id}_est_${s}_${row.key}_cabecera`, tr.bayW, tr.headerH, tr.shelfD, bx, baseY + unitH + tr.headerH / 2, row.zC, matPost);
        }
        const plate = shelfPlate(`${lvl.id}_est_${s}_placa`, label, own);
        const rowFrontZ = row.zC - tr.shelfD / 2;
        plate.position.set(
          bx,
          baseY + unitH + (tr.headerH > 0 ? tr.headerH / 2 : 0.16),
          rowFrontZ - 0.015,
        );
      }
      // Paquetería y cacharros sueltos por el suelo de la nave (entre estanterías).
      for (let j = 0; j < tr.floorJunk; j++) {
        const hx = hash01(lvl.id, 701 + j);
        const hz = hash01(lvl.id, 801 + j);
        const jw = 0.5 + hash01(lvl.id, 901 + j) * 0.8;
        const jh = 0.25 + hash01(lvl.id, 911 + j) * 0.25;
        const jm = matJunk[Math.floor(hash01(lvl.id, 921 + j) * matJunk.length) % matJunk.length]!;
        const fx = x0 + tr.margin + (hx * (wTot - tr.margin * 2 - jw));
        const fz = frontZ + v.depth * (0.3 + hz * 0.4);
        box(`${lvl.id}_suelo_trasto_${j}`, jw, jh, 0.55, fx, baseY + jh / 2, fz, jm);
      }
    });
  }

  // ── Bloques de trasteros por COLUMNA (v1.18) ── UNA sola planta de trasteros por letra:
  // pasillo central de circulación hacia el fondo, IMPARES a un lado y PARES al otro,
  // compartimentos CERRADOS (interiores jamás visibles — a saber qué esconden ahí los
  // vecinos: "quizá un cadáver", "quizá una pequeña fortuna") con puerta y cartel numerado
  // de su vivienda. La profundidad del bloque escala la de vivienda (blockDepthFactor ×3).
  // TODO sale de rules.view.trasteros + src/game/storage.ts (una sola verdad de geometría).
  const colBlocks = Object.values(world.blocks).filter((b) => b.defId === tr.blockDefId);
  /** Carteles guía EXTERIORES (v1.19): uno por bloque de trasteros; se rellenan por frame
   *  con los trasteros que tienes a cada lado según la profundidad del pasillo. */
  const guideSigns = new Map<string, { tex: import('@babylonjs/core').DynamicTexture; x0: number; plan: ReturnType<typeof storageUnitPlan>; ownTag: string; last: string }>();
  /** FACHADA de cada bloque de trasteros (v1.21): se DESVANECE mientras el jugador camina su
   *  pasillo central — la regla de cámara frontal ve entonces TODO el pasillo hasta el fondo
   *  (corte de casa de muñecas, el mismo lenguaje que las viviendas abiertas). */
  const storageFacades = new Map<string, Mesh[]>();
  /** Alpha actual del fundido de cada fachada (idempotente: solo escribe en transición). */
  const facadeAlphas = new Map<string, number>();
  if (colBlocks.length > 0) {
    const sg = storageGeomOf(v);
    const D = sg.depth;
    const usableD = D - 2 * sg.wallT;
    const matWallC = mat('trasteros_col_muro_mat');
    matWallC.diffuseColor = Color3.FromHexString(tr.partitionColor);
    const matDoorC = mat('trasteros_col_puerta_mat');
    matDoorC.diffuseColor = Color3.FromHexString(sg.doorColor);
    const matOwnDoorC = mat('trasteros_col_puerta_propia_mat');
    matOwnDoorC.diffuseColor = Color3.FromHexString(tr.ownDoorColor);
    const matCapC = mat('trasteros_col_tapa_mat');
    matCapC.diffuseColor = Color3.FromHexString(tr.woodDark);
    const matFacadeC = mat('trasteros_col_fachada_mat');
    matFacadeC.diffuseColor = Color3.Lerp(Color3.FromHexString(tr.wood), Color3.FromHexString(tr.partitionColor), 0.5);
    const homeTag = homeId.slice(homeId.lastIndexOf('_') + 1);
    /** Cartel del compartimento (mismo patrón DynamicTexture verificado: update(true)). */
    const colPlate = (name: string, label: string, own: boolean): Mesh => {
      const plate = MeshBuilder.CreatePlane(name, { width: tr.plaqueW, height: tr.plaqueH, sideOrientation: B().Mesh.DOUBLESIDE }, scene);
      const tex = new (B().DynamicTexture)(`${name}_tex`, { width: 160, height: 56 }, scene, true);
      const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
      ctx.fillStyle = own ? tr.ownBg : v.plaque.bg;
      ctx.fillRect(0, 0, 160, 56);
      ctx.font = 'bold 34px Arial, sans-serif';
      ctx.fillStyle = own ? tr.ownText : v.plaque.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 80, 30);
      tex.update(true);
      const pm = new StandardMaterial(`${name}_mat`, scene);
      pm.diffuseTexture = tex;
      pm.emissiveColor = Color3.FromHexString(own ? tr.ownBg : v.plaque.bg).scale(0.55);
      pm.specularColor = new Color3(0, 0, 0);
      plate.material = pm;
      return plate;
    };
    for (const blk of colBlocks) {
      const tag = blk.id.slice(blk.id.lastIndexOf('_') + 1);
      const colDwell = dwellingsOrdered.filter((d) => d.id.endsWith(`_${tag}`));
      const plan = storageUnitPlan(v, colDwell.map((d) => d.cell.floor));
      const x0 = blk.cell.col * v.cellW;
      const bottom = blk.cell.floor * v.cellH;
      const baseY = bottom + v.slab * 2; // ras del forjado de la nave
      const W = blk.size.w * v.cellW - v.gapW;
      const [corA, corB] = storageCorridorX(x0, sg);
      const own = (d: BlockInstance | null) => !!d && d.id === homeId;
      // Muros laterales exteriores (cierran los extremos de las dos filas de celdas).
      attach(blk.id, box(`${blk.id}_lado_a`, sg.wallT, sg.unitH, D, x0 + sg.wallT / 2, baseY + sg.unitH / 2, frontZ + D / 2, matWallC));
      attach(blk.id, box(`${blk.id}_lado_b`, sg.wallT, sg.unitH, D, x0 + W - sg.wallT / 2, baseY + sg.unitH / 2, frontZ + D / 2, matWallC));
      for (const side of ['left', 'right'] as const) {
        const units = plan.filter((u) => u.side === side).sort((a, z) => a.index - z.index);
        const count = units.length;
        if (count === 0) continue;
        const bandA = side === 'left' ? x0 + sg.wallT : corB;
        const bandB = side === 'left' ? corA : x0 + W - sg.wallT;
        const bandW = bandB - bandA;
        const unitD = usableD / count;
        // Tabiques entre unidades consecutivas (corren según X, se cruzan andando en Z... jamás:
        // son los laterales del trastero; el paso es SOLO por el pasillo central).
        for (let k = 1; k < count; k++) {
          const zEdge = frontZ + sg.wallT + k * unitD;
          attach(blk.id, box(`${blk.id}_${side}_tab_${k}`, bandW, sg.unitH, sg.wallT, (bandA + bandB) / 2, baseY + sg.unitH / 2, zEdge, matWallC));
        }
        for (const u of units) {
          const zC = storageUnitZ(frontZ, u.index, count, sg);
          const z0u = zC - unitD / 2;
          const z1u = zC + unitD / 2;
          const dwelling = colDwell.find((d) => d.cell.floor === u.floor) ?? null;
          const ownU = own(dwelling);
          const label = dwelling ? blockLabel(dwelling.id) : tr.emptyLabel;
          // Frente de la unidad (mira AL PASILLO): muro con hueco de puerta + dintel.
          const wallX = side === 'left' ? corA - sg.wallT / 2 : corB + sg.wallT / 2;
          const g0 = Math.max(z0u, zC - sg.doorW / 2);
          const g1 = Math.min(z1u, zC + sg.doorW / 2);
          if (g0 - z0u > 0.01) attach(blk.id, box(`${blk.id}_${side}_${u.floor}_frente_i`, sg.wallT, sg.unitH, g0 - z0u, wallX, baseY + sg.unitH / 2, (z0u + g0) / 2, matWallC));
          if (z1u - g1 > 0.01) attach(blk.id, box(`${blk.id}_${side}_${u.floor}_frente_d`, sg.wallT, sg.unitH, z1u - g1, wallX, baseY + sg.unitH / 2, (g1 + z1u) / 2, matWallC));
          if (sg.unitH - sg.doorH > 0.01) attach(blk.id, box(`${blk.id}_${side}_${u.floor}_dintel`, sg.wallT, sg.unitH - sg.doorH, g1 - g0, wallX, baseY + sg.doorH + (sg.unitH - sg.doorH) / 2, zC, matWallC));
          // Puerta CERRADA del compartimento, DENTRO del plano del muro (v1.19: rellena el
          // hueco — antes era una flagela flotante y el hueco quedaba abierto). La del
          // JUGADOR es dorada: "como con cualquier puerta, entras solo si es la tuya".
          attach(blk.id, box(`${blk.id}_${side}_${u.floor}_puerta`, sg.wallT * 0.6, sg.doorH, g1 - g0, wallX, baseY + sg.doorH / 2, zC, ownU ? matOwnDoorC : matDoorC));
          // Tapa superior: la celda se lee cerrada también desde arriba.
          attach(blk.id, box(`${blk.id}_${side}_${u.floor}_tapa`, bandW, tr.plankT, unitD, (bandA + bandB) / 2, baseY + sg.unitH - tr.plankT / 2, zC, matCapC));
          // Cartel numerado sobre la puerta, mirando al pasillo. v1.21 FIX: la rotación
          // estaba al revés y el pasillo veía la ESPALDA del cartel (números espejados).
          // La cara frontal de un plano sin rotar mira a −Z: para mirar a +X (pasillo desde
          // una celda IZQUIERDA) la rotación es −π/2, y +π/2 para mirar a −X (celdas derechas).
          const plate = attach(blk.id, colPlate(`${blk.id}_${side}_${u.floor}_placa`, label, ownU));
          plate.rotation.y = side === 'left' ? -Math.PI / 2 : Math.PI / 2;
          plate.position.set(side === 'left' ? corA + 0.03 : corB - 0.03, baseY + sg.doorH + tr.plaqueH, zC);
        }
      }
      // ── FACHADA del bloque (v1.19): desde fuera solo se ve el PASILLO — muro frontal con
      // un único hueco: el acceso al pasillo central. Con esto la nave deja de estar abierta
      // de par en par y el bloque se lee como un cuerpo cerrado con su puerta.
      const gapH = sg.doorH + 0.2;
      const facH = sg.unitH + 0.28;
      const facT = sg.wallT * 1.8;
      if (corA - x0 > 0.05) attach(blk.id, box(`${blk.id}_fachada_i`, corA - x0, facH, facT, (x0 + corA) / 2, baseY + facH / 2, frontZ + facT / 2, matFacadeC));
      if (x0 + W - corB > 0.05) attach(blk.id, box(`${blk.id}_fachada_d`, x0 + W - corB, facH, facT, (corB + x0 + W) / 2, baseY + facH / 2, frontZ + facT / 2, matFacadeC));
      if (facH - gapH > 0.05) attach(blk.id, box(`${blk.id}_fachada_dintel`, corB - corA, facH - gapH, facT, (corA + corB) / 2, baseY + gapH + (facH - gapH) / 2, frontZ + facT / 2, matFacadeC));
      const facadeParts = [
        scene.getMeshByName(`${blk.id}_fachada_i`),
        scene.getMeshByName(`${blk.id}_fachada_d`),
        scene.getMeshByName(`${blk.id}_fachada_dintel`),
      ].filter((m): m is Mesh => !!m);
      storageFacades.set(blk.id, facadeParts);
      // ── Cartel guía EXTERIOR: sobre el hueco de acceso, mirando a la calle. Por frame
      // muestra los trasteros que tienes a cada lado según la profundidad del pasillo.
      const gd = tr.guide;
      attach(blk.id, box(`${blk.id}_guia_marco`, gd.w + 0.1, gd.h + 0.1, 0.05, x0 + W / 2, baseY + sg.unitH + gd.aboveUnit + gd.h / 2, frontZ - 0.06, matCapC));
      const guidePlate = attach(blk.id, MeshBuilder.CreatePlane(`${blk.id}_guia`, { width: gd.w, height: gd.h, sideOrientation: B().Mesh.DOUBLESIDE }, scene));
      const guideTex = new (B().DynamicTexture)(`${blk.id}_guia_tex`, { width: 256, height: 60 }, scene, true);
      const gm = new StandardMaterial(`${blk.id}_guia_mat`, scene);
      gm.diffuseTexture = guideTex;
      gm.emissiveColor = Color3.FromHexString(gd.bg).scale(0.6);
      gm.specularColor = new Color3(0, 0, 0);
      guidePlate.material = gm;
      guidePlate.position.set(x0 + W / 2, baseY + sg.unitH + gd.aboveUnit + gd.h / 2, frontZ - 0.1);
      // El cartel guía NO se desvanece con la fachada: su información (qué trasteros te
      // flanquean según la profundidad) es para cuando el jugador está dentro.
      guideSigns.set(blk.id, { tex: guideTex, x0, plan, ownTag: homeTag, last: '' });
    }
  }

  // ── Macetas de pasillo (v1.16→v1.27): reparto aleatorio DETERMINISTA por hash del id del
  // pasillo (jamás nextRandom del sim): cantidad entre perFloorMin..perFloorMax, lado (fachada
  // o barandilla), tamaño y especie salen del catálogo (rules.view.pots). Nunca sobre la línea
  // de paseo (corridorZ): se pegan a fachada o barandilla para no invadir el tránsito.
  // v1.27 — ARTE IA DECLARADO (pots.art): recortes billboard DETALLADOS (el dibujo a canvas
  // era «cutre», petición expresa del vecino) cargados como Texture(dataURL/PNG directo con
  // alpha). El arte llega pre-recortado del generador (fondo transparente, maceta a sangre en
  // el borde inferior) — el quad se REESCALA cuando el aspect real llega (onTrim). La base del
  // quad se HUNDE 3 cm en la losa: la maceta TOCA el suelo del pasillo, jamás vuela.
  const pt = v.pots;
  /** Fallback dibujado a canvas (2 especies) si el catálogo no declara arte. */
  const plantCanvasFallback = (species: number): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 200;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.clearRect(0, 0, 160, 200);
      const leaf = species === 0 ? pt.plantColor : pt.plant2Color;
      const leafDark = Color3.FromHexString(leaf).scale(0.78).toHexString();
      ctx.fillStyle = pt.potColor;
      ctx.strokeStyle = 'rgba(60,35,10,0.85)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(46, 150);
      ctx.lineTo(114, 150);
      ctx.lineTo(104, 196);
      ctx.lineTo(56, 196);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = Color3.FromHexString(pt.potColor).scale(1.18).toHexString();
      ctx.fillRect(40, 140, 80, 14);
      ctx.strokeRect(40, 140, 80, 14);
      ctx.fillStyle = pt.soilColor;
      ctx.beginPath();
      ctx.ellipse(80, 148, 34, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      const strokes: [number, number, number, number, number][] =
        species === 0
          ? [
              [80, 140, 0, -84, 13],
              [80, 142, -0.5, -70, 12],
              [80, 142, 0.5, -70, 12],
              [80, 140, -1.0, -52, 11],
              [80, 140, 1.0, -52, 11],
              [80, 142, -0.25, -92, 11],
            ]
          : [
              [80, 118, 0, -34, 26],
              [62, 124, -0.7, -26, 20],
              [98, 124, 0.7, -26, 20],
              [80, 104, -0.35, -30, 18],
              [80, 104, 0.35, -30, 18],
            ];
      for (const [si, [sx, sy, rot, len, w]] of strokes.entries()) {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(rot);
        ctx.fillStyle = si % 2 === 0 ? leaf : leafDark;
        ctx.beginPath();
        ctx.ellipse(0, len / 2, w / 2, Math.abs(len) / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(30,50,25,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
      const b = alphaBoundsOf(c);
      const out = document.createElement('canvas');
      out.width = 160;
      out.height = 200;
      const octx = out.getContext('2d');
      if (b && octx) octx.drawImage(c, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 0, 0, b.x1 - b.x0, b.y1 - b.y0);
      else octx?.drawImage(c, 0, 0);
      return out;
    }
    return c;
  };
  interface PlantTexEntry {
    dt: Texture;
    ar: number;
    onTrim: Array<(ar: number) => void>;
    loaded: boolean;
  }
  const plantTexCache = new Map<number, PlantTexEntry>();
  const plantTex = (species: number): PlantTexEntry => {
    const hit = plantTexCache.get(species);
    if (hit) return hit;
    const files = pt.art ?? [];
    const file = files.length > 0 ? files[species % files.length]! : null;
    // Placeholder 1×1 válido: updateURL(refresco real) llega con el decode del arte.
    const dt = new (B().Texture)(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      scene,
      false,
      true,
    );
    dt.name = `maceta_tex_${species}`;
    dt.hasAlpha = true;
    const entry: PlantTexEntry = { dt, ar: 0.8, onTrim: [], loaded: false };
    plantTexCache.set(species, entry);
    if (file) {
      // Arte IA (fondo blanco pegado de fábrica): Image → stripCorners (flood-fill de
      // esquinas) → recorte a la caja del contenido → Texture(dataURL) — el camino verificado
      // en v1.26 para conservar el alpha (los DynamicTexture desde canvas pierden el canal).
      // El ar real llega con el decode y los quads ya nacidos se reescalan vía onTrim.
      const entry0 = entry;
      const img = new Image();
      img.onload = () => {
        const big = document.createElement('canvas');
        big.width = Math.max(1, img.naturalWidth);
        big.height = Math.max(1, img.naturalHeight);
        const bx = big.getContext('2d', { willReadFrequently: true });
        if (!bx) return;
        bx.drawImage(img, 0, 0);
        stripCorners(big, 0.14);
        const b = alphaBoundsOf(big);
        const out = document.createElement('canvas');
        if (b) {
          out.width = Math.max(1, b.x1 - b.x0);
          out.height = Math.max(1, b.y1 - b.y0);
        } else {
          out.width = big.width;
          out.height = big.height;
        }
        const octx = out.getContext('2d');
        if (!octx) return;
        if (b) octx.drawImage(big, b.x0, b.y0, out.width, out.height, 0, 0, out.width, out.height);
        else octx.drawImage(big, 0, 0);
        entry0.dt.updateURL(out.toDataURL('image/png'));
        entry0.ar = Math.max(0.05, out.width / Math.max(1, out.height));
        entry0.loaded = true;
        for (const cb of entry0.onTrim) cb(entry0.ar);
      };
      img.onerror = () => {
        // Sin arte disponible: fallback dibujado (jamás romper el juego por un asset).
        const c = plantCanvasFallback(species);
        entry0.dt.updateURL(c.toDataURL('image/png'));
        entry0.ar = c.width / Math.max(1, c.height);
        entry0.loaded = true;
        for (const cb of entry0.onTrim) cb(entry0.ar);
      };
      img.src = file;
    } else {
      const c = plantCanvasFallback(species);
      entry.dt = canvasTex(`maceta_tex_${species}`, c);
      entry.ar = c.width / Math.max(1, c.height);
      entry.loaded = true;
    }
    return entry;
  };
  /** v1.26 — centros de puerta de la planta (viviendas + cubo de escalera): ninguna maceta
   *  invade su radio libre (pots.doorClearance). Determinista: reintentos por hash, y si
   *  todos caen cerca de una puerta, la maceta simplemente no nace. */
  const doorXsAt = (floor: number): number[] =>
    Object.values(world.blocks)
      .filter((b) => b.cell.floor === floor && (b.kind === 'dwelling' || content.blocks[b.defId]!.features?.stairs === true))
      .map((b) => (b.cell.col + b.size.w / 2) * v.cellW);
  for (const b of Object.values(world.blocks)) {
    if (b.layer !== 'corridor') continue;
    const ySlab = b.cell.floor * v.cellH + v.slab * 2;
    const doors = doorXsAt(b.cell.floor);
    const clear = pt.doorClearance ?? 0.95;
    const n = pt.perFloorMin + Math.floor(hash01(b.id, 101) * (pt.perFloorMax - pt.perFloorMin + 1));
    for (let i = 0; i < n; i++) {
      let x = NaN;
      for (let tryN = 0; tryN < 8; tryN++) {
        const cand = b.cell.col * v.cellW + 1.6 + hash01(b.id, 200 + i * 8 + tryN) * (b.size.w * v.cellW - 3.2);
        if (doors.every((dx) => Math.abs(dx - cand) >= clear)) {
          x = cand;
          break;
        }
      }
      if (!Number.isFinite(x)) continue; // sin sitio libre: sin maceta (mejor que tapar una puerta)
      const z = hash01(b.id, 300 + i) < 0.5 ? frontZ - 0.18 : frontZ - v.corridorDepth + 0.2;
      const s = 0.85 + hash01(b.id, 400 + i) * 0.3;
      const species = hash01(b.id, 600 + i) < 0.5 ? 0 : 1;
      {
        // v1.27: recorte billboard con arte IA (PNG alpha) + base HUNDIDA en la losa.
        const h = (pt.artH ?? 0.85) * s;
        const art = plantTex(species);
        const wQ = h * art.ar;
        const pm = mat(`${b.id}_maceta_bill_${i}_mat`);
        pm.diffuseTexture = art.dt;
        pm.emissiveColor = Color3.FromHexString(pt.plantColor).scale(0.05);
        pm.specularColor = new Color3(0, 0, 0);
        pm.transparencyMode = 1; // ALPHATEST: recorte de la planta
        pm.alphaCutOff = 0.4;
        // v1.26: sin esto el alpha de la textura no llega al shader (Babylon 8 lo cambió a
        // false por defecto) y la maceta se veía con fondo negro.
        pm.useAlphaFromDiffuseTexture = true;
        const q = attach(b.id, MeshBuilder.CreatePlane(`${b.id}_maceta_${i}`, { width: wQ, height: h }, scene));
        q.position.set(x, ySlab + h / 2 - 0.03, z);
        if (!art.loaded) {
          // El aspect real llega con el decode del PNG: el quad se reescala en X.
          const ar0 = art.ar;
          art.onTrim.push((nar) => {
            q.scaling.x = nar / ar0;
          });
        }
        q.material = pm;
        q.isPickable = false;
      }
    }
  }

  // ── Mobiliario interior (v1.23): RETIRADO. Los muebles 3D greybox se sustituyen por los
  // dioramas de billboards con paralaje (diorama.ts + content/interiors.json): paredes y
  // suelos ilustrados y 2-3 capas de sprites entre los que se intercalan los personajes.
  // El catálogo furniture.json y las ranuras del sim siguen intactos (data-driven); solo
  // desaparece su representación por cajas.

  // ── APILAMIENTO 3D DE BLOQUES (v1.19) ── bloques TRASEROS inactivos que se ACTIVAN al
  // entrar: el bloque precedente se desvanece (fundido) y el nuevo aparece con transparencia
  // hasta visualizarse, identificado por un contorno ROJO grueso en todo el perímetro frontal
  // (el que da hacia el pasillo). Dos familias:
  //   · Cuarto trasero de cada vivienda (layout con estancia más profunda que el bloque).
  //   · Interior presentable del trastero PROPIO (bloques por columna: solo tu puerta abre).
  const rb = v.rearBlock;
  const rears = new Map<string, { node: TransformNode; outline: Mesh[]; doorLeaf: Mesh | null; mainRoot: TransformNode; phase: 'idle' | 'peek' | 'inside'; mainAlpha: number; rearAlpha: number; settled: boolean; frontParts: Mesh[] }>();
  const matRearWall = mat('rear_muro_mat');
  matRearWall.diffuseColor = Color3.FromHexString('#d8d2c4');
  const matRearOutline = mat('rear_contorno_mat');
  matRearOutline.emissiveColor = Color3.FromHexString(rb.outline);
  matRearOutline.diffuseColor = Color3.FromHexString(rb.outline);
  const matRearJunk = tr.junk.map((hex, i) => {
    const jm = mat(`rear_trasto_${i}_mat`);
    jm.diffuseColor = Color3.FromHexString(hex);
    return jm;
  });
  const matRearLamp = mat('rear_lampara_mat');
  matRearLamp.emissiveColor = Color3.FromHexString(rb.lampColor);
  /** Contorno ROJO grueso del perímetro frontal (4 listones): la firma del bloque activo. */
  const outlineFrame = (name: string, cxr: number, wR: number, hR: number, yBase: number, zF: number): Mesh[] => {
    const t = 0.06;
    return [
      box(`${name}_co_sup`, wR, t, t, cxr, yBase + hR, zF, matRearOutline),
      box(`${name}_co_inf`, wR, t, t, cxr, yBase, zF, matRearOutline),
      box(`${name}_co_izq`, t, hR, t, cxr - wR / 2, yBase + hR / 2, zF, matRearOutline),
      box(`${name}_co_der`, t, hR, t, cxr + wR / 2, yBase + hR / 2, zF, matRearOutline),
    ];
  };
  const registerRear = (blockId: string, node: TransformNode, outline: Mesh[], doorLeaf: Mesh | null, frontParts: Mesh[] = []): void => {
    node.setEnabled(false);
    rears.set(blockId, { node, outline, doorLeaf, mainRoot: roots.get(blockId)!, phase: 'idle', mainAlpha: 1, rearAlpha: 0, settled: true, frontParts });
  };
  // ── Cuartos traseros de vivienda ──
  for (const b of Object.values(world.blocks)) {
    if (b.kind !== 'dwelling') continue;
    const layoutId = content.blocks[b.defId]?.container?.layout;
    const layout = layoutId ? content.layouts[layoutId] : undefined;
    const rearRooms = (layout?.rooms ?? []).filter((r) => r.rect && r.rect.z + r.rect.d > v.depth + 0.01);
    if (rearRooms.length === 0) continue;
    const rect = rearRooms[0]!.rect!;
    const rdef = content.rooms[rearRooms[0]!.defId];
    const rearDoor = (layout?.doorways ?? []).find((dw) => dw.axis === 'x' && rearRooms.some((r) => r.key === dw.b));
    const bottom = b.cell.floor * v.cellH;
    const x0 = b.cell.col * v.cellW;
    const rx = x0 + rect.x;
    const rw = rect.w;
    const rz0 = frontZ + rect.z;
    const rd = rect.d;
    const hR = v.cellH - v.gapH;
    const yR = bottom + v.cellH / 2;
    const baseR = bottom + v.slab * 2;
    const node = new TransformNode(`${b.id}_rear_root`, scene);
    const matFloor = mat(`${b.id}_rear_suelo_mat`);
    matFloor.diffuseColor = Color3.FromHexString(rdef?.view?.color ?? '#b08968');
    box(`${b.id}_rear_suelo`, rw, v.slab * 2, rd, rx + rw / 2, baseR - v.slab, rz0 + rd / 2, matFloor).parent = node;
    // Pared del FONDO (v1.21): con VENTANA al paisaje urbano del fondo (fachadas parallax y
    // cielo) — el cuarto trasero ya no es un cubo ciego. Muro partido en 4 segmentos + marco
    // con cruceta + cristal translúcido. Sin sitio (estancias estrechas) sigue siendo muro ciego.
    const wv = v.rearBlock.window;
    const wallTop = bottom + (v.cellH + hR) / 2;
    const winCx = rx + rw / 2;
    const winZ = rz0 + rd - v.wall / 2;
    const canWindow = rw >= wv.w + 0.5 && baseR + wv.sill + wv.h + 0.12 <= wallTop;
    const matFrame = mat(`${b.id}_rear_ventana_marco_mat`);
    matFrame.diffuseColor = Color3.FromHexString(wv.frame);
    if (canWindow) {
      const wx0 = winCx - wv.w / 2;
      const wx1 = winCx + wv.w / 2;
      const wy0 = baseR + wv.sill;
      const wy1 = wy0 + wv.h;
      // Segmentos del muro alrededor del hueco.
      if (wx0 - rx > 0.02) box(`${b.id}_rear_fondo_i`, wx0 - rx, hR, v.wall, (rx + wx0) / 2, yR, winZ, matRearWall).parent = node;
      if (rx + rw - wx1 > 0.02) box(`${b.id}_rear_fondo_d`, rx + rw - wx1, hR, v.wall, (wx1 + rx + rw) / 2, yR, winZ, matRearWall).parent = node;
      if (wy0 - baseR > 0.02) box(`${b.id}_rear_fondo_vago`, wv.w, wy0 - baseR, v.wall, winCx, baseR + (wy0 - baseR) / 2, winZ, matRearWall).parent = node;
      if (wallTop - wy1 > 0.02) box(`${b.id}_rear_fondo_dintel_v`, wv.w, wallTop - wy1, v.wall, winCx, wy1 + (wallTop - wy1) / 2, winZ, matRearWall).parent = node;
      // Marco (4 listones) + cruceta: lectura de ventana incluso desde lejos.
      const ft = 0.06;
      box(`${b.id}_rear_vmarco_sup`, wv.w + ft * 2, ft, 0.1, winCx, wy1 + ft / 2, winZ, matFrame).parent = node;
      box(`${b.id}_rear_vmarco_inf`, wv.w + ft * 2, ft, 0.1, winCx, wy0 - ft / 2, winZ, matFrame).parent = node;
      box(`${b.id}_rear_vmarco_izq`, ft, wv.h, 0.1, wx0 - ft / 2, wy0 + wv.h / 2, winZ, matFrame).parent = node;
      box(`${b.id}_rear_vmarco_der`, ft, wv.h, 0.1, wx1 + ft / 2, wy0 + wv.h / 2, winZ, matFrame).parent = node;
      box(`${b.id}_rear_vmarco_mullion`, 0.045, wv.h, 0.08, winCx, wy0 + wv.h / 2, winZ, matFrame).parent = node;
      box(`${b.id}_rear_vmarco_travesano`, wv.w, 0.045, 0.08, winCx, wy0 + wv.h / 2, winZ, matFrame).parent = node;
      // Cristal translúcido: el paisaje (fachadas parallax + cielo) se ve a través.
      const glassMat = mat(`${b.id}_rear_vidrio_mat`);
      glassMat.diffuseColor = Color3.FromHexString(wv.glass);
      glassMat.alpha = wv.glassAlpha;
      glassMat.specularColor = new Color3(0.1, 0.1, 0.1);
      const glass = MeshBuilder.CreatePlane(`${b.id}_rear_vidrio`, { width: wv.w, height: wv.h, sideOrientation: B().Mesh.DOUBLESIDE }, scene);
      glass.material = glassMat;
      glass.isPickable = false;
      glass.position.set(winCx, wy0 + wv.h / 2, winZ);
      glass.parent = node;
    } else {
      box(`${b.id}_rear_fondo`, rw, hR, v.wall, rx + rw / 2, yR, winZ, matRearWall).parent = node;
    }
    box(`${b.id}_rear_izq`, v.wall, hR, rd, rx + v.wall / 2, yR, rz0 + rd / 2, matRearWall).parent = node;
    box(`${b.id}_rear_der`, v.wall, hR, rd, rx + rw - v.wall / 2, yR, rz0 + rd / 2, matRearWall).parent = node;
    box(`${b.id}_rear_techo`, rw, v.wall, rd, rx + rw / 2, bottom + v.cellH - v.slab - v.wall / 2, rz0 + rd / 2, matRearWall).parent = node;
    box(`${b.id}_rear_lampara`, Math.min(1.2, rw * 0.4), 0.06, 0.1, rx + rw / 2, bottom + v.cellH - v.slab - v.wall - 0.08, rz0 + rd / 2, matRearLamp).parent = node;
    // Diorama del cuarto trasero (v1.23): pared ilustrada + suelo + billboards, colgando del
    // nodo trasero (aparece/desaparece con el bloque en el apilamiento 3D).
    const rearInterior = interiors.get(b.id);
    if (diro && rearInterior) {
      const dioRoom = diro.room(`${b.id}_rear`, rearRooms[0]!.defId, rect, { x0, frontZ, yBottom: baseR, yTop: bottom + v.cellH - v.slab - v.wall }, { parent: node });
      if (dioRoom) {
        rearInterior.dio.rooms.set(`rear_${b.id}`, dioRoom);
        for (const s of dioRoom.wall) rearInterior.dioMats.push(s.mat);
        if (dioRoom.floor) rearInterior.dioMats.push(dioRoom.floor.mat);
        for (const s of dioRoom.sprites) rearInterior.dioMats.push(s.mat);
      }
    }
    // Frente con el hueco de la puerta (mismas medidas que la pared partida del bloque).
    // v1.20: esta PARED DIVISORIA se recoge: al ENTRAR en el cuarto trasero desaparece
    // (mismo corte que la fachada del bloque exterior) para que la cámara vea el interior.
    const gapA = rx + (rearDoor ? Math.max(0, rearDoor.at - rearDoor.width / 2) : rw / 2 - 0.5);
    const gapB = rx + (rearDoor ? Math.min(rw, rearDoor.at + rearDoor.width / 2) : rw / 2 + 0.5);
    const doorH = Math.min(hR - 0.15, 1.95);
    const frontParts: Mesh[] = [];
    if (gapA - rx > 0.02) {
      const fi = box(`${b.id}_rear_frente_i`, gapA - rx, hR, v.wall, (rx + gapA) / 2, yR, rz0 + v.wall / 2 + 0.005, matRearWall);
      fi.parent = node;
      frontParts.push(fi);
    }
    if (rx + rw - gapB > 0.02) {
      const fd = box(`${b.id}_rear_frente_d`, rx + rw - gapB, hR, v.wall, (gapB + rx + rw) / 2, yR, rz0 + v.wall / 2 + 0.005, matRearWall);
      fd.parent = node;
      frontParts.push(fd);
    }
    if (hR - doorH > 0.02) {
      const din = box(`${b.id}_rear_frente_dintel`, gapB - gapA, hR - doorH, v.wall, (gapA + gapB) / 2, yR + hR / 2 - (hR - doorH) / 2, rz0 + v.wall / 2 + 0.005, matRearWall);
      din.parent = node;
      frontParts.push(din);
    }
    // Hoja de puerta cerrada: visible solo con el bloque inactivo (se abre al activarse).
    const pv = v.privacy;
    const doorLeaf = box(`${b.id}_rear_hoja`, gapB - gapA - 0.04, doorH - 0.04, 0.05, (gapA + gapB) / 2, baseR + (doorH - 0.04) / 2, rz0 + v.wall + 0.05, mat(`${b.id}_rear_hoja_mat`));
    (doorLeaf.material as StandardMaterial).diffuseColor = Color3.FromHexString(pv.doorColor);
    doorLeaf.parent = node;
    // Bártulos deterministas (hash01 del bloque — jamás RNG del sim).
    for (let j = 0; j < rb.junk; j++) {
      const jw = 0.35 + hash01(b.id, 1100 + j) * 0.6;
      const jh = 0.25 + hash01(b.id, 1200 + j) * 0.45;
      const jm = matRearJunk[Math.floor(hash01(b.id, 1300 + j) * matRearJunk.length) % matRearJunk.length]!;
      box(`${b.id}_rear_trasto_${j}`, jw, jh, 0.5, rx + 0.4 + hash01(b.id, 1400 + j) * Math.max(0.1, rw - 0.9), baseR + jh / 2, rz0 + 0.5 + hash01(b.id, 1500 + j) * Math.max(0.1, rd - 1.0), jm).parent = node;
    }
    const outline = outlineFrame(`${b.id}_rear`, rx + rw / 2, rw, hR, baseR, rz0 - 0.04);
    for (const o of outline) o.parent = node;
    registerRear(b.id, node, outline, doorLeaf, frontParts);
  }
  // ── Interior presentable del TRASTERO PROPIO (uno por bloque de columna; solo tu puerta abre).
  // v1.21: los RECTS de sus estanterías y trastos se registran aquí (cellObstacles) — una sola
  // verdad geométrica: player-logic los consume para esquivarlos al moverse dentro.
  const cellObstacleRects: { x0: number; z0: number; w: number; d: number }[] = [];
  if (colBlocks.length > 0) {
    const sg2 = storageGeomOf(v);
    const homeTag2 = homeId.slice(homeId.lastIndexOf('_') + 1);
    for (const blk of colBlocks) {
      const tag = blk.id.slice(blk.id.lastIndexOf('_') + 1);
      if (tag !== homeTag2) continue; // solo la columna del jugador tiene interior presentable
      const colDwell = dwellingsOrdered.filter((d) => d.id.endsWith(`_${tag}`));
      const plan = storageUnitPlan(v, colDwell.map((d) => d.cell.floor));
      const unit = plan.find((u) => u.floor === (world.blocks[homeId]?.cell.floor ?? -1));
      if (!unit) continue;
      const x0 = blk.cell.col * v.cellW;
      const bottom = blk.cell.floor * v.cellH;
      const W = blk.size.w * v.cellW - v.gapW;
      const H = sg2.unitH + 0.5;
      const D = tr.cellRoomDepth;
      const cxr = x0 + W / 2;
      const baseR = bottom + v.slab * 2;
      const czr = frontZ + D / 2;
      const node = new TransformNode(`${blk.id}_cell_root`, scene);
      const matCell = mat(`${blk.id}_cell_muro_mat`);
      matCell.diffuseColor = Color3.Lerp(Color3.FromHexString(tr.wood), Color3.FromHexString(tr.partitionColor), 0.35);
      box(`${blk.id}_cell_suelo`, W, v.slab * 2, D, cxr, bottom + v.slab, czr, matCell).parent = node;
      box(`${blk.id}_cell_fondo`, W, H, v.wall, cxr, baseR + H / 2, frontZ + D - v.wall / 2, matCell).parent = node;
      box(`${blk.id}_cell_izq`, v.wall, H, D, x0 + v.wall / 2, baseR + H / 2, czr, matCell).parent = node;
      box(`${blk.id}_cell_der`, v.wall, H, D, x0 + W - v.wall / 2, baseR + H / 2, czr, matCell).parent = node;
      box(`${blk.id}_cell_techo`, W, v.wall, D, cxr, baseR + H + v.wall / 2, czr, matCell).parent = node;
      box(`${blk.id}_cell_lampara`, Math.min(1.2, W * 0.35), 0.06, 0.1, cxr, baseR + H - 0.08, czr, matRearLamp).parent = node;
      // Estanterías del fondo: 2 bahías × cellShelfTiers baldas (mismo dialecto visual que
      // las naves v1.16) y trastos deterministas del propietario.
      const tierH = 0.5;
      const bayW = Math.min(1.6, (W - 0.8) / 2);
      const matPost = mat('trasteros_poste_mat');
      matPost.diffuseColor = Color3.FromHexString(tr.woodDark);
      const matPlank = mat('trasteros_tabla_mat');
      matPlank.diffuseColor = Color3.FromHexString(tr.wood);
      for (let bay = 0; bay < 2; bay++) {
        const bx = cxr + (bay === 0 ? -1 : 1) * (bayW / 2 + 0.25);
        cellObstacleRects.push({ x0: bx - bayW / 2, z0: frontZ + D - 0.3 - tr.shelfD / 2, w: bayW, d: tr.shelfD });
        for (const side of [-1, 1] as const) {
          box(`${blk.id}_cell_poste_${bay}_${side}`, tr.postW, tr.cellShelfTiers * tierH, tr.shelfD, bx + side * (bayW / 2), baseR + (tr.cellShelfTiers * tierH) / 2, frontZ + D - 0.3, matPost).parent = node;
        }
        for (let t = 1; t <= tr.cellShelfTiers; t++) {
          box(`${blk.id}_cell_balda_${bay}_${t}`, bayW, tr.plankT, tr.shelfD, bx, baseR + t * tierH - tr.plankT / 2, frontZ + D - 0.3, matPlank).parent = node;
          if (hash01(homeId, 2100 + bay * 10 + t) < 0.6) {
            const jw = 0.3 + hash01(homeId, 2200 + bay * 10 + t) * 0.5;
            const jh = 0.18 + hash01(homeId, 2300 + bay * 10 + t) * 0.22;
            const jm = matRearJunk[Math.floor(hash01(homeId, 2400 + bay * 10 + t) * matRearJunk.length) % matRearJunk.length]!;
            box(`${blk.id}_cell_trasto_${bay}_${t}`, jw, jh, tr.shelfD * 0.7, bx + (hash01(homeId, 2500 + bay * 10 + t) - 0.5) * Math.max(0.05, bayW - jw - 0.1), baseR + (t - 1) * tierH + tr.plankT + jh / 2, frontZ + D - 0.3, jm).parent = node;
          }
        }
      }
      for (let j = 0; j < tr.cellJunk; j++) {
        const jw = 0.35 + hash01(homeId, 2600 + j) * 0.6;
        const jh = 0.22 + hash01(homeId, 2700 + j) * 0.4;
        const jm = matRearJunk[Math.floor(hash01(homeId, 2800 + j) * matRearJunk.length) % matRearJunk.length]!;
        const jx = x0 + 0.5 + hash01(homeId, 2900 + j) * Math.max(0.1, W - 1.1);
        const jz = frontZ + 0.5 + hash01(homeId, 3000 + j) * Math.max(0.1, D - 1.2);
        cellObstacleRects.push({ x0: jx - jw / 2, z0: jz - 0.25, w: jw, d: 0.5 });
        box(`${blk.id}_cell_suelo_trasto_${j}`, jw, jh, 0.5, jx, baseR + jh / 2, jz, jm).parent = node;
      }
      // Diorama del TRASTERO propio (v1.23): hormigón + estanterías/cajas como billboards;
      // cuelga del nodo del bloque trasero (visible solo en la fase 'inside').
      const cellHost = interiors.get(blk.id) ?? null;
      if (diro) {
        const dioRoom = diro.room(`${blk.id}_cell`, 'trastero', { x: 0, z: 0, w: W, d: D }, { x0, frontZ, yBottom: baseR, yTop: baseR + H }, { parent: node });
        if (dioRoom) {
          const host = cellHost ?? { dio: newDioramaSet(), dioMats: [] as StandardMaterial[] };
          host.dio.rooms.set(`cell_${blk.id}`, dioRoom);
          for (const s of dioRoom.wall) host.dioMats.push(s.mat);
          if (dioRoom.floor) host.dioMats.push(dioRoom.floor.mat);
          for (const s of dioRoom.sprites) host.dioMats.push(s.mat);
          if (!cellHost) interiors.set(blk.id, { floors: [], lamps: [], dio: host.dio, dioMats: host.dioMats, dioRoot: null });
        }
      }
      const outline = outlineFrame(`${blk.id}_cell`, cxr, W, H, baseR, frontZ - 0.04);
      for (const o of outline) o.parent = node;
      registerRear(blk.id, node, outline, null);
    }
  }

  function color(b: BlockInstance): Color3 {
    const base = Color3.FromHexString(content.blocks[b.defId]!.view?.color ?? '#cccccc');
    if (b.kind === 'dwelling' && b.access === 'locked') return Color3.FromHexString(v.lockedColor);
    if (b.kind === 'dwelling' && b.occupancy !== 'occupied') return Color3.Lerp(base, Color3.White(), v.vacantTint);
    if (b.params.elevator_status !== undefined && b.params.elevator_status !== 'ok') return Color3.FromHexString(v.brokenColor);
    return base;
  }

  /** Color de ESTADO (null = sin estado especial). El greybox lo pinta plano; los modelos lo mezclan. */
  function stateTint(b: BlockInstance): Color3 | null {
    if (b.kind === 'dwelling' && b.access === 'locked') return Color3.FromHexString(v.lockedColor);
    if (b.kind === 'dwelling' && b.occupancy !== 'occupied') return Color3.Lerp(Color3.FromHexString(content.blocks[b.defId]!.view?.color ?? '#cccccc'), Color3.White(), v.vacantTint);
    if (b.params.elevator_status !== undefined && b.params.elevator_status !== 'ok') return Color3.FromHexString(v.brokenColor);
    return null;
  }

  /** Emissive del bloque: canales de influencia → emissive según color del canal en el catálogo. Se acumulan. */
  function applyEmissive(view: BlockView, b: BlockInstance) {
    let e = new Color3(0, 0, 0);
    for (const [channel, value] of Object.entries(world.channels)) {
      const level = value[b.id];
      if (!level) continue;
      const g = glow[channel];
      if (!g) continue;
      e = e.add(g.scale(Math.min(1, level)));
    }
    // v1.29 — autoiluminación sutil de la vivienda (caras inferiores sin luz → gris suave,
    // jamás negro): convive con el glow de canales y con la noche (el LOD 'glow' la pisa
    // con baseEmissive; al soltarlo aquí se repinta con el selfGlow incluido).
    if (view.selfGlow) e = e.add(view.selfGlow);
    for (const m of view.mats) m.emissiveColor = e;
  }

  /** Color difuso/albedo por material: greybox plano (tintStrength 1) o mezcla sobre el arte.
   *  v1.25: fixedDiffuse (pared gris de vivienda) se impone al tintado — el estado lo cuentan
   *  la puerta, el candado y la placa; el emissive de canales sigue funcionando igual. */
  function applyTint(view: BlockView, b: BlockInstance) {
    const state = color(b);
    const override = stateTint(b);
    for (let i = 0; i < view.mats.length; i++) {
      const m = view.mats[i]!;
      const base = view.baseColor[i]!;
      if (view.fixedDiffuse) {
        if (m.diffuseColor) m.diffuseColor = view.fixedDiffuse;
        else if (m.albedoColor) m.albedoColor = view.fixedDiffuse;
        continue;
      }
      const c = view.tintStrength >= 1 ? state : override ? Color3.Lerp(base, override, view.tintStrength) : base;
      if (m.diffuseColor) m.diffuseColor = c;
      else if (m.albedoColor) m.albedoColor = c;
    }
  }

  // ── Privacidad de viviendas (v1.17): conjunto de bloques con alguien dentro (el jugador
  //  vía playerInside + cualquier residente presente cuyo location sea el bloque). Se
  //  recalcula por frame en update(): la fachada reacciona al instante cuando un vecino
  //  llega a casa o el jugador entra, sin esperar al siguiente tick.
  let playerInside: string | null = null;
  const privacyOn = v.privacy.enabled;
  // Colores cacheados de las luces nocturnas de interiores (v1.21→v1.25): cero allocations
  // por frame y NIVELES del catálogo (privacy.night) — las viviendas despiertas se VEN
  // iluminadas de verdad (antes el brillo era tan bajo que no se distinguía de apagado).
  const nightCfg = v.privacy.night ?? { dayCutoff: 0.4, dioGlow: 0.85, floorGlow: 0.7, lampGlow: 1.6 };
  const nightWarm = Color3.FromHexString(v.privacy.handleColor);
  const nightLampLit = nightWarm.scale(nightCfg.lampGlow);
  const nightFloorGlow = nightWarm.scale(nightCfg.floorGlow);
  const nightDioGlow = nightWarm.scale(nightCfg.dioGlow);
  const nightDark = new Color3(0, 0, 0);
  const computeOccupancy = (): Set<string> => {
    const occ = new Set<string>();
    if (playerInside) occ.add(playerInside);
    for (const r of Object.values(world.residents)) {
      if (r.present && r.location) occ.add(r.location);
    }
    // v1.30 — sala de juntas activa: los asistentes (presentación) están dentro aunque el
    // sim no mueva su location; el local se abre, se ilumina y se ve la reunión.
    if (juntaHallId) occ.add(juntaHallId);
    return occ;
  };

  /** Visibilidad efectiva de fachada/puerta/candado: candado solo si access='locked';
   *  fachada cerrada si está bloqueada O si la privacidad la cierra (nadie dentro).
   *  paint() la fija por el acceso y el LOD puede ocultarlos encima.
   *  v1.41 — VISTA FACHADA (tecla 0): TODO cerrado — la fachada entera se ve acristalada
   *  (cortina con ventanas a la altura del pasillo) y el interior solo se entreve por ellas. */
  let fachadaView = false;
  function applyPanels(view: BlockView, b: BlockInstance, occ?: Set<string>) {
    const locked = b.kind === 'dwelling' && b.access === 'locked';
    // v1.30 — los locales con interior (trastero comunitario, sala de juntas) usaban la
    // MISMA regla de privacidad que las viviendas. v1.32 — REGLA PROPIA (petición del
    // vecino): las paredes del pasillo de los bloques inferiores SOLO se desvanecen cuando
    // ENTRAMOS por la puerta (jugador dentro) o con la junta activa — que un vecino esté
    // dentro ya no levanta la fachada; la puerta, eso sí, se abre con el resto.
    const isHall = halls.has(b.id);
    let privacyClosed = false;
    if (privacyOn) {
      if (b.kind === 'dwelling') {
        privacyClosed = !(occ ?? computeOccupancy()).has(b.id);
      } else if (isHall) {
        privacyClosed = playerInside !== b.id && juntaHallId !== b.id;
      }
    }
    // v1.41 — en vista FACHADA todas las fachadas están CERRADAS (sin seccionar): la cámara
    // exterior ve el bloque como un edificio de verdad y el interior solo se entreve por
    // las ventanas de la cortina acristalada.
    const wall = (fachadaView || locked || privacyClosed) && !view.lodHiddenPanels;
    view.front?.setEnabled(wall);
    for (const p of view.frontParts) p.setEnabled(wall); // v1.28: fachada partida — todo o nada
    view.door?.setEnabled(wall);
    view.handle?.setEnabled(wall);
    for (const d of view.doorDecor) d.setEnabled(wall);
    view.lock?.setEnabled(locked && !view.lodHiddenPanels);
    // v1.34 — GARAJE y v1.35 PORTAL: la fachada es el ARTE glTF (basculante + rótulo o
    // cristal + marcos). Al entrar, el modelo entero se desvanece y queda el interior del
    // catálogo — la misma regla que las viviendas, con la fachada de verdad del arte.
    if (b.defId === 'garaje' || b.defId === 'portal') view.model?.setEnabled(wall);
    // Diorama (v1.23): visibilidad ESPEJO de la fachada — fachada cerrada = interior oculto,
    // fachada abierta = diorama a la vista (y cero draw calls de interiores tapados).
    // v1.35 — el GARAJE y el PORTAL revelan el interior TAMBIÉN con la puerta ABIERTA:
    // «al abrirse se ven cerradas por una pared oscura» ya no puede pasar (la basculante
    // levantada o el cristal correído enseñan el vestíbulo/interior sin entrar).
    const interior = interiors.get(b.id);
    if (interior?.dioRoot) {
      let show = !wall && !fachadaView;
      if (!show && !fachadaView && (b.defId === 'garaje' || b.defId === 'portal')) {
        const openT = b.defId === 'portal' ? portalOpen : garajeLiftT;
        // v1.36 — reveal DESDE EL PRIMER MILÍMETRO de puerta (catálogo hallDoors.revealAt):
        // «tan pronto se levanta la puerta se ve el interior sin esperar a entrar».
        if (openT > (v.locals.hallDoors?.revealAt ?? 0.12)) show = true;
      }
      interior.dioRoot.setEnabled(show);
    }
  }

  /**
   * LOD por distancia (rules.view.lod). Se ejecuta SIEMPRE al final de update(): con foco degrada
   * cada bloque según su distancia, y sin foco (o con lod.enabled=false) restaura el estado completo.
   * Idempotente y sin allocations por frame: solo aritmética, booleanos y asignaciones.
   *
   * Métrica (Vista · LOD por distancia): dx = |centroX del bloque − focus.x| en metros y
   * dy = |planta del bloque − focus.floor| * view.cellH en metros; dist = Math.hypot(dx, dy).
   * Nivel efectivo = todos los niveles de lod.levels cuyo `dist` ≤ distBloque (el `hide` es
   * acumulado: un flag se oculta si cualquier nivel alcanzado lo lista; sin nivel → todo visible).
   */
  function applyLod(focus: { x: number; floor: number } | null) {
    const lod = v.lod;
    for (const id in world.blocks) {
      const b = world.blocks[id]!;
      const view = views.get(id)!;
      let hideEdges = false;
      let hideGlow = false;
      let hidePanels = false;
      if (lod.enabled && focus) {
        const dx = Math.abs(view.centerX - focus.x);
        const dy = Math.abs(view.floor - focus.floor) * v.cellH;
        const dist = Math.hypot(dx, dy);
        for (let i = 0; i < lod.levels.length; i++) {
          const level = lod.levels[i];
          if (level.dist > dist) continue;
          for (let j = 0; j < level.hide.length; j++) {
            const flag = level.hide[j];
            if (flag === 'edges') hideEdges = true;
            else if (flag === 'glow') hideGlow = true;
            else if (flag === 'panels') hidePanels = true;
          }
        }
      }
      // 'edges': interruptor nativo barato — el renderingGroup consulta edgesRenderer.isEnabled cada
      // frame, así que nunca se destruye ni recrea el EdgesRenderer (disable/enableEdgesRendering sí
      // lo harían: el primero lo dispone y el segundo recomputaría las aristas). El grosor/color
      // viven en la malla y sobreviven al apagado. Los modelos glTF no tienen edges (edgesMesh null).
      if (view.edgesMesh?.edgesRenderer) view.edgesMesh.edgesRenderer.isEnabled = !hideEdges;
      if (view.edgesMesh2?.edgesRenderer) view.edgesMesh2.edgesRenderer.isEnabled = !hideEdges;
      // 'glow': pisa el emissive CADA frame (paint() pudo repintar los canales este tick); al soltarlo,
      // una única llamada repinta el cálculo de paint para no esperar al próximo tick.
      if (hideGlow) {
        view.glowForced = true;
        for (let i = 0; i < view.mats.length; i++) view.mats[i]!.emissiveColor = view.baseEmissive[i]!;
      } else if (view.glowForced) {
        view.glowForced = false;
        applyEmissive(view, b);
      }
      // 'panels': solo gira la bandera (la visibilidad la calcula applyPanels); en la transición se
      // aplica ya para no esperar al próximo paint(), que reproducirá el mismo resultado.
      if (view.lodHiddenPanels !== hidePanels) {
        view.lodHiddenPanels = hidePanels;
        applyPanels(view, b);
      }
    }
  }

  // ── v1.41 — CORTINA ACRISTALADA de la vista FACHADA (tecla 0): cierra TODA la fachada
  // con ventanas repartidas a la altura de los pasillos (galería acristalada: vidrio
  // translúcido + montantes cada celda). Por el vidrio se ENTREVE la galería — vecinos
  // paseando, luces de noche — y nada más: el interior solo se ve por los huecos de
  // ventana, como pidió el vecino. NADA COPLANAR: vidrio a 4,5 cm del canto de la galería,
  // marcos a 6 cm (el canto de la losa está exactamente en railZ).
  const fachadaRoot = new TransformNode('fachada_cortina', scene);
  {
    const glassM = mat('fachada_cristal_mat');
    glassM.diffuseColor = Color3.FromHexString('#cdd9dd');
    glassM.alpha = 0.16;
    glassM.specularColor = new Color3(0.04, 0.04, 0.04);
    glassM.backFaceCulling = false;
    const frameM = mat('fachada_marco_mat');
    frameM.diffuseColor = Color3.FromHexString('#565d63');
    frameM.specularColor = new Color3(0.03, 0.03, 0.03);
    const railZ = v.roomZ - v.commonDepth / 2 - v.corridorDepth;
    const glassZ = railZ - 0.045;
    const frameZ = railZ - 0.06;
    for (const b of Object.values(world.blocks)) {
      if (b.layer !== 'corridor') continue;
      const x0 = b.cell.col * v.cellW;
      const W = b.size.w * v.cellW;
      const y0 = b.cell.floor * v.cellH + v.slab * 2 + 0.06;
      const openH = Math.max(0.4, v.cellH - v.slab * 2 - 0.18);
      const cxm = x0 + W / 2;
      const ym = y0 + openH / 2;
      const glass = MeshBuilder.CreatePlane(`fachada_vidrio_${b.id}`, { width: W - 0.05, height: openH }, scene);
      glass.position.set(cxm, ym, glassZ);
      glass.material = glassM;
      glass.isPickable = false;
      glass.parent = fachadaRoot;
      // Dintel y viðo del hueco (horizontal) + montante vertical en cada división de celda:
      // la fachada queda repartida en ventanas de un ancho de calle (cellW).
      for (const [tag, yy] of [['abajo', y0 - 0.045], ['arriba', y0 + openH + 0.045]] as const) {
        const bar = box(`fachada_barra_${tag}_${b.id}`, W, 0.09, 0.09, cxm, yy, frameZ, frameM);
        bar.isPickable = false;
        bar.parent = fachadaRoot;
      }
      for (let k = 0; k <= b.size.w; k++) {
        const mullion = box(`fachada_montante_${b.id}_${k}`, 0.07, openH + 0.2, 0.09, x0 + k * v.cellW, ym, frameZ, frameM);
        mullion.isPickable = false;
        mullion.parent = fachadaRoot;
      }
      // v1.42 — ZONAS CIEGAS por nivel (arriba Y abajo): la galería acristalada NO es todo
      // vidrio. Bandas opacas con el acabado de las fachadas de fondo (escayola beige de la
      // familia tint #f2efe6/#e9e4d6) + paneles ciegos deterministas (persianas cerradas del
      // tono «ventana» del fondo, #7d8ba0). Van DETRÁS del vidrio — dentro de la galería,
      // z = railZ+0.04 con calado 0.08: nada coplanar con el vidrio (−4,5 cm) ni con los
      // montantes (−6 cm) ni con el canto de la losa (railZ exacto). Por el vidrio solo se
      // ENTREVE la franja central: vecinos paseando, luces de noche.
      const fc = v.fachadaCortina;
      if (fc) {
        const bandM = mat('fachada_ciega_banda');
        bandM.diffuseColor = Color3.FromHexString(fc.bandColor);
        bandM.specularColor = new Color3(0.02, 0.02, 0.02);
        const panelM = mat('fachada_ciega_panel');
        panelM.diffuseColor = Color3.FromHexString(fc.panelColor);
        panelM.specularColor = new Color3(0.02, 0.02, 0.02);
        const blindZ = railZ + 0.04;
        const midH = Math.max(0.2, openH - fc.bottomBlind - fc.topBlind);
        if (fc.bottomBlind > 0.01) {
          const low = box(`fachada_ciega_abajo_${b.id}`, W - 0.05, fc.bottomBlind, 0.08, cxm, y0 + fc.bottomBlind / 2, blindZ, bandM);
          low.isPickable = false;
          low.parent = fachadaRoot;
        }
        if (fc.topBlind > 0.01) {
          const top = box(`fachada_ciega_arriba_${b.id}`, W - 0.05, fc.topBlind, 0.08, cxm, y0 + openH - fc.topBlind / 2, blindZ, bandM);
          top.isPickable = false;
          top.parent = fachadaRoot;
        }
        for (let k = 0; k < b.size.w; k++) {
          if (hash01(`fachada_ciega_${b.id}`, k) >= fc.panelChance) continue;
          const px = x0 + (k + 0.5) * v.cellW;
          const pw = v.cellW - fc.panelInset * 2;
          const panel = box(`fachada_ciega_panel_${b.id}_${k}`, pw, midH, 0.08, px, y0 + fc.bottomBlind + midH / 2, blindZ, panelM);
          panel.isPickable = false;
          panel.parent = fachadaRoot;
        }
      }
    }
    fachadaRoot.setEnabled(false);
  }

  return {
    /** v1.41 — conmutador de la VISTA FACHADA (el controlador lo manda al cambiar de cámara):
     *  cierra todas las fachadas (applyPanels) y muestra la cortina acristalada. */
    setFachadaView(on: boolean): void {
      if (fachadaView === on) return;
      fachadaView = on;
      fachadaRoot.setEnabled(on);
      for (const b of Object.values(world.blocks)) {
        const view = views.get(b.id);
        if (view) applyPanels(view, b);
      }
    },
    paint() {
      for (const b of Object.values(world.blocks)) {
        const view = views.get(b.id)!;
        applyTint(view, b);
        applyEmissive(view, b);
        applyPanels(view, b);
      }
      // Interiores 2D (Fase C): suelo de cada estancia según su acceso (cerrada = lockedColor).
      // v1.29: sin tapas — la vivienda es UN bloque abierto; el candado de verdad es el del
      // sim (walkable), el color del suelo cuenta el estado.
      for (const [blockId, interior] of interiors) {
        const block = world.blocks[blockId];
        if (!block) continue;
        for (const f of interior.floors) {
          const room = block.rooms.find((r) => r.key === f.roomKey);
          // v1.30 — locales con interior (sin instancias de estancia del sim): el color del
          // catálogo manda; el lockedColor es de viviendas con estancia cerrada.
          const locked = room ? room.access !== 'unlocked' : false;
          const hex = locked ? v.lockedColor : content.rooms[f.defId]?.view?.color ?? '#cccccc';
          f.mat.diffuseColor = Color3.FromHexString(hex);
        }
      }
      // ── v1.35 — DECALS DE DRAMA: opacidad desde los parámetros del sim ──
      //  Decay (humedad/hollín/grietas/mugre): cada mancha crece con su parámetro (o con
      //  la CAÍDA de condición/limpieza). Grafitis de muro: suben con cabin_graffiti del
      //  núcleo a partir de graffiti.spillToWalls; la junta los limpia al ponerlo a 0.
      for (const dd of decayDecals) {
        const blk = world.blocks[dd.blockId];
        if (!blk) continue;
        const raw = blk.params[dd.param];
        const val = typeof raw === 'number' ? raw : 0;
        const span = Math.max(1, dd.to - dd.from);
        const t = dd.invert ? (dd.to - val) / span : (val - dd.from) / span;
        const a = Math.min(1, Math.max(0, t));
        (dd.mesh.material as StandardMaterial).alpha = (dd.invert ? 0.8 : 0.88) * a;
        dd.mesh.setEnabled(a > 0.02);
      }
      if (graffitiWalls.length > 0 && v.graffiti) {
        const nuc = Object.values(world.blocks).find((b) => content.blocks[b.defId]!.features?.elevator === true);
        const level = typeof nuc?.params.cabin_graffiti === 'number' ? nuc.params.cabin_graffiti : 0;
        const t = Math.min(1, Math.max(0, (level - v.graffiti.spillToWalls) / 45));
        for (const painter of graffitiWalls) painter(t);
      }
    },
    /** v1.29 — Mallas EXCLUIDAS del GlowLayer: el interior de las viviendas se simula con
     *  material autoiluminado MUY sutil (el vecino: «sin casi efecto de glow, el actual es
     *  demasiado exagerado»). El resto de elementos (apliques, farolas, pantallitas, ventanal
     *  nocturno) conserva el halo actual. El controlador las registra tras crear la capa. */
    glowExcluded(): Mesh[] {
      const out: Mesh[] = [];
      for (const interior of interiors.values()) {
        for (const f of interior.floors) out.push(f.mesh);
        for (const s of interior.dio.shell) out.push(s.mesh);
        for (const room of interior.dio.rooms.values()) {
          for (const s of room.wall) out.push(s.mesh);
          for (const s of room.sprites) out.push(s.mesh);
          if (room.floor) out.push(room.floor.mesh);
          if (room.door) out.push(room.door.mesh);
        }
      }
      return out;
    },
    /** Sacude el candado de una puerta cerrada. */
    shake(blockId: string) {
      shakes.set(blockId, 0.4);
    },
    /**
     * Apilamiento 3D (v1.19): fase del bloque trasero de `blockId`.
     *  · 'idle'   — bloque inactivo (todo como siempre).
     *  · 'peek'   — el jugador se acerca a la puerta del fondo: el bloque trasero asoma por
     *               el hueco (transparencia → visible) y la hoja se abre.
     *  · 'inside' — cruzaste: el bloque principal SE DESVANECE y el trasero queda en primer
     *               plano con su contorno rojo.
     */
    setRearPhase(blockId: string, phase: 'idle' | 'peek' | 'inside'): void {
      const r = rears.get(blockId);
      if (r) r.phase = phase;
    },
    /** Rects de obstáculos del interior del trastero propio (v1.21): estanterías y trastos
     *  registrados al levantar la geometría — player-logic los esquiva al moverse dentro. */
    cellObstacles(): { x0: number; z0: number; w: number; d: number }[] {
      return cellObstacleRects;
    },
    /** v1.37 — obstáculos andables POR BLOQUE (mundo): las lavadoras/secadoras de la
     *  lavandería no se atraviesan (jugador dentro ni vecinos en ruta). */
    walkObstacles(): { blockId: string; rects: { x0: number; z0: number; w: number; d: number }[] }[] {
      return [...blockObstacles.entries()].map(([blockId, rects]) => ({ blockId, rects }));
    },
    /** v1.37 — posición (mundo) del atril del tablón de anuncios (planta 0, extremo del
     *  pasillo): el interact 'noticeboard' se ancla aquí. null si el catálogo no lo activa. */
    noticeboardSpot(): { x: number; z: number; floor: number } | null {
      return noticeboardSpot;
    },
    hasRear(blockId: string): boolean {
      return rears.has(blockId);
    },
    /** v1.30 — sala de juntas activa (junta convocada): el local se abre, se ilumina y
     *  acoge a los asistentes. null = junta cerrada. */
    setJuntaHall(blockId: string | null): void {
      juntaHallId = blockId;
    },
    /** v1.30 — info de la sala de juntas para el teatro del controlador: bloque, asientos y
     *  puestos de pie (mundo, con el yaw hacia la mesa). null si la plantilla no trae local. */
    juntaHallInfo(): { id: string; seats: { x: number; z: number; yaw: number }[]; stands: { x: number; z: number; yaw: number }[] } | null {
      for (const id of hallSeats.keys()) {
        const h = hallSeats.get(id)!;
        if (h.seats.length > 0) return { id, seats: h.seats, stands: h.stands };
      }
      return null;
    },
    /**
     * dt en segundos; `focus` es el punto de interés (posición del jugador) para el
     * LOD por distancia (rules.view.lod): applyLod() lo aplica SIEMPRE al final del frame
     * (con focus undefined, p. ej. cámara 'edificio', restaura el estado completo).
     * `inside` es el bloque donde está el jugador ahora (pos.insideBlock): alimenta la
     * privacidad y re-evalúa las fachadas CADA frame — un vecino que llega a casa abre
     * su interior al instante, sin esperar al siguiente tick.
     * `pos` (v1.19) alimenta los carteles guía de trasteros y el apilamiento 3D.
     */
    update(dt: number, focus?: { x: number; floor: number }, inside?: string | null, pos?: { x: number; z: number; insideBlock: string | null }, env?: { daylight: number; movers?: { x: number; y: number; z: number; outside?: boolean }[] }) {
      if (focus) lastFocus = focus;
      if (inside !== undefined) playerInside = inside;
      // PRIVACIDAD (v1.17) cada frame: la fachada de una vivienda sin nadie dentro se cierra
      // con su puerta al pasillo y se abre en cuanto alguien entra (propietario, visita…
      // o un ladrón). Vive en update() y no en paint() para reaccionar incluso con el
      // mundo congelado (modal abierto) y sin esperar al siguiente tick.
      const occSet = computeOccupancy();
      if (privacyOn) {
        for (const b of Object.values(world.blocks)) {
          // v1.30 — los locales con interior (trastero comunitario, sala de juntas) también
          // abren/cierran su fachada con la ocupancia, igual que las viviendas.
          if (b.kind !== 'dwelling' && !halls.has(b.id)) continue;
          applyPanels(views.get(b.id)!, b, occSet);
        }
      }
      // LUCES INTERIORES NOCTURNAS (v1.21): al caer el sol, las estancias que se ven abiertas
      // (alguien dentro) se ILUMINAN salvo que su inquilino duerma — entonces, a oscuras.
      // Colores cacheados: cero allocations por frame. De día, lámparas apagadas.
      {
        const day = env?.daylight ?? 1;
        const litWorld = day < nightCfg.dayCutoff;
        // Apliques de las puertas (v1.24): foco cálido al anochecer, apagados de día.
        const lampGlow = litWorld ? 1.0 : 0.06;
        for (const { mat: lm, hex } of doorLampMats) lm.emissiveColor = Color3.FromHexString(hex).scale(lampGlow);
        // PUERTAS DE ESCALERA (v1.24): se abren antes de que alguien entre o salga (cualquier
        // mover cerca del umbral) y la ILUMINACIÓN COMPARTIDA de TODOS los cubos se enciende
        // de noche si algún vecino se mueve por las escaleras (un solo nivel para todos).
        const movers = env?.movers ?? [];
        // v1.44 — QUIÉN PUEDE ABRIR: el jugador en la calle (outside) no cuenta para NINGUNA
        // puerta (garaje, escalera, locales, portal). Pasar delante desde la acera no abre
        // nada — la calle es decorado, no el interior del edificio.
        const openers = movers.filter((mv) => !mv.outside);
        const al = v.stairs.activityLight;
        // ── v1.30 — PUERTAS CORREDERAS DEL PORTAL: se separan al acercarse cualquiera
        //  (jugador, vecino o visitante de la calle — todos viajan en `movers`) y se
        //  cierran solas al separarse. Un solo state, speed del catálogo.
        if (portalLeaves.length > 0 && portalDoorX !== 0) {
          const pd = loc.portalDoors;
          let near = false;
          for (const mv of openers) {
            if (
              Math.abs(mv.x - portalDoorX) < pd.openAhead &&
              Math.abs(mv.z - portalDoorZ) < pd.openAhead + 0.6 &&
              mv.y < v.cellH * 0.6
            ) {
              near = true;
              break;
            }
          }
          const target = near ? 1 : 0;
          if (portalOpen !== target) {
            portalOpen += Math.sign(target - portalOpen) * Math.min(Math.abs(target - portalOpen), dt / Math.max(0.05, pd.openSeconds));
            for (const leaf of portalLeaves) {
              leaf.mesh.position.x = leaf.baseX + leaf.dir * pd.slide * portalOpen;
            }
          }
        }
        for (const d of stairDoors) {
          let near = false;
          for (const mv of openers) {
            if (
              Math.abs(mv.x - d.doorX) < 0.85 &&
              Math.abs(mv.z - d.doorZ) < stF.openAhead &&
              Math.abs(mv.y - d.floorY) < v.cellH * 0.6
            ) {
              near = true;
              break;
            }
          }
          const next = d.openT + (near ? dt : -dt * 0.8) * stF.openSpeed;
          d.openT = Math.min(1, Math.max(0, next));
          if (d.openT !== (near ? 1 : 0) || d.hinge.rotation.y !== 0) {
            // Bisagras a la izquierda (vista pasillo = x mayor): girar +Y mete la hoja
            // hacia el interior del cubo; espejo para hinge 'right'.
            const sign = stF.hinge === 'left' ? 1 : -1;
            d.hinge.rotation.y = sign * stF.openAngle * d.openT;
          }
        }
        // v1.32 — PUERTAS DE LOS LOCALES (trastero común y sala de juntas): se abren al
        // acercarse cualquiera, con el mismo oficio que las de escalera (catálogo local).
        const hd = loc.hallDoors;
        if (hd?.enabled) {
          for (const d of hallDoors) {
            // v1.36 — la basculante del garaje se ANTICIPA más (catálogo): el interior se ve
            // desde que la puerta empieza a moverse, sin esperar a estar encima ni a entrar.
            const ahead = d.lift ? (hd.garageOpenAhead ?? hd.openAhead) : hd.openAhead;
            let near = false;
            for (const mv of openers) {
              if (
                Math.abs(mv.x - d.doorX) < 0.9 + (d.lift ? ahead - hd.openAhead : 0) &&
                Math.abs(mv.z - d.doorZ) < ahead &&
                Math.abs(mv.y - d.floorY) < v.cellH * 0.6
              ) {
                near = true;
                break;
              }
            }
            const secs = d.lift ? (hd.garageOpenSeconds ?? hd.openSeconds) : hd.openSeconds;
            const nextT = d.openT + (near ? dt : -dt * 0.8) / Math.max(0.05, secs);
            d.openT = Math.min(1, Math.max(0, nextT));
            // v1.34 — la basculante del garaje SE LEVANTA (rotación X hacia el techo); las
            // hojas batientes giran sobre su bisagra lateral como siempre.
            if (d.lift) {
              d.hinge.rotation.x = hd.liftAngle * d.openT;
              garajeLiftT = d.openT; // v1.35: alimenta el reveal del interior del garaje
            }
            // La bisagra izquierda suelta la hoja hacia dentro (+z) con −θ; la derecha, espejo.
            else d.hinge.rotation.y = -d.side * hd.openAngle * d.openT;
          }
        }
        // v1.35 — BOMBOS de la lavandería: las máquinas «en marcha» giran (deterministas).
        for (const dr of laundryDrums) dr.mesh.rotation.z += dr.speed * dt;
        if (al.enabled && stairLightMats.length > 0) {
          let busy = false;
          if (litWorld) {
            for (const mv of openers) {
              for (const fp of stairFootprints) {
                if (
                  mv.x >= fp.x0 &&
                  mv.x <= fp.x1 &&
                  mv.z > frontZ + 0.3 &&
                  mv.z < frontZ + v.commonDepth - 0.1 &&
                  Math.abs(mv.y - fp.floorY) < v.cellH * 0.6
                ) {
                  busy = true;
                  break;
                }
              }
              if (busy) break;
            }
          }
          const next = stairLightLevel + (busy ? dt : -dt) / Math.max(0.4, al.fade);
          stairLightLevel = Math.min(1, Math.max(0, next));
          const lc = Color3.FromHexString(al.color);
          // Bombillas del arte glTF + AUTOILUMINACIÓN del propio cubo (v1.25): con alguien
          // en las escaleras de noche, muros/forjados/tramos brillan un poco — el efecto
          // pedido: "zonas más claras con algo de autoiluminación, como los interiores".
          for (const { mat: lm } of stairLightMats) lm.emissiveColor = lc.scale(al.glow * stairLightLevel);
          const wg = al.wallGlow ?? 0;
          if (wg > 0) {
            stairWallGlow.copyFromFloats(lc.r * wg * stairLightLevel, lc.g * wg * stairLightLevel, lc.b * wg * stairLightLevel);
            for (const { mat: wm } of stairWallMats) wm.emissiveColor = stairWallGlow;
          }
        }
        for (const [blockId, interior] of interiors) {
          let lit = false;
          if (litWorld && occSet.has(blockId)) {
            lit = true;
            for (const r of Object.values(world.residents)) {
              if (r.present && r.location === blockId && r.activity === 'sleep') {
                lit = false;
                break;
              }
            }
          }
          for (const lamp of interior.lamps) {
            lamp.mesh.setEnabled(lit);
            if (lit) lamp.mat.emissiveColor = nightLampLit;
          }
          for (const f of interior.floors) f.mat.emissiveColor = lit ? nightFloorGlow : nightDark;
          // Diorama (v1.23): el arte ilustrado sigue la misma luz que suelos y lámparas.
          for (const m of interior.dioMats) m.emissiveColor = lit ? nightDioGlow : nightDark;
        }
      }
      // CARTELES GUÍA (v1.19): visibles solo con el jugador dentro del bloque de trasteros;
      // texto = los trasteros que tienes a cada lado según la profundidad del pasillo.
      const sgG = colBlocks.length > 0 ? storageGeomOf(v) : null;
      for (const [blkId, sign] of guideSigns) {
        const active = !!pos && pos.insideBlock === blkId && !!sgG;
        const plate = scene.getMeshByName(`${blkId}_guia`);
        const frame = scene.getMeshByName(`${blkId}_guia_marco`);
        plate?.setEnabled(active);
        frame?.setEnabled(active);
        if (!active || !sgG) continue;
        const localZ = pos!.z; // en modo 'inside' de trasteros, z es profundidad local
        const usable = sgG.depth - 2 * sgG.wallT;
        const perSide = new Map<string, number>();
        for (const u of sign.plan) perSide.set(u.side, (perSide.get(u.side) ?? 0) + 1);
        const labelOf = (side: 'left' | 'right'): string => {
          const count = perSide.get(side) ?? 0;
          if (count === 0) return tr.emptyLabel;
          const idx = Math.max(0, Math.min(count - 1, Math.floor((localZ - sgG.wallT) / (usable / count))));
          const unit = sign.plan.find((u) => u.side === side && u.index === idx);
          return unit ? blockLabel(`blk_p${unit.floor}_${sign.ownTag}`) : tr.emptyLabel;
        };
        const left = labelOf('left');
        const right = labelOf('right');
        const key = `${left}|${right}`;
        if (sign.last !== key) {
          sign.last = key;
          const ctx = sign.tex.getContext() as unknown as CanvasRenderingContext2D;
          ctx.fillStyle = tr.guide.bg;
          ctx.fillRect(0, 0, 256, 60);
          ctx.font = 'bold 30px Arial, sans-serif';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = tr.guide.text;
          ctx.textAlign = 'left';
          ctx.fillText('◀', 10, 32);
          ctx.textAlign = 'center';
          const ownLeft = left.includes(sign.ownTag.toUpperCase());
          const ownRight = right.includes(sign.ownTag.toUpperCase());
          ctx.fillStyle = ownLeft ? tr.ownBg : tr.guide.text;
          ctx.fillText((ownLeft ? '★ ' : '') + left, 88, 32);
          ctx.fillStyle = ownRight ? tr.ownBg : tr.guide.text;
          ctx.fillText((ownRight ? '★ ' : '') + right, 176, 32);
          ctx.fillStyle = tr.guide.text;
          ctx.textAlign = 'right';
          ctx.fillText('▶', 248, 32);
          sign.tex.update(true);
        }
      }
      // FACHADA DE TRASTERO (v1.21): mientras el jugador camina el pasillo central de un
      // bloque, su fachada se desvanece (corte de muñecas) y la cámara frontal ve TODO el
      // pasillo hasta el fondo. Al salir, la fachada vuelve. Fundido del catálogo.
      for (const [blkId, parts] of storageFacades) {
        // v1.41 — en vista FACHADA las fachadas de trasteros NUNCA se desvanecen (todo cerrado).
        const target = fachadaView ? 1 : pos && pos.insideBlock === blkId ? 0 : 1;
        let alpha = facadeAlphas.get(blkId) ?? 1;
        if (alpha !== target) {
          alpha += Math.sign(target - alpha) * Math.min(Math.abs(target - alpha), dt / Math.max(0.05, v.rearBlock.fadeSeconds));
          if (Math.abs(target - alpha) < 0.01) alpha = target;
          facadeAlphas.set(blkId, alpha);
          for (const m of parts) {
            m.visibility = alpha;
            m.setEnabled(alpha > 0.02);
          }
        }
      }
      // APILAMIENTO 3D (v1.19): avanzar los fundidos de los bloques traseros.
      for (const r of rears.values()) {
        // v1.41 — en vista FACHADA el edificio se ve ENTERO: los fundidos del apilamiento
        // se quedan en reposo (principal visible, trasero oculto).
        const mainT = fachadaView ? 1 : r.phase === 'inside' ? 0 : 1;
        const rearT = fachadaView ? 0 : r.phase === 'idle' ? 0 : 1;
        // v1.20: la PARED DIVISORIA del bloque trasero desaparece al entrar (fase 'inside').
        // Se evalúa SIEMPRE (incluso con los fundidos ya asentados): es un cambio de fase,
        // no de alpha — el early-continue de abajo no la vería.
        const frontOpen = r.phase === 'inside' && !fachadaView;
        for (const f of r.frontParts) f.setEnabled(!frontOpen);
        if (r.settled && r.mainAlpha === mainT && r.rearAlpha === rearT) continue;
        const mRate = dt / Math.max(0.05, rb.fadeSeconds);
        const rRate = dt / Math.max(0.05, rb.peekSeconds);
        r.mainAlpha += Math.sign(mainT - r.mainAlpha) * Math.min(Math.abs(mainT - r.mainAlpha), mRate);
        r.rearAlpha += Math.sign(rearT - r.rearAlpha) * Math.min(Math.abs(rearT - r.rearAlpha), rRate);
        r.settled = r.mainAlpha === mainT && r.rearAlpha === rearT;
        const mainKids = r.mainRoot.getChildMeshes();
        for (const k of mainKids) k.visibility = r.mainAlpha;
        r.mainRoot.setEnabled(r.mainAlpha > 0.002);
        const rearKids = r.node.getChildMeshes();
        for (const k of rearKids) k.visibility = r.rearAlpha;
        r.node.setEnabled(r.rearAlpha > 0.002);
        for (const o of r.outline) o.setEnabled(r.mainAlpha < 0.55 && r.rearAlpha > 0.4);
        if (r.doorLeaf) r.doorLeaf.setEnabled(r.rearAlpha < 0.2);
      }
      for (const [id, left] of shakes) {
        const view = views.get(id)!;
        const t = left - dt;
        if (t <= 0) {
          shakes.delete(id);
          view.lock?.position.set(view.lockBase.x, view.lockBase.y, view.lock.position.z);
        } else {
          shakes.set(id, t);
          view.lock?.position.set(view.lockBase.x + Math.sin(t * 60) * 0.06, view.lockBase.y, view.lock.position.z);
        }
      }
      // LOD SIEMPRE al final del frame: con foco aplica el nivel efectivo por bloque,
      // sin foco restaura edges/emissive/paneles al estado completo.
      applyLod(focus ?? null);
    },
  };
}
