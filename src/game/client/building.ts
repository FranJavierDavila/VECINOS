import type { Color3, Color4, Mesh, Scene, StandardMaterial, TransformNode } from '@babylonjs/core';
import { blockLabel } from '@/game/core/types';
import type { BlockInstance, Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { B } from './babylon';
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
  front: Mesh | null; // panel que cierra la vivienda mientras tiene candado
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
}

/** Interior 2D de una vivienda (Fase C): suelo por estancia + tapa de puerta hacia estancia cerrada. */
interface InteriorView {
  /** Suelo tintado por estancia (color del catálogo; lockedColor si está cerrada). */
  floors: { roomKey: string; defId: string; mesh: Mesh; mat: StandardMaterial }[];
  /** Tapas de los huecos de puerta que llevan a una estancia cerrada ("en obras"). */
  covers: { mesh: Mesh; rooms: [string, string] }[];
}

/**
 * Una caja por bloque (placeholder greybox del futuro prefab) y, si el manifiesto de assets
 * (Content.assets.blocks) declara un modelo glTF para el tipo de bloque, el modelo en su lugar
 * (con la caja oculta). TODA la geometría y los colores salen de content.rules.view +
 * block.view + assets: sustituir el greybox por arte final no toca este código.
 * Las viviendas se dibujan en corte, sin pared frontal; bloqueadas, con panel y candado.
 */
export function createBuilding(scene: Scene, world: World, content: Content) {
  const { Color3, Color4, MeshBuilder, StandardMaterial } = B();
  const v = content.rules.view;
  const glow = Object.fromEntries(Object.entries(v.channelGlow).map(([k, hex]) => [k, Color3.FromHexString(hex)])) as Record<string, Color3>;
  const views = new Map<string, BlockView>();
  const shakes = new Map<string, number>();
  /** Interiores 2D (Fase C) por bloque: suelos de estancia y tapas de puertas cerradas. */
  const interiors = new Map<string, InteriorView>();
  /** Foco del LOD (posición del jugador): lo alimenta update() y lo consume paint(). */
  let lastFocus: { x: number; floor: number } | null = null;
  // Plano frontal de las estancias: la cara de la puerta. Con viviendas del doble de calado
  // (v0.6-b), el extra crece hacia el FONDO (+Z) para no envolver el pasillo ni al núcleo.
  const frontZ = v.roomZ - v.commonDepth / 2;
  /** Calado por bloque: viviendas 2× (mobiliario interior); naves del cierre (v1.16) y el
   *  tejado (con aleros) a calado de vivienda; bloques comunes, el de siempre. */
  const depthOf = (b: BlockInstance): number => {
    if (b.kind === 'dwelling') return v.depth;
    if (b.defId === 'trasteros_planta' || b.defId === 'bajocubierta') return v.depth;
    if (b.defId === 'tejado') return v.depth + v.roof.overhang * 2;
    return v.commonDepth;
  };
  const mat = (name: string) => new StandardMaterial(name, scene);
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
      lock: null,
      lockBase: { x: cx, y: bottom + v.cellH / 2 - 0.2 },
      centerX: cx,
      floor: b.cell.floor,
      edgesMesh: null,
      glowForced: false,
      lodHiddenPanels: false,
    };
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
      view.edgesMesh = box(`${b.id}_fondo`, w, h, v.wall, cx, y, frontZ + d, m);
      view.greybox.push(
        view.edgesMesh,
        box(`${b.id}_izq`, v.wall, h, d, cx - w / 2, y, cz, m),
        box(`${b.id}_der`, v.wall, h, d, cx + w / 2, y, cz, m),
        box(`${b.id}_suelo`, w, v.wall, d, cx, bottom + v.slab + v.wall / 2, cz, m),
        box(`${b.id}_techo`, w, v.wall, d, cx, bottom + v.cellH - v.slab - v.wall / 2, cz, m),
      );
      view.front = box(`${b.id}_puerta`, w, h, v.wall, cx, y, frontZ, m);
      view.lock = box(`${b.id}_candado`, 0.3, 0.38, 0.12, cx, view.lockBase.y, frontZ - 0.1, mat(`${b.id}_candado_mat`));
      (view.lock.material as StandardMaterial).diffuseColor = Color3.FromHexString(v.lockColor);

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
      const geoRooms = (layout?.rooms ?? []).filter((r) => r.rect !== undefined);
      if (geoRooms.length > 0 && layout) {
        const interior: InteriorView = { floors: [], covers: [] };
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
          const fm = box(`${b.id}_${lr.key}_suelo`, r.w, 0.02, r.d, x0 + r.x + r.w / 2, bottom + v.slab + v.wall + 0.02, frontZ + r.z + r.d / 2, fmat);
          interior.floors.push({ roomKey: lr.key, defId: lr.defId, mesh: fm, mat: fmat });
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
            // Borde vertical compartido → tabique que corre según Z (se cruza andando en X).
            const touchX = Math.abs(ra.x + ra.w - rb.x) < eps || Math.abs(rb.x + rb.w - ra.x) < eps;
            const overlapZ = Math.min(ra.z + ra.d, rb.z + rb.d) - Math.max(ra.z, rb.z);
            if (touchX && overlapZ > eps) {
              const wx = x0 + Math.max(ra.x, rb.x);
              const z0 = frontZ + Math.max(ra.z, rb.z);
              const z1 = frontZ + Math.min(ra.z + ra.d, rb.z + rb.d);
              const yC = bottom + v.slab + v.wall + wallH / 2;
              if (door && door.axis === 'z') {
                const g0 = Math.max(z0, frontZ + door.at - door.width / 2);
                const g1 = Math.min(z1, frontZ + door.at + door.width / 2);
                seg(z0, g0, 'z', wx, wallH, yC, `${b.id}_tab_${i}_${j}_i`);
                seg(g1, z1, 'z', wx, wallH, yC, `${b.id}_tab_${i}_${j}_d`);
                const cover = box(`${b.id}_tapa_${i}_${j}`, v.wall * 0.8, wallH, g1 - g0, wx, yC, frontZ + door.at, mat(`${b.id}_tapa_${i}_${j}_mat`));
                (cover.material as StandardMaterial).diffuseColor = Color3.FromHexString(v.lockedColor);
                cover.setEnabled(false);
                interior.covers.push({ mesh: cover, rooms: [lr.key, other.key] });
              } else {
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
                const g0 = Math.max(xa, x0 + door.at - door.width / 2);
                const g1 = Math.min(xb, x0 + door.at + door.width / 2);
                seg(xa, g0, 'x', wz, halfH, yHalf, `${b.id}_tab_${i}_${j}_i`);
                seg(g1, xb, 'x', wz, halfH, yHalf, `${b.id}_tab_${i}_${j}_d`);
                const cover = box(`${b.id}_tapa_${i}_${j}`, g1 - g0, halfH, v.wall * 0.8, x0 + door.at, yHalf, wz, mat(`${b.id}_tapa_${i}_${j}_mat`));
                (cover.material as StandardMaterial).diffuseColor = Color3.FromHexString(v.lockedColor);
                cover.setEnabled(false);
                interior.covers.push({ mesh: cover, rooms: [lr.key, other.key] });
              } else {
                seg(xa, xb, 'x', wz, halfH, yHalf, `${b.id}_tab_${i}_${j}`);
              }
            }
          });
        });
        interiors.set(b.id, interior);
      }
    } else if (b.defId === 'trasteros_planta' || b.defId === 'bajocubierta') {
      // Nave de trasteros / sala de instalaciones (v1.16): forjado + trasera. El arte glTF
      // añade pilares (trasteros) o maquinaria (bajocubierta); las estanterías, trastos y
      // carteles numerados los levanta SIEMPRE el runtime desde rules.view.trasteros.
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
    views.set(b.id, view);
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
        view.model = model.root;
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
          for (const mesh of view.greybox) mesh.setEnabled(false);
        }
      });
    }
  }

  // ── Multi-vivienda destacada: borde blanco en la pared del fondo de TODAS las viviendas del jugador ──
  // (la actual del jugador además recibe el doble de grosor; el criterio es el ownerId, no el catálogo).
  const homeId = world.residents[world.playerId]!.home;
  for (const b of Object.values(world.blocks)) {
    if (b.kind !== 'dwelling' || b.ownerId !== world.playerId) continue;
    const wall = views.get(b.id)!.edgesMesh;
    if (!wall) continue;
    wall.enableEdgesRendering();
    wall.edgesWidth = b.id === homeId ? 14 : 8;
    wall.edgesColor = Color4.FromHexString(v.homeEdge + 'ff');
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
        // Cartel: fila frontal sobre la fachada abierta; fila de fondo sobre su balda alta.
        const plate = shelfPlate(`${lvl.id}_est_${s}_placa`, label, own);
        plate.position.set(
          bx,
          baseY + unitH + 0.16,
          row.front ? frontZ + v.wall - 0.015 : row.zC + tr.shelfD / 2 - 0.015,
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

  // ── Macetas de pasillo (v1.16): reparto aleatorio DETERMINISTA por hash del id del pasillo
  // (jamás nextRandom del sim): cantidad entre perFloorMin..perFloorMax, lado (fachada o
  // barandilla), tamaño y especie salen del catálogo (rules.view.pots). Nunca sobre la línea
  // de paseo (corridorZ): se pegan a fachada o barandilla para no invadir el tránsito.
  const pt = v.pots;
  for (const b of Object.values(world.blocks)) {
    if (b.layer !== 'corridor') continue;
    const ySlab = b.cell.floor * v.cellH + v.slab * 2;
    const n = pt.perFloorMin + Math.floor(hash01(b.id, 101) * (pt.perFloorMax - pt.perFloorMin + 1));
    const mPot = mat(`${b.id}_maceta_mat`);
    mPot.diffuseColor = Color3.FromHexString(pt.potColor);
    const mSoil = mat(`${b.id}_tierra_mat`);
    mSoil.diffuseColor = Color3.FromHexString(pt.soilColor);
    const mPlantA = mat(`${b.id}_planta_a_mat`);
    mPlantA.diffuseColor = Color3.FromHexString(pt.plantColor);
    const mPlantB = mat(`${b.id}_planta_b_mat`);
    mPlantB.diffuseColor = Color3.FromHexString(pt.plant2Color);
    for (let i = 0; i < n; i++) {
      const x = b.cell.col * v.cellW + 1.6 + hash01(b.id, 200 + i) * (b.size.w * v.cellW - 3.2);
      const z = hash01(b.id, 300 + i) < 0.5 ? frontZ - 0.18 : frontZ - v.corridorDepth + 0.2;
      const s = 0.85 + hash01(b.id, 400 + i) * 0.3;
      const pot = MeshBuilder.CreateCylinder(`${b.id}_maceta_${i}`, { diameter: pt.potR * 2, height: pt.potH }, scene);
      pot.position.set(x, ySlab + (pt.potH * s) / 2, z);
      pot.scaling.set(s, s, s);
      pot.material = mPot;
      const soil = MeshBuilder.CreateCylinder(`${b.id}_tierra_${i}`, { diameter: pt.potR * 1.7, height: 0.04 }, scene);
      soil.position.set(x, ySlab + pt.potH * s + 0.01, z);
      soil.scaling.set(s, s, s);
      soil.material = mSoil;
      const bushH = 0.3 + hash01(b.id, 500 + i) * 0.16;
      const bush = MeshBuilder.CreateCylinder(`${b.id}_planta_${i}`, { diameterTop: 0.02, diameterBottom: pt.potR * 1.5, height: bushH }, scene);
      bush.position.set(x, ySlab + pt.potH * s + bushH / 2 - 0.01, z);
      bush.scaling.set(s, s, s);
      bush.material = hash01(b.id, 600 + i) < 0.5 ? mPlantA : mPlantB;
    }
  }

  // ── Mobiliario placeholder (greybox del editor de interiores): una caja por ranura de las viviendas. ──
  // Con layout 2D (Fase C), cada ranura se coloca en su rect de estancia: pos = [x, z] local;
  // sin rects, cae al cálculo por bandas de siempre. La geometría llega al pintar.
  const furnViews = new Map<string, { mesh: Mesh; mat: StandardMaterial; x: number; z: number; bottom: number; y: number | null }>();
  for (const b of Object.values(world.blocks)) {
    if (b.kind !== 'dwelling') continue;
    const bottom = b.cell.floor * v.cellH;
    const layoutId = content.blocks[b.defId]?.container?.layout;
    const layout = layoutId ? content.layouts[layoutId] : undefined;
    const geoRooms = (layout?.rooms ?? []).filter((r) => r.rect !== undefined);
    const x0 = b.cell.col * v.cellW;
    (layout?.rooms ?? []).forEach((layoutRoom, roomIdx) => {
      const rdef = content.rooms[layoutRoom.defId];
      (rdef?.furnitureSlots ?? []).forEach((slot, slotIdx) => {
        let x: number;
        let z: number;
        const rect = geoRooms[roomIdx]?.rect;
        if (rect) {
          // Fase C: metros locales al rect de la estancia (0,0 = esquina frontal-izquierda).
          x = x0 + rect.x + slot.pos[0];
          z = frontZ + rect.z + slot.pos[1];
        } else {
          // Fallback 1D (layout sin rects): bandas como siempre.
          const w = b.size.w * v.cellW - v.gapW;
          const bandW = w / Math.max(1, layout?.rooms.length ?? 1);
          const roomW = rdef?.size.w ?? 1;
          x = x0 + roomIdx * bandW + (slot.pos[0] / Math.max(0.001, roomW)) * bandW;
          z = frontZ + 0.35 + slotIdx * 0.32;
        }
        const fm = mat(`${b.id}_${layoutRoom.key}_${slot.id}_furn`);
        const mesh = box(`${b.id}_${layoutRoom.key}_${slot.id}_furn`, 1, 1, 1, x, bottom + v.slab, z, fm);
        mesh.setEnabled(false);
        furnViews.set(`${b.id}:${layoutRoom.key}:${slot.id}`, { mesh, mat: fm, x, z, bottom, y: slot.y ?? null });
      });
    });
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

  /** Color difuso/albedo por material: greybox plano (tintStrength 1) o mezcla sobre el arte. */
  function applyTint(view: BlockView, b: BlockInstance) {
    const state = color(b);
    const override = stateTint(b);
    for (let i = 0; i < view.mats.length; i++) {
      const m = view.mats[i]!;
      const base = view.baseColor[i]!;
      const c = view.tintStrength >= 1 ? state : override ? Color3.Lerp(base, override, view.tintStrength) : base;
      if (m.diffuseColor) m.diffuseColor = c;
      else if (m.albedoColor) m.albedoColor = c;
    }
  }

  /** Visibilidad efectiva de panel y candado: paint() la fija por el acceso y el LOD puede ocultarlos encima. */
  function applyPanels(view: BlockView, b: BlockInstance) {
    const closed = b.kind === 'dwelling' && b.access === 'locked';
    const visible = closed && !view.lodHiddenPanels;
    view.front?.setEnabled(visible);
    view.lock?.setEnabled(visible);
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
      // Muebles del editor de interiores: visibles/escala/color según furniture.view (catálogo).
      for (const [key, fv] of furnViews) {
        const [blockId, roomKey, slotId] = key.split(':');
        const room = world.blocks[blockId ?? '']?.rooms.find((r) => r.key === roomKey);
        const itemId = room?.furniture[slotId ?? ''] ?? '';
        const fdef = itemId ? content.furniture[itemId] : undefined;
        if (!fdef) {
          fv.mesh.setEnabled(false);
          continue;
        }
        const [iw, ih, idz] = fdef.view.size;
        fv.mesh.setEnabled(true);
        fv.mesh.scaling.set(iw, ih, idz);
        // Con y de anclaje (muebles de pared) cuelga a esa altura; si no, apoyado en el suelo.
        const yBase = fv.y !== null ? fv.bottom + v.slab + v.wall + fv.y : fv.bottom + v.slab + v.wall;
        fv.mesh.position.set(fv.x, yBase + ih / 2, fv.z);
        fv.mat.diffuseColor = Color3.FromHexString(fdef.view.color);
      }
    },
    /** Sacude el candado de una puerta cerrada. */
    shake(blockId: string) {
      shakes.set(blockId, 0.4);
    },
    /**
     * dt en segundos; `focus` es el punto de interés (posición del jugador) para el
     * LOD por distancia (rules.view.lod): applyLod() lo aplica SIEMPRE al final del frame
     * (con focus undefined, p. ej. cámara 'edificio', restaura el estado completo).
     */
    update(dt: number, focus?: { x: number; floor: number }) {
      if (focus) lastFocus = focus;
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
