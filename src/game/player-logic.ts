import type { BlockInstance, Command, CommandResult, Content, Input, InteractTarget, PlayerPosition, World } from '@/game/core/types';
import { dispatch, nextStepTowards } from '@/game/sim';
import { layoutGeometryOf, roomAt, walkable, type LayoutGeometry } from '@/game/interior';
import { stairGeomOf, stairPathPoints } from './stairs';
import { corridorLanes, isStorageColumnBlock, storageCorridorX, storageDoorPoint, storageGeomOf } from './storage';
import { frontDoorSpans, type DoorSpan } from './frontDoors';


export type InteractResult =
  | { type: 'none' }
  | { type: 'entered'; block: string }
  | { type: 'exited'; block: string }
  | { type: 'locked'; block: string; reason: string | null; price: number | null }
  | { type: 'used'; kind: 'laptop' | 'bed' | 'mailbox' | 'noticeboard' | 'resident' }
  | { type: 'rearEnter'; block: string }
  | { type: 'rearExit'; block: string }
  /** v1.40 — vivienda ajena: E toca el TIMBRE (el controlador hace sonar y decide quién abre). */
  | { type: 'doorbell'; block: string }
  /** v1.40 — cruzarte con un vecino en circulación: E = pararse a charlar (sin puerta). */
  | { type: 'chat'; residentId: string }
  /** v1.42 — CALLE: portal sin tecla E (dirección manda) y vida exterior. */
  | { type: 'portalOut'; block: string }
  | { type: 'portalIn'; block: string }
  | { type: 'sit'; x: number; z: number; yaw: number }
  | { type: 'stand' }
  | { type: 'exerciseStart'; seconds: number }
  | { type: 'exerciseEnd' };

/**
 * Firma de la vía de salida de comandos. En partida clásica el controlador devuelve el
 * CommandResult del dispatch (bloqueo de puerta, etc.); en remoto devuelve void y el
 * resultado real llega por session:state (el servidor es la autoridad).
 */
export type SendCommand = (cmd: Command) => CommandResult | void;

/**
 * Lógica del personaje sin gráficos: dónde está, qué puerta tiene delante, escaleras y ascensor.
 * No decide nada por su cuenta (cada cambio de bloque pasa por el sim) y NO contiene constantes:
 * geometría y velocidades vienen de content.rules.view (catálogo greybox sustituible por arte final).
 *
 * Multi-actor: `actorId` identifica al residente controlado (por defecto world.playerId, igual que
 * siempre). Con `send`, cada comando sale por esa vía (multijugador) en lugar de hacer dispatch
 * local; sin `send` el comportamiento es idéntico al clásico.
 */
export class PlayerLogic {
  x: number;
  /** Profundidad en metros dentro de la vivienda (0 = plano frontal de la puerta). */
  z: number;
  floor: number;
  mode: 'corridor' | 'inside' | 'outside' = 'corridor';
  insideBlock: string | null = null;
  private climb: { from: number; to: number; t: number; duration: number; external?: boolean; progress?: number; zOverride?: number | null } | null = null;
  /** Escalada REAL por el cubo (v1.4): el jugador recorre los peldaños del contrato
   *  (rules.view.stairs vía src/game/stairs.ts) — tramos con descansillo, X/Z variables. */
  private stairPath: { pts: { x: number; y: number; z: number }[]; i: number; to: number } | null = null;
  private climbPos = { x: 0, y: 0, z: 0 };
  private approached: string | null = null;
  /** Apilamiento 3D (v1.19): celda de trastero propia activa como bloque trasero.
   *  El sim no cambia (sigues "en el bloque de trasteros"); la presentación hace el swap. */
  rearCell: { block: string; side: 'left' | 'right'; floor: number } | null = null;
  /** Congela la locomoción del sim mientras el cuerpo "está" dentro del bloque trasero. */
  rearHold = false;
  /** Posición viva dentro del interior del trastero (v1.21): movimiento libre con obstáculos. */
  private rearPos: { x: number; z: number } | null = null;
  /** Rects de obstáculos del interior (estanterías/trastos) que aporta building.ts. */
  private cellObstacles: { x0: number; z0: number; w: number; d: number }[] = [];
  /** v1.40 — auto-entrada en TU vivienda (sin E, como el núcleo de escaleras):
   *  última puerta que disparó la entrada automática (transición, no presión continua). */
  private autoEnterLast: string | null = null;
  /** v1.45 — INTENCIÓN DE CRUCE (sin E): el empujón direccional de ESTE frame hacia una
   *  puerta de planta 0 (locales) o hacia las correderas del portal. Lo consume
   *  building.update para abrir SOLO la puerta que se intenta atravesar — pasar de largo
   *  no abre nada. Se resetea al empezar cada update(). */
  private intentPortal = false;
  private intentBlock: string | null = null;
  /** v1.46 — PERMANENCIA del intent del portal: la corredera tarda portalDoors.openSeconds
   *  en abrirse y el cruce (teatro) dura un frame — el empujón mantiene la intención durante
   *  la apertura para que la hoja SE VEA abrir al atravesarla; se cierra sola al agotarse. */
  private intentPortalHold = 0;
  /** v1.40 — auto-salida de tu vivienda: se arma al adentrarse (z > 0.9) y salta al
   *  volver al marco de la puerta (z ≤ 0.5). Evita el bucle entrar/salir en el umbral. */
  private exitArmed = false;
  /** v1.40 — resultados de acciones automáticas (entrar/salir sin E) para el controlador
   *  (cambia de cámara con ellos). Se consumen con drainAuto(). */
  readonly autoEvents: InteractResult[] = [];
  private readonly width: number;
  private readonly topFloor: number;
  private readonly view;
  /** Residente controlado por esta lógica (world.playerId en solitario). */
  private readonly actorId: string;
  /** Vía de salida de comandos; si falta, el comando se despacha localmente (clásico). */
  private readonly send: SendCommand | null;
  /**
   * Anti-duplicado de move en remoto: mientras el servidor no haya confirmado el destino
   * (location !== z.id), no se reenvía el mismo move en cada frame.
   */
  private lastMoveTarget: string | null = null;
  /** Llamada de ascensor del jugador ya registrada (evita pedir la misma cada frame). */
  externalRequested = false;
  // ── v1.42 — LA CALLE: el jugador es un vecino más. Sale del portal caminando en la
  // dirección correcta (sin E), recorre aceras/paso de peatones/parque y se sienta en bancos.
  // No puede salir del plano de la cámara lejana (xMin/xMax del catálogo). El sim NO se
  // entera de la calle: su location queda en el portal (teatro puro, como el paseo). ──
  /** Fundido del cuerpo (0 invisible..1 visible) al atravesar el portal. */
  private fade = 1;
  /** Sentado en un banco exterior (pose del catálogo; cualquier dirección te levanta). */
  private sitting: { x: number; z: number; yaw: number } | null = null;
  /** Segundos de calistenia restantes (parque de enfrente). */
  private exerciseT = 0;
  /** Spots exteriores que aporta la presentación: bancos del decorado y punto de calistenia. */
  private outdoor: { benches: { x: number; z: number }[]; exercise: { x: number; z: number } | null } = { benches: [], exercise: null };
  /** v1.50 — POSICIÓN REAL del actor de un residente (la aporta el controlador): el prompt
   *  de charla no puede salir de la posición del SIM (el centro del bloque donde "está") —
   *  si el actor está en otra parte (o sin pintar), el aviso «E · charlar con…» se ve SIN
   *  NADIE delante. Con este resolver, la cercanía se mide contra el actor de verdad
   *  (null u otra planta = no hay charla). Sin resolver, manda la heurística clásica. */
  private readonly actorPos: ((residentId: string) => { x: number; z: number; floor: number } | null) | null;

  constructor(
    private readonly world: World,
    private readonly content: Content,
    opts?: {
      actorId?: string;
      send?: SendCommand;
      /** v1.50 — posición real del actor de un residente (null = no pintado/oculto). */
      actorPos?: (residentId: string) => { x: number; z: number; floor: number } | null;
    },
  ) {
    this.actorId = opts?.actorId ?? world.playerId;
    this.send = opts?.send ?? null;
    this.actorPos = opts?.actorPos ?? null;
    this.view = content.rules.view;
    const blocks = Object.values(world.blocks);
    // El ancho transitable lo marcan los bloques CON SUELO (v1.18): el tejado (traversable
    // false, w 11) NO puede abrir el clamp — con él, el jugador caminaba PASADA la pared
    // del edificio (x>24) sobre el vuelo del tejado: el "tramo que no muestra suelo".
    this.width = Math.max(
      ...blocks.filter((b) => this.content.blocks[b.defId]!.traversable !== false).map((b) => (b.cell.col + b.size.w) * this.view.cellW),
    );
    this.topFloor = Math.max(
      // Solo plantas con suelo transitable (v1.16): el tejado cierra el edificio pero no
      // tiene forjado — nunca es topFloor aunque sea la planta más alta de la plantilla.
      ...blocks.filter((b) => this.content.blocks[b.defId]!.traversable !== false).map((b) => b.cell.floor),
    );
    // Si el actor aún no existe en el mundo (estado del servidor en camino), se cae al jugador clásico.
    const me = world.residents[this.actorId] ?? world.residents[world.playerId]!;
    const start = world.blocks[me.location ?? me.home] ?? blocks.find((b) => b.kind !== 'dwelling')!;
    this.floor = start.cell.floor;
    this.x = this.centerOf(start);
    this.z = this.view.corridorZ; // en pasillo la Z es ABSOLUTA (v1.19: dos carriles)
    // Guardado (o sesión remota) con el residente DENTRO de una vivienda: aterriza en el interior
    // (sin esto, el modo 'corridor' del constructor sincronizaría un move al pasillo en el
    // primer frame y el jugador "saldría de casa" solo al cargar la partida).
    if (start.kind === 'dwelling') this.landInside(start);
  }

  /** v1.42 — bancos exteriores + punto de calistenia (el controlador los pasa del decorado). */
  setOutdoorSpots(benches: { x: number; z: number }[], exercise: { x: number; z: number } | null): void {
    this.outdoor = { benches, exercise };
  }

  /** v1.42 — ¿estás fuera del edificio? (modo calle; para HUD y el teatro del tráfico). */
  isOutside(): boolean {
    return this.mode === 'outside';
  }

  /** v1.42 — ¿sentado en un banco exterior? (el prompt «E · levantarse» manda). */
  isSitting(): boolean {
    return this.sitting !== null;
  }

  private rangeOf(b: BlockInstance): [number, number] {
    return [b.cell.col * this.view.cellW, (b.cell.col + b.size.w) * this.view.cellW];
  }
  private centerOf(b: BlockInstance): number {
    const [a, z] = this.rangeOf(b);
    return (a + z) / 2;
  }
  private within(x: number, b: BlockInstance): boolean {
    const [a, z] = this.rangeOf(b);
    return x >= a && x < z;
  }

  private get location(): string | null {
    return this.world.residents[this.actorId]!.location;
  }

  private onFloor(f: number) {
    return Object.values(this.world.blocks).filter((b) => b.cell.floor === f);
  }

  private corridor(f = this.floor): BlockInstance {
    return this.onFloor(f).find((b) => b.layer === 'corridor')!;
  }

  /** ¿Carril EXTERIOR del pasillo? (v1.19): sin avisos de elementos de pared. */
  onOuterLane(): boolean {
    return this.mode === 'corridor' && this.z < corridorLanes(this.view).threshold;
  }

  /** Plano frontal de los bloques (compartido con building/storage). */
  private get frontZ(): number {
    return this.view.roomZ - this.view.commonDepth / 2;
  }

  private elevatorBlock(f: number): BlockInstance | undefined {
    return this.onFloor(f).find((b) => this.content.blocks[b.defId]!.features?.elevator);
  }

  // ── Fase C: geometría interior 2D — compartida con la vida interior de los vecinos ──
  // (src/game/interior.ts: rects, tabiques, huecos, rutas y anclas; UNA fuente de verdad
  // para el jugador y los NPCs, siempre desde el catálogo layouts/rooms + rules.view).

  /** Geometría 2D del layout de una vivienda; null si el layout no declara rects (catálogo antiguo). */
  private geometryOf(block: BlockInstance): LayoutGeometry | null {
    return layoutGeometryOf(this.content, block);
  }

  /** Aterriza dentro de una vivienda: plano frontal, y si cae en estancia cerrada, a la abierta más al frente.
   *  v1.47 — el aterrizaje es SIEMPRE EN EL UMBRAL DE LA PUERTA: la x se ajusta al vano real
   *  (locales) o al centro de la hoja (viviendas) — entrar por el borde del hueco ya no
   *  aparece dentro del montante ni atraviesa visualmente la fachada. */
  private landInside(block: BlockInstance): void {
    this.mode = 'inside';
    this.insideBlock = block.id;
    this.z = 0.45;
    const spans = frontDoorSpans(this.view, block);
    if (spans.length > 0) {
      const s = spans.find((sp) => this.x >= sp.x0 && this.x <= sp.x1) ?? this.nearestSpan(spans, this.x);
      const [a, b] = this.rangeOf(block);
      this.x = Math.min(b - this.view.margin, Math.max(a + this.view.margin, (s.x0 + s.x1) / 2));
    } else if (block.kind === 'dwelling') {
      this.x = this.centerOf(block); // la hoja de privacidad vive en cx (misma caja que building)
    }
    const geo = this.geometryOf(block);
    if (geo) {
      const room = roomAt(geo, this.x - block.cell.col * this.view.cellW, this.z);
      if (room.locked) {
        const open = geo.rooms.find((r) => !r.locked);
        if (open) this.x = block.cell.col * this.view.cellW + open.rect.x + open.rect.w / 2;
      }
    }
  }

  /** Bloque bajo los pies del jugador (zona común) o, si no, el pasillo.
   *  v1.17: el cubo de escalera y el núcleo (con features) ganan al pasillo cuando se
   *  solapan — los pasillos extendidos (v1.16) comparten columna con el pozo y el orden
   *  del mapa dejaba la zona en el pasillo, dejando al jugador sin escalera en esas plantas.
   *  v1.18: los bloques SIN SUELO (tejado, traversable false) jamás son zona — encima de
   *  ellos no se camina y no deben robar el pozo al pasillo real. */
  zone(): BlockInstance {
    const common = this.onFloor(this.floor).filter(
      (b) => b.layer === 'main' && b.kind !== 'dwelling' && this.content.blocks[b.defId]!.traversable !== false && this.within(this.x, b),
    );
    const withShaft = common.find((b) => {
      const f = this.content.blocks[b.defId]!.features;
      return !!f && (f.stairs === true || f.elevator === true);
    });
    return withShaft ?? common[0] ?? this.corridor();
  }

  /** Vivienda o local justo delante (la puerta que puede abrir), si la hay.
   *  v1.19: desde el carril EXTERIOR del pasillo no hay puertas delante — es la vía de
   *  adelantamiento: ni avisos ni approach; los elementos de pared no se activan.
   *  v1.46 — LOS LOCALES SOLO «ESTÁN DELANTE» EN SU PUERTA: el aviso, la E y el empujón
   *  viven en el HUECO del vano (mismas medidas que dibuja building.ts, del catálogo);
   *  al lado de la ventana la fachada es pared — nada que activar. Así se entra y se
   *  sale por la puerta (el vecino: «no atravesando las paredes como ahora»). */
  doorInFront(): BlockInstance | null {
    if (this.mode !== 'corridor') return null;
    if (this.onOuterLane()) return null;
    const b = this.onFloor(this.floor).find((t) => this.isDoorTarget(t) && this.within(this.x, t)) ?? null;
    if (b && b.kind !== 'dwelling' && !this.atDoorGap(b)) return null;
    return b;
  }

  /** v1.46 — HUECOS DE PUERTA de un bloque (x de mundo): los MISMOS vanos que dibuja
   *  building.ts, medidos con el catálogo — UNA sola verdad compartida con los vecinos
   *  (src/game/frontDoors.ts). v1.47: el portal mide su apertura REAL (2 × slide).
   *  [] = sin disciplina de hueco (viviendas: siempre por su hoja central). */
  private doorSpansOf(b: BlockInstance): { x0: number; x1: number }[] {
    return frontDoorSpans(this.view, b);
  }

  /** v1.47 — vano más cercano a una x (para aterrizar dentro por SU puerta). */
  private nearestSpan(spans: DoorSpan[], x: number): DoorSpan {
    return spans.reduce((acc, s) =>
      Math.abs((s.x0 + s.x1) / 2 - x) < Math.abs((acc.x0 + acc.x1) / 2 - x) ? s : acc,
    );
  }

  /** v1.46 — ¿está el jugador EN el hueco de la puerta de este bloque? (x dentro de algún vano). */
  private atDoorGap(b: BlockInstance): boolean {
    const spans = this.doorSpansOf(b);
    return spans.length === 0 || spans.some((s) => this.x >= s.x0 && this.x <= s.x1);
  }

  /** v1.46 — umbral de salida de un local: en el hueco y pegado a la puerta (z ≤ exitZ).
   *  v1.47 — la salida es SIEMPRE andando (armada al cruzar el umbral, update interior).
   *  El chequeo vive inline; este helper ya no tiene llamadores. */

  /** Objetivos de puerta: viviendas siempre; locales comunes transitables sin features (bar,
   *  lavandería…); bloques con PASILLO INTERIOR (v1.18, trasteros por columna) también; y los
   *  bloques de mobiliario común (v1.18: portal con buzones/tablón/banco) AVISAN de su puerta
   *  (approach) — el tablón vive ahí y las misiones pueden pedirte llegar hasta él. Los pozos
   *  (escalera/ascensor) siguen sin ser puertas: son zonas de tránsito vertical. */
  private isDoorTarget(b: BlockInstance): boolean {
    if (b.kind === 'dwelling') return true;
    if (b.layer !== 'main') return false;
    const def = this.content.blocks[b.defId]!;
    if (!def.traversable) return false;
    const f = def.features;
    if (f?.innerCorridor) return true;
    if (!f) return true;
    if (f.stairs || f.elevator) return false;
    return true;
  }

  /** v1.46 — el empujón hacia las correderas del portal: intención INMEDIATA y permanente
   *  lo que tarda la hoja en abrir (catálogo) — el cruce es un corte de teatro de un frame
   *  y sin permanencia la corredera solo daría un temblor. */
  private pushPortalIntent(): void {
    this.intentPortal = true;
    this.intentPortalHold = (this.view.locals.portalDoors?.openSeconds ?? 0.8) + 0.25;
  }

  /**
   * v1.45 — la intención de cruce de ESTE frame: `portal` = empujar hacia las correderas
   * (desde la calle o desde el vestíbulo); `block` = local de planta 0 cuya hoja se está
   * empujando (avanzar hacia la fachada plantado delante de él). Sin tecla E: es mera
   * locomoción, igual que las puertas de la escalera.
   */
  crossingIntent(): { portal: boolean; block: string | null } {
    return { portal: this.intentPortal, block: this.intentBlock };
  }

  position(): PlayerPosition {
    // En el cubo de escalera (v1.4) la posición la marca el recorrido: X y Z absolutas del
    // tramo actual y planta fraccionaria derivada de la altura de pies (nodo = floor·cellH + canto).
    if (this.stairPath) {
      return {
        x: this.climbPos.x,
        z: 0,
        floor: (this.climbPos.y - this.view.slab * 2) / this.view.cellH,
        mode: 'corridor',
        insideBlock: null,
        climbing: true,
        pathZ: this.climbPos.z,
        rear: null,
        storage: null,
        fade: this.fade,
      };
    }
    let floor = this.floor;
    if (this.climb) {
      if (this.climb.external) {
        // Viaje en ascensor (v1.12): el progreso lo marca el director de la cabina y YA trae la
        // física del viaje (trapezoide aceleración–crucero–frenado proporcional a la distancia).
        // NO se re-suaviza aquí: la curva del jugador ha de ser EXACTAMENTE la de la cabina.
        const k = Math.min(1, Math.max(0, this.climb.progress ?? 0));
        floor = this.climb.from + (this.climb.to - this.climb.from) * k;
        return { x: this.x, z: this.z, floor, mode: this.mode, insideBlock: this.insideBlock, climbing: true, pathZ: this.climb.zOverride ?? null, rear: null, storage: null, fade: this.fade };
      }
      const k = Math.min(1, this.climb.t / this.climb.duration);
      floor = this.climb.from + (this.climb.to - this.climb.from) * (k * k * (3 - 2 * k));
    }
    // Apilamiento 3D (v1.19): dentro del trastero propio el cuerpo vive en el bloque trasero.
    const rear = this.rearCell ? this.rearSeat() : null;
    // Regla de cámara del pasillo de trasteros (v1.21): caminando el pasillo central de un
    // bloque de trasteros (sin estar dentro de la celda), la presentación centra la cámara
    // en el MEDIO del pasillo y lo mira de frente para verlo hasta el fondo.
    let storage: PlayerPosition['storage'] = null;
    if (!this.rearCell && this.mode === 'inside' && this.insideBlock) {
      const b = this.world.blocks[this.insideBlock]!;
      if (this.content.blocks[b.defId]?.features?.innerCorridor) {
        // Centro del CUERPO del bloque (no del nominal): el pasillo vive centrado en él.
        const cx = b.cell.col * this.view.cellW + (b.size.w * this.view.cellW - this.view.gapW) / 2;
        storage = { cx, frontZ: this.frontZ, depth: storageGeomOf(this.view).depth };
      }
    }
    return { x: this.x, z: this.z, floor, mode: this.mode, insideBlock: this.insideBlock, climbing: this.climb !== null, pathZ: null, rear, storage, fade: this.fade };
  }

  /** Rects de obstáculos del interior del trastero (v1.21): los registra building.ts al
   *  levantar la geometría (UNA sola verdad: las mismas cajas que se ven son las que estorban). */
  setCellObstacles(rects: { x0: number; z0: number; w: number; d: number }[]): void {
    this.cellObstacles = rects;
  }

  /** v1.37 — obstáculos andables POR BLOQUE (mundo): las lavadoras/secadoras de la
   *  lavandería son sólidas (el jugador no las atraviesa al moverse dentro). */
  private blockObstacles: Map<string, { x0: number; z0: number; w: number; d: number }[]> = new Map();
  setBlockObstacles(list: { blockId: string; rects: { x0: number; z0: number; w: number; d: number }[] }[]): void {
    this.blockObstacles = new Map(list.map((o) => [o.blockId, o.rects]));
  }

  /** v1.37 — posición del ATRIL del tablón de anuncios (la pasa el controlador desde
   *  building.noticeboardSpot()): el interact 'noticeboard' se consulta ahí. */
  private noticeSpot: { x: number; floor: number } | null = null;
  setNoticeboardSpot(spot: { x: number; floor: number } | null): void {
    this.noticeSpot = spot;
  }

  /** v1.47 — SÓLIDOS del pasillo de planta 0 (mundo): el atril del tablón NO se atraviesa
   *  (los mismos volúmenes que se ven; los registra building al levantar la geometría). */
  private corridorSolids: { x0: number; z0: number; w: number; d: number }[] = [];
  setCorridorObstacles(list: { x0: number; z0: number; w: number; d: number }[]): void {
    this.corridorSolids = list;
  }

  /** Posición (mundo) del cuerpo dentro del interior presentable del trastero propio. */
  private rearSeat(): { x: number; z: number } {
    if (this.rearPos) return this.rearPos;
    const b = this.world.blocks[this.rearCell!.block]!;
    const cx = (b.cell.col + b.size.w / 2) * this.view.cellW;
    const front = this.view.roomZ - this.view.commonDepth / 2;
    // La sala presentable vive en el frente del bloque (mismo plano que el resto del edificio).
    const z = front + this.view.trasteros.cellRoomDepth / 2 - 0.3;
    return { x: cx, z };
  }

  /** Info de la escalada en curso para el cableado del ascensor (null si no hay). */
  climbInfo(): { from: number; to: number } | null {
    return this.climb?.external ? { from: this.climb.from, to: this.climb.to } : null;
  }

  /** Progreso del viaje de cabina (0..1, lo pinta el director del ascensor). */
  setClimbProgress(k: number): void {
    if (this.climb?.external) this.climb.progress = Math.min(1, Math.max(0, k));
  }

  /** Z absoluta mientras el jugador "está dentro" de la cabina (null = pasillo de siempre). */
  setClimbZ(z: number | null): void {
    if (this.climb?.external) this.climb.zOverride = z;
  }

  /** Cierra el viaje externo: planta definitiva y sincronización con el sim. */
  finishClimb(): void {
    if (!this.climb?.external) return;
    this.finishRide(this.climb.to);
  }

  /**
   * Fin de viaje externo por AVERÍA a mitad de ruta (el director canceló la cabina): el jugador
   * aterriza en la planta MÁS CERCANA al progreso alcanzado — nunca un teletransporte a destino.
   */
  finishClimbAtNearest(): void {
    if (!this.climb?.external) return;
    const { from, to, progress } = this.climb;
    const nearest = Math.round(from + (to - from) * (progress ?? 0));
    this.finishRide(nearest);
  }

  /** Aterriza el viaje externo en `landing` y sincroniza el desplazamiento vertical con el sim. */
  private finishRide(landing: number): void {
    const floor = Math.max(0, Math.min(this.topFloor, landing));
    this.climb = null;
    this.floor = floor;
    this.z = this.view.corridorZ; // salida de cabina: carril interior del pasillo
    this.syncRideFloors(floor);
  }

  /**
   * Sincroniza la location del sim tras un viaje multialtura (v1.11): el comando `move` solo
   * admite saltos contiguos, así que un aterrizaje a N plantas de golpe se traduce en una
   * CADENA de moves calculada con el router del propio sim (nextStepTowards): por el pozo si
   * el ascensor está operativo, por la escalera si no — siempre saltos legales de 1 en 1.
   * Sin esto, la location del sim quedaba anclada a la planta de origen (desync permanente
   * tras cualquier viaje multialtura). Si un eslabón no procede, la cadena se detiene y el
   * sync normal de caminar seguirá acercando la location desde la última planta confirmada.
   */
  private syncRideFloors(landed: number): void {
    const col = this.zone().cell.col;
    const target = this.onFloor(landed).find((b) => b.layer === 'main' && b.cell.col === col && this.content.blocks[b.defId]!.features?.elevator);
    if (!target) return;
    this.lastMoveTarget = null;
    for (let guard = 0; guard < 32; guard++) {
      const loc = this.location;
      if (!loc || loc === target.id) return;
      const next = nextStepTowards(this.world, this.content, loc, target.id);
      if (!next) return;
      const r = this.exec({ type: 'move', resident: this.actorId, to: next });
      if (r && !r.ok) return;
    }
  }



  private elevatorWorks(a: number, b: number) {
    const ok = (f: number) => this.elevatorBlock(f)?.params.elevator_status === 'ok';
    return ok(a) && ok(b);
  }

  /**
   * Panel de destino del ascensor (v1.9): datos del pozo donde está el jugador para pintar el
   * selector de plantas (solo paradas OPERATIVAS en la misma columna). null si no está delante
   * de un núcleo operativo — condición GEMELA del prompt de la E: lo que el prompt anuncia es
   * exactamente lo que la E abre.
   */
  elevatorPanelTarget(): { col: number; current: number; floors: number[] } | null {
    if (this.climb || this.stairPath || this.mode !== 'corridor') return null;
    const z = this.zone();
    const feat = this.content.blocks[z.defId]!.features;
    if (feat?.elevator !== true || z.params.elevator_status !== 'ok') return null;
    const col = z.cell.col;
    const floors: number[] = [];
    for (let f = 0; f <= this.topFloor; f++) {
      const b = this.onFloor(f).find((x) => x.cell.col === col && x.layer === 'main' && this.content.blocks[x.defId]!.features?.elevator);
      if (b && b.params.elevator_status === 'ok') floors.push(f);
    }
    if (floors.length < 2) return null;
    return { col, current: this.floor, floors };
  }

  /**
   * Llamada de ascensor con destino EXPLÍCITO (panel v1.9): mismo viaje externo que W/S pero a
   * cualquier planta del pozo. La autoridad del viaje sigue siendo del sim (move al desembarcar);
   * aquí solo se pide cabina. false si la llamada no procede (avería, planta sin parada…).
   */
  elevatorCall(to: number): boolean {
    if (this.climb || this.stairPath || this.mode !== 'corridor') return false;
    if (to < 0 || to > this.topFloor || to === this.floor) return false;
    const z = this.zone();
    const feat = this.content.blocks[z.defId]!.features;
    if (feat?.elevator !== true || z.params.elevator_status !== 'ok') return false;
    if (!this.elevatorWorks(this.floor, to)) return false;
    const [a, b] = this.rangeOf(z);
    this.x = (a + b) / 2;
    this.climb = { from: this.floor, to, t: 0, duration: 0, external: true, progress: 0, zOverride: null };
    return true;
  }

  /**
   * Vía única de comandos: con `send` sale por ahí (multijugador; resultado null, el servidor
   * decide y confirma por session:state); sin `send`, dispatch local devolviendo su resultado
   * exactamente como siempre (clásico).
   */
  private exec(cmd: Command): CommandResult | null {
    const r = this.send ? this.send(cmd) : dispatch(this.world, this.content, cmd);
    return r ?? null;
  }

  private sync() {
    const z = this.zone();
    const loc = this.location;
    if (loc === z.id) {
      this.lastMoveTarget = null; // el servidor (o el sim local) ya confirmó este destino
      return;
    }
    if (z.id === this.lastMoveTarget) return; // en vuelo: no reenviar el mismo move cada frame
    this.lastMoveTarget = z.id;
    this.exec({ type: 'move', resident: this.actorId, to: z.id });
  }

  /**
   * Subir/bajar depende del pozo en el que estés. Escalera (v1.4): recorrido REAL por el cubo
   * (tramo A, descansillo, tramo B en dirección contraria) con el ritmo del catálogo
   * (stairs.climbSpeed). Ascensor operativo: viaje elevatorSeconds (cabina real en Task 30);
   * núcleo averiado no da gesto: hay que ir a la escalera.
   * v1.19: devuelve true SOLO si arrancó una escalada; si no, el llamador usa W/S para
   * cambiar de CARRIL en el pasillo (dos vías: interior junto a puertas, exterior junto a
   * la barandilla — desde el exterior no saltan avisos de pared).
   */
  private startClimb(delta: 1 | -1): boolean {
    const to = this.floor + delta;
    if (to < 0 || to > this.topFloor) return false; // planta 0 no baja; última no sube
    const z = this.zone();
    const feat = this.content.blocks[z.defId]!.features;
    if (!feat) return false;
    const ride = feat.elevator === true && this.elevatorWorks(this.floor, to);
    if (!ride && feat.stairs !== true) return false;
    const [a, zz] = this.rangeOf(z);
    this.x = (a + zz) / 2;
    const geom = !ride && feat.stairs === true ? stairGeomOf(this.view) : null;
    if (geom) {
      const y0 = this.floor * this.view.cellH + this.view.slab * 2;
      const y1 = to * this.view.cellH + this.view.slab * 2;
      const pts = stairPathPoints(this.view, this.x, y0, y1);
      if (pts.length > 1) {
        this.stairPath = { pts, i: 1, to };
        this.climbPos = { x: pts[0]!.x, y: pts[0]!.y, z: pts[0]!.z };
        return true;
      }
    }
    this.climb = ride
      ? { from: this.floor, to, t: 0, duration: 0, external: true, progress: 0, zOverride: null }
      : { from: this.floor, to, t: 0, duration: this.view.elevatorSeconds };
    return true;
  }

  update(dt: number, input: Input) {
    // v1.45 — la intención de cruce caduca en cuanto nace: se recalcula frame a frame.
    this.intentPortal = false;
    this.intentBlock = null;
    // v1.46 — permanencia del empujón del portal (mientras dura la apertura de la hoja).
    if (this.intentPortalHold > 0) {
      this.intentPortalHold = Math.max(0, this.intentPortalHold - dt);
      this.intentPortal = true;
    }
    // Apilamiento 3D (v1.19): el cuerpo está dentro del bloque trasero — la locomoción del
    // sim queda congelada. v1.21: DENTRO del trastero sí te mueves (libre, esquivando
    // estanterías y trastos); la salida sigue siendo la puerta (tecla E, del controlador).
    if (this.rearHold) {
      this.updateRear(dt, input);
      return;
    }
    // Escalada real por el cubo (v1.4): avanzar por los peldaños al ritmo del catálogo.
    if (this.stairPath) {
      const sp = this.stairPath;
      let budget = this.view.stairs.climbSpeed * dt;
      while (budget > 0 && sp.i < sp.pts.length) {
        const b = sp.pts[sp.i]!;
        const d = Math.hypot(b.x - this.climbPos.x, b.y - this.climbPos.y, b.z - this.climbPos.z);
        if (d <= budget + 1e-6) {
          this.climbPos = { x: b.x, y: b.y, z: b.z };
          budget -= d;
          sp.i += 1;
        } else {
          const t = budget / d;
          this.climbPos = { x: this.climbPos.x + (b.x - this.climbPos.x) * t, y: this.climbPos.y + (b.y - this.climbPos.y) * t, z: this.climbPos.z + (b.z - this.climbPos.z) * t };
          budget = 0;
        }
      }
      if (sp.i >= sp.pts.length) {
        this.floor = sp.to;
        this.stairPath = null;
        this.z = this.view.corridorZ; // desembarco: al carril interior del pasillo
        this.sync();
      }
      return;
    }
    if (this.climb) {
      if (this.climb.external) return; // el director del ascensor marca el progreso
      this.climb.t += dt;
      if (this.climb.t >= this.climb.duration) {
        this.floor = this.climb.to;
        this.climb = null;
        this.sync();
      }
      return;
    }
    // v1.42 — LA CALLE: aceras, paso de peatones, parque y bancos (todo del catálogo).
    if (this.mode === 'outside') {
      this.updateOutside(dt, input);
      return;
    }
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    // Correr (v1.2): multiplicador del catálogo (rules.view.runMultiplier); andar es el default.
    const speedMul = input.run ? this.view.runMultiplier : 1;
    if (this.mode === 'inside') {
      const home = this.world.blocks[this.insideBlock!]!;
      // v1.47 — el cuerpo CRUZANDO una pared (teatro del portal lateral) reaparece dentro:
      // el fundido se recupera también en interiores, no solo en la calle.
      if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / Math.max(0.05, this.view.outside?.portal.fadeSeconds ?? 0.35));
      const dx = dir * this.view.roomSpeed * speedMul * dt;
      const dz = ((input.up ? 1 : 0) - (input.down ? 1 : 0)) * this.view.roomSpeed * speedMul * dt;
      // ── Pasillo interior (v1.18, trasteros por columna): banda central transitable en X,
      //  fondo libre en Z hasta el tabique trasero. TODO sale del catálogo (storage.ts).
      //  v1.47 — SALIDA NATURAL (sin E): andar hacia la puerta (S en el vano) te devuelve
      //  al pasillo, igual que en los demás locales de planta 0.
      if (this.content.blocks[home.defId]!.features?.innerCorridor) {
        const sg = storageGeomOf(this.view);
        const [ca, cb] = storageCorridorX(home.cell.col * this.view.cellW, sg);
        const m = this.view.margin;
        this.x = Math.min(cb - m, Math.max(ca + m, this.x + dx));
        this.z = Math.min(sg.depth - m, Math.max(m, this.z + dz));
        const exitZc = this.view.locals.walkIn?.exitZ ?? 0.5;
        if (input.down && this.z <= exitZc && this.atDoorGap(home)) {
          const r = this.tryExitHome();
          if (r.type === 'exited') this.autoEvents.push(r);
        }
        this.sync();
        return;
      }
      const geo = this.geometryOf(home);
      if (!geo) {
        // Layout sin geometría 2D (catálogo antiguo): movimiento 1D de siempre.
        const [a, b] = this.rangeOf(home);
        this.x = Math.min(b - this.view.margin, Math.max(a + this.view.margin, this.x + dx));
        return;
      }
      // Movimiento 2D con deslizamiento: cada eje se prueba por separado contra tabiques,
      // huecos de puerta y estancias cerradas. TODO sale del catálogo (layout + rules.view).
      // Los rects del layout son LOCALES a la vivienda: se compara con la x local (x − borde izq.).
      // v1.19: el calado lo marca el LAYOUT (las salas traseras viven más allá de view.depth).
      const [a, b] = this.rangeOf(home);
      const x0 = home.cell.col * this.view.cellW;
      const maxZ = Math.max(...geo.rooms.map((r) => r.rect.z + r.rect.d));
      const clampX = (x: number) => Math.min(b - this.view.margin, Math.max(a + this.view.margin, x));
      const clampZ = (z: number) => Math.min(maxZ - this.view.margin, Math.max(this.view.margin, z));
      // v1.37 — SÓLIDOS del bloque (lavadoras de la lavandería): los mismos volúmenes que
      // se ven (rects en mundo de building.walkObstacles) bloquean el paso, con el radio
      // del actor. En vivienda no hay lista → no-op.
      const obs = this.blockObstacles.get(this.insideBlock!);
      const or_ = this.view.actorRadius;
      const hitsSolid = (wx: number, lz: number): boolean =>
        !!obs && obs.some((o) => wx > o.x0 - or_ && wx < o.x0 + o.w + or_ && lz > o.z0 - this.frontZ - or_ && lz < o.z0 - this.frontZ + o.d + or_);
      const cur = roomAt(geo, this.x - x0, this.z);
      const nx = clampX(this.x + dx);
      if (walkable(geo, cur, nx - x0, this.z) && !hitsSolid(nx, this.z)) this.x = nx;
      const cur2 = roomAt(geo, this.x - x0, this.z);
      const nz = clampZ(this.z + dz);
      if (walkable(geo, cur2, this.x - x0, nz) && !hitsSolid(this.x, nz)) this.z = nz;
      // v1.40/v1.46 — SALIDA SIN E POR LA PUERTA: en TU vivienda se arma al adentrarse
      // (z > walkIn.armZ) y salta al volver al marco (z ≤ walkIn.exitZ) — de siempre.
      // v1.46 — LOS LOCALES DE PLANTA 0 (garaje, trastero común, sala de juntas, lavandería)
      // heredan la misma regla Y la disciplina de hueco: la salida solo salta DENTRO del
      // vano de su puerta — entrar y salir es ANDAR hacia la puerta, nunca atravesar
      // paredes; la E de respaldo también se queda en el umbral (interactInside).
      // v1.49 — TAMBIÉN EN LAS VIVIENDAS AJENAS (walkIn.visitorExit): entraste llamando con
      // E (timbre) y sales ATRAVESANDO la puerta sin pulsar nada — mismo vano, mismo
      // empujón (S). La E dentro sigue como respaldo clásico en toda vivienda.
      const wi = this.view.locals.walkIn;
      const armZ = wi?.armZ ?? 0.9;
      const exitZ = wi?.exitZ ?? 0.5;
      const ownHome = home.ownerId === this.actorId;
      const locale = home.kind !== 'dwelling' && home.defId !== 'portal';
      const visitorExit = wi?.visitorExit ?? false;
      // v1.47 — ARMADA AL ENTRAR (walkIn.armOnEnter) + DIRECCIÓN MANDA: cruzar el umbral
      // arma la salida, pero solo salta EMPUJANDO hacia la puerta (S — la dirección del
      // cruce). Sin el requisito de dirección, entrar con W disparaba la salida del frame
      // siguiente (el aterrizaje z=0.45 ya está ≤ exitZ): entrar y salir era un bucle.
      if (ownHome || locale || visitorExit) {
        if (this.z > armZ) this.exitArmed = true;
        else if (this.exitArmed && input.down && this.z <= exitZ && (ownHome || this.atDoorGap(home))) {
          const r = this.tryExitHome();
          if (r.type === 'exited') this.autoEvents.push(r);
        }
      }
      // v1.42 — SALIDA DEL PORTAL SIN E: en el vestíbulo, caminar hacia la PARED IZQUIERDA
      // (ruta oficial del perímetro) o hacia las CORREDERAS DEL FRENTE ya te echa a la calle.
      this.portalExitTriggers(input);
      // v1.46 — VESTÍBULO → PASILLO sin E: empujar hacia el fondo del hall (W) te deja en
      // el pasillo de planta 0: el portal se CRUZA andando en ambos sentidos.
      this.portalInnerExit(input);
      return;
    }
    // Pasillo (v1.19): DOS carriles. A/D avanza en X; W/S, si no arrancan escalada (no hay
    // pozo delante o ya estás en el límite), cambian de carril: W hacia la fachada (interior,
    // junto a puertas y avisos), S hacia la barandilla (exterior, vía de adelantamiento).
    // v1.47 — SÓLIDOS del pasillo (tablón de anuncios): no se atraviesa, se esquiva.
    const lanes = corridorLanes(this.view);
    const dirZ = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    const rC = this.view.actorRadius;
    const hitsCorridor = (x: number, z: number): boolean =>
      this.corridorSolids.some((o) => x > o.x0 - rC && x < o.x0 + o.w + rC && z > o.z0 - rC && z < o.z0 + o.d + rC);
    let climbing = false;
    if (dirZ > 0) climbing = this.startClimb(1);
    else if (dirZ < 0) climbing = this.startClimb(-1);
    if (!climbing && dirZ !== 0) {
      const nz = Math.min(lanes.maxZ, Math.max(lanes.minZ, this.z + dirZ * this.view.walkSpeed * speedMul * dt));
      if (!hitsCorridor(this.x, nz)) this.z = nz;
    }
    const nxCor = Math.min(this.width - this.view.margin, Math.max(this.view.margin, this.x + dir * this.view.walkSpeed * speedMul * dt));
    if (!hitsCorridor(nxCor, this.z)) this.x = nxCor;
    this.sync();
    const door = this.doorInFront()?.id ?? null;
    if (door !== this.approached) {
      this.approached = door;
      if (door) this.exec({ type: 'approach', resident: this.actorId, block: door });
    }
    // v1.40 — ENTRADA DIRECTA A TU VIVIENDA (sin E, como el núcleo de escaleras): al
    // plantarte por primera vez delante de tu puerta, entras. Transición, no presión
    // continua: al alejarte se rearma (autoEnterLast se limpia), así que volver a
    // acercarse vuelve a entrar. La E sigue funcionando igual para todo lo demás.
    const ahead = this.doorInFront();
    if (this.autoEnterLast && this.autoEnterLast !== (ahead?.id ?? null)) this.autoEnterLast = null;
    if (ahead && ahead.kind === 'dwelling' && ahead.ownerId === this.actorId && this.autoEnterLast !== ahead.id) {
      this.autoEnterLast = ahead.id;
      const r = this.tryEnterDoor(ahead);
      if (r.type === 'entered') this.autoEvents.push(r);
    }
    // v1.41/v1.46 — ENTRADA DIRECTA A LOS LOCALES (sin E): la única excepción a «entrar
    // sin E» son las viviendas de los vecinos (ahí manda el timbre). Garaje, lavandería,
    // local, trasteros…: te plantas DELANTE DE SU PUERTA (v1.46: solo en el hueco —
    // doorInFront ya filtra) y ENPUJAS hacia ella (v1.45: avanzar hacia la fachada —
    // mera locomoción, igual que las de escalera) y la hoja se abre y entras. Con candado
    // no (norma del barrio: E avisa). Pasar de largo no abre ni entra (solo input.up).
    // v1.46 — EL PORTAL TAMBIÉN SE CRUZA ANDANDO: el empujón desde el pasillo entra al
    // vestíbulo (las correderas se abren con el mismo intent); desde el vestíbulo, W al
    // fondo te deja en el pasillo (portalInnerExit). Fin de la exclusión de v1.41: con el
    // empujón explícito ya no hay «entrar sin querer» al pasar de largo.
    if (ahead && input.up && ahead.kind !== 'dwelling' && ahead.access !== 'locked' && this.autoEnterLast !== ahead.id) {
      if (ahead.defId === 'portal') {
        this.pushPortalIntent(); // las correderas se abren con el empujón (y duran la apertura)
        this.enterPortal(true);
      } else {
        this.intentBlock = ahead.id; // la hoja abre con el mismo empujón
        this.autoEnterLast = ahead.id;
        const r = this.tryEnterDoor(ahead);
        if (r.type === 'entered') this.autoEvents.push(r);
      }
    }
  }

  // ─────────────── v1.42 — LA CALLE (mode 'outside') ───────────────

  /** Movimiento libre por el exterior del catálogo: unión de rects (aceras, paso de
   *  peatones — el ÚNICO cruce —, jardín de enfrente, entrante del portal), límites del
   *  plano de cámara y disparadores del portal SIN E: caminar en la dirección correcta
   *  ya sale o entra. Sentado solo se sale (cualquier dirección); ejercitando, se espera. */
  private updateOutside(dt: number, input: Input): void {
    const cfg = this.view.outside;
    if (!cfg) {
      // Sin catálogo de calle: no puede haber modo outside (defensivo) — vuelve al portal.
      this.mode = 'corridor';
      this.z = this.view.corridorZ;
      return;
    }
    // Fundido del portal: el cuerpo reaparece al atravesar la pared (teatro del paseo).
    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / Math.max(0.05, cfg.portal.fadeSeconds));
    // Ejercicio en curso: quieto (la presentación pone el gesto del catálogo) hasta acabar.
    if (this.exerciseT > 0) {
      this.exerciseT -= dt;
      if (this.exerciseT <= 0) {
        this.exerciseT = 0;
        this.autoEvents.push({ type: 'exerciseEnd' });
      }
      return;
    }
    // Sentado en un banco: cualquier dirección te levanta (la E también, en interact()).
    if (this.sitting) {
      if (input.left || input.right || input.up || input.down) {
        this.sitting = null;
        this.autoEvents.push({ type: 'stand' });
      }
      return;
    }
    const dirX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const dirZ = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    const step = this.view.walkSpeed * (input.run ? this.view.runMultiplier : 1) * dt;
    const inside = (x: number, z: number): boolean =>
      cfg.walk.some((rc) => x >= rc.x0 - 1e-4 && x <= rc.x1 + 1e-4 && z >= rc.z0 - 1e-4 && z <= rc.z1 + 1e-4);
    const nx = Math.min(cfg.xMax, Math.max(cfg.xMin, this.x + dirX * step));
    if (nx !== this.x && inside(nx, this.z)) this.x = nx;
    const nz = this.z + dirZ * step;
    if (nz !== this.z && inside(this.x, nz)) this.z = nz;
    // ── PORTAL SIN E: la dirección correcta ya entra (o sale). ──
    const portal = this.portalBlock();
    // v1.46 — el vano del portal sale del MISMO catálogo que el resto de puertas
    // (doorSpansOf): una sola verdad para el hueco acristalado desde la calle y el pasillo.
    if (input.up && this.z >= cfg.portal.inFrontZ && portal && this.atDoorGap(portal)) {
      this.pushPortalIntent(); // v1.46: el empujón abre las correderas y las mantiene abiertas
      this.enterPortal(true);
      return;
    }
    if (input.right && this.x >= cfg.portal.sideEnterX && Math.abs(this.z - cfg.portal.sideZ) < 1.0 && portal) {
      this.enterPortal(false);
      return;
    }
  }

  /** Disparadores de SALIDA al exterior estando dentro del portal (vestíbulo), sin E:
   *  caminar hacia la pared izquierda (ruta oficial del perímetro) o hacia las correderas
   *  del frente. El sim NO se entera: sigues "en el portal" (teatro como el paseo). */
  private portalExitTriggers(input: Input): void {
    const cfg = this.view.outside;
    const portal = this.portalBlock();
    if (!cfg || !portal || this.insideBlock !== portal.id) return;
    if (input.left && this.x <= cfg.portal.wallInnerX) {
      this.mode = 'outside';
      this.insideBlock = null;
      this.x = cfg.portal.sideExitX;
      this.z = cfg.portal.sideZ;
      this.fade = 0;
      this.approached = null;
      this.autoEvents.push({ type: 'portalOut', block: portal.id });
    } else if (input.down && this.z <= cfg.portal.frontInnerZ) {
      // v1.47 — SALIDA AL FRENTE = PASILLO DE PLANTA 0: empujar hacia las correderas te
      // planta en la acera cubierta del pasillo (como espera el vecino: salir del portal es
      // SEGUIR ANDANDO por la planta 0, no un muro invisible alineado con la pared derecha
      // del vestíbulo). A la calle se va por la ruta oficial del perímetro (pared izquierda).
      this.pushPortalIntent(); // las correderas se abren con el empujón (y las deja abrir)
      this.mode = 'corridor';
      this.insideBlock = null;
      this.z = this.view.corridorZ;
      this.fade = 1; // visible: se cruza por la puerta ya abierta, sin teatro
      this.approached = null;
      this.autoEvents.push({ type: 'exited', block: portal.id });
    }
  }

  /** v1.46 — VESTÍBULO → PASILLO sin E: empujar hacia el FONDO del hall (W, z local ≥
   *  backZoneZ del catálogo) te deja en el pasillo de planta 0 — el portal se cruza
   *  andando en ambos sentidos (calle ↔ vestíbulo ↔ pasillo), sin tecla E. tryExitHome
   *  ya deja approached/autoEnterLast apuntando al portal: al aterrizar no se re-entra
   *  solo; alejarse del vano lo rearma. */
  private portalInnerExit(input: Input): void {
    const portal = this.portalBlock();
    if (!portal || this.insideBlock !== portal.id) return;
    const backZ = this.view.locals.portal?.backZoneZ ?? 2.0;
    if (input.up && this.z >= backZ) {
      const r = this.tryExitHome();
      if (r.type === 'exited') this.autoEvents.push(r);
    }
  }

  /** Entrar al portal desde fuera (frente: correderas; lateral: fade por la pared oeste). */
  private enterPortal(fromFront: boolean): void {
    const cfg = this.view.outside;
    const portal = this.portalBlock();
    if (!cfg || !portal) return;
    if (this.location !== portal.id) {
      const res = this.exec({ type: 'move', resident: this.actorId, to: portal.id });
      if (res && !res.ok) return; // el sim manda: si no deja, no hay entrada
    }
    this.lastMoveTarget = portal.id;
    this.mode = 'inside';
    this.insideBlock = portal.id;
    if (fromFront) {
      // v1.47 — se entra VISIBLE por las correderas ya abiertas (el empujón del mismo frame
      // las abre): desaparecer al entrar era el bug «ya no se mira por dónde va».
      this.x = Math.min(this.rangeOf(portal)[1] - this.view.margin, Math.max(this.rangeOf(portal)[0] + this.view.margin, this.x));
      this.z = 0.45;
      this.fade = 1;
    } else {
      // Teatro de la pared oeste: el cuerpo se funde al cruzarla y reaparece dentro
      // (la recuperación del fade también vive en el modo interior).
      this.x = cfg.portal.wallInnerX - 0.1;
      this.z = cfg.portal.sideZ - this.frontZ; // z local del vestíbulo (world 0.35)
      this.fade = 0;
    }
    this.approached = portal.id;
    this.autoEnterLast = null;
    this.exitArmed = false;
    this.autoEvents.push({ type: 'portalIn', block: portal.id });
  }

  /** Bloque del portal (vestíbulo de buzones) o null si la plantilla no lo trae. */
  private portalBlock(): BlockInstance | null {
    return Object.values(this.world.blocks).find((b) => b.defId === 'portal') ?? null;
  }

  /** v1.40 — el controlador consume los resultados de las acciones automáticas (entrada
   *  en tu vivienda sin E, salida al marco de la puerta) para ajustar la cámara. */
  drainAuto(): InteractResult[] {
    return this.autoEvents.splice(0, this.autoEvents.length);
  }

  /** v1.40 — ¿estás en el marco de la puerta (interior)? Para callar el prompt «E · salir»
   *  justo cuando la salida automática está a punto de saltar.
   *  v1.49 — con walkIn.visitorExit aplica a TODA vivienda (ajenas incluidas): la salida
   *  natural atravesando la puerta manda y el prompt ya no sugiere la E (E queda como
   *  respaldo clásico, pero sin anunciarse en el umbral). */
  nearOwnDoor(): boolean {
    if (this.mode !== 'inside' || !this.insideBlock) return false;
    const b = this.world.blocks[this.insideBlock]!;
    if (b.kind !== 'dwelling') return false;
    const own = b.ownerId === this.actorId;
    if (!own && !(this.view.locals.walkIn?.visitorExit ?? false)) return false;
    return this.z <= 0.6;
  }

  /** v1.40 — timbre atendido (el vecino está dentro): el sim registra el toque social
   *  (afinidad + línea del saludo). El evento knock_result hace el resto en presentación. */
  knockAt(blockId: string): void {
    this.exec({ type: 'knock', block: blockId, actor: this.actorId });
  }

  /** v1.40 — entrar en un bloque por su puerta (el vecino acaba de abrir): misma vía que
   *  la E, con candados y norma del barrio. Devuelve el resultado para la cámara. */
  enterBlock(blockId: string): InteractResult {
    const door = this.onFloor(this.floor).find((b) => b.id === blockId) ?? this.world.blocks[blockId];
    if (!door) return { type: 'none' };
    return this.tryEnterDoor(door);
  }

  /** Movimiento libre DENTRO del interior del trastero propio (v1.21): límites de la sala
   *  + colisión axis-separada contra los rects registrados (estanterías, trastos). El sim
   *  no se entera (sin sync): al salir, el cuerpo vuelve exactamente a donde estaba. */
  private updateRear(dt: number, input: Input): void {
    const cell = this.rearCell;
    if (!cell) return;
    const b = this.world.blocks[cell.block]!;
    const sg = storageGeomOf(this.view);
    const D = this.view.trasteros.cellRoomDepth;
    const x0 = b.cell.col * this.view.cellW;
    const W = b.size.w * this.view.cellW - this.view.gapW;
    const front = this.frontZ;
    const pad = 0.3;
    const minX = x0 + sg.wallT + pad;
    const maxX = x0 + W - sg.wallT - pad;
    const minZ = front + sg.wallT + pad;
    const maxZ = front + D - sg.wallT - pad;
    const dirX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const dirZ = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    const step = this.view.roomSpeed * (input.run ? this.view.runMultiplier : 1) * dt;
    const r = this.view.actorRadius;
    const hits = (x: number, z: number): boolean =>
      this.cellObstacles.some((o) => x > o.x0 - r && x < o.x0 + o.w + r && z > o.z0 - r && z < o.z0 + o.d + r);
    const cur = this.rearSeat();
    let nx = Math.min(maxX, Math.max(minX, cur.x + dirX * step));
    if (nx !== cur.x && hits(nx, cur.z)) nx = cur.x;
    let nz = Math.min(maxZ, Math.max(minZ, cur.z + dirZ * step));
    if (nz !== cur.z && hits(nx, nz)) nz = cur.z;
    this.rearPos = { x: nx, z: nz };
  }

  /** Vecino que está a tu lado en el pasillo (o en tu misma vivienda). */
  residentNearby(): string | null {
    // v1.42 — en la calle el sim no manda (teatro): sin charlas de zona.
    if (this.mode === 'outside') return null;
    const r = this.world.residents[this.actorId]!;
    for (const other of Object.values(this.world.residents)) {
      if (other.id === r.id || !other.present || other.location === null) continue;
      const loc = this.world.blocks[other.location];
      if (!loc) continue;
      const myZone = this.mode === 'inside' ? this.insideBlock : this.zone().id;
      const theirZone = loc.kind === 'dwelling' ? (this.mode === 'inside' && this.insideBlock === loc.id ? loc.id : null) : loc.id;
      // Circulación compartida: en pasillo, un vecino en el pasillo o el núcleo de ESTA planta
      // está "a tu lado" aunque zone() te asigne el núcleo (capa main) y a él el pasillo.
      const sharedCirculation = this.mode === 'corridor' && loc.cell.floor === this.floor && loc.kind !== 'dwelling';
      if (theirZone !== myZone && !sharedCirculation) continue;
      // v1.50 — con posiciones reales de actores, la PROXIMIDAD manda el cuerpo pintado:
      // actor en mi planta y a distancia de charla (adiós al aviso fantasma que anunciaba a
      // un vecino cuyo cuerpo estaba en otra parte). La elegibilidad de ZONA sigue siendo la
      // del sim (nunca se charla «a través» de la pared de una vivienda ajena).
      if (this.actorPos) {
        const p = this.actorPos(other.id);
        if (!p || p.floor !== this.floor) continue;
        if (Math.hypot(p.x - this.x, p.z - (this.frontZ + this.z)) < this.view.nearRadius) return other.id;
        continue;
      }
      // En circulación, la referencia es el centro del bloque donde está (pasillo ancho → su centro).
      const theirX = (loc.cell.col + loc.size.w / 2) * this.view.cellW;
      if (Math.abs(theirX - this.x) < this.view.nearRadius) return other.id;
    }
    return null;
  }

  /** Objetivo de interacción actual según posición (para el prompt y la tecla E). */
  interactTarget(): InteractTarget | null {
    if (this.climb) return null;
    // Apilamiento 3D (v1.19): dentro del trastero propio la única salida es la puerta.
    if (this.rearCell) return { kind: 'rearExit' };
    // v1.42 — CALLE: banco exterior (sentarse) o calistenia (ejercicio).
    if (this.mode === 'outside') return this.outdoorTarget();
    if (this.mode === 'inside') {
      const b = this.world.blocks[this.insideBlock!]!;
      // Trastero propio (v1.19): delante de la puerta de TU celda → E abre el swap de bloques.
      // La puerta se compara en Z DE MUNDO (la z del jugador es local al pasillo interior).
      if (this.content.blocks[b.defId]!.features?.innerCorridor) {
        const cell = this.ownCellDoor(b);
        const worldZ = this.frontZ + this.z;
        if (cell && Math.abs(this.x - cell.x) < this.view.itemRadius * 0.75 && Math.abs(worldZ - cell.z) < this.view.itemRadius) {
          return { kind: 'storageCell' };
        }
        return null; // v1.47 — salir del bloque de trasteros es ANDAR hacia su puerta (sin E)
      }
      if (b.ownerId === this.actorId) {
        // Interactivos de la estancia actual (portátil/cama): posición 2D del catálogo, no offsets.
        const geo = this.geometryOf(b);
        if (geo) {
          const room = roomAt(geo, this.x - b.cell.col * this.view.cellW, this.z);
          const rdef = this.content.rooms[room.defId];
          for (const it of rdef?.interactables ?? []) {
            const wx = b.cell.col * this.view.cellW + room.rect.x + it.pos[0];
            const wz = room.rect.z + it.pos[1];
            if (Math.hypot(this.x - wx, this.z - wz) < this.view.itemRadius) return { kind: it.kind };
          }
        }
      }
      // v1.47 — UN SOLO SISTEMA (petición del vecino): los locales de planta 0 y el portal
      // se entran y se salen SOLO con el movimiento (sin E, sin prompt — dos mecanismos
      // distintos eran confusos). La E dentro solo habla en viviendas (salir) y objetos.
      const blk = this.world.blocks[this.insideBlock!]!;
      if (blk.kind !== 'dwelling') return null;
      return { kind: 'door', blockId: this.insideBlock! };
    }
    // Prioridad (v1.18): las fijaciones del portal (buzones, proximidad exacta) van
    // delante de la puerta — el portal ahora también es puerta (approach de misiones) y sin
    // esto su propia fachada se comería la E de los buzones. Después: puerta → vecino.
    // v1.19: desde el carril EXTERIOR nada de esto salta (ni buzones ni puertas).
    // v1.37 — el TABLÓN se consulta en el ATRIL del extremo del pasillo de planta 0:
    // posición que pasa building.noticeboardSpot() (UNA sola verdad con lo que se ve).
    if (!this.onOuterLane()) {
      const nb = this.noticeSpot;
      if (nb && this.floor === nb.floor && Math.abs(this.x - nb.x) < this.view.itemRadius) return { kind: 'noticeboard' };
      const zoneFirst = this.zone();
      const [za] = this.rangeOf(zoneFirst);
      if (this.content.blocks[zoneFirst.defId]!.features?.mailboxes && Math.abs(this.x - (za + 1.2)) < this.view.itemRadius) return { kind: 'mailbox' };
      const door = this.doorInFront();
      // v1.47 — la E solo anuncia puertas de VIVIENDA: los locales se entran andando
      // (empujón hacia la fachada) y anunciar «E · entrar» era el segundo sistema confuso.
      if (door && door.kind === 'dwelling') return { kind: 'door', blockId: door.id };
    }
    const neighbor = this.residentNearby();
    if (neighbor) return { kind: 'resident', residentId: neighbor };
    return null;
  }

  /** v1.42 — objetivo exterior: banco más cercano (dentro del radio del catálogo) o el
   *  punto de calistenia. Sentado, el propio banco es el objetivo (E = levantarse). */
  private outdoorTarget(): InteractTarget | null {
    const cfg = this.view.outside;
    if (!cfg) return null;
    if (this.sitting) return { kind: 'bench', x: this.sitting.x, z: this.sitting.z, yaw: this.sitting.yaw };
    if (this.exerciseT > 0) return { kind: 'exercise' };
    const ex = this.outdoor.exercise;
    if (ex && Math.hypot(this.x - ex.x, this.z - ex.z) < cfg.exercise.radius) return { kind: 'exercise' };
    let best: { d: number; x: number; z: number } | null = null;
    for (const b of this.outdoor.benches) {
      const d = Math.hypot(this.x - b.x, this.z - b.z);
      if (d < cfg.benchRadius && (!best || d < best.d)) best = { d, x: b.x, z: b.z };
    }
    if (best) return { kind: 'bench', x: best.x, z: best.z, yaw: -Math.PI / 2 };
    return null;
  }

  /** Puerta (mundo) de la celda del JUGADOR en un bloque de trasteros por columna; null si
   *  el bloque no es el de su letra. La celda es la de la vivienda del jugador. */
  private ownCellDoor(storageBlock: BlockInstance): { x: number; z: number; side: 'left' | 'right'; floor: number } | null {
    const me = this.world.residents[this.actorId]!;
    const home = this.world.blocks[me.home];
    if (!home) return null;
    const tag = home.id.slice(home.id.lastIndexOf('_') + 1);
    if (!storageBlock.id.endsWith(`_${tag}`)) return null;
    const floors = Object.values(this.world.blocks)
      .filter((d) => d.kind === 'dwelling' && d.id.endsWith(`_${tag}`))
      .map((d) => d.cell.floor)
      .sort((a, z) => a - z);
    const pt = storageDoorPoint(this.view, storageBlock, floors, home.cell.floor);
    return pt ? { ...pt, floor: home.cell.floor } : null;
  }

  /** Tecla de interacción: usa el objeto cercano (portátil/cama/buzón/tablón/vecino) o resuelve la puerta. */
  interact(): InteractResult {
    if (this.climb) return { type: 'none' };
    // Apilamiento 3D (v1.19): dentro del trastero propio, E es SALIR (el controlador
    // deshará el swap de bloques; el sim jamás supo que entraste).
    if (this.rearCell) {
      const block = this.rearCell.block;
      this.rearCell = null;
      this.rearHold = false;
      this.rearPos = null;
      return { type: 'rearExit', block };
    }
    const t = this.interactTarget();
    if (t?.kind === 'laptop') {
      this.exec({ type: 'work', actor: this.actorId });
      return { type: 'used', kind: 'laptop' };
    }
    if (t?.kind === 'bed') {
      this.exec({ type: 'sleep', actor: this.actorId });
      return { type: 'used', kind: 'bed' };
    }
    if (t?.kind === 'mailbox') return { type: 'used', kind: 'mailbox' }; // lectura: texto del catálogo en la presentación
    if (t?.kind === 'noticeboard') return { type: 'used', kind: 'noticeboard' };
    if (t?.kind === 'resident') {
      // v1.40 — CRUZARSE CON UN VECINO = CHARLA (regla del barrio): está fuera, en
      // circulación; la E os planta cara a cara y el controlador saca su línea de saludo.
      // Ya no se llama a su puerta por accidente: los timbres viven en las puertas.
      return { type: 'chat', residentId: t.residentId };
    }
    if (this.mode === 'outside') {
      return this.interactOutside();
    }
    if (this.mode === 'inside') {
      return this.interactInside();
    }
    const door = this.doorInFront();
    if (!door) return { type: 'none' };
    // v1.40 — TU VIVIENDA se entra sin E (auto en update); la E aquí es un atajo válido.
    if (door.kind === 'dwelling' && door.ownerId === this.actorId) return this.tryEnterDoor(door);
    // v1.40 — VIVIENDA AJENA: la E toca el TIMBRE. El controlador hace sonar, y si el
    // vecino está dentro se acerca a abrir (y nos deja pasar). Vacías ni se plantean:
    // nadie abriría (el controlador lo dice con su bocadillo de siempre).
    if (door.kind === 'dwelling') return { type: 'doorbell', block: door.id };
    // v1.47 — LOCALES SIN E: entrar es ANDAR (empujón hacia la fachada, mismo frame);
    // la E ya no participa en locales de planta 0 ni en el portal.
    return { type: 'none' };
  }

  /** v1.42 — E en la calle: levantarse del banco, sentarse a contemplar el edificio o
   *  un rato de calistenia en el parque de enfrente (duración del catálogo). */
  private interactOutside(): InteractResult {
    if (this.sitting) {
      this.sitting = null;
      return { type: 'stand' };
    }
    if (this.exerciseT > 0) return { type: 'none' };
    const cfg = this.view.outside;
    const t = this.outdoorTarget();
    if (t?.kind === 'bench') {
      this.sitting = { x: t.x, z: t.z, yaw: t.yaw };
      return { type: 'sit', x: t.x, z: t.z, yaw: t.yaw };
    }
    if (t?.kind === 'exercise' && cfg) {
      const secs = cfg.exercise.secondsMin + Math.random() * Math.max(0.1, cfg.exercise.secondsMax - cfg.exercise.secondsMin);
      this.exerciseT = secs;
      return { type: 'exerciseStart', seconds: secs };
    }
    return { type: 'none' };
  }

  /** v1.40 — E dentro de un bloque: trastero propio (celda), o salir por la puerta. */
  private interactInside(): InteractResult {
    const home = this.insideBlock!;
    // Apilamiento 3D (v1.19): delante de la puerta de TU celda, E entra al trastero
    // (swap de bloques) en vez de salir del bloque — solo sale quien no está en SU puerta.
    const homeBlock = this.world.blocks[home]!;
    if (this.content.blocks[homeBlock.defId]!.features?.innerCorridor) {
      const cell = this.ownCellDoor(homeBlock);
      const worldZ = this.frontZ + this.z;
      if (cell && Math.abs(this.x - cell.x) < this.view.itemRadius * 0.75 && Math.abs(worldZ - cell.z) < this.view.itemRadius) {
        this.rearCell = { block: homeBlock.id, side: cell.side, floor: cell.floor };
        this.rearHold = true;
        // v1.21: aterrizaje junto a la puerta (por dentro); desde ahí, movimiento libre.
        this.rearPos = { x: cell.x, z: this.frontZ + 0.75 };
        return { type: 'rearEnter', block: homeBlock.id };
      }
    }
    // v1.47 — UN SOLO SISTEMA: en locales y portal la salida es MOVIÉNDOSE hacia la puerta
    // (S en el vano; W al fondo del vestíbulo; S/A a la calle). La E dentro solo sale de
    // VIVIENDAS — y aquí sigue valiendo desde cualquier punto (salida clásica).
    const hb = this.world.blocks[home]!;
    if (hb.kind !== 'dwelling') return { type: 'none' };
    return this.tryExitHome();
  }

  /** v1.40 — salir del bloque interior al pasillo (compartido por la E y la auto-salida).
   *  v1.47 — el cuerpo sale VISIBLE (fade = 1): salir de un local/vivienda/portal al pasillo
   *  ya no hereda el fundido del portal (bug «el jugador desaparece en el edificio»). */
  private tryExitHome(): InteractResult {
    const home = this.insideBlock!;
    const corridorId = this.corridor().id;
    const res = this.exec({ type: 'move', resident: this.actorId, to: corridorId });
    if (res && !res.ok) return { type: 'none' };
    this.mode = 'corridor';
    this.insideBlock = null;
    this.z = this.view.corridorZ;
    this.fade = 1;
    this.lastMoveTarget = corridorId; // ya está en vuelo este move
    this.approached = home; // sigue delante de la misma puerta, sin repetir el aviso
    this.autoEnterLast = home; // delante de tu puerta: la auto-entrada NO re-dispara
    return { type: 'exited', block: home };
  }

  /** v1.40 — entrar por la puerta delante (compartido por la E y la auto-entrada).
   *  v1.26 — NORMA DEL BARRIO: no se entra en una vivienda VACÍA (nadie vive ahí, nadie
   *  abre); el candado lo dice el sim o la puerta. */
  private tryEnterDoor(door: BlockInstance): InteractResult {
    if (door.kind === 'dwelling' && door.occupancy !== 'occupied') {
      return { type: 'locked', block: door.id, reason: 'vacant', price: null };
    }
    // v1.46 — el portal SIEMPRE entra por su teatro (fade + portalIn + correderas con el
    // intent del mismo frame): la E desde el pasillo y el empujón comparten la misma vía.
    if (door.defId === 'portal' && this.view.outside) {
      this.enterPortal(true);
      return { type: 'entered', block: door.id };
    }
    const res = this.exec({ type: 'move', resident: this.actorId, to: door.id });
    // Rechazo = candado. En clásico lo dice el sim (res.ok false); en remoto el resultado llega
    // después (res null), así que el candado visible de la puerta manda: NADIE entra aquí.
    if (res ? !res.ok : door.access === 'locked') {
      return { type: 'locked', block: door.id, reason: door.lockReason, price: door.availability?.price ?? null };
    }
    this.lastMoveTarget = door.id; // ya está en vuelo este move
    // v1.47 — ARMADA AL ENTRAR (walkIn.armOnEnter): cruzar el umbral ya arma la salida
    // natural (entrar y darte la vuelta te deja fuera). walkIn.armOnEnter=false restaura
    // el armado clásico al adentrarse (z > armZ).
    this.exitArmed = this.view.locals.walkIn?.armOnEnter ?? true;
    if (door.kind === 'dwelling') {
      this.landInside(door);
    } else if (this.content.blocks[door.defId]!.features?.innerCorridor) {
      // Trasteros por columna (v1.18): modo interior sobre su pasillo central — caminas
      // hacia el fondo y tu celda queda a un lado (impares) o al otro (pares).
      this.mode = 'inside';
      this.insideBlock = door.id;
      this.z = 0.45;
      this.approached = door.id;
    } else if (this.geometryOf(door)) {
      // v1.30 — LOCALES CON INTERIOR (trastero comunitario, sala de juntas): igual que una
      // vivienda, el layout del catálogo marca el transitable — «tenemos que poder caminar
      // por todo el interior», también aquí. El sim registra el move (estás "en el local").
      this.landInside(door);
      this.approached = door.id;
    } else {
      this.approached = door.id; // local común (bar/lavandería): te plantas en su puerta, sin modo interior
    }
    return { type: 'entered', block: door.id };
  }

  /**
   * Colocación directa junto a la puerta de un bloque (QoL del editor multi-vivienda).
   * No desbloquea nada: si la puerta está cerrada, el jugador simplemente se planta delante.
   * La posición del sim se sincroniza recorriendo el camino legal del grafo de circulación
   * (mismo recorrido que andar: portal → núcleo → planta), sin teletransportes prohibidos.
   */
  teleportTo(blockId: string): boolean {
    const target = this.world.blocks[blockId];
    if (!target || this.climb || this.stairPath) return false;
    this.mode = 'corridor';
    this.insideBlock = null;
    this.rearCell = null;
    this.rearHold = false;
    this.rearPos = null;
    this.fade = 1; // v1.42
    this.sitting = null; // v1.42
    this.exerciseT = 0; // v1.42
    this.z = this.view.corridorZ;
    this.approached = null;
    this.externalRequested = false;
    this.autoEnterLast = null; // v1.40
    this.exitArmed = false; // v1.40
    this.floor = target.cell.floor;
    this.x = this.centerOf(target);
    for (let guard = 0; guard < 24; guard++) {
      const zone = this.zone();
      if (zone.id === this.location) break;
      const next = nextStepTowards(this.world, this.content, this.location ?? zone.id, zone.id);
      if (!next) break;
      this.exec({ type: 'move', resident: this.actorId, to: next });
    }
    this.lastMoveTarget = null; // los move en vuelo los confirmará el estado; sin dedup pendiente
    return true;
  }

  /**
   * Reconciliación multijugador: impone la posición que dice el servidor (autoridad).
   * Fija modo, planta y coordenada X al centro del bloque indicado; con null coloca en el
   * pasillo de la planta actual. Resetea climb y el dedup de move.
   */
  forceLocation(blockId: string | null): void {
    const target = blockId !== null ? this.world.blocks[blockId] : undefined;
    this.climb = null;
    this.stairPath = null;
    this.externalRequested = false;
    this.lastMoveTarget = null;
    this.rearCell = null;
    this.rearHold = false;
    this.rearPos = null;
    this.fade = 1; // v1.42
    this.sitting = null; // v1.42
    this.exerciseT = 0; // v1.42
    this.autoEnterLast = null; // v1.40
    this.exitArmed = false; // v1.40
    if (!target) {
      const c = this.corridor(this.floor);
      this.mode = 'corridor';
      this.insideBlock = null;
      this.z = this.view.corridorZ;
      this.x = this.centerOf(c);
      return;
    }
    this.floor = target.cell.floor;
    this.x = this.centerOf(target);
    if (target.kind === 'dwelling') {
      this.landInside(target);
    } else {
      this.mode = 'corridor';
      this.insideBlock = null;
      this.z = this.view.corridorZ;
    }
  }
}
