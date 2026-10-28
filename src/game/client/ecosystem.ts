import type { Color3, Mesh, Scene, StandardMaterial, TransformNode } from '@babylonjs/core';
import type { BlockInstance, Content, EcosystemContent, EcosystemDeteriorationRule, PlayerPosition, World } from '@/game/core/types';
import { B } from './babylon';
import { instantiateActorAsset, type ActorRig } from './assets';
import { hash01 } from '@/game/interior';
import { frontPlaneZ, stairPathPoints } from '@/game/stairs';
import { MODEL_YAW_OFFSET } from './actors';
import { inMinuteWindow } from '@/game/sim';
import {
  createEcosystemState,
  evaluateEcosystem,
  type EcosystemReport,
  type EcosystemState,
  type EcosystemVendorStage,
} from '@/game/ecosystem';

/**
 * DIRECTOR VISUAL del ecosistema ("El edificio está vivo", v1.14) — capa de presentación
 * Babylon. El CEREBRO puro (src/game/ecosystem.ts) decide cuándo y qué; este módulo:
 *  - llama a evaluateEcosystem a la cadencia del catálogo y ejecuta el staging del report;
 *  - mueve a los EXTRAS (vendedor y mascota, nodos propios, nunca residents del sim) con la
 *    LEY INVIOLABLE de locomoción: el avance en X SOLO ocurre sobre la línea del pasillo
 *    z = view.corridorZ (fuera de la banda de bloques); entrar/salir de la banda (z > frontZ)
 *    ocurre SOLO en vertical (cambio de z) y únicamente en la X del bloque destino. Cambios
 *    de planta SIEMPRE por la escalera real (stairPathPoints) tras caminar hasta su pozo.
 *    Nada de teletransportes.
 *  - dibuja las LUCES de pasillo por planta (el param `lighting` del sim manda; en apagón,
 *    la planta ocupada se ilumina tenue);
 *  - pinta el DETERIORO con decals perezosos que leen params REALES del world.
 * Todo tunable vive en public/content/ecosystem.json: sin ese fichero, director nulo.
 */

/** Tramo de ruta de un extra. `pauseAfter` encadena una pausa teatral al llegar. */
interface Leg {
  x: number;
  y: number; // nivel de PIES (floor·cellH + canto del forjado)
  z: number;
  pauseAfter?: { seconds: number; sway?: boolean; stain?: boolean };
  despawn?: boolean;
}

interface Extra {
  kind: 'vendor' | 'pet';
  id: string;
  node: TransformNode | Mesh;
  /** Cápsula greybox (fallback) mientras el rig glTF carga; null cuando hay rig. */
  capsule: Mesh | null;
  rig: ActorRig | null;
  /** Offset del pivote: cápsula centrada (+h/2) o modelo con pies en el origen. */
  pivotY: number;
  path: Leg[];
  yaw: number;
  targetYaw: number | null;
  /** Posición previa (para mirar hacia donde camina). */
  px: number;
  pz: number;
  /** Pausa en curso (llamar a una puerta / mascota husmeando). */
  pauseT: number;
  sway: boolean;
  /** Mascota: dirección del ping-pong y salida hacia casa. */
  dir: 1 | -1;
  exiting: boolean;
  /** v1.36 — desfase de MODELO: el yaw interno mira a +X; los rigs de actor ya nacen así
   *  (MODEL_YAW_OFFSET = 0), pero el PERRO está modelado mirando a +Z (hocico en +Z) — sin
   *  desfase anda de LADO. +π/2 gira el +Z del modelo hacia el +X de la ruta. */
  yawOffset?: number;
  /** v1.34 — animación propia del cuadrúpedo (patas, cola, cabeza): caminando + fase. */
  animate?: (walking: boolean, dt: number) => void;
}

export interface EcosystemDirector {
  /** Refresco por frame: cerebro, extras, luces por planta y deterioro. */
  update(dt: number): void;
  /** Desmonta nodos, materiales y manchas (cambio de mundo/escena). */
  dispose(): void;
  /** Último report del cerebro (null hasta la primera evaluación). */
  readonly report: EcosystemReport | null;
  /** Estado interno del cerebro (serializable; vive AQUÍ, no en World). */
  readonly state: EcosystemState;
  /** v1.40 — ¿hay un APAGÓN activo ahora mismo? (la linterna del jugador lo lee). */
  isBlackout(): boolean;
  /** Posiciones de los extras en escena (v1.26): abren puertas de escalera y encienden
   *  su luz compartida igual que los vecinos — el repartidor ya no llega a puertas cerradas. */
  extraPositions(): { x: number; y: number; z: number }[];
}

export function createEcosystem(
  scene: Scene,
  world: World,
  content: Content,
  getPlayerPos: () => PlayerPosition,
): EcosystemDirector {
  const eco: EcosystemContent | undefined = content.ecosystem;
  if (!eco) {
    // Sin catálogo: director nulo funcional (la partida no depende del ecosistema).
    return { update() {}, dispose() {}, report: null, state: createEcosystemState(), extraPositions: () => [], isBlackout: () => false };
  }

  const { Color3, Mesh, MeshBuilder, Quaternion, StandardMaterial, TransformNode, Vector3 } = B();
  const v = content.rules.view;
  const frontZ = frontPlaneZ(v); // plano frontal de los bloques: la cara de las puertas
  /** Nivel de pies en el pasillo de una planta (el canto del forjado, igual que los vecinos). */
  const feetOf = (floor: number): number => floor * v.cellH + v.slab * 2;
  const shaftXOf = (b: BlockInstance): number => (b.cell.col + b.size.w / 2) * v.cellW;
  const centerOf = (b: BlockInstance): number => (b.cell.col + b.size.w / 2) * v.cellW;
  /** z "delante de la puerta": la convención de rutas de actors.ts al entrar en la banda. */
  const doorZ = frontZ + 0.45;

  const brain = createEcosystemState();
  let disposed = false;
  let lastTick = world.tick;
  let lastReport: EcosystemReport | null = null;
  let swayClock = 0;

  const corridorOfFloor = (floor: number): BlockInstance | null =>
    Object.values(world.blocks).find((b) => b.layer === 'corridor' && b.cell.floor === floor) ?? null;

  // ───────────────────────── Extras (vendedor y mascota) ─────────────────────────

  const extras = new Map<string, Extra>();
  let vendorActive = false;
  let petMission: string | null = null;

  /** Vendedor: cápsula del color del arquetipo + swap async al rig del manifiesto (patrón ensureActor). */
  const spawnVendor = (stage: EcosystemVendorStage, x: number, feetY: number, z: number): Extra => {
    const arch = content.archetypes[stage.archetype];
    const color = arch?.view?.color ?? v.actorFallbackColor;
    const height = arch?.view?.height ?? v.actorFallbackHeight;
    const capsule = MeshBuilder.CreateCapsule('eco_vendedor', { height, radius: v.actorRadius }, scene);
    const m = new StandardMaterial('eco_vendedor_mat', scene);
    m.diffuseColor = Color3.FromHexString(color);
    m.emissiveColor = m.diffuseColor.scale(0.25);
    capsule.material = m;
    capsule.isPickable = false;
    capsule.position.set(x, feetY + height / 2, z);
    const extra: Extra = {
      kind: 'vendor',
      id: 'eco_vendedor',
      node: capsule,
      capsule,
      rig: null,
      pivotY: height / 2,
      path: [],
      yaw: 0,
      targetYaw: null,
      px: x,
      pz: z,
      pauseT: 0,
      sway: false,
      dir: 1,
      exiting: false,
    };
    extras.set(extra.id, extra);

    // Arte final (opcional): modelo del manifiesto; cualquier fallo → cápsula permanente.
    const def = content.assets?.actors?.[stage.archetype];
    if (def && content.assets) {
      void instantiateActorAsset(scene, def, content.assets.base, extra.id).then((rig) => {
        if (rig && scene.isDisposed) {
          rig.dispose();
          return;
        }
        if (!rig) return; // fallback greybox permanente
        const cur = extras.get(extra.id);
        if (!cur || cur.rig || disposed) {
          rig.dispose(); // el extra se fue (o ya llegó otro rig): no dejar basura
          return;
        }
        // PRESERVAR POSE (v1.10): el modelo puede terminar de cargar EN PLENO paseo.
        const feetYNow = cur.node.position.y - cur.pivotY;
        rig.root.position.set(cur.node.position.x, feetYNow + 0.02, cur.node.position.z);
        if (rig.root.rotationQuaternion) Quaternion.RotationYawPitchRollToRef(cur.yaw + MODEL_YAW_OFFSET, 0, 0, rig.root.rotationQuaternion);
        else rig.root.rotation.y = cur.yaw + MODEL_YAW_OFFSET;
        rig.root.scaling.setAll(height / def.nominalHeight);
        cur.capsule?.dispose(false, true);
        cur.node = rig.root;
        cur.capsule = null;
        cur.pivotY = 0.02;
        cur.rig = rig;
      });
    }
    return extra;
  };

  /** Tramos de escalera real entre dos niveles de pies (mismo contrato que actors.ts). */
  const pushStairs = (legs: Leg[], sx: number, y0: number, y1: number): void => {
    for (const pt of stairPathPoints(v, sx, y0, y1)) legs.push({ x: pt.x, y: pt.y, z: pt.z });
  };

  /** Vendedor: portal → pasillo → escalera → pasillo de la planta → puertas → bajar → portal. */
  const startVendor = (stage: EcosystemVendorStage): void => {
    if (vendorActive || disposed) return; // un vendedor a la vez: el teatro no se pisa
    const stairs = world.blocks[stage.stairsBlock];
    const entry = world.blocks[world.entry] ?? corridorOfFloor(0);
    if (!stairs || !entry) return;
    const sx = shaftXOf(stairs);
    const y0 = feetOf(0);
    const yFloor = feetOf(stage.floor);
    if (stairPathPoints(v, sx, y0, yFloor).length <= 1) return; // sin geometría de escalera: no hay teatro posible
    vendorActive = true;
    const legs: Leg[] = [
      { x: centerOf(entry), y: y0, z: v.corridorZ },
      { x: sx, y: y0, z: v.corridorZ },
    ];
    pushStairs(legs, sx, y0, yFloor);
    legs.push({ x: sx, y: yFloor, z: v.corridorZ }); // salida del cubo al pasillo (idempotente)
    for (const doorId of stage.doors) {
      const door = world.blocks[doorId];
      if (!door) continue;
      const dx = centerOf(door);
      legs.push({ x: dx, y: yFloor, z: v.corridorZ });
      legs.push({ x: dx, y: yFloor, z: doorZ, pauseAfter: { seconds: eco.extras.vendor.knockPauseSec, sway: true } });
      legs.push({ x: dx, y: yFloor, z: v.corridorZ });
    }
    legs.push({ x: sx, y: yFloor, z: v.corridorZ });
    pushStairs(legs, sx, yFloor, y0);
    legs.push({ x: sx, y: y0, z: v.corridorZ });
    legs.push({ x: centerOf(entry), y: y0, z: v.corridorZ, despawn: true });
    spawnVendor(stage, centerOf(entry), y0, v.corridorZ).path = legs;
  };

  /** Mascota (v1.34 — «que parezca un animal»): PERRO de verdad, no dos cajas. Cuerpo
   *  con pecho, cabeza con hocico y orejas caídas, cuatro PATAS que caminan (pivote en la
   *  cadera, trote en diagonal), COLA que menea y collar. Medidas y color del catálogo
   *  (ecosystem.extras.pet); el meneo es determinista (fase = camino recorrido). */
  const spawnPet = (corridor: BlockInstance): Extra => {
    const p = eco.extras.pet;
    const legH = p.legH ?? 0.16; // patas del catálogo (fallback razonable si falta)
    const root = new TransformNode('eco_mascota', scene);
    const m = new StandardMaterial('eco_mascota_mat', scene);
    m.diffuseColor = Color3.FromHexString(p.color);
    m.specularColor = new Color3(0, 0, 0);
    const mDark = new StandardMaterial('eco_mascota_oscura_mat', scene);
    mDark.diffuseColor = Color3.FromHexString(p.color).scale(0.62);
    mDark.specularColor = new Color3(0, 0, 0);
    const mLight = new StandardMaterial('eco_mascota_clara_mat', scene);
    mLight.diffuseColor = Color3.FromHexString(p.color).scale(1.35);
    mLight.specularColor = new Color3(0, 0, 0);
    const collarM = new StandardMaterial('eco_mascota_collar_mat', scene);
    collarM.diffuseColor = Color3.FromHexString(p.collar ?? '#c0392b');
    collarM.specularColor = new Color3(0, 0, 0);
    const noseM = new StandardMaterial('eco_mascota_nariz_mat', scene);
    noseM.diffuseColor = Color3.FromHexString('#2b2420');
    noseM.specularColor = new Color3(0, 0, 0);
    const part = (name: string, w: number, h: number, d: number, mat: StandardMaterial): Mesh => {
      const b = MeshBuilder.CreateBox(`eco_mascota_${name}`, { width: w, height: h, depth: d }, scene);
      b.material = mat;
      b.isPickable = false;
      b.parent = root;
      return b;
    };
    // Cuerpo (tórax + pecho más bajo delante) y cuello que sube a la cabeza.
    const bodyL = p.bodyW * 1.5;
    const body = part('cuerpo', p.bodyW, p.bodyH, bodyL, m);
    body.position.set(0, p.bodyH * 0.62 + legH * 0.5, 0);
    const chest = part('pecho', p.bodyW * 0.92, p.bodyH * 0.78, bodyL * 0.34, m);
    chest.position.set(0, p.bodyH * 0.5 + legH * 0.5, bodyL * 0.3);
    const neck = part('cuello', p.bodyW * 0.42, p.bodyH * 0.62, p.bodyW * 0.42, m);
    neck.position.set(0, p.bodyH * 1.06 + legH * 0.5, bodyL * 0.5);
    // Cabeza + hocico + nariz + ojos + OREJAS CAÍDAS (lo que hace que se lea «perro»).    
    const headS = p.bodyH * p.headScale * 2;
    const head = part('cabeza', headS, headS * 0.86, headS * 1.06, m);
    head.position.set(0, p.bodyH * 1.34 + legH * 0.5, bodyL * 0.62);
    const snout = part('hocico', headS * 0.44, headS * 0.34, headS * 0.52, mLight);
    snout.position.set(0, head.position.y - headS * 0.12, bodyL * 0.62 + headS * 0.68);
    const nose = part('nariz', headS * 0.16, headS * 0.14, headS * 0.14, noseM);
    nose.position.set(0, snout.position.y + headS * 0.08, bodyL * 0.62 + headS * 0.96);
    const eyeL = part('ojo_i', headS * 0.1, headS * 0.1, headS * 0.08, noseM);
    eyeL.position.set(-headS * 0.24, head.position.y + headS * 0.14, bodyL * 0.62 + headS * 0.44);
    const eyeR = part('ojo_d', headS * 0.1, headS * 0.1, headS * 0.08, noseM);
    eyeR.position.set(headS * 0.24, eyeL.position.y, eyeL.position.z);
    const earL = part('oreja_i', headS * 0.16, headS * 0.42, headS * 0.1, mDark);
    earL.setPivotPoint(new Vector3(0, headS * 0.21, 0));
    earL.position.set(-headS * 0.5, head.position.y + headS * 0.3, bodyL * 0.62);
    earL.rotation.z = -0.5; // caída hacia fuera
    const earR = part('oreja_d', headS * 0.16, headS * 0.42, headS * 0.1, mDark);
    earR.setPivotPoint(new Vector3(0, headS * 0.21, 0));
    earR.position.set(headS * 0.5, earL.position.y, earL.position.z);
    earR.rotation.z = 0.5;
    // Collar: aro fino bajo la cabeza.
    const collar = MeshBuilder.CreateTorus('eco_mascota_collar', { diameter: headS * 0.78, thickness: headS * 0.09, tessellation: 14 }, scene);
    collar.material = collarM;
    collar.isPickable = false;
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, p.bodyH * 1.16 + legH * 0.5, bodyL * 0.55);
    collar.parent = root;
    // Cuatro patas con pivote en la CADERA (trote en diagonal: i+z con d−z).
    const legW = Math.max(0.055, p.bodyW * 0.16);
    const legs: Mesh[] = [];
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
      const leg = part(`pata_${sx < 0 ? 'i' : 'd'}${sz > 0 ? 'd' : 't'}`, legW, legH, legW, mDark);
      leg.setPivotPoint(new Vector3(0, legH / 2, 0));
      leg.position.set(sx * p.bodyW * 0.34, legH + p.bodyH * 0.1, sz * bodyL * 0.32);
      legs.push(leg);
    }
    // Cola con pivote en la base: meneo (determinista) — el signo vivo del perro.
    const tail = part('cola', legW * 0.7, p.bodyH * 0.78, legW * 0.7, mDark);
    tail.setPivotPoint(new Vector3(0, p.bodyH * 0.39, 0));
    tail.position.set(0, body.position.y + p.bodyH * 0.3, -bodyL * 0.52);
    tail.rotation.x = 0.7; // en alto, donde la cola feliz
    const feetY = feetOf(corridor.cell.floor);
    const x0 = corridor.cell.col * v.cellW + 0.5;
    const x1 = (corridor.cell.col + corridor.size.w) * v.cellW - 0.5;
    const x = x0 + hash01('eco_mascota', 3) * (x1 - x0);
    root.position.set(x, feetY, v.corridorZ);
    let animT = hash01('eco_mascota', 11) * 6;
    const dir0: 1 | -1 = hash01('eco_mascota', 7) >= 0.5 ? 1 : -1;
    const extra: Extra = {
      kind: 'pet',
      id: 'eco_mascota',
      node: root,
      capsule: null,
      rig: null,
      pivotY: 0,
      path: [],
      yaw: dir0 > 0 ? 0 : Math.PI, // ya NACE mirando a donde va (v1.36)
      targetYaw: null,
      yawOffset: Math.PI / 2, // modelo mirando a +Z → ruta a +X (adiós al ladito)
      px: x,
      pz: v.corridorZ,
      pauseT: p.pauseSeconds,
      sway: false,
      dir: dir0,
      exiting: false,
      animate(walking, dt) {
        animT += dt * (walking ? 9 : 2.2);
        const swing = walking ? 0.62 : 0.06;
        // Trote en diagonal: pata i+z con d−z (las de un lado con las del otro).
        legs[0]!.rotation.x = Math.sin(animT) * swing;
        legs[3]!.rotation.x = Math.sin(animT) * swing;
        legs[1]!.rotation.x = -Math.sin(animT) * swing;
        legs[2]!.rotation.x = -Math.sin(animT) * swing;
        // Cola: meneo lateral siempre (rápido al andar, perezoso en la pausa) + rebote.
        tail.rotation.z = Math.sin(animT * (walking ? 1.7 : 1)) * (walking ? 0.55 : 0.3);
        tail.rotation.x = 0.7 + Math.sin(animT * 0.9) * 0.08;
        // Cabeza: al husmear (pausa) baja un poco y orea; al andar, firme con botecito.
        const headY = p.bodyH * 1.34 + legH * 0.5;
        head.position.y = headY + (walking ? Math.abs(Math.sin(animT)) * 0.02 : Math.sin(animT * 0.7) * 0.015);
        snout.position.y = head.position.y - headS * 0.12;
        earL.rotation.x = walking ? Math.sin(animT) * 0.12 : Math.sin(animT * 0.5) * 0.05;
        earR.rotation.x = -earL.rotation.x;
        // Cuerpo: trotecito (SIN tocar la raíz: el bucle de movimiento manda la posición).
        body.rotation.x = walking ? Math.sin(animT * 2) * 0.015 : 0;
      },
    };
    extra.animate?.(false, 0);
    extras.set(extra.id, extra);
    return extra;
  };

  /** Ruta de un extra (en la línea del pasillo) hasta la puerta de un bloque: ley del pasillo. */
  const routeToDoor = (e: Extra, target: BlockInstance, despawn: boolean): boolean => {
    const fromFloor = Math.round((e.node.position.y - e.pivotY) / v.cellH);
    const yTarget = feetOf(target.cell.floor);
    const legs: Leg[] = [];
    if (fromFloor !== target.cell.floor) {
      const stairsHere =
        Object.values(world.blocks).find((b) => b.cell.floor === fromFloor && content.blocks[b.defId]?.features?.stairs === true) ?? null;
      if (!stairsHere) return false; // estado imposible: sin pozo, el extra se queda donde está
      const sx = shaftXOf(stairsHere);
      legs.push({ x: sx, y: feetOf(fromFloor), z: v.corridorZ });
      pushStairs(legs, sx, feetOf(fromFloor), yTarget);
      legs.push({ x: sx, y: yTarget, z: v.corridorZ });
    }
    const tx = centerOf(target);
    legs.push({ x: tx, y: yTarget, z: v.corridorZ });
    legs.push({ x: tx, y: yTarget, z: doorZ });
    legs.push({ x: tx, y: yTarget, z: v.corridorZ, despawn });
    e.path = legs;
    e.exiting = true;
    return true;
  };

  const despawnExtra = (e: Extra): void => {
    extras.delete(e.id);
    if (e.rig) e.rig.dispose();
    e.node.dispose(false, true);
    if (e.kind === 'vendor') vendorActive = false;
  };

  // ───────────────────────── Manchas de la mascota ─────────────────────────

  const stains: { mesh: Mesh; mat: StandardMaterial; t: number }[] = [];

  const dropStain = (e: Extra): void => {
    const p = eco.extras.pet;
    const floor = Math.round((e.node.position.y - e.pivotY) / v.cellH);
    const mat = new StandardMaterial(`eco_mancha_${stains.length}_mat`, scene);
    mat.diffuseColor = Color3.FromHexString(p.color).scale(0.4);
    mat.emissiveColor = Color3.FromHexString(p.color).scale(0.08);
    mat.specularColor = new Color3(0, 0, 0);
    mat.alpha = p.stainOpacity;
    const mesh = MeshBuilder.CreatePlane(`eco_mancha_${stains.length}`, { width: p.stainW, height: p.stainH, sideOrientation: Mesh.DOUBLESIDE }, scene);
    mesh.rotation.x = Math.PI / 2; // mirando a +Y: sobre el suelo del pasillo
    mesh.position.set(e.node.position.x, floor * v.cellH + v.slab * 2 + 0.015, v.corridorZ);
    mesh.material = mat;
    mesh.isPickable = false;
    stains.push({ mesh, mat, t: 0 });
  };

  const updateStains = (dt: number): void => {
    for (let i = stains.length - 1; i >= 0; i--) {
      const s = stains[i]!;
      s.t += dt;
      const k = Math.max(0, 1 - s.t / eco.extras.pet.stainFadeSec);
      s.mat.alpha = eco.extras.pet.stainOpacity * k;
      if (k <= 0) {
        s.mesh.dispose();
        s.mat.dispose();
        stains.splice(i, 1);
      }
    }
  };

  // ───────────────────────── Consumo de rutas de los extras ─────────────────────────

  const stepExtra = (e: Extra, dt: number): boolean => {
    // false = hay que despawnear
    if (e.pauseT > 0) {
      e.pauseT -= dt;
      if (e.sway) e.node.rotation.y = e.yaw + MODEL_YAW_OFFSET + Math.sin(swayClock * 3.2) * 0.35; // balanceo al llamar
      // v1.26: el vendedor QUE LLAMA gestiona (habla a la puerta): clip de charla si existe.
      if (e.rig && e.sway) e.rig.play('talk', 1);
      else if (e.rig) e.rig.play('idle', 1);
      // v1.34: el perro en pausa husmea (cola lenta, cabeza baja) — vida en el quieto.
      e.animate?.(false, dt);
      return true;
    }
    const leg = e.path[0];
    if (!leg) return true; // sin cola: el extra espera su próxima pata (la misión/el plan manda)
    const pos = e.node.position;
    const feetY = pos.y - e.pivotY;
    const dH = Math.hypot(leg.x - pos.x, leg.z - pos.z);
    const dY = leg.y - feetY;
    const speed = e.kind === 'vendor' ? eco.extras.walkSpeed : eco.extras.pet.walkSpeed;
    // v1.26 — umbral vertical 0.05 (el mismo arreglo de actors.ts v1.23): con 0.3 los
    // PELDAÑOS de la escalera real (run ≈ 0.27 m) caían en la rama vertical — el extra
    // subía como un ascensor y LUEGO patinaba en horizontal hasta el siguiente peldaño.
    if (Math.abs(dY) > 0.02 && dH < 0.05) {
      // Tramo VERTICAL en el pozo: ritmo de la escalera del catálogo.
      const rate = v.cellH / v.stairsSeconds;
      pos.y = feetY + Math.sign(dY) * Math.min(Math.abs(dY), rate * dt) + e.pivotY;
    } else if (dH > 0.001) {
      // Tramo horizontal (o pendiente 3D de peldaño): crucero con reparto proporcional.
      const stepLen = Math.min(speed * dt, dH);
      const t = stepLen / dH;
      pos.x += (leg.x - pos.x) * t;
      pos.z += (leg.z - pos.z) * t;
      pos.y = feetY + dY * t + e.pivotY;
    }
    // v1.26 — el vendedor ANDA de verdad: clip de zancada sincronizado a la velocidad real
    // (antes el rig se quedaba en 'idle' mientras se deslizaba: "no se mueve y patina").
    if (e.rig) {
      const sync = v.animSync;
      const rate = Math.min(sync.maxRate, Math.max(sync.minRate, speed / Math.max(0.1, sync.walkRefSpeed)));
      e.rig.play('walk', rate);
    }
    // v1.34 — el cuadrúpedo anima su trote (patas en diagonal, cola, orejas) SOLO cuando
    // hay avance real; en tramo vertical (escalera) guarda las patas pegadas al cuerpo.
    e.animate?.(dH > 0.001 && Math.abs(dY) <= 0.02, dt);
    // Rumbo: el extra MIRA hacia donde camina (arco corto, ritmo del catálogo).
    const mdx = pos.x - e.px;
    const mdz = pos.z - e.pz;
    e.px = pos.x;
    e.pz = pos.z;
    if (Math.hypot(mdx, mdz) / Math.max(1e-4, dt) > 0.25) e.targetYaw = Math.atan2(-mdz, mdx);
    if (e.targetYaw !== null) {
      let dYaw = e.targetYaw - e.yaw;
      dYaw = (((dYaw + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      if (Math.abs(dYaw) < 0.02) {
        e.yaw = e.targetYaw;
        e.targetYaw = null;
      } else {
        e.yaw += dYaw * Math.min(1, dt * v.actorTurnSpeed);
      }
    }
    const modelYaw = e.yaw + (e.yawOffset ?? MODEL_YAW_OFFSET);
    if (e.node.rotationQuaternion) Quaternion.RotationYawPitchRollToRef(modelYaw, 0, 0, e.node.rotationQuaternion);
    else e.node.rotation.y = modelYaw;
    // Pata terminada → siguiente (o pausa teatral / despawn marcado).
    if (Math.hypot(leg.x - pos.x, leg.z - pos.z) < 0.06 && Math.abs(leg.y - (pos.y - e.pivotY)) < 0.03) {
      e.path.shift();
      if (leg.despawn) return false;
      if (leg.pauseAfter) {
        e.pauseT = leg.pauseAfter.seconds;
        e.sway = !!leg.pauseAfter.sway;
        if (leg.pauseAfter.stain) dropStain(e);
      }
    }
    return true;
  };

  // ───────────────────────── Mascota: la misión manda ─────────────────────────

  const missionBlockOf = (missionId: string): BlockInstance | null => {
    const step = content.missions[missionId]?.steps.find((s) => s.type === 'reach' || s.type === 'enter');
    if (!step) return null;
    const ref = step.type === 'reach' ? step.target.block : step.type === 'enter' ? step.target : null;
    return ref ? world.blocks[ref] ?? null : null;
  };

  const updatePet = (): void => {
    if (!petMission || disposed) return;
    const m = world.missions.find((x) => x.id === petMission);
    const pet = extras.get('eco_mascota');
    if (!m) {
      if (pet) despawnExtra(pet); // la misión ya no existe: fuera
      petMission = null;
      return;
    }
    const open = m.state === 'active' || m.state === 'awaiting_choice';
    if (!pet) {
      // startMission (efecto del cerebro) deja la misión 'pending' hasta el próximo tick del
      // sim: NO se cancela el teatro por nacer un frame antes de la activación (v1.14-fix:
      // la carrera pending↔activación borraba petMission y la mascota jamás aparecía).
      if (m.state === 'pending') return;
      if (!open) {
        petMission = null;
        return;
      }
      const corridor = missionBlockOf(petMission);
      if (corridor) spawnPet(corridor);
      return;
    }
    if (!open && !pet.exiting) {
      // Misión cerrada (done/failed): camina hasta la puerta de su dueña (o al portal) y se va.
      const ownerId = m.roles.owner;
      const home = ownerId ? world.blocks[world.residents[ownerId]?.home ?? ''] : undefined;
      const target = home ?? world.blocks[world.entry] ?? corridorOfFloor(0);
      if (target) routeToDoor(pet, target, true);
      return;
    }
    if (open && !pet.exiting && pet.path.length === 0 && pet.pauseT <= 0) {
      // Paseo ping-pong por la línea del pasillo, con pausas que dejan mancha.
      const corridor = missionBlockOf(petMission);
      if (!corridor) return;
      const x0 = corridor.cell.col * v.cellW + 0.5;
      const x1 = (corridor.cell.col + corridor.size.w) * v.cellW - 0.5;
      const target = pet.node.position.x + pet.dir * eco.extras.pet.walkSpeed * eco.extras.pet.strollSeconds;
      const clamped = Math.min(x1, Math.max(x0, target));
      pet.path = [{ x: clamped, y: feetOf(corridor.cell.floor), z: v.corridorZ, pauseAfter: { seconds: eco.extras.pet.pauseSeconds, stain: true } }];
      pet.dir = clamped >= x1 ? -1 : clamped <= x0 ? 1 : pet.dir;
    }
  };

  // ───────────────────────── Luces de pasillo por planta ─────────────────────────

  const lamps = new Map<string, { mat: StandardMaterial; color: Color3; corridor: BlockInstance; lastIntensity: number }>();

  const ensureLamps = (): void => {
    for (const b of Object.values(world.blocks)) {
      if (b.layer !== 'corridor' || lamps.has(b.id)) continue;
      const color = Color3.FromHexString(eco.lights.color);
      const mat = new StandardMaterial(`${b.id}_lamparas_mat`, scene);
      mat.specularColor = new Color3(0, 0, 0);
      mat.diffuseColor = color.scale(0.2);
      mat.emissiveColor = color.scale(0);
      const size = eco.lights.lampSize;
      for (let i = 0; i < eco.lights.lampsPerCorridor; i++) {
        const t = (i + 0.5) / eco.lights.lampsPerCorridor;
        const lamp = MeshBuilder.CreateBox(`${b.id}_lampara_${i}`, { width: size[0], height: size[1], depth: size[2] }, scene);
        // Lamparitas sobre la fachada, a un 78% de la altura de la planta (geometría del spec v1.14).
        lamp.position.set(b.cell.col * v.cellW + t * b.size.w * v.cellW, b.cell.floor * v.cellH + v.cellH * 0.78, frontZ - 0.06);
        lamp.material = mat;
        lamp.isPickable = false;
      }
      lamps.set(b.id, { mat, color, corridor: b, lastIntensity: -1 });
    }
  };

  /** ¿Hay alguien en la planta (pasillo/zonas comunes/pozos) o el jugador por ahí fuera de su casa? */
  const floorOccupied = (floor: number, pos: PlayerPosition): boolean => {
    for (const r of Object.values(world.residents)) {
      if (!r.present || !r.location) continue;
      const b = world.blocks[r.location];
      if (!b || b.cell.floor !== floor) continue;
      if (b.layer === 'corridor' || b.params.elevator_status !== undefined || content.blocks[b.defId]?.features?.stairs === true) return true;
    }
    return pos.mode !== 'inside' && Math.round(pos.floor) === floor;
  };

  const updateLights = (pos: PlayerPosition): void => {
    const blackout = brain.blackoutUntilTick !== null;
    const night = inMinuteWindow(world.clock.minute, content.rules.sim.night);
    for (const lamp of lamps.values()) {
      let intensity = eco.lights.dayIntensity;
      if (blackout) {
        intensity = floorOccupied(lamp.corridor.cell.floor, pos) ? eco.lights.blackoutOccupiedIntensity : 0;
      } else if (night) {
        // v1.21: de noche el pasillo queda a oscuras SALVO que la iluminación funcione
        // (param lighting del sim sobre el umbral) Y algún vecino haya salido al pasillo.
        const lighting = typeof lamp.corridor.params.lighting === 'number' ? lamp.corridor.params.lighting : 0;
        const works = lighting > eco.lights.paramThreshold;
        const presence = !eco.lights.nightRequiresPresence || floorOccupied(lamp.corridor.cell.floor, pos);
        intensity = works && presence ? eco.lights.nightIntensity : 0;
      }
      if (intensity !== lamp.lastIntensity) {
        lamp.mat.emissiveColor.copyFrom(lamp.color).scaleInPlace(intensity);
        lamp.lastIntensity = intensity;
      }
    }
  };

  // ───────────────────────── Deterioro visual (feedback del estado del sim) ─────────────────────────

  const decals = new Map<string, Map<string, { meshes: Mesh[]; on: boolean; mat: StandardMaterial }>>();
  let checkAcc = Number.POSITIVE_INFINITY; // primera comprobación en el primer update

  const createDecals = (rule: EcosystemDeteriorationRule, b: BlockInstance): { meshes: Mesh[]; on: boolean; mat: StandardMaterial } => {
    const meshes: Mesh[] = [];
    const mat = new StandardMaterial(`eco_${rule.id}_${b.id}_mat`, scene);
    mat.diffuseColor = Color3.FromHexString(rule.color);
    mat.emissiveColor = Color3.FromHexString(rule.color).scale(0.35);
    mat.specularColor = new Color3(0, 0, 0);
    mat.alpha = rule.opacity;
    const bottom = b.cell.floor * v.cellH;
    const halfW = (b.size.w * v.cellW - v.gapW) / 2;
    const cx = centerOf(b);
    for (let i = 0; i < rule.count; i++) {
      const hx = hash01(`${rule.id}:${b.id}`, i * 3 + 1);
      const hy = hash01(`${rule.id}:${b.id}`, i * 3 + 2);
      const plane = MeshBuilder.CreatePlane(`eco_${rule.id}_${b.id}_${i}`, { width: rule.w, height: rule.h, sideOrientation: Mesh.DOUBLESIDE }, scene);
      plane.material = mat;
      plane.isPickable = false;
      switch (rule.kind) {
        case 'cracks': // cara frontal del cubo de escalera, mirando al pasillo
          plane.position.set(cx + (hx - 0.5) * halfW * 1.4, bottom + v.cellH * (0.3 + 0.45 * hy), frontZ - 0.02);
          break;
        case 'dirt': // suelo del pasillo, mirando a +Y
          plane.rotation.x = Math.PI / 2;
          plane.position.set(b.cell.col * v.cellW + (0.06 + hx * 0.88) * b.size.w * v.cellW, bottom + v.slab * 2 + 0.015, v.corridorZ + (hy - 0.5) * v.corridorDepth * 0.6);
          break;
        case 'damp': // pared del FONDO de la vivienda, visible desde el pasillo (corte abierto)
          plane.position.set(cx + (hx - 0.5) * halfW * 1.6, bottom + v.cellH * (0.28 + 0.3 * hy), frontZ + v.depth - v.wall);
          break;
        case 'soot': // como la humedad, pero arriba
          plane.position.set(cx + (hx - 0.5) * halfW * 1.6, bottom + v.cellH * (0.62 + 0.2 * hy), frontZ + v.depth - v.wall);
          break;
      }
      meshes.push(plane);
    }
    return { meshes, on: true, mat };
  };

  const refreshDeterioration = (): void => {
    for (const rule of eco.visuals.deterioration) {
      let perBlock = decals.get(rule.id);
      if (!perBlock) {
        perBlock = new Map();
        decals.set(rule.id, perBlock);
      }
      for (const b of Object.values(world.blocks)) {
        if (b.defId !== rule.blockDef) continue;
        const raw = b.params[rule.param];
        const defDefault = content.blocks[b.defId]?.params?.[rule.param]?.default;
        const value = typeof raw === 'number' ? raw : typeof defDefault === 'number' ? defDefault : 0;
        const holds = (rule.below !== undefined && value < rule.below) || (rule.above !== undefined && value > rule.above);
        let set = perBlock.get(b.id);
        if (holds && !set) {
          set = createDecals(rule, b);
          perBlock.set(b.id, set);
        }
        if (set && set.on !== holds) {
          for (const mesh of set.meshes) mesh.setEnabled(holds);
          set.on = holds;
        }
      }
    }
  };

  // ───────────────────────── Bucle del director ─────────────────────────

  return {
    update(dt: number) {
      if (disposed) return;
      swayClock += dt;

      // 1) CEREBRO: tick avanzado + cadencia del catálogo → evaluar y ejecutar staging.
      if (world.tick !== lastTick) {
        lastTick = world.tick;
        if (world.tick - brain.lastEvalTick >= eco.scheduler.evalEveryTicks) {
          lastReport = evaluateEcosystem(world, content, brain);
          for (const s of lastReport.staging) {
            if (s.kind === 'vendor') startVendor(s);
            else if (s.kind === 'pet') petMission = s.mission;
          }
        }
      }

      // 2) MASCOTA: la misión activa es la autoridad (nacer, pasear o irse a casa).
      updatePet();

      // 3) EXTRAS: consumir rutas (la ley del pasillo está en las patas que se encolan).
      for (const e of [...extras.values()]) {
        if (!stepExtra(e, dt)) despawnExtra(e);
      }

      // 4) LUCES por planta (barato, sin allocs; el param lighting del sim manda).
      ensureLamps();
      updateLights(getPlayerPos());

      // 5) DETERIORO: comprobación perezosa a cadencia del catálogo.
      checkAcc += dt;
      if (checkAcc >= eco.visuals.checkSeconds) {
        checkAcc = 0;
        refreshDeterioration();
      }

      // 6) Manchas de la mascota: fade del catálogo.
      updateStains(dt);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const e of extras.values()) {
        if (e.rig) e.rig.dispose();
        e.node.dispose(false, true);
      }
      extras.clear();
      for (const s of stains) {
        s.mesh.dispose();
        s.mat.dispose();
      }
      stains.length = 0;
      for (const perBlock of decals.values())
        for (const set of perBlock.values()) {
          for (const mesh of set.meshes) mesh.dispose();
          set.mat.dispose();
        }
      decals.clear();
      for (const lamp of lamps.values()) lamp.mat.dispose();
      lamps.clear();
    },
    get report(): EcosystemReport | null {
      return lastReport;
    },
    state: brain,
    /** v1.40 — apagón vigente: el cerebro guarda el tick de restauración; mientras el
     *  tick del mundo no lo alcance, se considera que la luz está fuera. */
    isBlackout() {
      return brain.blackoutUntilTick !== null && world.tick < brain.blackoutUntilTick;
    },
    extraPositions() {
      const out: { x: number; y: number; z: number }[] = [];
      for (const e of extras.values()) {
        if (!e.node.isEnabled()) continue;
        const p = e.node.position;
        out.push({ x: p.x, y: p.y - e.pivotY, z: p.z }); // nivel de PIES, como los movers
      }
      return out;
    },
  };
}
