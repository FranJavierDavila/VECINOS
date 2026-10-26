/**
 * Pipeline del arte final (v0.6 Fase A): carga de modelos glTF 2.0 declarados en el
 * manifiesto public/content/assets.json (Content.assets), con caché de contenedores,
 * instancias clonadas por residente/bloque y FALLBACK greybox garantizado:
 * cualquier fallo (sin manifiesto, 404, glTF inválido) devuelve null y el llamador
 * sigue con la cápsula/caja — el juego nunca se rompe por un asset.
 *
 * Todo data-driven: rutas, escalas nominales y clips de animación viven en el manifiesto.
 */
import type { AnimationGroup, AssetContainer, Material, Quaternion, Scene, TransformNode } from '@babylonjs/core';
import type { ActorAssetDef, BlockAssetDef } from '@/game/core/types';
import { B } from './babylon';

/** El bundle del CDN ya trae el loader glTF; este script extra es idempotente y solo asegura el plugin. */
let loadersPromise: Promise<void> | null = null;
function ensureGlTFLoader(): Promise<void> {
  loadersPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.babylonjs.com/loaders/babylonjs.loaders.min.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar el plugin glTF de Babylon'));
    document.head.appendChild(s);
  });
  return loadersPromise;
}

/** Contenedores por ESCENA (WeakMap): tras restart/Cargar partida la escena cambia y cada
 *  contenedor se instancia en la escena a la que pertenece; la caché vieja muere con su escena. */
const containers = new WeakMap<Scene, Map<string, Promise<AssetContainer | null>>>();

async function loadContainer(scene: Scene, url: string): Promise<AssetContainer | null> {
  let perScene = containers.get(scene);
  if (!perScene) {
    perScene = new Map();
    containers.set(scene, perScene);
  }
  let p = perScene.get(url);
  if (!p) {
    p = (async () => {
      try {
        await ensureGlTFLoader();
        if (scene.isDisposed) return null; // la escena murió mientras llegaba el plugin
        return await B().SceneLoader.LoadAssetContainerAsync(url, '', scene);
      } catch (e) {
        console.warn(`[assets] modelo no disponible (${url}); greybox como fallback.`, e);
        return null;
      }
    })();
    perScene.set(url, p);
  }
  return p;
}

// ───────────────────────── Personajes (arquetipos) ─────────────────────────

export interface ActorRig {
  /** Raíz de la instancia (pivote en los pies). */
  root: TransformNode;
  /** Clips por nombre lógico (idle/walk/spray...). */
  groups: Map<string, AnimationGroup>;
  defaultClip: string | null;
  current: string | null;
  group: AnimationGroup | null;
  /** Ratio de reproducción vigente (anti-patinaje v1.3: se sincroniza con la velocidad real). */
  rate: number;
  /** Reproduce un clip lógico (null = por defecto) con ratio de playback. Idempotente:
   *  mismo clip con otro ratio solo ajusta speedRatio (sin reiniciar el ciclo de la pierna). */
  play(clip: string | null, rate?: number): void;
  /** Libera la instancia (nodos y grupos clonados; materiales compartidos, se quedan). */
  dispose(): void;
}

/** Instancia el modelo de un arquetipo para un residente concreto. null → greybox. */
export async function instantiateActorAsset(scene: Scene, def: ActorAssetDef, base: string, id: string): Promise<ActorRig | null> {
  const c = await loadContainer(scene, base + def.model);
  if (!c || scene.isDisposed) return null;
  try {
    const inst = c.instantiateModelsToScene();
    const root = inst.rootNodes[0] as TransformNode | undefined;
    if (!root) return null;
    const groups = new Map<string, AnimationGroup>();
    // Los clones de instantiateModelsToScene llegan como "Clone of idle": emparejamiento
    // tolerante exacto → inclusión (cubre sufijos y prefijos de clonado).
    const findClip = (sourceName: string): AnimationGroup | undefined =>
      inst.animationGroups.find((x) => x.name === sourceName) ?? inst.animationGroups.find((x) => x.name.includes(sourceName));
    for (const [logical, sourceName] of Object.entries(def.animations ?? {})) {
      const g = findClip(sourceName);
      if (g) groups.set(logical, g);
      else console.warn(`[assets] ${id}: el clip "${sourceName}" no existe en ${def.model} (disponibles: ${inst.animationGroups.map((x) => x.name).join(', ') || 'ninguno'})`);
    }
    // Estados sociales (v1.2: run/talk/laugh/argue/phone/sit): mismos grupos bajo otro nombre
    // lógico; si el modelo no trae el clip, play() cae al default con elegancia (sin warning:
    // un arquetipo sin 'sit' simplemente nunca se sienta).
    for (const [state, sourceName] of Object.entries(def.stateAnimations ?? {})) {
      if (groups.has(state)) continue;
      const g = findClip(sourceName);
      if (g) groups.set(state, g);
    }
    const defaultClip = def.defaultAnimation && groups.has(def.defaultAnimation) ? def.defaultAnimation : null;
    // V1.28 — POSTURA DE PAUSA DE VERDAD: los clips NO comparten canales (idle no anima
    // piernas; talk/phone/sit tampoco). Al cambiar de clip, Babylon deja los huesos del clip
    // anterior en su ÚLTIMA pose: el vecino que se para a mitad de zancada se quedaba
    // CONGELADO en pose de andar ("no existe postura de pausa"). Ahora cada grupo recuerda
    // qué nodos GIRA, la instancia captura la pose de reposo antes de animar nada y play()
    // RESTAURA la reposo de los nodos que quedan sin cubrir al cambiar de clip.
    const rotTargetsOf = (g: AnimationGroup): Set<TransformNode> => {
      const s = new Set<TransformNode>();
      for (const t of g.targetedAnimations) {
        const node = t.target as TransformNode;
        if (!node || typeof node !== 'object' || !('position' in node)) continue;
        const an = (t as unknown as { animation?: { targetProperty?: string } }).animation;
        const prop = an?.targetProperty ?? '';
        if (prop === 'rotation' || prop === 'rotationQuaternion') s.add(node);
      }
      return s;
    };
    const rotTargets = new Map<AnimationGroup, Set<TransformNode>>();
    for (const g of groups.values()) rotTargets.set(g, rotTargetsOf(g));
    const restQuat = new Map<TransformNode, Quaternion | null>();
    const restRot = new Map<TransformNode, number>();
    for (const g of groups.values()) {
      for (const node of rotTargets.get(g) ?? []) {
        if (restQuat.has(node)) continue;
        restQuat.set(node, node.rotationQuaternion ? node.rotationQuaternion.clone() : null);
        restRot.set(node, node.rotation?.y ?? 0);
      }
    }
    const restoreUncovered = (prev: AnimationGroup | null, next: AnimationGroup | null): void => {
      if (!prev) return;
      const keep = next ? rotTargets.get(next) : null;
      for (const node of rotTargets.get(prev) ?? []) {
        if (keep?.has(node)) continue; // el clip nuevo sigue animándolo: no tocar
        const q = restQuat.get(node);
        if (q && node.rotationQuaternion) node.rotationQuaternion.copyFrom(q);
        else if (!q && node.rotation) node.rotation.y = restRot.get(node) ?? 0;
      }
    };
    const rig: ActorRig = {
      root,
      groups,
      defaultClip,
      current: null,
      group: null,
      rate: 1,
      play(clip, rate = 1) {
        const key = clip && groups.has(clip) ? clip : defaultClip;
        rig.rate = rate;
        if (key === rig.current) {
          if (rig.group && Math.abs(rig.group.speedRatio - rate) > 0.01) rig.group.speedRatio = rate;
          return;
        }
        const nextGroup = key ? groups.get(key)! : null;
        restoreUncovered(rig.group, nextGroup); // v1.28: piernas/brazos sin cobertura vuelven a reposo
        rig.group?.stop();
        rig.current = key;
        rig.group = nextGroup;
        rig.group?.start(true, rate);
      },
      dispose() {
        for (const g of groups.values()) g.dispose();
        root.dispose(false, false); // recursivo; materiales compartidos con el contenedor
      },
    };
    rig.play(null);
    return rig;
  } catch (e) {
    console.warn(`[assets] fallo al instanciar ${def.model} para ${id}; greybox.`, e);
    return null;
  }
}

// ───────────────────────── Bloques ─────────────────────────

/**
 * Material compatible con tintado/emissive: StandardMaterial (greybox) usa diffuseColor y
 * PBRMaterial (glTF) usa albedoColor; ambos tienen emissiveColor.
 */
export interface BlockMat {
  emissiveColor: { r: number; g: number; b: number };
  diffuseColor?: { r: number; g: number; b: number };
  albedoColor?: { r: number; g: number; b: number };
}

export interface BlockModel {
  /** Raíz de la instancia (el modelo se authora con la base en y=0 y centrado en x/z). */
  root: TransformNode;
  /** Materiales de la instancia para glow/tintado de estado. */
  mats: BlockMat[];
  /** Albedo/diffuse base capturado al crear (para restaurar tras el tintado). */
  baseColor: { r: number; g: number; b: number }[];
}

/** Recoge los materiales de un nodo (meshes hijos, únicos por nombre). */
function collectMats(root: TransformNode): BlockMat[] {
  const seen = new Set<Material>();
  for (const m of root.getChildMeshes()) if (m.material) seen.add(m.material);
  return [...seen].map((m) => m as unknown as BlockMat);
}

/** Instancia el modelo de un tipo de bloque. null → greybox. */
export async function instantiateBlockAsset(scene: Scene, def: BlockAssetDef, base: string): Promise<BlockModel | null> {
  const c = await loadContainer(scene, base + def.model);
  if (!c || scene.isDisposed) return null;
  try {
    // Materiales clonados por instancia (default): el tinte de estado y el glow de canales son
    // POR BLOQUE (dos pasillos no brillan juntos). El manifiesto puede optar salir con false.
    const inst = c.instantiateModelsToScene(undefined, def.cloneMaterials !== false);
    const root = inst.rootNodes[0] as TransformNode | undefined;
    if (!root) return null;
    for (const g of inst.animationGroups) g.dispose(); // bloques estáticos: sin clips
    const mats = collectMats(root);
    return { root, mats, baseColor: mats.map((m) => ({ ...(m.albedoColor ?? m.diffuseColor ?? { r: 1, g: 1, b: 1 }) })) };
  } catch (e) {
    console.warn(`[assets] fallo al instanciar ${def.model}; greybox.`, e);
    return null;
  }
}
