import type { Color3, Color4, DynamicTexture, Mesh, Scene, StandardMaterial, TransformNode } from '@babylonjs/core';
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
  /** v1.24: decoración de la puerta de privacidad (marco + aplique) — se activa junto a view.door. */
  doorDecor: Mesh[];
  /** v1.25: color FIJO de la vivienda (pared gris clarito) — el tintado de estado no la repinta;
   *  el emissive de canales (ruido/agua) sigue funcionando. null = tintado clásico. */
  fixedDiffuse: Color3 | null;
}

/** Interior 2D de una vivienda (Fase C): suelo por estancia + tapa de puerta hacia estancia cerrada. */
interface InteriorView {
  /** Suelo tintado por estancia (color del catálogo; lockedColor si está cerrada). */
  floors: { roomKey: string; defId: string; mesh: Mesh; mat: StandardMaterial }[];
  /** Tapas de los huecos de puerta que llevan a una estancia cerrada ("en obras"). */
  covers: { mesh: Mesh; rooms: [string, string] }[];
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
  /** Interiores 2D (Fase C) por bloque: suelos de estancia y tapas de puertas cerradas. */
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
  /** Texturas de puerta cacheadas por fichero (v1.24→v1.25): FULL-BLEED de verdad. El arte
   *  llega con pared/suelo cocinados alrededor de la hoja: flood-fill contra los colores de
   *  las esquinas (stripCorners) + recorte a la caja del contenido (alphaBoundsOf) → la
   *  textura ES la hoja y desaparecen los elementos antiguos que se veían alrededor. */
  const doorArtCache = new Map<string, DynamicTexture>();
  const doorArtTex = (sc: Scene, file: string): DynamicTexture => {
    const hit = doorArtCache.get(file);
    if (hit) return hit;
    const dt = new (B().DynamicTexture)(`puerta_tex_${doorArtCache.size}`, { width: 384, height: 768 }, sc, true);
    doorArtCache.set(file, dt);
    const img = new Image();
    img.onload = () => {
      const big = document.createElement('canvas');
      big.width = img.naturalWidth;
      big.height = img.naturalHeight;
      const bx = big.getContext('2d', { willReadFrequently: true });
      if (!bx) return;
      bx.drawImage(img, 0, 0);
      stripCorners(big, 0.14);
      const b = alphaBoundsOf(big);
      const dctx = dt.getContext() as unknown as CanvasRenderingContext2D;
      dctx.clearRect(0, 0, 384, 768);
      if (b) dctx.drawImage(big, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 0, 0, 384, 768);
      else dctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, 384, 768);
      dt.update(true);
    };
    img.src = file;
    return dt;
  };
  /** Candado DIBUJADO (v1.25): silueta real de candado en un DynamicTexture — nada de cajas
   *  3D. Colores del catálogo (lockColor); grillete de acero fijo. MISMO PATRÓN que los
   *  sprites del diorama: se recorta el quad a la caja del contenido (alphaBounds) — el
   *  canvas subido no puede confiar en el alpha fuera del contenido (fondo a negro). */
  let lockTex: DynamicTexture | null = null;
  let lockTexAr = 0.8;
  const padlockTex = (): DynamicTexture => {
    if (lockTex) return lockTex;
    const dt = new (B().DynamicTexture)('candado_tex', { width: 128, height: 128 }, scene, true);
    dt.hasAlpha = true;
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return dt;
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
    // Recorte a la caja del contenido (patrón diorama) + volcado a la textura cuadrada.
    const b = alphaBoundsOf(c);
    const dctx = dt.getContext() as unknown as CanvasRenderingContext2D;
    dctx.clearRect(0, 0, 128, 128);
    if (b) {
      const bw = Math.max(1, b.x1 - b.x0);
      const bh = Math.max(1, b.y1 - b.y0);
      lockTexAr = bw / bh;
      dctx.drawImage(c, b.x0, b.y0, bw, bh, 0, 0, 128, 128);
    } else {
      dctx.drawImage(c, 0, 0);
    }
    dt.update(true);
    lockTex = dt;
    return dt;
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
    };
    const root = new TransformNode(`${b.id}_root`, scene);
    roots.set(b.id, root);
    if (b.layer === 'corridor') {
      // Pasillo exterior (data-driven): tira transitable saliente hacia la calle, con el borde
      // trasero a ras de fachada (frontZ) y barandilla baja en el borde exterior — sitio de
      // sobra para que los personajes se crucen o charlen sin bailar el vacío.
      const d = v.corridorDepth;
      view.greybox.push(box(b.id, b.size.w * v.cellW, v.slab * 2, d, cx, bottom + v.slab, frontZ - d / 2, m));
      if (v.corridorRail > 0) {
        view.greybox.push(
          box(`${b.id}_barandilla`, b.size.w * v.cellW, v.corridorRail, v.wall, cx, bottom + v.slab * 2 + v.corridorRail / 2, frontZ - d, m),
        );
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
      if (rearDoor) {
        const gapA = Math.max(x0w, x0w + rearDoor.at - rearDoor.width / 2);
        const gapB = Math.min(x1w, x0w + rearDoor.at + rearDoor.width / 2);
        const doorH = Math.min(h - 0.15, 1.95);
        const lintelH = h - doorH;
        view.edgesMesh = box(`${b.id}_fondo_i`, gapA - x0w, h, v.wall, (x0w + gapA) / 2, y, frontZ + d, m);
        view.edgesMesh2 = box(`${b.id}_fondo_d`, x1w - gapB, h, v.wall, (gapB + x1w) / 2, y, frontZ + d, m);
        view.greybox.push(
          view.edgesMesh,
          view.edgesMesh2,
          box(`${b.id}_fondo_dintel`, gapB - gapA, lintelH, v.wall, (gapA + gapB) / 2, y + h / 2 - lintelH / 2, frontZ + d, m),
          box(`${b.id}_izq`, v.wall, h, d, cx - w / 2, y, cz, m),
          box(`${b.id}_der`, v.wall, h, d, cx + w / 2, y, cz, m),
          box(`${b.id}_suelo`, w, v.wall, d, cx, bottom + v.slab + v.wall / 2, cz, m),
          box(`${b.id}_techo`, w, v.wall, d, cx, bottom + v.cellH - v.slab - v.wall / 2, cz, m),
        );
      } else {
        view.edgesMesh = box(`${b.id}_fondo`, w, h, v.wall, cx, y, frontZ + d, m);
        view.greybox.push(
          view.edgesMesh,
          box(`${b.id}_izq`, v.wall, h, d, cx - w / 2, y, cz, m),
          box(`${b.id}_der`, v.wall, h, d, cx + w / 2, y, cz, m),
          box(`${b.id}_suelo`, w, v.wall, d, cx, bottom + v.slab + v.wall / 2, cz, m),
          box(`${b.id}_techo`, w, v.wall, d, cx, bottom + v.cellH - v.slab - v.wall / 2, cz, m),
        );
      }
      view.front = box(`${b.id}_puerta`, w, h, v.wall, cx, y, frontZ, m);
      // ── ZÓCALO (v1.25): banda gris de ~25 cm desde el suelo. Continúa en el MARCO de la
      //  puerta (mismo material): la pieza que perimetra la puerta es del color del zócalo.
      const skH = pv.skirtingH ?? 0.25;
      const skMat = mat(`${b.id}_zocalo_mat`);
      skMat.diffuseColor = Color3.FromHexString(pv.skirtingColor ?? '#a3a19b');
      skMat.specularColor = new Color3(0.02, 0.02, 0.02);
      const ySk = bottom + v.slab + v.wall + skH / 2;
      view.greybox.push(
        attach(b.id, box(`${b.id}_zocalo_frente`, w, skH, v.wall + 0.02, cx, ySk, frontZ, skMat)),
        attach(b.id, box(`${b.id}_zocalo_izq`, v.wall + 0.02, skH, d - 2 * v.wall, cx - w / 2 + v.wall / 2, ySk, cz, skMat)),
        attach(b.id, box(`${b.id}_zocalo_der`, v.wall + 0.02, skH, d - 2 * v.wall, cx + w / 2 - v.wall / 2, ySk, cz, skMat)),
      );
      // Candado DIBUJADO (v1.25): quad con silueta real de candado — los candados en forma
      // de caja desaparecen. Cuelga de la puerta de privacidad y sigue sacudiéndose.
      const lh = pv.lockH ?? 0.28;
      const lw = lh * Math.max(0.5, Math.min(1.2, lockTexAr));
      const lockMat = mat(`${b.id}_candado_mat`);
      lockMat.diffuseTexture = padlockTex();
      lockMat.emissiveColor = Color3.FromHexString(v.lockColor).scale(0.22);
      lockMat.specularColor = new Color3(0, 0, 0);
      lockMat.transparencyMode = 2;
      lockMat.alphaCutOff = 0.35;
      view.lock = MeshBuilder.CreatePlane(`${b.id}_candado`, { width: lw, height: lh }, scene);
      view.lock.material = lockMat;
      view.lock.isPickable = false;
      view.lock.position.set(cx - pv.doorW / 2 - 0.32, view.lockBase.y, frontZ - v.wall / 2 - 0.07);
      view.lock.setEnabled(false);

      // ── Privacidad (v1.24): la puerta es un PLANO con arte real (full-bleed), marco 3D
      // pequeño del color de la puerta que SÍ contornea la hoja, y un aplique de luz a un
      // lado (brilla de noche). La placa numerada sube POR ENCIMA del marco (sin taparse).
      // Se activan/desactivan cada frame según haya alguien dentro (propietario, visita…
      // o un ladrón); medidas y colores del catálogo (rules.view.privacy).
      const doorZ = frontZ - v.wall / 2 - 0.035;
      view.door = MeshBuilder.CreatePlane(`${b.id}_puerta_priv`, { width: pv.doorW, height: pv.doorH }, scene);
      view.door.position.set(cx, bottom + v.slab + v.wall + pv.doorH / 2, doorZ);
      const doorMat = mat(`${b.id}_puerta_priv_mat`);
      doorMat.specularColor = new Color3(0, 0, 0);
      // Arte: una variante por hash del id (3 puertas del catálogo); textura cacheada por fichero.
      const artFile = pv.doorArts?.length ? pv.doorArts[Math.floor(hash01(b.id, 3) * pv.doorArts.length) % pv.doorArts.length]! : null;
      if (artFile) doorMat.diffuseTexture = doorArtTex(scene, artFile);
      else doorMat.diffuseColor = Color3.FromHexString(pv.doorColor);
      view.door.material = doorMat;
      view.door.isPickable = false;
      view.door.setEnabled(false);
      // Marco pequeño DEL COLOR DEL ZÓCALO (v1.25: continuidad del zócalo — antes, del color
      // de la puerta): dos jambas + dintel ABRAZANDO la hoja.
      const fw = pv.frameW ?? 0.075;
      const fd = pv.frameDepth ?? 0.1;
      const frameMat = mat(`${b.id}_marco_puerta_mat`);
      frameMat.diffuseColor = Color3.FromHexString(pv.skirtingColor ?? '#a3a19b');
      frameMat.specularColor = new Color3(0.03, 0.03, 0.03);
      const fz = frontZ - v.wall / 2 - 0.045;
      const jambL = box(`${b.id}_marco_izq`, fw, pv.doorH + fw * 2, fd, cx - pv.doorW / 2 - fw / 2, bottom + v.slab + v.wall + pv.doorH / 2, fz, frameMat);
      const jambR = box(`${b.id}_marco_der`, fw, pv.doorH + fw * 2, fd, cx + pv.doorW / 2 + fw / 2, bottom + v.slab + v.wall + pv.doorH / 2, fz, frameMat);
      const lintel = box(`${b.id}_marco_sup`, pv.doorW + fw * 2, fw, fd, cx, bottom + v.slab + v.wall + pv.doorH + fw / 2, fz, frameMat);
      for (const j of [jambL, jambR, lintel]) {
        j.isPickable = false;
        j.setEnabled(false);
        view.doorDecor.push(j);
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

      // ── Interior 2D (Fase C): tabiques con huecos, suelo por estancia y tapas "en obras". ──
      // TODO sale del layout del catálogo (rects + doorways); sin rects no hay interior 2D.
      const layoutId = content.blocks[b.defId]?.container?.layout;
      const layout = layoutId ? content.layouts[layoutId] : undefined;
      // Apilamiento 3D (v1.19): las salas TRASERAS no se pintan en el bloque principal — viven
      // en su propio bloque trasero (más abajo, se activan al entrar).
      const geoRooms = (layout?.rooms ?? []).filter((r) => r.rect !== undefined && r.rect!.z + r.rect!.d <= v.depth + 0.01);
      if (geoRooms.length > 0 && layout) {
        const interior: InteriorView = { floors: [], covers: [], lamps: [], dio: newDioramaSet(), dioMats: [], dioRoot: null };
        const x0 = b.cell.col * v.cellW;
        const wallH = v.cellH - 2 * v.slab - 2 * v.wall;
        const partMat = mat(`${b.id}_tabique_mat`);
        partMat.diffuseColor = Color3.FromHexString('#d8d2c4');
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
        // Tabiques: para cada par de estancias que comparten borde, pared entre ambas.
        // Los doorways del catálogo recortan el hueco (y añaden tapa visible si alguna de las
        // dos estancias está cerrada). Sin hueco declarado → tabique sólido (tampoco se puede
        // pasar: walkable() exige doorway). Tabiques según X a media altura para no tapar la vista.
        const eps = 0.01;
        const seg = (a: number, b: number, along: 'x' | 'z', at: number, height: number, yC: number, name: string) => {
          const len = b - a;
          if (len <= 0.01) return;
          view.greybox.push(
            along === 'z'
              ? box(name, v.wall, height, len, at, yC, (a + b) / 2, partMat)
              : box(name, len, height, v.wall, (a + b) / 2, yC, at, partMat),
          );
        };
        geoRooms.forEach((lr, i) => {
          geoRooms.forEach((other, j) => {
            if (j <= i) return;
            const ra = lr.rect!;
            const rb = other.rect!;
            const door = (layout.doorways ?? []).find(
              (dw) => (dw.a === lr.key && dw.b === other.key) || (dw.a === other.key && dw.b === lr.key),
            );
            // v1.25 — SIN TABIQUES en el interior: si el par comparte puerta (los layouts
            // abiertos declaran huecos de borde completo) no se levanta NINGÚN muro: libertad
            // de movimientos total. Sin hueco declarado sigue habiendo pared (el walkable()
            // del catálogo lo prohíbe: una sola verdad).
            // Borde vertical compartido → tabique que corre según Z (se cruza andando en X).
            const touchX = Math.abs(ra.x + ra.w - rb.x) < eps || Math.abs(rb.x + rb.w - ra.x) < eps;
            const overlapZ = Math.min(ra.z + ra.d, rb.z + rb.d) - Math.max(ra.z, rb.z);
            if (touchX && overlapZ > eps) {
              const wx = x0 + Math.max(ra.x, rb.x);
              const z0 = frontZ + Math.max(ra.z, rb.z);
              const z1 = frontZ + Math.min(ra.z + ra.d, rb.z + rb.d);
              const yC = bottom + v.slab + v.wall + wallH / 2;
              if (door && door.axis === 'z') {
                // Tapa de puerta ESTRECHA (v1.25): un panel del ancho de una HOJA (no toda
                // la pared — antes leía como tabique). Solo visible con la estancia cerrada.
                const coverW = Math.min(overlapZ, pv.doorW * 1.15);
                const cAt = Math.min(z1 - coverW / 2, Math.max(z0 + coverW / 2, frontZ + door.at));
                const cover = attach(b.id, box(`${b.id}_tapa_${i}_${j}`, v.wall * 0.8, wallH, coverW, wx, yC, cAt, mat(`${b.id}_tapa_${i}_${j}_mat`)));
                (cover.material as StandardMaterial).diffuseColor = Color3.FromHexString(v.lockedColor);
                cover.setEnabled(false);
                interior.covers.push({ mesh: cover, rooms: [lr.key, other.key] });
              } else if (!door) {
                seg(z0, z1, 'z', wx, wallH, yC, `${b.id}_tab_${i}_${j}`);
              }
            }
            // Borde horizontal compartido → tabique que corre según X (se cruza andando en Z).
            const touchZ = Math.abs(ra.z + ra.d - rb.z) < eps || Math.abs(rb.z + rb.d - ra.z) < eps;
            const overlapX = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
            if (touchZ && overlapX > eps) {
              const wz = frontZ + Math.max(ra.z, rb.z);
              const xa = x0 + Math.max(ra.x, rb.x);
              const xb = x0 + Math.min(ra.x + ra.w, rb.x + rb.w);
              const halfH = wallH * 0.45;
              const yHalf = bottom + v.slab + v.wall + halfH / 2;
              if (door && door.axis === 'x') {
                const coverW = Math.min(overlapX, pv.doorW * 1.15);
                const cAt = Math.min(xb - coverW / 2, Math.max(xa + coverW / 2, x0 + door.at));
                const cover = attach(b.id, box(`${b.id}_tapa_${i}_${j}`, coverW, halfH, v.wall * 0.8, cAt, yHalf, wz, mat(`${b.id}_tapa_${i}_${j}_mat`)));
                (cover.material as StandardMaterial).diffuseColor = Color3.FromHexString(v.lockedColor);
                cover.setEnabled(false);
                interior.covers.push({ mesh: cover, rooms: [lr.key, other.key] });
              } else if (!door) {
                seg(xa, xb, 'x', wz, halfH, yHalf, `${b.id}_tab_${i}_${j}`);
              }
            }
          });
        });
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
    } else {
      view.greybox.push(box(b.id, w, h, d, cx, bottom + v.cellH / 2, cz, m));
    }
    // v1.19: toda malla estructural del bloque cuelga de su raíz (swap de bloques).
    for (const mesh of view.greybox) mesh.parent = root;
    if (view.front) view.front.parent = root;
    if (view.lock) view.lock.parent = root;
    if (view.door) view.door.parent = root;
    if (view.handle) view.handle.parent = root;
    views.set(b.id, view);
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
    /** Textura de la hoja por PLANTA: arte de zonas comunes + gran número centrado.
     *  v1.25: full-bleed REAL — flood-fill contra las esquinas (stripCorners) y recorte a la
     *  caja de la hoja: nada de pared/suelo cocinados alrededor. */
    const stairDoorTexCache = new Map<number, DynamicTexture>();
    const stairDoorTex = (art: string, numberColor: string, floor: number): DynamicTexture => {
      const hit = stairDoorTexCache.get(floor);
      if (hit) return hit;
      const dt = new (B().DynamicTexture)(`puerta_esc_${floor}_tex`, { width: 384, height: 768 }, scene, true);
      stairDoorTexCache.set(floor, dt);
      const img = new Image();
      img.onload = () => {
        const big = document.createElement('canvas');
        big.width = img.naturalWidth;
        big.height = img.naturalHeight;
        const bx = big.getContext('2d', { willReadFrequently: true });
        if (!bx) return;
        bx.drawImage(img, 0, 0);
        stripCorners(big, 0.14);
        const b = alphaBoundsOf(big);
        const c = document.createElement('canvas');
        c.width = 384;
        c.height = 768;
        const cctx = c.getContext('2d');
        if (!cctx) return;
        if (b) cctx.drawImage(big, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, 0, 0, 384, 768);
        else cctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, 384, 768);
        // Gran número de planta, centrado en la hoja (vinculado a la puerta: bascula con ella).
        cctx.font = 'bold 230px Arial, sans-serif';
        cctx.textAlign = 'center';
        cctx.textBaseline = 'middle';
        cctx.fillStyle = numberColor;
        cctx.fillText(String(floor), 192, 384);
        const dctx = dt.getContext() as unknown as CanvasRenderingContext2D;
        dctx.clearRect(0, 0, 384, 768);
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
      const hFull = v.cellH - v.gapH;
      const dL = doorX - stF.doorW / 2;
      const dR = doorX + stF.doorW / 2;
      const dTop = y0 + stF.doorBottom + stF.doorH;
      const wallSeg = (x0: number, x1: number, yA: number, yB: number): void => {
        if (x1 - x0 < 0.02 || yB - yA < 0.02) return;
        attach(b.id, box(`${b.id}_fachada_${x0.toFixed(2)}_${yA.toFixed(2)}`, x1 - x0, yB - yA, stF.wallT, (x0 + x1) / 2, yA + (yB - yA) / 2, zF, wallMat));
      };
      wallSeg(Math.max(left, dL - stF.halfW), dL, y0, y0 + hFull);
      wallSeg(dR, Math.min(right, dR + stF.halfW), y0, y0 + hFull);
      wallSeg(dL, dR, dTop, y0 + hFull);
      // Hoja: bisagras en el lado izquierdo VISTO desde el pasillo (= x mayor mirando +z).
      const hingeAtRightX = stF.hinge === 'left';
      const hinge = new TransformNode(`${b.id}_puerta_hinge`, scene);
      hinge.position.set(hingeAtRightX ? dR : dL, y0 + stF.doorBottom, zF);
      hinge.parent = roots.get(b.id) ?? null;
      const leaf = MeshBuilder.CreatePlane(`${b.id}_puerta_hoja`, { width: stF.doorW, height: stF.doorH }, scene);
      const leafMat = new StandardMaterial(`${b.id}_puerta_hoja_mat`, scene);
      leafMat.diffuseTexture = stairDoorTex(stF.art, stF.numberColor, b.cell.floor);
      leafMat.emissiveColor = new Color3(0.16, 0.16, 0.16); // legible en fachada norte
      leafMat.specularColor = new Color3(0, 0, 0);
      leaf.material = leafMat;
      leaf.isPickable = false;
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
        const hideList = [
          ...(v.privacy.hideNodes ?? []),
          ...(content.blocks[b.defId]!.features?.stairs === true ? (v.stairs.facade.hideNodes ?? []) : []),
        ];
        for (const nodeName of hideList) {
          for (const child of model.root.getChildren()) {
            if (child.name === nodeName || child.name.endsWith(nodeName)) child.setEnabled(false);
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
  const tr = v.trasteros;
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

  // ── Macetas de pasillo (v1.16→v1.25): reparto aleatorio DETERMINISTA por hash del id del
  // pasillo (jamás nextRandom del sim): cantidad entre perFloorMin..perFloorMax, lado (fachada
  // o barandilla), tamaño y especie salen del catálogo (rules.view.pots). Nunca sobre la línea
  // de paseo (corridorZ): se pegan a fachada o barandilla para no invadir el tránsito.
  // v1.25: las plantas son RECORTEs billboard (quads con recorte alpha dibujados a canvas —
  // maceta + hojas, colores del catálogo): estética idéntica a los dioramas/árboles, adiós
  // cilindros. Sin arte declarado se mantienen los cilindros de siempre.
  const pt = v.pots;
  /** Textura de planta de pasillo dibujada a canvas (2 especies del catálogo).
   *  PATRÓN DIORAMA: se recorta al contenido (alphaBounds) — el quad solo contiene
   *  arte, jamás fondo transparente (el canvas subido pinta el alpha sobrante a negro). */
  const plantTexCache = new Map<number, { dt: DynamicTexture; ar: number }>();
  const plantTex = (species: number): { dt: DynamicTexture; ar: number } => {
    const hit = plantTexCache.get(species);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 200;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const dt = new (B().DynamicTexture)(`maceta_tex_${species}`, { width: 160, height: 200 }, scene, true);
    dt.hasAlpha = true;
    if (ctx) {
      ctx.clearRect(0, 0, 160, 200);
      const leaf = species === 0 ? pt.plantColor : pt.plant2Color;
      const leafDark = Color3.FromHexString(leaf).scale(0.78).toHexString();
      // Maceta trapecio + borde.
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
      // Tierra.
      ctx.fillStyle = pt.soilColor;
      ctx.beginPath();
      ctx.ellipse(80, 148, 34, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      // Hojas: abanico de elipses (especie 0 = espadas altas; especie 1 = mata redonda).
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
      // Recorte a la caja del contenido + volcado (el quad queda limpio de fondo).
      const b = alphaBoundsOf(c);
      const dctx = dt.getContext() as unknown as CanvasRenderingContext2D;
      dctx.clearRect(0, 0, 160, 200);
      let ar = 160 / 200;
      if (b) {
        const bw = Math.max(1, b.x1 - b.x0);
        const bh = Math.max(1, b.y1 - b.y0);
        ar = bw / bh;
        dctx.drawImage(c, b.x0, b.y0, bw, bh, 0, 0, 160, 200);
      } else {
        dctx.drawImage(c, 0, 0);
      }
      dt.update(true);
      const entry = { dt, ar };
      plantTexCache.set(species, entry);
      return entry;
    }
    const entry = { dt, ar: 160 / 200 };
    plantTexCache.set(species, entry);
    return entry;
  };
  for (const b of Object.values(world.blocks)) {
    if (b.layer !== 'corridor') continue;
    const ySlab = b.cell.floor * v.cellH + v.slab * 2;
    const n = pt.perFloorMin + Math.floor(hash01(b.id, 101) * (pt.perFloorMax - pt.perFloorMin + 1));
    for (let i = 0; i < n; i++) {
      const x = b.cell.col * v.cellW + 1.6 + hash01(b.id, 200 + i) * (b.size.w * v.cellW - 3.2);
      const z = hash01(b.id, 300 + i) < 0.5 ? frontZ - 0.18 : frontZ - v.corridorDepth + 0.2;
      const s = 0.85 + hash01(b.id, 400 + i) * 0.3;
      const species = hash01(b.id, 600 + i) < 0.5 ? 0 : 1;
      {
        // v1.25: recorte billboard (dibujado a canvas con los colores del catálogo).
        const h = (pt.artH ?? 0.62) * s;
        const art = plantTex(species);
        const wQ = h * art.ar;
        const pm = mat(`${b.id}_maceta_bill_${i}_mat`);
        pm.diffuseTexture = art.dt;
        pm.emissiveColor = Color3.FromHexString(pt.plantColor).scale(0.05);
        pm.specularColor = new Color3(0, 0, 0);
        pm.transparencyMode = 2;
        pm.alphaCutOff = 0.4;
        const q = attach(b.id, MeshBuilder.CreatePlane(`${b.id}_maceta_${i}`, { width: wQ, height: h }, scene));
        q.position.set(x, ySlab + h / 2, z);
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
          if (!cellHost) interiors.set(blk.id, { floors: [], covers: [], lamps: [], dio: host.dio, dioMats: host.dioMats, dioRoot: null });
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
    return occ;
  };

  /** Visibilidad efectiva de fachada/puerta/candado: candado solo si access='locked';
   *  fachada cerrada si está bloqueada O si la privacidad la cierra (nadie dentro).
   *  paint() la fija por el acceso y el LOD puede ocultarlos encima. */
  function applyPanels(view: BlockView, b: BlockInstance, occ?: Set<string>) {
    const locked = b.kind === 'dwelling' && b.access === 'locked';
    let privacyClosed = false;
    if (privacyOn && b.kind === 'dwelling') {
      const set = occ ?? computeOccupancy();
      privacyClosed = !set.has(b.id);
    }
    const wall = (locked || privacyClosed) && !view.lodHiddenPanels;
    view.front?.setEnabled(wall);
    view.door?.setEnabled(wall);
    view.handle?.setEnabled(wall);
    for (const d of view.doorDecor) d.setEnabled(wall);
    view.lock?.setEnabled(locked && !view.lodHiddenPanels);
    // Diorama (v1.23): visibilidad ESPEJO de la fachada — fachada cerrada = interior oculto,
    // fachada abierta = diorama a la vista (y cero draw calls de interiores tapados).
    const interior = interiors.get(b.id);
    if (interior?.dioRoot) interior.dioRoot.setEnabled(!wall);
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

  return {
    paint() {
      for (const b of Object.values(world.blocks)) {
        const view = views.get(b.id)!;
        applyTint(view, b);
        applyEmissive(view, b);
        applyPanels(view, b);
      }
      // Interiores 2D (Fase C): suelo de cada estancia según su acceso + tapas de puertas cerradas.
      for (const [blockId, interior] of interiors) {
        const block = world.blocks[blockId];
        if (!block) continue;
        for (const f of interior.floors) {
          const room = block.rooms.find((r) => r.key === f.roomKey);
          const locked = room ? room.access !== 'unlocked' : true;
          const hex = locked ? v.lockedColor : content.rooms[f.defId]?.view?.color ?? '#cccccc';
          f.mat.diffuseColor = Color3.FromHexString(hex);
        }
        for (const c of interior.covers) {
          const anyLocked = c.rooms.some((key) => block.rooms.find((r) => r.key === key)?.access !== 'unlocked');
          c.mesh.setEnabled(anyLocked);
        }
      }
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
    hasRear(blockId: string): boolean {
      return rears.has(blockId);
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
    update(dt: number, focus?: { x: number; floor: number }, inside?: string | null, pos?: { x: number; z: number; insideBlock: string | null }, env?: { daylight: number; movers?: { x: number; y: number; z: number }[] }) {
      if (focus) lastFocus = focus;
      if (inside !== undefined) playerInside = inside;
      // PRIVACIDAD (v1.17) cada frame: la fachada de una vivienda sin nadie dentro se cierra
      // con su puerta al pasillo y se abre en cuanto alguien entra (propietario, visita…
      // o un ladrón). Vive en update() y no en paint() para reaccionar incluso con el
      // mundo congelado (modal abierto) y sin esperar al siguiente tick.
      const occSet = computeOccupancy();
      if (privacyOn) {
        for (const b of Object.values(world.blocks)) {
          if (b.kind !== 'dwelling') continue;
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
        const al = v.stairs.activityLight;
        for (const d of stairDoors) {
          let near = false;
          for (const mv of movers) {
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
        if (al.enabled && stairLightMats.length > 0) {
          let busy = false;
          if (litWorld) {
            for (const mv of movers) {
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
        const target = pos && pos.insideBlock === blkId ? 0 : 1;
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
        const mainT = r.phase === 'inside' ? 0 : 1;
        const rearT = r.phase === 'idle' ? 0 : 1;
        // v1.20: la PARED DIVISORIA del bloque trasero desaparece al entrar (fase 'inside').
        // Se evalúa SIEMPRE (incluso con los fundidos ya asentados): es un cambio de fase,
        // no de alpha — el early-continue de abajo no la vería.
        const frontOpen = r.phase === 'inside';
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
