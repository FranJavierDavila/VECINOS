import type { Mesh, Scene, TransformNode } from '@babylonjs/core';
import type { BlockInstance, Content, PlayerPosition, ResidentInstance, World } from '@/game/core/types';
import { B } from './babylon';
import { instantiateActorAsset, type ActorRig } from './assets';
import { hash01, interiorTarget, layoutGeometryOf, type Pt } from '@/game/interior';
import { stairGeomOf, stairPathPoints } from '@/game/stairs';
import { horizontalLegs } from '@/game/routing';
import { isStorageColumnBlock, storageDoorPoint } from '@/game/storage';
import type { ElevatorsDirector } from './elevator';

/** Plano frontal de las viviendas: z local 0 de los interiores (la cara de la puerta). */
const frontZOf = (roomZ: number, commonDepth: number): number => roomZ - commonDepth / 2;

/**
 * V1.28 — ORIENTACIÓN VERIFICADA CON PROBE EN VIVO (zanja la saga v1.26 −π/2 → v1.27 π):
 * el rig se authora MIRANDO A +X (el visor de la gorra cuelga en +X local, la coleta en −X)
 * y el loader glTF NO voltea nada: con rotation.y = α el morro apunta a (cos α, −sin α),
 * EXACTAMENTE la convención de las rutas (yaw = atan2(−dz, dx) → marcha (cos yaw, −sin yaw)).
 * Probe cuantitativo (jugador andando +X): mv=[+0.79, 0] con offset π daba front=[−1, 0]
 * (¡caminando de espaldas!) — con offset 0 el morro coincide con la marcha en TODAS las
 * direcciones y las extremidades siguen bombeando en plano PARALELO (el eje de swing de los
 * clips es Z local → zancada sobre X local = eje de marcha). Los clips (sentado, teléfono…)
 * quedan coherentes con su authoría original sin ningún giro.
 * rotación.y = yaw + MODEL_YAW_OFFSET. El yaw INTERNO (rutas, faceToward, gestos) no cambia.
 */
export const MODEL_YAW_OFFSET = 0;

interface Actor {
  /** Residente dueño del nodo (para las rutas de ascensor y depuración). */
  id: string;
  /** Nodo posicionable: cápsula greybox o raíz del modelo glTF (pivote en pies). */
  node: Mesh | TransformNode;
  height: number;
  /** Offset Y del pivote: cápsula centrada (+h/2) o modelo con pies en el origen (+margen). */
  pivotY: number;
  /** Cola de tramos en curso: el actor la agota ANTES de capturar el destino del mundo de nuevo
   *  (ir al pozo → subir → salir: un salto del sim se ve como un viaje, nunca un teletransporte). */
  path: { x: number; y: number; z: number }[];
  /** Vida interior (Fase C): cuenta atrás para el próximo punto de deambulación y nº de vuelta
   *  (el punto es determinista por residente+ vuelta: sin RNG global ni capturas irreproducibles). */
  wanderT: number;
  wanderLap: number;
  /** Objetivo interior VIGENTE (coords locales de la vivienda): se refresca con la cadencia del
   *  catálogo (npcWanderSeconds), no cada tick — amortigua el parpadeo de actividades con chance. */
  targetLocal: Pt | null;
  lastLoc: string | null;
  /** Dirección de cutscenes (Fase D): mientras está activa, la IA normal no captura destinos;
   *  el actor solo consume la cola de tramos que le marca el director (nunca teletransporta). */
  directed: boolean;
  /** Rumbo actual (rad): el actor MIRA hacia donde camina (v1.2, credibilidad 2.5D).
   *  0 = el modelo mira +X (perfil); ±π/2 = de espaldas/frente al entrar o salir de casa. */
  yaw: number;
  /** Rumbo pendiente de terminar: el actor remata el giro aunque se pare (nunca queda torcido). */
  targetYaw: number | null;
  /** Gesto social en curso (stateAnimations: talk/laugh/argue/phone/sit…) o null. */
  gesture: string | null;
  /** Cuenta atrás del gesto temporal (0 = persistente hasta que alguien lo quite). */
  gestureT: number;
  /** El objetivo interior vigente es un ancla de asiento (rules.view.seatAnchors): se sienta al llegar. */
  seated: boolean;
  /** Viaje en ascensor registrado (v1.5): { x: puerta; from/to: plantas }. null = sin viaje. */
  elevatorReq: { x: number; from: number; to: number } | null;
  /** Fase del viaje que se estaba atendiendo (para detectar transiciones y encolar tramos). */
  ridePhase: string | null;
  /** Estaba habilitado el frame anterior (v1.10): la REAPARICIÓN coloca al actor donde dice el
   *  sim (vuelve de la calle), nunca caminando desde su última posición visible por la pared. */
  enabledPrev: boolean;
  /** Trastero ocupado (v1.18): id del bloque por columna cuyo compartimento habitó por última
   *  vez. Mientras su ubicación siga siendo ese bloque, el nodo permanece oculto (está DENTRO
   *  de su celda cerrada); al cambiar, reaparece por la puerta con la lógica de siempre. */
  stowedBlock: string | null;
  /** Rig del arte final (null mientras carga o si hay fallback greybox). */
  rig: ActorRig | null;
  /** Pausa de charla (v1.20): mientras > 0, el actor NO avanza (ni ruta ni objetivo) —
   *  está parado charlando con otro vecino; la presentación lo suelta al terminar. */
  chatT: number;
  /** v1.30 — ASIENTO PENDIENTE de la sala de juntas: cuando la ruta acaba, el actor se
   *  planta en la silla (posición+yaw exactos) y encara el clip "sit". null = nada. */
  seatPending: { x: number; z: number; yaw: number } | null;
  /** v1.35 — OBJETO EN MANOS (paquete/mudanza): nodo colgado sobre la cabeza; kind dice
   *  caja de mudanza o paquete de reparto. null = manos libres. */
  carry: TransformNode | null;
  carryKind: 'box' | 'parcel' | null;
  /** v1.35 — carry FORZADO por el teatro (cutscene mudanza) sobre el automático por actividad. */
  carryManual: 'box' | 'parcel' | null;
  /** v1.35 — true mientras la pose TUMBADA ('sleep') está aplicada (para restaurar al soltar). */
  lying: boolean;
  /** v1.37 — base Y del rebote de ejercicio (parque de calistenia); null = sin rebote. */
  bobBase: number | null;
  /** v1.41 — PARAGUAS ABIERTO (llueve y está en la calle): nodo colgado de la cabeza;
   *  el teatro manda (setUmbrella), la animación de apertura la hace el propio actor. */
  umbrella: TransformNode | null;
  umbrellaWant: boolean;
  umbrellaK: number;
  /** v1.41 — BOLSAS DE LA COMPRA (una en cada mano): vuelve del taxi o de fuera del plano. */
  bags: TransformNode | null;
  bagsWant: boolean;
  /** v1.42 — ÚLTIMO fundido aplicado (0..1): la fuente de verdad de "¿se ve este actor?".
   *  headOf/visibleOf lo consultan: un actor desvanecido (cruzando la pared del portal) no
   *  luce bocadillos ni emoticonos — no queda nada flotando donde no hay personaje. */
  fade: number;
}

/**
 * API de dirección de cutscenes (Fase D): toma actores, colócalos en escena y márcales rutas.
 * Mientras un actor está "taken", el bucle normal de IA no le captura destinos: solo consume
 * la cola de tramos (la misma locomoción interpolada de siempre, cero teletransportes).
 */
export interface ActorsDirector {
  /** Posición del nodo (null si el actor no existe o está oculto). */
  nodeOf(id: string): { x: number; y: number; z: number } | null;
  /** Crea el actor si falta y lo marca como dirigido. false si el residente no está en escena. */
  take(id: string): boolean;
  /** Suelta al actor: la IA vuelve a decidir destino (cola y objetivo interior reseteados). */
  release(id: string): void;
  /** Coloca al actor en un punto de escena (staging teatral, decisión del contenido). */
  stageAt(id: string, x: number, floor: number, z: number): void;
  /** Encola la ruta del nodo actual al destino (pozo incluido si cambia la planta). */
  walkTo(id: string, dest: { x: number; z: number; floor: number; inside?: { block: string; local: Pt } }): boolean;
  /** true cuando el actor no tiene tramos pendientes (llegó — o no existe). */
  idle(id: string): boolean;
  /** v1.30 — sienta al actor al TERMINAR su ruta: al llegar, se planta en la silla (x/z/yaw)
   *  y encara el clip "sit" (asistencia a la junta). Con ruta vacía, efectivo al instante. */
  seatWhenIdle(id: string, seat: { x: number; z: number; yaw: number }): boolean;
  /** Punto sobre la cabeza del actor (bocadillos v1.10); null si no está en escena. */
  headOf(id: string): { x: number; y: number; z: number } | null;
  /** Gesto social en curso (stateAnimations: talk/laugh/argue/phone…) o null. */
  gestureOf(id: string): string | null;
  /** true si el actor está tomado por el director de cutscenes (el staging manda). */
  isDirected(id: string): boolean;
  /** true si el actor está en un viaje de ascensor (v1.20: las charlas no lo pausan). */
  isRiding(id: string): boolean;
  /**
   * Estado social explícito (v1.2): talk/laugh/argue/phone/sit… según stateAnimations del
   * manifiesto. Con `seconds` > 0 el gesto expira solo (líneas de diálogo); null lo suelta
   * ya (al colgar el teléfono, al cerrar el modal). El clip que falte cae al default del rig.
   */
  setGesture(id: string, state: string | null, seconds?: number): void;
  /** Pausa de charla (v1.20): congela la locomoción del actor `seconds` (0 lo suelta). */
  setHold(id: string, seconds: number): void;
  /** v1.35 — llevar algo ENCIMA (caja de mudanza/paquete): el teatro manda; null lo suelta. */
  setCarrying(id: string, kind: 'box' | 'parcel' | null): void;
  /** v1.41 — ¿el actor está EN ESCENA de verdad (nodo habilitado)? Los teatros y los
   *  bocadillos lo consultan para no colgar nada sobre un vecino invisible. */
  visibleOf(id: string): boolean;
  /** v1.41 — PARAGUAS ABIERTO (llueve y el vecino está fuera): on/off con animación. */
  setUmbrella(id: string, on: boolean): void;
  /** v1.41 — BOLSAS DE LA COMPRA en las dos manos (vuelve con la compra). */
  setBags(id: string, on: boolean): void;
  /** v1.41 — FADE del actor (0..1): cruzar la pared lateral del portal sin atravesarla a
   *  la vista. 1 = visible; el teatro lo usa al entrar/salir por el lateral del portal. */
  setFade(id: string, k: number): void;
  /** v1.41 — se levanta del asiento (fin del banco del paseo): quita la pose sentada. */
  standUp(id: string): void;
  /** v1.37 — ruta LIBRE del paseo vecinal: tramos crudos del mundo para un actor dirigido. */
  strollPath(id: string, pts: { x: number; y: number; z: number }[]): boolean;
  /** v1.37 — sólidos del mundo (lavadoras de la lavandería): los tramos se resuelven contra ellos. */
  setObstacles(rects: { x0: number; z0: number; w: number; d: number }[]): void;
  /** Gira el actor hacia un punto del mundo (charla de cruce: mirarse al hablar). */
  faceToward(id: string, x: number, z: number): void;
}

/**
 * El jugador y los vecinos: cápsulas greybox o, si el manifiesto de assets declara un
 * modelo glTF para el arquetipo (Content.assets.actors), el modelo con sus animaciones
 * (idle/walk por desplazamiento y clip por actividad vía activityAnimations).
 * Color y altura salen de la vista del arquetipo; radios y fallbacks, de content.rules.view.
 *
 * Dinámico (multijugador): la plantilla se sincroniza con world.residents en cada
 * update — residentes nuevos reciben nodo y residentes que ya no existen lo pierden.
 */
export function createActors(scene: Scene, world: World, content: Content, elevators?: ElevatorsDirector | null) {
  const { Color3, MeshBuilder, Quaternion, StandardMaterial, Vector3 } = B();
  const v = content.rules.view;
  const actors = new Map<string, Actor>();

  /** Crea la cápsula de un residente (greybox/fallback) y lanza la carga del modelo si el manifiesto lo declara. */
  const ensureActor = (id: string, archetype: string): Actor => {
    const view = content.archetypes[archetype]?.view;
    const height = view?.height ?? v.actorFallbackHeight;
    const mesh = MeshBuilder.CreateCapsule(id, { height, radius: v.actorRadius }, scene);
    const m = new StandardMaterial(`${id}_mat`, scene);
    m.diffuseColor = Color3.FromHexString(view?.color ?? v.actorFallbackColor);
    m.emissiveColor = m.diffuseColor.scale(0.25);
    mesh.material = m;
    mesh.isPickable = false;
    const a: Actor = { id, node: mesh, height, pivotY: height / 2, path: [], wanderT: 0, wanderLap: 0, targetLocal: null, lastLoc: null, directed: false, yaw: 0, targetYaw: null, gesture: null, gestureT: 0, seated: false, seatPending: null, elevatorReq: null, ridePhase: null, enabledPrev: false, stowedBlock: null, rig: null, chatT: 0, carry: null, carryKind: null, carryManual: null, lying: false, bobBase: null, umbrella: null, umbrellaWant: false, umbrellaK: 0, bags: null, bagsWant: false, fade: 1 };
    actors.set(id, a);

    // Arte final (opcional): modelo glTF del manifiesto; cualquier fallo → cápsula.
    const def = content.assets?.actors?.[archetype];
    if (def && content.assets) {
      void instantiateActorAsset(scene, def, content.assets.base, `${id}:${archetype}`).then((rig) => {
        // La escena pudo morir mientras cargaba (restart/Cargar partida): no adjuntar nada viejo.
        if (rig && scene.isDisposed) {
          rig.dispose();
          return;
        }
        if (!rig) return; // fallback greybox permanente
        const cur = actors.get(id);
        if (!cur || cur.rig) {
          rig.dispose(); // el residente se fue (o ya llegó otro rig): no dejar basura
          return;
        }
        // v1.32 — NOMBRE DE MALLA CON EL RESIDENTE: las sombras data-driven (rules.view.
        // shadows.casters con patrón 'res_') reconocen así a cada vecino sin tocar el
        // catálogo; el resto del juego no lee nombres de malla glTF (la pose va por nodos).
        for (const m of rig.root.getChildMeshes(false)) m.name = `${id}_${m.name}`;
        // PRESERVAR POSE (v1.10): el modelo puede terminar de cargar EN PLENO paseo (los assets
        // llegan async). Sin esto, el swap cápsula→rig recolocaba el nodo a origen y el actor
        // "saltaba" (el guard antiguo lo enmascaraba con OTRO teletransporte al objetivo: la
        // vecina con la maleta cambiando de planta de golpe). Pies y rumbo se conservan 1:1.
        const feetY = cur.node.position.y - cur.pivotY;
        rig.root.position.set(cur.node.position.x, feetY + 0.02, cur.node.position.z);
        if (rig.root.rotationQuaternion) Quaternion.RotationYawPitchRollToRef(cur.yaw + MODEL_YAW_OFFSET, 0, 0, rig.root.rotationQuaternion);
        else rig.root.rotation.y = cur.yaw + MODEL_YAW_OFFSET;
        // El modelo se authora a nominalHeight: escala uniforme a la altura del arquetipo.
        rig.root.scaling.setAll(height / def.nominalHeight);
        // v1.35 — el carry (si lo había) colgaba de la cápsula que ahora se dispone: se
        // suelta y el bucle lo reconstruye sobre el rig al frame siguiente.
        cur.carry = null;
        cur.carryKind = null;
        cur.node.dispose(false, true); // cápsula fuera (libera también su material propio)
        cur.node = rig.root;
        cur.pivotY = 0.02; // pies en el suelo
        cur.rig = rig;
      });
    }
    return a;
  };

  const goal = new Vector3();
  /** true si la fase del viaje cambió desde el último frame (hay que recolocar la cola). */
  const stalePhase = (a: Actor, phase: string): boolean => a.ridePhase !== phase;
  /** Pozos verticales del mundo (features stairs/elevator), para el RITMO de los tramos verticales. */
  const shafts = Object.values(world.blocks).filter((b) => {
    const f = content.blocks[b.defId]!.features;
    return !!f && (f.stairs === true || f.elevator === true);
  });
  /** ¿Pozo UTILIZABLE para rutear EN ESTE MOMENTO? (v1.10) La escalera siempre; el ascensor
   *  SOLO si funciona (elevator_status 'ok'). Se comprueba EN CADA RUTA porque el estado del
   *  sim cambia en vivo (avería/reparación): un filtro estático enlazaría llamadas al pozo
   *  averiado que el director cancela al frame siguiente (bucle llamada/cancelación). */
  const shaftUsable = (b: BlockInstance): boolean => {
    const f = content.blocks[b.defId]!.features!;
    if (f.stairs === true) return true;
    return f.elevator === true && b.params.elevator_status === 'ok';
  };
  const shaftXOf = (b: BlockInstance): number => (b.cell.col + b.size.w / 2) * v.cellW;
  // v1.37 — SÓLIDOS DEL MUNDO (lavadoras de la lavandería): los vecinos tampoco las
  // atraviesan. Los tramos horizontales se resuelven contra estos rects (mismo set que
  // player-logic usa para el jugador: UNA verdad, building.walkObstacles()).
  let solidRects: { x0: number; z0: number; w: number; d: number }[] = [];
  const resolveSolids = (px: number, pz: number, nx: number, nz: number, y: number): { x: number; z: number } => {
    if (solidRects.length === 0 || y > v.cellH * 0.6) return { x: nx, z: nz };
    const r = v.actorRadius;
    const hit = (x: number, z: number): boolean =>
      solidRects.some((o) => x > o.x0 - r && x < o.x0 + o.w + r && z > o.z0 - r && z < o.z0 + o.d + r);
    if (!hit(nx, nz)) return { x: nx, z: nz };
    if (!hit(nx, pz)) return { x: nx, z: pz };
    if (!hit(px, nz)) return { x: px, z: nz };
    return { x: px, z: pz };
  };
  /** v1.37 — fase global del rebote de ejercicio (sentadillas del paseo). */
  let exercisePhase = 0;
  /** Calado transitablo del bloque (vivienda 2×; naves del cierre v1.16 a calado de vivienda;
   *  trasteros por columna v1.18: depth × blockDepthFactor).
   *  v1.19: en vivienda manda el LAYOUT — las salas traseras viven más allá de view.depth. */
  const depthOfBlock = (b: BlockInstance): number => {
    if (b.kind === 'dwelling') {
      const layoutId = content.blocks[b.defId]?.container?.layout;
      const layout = layoutId ? content.layouts[layoutId] : undefined;
      const rects = (layout?.rooms ?? []).map((r) => r.rect).filter((r): r is NonNullable<typeof r> => !!r);
      if (rects.length > 0) return Math.max(...rects.map((r) => r.z + r.d));
      return v.depth;
    }
    if (b.defId === 'trasteros_planta' || b.defId === 'bajocubierta') return v.depth;
    if (b.defId === v.trasteros.blockDefId) return v.depth * v.trasteros.blockDepthFactor;
    if (b.defId === 'tejado') return v.depth + v.roof.overhang * 2;
    return v.commonDepth;
  };
  /** Plano frontal de los bloques (compartido con storage.ts/building.ts). */
  /**
   * Punto de puerta del trastero de un residente en el bloque por columna de su letra
   * (v1.18): pasillo central hasta su celda. null si no aplica (bloque equivocado, planta
   * sin vivienda en el plan…).
   */
  const storageDoorOf = (resident: ResidentInstance): { x: number; z: number } | null => {
    const home = world.blocks[resident.home];
    if (!home) return null;
    const tag = home.id.slice(home.id.lastIndexOf('_') + 1);
    const store = Object.values(world.blocks).find(
      (b) => isStorageColumnBlock(b, v) && b.id.endsWith(`_${tag}`),
    );
    if (!store) return null;
    const colTag = store.id.slice(store.id.lastIndexOf('_') + 1);
    const floors = Object.values(world.blocks)
      .filter((d) => d.kind === 'dwelling' && d.id.endsWith(`_${colTag}`))
      .map((d) => d.cell.floor)
      .sort((a, z) => a - z);
    return storageDoorPoint(v, store, floors, home.cell.floor);
  };
  /** Plano frontal de las viviendas: z local 0 de los interiores y origen del pasillo. */
  const frontZ = frontZOf(v.roomZ, v.commonDepth);
  /** Bloque main bajo los pies (v1.14): para salir de la banda de viviendas por SU puerta.
   *  v1.28 — doorX/geo: las viviendas aportan la x de su puerta frontal (el hueco real de la
   *  fachada) y su geometría 2D: la salida camina por dentro hasta el hueco y cruza por él. */
  const hostSpanAt = (x: number, floor: number): { x0: number; w: number; doorX?: number; geo?: ReturnType<typeof layoutGeometryOf> } | null => {
    for (const b of Object.values(world.blocks)) {
      if (b.cell.floor !== floor || b.layer !== 'main') continue;
      const x0 = b.cell.col * v.cellW;
      const w = b.size.w * v.cellW;
      if (x >= x0 && x <= x0 + w) {
        // Puerta frontal = centro del bloque (la hoja de privacidad se monta en cx) — solo vivienda.
        const doorX = b.kind === 'dwelling' ? x0 + w / 2 : undefined;
        const geo = b.kind === 'dwelling' ? layoutGeometryOf(content, b) : null;
        return { x0, w, doorX, geo };
      }
    }
    return null;
  };

  /**
   * Ruta (cola de tramos) del nodo actual al destino: cambio de planta → pozo más cercano
   * (andar hasta él por el pasillo, subir/bajar, salir), y dentro de una vivienda con
   * geometría 2D la ruta pasa por los huecos del catálogo (nunca a través de tabiques).
   * La comparten la IA normal y el director de cutscenes: una sola verdad de locomoción.
   *
   * v1.14 — LEY DEL PASILLO (rutas blindadas): todo el tramo horizontal lo calcula
   * horizontalLegs() (@/game/routing): el avance en X solo ocurre sobre la línea del
   * pasillo y la banda de bloques solo se entra/sale en vertical en la x del bloque
   * propio — jamás una diagonal atravesando el 2C (o el núcleo del ascensor) para
   * llegar al 2B. Devuelve false SOLO cuando el destino exige cambiar de planta y no
   * hay pozo utilizable (estado imposible: el llamador decide si recoloca sin teatro).
   */
  const buildRoute = (a: Actor, dest: { x: number; y: number; z: number; inside?: { block: BlockInstance; local: Pt } | null }): boolean => {
    const node = a.node.position;
    let startX = node.x;
    let startZ = node.z;
    let verticalOk = true;
    if (Math.abs(dest.y - node.y) > 0.05) {
      const floorNow = Math.round(node.y / v.cellH);
      // Como el sim: ASCENSOR primero si funciona (coste 1 < 3 de la escalera); la escalera
      // es la vía de emergencia cuando el núcleo está averiado (v1.10: estado comprobado EN VIVO).
      const elevHere = shafts
        .filter((s) => s.cell.floor === floorNow && content.blocks[s.defId]!.features!.elevator === true && s.params.elevator_status === 'ok')
        .sort((s1, s2) => Math.abs(shaftXOf(s1) - startX) - Math.abs(shaftXOf(s2) - startX))[0];
      const here = elevHere ?? shafts
        .filter((s) => s.cell.floor === floorNow && shaftUsable(s))
        .sort((s1, s2) => Math.abs(shaftXOf(s1) - startX) - Math.abs(shaftXOf(s2) - startX))[0];
      if (here) {
        const sx = shaftXOf(here);
        // Salir del interior por la puerta propia (si procede) y andar hasta el pozo SOLO
        // por la línea del pasillo: la diagonal directa cruzaba viviendas vecinas.
        for (const l of horizontalLegs({ view: v, from: { x: startX, z: startZ }, dest: { x: sx, z: v.corridorZ }, hostSpan: hostSpanAt(startX, floorNow) })) {
          a.path.push({ x: l.x, y: node.y, z: l.z });
        }
        // ¿Escalera o ascensor? La escalera REAL (v1.4) va por los peldaños; el ascensor
        // OPERATIVO (v1.5) registra una LLAMADA: el actor camina a la puerta y espera a la
        // cabina (capacidad, puertas y semáforo los lleva el director del ascensor).
        const feat = content.blocks[here.defId]!.features!;
        if (feat.stairs === true) {
          // v1.23 — ESCALERA REAL POR PLANTAS: la escalera física conecta plantas ADYACENTES.
          // Llamar a stairPathPoints con una subida de varias plantas estiraba cada peldaño a
          // media planta (el vecino flotaba y atravesaba forjados). Ahora se ENCADENA un vuelo
          // por planta: sube a la planta vecina, desembarca (el path termina en la línea del
          // pasillo, exactamente donde arranca el siguiente vuelo) y repite hasta el destino.
          const frac = node.y - Math.round(node.y / v.cellH) * v.cellH; // offset intra-planta (forjado + pivote)
          const startFloor = Math.round(node.y / v.cellH);
          const targetFloor = Math.round(dest.y / v.cellH);
          const dir = targetFloor >= startFloor ? 1 : -1;
          let curY = node.y;
          let curFloor = startFloor;
          while (curFloor !== targetFloor) {
            curFloor += dir;
            const nextY = curFloor * v.cellH + frac;
            const flight = stairPathPoints(v, sx, curY, nextY);
            if (flight.length > 1) {
              // Enganche sin duplicar el punto donde ya está el actor (el desembarco del
              // vuelo anterior ES el arranque del siguiente).
              if (a.path.length > 0 || curY !== node.y) flight.shift();
              for (const pt of flight) a.path.push({ x: pt.x, y: pt.y, z: pt.z });
              curY = nextY;
            }
          }
          if (a.path.length === 0) a.path.push({ x: sx, y: dest.y, z: v.corridorZ });
        } else if (elevators && feat.elevator === true) {
          const from = Math.round(node.y / v.cellH);
          const to = Math.round(dest.y / v.cellH);
          if (to !== from) {
            elevators.requestRide(a.id, here.cell.col, from, to);
            a.elevatorReq = { x: sx, from, to };
            a.ridePhase = null;
          }
        } else {
          a.path.push({ x: sx, y: dest.y, z: v.corridorZ });
        }
        startX = sx;
        startZ = v.corridorZ;
      } else {
        verticalOk = false;
      }
    }
    // Tramos horizontales al destino bajo la ley del pasillo (misma función que el enfoque
    // al pozo: entrada al bloque solo en vertical, en la x del destino, o ruta interior).
    const destGeo = dest.inside ? layoutGeometryOf(content, dest.inside.block) : null;
    const legs = horizontalLegs({
      view: v,
      from: { x: startX, z: startZ },
      dest: { x: dest.x, z: dest.z },
      destInside:
        dest.inside && destGeo
          ? {
              x0: dest.inside.block.cell.col * v.cellW,
              w: dest.inside.block.size.w * v.cellW,
              geo: destGeo,
              target: dest.inside.local,
              // v1.28: entrar por el HUECO de la puerta (el corte de la fachada), no por la x
              // del objetivo — la cama vive en otra x y el vecino atravesaba la pared.
              doorX: dest.inside.block.kind === 'dwelling'
                ? (dest.inside.block.cell.col + dest.inside.block.size.w / 2) * v.cellW
                : undefined,
            }
          : null,
      hostSpan: hostSpanAt(startX, Math.round(dest.y / v.cellH)),
    });
    for (const p of legs) a.path.push({ x: p.x, y: dest.y, z: p.z });
    return verticalOk;
  };

  return {
    /** playerResidentId identifica al residente del jugador local (multijugador: puede ser un invitado). */
    update(dt: number, player: PlayerPosition, playerResidentId: string) {
      // v1.37 — fase del rebote de ejercicio (sentadillas del paseo, ritmo del catálogo).
      exercisePhase += dt * (v.paseo?.bobRate ?? 4);
      // Altas y bajas: residentes sin nodo → crear; nodos huérfanos → dispose + remove.
      for (const id in world.residents) {
        if (!actors.has(id)) ensureActor(id, world.residents[id]!.archetype);
      }
      const gone: string[] = [];
      for (const [id, a] of actors) {
        if (!world.residents[id]) gone.push(id);
      }
      for (const id of gone) {
        const a = actors.get(id)!;
        actors.delete(id);
        if (a.rig) a.rig.dispose();
        else if (a.node instanceof B().Mesh) a.node.dispose(false, true);
        else a.node.dispose(false, false);
      }

      const k = 1 - Math.exp(-dt * 10);
      // Ritmos del catálogo (rules.view): crucero de vecinos y subida por pozo.
      const npcSpeed = v.npcWalkSpeed;
      for (const [id, a] of actors) {
        const r = world.residents[id]!;
        const isPlayer = id === playerResidentId;
        const nowEnabled = isPlayer || (r.present && r.location !== null);
        // ── TRASTEROS POR COLUMNA (v1.18): mientras el vecino sigue "en su bloque de
        //  trasteros", el nodo permanece oculto — está DENTRO de su celda cerrada. En cuanto
        //  el sim lo muda (otra ubicación o se va), sale del stow y reaparece por su puerta.
        const stowedHere = a.stowedBlock !== null && r.present && r.location === a.stowedBlock;
        if (a.stowedBlock !== null && !stowedHere) a.stowedBlock = null;
        a.node.setEnabled(nowEnabled && !stowedHere);
        if (!nowEnabled || stowedHere) {
          a.enabledPrev = false;
          continue;
        }
        // En escena lo coloca el director (v1.10): marcar habilitado SIN snap — si no, al soltar
        // al actor tras una cutscene, el primer frame normal lo trataría como "reaparición"
        // y lo teletransportaría al objetivo en vez de rutear desde donde está.
        if (a.directed) a.enabledPrev = true;
        const node = a.node.position;
        const prevX = node.x;
        const prevZ = node.z;
        // Charla de cruce (v1.20): mientras dura, el actor NO avanza — se queda donde está,
        // mira a su vecino y conversa. Ni rutas ni objetivos: al soltar, la IA recaptura.
        if (a.chatT > 0) a.chatT -= dt;
        const chatting = a.chatT > 0;
        if (isPlayer) {
          const inside = player.mode === 'inside';
          // Apilamiento 3D (v1.19): dentro del trastero propio el cuerpo vive en el bloque
          // trasero (posición que dicta PlayerLogic), no en el pasillo del sim.
          if (player.rear) {
            goal.set(player.rear.x, player.floor * v.cellH + 0.14 + a.pivotY, player.rear.z);
            if (node.lengthSquared() === 0) node.copyFrom(goal);
            node.addInPlace(goal.subtract(node).scale(Math.min(1, k * 2)));
            // Skipear el resto del bloque isPlayer cayendo al flujo común de posición.
          } else {
          // Dentro de la vivienda el actor sigue la posición 2D (x + profundidad z del layout);
          // en el cubo de escalera (v1.4) manda la Z absoluta del recorrido (pathZ).
          // En pasillo (v1.19) la Z del jugador es ABSOLUTA (dos carriles: interior/exterior).
          const insideBlock = player.insideBlock ? world.blocks[player.insideBlock] : null;
          const insideDepth = insideBlock ? depthOfBlock(insideBlock) : v.depth;
          const z = inside ? frontZ + Math.min(Math.max(player.z, 0), insideDepth) : (player.pathZ ?? player.z);
          goal.set(player.x, player.floor * v.cellH + (inside ? 0.12 : 0.14) + a.pivotY, z);
          if (node.lengthSquared() === 0) node.copyFrom(goal);
          node.addInPlace(goal.subtract(node).scale(Math.min(1, k * 2)));
          }
        } else if (!chatting) {
          const b = world.blocks[r.location!]!;
          const home = world.blocks[r.home]!;
          const inRoom = b.kind === 'dwelling';
          const x0 = b.cell.col * v.cellW;
          // ── Trastero propio (v1.18): si el vecino está en el bloque por columna de su
          //  letra, su objetivo es LA PUERTA DE SU CELDA (pasillo central): llega y entra
          //  (stow: nodo oculto dentro del compartimento cerrado).
          const storeDoor = isStorageColumnBlock(b, v) ? storageDoorOf(r) : null;
          // ── Viaje en ascensor (v1.5): mientras hay viaje registrado, el director manda —
          // esperar ante la puerta, entrar al hueco, ser llevado por la cabina y salir en la
          // planta de destino. Si el viaje se cancela (avería), status() null → el flujo
          // normal recaptura destino y la ruta pasará por la escalera.
          const elev = elevators ?? undefined;
          const ride = a.elevatorReq && elev ? elev.status(id) : null;
          if (a.elevatorReq && !ride) {
            a.elevatorReq = null;
            a.ridePhase = null;
            a.path = [];
          }
          if (a.elevatorReq && ride) {
            if (stalePhase(a, ride.phase)) {
              // Transición de fase: recolocar la cola según a dónde hay que caminar ahora.
              if (ride.phase === 'boarding') {
                a.path = [{ x: ride.slotX, y: Math.round(ride.floor) * v.cellH + 0.14 + a.pivotY, z: ride.slotZ }];
              } else if (ride.phase === 'exiting') {
                a.path = [{ x: a.elevatorReq.x, y: a.elevatorReq.to * v.cellH + 0.14 + a.pivotY, z: v.corridorZ }];
              } else {
                a.path = [];
              }
              a.ridePhase = ride.phase;
            }
            if (ride.phase === 'waiting') {
              goal.set(a.elevatorReq.x, a.elevatorReq.from * v.cellH + 0.14 + a.pivotY, v.corridorZ);
              if (node.lengthSquared() === 0) node.copyFrom(goal);
              node.addInPlace(goal.subtract(node).scale(Math.min(1, k * 2)));
            } else if (ride.phase === 'riding') {
              // La cabina manda: posición directa en el hueco (sin teatro ni interpolación propia).
              a.path = [];
              node.set(ride.slotX, ride.floor * v.cellH + 0.14 + a.pivotY, ride.slotZ);
            } else if (ride.phase === 'boarding' && a.path.length === 0) {
              elev!.notifyBoarded(id); // ya está en su hueco: la puerta puede cerrar
            } else if (ride.phase === 'exiting' && a.path.length === 0) {
              a.elevatorReq = null;
              a.ridePhase = null;
            }
          }
          // Con dirección de cutscene (Fase D) el actor solo consume su cola de tramos:
          // ni objetivo de IA ni captura de ruta (el director ya se la ha dado).
          if (!a.directed && !a.elevatorReq) {
            let gx = b.layer === 'corridor' ? (home.cell.col + 0.5) * v.cellW : (x0 + b.size.w * v.cellW) / 2;
            let gz = inRoom ? frontZ + 0.6 : v.corridorZ;
            if (storeDoor) {
              // Trastero por columna (v1.18): se camina POR EL PASILLO CENTRAL hasta SU puerta.
              gx = storeDoor.x;
              gz = storeDoor.z;
            }
            // ── Vida interior (Fase C): en vivienda, el punto lo decide el contenido. La actividad
            // con `anchor` (cama, tv, stove…) coloca al vecino en SU estancia por el catálogo de
            // anclas (rooms.json); sin ancla, deambula por las estancias abiertas. El objetivo se
            // REFRESCA con la cadencia npcWanderSeconds (no cada tick): una actividad con chance
            // que parpadea en el sim no arrastra al vecino por la casa. Cerradas jamás son destino.
            const geo = inRoom ? layoutGeometryOf(content, b) : null;
            let localTarget: Pt | null = null;
            if (a.lastLoc !== r.location) {
              a.lastLoc = r.location;
              a.targetLocal = null;
              a.wanderT = 0;
              a.seated = false;
            }
            if (geo) {
              a.wanderT -= dt;
              if (a.path.length === 0 && a.wanderT <= 0) {
                a.wanderLap += 1;
                a.wanderT = v.npcWanderSeconds * (0.7 + 0.6 * hash01(id, a.wanderLap));
                const act = r.activity ? content.archetypes[r.archetype]?.activities[r.activity] : undefined;
                const anchorKind = act?.anchor;
                const anchored = anchorKind ? interiorTarget(content, geo, anchorKind, id, 0) : null;
                a.targetLocal = anchored ?? interiorTarget(content, geo, undefined, id, a.wanderLap);
                // Ancla de asiento (catálogo: rules.view.seatAnchors): al llegar se sienta (clip "sit").
                a.seated = anchored !== null && !!anchorKind && v.seatAnchors.includes(anchorKind);
              }
              localTarget = a.targetLocal;
            }
            if (localTarget) {
              gx = x0 + localTarget.x;
              gz = frontZ + localTarget.z;
            }
            goal.set(gx, b.cell.floor * v.cellH + 0.14 + a.pivotY, gz);
            // Reaparición (v1.10): el vecino vuelve de la calle o entra en escena — aparece
            // DONDE DICE EL SIM, no caminando desde su última posición visible (por la pared).
            // CON TRASTERO (v1.18): sale en la línea del pasillo ANTE SU BLOQUE y se lo ve
            // entrar y recorrer el pasillo central hasta su celda (nunca pop dentro del stow).
            if (!a.enabledPrev) {
              a.enabledPrev = true;
              if (storeDoor) {
                node.set((x0 + b.size.w * v.cellW) / 2, goal.y, v.corridorZ);
                a.path = [];
              } else {
                node.copyFrom(goal);
                a.path = [];
              }
            }
            // ── Locomoción interpolada (nada de teletransportes): el destino del sim se recorre a
            // velocidad de crucero del catálogo, tramo a tramo. El sim adelanta a los vecinos a
            // saltos del grafo (varias plantas de golpe): la ruta se RECALCULA DESDE EL PUNTO
            // ACTUAL (andar al pozo → subir/bajar → salir) y el viaje se ve entero, pieza a pieza.
            // Solo un estado realmente imposible (cambio de planta sin pozo utilizable, v1.10)
            // recoloca sin teatro. Con ruta en curso se consume SIEMPRE hasta el final.
            if (a.path.length === 0) {
              // STOW (v1.18): llegó a la puerta de su trastero — entra y se oculta (la celda
              // es cerrada: el interior jamás se ve). enabledPrev=false para que, cuando el
              // sim lo mude, la reaparición lo coloque donde toque.
              if (storeDoor && a.stowedBlock === null && Math.hypot(node.x - storeDoor.x, node.z - storeDoor.z) < 0.35) {
                a.stowedBlock = b.id;
                a.node.setEnabled(false);
                a.enabledPrev = false;
                a.path = [];
                continue;
              }
              const routed = buildRoute(a, { x: goal.x, y: goal.y, z: goal.z, inside: geo && localTarget ? { block: b, local: localTarget } : null });
              if (!routed) {
                node.copyFrom(goal);
                a.path = [];
              }
            }
          }
          if (a.path.length > 0) {
            const w = a.path[0]!;
            const wdh = Math.hypot(w.x - node.x, w.z - node.z);
            const wdy = w.y - node.y;
            if (Math.abs(wdy) > 0.02 && wdh < 0.05) {
              // Tramo VERTICAL PURO (v1.23, umbral 0.05): solo el arranque/parada vertical del
              // fallback sin escalera. El umbral anterior (0.3) atrapaba los PELDAÑOS de la
              // escalera real (run ≈ 0.27 m): el vecino subía en vertical como un ascensor y
              // LUEGO patinaba en horizontal hasta el siguiente peldaño — el "sube mal".
              // v1.29 — FIDELIDAD DE RUTAS (petición del vecino: «deben ser fieles a los datos
              // reales»): el trepe EN VERTICAL solo existe DENTRO de un pozo real (escalera o
              // ascensor). Fuera de un pozo NO hay escaleras que no existan: la posición cae
              // directa al tramo (estado imposible v1.10 — recolocación sin teatro, jamás un
              // vecino trepando por el aire hacia el ascensor).
              const shaftHere = shafts
                .filter((s) => s.cell.floor === b.cell.floor && Math.abs(shaftXOf(s) - node.x) < 0.3)
                .sort((s1, s2) => Math.abs(shaftXOf(s1) - node.x) - Math.abs(shaftXOf(s2) - node.x))[0];
              const feat = shaftHere ? content.blocks[shaftHere.defId]!.features : undefined;
              if (!shaftHere) {
                node.y = w.y; // sin pozo bajo los pies: sin escalera invisible
              } else {
                const rate = feat?.elevator && shaftHere!.params.elevator_status === 'ok' ? v.cellH / v.elevatorSeconds : v.cellH / v.stairsSeconds;
                node.y += Math.sign(wdy) * Math.min(Math.abs(wdy), rate * dt);
              }
            } else if (wdh > 0.001) {
              // Tramo con componente horizontal: crucero con llegada suave (frena al acercarse,
              // nunca sobrepasa). Con dy el tramo es 3D (pendiente de escalera, Task 29): el paso
              // reparte X/Z/Y con la MISMA velocidad de crucero, así la subida es física.
              const step = Math.min(npcSpeed * dt, (0.35 + wdh * 2.5) * dt, wdh);
              const t = step / wdh;
              // v1.37 — los sólidos del mundo (lavadoras) no se atraviesan: la posición
              // tentativa se resuelve contra los rects (desliza por ejes, nunca atraviesa).
              const solid = resolveSolids(node.x, node.z, node.x + (w.x - node.x) * t, node.z + (w.z - node.z) * t, node.y);
              node.x = solid.x;
              node.z = solid.z;
              node.y += wdy * t;
            }
            // Tramo terminado → siguiente tramo de la ruta.
            if (Math.hypot(w.x - node.x, w.z - node.z) < 0.06 && Math.abs(w.y - node.y) < 0.03) a.path.shift();
          }
        }

        // ── v1.30 — ASIENTO PENDIENTE (junta): al quedarse sin ruta, el actor ocupa su silla
        //  de la sala (posición + yaw exactos) y encara el clip "sit". El teatro manda.
        if (a.seatPending && a.path.length === 0 && !a.elevatorReq) {
          const seat = a.seatPending;
          a.seatPending = null;
          a.node.position.set(seat.x, node.y, seat.z);
          a.yaw = seat.yaw;
          a.targetYaw = null;
          const qs = a.node.rotationQuaternion;
          if (qs) Quaternion.RotationYawPitchRollToRef(seat.yaw + MODEL_YAW_OFFSET, 0, 0, qs);
          else a.node.rotation.y = seat.yaw + MODEL_YAW_OFFSET;
          a.seated = true;
        }

        // ── Rotación 2.5D (v1.2): el actor MIRA hacia donde camina. El pasillo es lateral (eje
        // X, perfil); entrar/salir de una vivienda es profundidad (eje Z: de espaldas al alejarse,
        // de frente al acercarse). Giro por el arco corto con el ritmo del catálogo
        // (rules.view.actorTurnSpeed). El rumbo queda PENDIENTE hasta rematarse: aunque el actor
        // se pare a mitad de giro, termina de encarar la dirección en la que iba (nadie se queda
        // torcido en una puerta).
        // Aplicación ROBUSTA (v1.3): si el nodo lleva rotationQuaternion (el loader glTF puede
        // ponérselo), Babylon IGNORA rotation.y — hay que escribir el cuaternión; si no,
        // rotation.y de toda la vida. En ambos casos SOLO yaw: nadie se ladea ni se tumba.
        const mdx = node.x - prevX;
        const mdz = node.z - prevZ;
        if (Math.hypot(mdx, mdz) / Math.max(1e-4, dt) > 0.25) a.targetYaw = Math.atan2(-mdz, mdx);
        if (a.targetYaw !== null) {
          let dYaw = a.targetYaw - a.yaw;
          dYaw = ((dYaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
          if (Math.abs(dYaw) < 0.02) {
            a.yaw = a.targetYaw; // rematado
            a.targetYaw = null;
          } else {
            a.yaw += dYaw * Math.min(1, dt * v.actorTurnSpeed);
          }
        }
        const q = a.node.rotationQuaternion;
        if (q) Quaternion.RotationYawPitchRollToRef(a.yaw + MODEL_YAW_OFFSET, 0, 0, q);
        else a.node.rotation.y = a.yaw + MODEL_YAW_OFFSET;

        // ── v1.37 — EJERCICIO DEL PASEO (parque de calistenia): con el gesto del catálogo
        //  (paseo.gesture) el vecino hace sentadillas — rebote vertical sutil y determinista
        //  (paseo.bob/bobRate) desde la altura a la que empezó el gesto.
        const pc = v.paseo;
        if (pc && pc.bob > 0 && a.gesture === pc.gesture && a.bobBase !== null && !a.lying) {
          const phase = exercisePhase + (hash01(id, 9900) - 0.5) * 2.4;
          node.y = a.bobBase + Math.max(0, Math.sin(phase)) * pc.bob;
        } else if (a.bobBase !== null && a.gesture !== pc?.gesture) {
          a.bobBase = null;
        }

        // ── v1.35 — POSE TUMBADA (comedia del vecindario): con el gesto 'sleep' el vecino
        //  se queda FRITO en el suelo (boca arriba, donde esté) — situación cómica del
        //  catálogo (chats: se duerme en mitad de una charla). Al soltar el gesto vuelve
        //  a pie (la rotación estándar de arriba ya lo repone; solo hay que resetear el
        //  pitch de la cápsula greybox, que los rigs repone por cuaternión cada frame).
        if (a.gesture === 'sleep') {
          const qs = a.node.rotationQuaternion;
          if (qs) Quaternion.RotationYawPitchRollToRef(a.yaw + MODEL_YAW_OFFSET, -Math.PI / 2, 0, qs);
          else a.node.rotation.x = -Math.PI / 2;
          // El cuerpo tumbado NO se hunde: el pivote sube a media altura del tronco.
          node.y = goal.y - 0.14 + a.height * 0.22;
          a.lying = true;
        } else if (a.lying) {
          a.lying = false;
          if (!a.node.rotationQuaternion) a.node.rotation.x = 0;
        }

        // ── v1.35 — LLEVAR OBJETOS ENCIMA (paquetes/mudanzas): caja de cartón con cinta o
        //  paquete blanco atado, EQUILIBRADO sobre la cabeza (el clásico transporte del
        //  barrio). Automático por ACTIVIDAD del catálogo (rules.view.carry.activities:
        //  reparto en pasillo, obra, mural…) y FORZABLE por el teatro (mudanza). Al cambiar
        //  la actividad o soltar el teatro, el objeto desaparece (soltar).
        const carryCfg = v.carry;
        const wantAuto = carryCfg && r.activity && carryCfg.activities.includes(r.activity) ? 'box' : null;
        const want = a.carryManual ?? wantAuto;
        if (want !== a.carryKind) {
          if (a.carry) {
            a.carry.dispose(false, true);
            a.carry = null;
          }
          a.carryKind = want;
          if (want) {
            const root = new (B().TransformNode)(`${id}_carry`, scene);
            root.parent = a.node;
            const cb = carryCfg;
            const bodyM = new (B().StandardMaterial)(`${id}_carry_mat`, scene);
            bodyM.diffuseColor = (B().Color3).FromHexString(want === 'box' ? cb?.boxColor ?? '#c9a66b' : cb?.parcelColor ?? '#e8e2d2');
            const tapeM = new (B().StandardMaterial)(`${id}_carry_tape_mat`, scene);
            tapeM.diffuseColor = (B().Color3).FromHexString(want === 'box' ? cb?.boxTape ?? '#a47148' : '#8a5a33');
            const bw = cb?.boxW ?? 0.52;
            const bh = cb?.boxH ?? 0.34;
            const bd = cb?.boxD ?? 0.4;
            const body = (B().MeshBuilder).CreateBox(`${id}_carry_cuerpo`, { width: want === 'parcel' ? bw * 0.78 : bw, height: want === 'parcel' ? bh * 0.7 : bh, depth: want === 'parcel' ? bd * 0.78 : bd }, scene);
            body.material = bodyM;
            body.isPickable = false;
            body.parent = root;
            // Cinta precintadora en cruz (caja) o cordel atado (paquete).
            const strapW = want === 'parcel' ? 0.02 : bw * 0.16;
            const strap1 = (B().MeshBuilder).CreateBox(`${id}_carry_cinta_x`, { width: strapW, height: 0.012, depth: want === 'parcel' ? bd * 0.8 : bd * 1.03 }, scene);
            strap1.material = tapeM;
            strap1.isPickable = false;
            strap1.parent = root;
            strap1.position.y = want === 'parcel' ? bh * 0.36 : bh / 2;
            if (want === 'box') {
              const strap2 = (B().MeshBuilder).CreateBox(`${id}_carry_cinta_z`, { width: bw * 1.03, height: 0.012, depth: strapW }, scene);
              strap2.material = tapeM;
              strap2.isPickable = false;
              strap2.parent = root;
              strap2.position.y = bh / 2;
            }
            root.position.y = a.height + (want === 'parcel' ? bh * 0.36 : bh / 2) + 0.07;
            root.scaling.setAll(a.rig ? a.height / 1.35 : 1);
            a.carry = root;
          }
        } else if (a.carry) {
          a.carry.setEnabled(a.node.isEnabled());
        }

        // ── v1.41 — PARAGUAS ABIERTO (llueve y está en la calle) y BOLSAS DE LA COMPRA.
        //  Mismo patrón que el carry: el teatro marca el deseo (umbrellaWant/bagsWant) y el
        //  bucle construye/desmonta el accesorio colgado del nodo; el paraguas además se
        //  ABRE con una animación corta (K 0→1 del catálogo). Ambos son hijos del nodo:
        //  se ocultan solos cuando el actor se oculta y siguen TODA la animación del cuerpo.
        const outdoor = v.outdoor;
        if (a.umbrellaWant !== (a.umbrella !== null)) {
          if (a.umbrella) {
            a.umbrella.dispose(false, true);
            a.umbrella = null;
            a.umbrellaK = 0;
          } else {
            const uc = outdoor?.umbrella;
            const rootU = new (B().TransformNode)(`${id}_umbrella`, scene);
            rootU.parent = a.node;
            const canopyM = new (B().StandardMaterial)(`${id}_umbrella_tela`, scene);
            canopyM.diffuseColor = (B().Color3).FromHexString(uc?.color ?? '#b8452e');
            canopyM.specularColor = new (B().Color3)(0, 0, 0);
            const stickM = new (B().StandardMaterial)(`${id}_umbrella_palo`, scene);
            stickM.diffuseColor = (B().Color3).FromHexString(uc?.stickColor ?? '#5b4632');
            stickM.specularColor = new (B().Color3)(0, 0, 0);
            const d = uc?.size ?? 1.02;
            const yTop = a.rig ? a.height + 0.42 : a.height / 2 + 0.42;
            const stick = (B().MeshBuilder).CreateCylinder(`${id}_umbrella_palo`, { diameter: 0.035, height: 0.85 }, scene);
            stick.material = stickM;
            stick.isPickable = false;
            stick.parent = rootU;
            stick.position.set(0.06, yTop - 0.42, 0.05);
            const canopy = (B().MeshBuilder).CreateCylinder(`${id}_umbrella_tela`, { diameterTop: d * 0.16, diameterBottom: d, height: 0.16, tessellation: 20 }, scene);
            canopy.material = canopyM;
            canopy.isPickable = false;
            canopy.parent = rootU;
            canopy.position.set(0.06, yTop - 0.06, 0.05);
            const tip = (B().MeshBuilder).CreateSphere(`${id}_umbrella_punno`, { diameter: 0.05 }, scene);
            tip.material = stickM;
            tip.isPickable = false;
            tip.parent = rootU;
            tip.position.set(0.06, yTop + 0.05, 0.05);
            rootU.scaling.setAll(a.rig ? 1 : 1);
            a.umbrella = rootU;
            a.umbrellaK = 0.06;
          }
        }
        if (a.umbrella) {
          if (a.umbrellaK < 1) {
            a.umbrellaK = Math.min(1, a.umbrellaK + dt / Math.max(0.05, outdoor?.umbrella?.openSeconds ?? 0.45));
            const k = 0.06 + 0.94 * a.umbrellaK;
            for (const kid of a.umbrella.getChildMeshes()) {
              if (kid.name.includes('tela')) kid.scaling.setAll(k);
            }
          }
          a.umbrella.setEnabled(a.node.isEnabled());
        }
        if (a.bagsWant !== (a.bags !== null)) {
          if (a.bags) {
            a.bags.dispose(false, true);
            a.bags = null;
          } else {
            const bc = outdoor?.bags;
            const rootB = new (B().TransformNode)(`${id}_bolsas`, scene);
            rootB.parent = a.node;
            const yHand = a.rig ? a.height * 0.48 : -a.height * 0.05;
            for (const side of [-1, 1] as const) {
              const bagM = new (B().StandardMaterial)(`${id}_bolsa_mat_${side}`, scene);
              bagM.diffuseColor = (B().Color3).FromHexString(side < 0 ? bc?.colorA ?? '#d8c9a3' : bc?.colorB ?? '#9fb875');
              bagM.specularColor = new (B().Color3)(0, 0, 0);
              const bag = (B().MeshBuilder).CreateBox(`${id}_bolsa_${side}`, { width: 0.2, height: 0.26, depth: 0.15 }, scene);
              bag.material = bagM;
              bag.isPickable = false;
              bag.parent = rootB;
              bag.position.set(side * 0.26, yHand - 0.13, 0);
              const handle = (B().MeshBuilder).CreateBox(`${id}_bolsa_asa_${side}`, { width: 0.025, height: 0.12, depth: 0.025 }, scene);
              handle.material = bagM;
              handle.isPickable = false;
              handle.parent = rootB;
              handle.position.set(side * 0.26, yHand + 0.01, 0);
            }
            rootB.scaling.setAll(a.rig ? a.height / 1.5 : 1);
            a.bags = rootB;
          }
        }
        if (a.bags) a.bags.setEnabled(a.node.isEnabled());

        // ── Animación (solo rigs) por prioridad de estados (v1.2) + SINCRONÍA DE ZANCADA (v1.3):
        //   gesto explícito → run (speed > runSpeed) → walk (mientras se avanza) → clip de
        //   actividad parado → sentado en ancla → idle. El ratio de playback sale de la
        //   velocidad PLANA real (m/s en el suelo; la Y no mueve piernas) contra la velocidad
        //   natural del clip (rules.view.animSync): las piernas acompañan al cuerpo, cero patinaje.
        if (a.gestureT > 0) {
          a.gestureT -= dt;
          if (a.gestureT <= 0) a.gesture = null;
        }
        if (a.rig) {
          const speedH = Math.hypot(node.x - prevX, node.z - prevZ) / Math.max(1e-4, dt);
          const def = content.assets?.actors?.[r.archetype];
          const activityClip = def?.activityAnimations?.[r.activity ?? ''] ?? null;
          const walkClip = def?.walkAnimation ?? 'walk';
          let clip: string | null;
          if (a.gesture) clip = a.gesture;
          else if (speedH > v.runSpeed) clip = 'run';
          else if (speedH > 0.15) clip = walkClip; // v1.28: parar ANTES de seguir "andando en el sitio"
          else if (activityClip) clip = activityClip;
          else if (a.seated && a.path.length === 0) clip = 'sit';
          else clip = null;
          const sync = v.animSync;
          let rate = 1;
          if (!a.gesture && clip === 'run') rate = speedH / sync.runRefSpeed;
          else if (!a.gesture && clip === walkClip) rate = speedH / sync.walkRefSpeed;
          rate = Math.min(sync.maxRate, Math.max(sync.minRate, rate));
          a.rig.play(clip, rate);
        }
      }
    },
    /** Dirección de cutscenes (Fase D): toma/coloca/ruta/suelta actores como teatro. */
    director: {
      nodeOf(id: string): { x: number; y: number; z: number } | null {
        const a = actors.get(id);
        return a && a.node.isEnabled() ? { x: a.node.position.x, y: a.node.position.y, z: a.node.position.z } : null;
      },
      take(id: string): boolean {
        const r = world.residents[id];
        if (!r || !r.present || r.location === null) return false;
        if (!actors.has(id)) ensureActor(id, r.archetype);
        const a = actors.get(id)!;
        a.directed = true;
        a.seated = false;
        a.node.setEnabled(true);
        return true;
      },
      release(id: string): void {
        const a = actors.get(id);
        if (!a) return;
        a.directed = false;
        a.path = [];
        a.targetLocal = null;
        a.wanderT = 0;
        a.seated = false;
        a.gesture = null;
        a.gestureT = 0;
        a.targetYaw = null;
        // Si estaba esperando el ascensor, se cancela la llamada (el director libera el hueco).
        if (a.elevatorReq && elevators) {
          elevators.cancel(a.id);
          a.elevatorReq = null;
          a.ridePhase = null;
        }
      },
      stageAt(id: string, x: number, floor: number, z: number): void {
        const a = actors.get(id);
        if (!a) return;
        a.path = [];
        // El teatro manda: cualquier viaje en curso se cancela antes de colocar al actor.
        if (a.elevatorReq && elevators) {
          elevators.cancel(a.id);
          a.elevatorReq = null;
          a.ridePhase = null;
        }
        a.node.position.set(x, floor * v.cellH + 0.14 + a.pivotY, z);
      },
      walkTo(id: string, dest: { x: number; z: number; floor: number; inside?: { block: string; local: Pt } }): boolean {
        const a = actors.get(id);
        if (!a) return false;
        const b = dest.inside ? world.blocks[dest.inside.block] : undefined;
        const inside = b && dest.inside
          ? {
              block: b,
              local: {
                x: Math.min(b.size.w * v.cellW - 0.2, Math.max(0.2, dest.inside.local.x)),
                z: Math.min(depthOfBlock(b) - 0.2, Math.max(0.2, dest.inside.local.z)),
              },
            }
          : null;
        buildRoute(a, { x: dest.x, y: dest.floor * v.cellH + 0.14 + a.pivotY, z: dest.z, inside });
        return true;
      },
      /** v1.37 — RUTA LIBRE (paseo vecinal): tramos crudos del mundo (acera, paso de
       *  peatones, jardín de enfrente) para un actor DIRIGIDO — sin la ley del pasillo,
       *  que ahí fuera no manda. El actor consume los tramos con su locomoción de siempre. */
      strollPath(id: string, pts: { x: number; y: number; z: number }[]): boolean {
        const a = actors.get(id);
        if (!a || !a.directed) return false;
        a.path = pts.map((p) => ({ ...p }));
        return true;
      },
      /** v1.37 — sólidos del mundo (lavadoras de la lavandería): mismos rects que el jugador. */
      setObstacles(rects: { x0: number; z0: number; w: number; d: number }[]): void {
        solidRects = rects;
      },
      idle(id: string): boolean {
        const a = actors.get(id);
        return !a || (a.path.length === 0 && !a.elevatorReq);
      },
      seatWhenIdle(id: string, seat: { x: number; z: number; yaw: number }): boolean {
        const a = actors.get(id);
        if (!a) return false;
        a.seatPending = seat;
        if (a.path.length === 0 && !a.elevatorReq) {
          // Ya en quieto: sentado de inmediato (el vecino estaba al lado).
          a.node.position.set(seat.x, Math.round(a.node.position.y / v.cellH) * v.cellH + 0.14 + a.pivotY, seat.z);
          a.yaw = seat.yaw;
          a.targetYaw = null;
          const q = a.node.rotationQuaternion;
          if (q) Quaternion.RotationYawPitchRollToRef(seat.yaw + MODEL_YAW_OFFSET, 0, 0, q);
          else a.node.rotation.y = seat.yaw + MODEL_YAW_OFFSET;
          a.seated = true;
          a.seatPending = null;
        }
        return true;
      },
      headOf(id: string): { x: number; y: number; z: number } | null {
        const a = actors.get(id);
        // v1.42 — "existe" = nodo habilitado (con ancestros) Y no desvanecido: un actor en
        // fundido (cruzando la pared del portal) NO proyecta bocadillos — antes quedaban
        // flotando en mitad de la pared mientras el cuerpo era invisible.
        if (!a || !a.node.isEnabled(true) || a.fade <= 0.04) return null;
        const p = a.node.position;
        return { x: p.x, y: p.y + a.height + 0.18, z: p.z };
      },
      gestureOf(id: string): string | null {
        return actors.get(id)?.gesture ?? null;
      },
      /** v1.41 — ¿está EN ESCENA de verdad? (nodo habilitado: no fuera, no stowed, no oculto).
       *  v1.42 — también exige fundido > 0 (el teatro atraviesa paredes desvaneciendo). */
      visibleOf(id: string): boolean {
        const a = actors.get(id);
        return !!a && a.node.isEnabled(true) && a.fade > 0.04;
      },
      /** v1.41 — PARAGUAS on/off (el teatro de la calle decide con el clima). */
      setUmbrella(id: string, on: boolean): void {
        const a = actors.get(id);
        if (!a || a.umbrellaWant === on) return;
        a.umbrellaWant = on;
      },
      /** v1.41 — BOLSAS DE LA COMPRA on/off. */
      setBags(id: string, on: boolean): void {
        const a = actors.get(id);
        if (!a || a.bagsWant === on) return;
        a.bagsWant = on;
      },
      /** v1.41 — FADE del actor (visibilidad por malla; el teatro cruza al actor por la
       *  pared lateral del portal desvaneciéndolo, como los viandantes). */
      setFade(id: string, k: number): void {
        const a = actors.get(id);
        if (!a) return;
        const val = Math.max(0, Math.min(1, k));
        a.fade = val; // v1.42 — se recuerda: headOf/visibleOf lo consultan cada frame
        if (a.node instanceof B().Mesh) a.node.visibility = val;
        for (const m of a.node.getChildMeshes()) m.visibility = val;
      },
      /** v1.41 — se levanta del asiento (banco del paseo): sin pose sentada residual. */
      standUp(id: string): void {
        const a = actors.get(id);
        if (!a) return;
        a.seated = false;
        a.seatPending = null;
      },
      isDirected(id: string): boolean {
        return actors.get(id)?.directed ?? false;
      },
      isRiding(id: string): boolean {
        return actors.get(id)?.elevatorReq !== null && actors.get(id)?.elevatorReq !== undefined;
      },
      setGesture(id: string, state: string | null, seconds = 0): void {
        const a = actors.get(id);
        if (!a) return;
        a.gesture = state;
        a.gestureT = state && seconds > 0 ? seconds : 0;
        // v1.37 — el ejercicio del paseo rebota desde la altura ACTUAL (base del rebote).
        if (state && state === v.paseo?.gesture) a.bobBase = a.node.position.y;
        else a.bobBase = null;
      },
      /** Pausa de charla (v1.20): congela la locomoción; 0 suelta. */
      setHold(id: string, seconds: number): void {
        const a = actors.get(id);
        if (!a) return;
        a.chatT = Math.max(0, seconds);
        if (a.chatT === 0) {
          a.targetLocal = null;
          a.wanderT = 0;
        }
      },
      /** v1.35 — llevar algo encima (teatro de mudanza): forzado sobre el automático. */
      setCarrying(id: string, kind: 'box' | 'parcel' | null): void {
        const a = actors.get(id);
        if (!a) return;
        a.carryManual = kind;
      },
      /** Gira hacia un punto del mundo (arco corto con el ritmo del catálogo). */
      faceToward(id: string, x: number, z: number): void {
        const a = actors.get(id);
        if (!a) return;
        const dx = x - a.node.position.x;
        const dz = z - a.node.position.z;
        if (Math.hypot(dx, dz) < 0.05) return;
        a.targetYaw = Math.atan2(-dz, dx);
      },
    },
  };
}
