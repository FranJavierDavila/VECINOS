import type { Color3, DynamicTexture, Mesh, Scene, StandardMaterial, TransformNode } from '@babylonjs/core';
import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { B } from './babylon';
import type { BackdropDirector } from './backdrop';
import { alphaBoundsOf, stripWhite } from './diorama';
import { reportAssetFailure } from './assetHealth';

/**
 * ESCENA EXTERIOR (v1.20→v1.22) — decorado urbano a pie de calle, 100% del catálogo.
 *
 * rules.view.exterior.rows coloca TIRAS (acera, carretera, jardín, campo) alrededor del
 * edificio. v1.22 añade:
 *  · ORIENTACIÓN por fila ('x' calle paralela a fachada, 'z' aceras laterales y la calle
 *    transversal de la bifurcación) — el edificio queda RODEADO y sin desnudos.
 *  · BORDILLOS (curbColor/curbW): el empalme acera↔calzada queda limpio en las juntas.
 *  · PASO DE CEBRA (zebra): franjas perpendiculares al peatón frente al portal.
 *  · CARRETERA PRINCIPAL sin cortes: se prolonga hasta escapar por los laterales de
 *    pantalla, y la bifurcación (carretera_bifurcacion orient z) huye hacia la cámara.
 *  · DISPERSIÓN 2D con topes (gridScatter/maxTrees/maxBushes): jardines enormes salpicados
 *    sin disparar el número de mallas.
 *  · FUSIÓN DE MALLAS por material (FPS): bancos, farolas, árboles, rayas… se cocinan en
 *    UNA malla por material y grupo (estático siempre-visible vs mobiliario solo en vista
 *    "edificio"). Cientos de draw calls pasan a una decena.
 */

export interface ExteriorDirector {
  /** Las farolas siguen la hora del fondo; el resto es estático. dt en segundos. */
  update(dt: number): void;
  /** Mobiliario ON solo en vista "edificio" (v1.21): idempotente. */
  setPropsVisible(visible: boolean): void;
  /** v1.41 — bancos exteriores construidos (acera frontal): asientos del paseo vecinal. */
  benches(): { x: number; z: number }[];
  dispose(): void;
}

export function createExterior(scene: Scene, world: World, content: Content, backdrop: BackdropDirector): ExteriorDirector {
  const { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode } = B();
  const cfg = content.rules.view.exterior;
  if (!cfg.enabled || cfg.rows.length === 0) {
    return { update() {}, setPropsVisible() {}, benches: () => [], dispose() {} };
  }
  const mats = new Map<string, StandardMaterial>();
  const root: Mesh[] = [];
  // v1.21: nodo del MOBILIARIO — todo lo que sea banco/farola/papelera/árbol/arbusto/flor
  // cuelga aquí y se apaga fuera de la vista "edificio" (menos draw calls y vista limpia).
  const propsNode = new TransformNode('calle_mobiliario', scene);
  let propsVisible = true;
  /** Materiales compartidos por hex (los colores se repiten MUCHO en la calle). */
  const matOf = (hex: string, name: string, emissive = 0): StandardMaterial => {
    const key = `${name}:${hex}`;
    let m = mats.get(key);
    if (!m) {
      m = new StandardMaterial(key, scene);
      m.diffuseColor = Color3.FromHexString(hex);
      m.specularColor = new Color3(0, 0, 0);
      if (emissive > 0) m.emissiveColor = Color3.FromHexString(hex).scale(emissive);
      mats.set(key, m);
    }
    return m;
  };

  // ── FUSIÓN POR MATERIAL (v1.22): las mallas se acumulan en estos cubos y al final se
  // cocinan en una sola por material. `estaticas` (cuerpos, bordillos, marcas) siempre
  // visible; `mobiliario` (bancos, farolas, vegetación) solo vista "edificio".
  const statics = new Map<string, Mesh[]>();
  const props = new Map<string, Mesh[]>();
  type Bucket = Map<string, Mesh[]>;
  const push = (bucket: Bucket, key: string, mesh: Mesh): void => {
    const arr = bucket.get(key);
    if (arr) arr.push(mesh);
    else bucket.set(key, [mesh]);
  };

  const box = (key: string, bucket: Bucket, w: number, h: number, d: number, x: number, y: number, z: number, m: StandardMaterial): Mesh => {
    const mesh = MeshBuilder.CreateBox(`${key}#${bucket.get(key)?.length ?? 0}`, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    mesh.isPickable = false;
    push(bucket, key, mesh);
    return mesh;
  };
  const cyl = (key: string, bucket: Bucket, dTop: number, dBot: number, h: number, x: number, y: number, z: number, m: StandardMaterial): Mesh => {
    const mesh = MeshBuilder.CreateCylinder(`${key}#${bucket.get(key)?.length ?? 0}`, { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: 12 }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    mesh.isPickable = false;
    push(bucket, key, mesh);
    return mesh;
  };
  const sphere = (key: string, bucket: Bucket, d: number, x: number, y: number, z: number, m: StandardMaterial): Mesh => {
    const mesh = MeshBuilder.CreateSphere(`${key}#${bucket.get(key)?.length ?? 0}`, { diameter: d, segments: 6 }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    mesh.isPickable = false;
    mesh.scaling.y = 0.82;
    push(bucket, key, mesh);
    return mesh;
  };

  // ── Árboles RECORTE 2D (v1.24): el catálogo declara PNGs recortados (treeArt) y cada
  // variante comparte UN material con ALPHATEST — los quads miran a cámara (yaw fijo como
  // el diorama) y se FUNDEN en una malla por arte: recorte bonito a coste cero de draw calls.
  // Sin catálogo de arte, fallback a las esferas 3D de siempre.
  const treeTexCache = new Map<string, { tex: DynamicTexture; ar: number }>();
  const treeTexOf = (file: string, tolerance: number, artW: number, artH: number): { tex: DynamicTexture; ar: number } | null => {
    const hit = treeTexCache.get(file);
    if (hit) return hit;
    const S = 512;
    const tex = new (B().DynamicTexture)(`arbol_tex_${treeTexCache.size}`, { width: S, height: S }, scene, true);
    tex.hasAlpha = true;
    const entry: { tex: DynamicTexture; ar: number } = { tex, ar: artW / artH };
    treeTexCache.set(file, entry);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = S;
      c.height = S;
      const cctx = c.getContext('2d', { willReadFrequently: true });
      if (!cctx) return;
      cctx.drawImage(img, 0, 0, S, S);
      stripWhite(c, '#ffffff', tolerance, 0.45);
      const b = alphaBoundsOf(c);
      if (b) {
        // ENCAJAR (contain) el contenido recortado en el canvas cuadrado, sin deformar:
        // el aspecto real lo da el quad del catálogo (w × h del treeArt).
        const bw = Math.max(1, b.x1 - b.x0);
        const bh = Math.max(1, b.y1 - b.y0);
        const k = Math.min(S / bw, S / bh);
        const dw = bw * k;
        const dh = bh * k;
        const dctx = tex.getContext() as unknown as CanvasRenderingContext2D;
        dctx.clearRect(0, 0, S, S);
        dctx.drawImage(c, b.x0, b.y0, bw, bh, (S - dw) / 2, (S - dh) / 2, dw, dh);
      }
      tex.update(true);
    };
    img.onerror = () => {
      console.warn(`exterior: arte de árbol no disponible (${file})`);
      reportAssetFailure(file);
    };
    img.src = file;
    return entry;
  };

  // ── Suelo del mundo: cierra el horizonte bajo todo el decorado. v1.21: NO se cuela tras
  // el edificio (backZ del catálogo) — más allá, cielo; el suelo no hace de muralla oscura
  // entre el edificio y las capas de fachadas del fondo. v1.24: backZ mayor — el prado
  // alcanza las capas del fondo (sin franja vacía detrás del edificio).
  const blocks = Object.values(world.blocks);
  const cx = (Math.max(...blocks.map((b) => b.cell.col + b.size.w)) * content.rules.view.cellW) / 2;
  const groundDepth = cfg.ground.size / 2 + cfg.ground.backZ;
  const ground = MeshBuilder.CreateGround('suelo_mundo', { width: cfg.ground.size, height: groundDepth }, scene);
  ground.position.set(cx, -0.02, (cfg.ground.backZ - cfg.ground.size / 2) / 2);
  ground.material = matOf(cfg.ground.color, 'suelo');
  ground.isPickable = false;

  // Farolas encendidas/apagadas: sus materiales emisivos se actualizan por frame.
  const lampMats: { mat: StandardMaterial; hex: string }[] = [];
  // v1.41 — bancos exteriores (asientos del paseo vecinal).
  const benchSpots: { x: number; z: number }[] = [];

  cfg.rows.forEach((row, ri) => {
    const def = content.blocks[row.defId];
    const ex = def?.exterior;
    if (!def || !ex) return; // fila desconocida: el validador ya avisó; el resto pinta igual
    const horizontal = row.orient === 'x';
    // Eje LARGO (u) y eje TRANSVERSAL (v): la misma geometría sirve a calles paralelas a
    // fachada (orient x) y a aceras/transversales de bifurcación (orient z).
    const u0 = horizontal ? row.x0 : row.z0;
    const uLen = horizontal ? row.x1 - row.x0 : row.depth;
    const v0 = horizontal ? row.z0 : row.x0;
    const vLen = horizontal ? row.depth : row.x1 - row.x0;
    const uCenter = u0 + uLen / 2;
    const vCenter = v0 + vLen / 2;
    // (u, v) → mundo: para orient z el eje largo corre por Z y el transversal por X.
    const at = (u: number, v: number): { x: number; z: number } => (horizontal ? { x: u, z: v } : { x: v, z: u });
    const boxRow = (key: string, bucket: Bucket, uLen2: number, h: number, vLen2: number, u: number, y: number, v: number, m: StandardMaterial): void => {
      const p = at(u, v);
      box(key, bucket, horizontal ? uLen2 : vLen2, h, horizontal ? vLen2 : uLen2, p.x, y, p.z, m);
    };

    // ── Cuerpo del bloque (bajo): color del catálogo; el jardín tapa con césped. ──
    if (row.body) {
      const bodyHex = ex.grassColor && ex.treesPer10m > 0 ? ex.grassColor : def.view.color;
      boxRow(`calle_${ri}_cuerpo`, statics, uLen, Math.max(0.02, ex.height), vLen, uCenter, ex.height / 2 - 0.02, vCenter, matOf(bodyHex, 'cuerpo'));
      // Bordillo: listón fino en AMBOS bordes largos (empalme correcto con lo de al lado).
      if (ex.curbColor && ex.curbW > 0) {
        const cm = matOf(ex.curbColor, 'bordillo');
        boxRow(`calle_${ri}_borde_a`, statics, uLen, ex.height + 0.06, ex.curbW, uCenter, (ex.height + 0.06) / 2 - 0.02, v0 + ex.curbW / 2, cm);
        boxRow(`calle_${ri}_borde_b`, statics, uLen, ex.height + 0.06, ex.curbW, uCenter, (ex.height + 0.06) / 2 - 0.02, v0 + vLen - ex.curbW / 2, cm);
      }
    }
    // ── Paso de cebra: franjas perpendiculares al peatón (largas en el eje del tráfico). ──
    if (ex.zebra) {
      const zm = matOf(ex.zebraColor, 'cebra');
      const pitch = ex.zebraStripeW + ex.zebraGap;
      const n = Math.max(1, Math.floor((vLen - ex.zebraGap) / pitch));
      for (let i = 0; i < n; i++) {
        const v = v0 + ex.zebraGap / 2 + ex.zebraStripeW / 2 + pitch * i;
        boxRow(`calle_${ri}_cebra`, statics, uLen * 0.86, 0.02, ex.zebraStripeW, uCenter, ex.height + 0.012, v, zm);
      }
    }
    // ── Carretera: línea discontinua al eje. ──
    if (ex.laneDash > 0) {
      const dash = ex.laneDash;
      const pitch = dash * 2.2;
      const n = Math.floor(uLen / pitch);
      for (let i = 0; i < n; i++) {
        const u = u0 + pitch * (i + 0.5);
        boxRow(`calle_${ri}_dash`, statics, dash, 0.015, 0.14, u, ex.height + 0.008, vCenter, matOf(ex.laneDashColor, 'dash'));
      }
    }
    // ── Acera: farolas + bancos + papeleras, reparto determinista por hash. ──
    if (ex.lampEvery > 0) {
      const n = Math.floor(uLen / ex.lampEvery);
      for (let i = 0; i < n; i++) {
        const u = u0 + ex.lampEvery * (i + 0.5) + (hash01(`lamp${ri}`, i) - 0.5) * 0.6;
        const v = vCenter + (hash01(`lampZ${ri}`, i) - 0.5) * vLen * 0.4;
        const p = at(u, v);
        cyl(`calle_${ri}_farola`, props, 0.05, 0.07, ex.lampH, p.x, ex.height + ex.lampH / 2, p.z, matOf(ex.lampColor, 'lamp_post')).parent = propsNode;
        // Cabeza: brazo corto + farol emisivo (se enciende con la noche).
        const arm = at(u + (horizontal ? 0.2 : 0), v + (horizontal ? 0 : 0.2));
        box(`calle_${ri}_farola_brazo`, props, horizontal ? 0.5 : 0.05, 0.05, horizontal ? 0.05 : 0.5, arm.x, ex.height + ex.lampH, arm.z, matOf(ex.lampColor, 'lamp_post')).parent = propsNode;
        const head = matOf(ex.lampHeadColor, 'lamp_head', 0.05);
        lampMats.push({ mat: head, hex: ex.lampHeadColor });
        const hp = at(u + (horizontal ? 0.42 : 0), v + (horizontal ? 0 : 0.42));
        box(`calle_${ri}_farola_foco`, props, horizontal ? 0.26 : 0.2, 0.12, horizontal ? 0.2 : 0.26, hp.x, ex.height + ex.lampH - 0.06, hp.z, head).parent = propsNode;
      }
    }
    if (ex.benchEvery > 0) {
      const n = Math.floor(uLen / ex.benchEvery);
      for (let i = 0; i < n; i++) {
        const u = u0 + ex.benchEvery * (i + 0.5) + (hash01(`bench${ri}`, i) - 0.5) * 0.8;
        const v = vCenter + (hash01(`benchZ${ri}`, i) - 0.5) * vLen * 0.4;
        const p = at(u, v);
        // v1.41 — asiento registrado para el paseo vecinal (solo bancos de la acera FRONTAL:
        // filas horizontales con v por debajo de la línea del edificio).
        if (horizontal && p.z < -3.4) benchSpots.push({ x: p.x, z: p.z });
        const y = ex.height;
        box(`calle_${ri}_banco_asiento`, props, horizontal ? 1.6 : 0.5, 0.07, horizontal ? 0.5 : 1.6, p.x, y + 0.42, p.z, matOf(ex.benchColor, 'bench')).parent = propsNode;
        const back = at(u, v + (horizontal ? -0.22 : 0.22));
        box(`calle_${ri}_banco_respaldo`, props, horizontal ? 1.6 : 0.06, 0.42, horizontal ? 0.06 : 1.6, back.x, y + 0.66, back.z, matOf(ex.benchColor, 'bench')).parent = propsNode;
        const legA = at(u - 0.66, v);
        const legB = at(u + 0.66, v);
        box(`calle_${ri}_banco_pata_a`, props, horizontal ? 0.08 : 0.44, 0.42, horizontal ? 0.44 : 0.08, legA.x, y + 0.21, legA.z, matOf(ex.benchLegColor, 'bench_leg')).parent = propsNode;
        box(`calle_${ri}_banco_pata_b`, props, horizontal ? 0.08 : 0.44, 0.42, horizontal ? 0.44 : 0.08, legB.x, y + 0.21, legB.z, matOf(ex.benchLegColor, 'bench_leg')).parent = propsNode;
        if (ex.binEvery > 0 && hash01(`bin${ri}`, i) < 0.7) {
          const bp = at(u + 1.2, v + 0.1);
          cyl(`calle_${ri}_papelera`, props, 0.24, 0.2, 0.55, bp.x, y + 0.28, bp.z, matOf(ex.binColor, 'bin')).parent = propsNode;
        }
      }
    }
    // ── Vegetación: 1D a lo largo de la tira o DISPERSIÓN 2D con topes (jardines enormes). ──
    // v1.28 — keepOut (catálogo): rectángulos del mundo donde NO nacen árboles/arbustos
    // (el vecino no quiere verde tapando el portal); lo que cae dentro se salta.
    const keepOut = cfg.keepOut ?? [];
    const isKeepOut = (x: number, z: number): boolean =>
      keepOut.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
    const scatter = ex.gridScatter || row.gridScatter;
    const cap = (n: number, max: number | undefined): number => (max === undefined ? n : Math.min(max, n));
    const treeEvery = ex.treesPer10m > 0 ? 10 / ex.treesPer10m : 0;
    if (treeEvery > 0) {
      const n = cap(scatter ? Math.round(((uLen * vLen) / 100) * ex.treesPer10m) : Math.floor(uLen / treeEvery), row.maxTrees ?? ex.maxTrees);
      const trunk = matOf(ex.trunkColor, 'tronco');
      const leafs = ex.leafColors.map((hex, i) => matOf(hex, `hoja_${i}`));
      const arts = cfg.treeArt ?? [];
      for (let i = 0; i < n; i++) {
        const u = scatter ? u0 + hash01(`tree${ri}`, i) * uLen : u0 + treeEvery * (i + 0.5) + (hash01(`tree${ri}`, i) - 0.5) * treeEvery * 0.5;
        const v = scatter ? v0 + 0.5 + hash01(`treeV${ri}`, i) * (vLen - 1) : v0 + 0.5 + hash01(`treeZ${ri}`, i) * (vLen - 1);
        const p = at(u, v);
        if (isKeepOut(p.x, p.z)) continue; // v1.28: nada de árboles tapando el portal
        const s = 0.85 + hash01(`treeS${ri}`, i) * 0.5;
        if (arts.length > 0) {
          // RECORTE 2D (v1.24): quad frontal a escala real, variante por hash; el material
          // compartido por arte permite la fusión (una malla por PNG).
          const art = arts[Math.floor(hash01(`treeA${ri}`, i) * arts.length) % arts.length]!;
          const loaded = treeTexOf(art.art, art.keyTolerance ?? 0.12, art.w, art.h);
          const key = `arbol:${art.art}`;
          const tm = mats.get(key) ?? (() => {
            const m2 = new StandardMaterial(key, scene);
            m2.diffuseTexture = loaded!.tex;
            m2.opacityTexture = loaded!.tex;
            m2.useAlphaFromDiffuseTexture = true;
            m2.transparencyMode = 1; // ALPHATEST (1, no 2=ALPHABLEND): profundidad por píxel, sin líos de orden de mezcla
            m2.alphaCutOff = 0.45;
            m2.specularColor = new Color3(0, 0, 0);
            m2.backFaceCulling = true;
            mats.set(key, m2);
            return m2;
          })();
          const h = art.h * s;
          const q = MeshBuilder.CreatePlane(`calle_${ri}_arbol_q${i}`, { width: h * loaded!.ar, height: h }, scene);
          q.position.set(p.x, ex.height + h / 2 - 0.03, p.z);
          q.material = tm;
          q.isPickable = false;
          push(props, key, q);
          q.parent = propsNode;
        } else {
          const trunkH = 1.7 * s;
          cyl(`calle_${ri}_arbol_tronco`, props, 0.12 * s, 0.18 * s, trunkH, p.x, ex.height + trunkH / 2, p.z, trunk).parent = propsNode;
          const leaf = leafs[Math.floor(hash01(`treeC${ri}`, i) * leafs.length) % leafs.length]!;
          sphere(`calle_${ri}_arbol_copa_a`, props, 1.9 * s, p.x, ex.height + trunkH + 0.7 * s, p.z, leaf).parent = propsNode;
          sphere(`calle_${ri}_arbol_copa_b`, props, 1.3 * s, p.x + 0.5 * s, ex.height + trunkH + 1.3 * s, p.z - 0.3 * s, leaf).parent = propsNode;
        }
      }
    }
    const bushEvery = ex.bushesPer10m > 0 ? 10 / ex.bushesPer10m : 0;
    if (bushEvery > 0) {
      const n = cap(scatter ? Math.round(((uLen * vLen) / 100) * ex.bushesPer10m) : Math.floor(uLen / bushEvery), row.maxBushes ?? ex.maxBushes);
      const bushes = ex.bushColors.map((hex, i) => matOf(hex, `arbusto_${i}`));
      const flowers = ex.flowerColors.map((hex, i) => matOf(hex, `flor_${i}`));
      for (let i = 0; i < n; i++) {
        const u = scatter ? u0 + hash01(`bush${ri}`, i) * uLen : u0 + bushEvery * (i + 0.5) + (hash01(`bush${ri}`, i) - 0.5) * bushEvery * 0.6;
        const v = scatter ? v0 + 0.35 + hash01(`bushV${ri}`, i) * (vLen - 0.7) : v0 + 0.35 + hash01(`bushZ${ri}`, i) * (vLen - 0.7);
        const p = at(u, v);
        if (isKeepOut(p.x, p.z)) continue; // v1.28: los arbustos respetan el portal también
        const s = 0.5 + hash01(`bushS${ri}`, i) * 0.45;
        const mat = bushes[Math.floor(hash01(`bushC${ri}`, i) * bushes.length) % bushes.length]!;
        sphere(`calle_${ri}_arbusto`, props, 0.9 * s, p.x, ex.height + 0.34 * s, p.z, mat).parent = propsNode;
        // Flores puntual junto al arbusto (hash): un toque de color de la paleta.
        if (hash01(`flor${ri}`, i) < ex.flowerChance) {
          const fm = flowers[Math.floor(hash01(`florC${ri}`, i) * flowers.length) % flowers.length]!;
          const fp = at(u + (hash01(`florX${ri}`, i) - 0.5) * 1.4, v + (hash01(`florZ${ri}`, i) - 0.5) * 1.2);
          box(`calle_${ri}_flor`, props, 0.09, 0.2, 0.09, fp.x, ex.height + 0.1, fp.z, fm).parent = propsNode;
          sphere(`calle_${ri}_flor_cabeza`, props, 0.14, fp.x, ex.height + 0.24, fp.z, fm).parent = propsNode;
        }
      }
    }
  });

  // ── Árboles COLOCADOS (v1.28, catálogo): posiciones EXPLÍCITAS del mundo — el vecino pidió
  // desplazar el que tapaba el portal "a la parte derecha de la imagen": el keepOut lo retira
  // y una pieza forzada lo replanta donde la vista lo agradece. Mismo pipeline de recorte 2D
  // y fusión que los dispersos (un draw call más por arte, nunca por árbol).
  for (const [fi, ft] of (cfg.forcedTrees ?? []).entries()) {
    const arts = cfg.treeArt ?? [];
    if (arts.length === 0) break;
    const art = ft.art ? arts.find((a) => a.art === ft.art) ?? arts[0]! : arts[Math.floor(hash01('treeF', fi) * arts.length) % arts.length]!;
    const loaded = treeTexOf(art.art, art.keyTolerance ?? 0.12, art.w, art.h);
    const key = `arbol:${art.art}`;
    const tm = mats.get(key) ?? (() => {
      const m2 = new StandardMaterial(key, scene);
      m2.diffuseTexture = loaded!.tex;
      m2.opacityTexture = loaded!.tex;
      m2.useAlphaFromDiffuseTexture = true;
      m2.transparencyMode = 1; // ALPHATEST: igual que los dispersos
      m2.alphaCutOff = 0.45;
      m2.specularColor = new Color3(0, 0, 0);
      m2.backFaceCulling = true;
      mats.set(key, m2);
      return m2;
    })();
    const h = art.h * (ft.s ?? 1);
    const q = MeshBuilder.CreatePlane(`calle_forzado_arbol${fi}`, { width: h * loaded!.ar, height: h }, scene);
    q.position.set(ft.x, -0.02 + h / 2 - 0.03, ft.z);
    q.material = tm;
    q.isPickable = false;
    push(props, key, q);
    q.parent = propsNode;
  }

  // ── PARQUE DE CALISTENIA (v1.37) — el jardín de enfrente gana su parque: suelo de
  // caucho, barra de dominadas, paralelas, banco de abdominales y cartel. TODO del catálogo
  // (rules.view.exterior.calisthenics) y fundido en las mallas de siempre (props: visible
  // en vistas con calle). Las piezas nacen sobre la altura del `campo` (canto ex.height).
  const cal = cfg.calisthenics;
  if (cal?.enabled) {
    const baseY = 0.14; // canto superior de la tira de campo (ex.height 0.16 − 0.02 de asiento)
    const xC = cal.x;
    const zC = cal.z;
    // Suelo de caucho: losa color terrizo con borde perimetral más oscuro (nada coplanar:
    // losa a +3 cm del campo y borde a +4 cm alrededor, sin solapar el rect interior).
    const gM = matOf(cal.ground, 'cal_goma');
    const eM = matOf(cal.edge, 'cal_borde');
    box('cal_goma', statics, cal.w, 0.05, cal.d, xC, baseY + 0.005, zC, gM);
    const ew = 0.12;
    for (const [sx, sz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const wE = sx !== 0 ? ew : cal.w + ew * 2;
      const dE = sx !== 0 ? cal.d + ew * 2 : ew;
      box('cal_borde', statics, wE, 0.07, dE, xC + sx * (cal.w / 2 + ew / 2), baseY + 0.005, zC + sz * (cal.d / 2 + ew / 2), eM);
    }
    const pM = matOf(cal.postColor, 'cal_poste');
    const bM = matOf(cal.barColor, 'cal_barra');
    // v1.37 — los aparatos se AGRUPAN en el borde VISIBLE (el canto de la cámara de la calle
    // corta hacia z≈-14.3): cartel y barra lo más cerca del edificio, paralelas y banco detrás.
    const nearZ = zC + cal.d / 2; // borde del parque hacia el edificio (el que se ve en cuadro)
    // BARRA DE DOMINADAS: dos postes con pata inclinada y barra superior.
    const px = xC - cal.w * 0.22;
    const pz = nearZ - 0.8;
    for (const sz of [-1, 1] as const) {
      box('cal_poste', props, 0.09, cal.barH, 0.09, px, baseY + 0.03 + cal.barH / 2, pz + sz * 0.62, pM).parent = propsNode;
      box('cal_pata', props, 0.09, 0.5, 0.09, px + 0.18, baseY + 0.03 + 0.25, pz + sz * 0.62 + (sz > 0 ? -0.16 : 0.16), pM).parent = propsNode;
    }
    box('cal_barra', props, 0.06, 0.06, 1.34, px, baseY + 0.03 + cal.barH, pz, bM).parent = propsNode;
    // PARALELAS: dos barras bajas en paralelo (fondos de pecho y fondos).
    const dx = xC + cal.w * 0.12;
    const dz = nearZ - 1.55;
    for (const sz of [-1, 1] as const) {
      box('cal_dip_pata_a', props, 0.08, cal.dipH, 0.08, dx - 0.55, baseY + 0.03 + cal.dipH / 2, dz + sz * 0.3, pM).parent = propsNode;
      box('cal_dip_pata_b', props, 0.08, cal.dipH, 0.08, dx + 0.55, baseY + 0.03 + cal.dipH / 2, dz + sz * 0.3, pM).parent = propsNode;
      box('cal_dip_barra', props, 1.22, 0.055, 0.055, dx, baseY + 0.03 + cal.dipH, dz + sz * 0.3, bM).parent = propsNode;
    }
    // BANCO DE ABDOMINALES: tabla inclinada sobre dos caballetes. v1.47 — inclinación
    // suave (la 0.22 con la tabla clara se leía como «camino blanco sin salida» a la
    // derecha del parque; el tono madera del catálogo + menos ángulo lo deja como banco).
    const bx = xC + cal.w * 0.34;
    const bz = nearZ - 2.15;
    const board = box('cal_banco_tabla', props, 1.15, 0.06, 0.4, bx, baseY + 0.03 + 0.36, bz, matOf(cal.boardColor, 'cal_tabla'));
    board.rotation.z = -0.12;
    board.parent = propsNode;
    for (const sx of [-1, 1] as const) {
      box('cal_banco_pata', props, 0.08, 0.36, 0.36, bx + sx * 0.42, baseY + 0.03 + 0.18, bz, pM).parent = propsNode;
    }
    // CARTEL del parque: poste + placa con el nombre (canvas, igual oficio que los rótulos).
    const sxn = xC - cal.w * 0.42;
    const szn = nearZ - 0.15;
    box('cal_cartel_palo', props, 0.07, 1.5, 0.07, sxn, baseY + 0.03 + 0.75, szn, pM).parent = propsNode;
    const signW = 1.06;
    const signH = 0.42;
    const signTexCal = new (B().DynamicTexture)('cal_cartel_tex', { width: 512, height: Math.round((512 * signH) / signW) }, scene, true);
    const sc = signTexCal.getContext() as unknown as CanvasRenderingContext2D;
    sc.fillStyle = cal.signBg;
    sc.fillRect(0, 0, 512, Math.round((512 * signH) / signW));
    sc.fillStyle = cal.signFg;
    sc.font = 'bold 84px Arial, sans-serif';
    sc.textAlign = 'center';
    sc.textBaseline = 'middle';
    sc.fillText(cal.sign, 256, Math.round((512 * signH) / signW) / 2 + 4);
    signTexCal.update(true);
    const signM = new StandardMaterial(`cal_cartel_mat_${mats.size}`, scene);
    signM.diffuseTexture = signTexCal;
    signM.specularColor = new Color3(0.05, 0.05, 0.05);
    const signQuad = MeshBuilder.CreatePlane('cal_cartel', { width: signW, height: signH }, scene);
    signQuad.position.set(sxn, baseY + 0.03 + 1.42, szn + 0.05);
    signQuad.rotation.y = Math.PI; // la cara mira a la cámara (calle): el nombre se lee de frente
    signQuad.material = signM;
    signQuad.isPickable = false;
    push(props, 'cal_cartel', signQuad);
    signQuad.parent = propsNode;
  }

  // ── COCINADO (v1.22): una malla por material y grupo. El mobiliario fusionado cuelga del
  // nodo de vista "edificio"; las estáticas se quedan sueltas en la escena. Bounding infos
  // congeladas (nada se mueve) y materiales estáticos congelados (menos trabajo por frame).
  const frozen = new Set<StandardMaterial>();
  const bake = (bucket: Map<string, Mesh[]>, parent: TransformNode | null): void => {
    for (const [, list] of bucket) {
      if (list.length === 0) continue;
      const merged = Mesh.MergeMeshes(list, true, true, undefined, false, true);
      if (!merged) continue;
      merged.name = `calle_fusion_${merged.name}`;
      merged.material = list[0]!.material;
      merged.isPickable = false;
      merged.doNotSyncBoundingInfo = true;
      if (parent) merged.parent = parent;
      root.push(merged);
      const mat = merged.material as StandardMaterial | null;
      if (mat && !lampMats.some((l) => l.mat === mat)) frozen.add(mat);
    }
    bucket.clear();
  };
  bake(statics, null);
  bake(props, propsNode);
  for (const m of frozen) m.freeze();

  const dispose = () => {
    for (const m of root) m.dispose(false, true);
    ground.dispose(false, true);
    propsNode.dispose(false, false);
    for (const t of treeTexCache.values()) t.tex.dispose();
    treeTexCache.clear();
    for (const m of mats.values()) m.unfreeze();
    for (const m of mats.values()) m.dispose();
    mats.clear();
    root.length = 0;
    lampMats.length = 0;
    frozen.clear();
  };

  return {
    update() {
      // Farolas: el anochecer las enciende (luz de día del fondo), el mediodía las apaga.
      const day = backdrop.daylight;
      const glow = Math.max(0, Math.min(1, (0.42 - day) / 0.42));
      for (const { mat, hex } of lampMats) mat.emissiveColor = Color3.FromHexString(hex).scale(0.05 + glow * 1.1);
    },
    setPropsVisible(visible: boolean) {
      if (propsVisible === visible) return; // idempotente: sin churn por frame
      propsVisible = visible;
      propsNode.setEnabled(visible);
    },
    benches: () => benchSpots,
    dispose() {
      dispose();
    },
  };
}
