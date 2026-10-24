import type { BlockInstance, Command, CommandResult, Content, Input, InteractTarget, PlayerPosition, World } from '@/game/core/types';
import { dispatch, nextStepTowards } from '@/game/sim';
import { layoutGeometryOf, roomAt, walkable, type LayoutGeometry } from '@/game/interior';
import { stairGeomOf, stairPathPoints } from './stairs';

const smooth01 = (k: number): number => k * k * (3 - 2 * k);

export type InteractResult =
  | { type: 'none' }
  | { type: 'entered'; block: string }
  | { type: 'exited'; block: string }
  | { type: 'locked'; block: string; reason: string | null; price: number | null }
  | { type: 'used'; kind: 'laptop' | 'bed' | 'mailbox' | 'noticeboard' | 'resident' };

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
  mode: 'corridor' | 'inside' = 'corridor';
  insideBlock: string | null = null;
  private climb: { from: number; to: number; t: number; duration: number; external?: boolean; progress?: number; zOverride?: number | null } | null = null;
  /** Escalada REAL por el cubo (v1.4): el jugador recorre los peldaños del contrato
   *  (rules.view.stairs vía src/game/stairs.ts) — tramos con descansillo, X/Z variables. */
  private stairPath: { pts: { x: number; y: number; z: number }[]; i: number; to: number } | null = null;
  private climbPos = { x: 0, y: 0, z: 0 };
  private approached: string | null = null;
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

  constructor(
    private readonly world: World,
    private readonly content: Content,
    opts?: { actorId?: string; send?: SendCommand },
  ) {
    this.actorId = opts?.actorId ?? world.playerId;
    this.send = opts?.send ?? null;
    this.view = content.rules.view;
    const blocks = Object.values(world.blocks);
    this.width = Math.max(...blocks.map((b) => (b.cell.col + b.size.w) * this.view.cellW));
    this.topFloor = Math.max(...blocks.map((b) => b.cell.floor));
    // Si el actor aún no existe en el mundo (estado del servidor en camino), se cae al jugador clásico.
    const me = world.residents[this.actorId] ?? world.residents[world.playerId]!;
    const start = world.blocks[me.location ?? me.home] ?? blocks.find((b) => b.kind !== 'dwelling')!;
    this.floor = start.cell.floor;
    this.x = this.centerOf(start);
    this.z = 0;
    // Guardado (o sesión remota) con el residente DENTRO de una vivienda: aterriza en el interior
    // (sin esto, el modo 'corridor' del constructor sincronizaría un move al pasillo en el
    // primer frame y el jugador "saldría de casa" solo al cargar la partida).
    if (start.kind === 'dwelling') this.landInside(start);
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

  /** Aterriza dentro de una vivienda: plano frontal, y si cae en estancia cerrada, a la abierta más al frente. */
  private landInside(block: BlockInstance): void {
    this.mode = 'inside';
    this.insideBlock = block.id;
    this.z = 0.45;
    const geo = this.geometryOf(block);
    if (geo) {
      const room = roomAt(geo, this.x - block.cell.col * this.view.cellW, this.z);
      if (room.locked) {
        const open = geo.rooms.find((r) => !r.locked);
        if (open) this.x = block.cell.col * this.view.cellW + open.rect.x + open.rect.w / 2;
      }
    }
  }

  /** Bloque bajo los pies del jugador (zona común) o, si no, el pasillo. */
  zone(): BlockInstance {
    const common = this.onFloor(this.floor).find((b) => b.layer === 'main' && b.kind !== 'dwelling' && this.within(this.x, b));
    return common ?? this.corridor();
  }

  /** Vivienda o local justo delante (la puerta que puede abrir), si la hay. */
  doorInFront(): BlockInstance | null {
    if (this.mode !== 'corridor') return null;
    return this.onFloor(this.floor).find((b) => this.isDoorTarget(b) && this.within(this.x, b)) ?? null;
  }

  /** Objetivos de puerta: viviendas siempre; locales comunes transitables sin features (bar, lavandería…). */
  private isDoorTarget(b: BlockInstance): boolean {
    if (b.kind === 'dwelling') return true;
    if (b.layer !== 'main') return false;
    const def = this.content.blocks[b.defId]!;
    if (!def.traversable) return false;
    const f = def.features;
    return !f || Object.keys(f).length === 0;
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
      };
    }
    let floor = this.floor;
    if (this.climb) {
      if (this.climb.external) {
        // Viaje en ascensor (v1.5): el progreso lo marca el director de la cabina.
        const k = smooth01(this.climb.progress ?? 0);
        floor = this.climb.from + (this.climb.to - this.climb.from) * k;
        return { x: this.x, z: this.z, floor, mode: this.mode, insideBlock: this.insideBlock, climbing: true, pathZ: this.climb.zOverride ?? null };
      }
      const k = Math.min(1, this.climb.t / this.climb.duration);
      floor = this.climb.from + (this.climb.to - this.climb.from) * (k * k * (3 - 2 * k));
    }
    return { x: this.x, z: this.z, floor, mode: this.mode, insideBlock: this.insideBlock, climbing: this.climb !== null, pathZ: null };
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
    if (this.climb?.external) {
      this.floor = this.climb.to;
      this.climb = null;
      this.sync();
    }
  }



  private elevatorWorks(a: number, b: number) {
    const ok = (f: number) => this.elevatorBlock(f)?.params.elevator_status === 'ok';
    return ok(a) && ok(b);
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
   */
  private startClimb(delta: 1 | -1) {
    const to = this.floor + delta;
    if (to < 0 || to > this.topFloor) return; // planta 0 no baja; última no sube
    const z = this.zone();
    const feat = this.content.blocks[z.defId]!.features;
    if (!feat) return;
    const ride = feat.elevator === true && this.elevatorWorks(this.floor, to);
    if (!ride && feat.stairs !== true) return;
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
        return;
      }
    }
    this.climb = ride
      ? { from: this.floor, to, t: 0, duration: 0, external: true, progress: 0, zOverride: null }
      : { from: this.floor, to, t: 0, duration: this.view.elevatorSeconds };
  }

  update(dt: number, input: Input) {
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
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    // Correr (v1.2): multiplicador del catálogo (rules.view.runMultiplier); andar es el default.
    const speedMul = input.run ? this.view.runMultiplier : 1;
    if (this.mode === 'inside') {
      const home = this.world.blocks[this.insideBlock!]!;
      const dx = dir * this.view.roomSpeed * speedMul * dt;
      const dz = ((input.up ? 1 : 0) - (input.down ? 1 : 0)) * this.view.roomSpeed * speedMul * dt;
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
      const [a, b] = this.rangeOf(home);
      const x0 = home.cell.col * this.view.cellW;
      const clampX = (x: number) => Math.min(b - this.view.margin, Math.max(a + this.view.margin, x));
      const clampZ = (z: number) => Math.min(this.view.depth - this.view.margin, Math.max(this.view.margin, z));
      const cur = roomAt(geo, this.x - x0, this.z);
      const nx = clampX(this.x + dx);
      if (walkable(geo, cur, nx - x0, this.z)) this.x = nx;
      const cur2 = roomAt(geo, this.x - x0, this.z);
      const nz = clampZ(this.z + dz);
      if (walkable(geo, cur2, this.x - x0, nz)) this.z = nz;
      return;
    }
    this.x = Math.min(this.width - this.view.margin, Math.max(this.view.margin, this.x + dir * this.view.walkSpeed * speedMul * dt));
    this.sync();
    const door = this.doorInFront()?.id ?? null;
    if (door !== this.approached) {
      this.approached = door;
      if (door) this.exec({ type: 'approach', resident: this.actorId, block: door });
    }
    if (input.up) this.startClimb(1);
    else if (input.down) this.startClimb(-1);
  }

  /** Vecino que está a tu lado en el pasillo (o en tu misma vivienda). */
  residentNearby(): string | null {
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
      // En circulación, la referencia es el centro del bloque donde está (pasillo ancho → su centro).
      const theirX = (loc.cell.col + loc.size.w / 2) * this.view.cellW;
      if (Math.abs(theirX - this.x) < this.view.nearRadius) return other.id;
    }
    return null;
  }

  /** Objetivo de interacción actual según posición (para el prompt y la tecla E). */
  interactTarget(): InteractTarget | null {
    if (this.climb) return null;
    if (this.mode === 'inside') {
      const b = this.world.blocks[this.insideBlock!]!;
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
      return { kind: 'door', blockId: this.insideBlock! };
    }
    // Prioridad: puerta (acción habitual) → vecino → buzones → tablón. La tecla E y el
    // prompt leen SIEMPRE el mismo objetivo, así lo que ves es lo que la E ejecuta.
    const door = this.doorInFront();
    if (door) return { kind: 'door', blockId: door.id };
    const neighbor = this.residentNearby();
    if (neighbor) return { kind: 'resident', residentId: neighbor };
    const z = this.zone();
    const [za, zz] = this.rangeOf(z);
    if (this.content.blocks[z.defId]!.features?.mailboxes && Math.abs(this.x - (za + 1.2)) < this.view.itemRadius) return { kind: 'mailbox' };
    if (this.content.blocks[z.defId]!.features?.noticeboard && Math.abs(this.x - (zz - 0.8)) < this.view.itemRadius) return { kind: 'noticeboard' };
    return null;
  }

  /** Tecla de interacción: usa el objeto cercano (portátil/cama/buzón/tablón/vecino) o resuelve la puerta. */
  interact(): InteractResult {
    if (this.climb) return { type: 'none' };
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
      const other = this.world.residents[t.residentId]!;
      if (other.location) this.exec({ type: 'knock', block: other.location, actor: this.actorId });
      return { type: 'used', kind: 'resident' };
    }
    if (this.mode === 'inside') {
      const home = this.insideBlock!;
      const corridorId = this.corridor().id;
      const res = this.exec({ type: 'move', resident: this.actorId, to: corridorId });
      if (res && !res.ok) return { type: 'none' };
      this.mode = 'corridor';
      this.insideBlock = null;
      this.z = 0;
      this.lastMoveTarget = corridorId; // ya está en vuelo este move
      this.approached = home; // sigue delante de la misma puerta, sin repetir el aviso
      return { type: 'exited', block: home };
    }
    const door = this.doorInFront();
    if (!door) return { type: 'none' };
    const res = this.exec({ type: 'move', resident: this.actorId, to: door.id });
    // Rechazo = candado. En clásico lo dice el sim (res.ok false); en remoto el resultado llega
    // después (res null), así que el candado visible de la puerta manda: NADIE entra aquí.
    if (res ? !res.ok : door.access === 'locked') {
      return { type: 'locked', block: door.id, reason: door.lockReason, price: door.availability?.price ?? null };
    }
    this.lastMoveTarget = door.id; // ya está en vuelo este move
    if (door.kind === 'dwelling') this.landInside(door);
    else this.approached = door.id; // local común (bar/lavandería): te plantas en su puerta, sin modo interior
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
    this.z = 0;
    this.approached = null;
    this.externalRequested = false;
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
    if (!target) {
      const c = this.corridor(this.floor);
      this.mode = 'corridor';
      this.insideBlock = null;
      this.z = 0;
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
      this.z = 0;
    }
  }
}
