import type { Color3, Color4, Mesh, Scene, StandardMaterial, TransformNode } from '@babylonjs/core';
import type { BlockInstance, Content, World } from '@/game/core/types';
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
  /** Foco del LOD (posición del jugador): lo alimenta update() y lo consume paint(). */
  let lastFocus: { x: number; floor: number } | null = null;
  // Plano frontal de las estancias: la cara de la puerta. Con viviendas del doble de calado
  // (v0.6-b), el extra crece hacia el FONDO (+Z) para no envolver el pasillo ni al núcleo.
  const frontZ = v.roomZ - v.commonDepth / 2;
  /** Calado por bloque: viviendas 2× (mobiliario interior); bloques comunes, el de siempre. */
  const depthOf = (b: BlockInstance): number => (b.kind === 'dwelling' ? v.depth : v.commonDepth);
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
      view.greybox.push(box(b.id, b.size.w * v.cellW, v.slab * 2, 0.5, cx, bottom + v.slab, v.corridorZ, m));
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
        const w = b.size.w * v.cellW - v.gapW;
        const h = v.cellH - v.gapH;
        const d = depthOf(b);
        const cz = frontZ + d / 2;
        // El modelo se authora a dimensiones nominales con la base en y=0 y centrado en x/z.
        model.root.scaling.set(w / entry.nominal.w, h / entry.nominal.h, d / entry.nominal.d);
        model.root.position.set((b.cell.col + b.size.w / 2) * v.cellW, b.cell.floor * v.cellH, cz);
        view.model = model.root;
        view.mats = model.mats;
        view.baseEmissive = model.mats.map((mm) => new Color3(mm.emissiveColor.r, mm.emissiveColor.g, mm.emissiveColor.b));
        view.baseColor = model.baseColor.map((c) => new Color3(c.r, c.g, c.b));
        view.tintStrength = entry.tintStrength ?? 0.6;
        view.edgesMesh = null; // el modelo no lleva EdgesRenderer (no hay pared destacada greybox)
        for (const mesh of view.greybox) mesh.setEnabled(false);
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

  // ── Mobiliario placeholder (greybox del editor de interiores): una caja por ranura de las viviendas. ──
  // La geometría llega al pintar, desde furniture.view del catálogo: sustituible por arte final sin tocar esto.
  const furnViews = new Map<string, { mesh: Mesh; mat: StandardMaterial; x: number; z: number; bottom: number; pos1: number }>();
  for (const b of Object.values(world.blocks)) {
    if (b.kind !== 'dwelling') continue;
    const w = b.size.w * v.cellW - v.gapW;
    const bottom = b.cell.floor * v.cellH;
    const layoutId = content.blocks[b.defId]?.container?.layout;
    const layoutRooms = layoutId ? content.layouts[layoutId]?.rooms ?? [] : [];
    const bandW = w / Math.max(1, layoutRooms.length);
    layoutRooms.forEach((layoutRoom, roomIdx) => {
      const rdef = content.rooms[layoutRoom.defId];
      const roomW = rdef?.size.w ?? 1;
      (rdef?.furnitureSlots ?? []).forEach((slot, slotIdx) => {
        const x = b.cell.col * v.cellW + roomIdx * bandW + (slot.pos[0] / Math.max(0.001, roomW)) * bandW;
        // Cerca del plano frontal (con viviendas de calado doble queda todo el fondo libre para Fase C).
        const z = frontZ + 0.35 + slotIdx * 0.32;
        const fm = mat(`${b.id}_${layoutRoom.key}_${slot.id}_furn`);
        const mesh = box(`${b.id}_${layoutRoom.key}_${slot.id}_furn`, 1, 1, 1, x, bottom + v.slab, z, fm);
        mesh.setEnabled(false);
        furnViews.set(`${b.id}:${layoutRoom.key}:${slot.id}`, { mesh, mat: fm, x, z, bottom, pos1: slot.pos[1] });
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
        fv.mesh.position.set(fv.x, fv.bottom + v.slab + v.wall + fv.pos1 + ih / 2, fv.z);
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
