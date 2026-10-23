import type { BlockInstance, Content, Input, InteractTarget, PlayerPosition, World } from '@/game/core/types';
import { dispatch } from '@/game/sim';

export type InteractResult =
  | { type: 'none' }
  | { type: 'entered'; block: string }
  | { type: 'exited'; block: string }
  | { type: 'locked'; block: string; reason: string | null; price: number | null };

/**
 * Lógica del personaje sin gráficos: dónde está, qué puerta tiene delante, escaleras y ascensor.
 * No decide nada por su cuenta (cada cambio de bloque pasa por `dispatch`) y NO contiene constantes:
 * geometría y velocidades vienen de content.rules.view (catálogo greybox sustituible por arte final).
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

  constructor(
    private readonly world: World,
    private readonly content: Content,
  ) {
    this.view = content.rules.view;
    const blocks = Object.values(world.blocks);
    this.width = Math.max(...blocks.map((b) => (b.cell.col + b.size.w) * this.view.cellW));
    this.topFloor = Math.max(...blocks.map((b) => b.cell.floor));
    const start = world.blocks[world.residents[world.playerId]!.location ?? world.residents[world.playerId]!.home] ?? blocks.find((b) => b.kind !== 'dwelling')!;
    this.floor = start.cell.floor;
    this.x = (this.rangeOf(start)[0] + this.rangeOf(start)[1]) / 2;
  }

  private rangeOf(b: BlockInstance): [number, number] {
    return [b.cell.col * this.view.cellW, (b.cell.col + b.size.w) * this.view.cellW];
  }
  private within(x: number, b: BlockInstance): boolean {
    const [a, z] = this.rangeOf(b);
    return x >= a && x < z;
  }

  private get location(): string | null {
    return this.world.residents[this.world.playerId]!.location;
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

  private sync() {
    const z = this.zone();
    if (z.id !== this.location) dispatch(this.world, this.content, { type: 'move', resident: this.world.playerId, to: z.id });
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
      if (door) dispatch(this.world, this.content, { type: 'approach', resident: this.world.playerId, block: door });
    }
    if (input.up) this.startClimb(1);
    else if (input.down) this.startClimb(-1);
  }

  /** Vecino que está a tu lado en el pasillo (o en tu misma vivienda). */
  residentNearby(): string | null {
    const r = this.world.residents[this.world.playerId]!;
    for (const other of Object.values(this.world.residents)) {
      if (other.id === r.id || !other.present || other.location === null) continue;
      const loc = this.world.blocks[other.location];
      if (!loc) continue;
      const myZone = this.mode === 'inside' ? this.insideBlock : this.zone().id;
      const theirZone = loc.kind === 'dwelling' ? (this.mode === 'inside' && this.insideBlock === loc.id ? loc.id : null) : loc.id;
      if (!theirZone || theirZone !== myZone) continue;
      if (Math.abs((loc.cell.col + loc.size.w / 2) * this.view.cellW - this.x) < this.view.nearRadius) return other.id;
    }
    return null;
  }

  /** Objetivo de interacción actual según posición (para el prompt y la tecla E). */
  interactTarget(): InteractTarget | null {
    if (this.climb) return null;
    if (this.mode === 'inside') {
      const b = this.world.blocks[this.insideBlock!]!;
      if (b.ownerId === this.world.playerId) {
        const home = b;
        // Portátil en el salón: lado izquierdo; cama en el dormitorio: lado derecho (offsets del catálogo).
        if (home.cell.col === this.world.blocks[this.world.residents[this.world.playerId]!.home].cell.col) {
          const [a, z] = this.rangeOf(home);
          const nearLaptop = Math.abs(this.x - (a + this.view.laptopOffset)) < this.view.itemRadius;
          const nearBed = Math.abs(this.x - (z - this.view.bedOffset)) < this.view.itemRadius;
          if (nearLaptop) return { kind: 'laptop' };
          if (nearBed) return { kind: 'bed' };
        }
      }
      return { kind: 'door', blockId: this.insideBlock! };
    }
    const neighbor = this.residentNearby();
    if (neighbor) return { kind: 'resident', residentId: neighbor };
    const door = this.doorInFront();
    if (door) return { kind: 'door', blockId: door.id };
    const z = this.zone();
    const [za, zz] = this.rangeOf(z);
    if (this.content.blocks[z.defId]!.features?.mailboxes && Math.abs(this.x - (za + 1.2)) < this.view.itemRadius) return { kind: 'mailbox' };
    if (this.content.blocks[z.defId]!.features?.noticeboard && Math.abs(this.x - (zz - 0.8)) < this.view.itemRadius) return { kind: 'noticeboard' };
    return null;
  }

  /** Tecla de interacción: entrar por la puerta delante, salir si estás dentro, o usar el objeto cercano. */
  interact(): InteractResult {
    if (this.climb) return { type: 'none' };
    if (this.mode === 'inside') {
      const home = this.insideBlock!;
      const res = dispatch(this.world, this.content, { type: 'move', resident: this.world.playerId, to: this.corridor().id });
      if (!res.ok) return { type: 'none' };
      this.mode = 'corridor';
      this.insideBlock = null;
      this.approached = home; // sigue delante de la misma puerta, sin repetir el aviso
      return { type: 'exited', block: home };
    }
    const door = this.doorInFront();
    if (!door) return { type: 'none' };
    const res = dispatch(this.world, this.content, { type: 'move', resident: this.world.playerId, to: door.id });
    if (!res.ok) return { type: 'locked', block: door.id, reason: door.lockReason, price: door.availability?.price ?? null };
    this.mode = 'inside';
    this.insideBlock = door.id;
    return { type: 'entered', block: door.id };
  }

  /**
   * Colocación directa junto a la puerta de un bloque (QoL del editor multi-vivienda).
   * No desbloquea nada: si la puerta está cerrada, el jugador simplemente se planta delante.
   */
  teleportTo(blockId: string): boolean {
    const target = this.world.blocks[blockId];
    if (!target || this.climb) return false;
    const [a, z] = this.rangeOf(target);
    this.mode = 'corridor';
    this.insideBlock = null;
    this.approached = null;
    this.floor = target.cell.floor;
    this.x = (a + z) / 2;
    this.sync();
    return true;
  }
}
