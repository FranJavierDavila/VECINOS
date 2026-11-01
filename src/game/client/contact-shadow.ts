import type { Mesh, Ray, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { B } from './babylon';

/**
 * v1.63 — SOMBRA DE CONTACTO SIMULADA (petición del vecino: «una sombra de contacto
 * simulada entre el personaje y el suelo para que dé la sensación de que está realmente
 * sobre el suelo»).
 *
 * La sombra de verdad (v1.32) cuelga del SOL direccional: con el sol bajo o ladeado, la
 * sombra del personaje cae a metros de sus pies y el cuerpo parece FLOTAR. El remedio
 * clásico de todo juego 3D es el «blob shadow»: un disco oscuro con degradado radial
 * pegado bajo los pies, que no depende de ninguna luz.
 *
 * Cómo funciona (100% data-driven, rules.view.shadows.contact):
 *  · UNA textura radial COMPARTIDA (DynamicTexture 128×128, negro con alfa que cae al
 *    borde) y UN material compartido — N discos cuestan casi lo mismo que uno.
 *  · Un disco por personaje (jugador, vecinos y avatares remotos: todos pasan por
 *    actors.ts). Se coloca cada frame bajo el cuerpo y se PEGA al suelo REAL con un
 *    raycast hacia abajo: forjados, acera, peldaños de la escalera (cada peldaño su
 *    sombra) y suelo del ascensor. Los parados NO re-rayan (reposo: el raycast solo
 *    se repite si el cuerpo se mueve, cambia de altura o vence la cadencia larga).
 *  · Anti-coplanar por construcción: el disco vive a `offset` (2,2 cm) sobre la
 *    superficie encontrada, y su normal se alinea a la del suelo (en rampa, se ladea).
 *  · Se desvanece con la altura (un cuerpo que cae suelta la sombra: opacidad baja y
 *    disco se ensancha `stretch` por metro) y con el fundido del propio actor.
 *  · Los discos están EXCLUÍDOS del generador de sombras del sol (rules.view.shadows.
 *    excluded: 'contact_shadow') — su nombre contiene 'res_' y sin la exclusión el
 *    refresco de v1.32 los apuntaría como proyectores.
 *
 * Solo presentación: no toca el sim, no toca colisiones, no crea ni destruye actores.
 */

export interface ContactShadowCfg {
  enabled: boolean;
  /** Radio del disco en m. */
  radius: number;
  /** Opacidad máxima en el centro (0..1). */
  opacity: number;
  /** Tinte del disco (hex). */
  color: string;
  /** Separación sobre el suelo en m (anti-coplanar). */
  offset: number;
  /** Altura sobre el suelo a la que la sombra ya no se ve (m). */
  maxRise: number;
  /** Ensanchamiento del disco por metro de altura. */
  stretch: number;
  /** Segundos entre raycasts por personaje en movimiento. */
  rayEvery: number;
  /** Altura del origen del rayo sobre los pies (m). */
  rayUp: number;
}

const DEFAULTS: ContactShadowCfg = {
  enabled: true,
  radius: 0.46,
  opacity: 0.4,
  color: '#0c0d10',
  offset: 0.022,
  maxRise: 2.6,
  stretch: 0.35,
  rayEvery: 0.09,
  rayUp: 0.55,
};

/** Lo mínimo que el sistema necesita de cada actor de actors.ts (tipado estructural). */
export interface ShadowSubject {
  /** Nodo posicionable: cápsula greybox o raíz del rig glTF. */
  node: Mesh | TransformNode;
  /** Offset Y del pivote: pies = node.position.y − pivotY (± corrección tumbado). */
  pivotY: number;
  /** Fundido del teatro (0..1). */
  fade: number;
  /** Pose tumbada: el nodo está ELEVADO (height·0.22): el suelo real queda más abajo. */
  lying: boolean;
  height: number;
}

export interface ContactShadowSystem {
  /** Pase por frame: crea/sincroniza/oculta discos. Idempotente. */
  update(subjects: Map<string, ShadowSubject>): void;
  /** El residente se fue: fuera su disco. */
  remove(id: string): void;
  dispose(): void;
}

interface DiscState {
  disc: Mesh;
  groundY: number;
  lastRayAt: number;
  /** Metros andados desde el último rayo (el gate de movimiento del cadencer). */
  walked: number;
  /** Posición del frame ANTERIOR (para acumular distancia real andada). */
  prevX: number;
  prevZ: number;
  /** Pies en el último rayo: detecta cambio de ALTURA del cuerpo (escalera/ascensor). */
  lastFeetY: number;
  hasGround: boolean;
}

export function createContactShadows(scene: Scene, cfgIn: Partial<ContactShadowCfg> | null | undefined): ContactShadowSystem | null {
  const cfg: ContactShadowCfg = { ...DEFAULTS, ...(cfgIn ?? {}) };
  if (!cfg.enabled) return null;
  const { Color3, DynamicTexture, MeshBuilder, Quaternion, Ray, StandardMaterial, Vector3 } = B();

  // ── Textura radial COMPARTIDA: negro con alfa que cae al borde (canvas determinista).
  const S = 128;
  const tex = new DynamicTexture('contact_shadow_tex', { width: S, height: S }, scene, true);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, S, S);
  const grad = ctx.createRadialGradient(S / 2, S / 2, S * 0.04, S / 2, S / 2, S * 0.5);
  grad.addColorStop(0, 'rgba(0,0,0,0.95)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.62)');
  grad.addColorStop(0.8, 'rgba(0,0,0,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  tex.update();
  tex.hasAlpha = true;

  // ── Material compartido: disco NEGRO (color×textura = negro bajo cualquier luz),
  //  alfa de la textura × opacity global. Sin respuestas raras de disableLighting.
  const mat = new StandardMaterial('contact_shadow_mat', scene);
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  mat.diffuseColor = Color3.FromHexString(cfg.color);
  mat.specularColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(0, 0, 0);
  mat.alpha = cfg.opacity;
  mat.backFaceCulling = false; // en rampa el disco se puede ver casi de canto
  // (receiveShadows es propiedad de AbstractMesh, no de Material; los discos nacen sin
  //  recibir sombras — el comportamiento deseado — así que no hay nada que apagar aquí).

  const discs = new Map<string, DiscState>();
  const up = new Vector3(0, 1, 0);
  /** Normal LOCAL del disco: CreateDisc nace en el plano XY mirando a +Z (no a +Y).
   *  El anclaje rota de +Z local a la normal del suelo — sobre suelo plano identity·+Z
   *  quedaría el disco VERTICAL (una pared negra a los pies): este eje es el que manda. */
  const zAxis = new Vector3(0, 0, 1);
  const down = new Vector3(0, -1, 0);
  const ray = new Ray(Vector3.Zero(), down.clone(), cfg.rayUp + cfg.maxRise + 0.4);
  const hitNormal = new Vector3(0, 1, 0);
  const nq = new Quaternion();
  const originY = new Vector3();

  const predicate = (prefixes: string[], mesh: Mesh): boolean => {
    const n = mesh.name;
    if (!n || n.startsWith('contact_shadow')) return false;
    for (const p of prefixes) {
      if (n === p || n.startsWith(`${p}_`)) return false; // cuerpos, rigs, carry, paraguas…
    }
    return mesh.isPickable !== false && mesh.isVisible !== false;
  };

  return {
    update(subjects: Map<string, ShadowSubject>): void {
      const now = performance.now() / 1000;
      // Prefijos a excluir del raycast: TODOS los cuerpos de actores (no solo el propio:
      // una sombra no debe aterrizar sobre la cabeza del vecino que pasa por debajo).
      const prefixes = Array.from(subjects.keys());
      for (const [id, s] of subjects) {
        let st = discs.get(id);
        if (!st) {
          const disc = MeshBuilder.CreateDisc(`contact_shadow_${id}`, { radius: cfg.radius, tessellation: 24 }, scene);
          disc.material = mat;
          disc.isPickable = false;
          disc.receiveShadows = false;
          disc.rotationQuaternion = Quaternion.Identity();
          st = { disc, groundY: Number.NaN, lastRayAt: -1e9, walked: 0, prevX: Number.NaN, prevZ: Number.NaN, lastFeetY: Number.NaN, hasGround: false };
          discs.set(id, st);
        }
        const visible = s.node.isEnabled(true) && s.fade > 0.04;
        if (!visible) {
          if (st.disc.isEnabled()) st.disc.setEnabled(false);
          st.hasGround = false;
          continue;
        }
        const p = s.node.position;
        // Suelo bajo los pies (misma fórmula que la hoja de sprites v1.46: el tumbado
        // lleva el nodo ELEVADO height·0.22 — el suelo real queda más abajo).
        const feetY = p.y - s.pivotY - (s.lying ? s.height * 0.22 : 0);
        // Reposo de verdad: se acumula la distancia ANDADA desde el último rayo (comparar
        // contra la posición del último rayo dispararía en cada frame a velocidad lenta) y
        // se detecta el cambio de ALTURA del CUERPO (comparar pies contra suelo encontrado
        // dispararía siempre: el cuerpo vive 0,14 m por encima del forjado por su margen).
        if (Number.isFinite(st.prevX)) st.walked += Math.hypot(p.x - st.prevX, p.z - st.prevZ);
        st.prevX = p.x;
        st.prevZ = p.z;
        const due = now - st.lastRayAt >= cfg.rayEvery;       // cadencia en movimiento
        const stale = now - st.lastRayAt > cfg.rayEvery * 5;  // red de seguridad en reposo
        const vertical = !Number.isNaN(st.lastFeetY) && Math.abs(feetY - st.lastFeetY) > 0.06;
        if (!st.hasGround || stale || (due && (st.walked > 0.04 || vertical))) {
          st.lastRayAt = now;
          st.walked = 0;
          st.lastFeetY = feetY;
          originY.set(p.x, feetY + cfg.rayUp, p.z);
          ray.origin.copyFrom(originY);
          ray.length = cfg.rayUp + cfg.maxRise + 0.4;
          const hit = scene.pickWithRay(ray, (m) => predicate(prefixes, m as Mesh));
          if (hit && hit.hit && hit.pickedPoint) {
            st.groundY = hit.pickedPoint.y;
            const n = hit.getNormal(true);
            if (n && n.lengthSquared() > 0) hitNormal.copyFrom(n).normalize();
            else hitNormal.copyFrom(up);
            st.hasGround = feetY - st.groundY <= cfg.maxRise;
          } else {
            st.hasGround = false; // sin suelo debajo: la sombra se esconde (no flota)
          }
        }
        if (!st.hasGround) {
          if (st.disc.isEnabled()) st.disc.setEnabled(false);
          continue;
        }
        const rise = Math.max(0, feetY - st.groundY);
        // Fundido por altura (0 en el suelo, 0 a maxRise) × fundido del teatro.
        const k = Math.max(0, Math.min(1, 1 - rise / cfg.maxRise)) * Math.max(0, Math.min(1, s.fade));
        if (k <= 0.02) {
          if (st.disc.isEnabled()) st.disc.setEnabled(false);
          continue;
        }
        const spread = 1 + rise * cfg.stretch;
        st.disc.setEnabled(true);
        st.disc.position.set(p.x, st.groundY + cfg.offset, p.z);
        st.disc.scaling.setAll(spread);
        st.disc.visibility = k;
        // Alinear el disco a la NORMAL del suelo (rampa de escalera suave = se ladea):
        // de la normal LOCAL del disco (+Z) hacia la del suelo — con 'up' el disco plano
        // quedaría de canto (CreateDisc mira a +Z, no a +Y).
        Quaternion.FromUnitVectorsToRef(zAxis, hitNormal, nq);
        if (!st.disc.rotationQuaternion) st.disc.rotationQuaternion = Quaternion.Identity();
        const q = st.disc.rotationQuaternion!;
        q.copyFrom(nq);
      }
      // Discos huérfanos (el subject desapareció sin remove): limpieza barata.
      for (const [id, st] of discs) {
        if (!subjects.has(id)) {
          st.disc.dispose();
          discs.delete(id);
        }
      }
    },
    remove(id: string): void {
      const st = discs.get(id);
      if (!st) return;
      st.disc.dispose();
      discs.delete(id);
    },
    dispose(): void {
      for (const [, st] of discs) st.disc.dispose();
      discs.clear();
      mat.dispose();
      tex.dispose();
    },
  };
}
