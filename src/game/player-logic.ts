import type { BlockInstance, Command, CommandResult, Content, Input, InteractTarget, PlayerPosition, World } from '@/game/core/types';
import { dispatch, nextStepTowards } from '@/game/sim';

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
  floor: number;
  mode: 'corridor' | 'inside' = 'corridor';
  insideBlock: string | null = null;
  private climb: { from: number; to: number; t: number; duration: number } | null = null;
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

  private core(f: number): BlockInstance | undefined {
    return this.onFloor(f).find((b) => this.content.blocks[b.defId]!.features?.stairs);
  }

  /** Bloque bajo los pies del jugador (zona común) o, si no, el pasillo. */
  zone(): BlockInstance {
    const common = this.onFloor(this.floor).find((b) => b.layer === 'main' && b.kind !== 'dwelling' && this.within(this.x, b));
    return common ?? this.corridor();
  }

  /** Vivienda justo delante (la puerta que puede abrir), si la hay. */
  doorInFront(): BlockInstance | null {
    if (this.mode !== 'corridor') return null;
    return this.onFloor(this.floor).find((b) => b.kind === 'dwelling' && this.within(this.x, b)) ?? null;
  }

  position(): PlayerPosition {
    let floor = this.floor;
    if (this.climb) {
      const k = Math.min(1, this.climb.t / this.climb.duration);
      floor = this.climb.from + (this.climb.to - this.climb.from) * (k * k * (3 - 2 * k));
    }
    return { x: this.x, floor, mode: this.mode, insideBlock: this.insideBlock, climbing: this.climb !== null };
  }

  private elevatorWorks(a: number, b: number) {
    const ok = (f: number) => this.core(f)?.params.elevator_status === 'ok';
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

  private startClimb(delta: 1 | -1) {
    const to = this.floor + delta;
    const core = this.core(this.floor);
    if (to < 0 || to > this.topFloor || !core || this.zone().id !== core.id) return;
    const [a, z] = this.rangeOf(core);
    this.x = (a + z) / 2;
    this.climb = { from: this.floor, to, t: 0, duration: this.elevatorWorks(this.floor, to) ? this.view.elevatorSeconds : this.view.stairsSeconds };
  }

  update(dt: number, input: Input) {
    if (this.climb) {
      this.climb.t += dt;
      if (this.climb.t >= this.climb.duration) {
        this.floor = this.climb.to;
        this.climb = null;
        this.sync();
      }
      return;
    }
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (this.mode === 'inside') {
      const home = this.world.blocks[this.insideBlock!]!;
      const [a, z] = this.rangeOf(home);
      this.x = Math.min(z - this.view.margin, Math.max(a + this.view.margin, this.x + dir * this.view.roomSpeed * dt));
      return;
    }
    this.x = Math.min(this.width - this.view.margin, Math.max(this.view.margin, this.x + dir * this.view.walkSpeed * dt));
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
        const home = b;
        // Portátil en el salón: lado izquierdo; cama en el dormitorio: lado derecho (offsets del catálogo).
        if (home.cell.col === this.world.blocks[this.world.residents[this.actorId]!.home].cell.col) {
          const [a, z] = this.rangeOf(home);
          const nearLaptop = Math.abs(this.x - (a + this.view.laptopOffset)) < this.view.itemRadius;
          const nearBed = Math.abs(this.x - (z - this.view.bedOffset)) < this.view.itemRadius;
          if (nearLaptop) return { kind: 'laptop' };
          if (nearBed) return { kind: 'bed' };
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
      this.lastMoveTarget = corridorId; // ya está en vuelo este move
      this.approached = home; // sigue delante de la misma puerta, sin repetir el aviso
      return { type: 'exited', block: home };
    }
    const door = this.doorInFront();
    if (!door) return { type: 'none' };
    const res = this.exec({ type: 'move', resident: this.actorId, to: door.id });
    if (res && !res.ok) return { type: 'locked', block: door.id, reason: door.lockReason, price: door.availability?.price ?? null };
    this.mode = 'inside';
    this.insideBlock = door.id;
    this.lastMoveTarget = door.id; // ya está en vuelo este move
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
    if (!target || this.climb) return false;
    this.mode = 'corridor';
    this.insideBlock = null;
    this.approached = null;
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
    this.lastMoveTarget = null;
    if (!target) {
      const c = this.corridor(this.floor);
      this.mode = 'corridor';
      this.insideBlock = null;
      this.x = this.centerOf(c);
      return;
    }
    this.floor = target.cell.floor;
    this.x = this.centerOf(target);
    if (target.kind === 'dwelling') {
      this.mode = 'inside';
      this.insideBlock = target.id;
    } else {
      this.mode = 'corridor';
      this.insideBlock = null;
    }
  }
}
