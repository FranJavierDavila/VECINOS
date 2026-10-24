/**
 * Pipeline del arte final (v0.6 Fase A): carga de modelos glTF 2.0 declarados en el
 * manifiesto public/content/assets.json (Content.assets), con caché de contenedores,
 * instancias clonadas por residente/bloque y FALLBACK greybox garantizado:
 * cualquier fallo (sin manifiesto, 404, glTF inválido) devuelve null y el llamador
 * sigue con la cápsula/caja — el juego nunca se rompe por un asset.
 *
 * Todo data-driven: rutas, escalas nominales y clips de animación viven en el manifiesto.
 */
import type { AnimationGroup, AssetContainer, Material, Scene, TransformNode } from '@babylonjs/core';
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
  /** Reproduce un clip lógico (null = por defecto). Idempotente. */
  play(clip: string | null): void;
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
    const rig: ActorRig = {
      root,
      groups,
      defaultClip,
      current: null,
      group: null,
      play(clip) {
        const key = clip && groups.has(clip) ? clip : defaultClip;
        if (key === rig.current) return;
        rig.group?.stop();
        rig.current = key;
        rig.group = key ? groups.get(key)! : null;
        rig.group?.start(true);
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
