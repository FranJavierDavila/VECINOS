import type { Content } from '@vecinos/content';
import { dispatch, type BlockInstance, type World } from '@vecinos/sim';

/** Unidades del mundo del visor: ancho y alto de una celda de la cuadrícula del edificio. */
export const CELL_W = 2.4;
export const CELL_H = 2.0;

const WALK_SPEED = 3.4;
const ROOM_SPEED = 2.4;
const STAIRS_SECONDS = 1.6;
const ELEVATOR_SECONDS = 0.6;
const MARGIN = 0.35;

export interface Input {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export type InteractResult =
  | { type: 'none' }
  | { type: 'entered'; block: string }
  | { type: 'exited'; block: string }
  | { type: 'locked'; block: string; reason: string | null; price: number | null };

export interface PlayerPosition {
  x: number;
  /** Altura en unidades de planta (fraccionaria mientras sube o baja). */
  floor: number;
  mode: 'corridor' | 'inside';
  insideBlock: string | null;
  climbing: boolean;
}

const range = (b: BlockInstance): [number, number] => [b.cell.col * CELL_W, (b.cell.col + b.size.w) * CELL_W];
const within = (x: number, b: BlockInstance) => {
  const [a, z] = range(b);
  return x >= a && x < z;
};

/**
 * Lógica del personaje sin gráficos: dónde está, qué puerta tiene delante, escaleras y ascensor, entrar y salir.
 * No decide nada por su cuenta: cada cambio de bloque pasa por `dispatch`, que aplica las reglas del edificio.
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

  constructor(
    private readonly world: World,
    private readonly content: Content,
  ) {
    const blocks = Object.values(world.blocks);
    this.width = Math.max(...blocks.map((b) => (b.cell.col + b.size.w) * CELL_W));
    this.topFloor = Math.max(...blocks.map((b) => b.cell.floor));
    const here = world.blocks[world.residents[world.playerId]!.location!]!;
    this.floor = here.cell.floor;
    this.x = (range(here)[0] + range(here)[1]) / 2;
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

  /** Bloque en el que está el jugador según su posición: zona común bajo sus pies o, si no, el pasillo. */
  zone(): BlockInstance {
    const common = this.onFloor(this.floor).find((b) => b.layer === 'main' && b.kind !== 'dwelling' && within(this.x, b));
    return common ?? this.corridor();
  }

  /** Vivienda que tiene justo delante (la puerta que puede abrir), si la hay. */
  doorInFront(): BlockInstance | null {
    if (this.mode !== 'corridor') return null;
    return this.onFloor(this.floor).find((b) => b.kind === 'dwelling' && within(this.x, b)) ?? null;
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
    const [a, z] = range(core);
    this.x = (a + z) / 2;
    this.climb = { from: this.floor, to, t: 0, duration: this.elevatorWorks(this.floor, to) ? ELEVATOR_SECONDS : STAIRS_SECONDS };
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
      const [a, z] = range(home);
      this.x = Math.min(z - MARGIN, Math.max(a + MARGIN, this.x + dir * ROOM_SPEED * dt));
      return;
    }
    this.x = Math.min(this.width - MARGIN, Math.max(MARGIN, this.x + dir * WALK_SPEED * dt));
    this.sync();
    const door = this.doorInFront()?.id ?? null;
    if (door !== this.approached) {
      this.approached = door;
      if (door) dispatch(this.world, this.content, { type: 'approach', resident: this.world.playerId, block: door });
    }
    if (input.up) this.startClimb(1);
    else if (input.down) this.startClimb(-1);
  }

  /** Tecla de interacción: entrar por la puerta que tienes delante, o salir si estás dentro. */
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
}
