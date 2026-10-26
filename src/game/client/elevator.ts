import type { DynamicTexture, Mesh, Scene, StandardMaterial, TransformNode } from '@babylonjs/core';
import type { Content, World } from '@/game/core/types';
import { alphaBoundsOf, stripCorners } from './diorama';
import { B } from './babylon';

/**
 * Ascensor creíble (v1.5) — SEMÁFORO DE PERMISOS con llamadas, puertas y capacidad:
 *   · Quien viaja hace una LLAMADA (planta origen + destino). Si la cabina está ocupada,
 *     espera: el ascensor atiende llamadas en FIFO cuando queda libre.
 *   · La cabina va a la planta llamadora, ABRE las puertas, espera doorWaitMs al embarco
 *     (capacidad limitada: rules.view.elevator.capacity), CIERRA y viaja al destino del
 *     primer pasajero; abre, espera al desembarco, cierra… y pasa a la siguiente llamada
 *     o queda aparcada en la última planta, como un ascensor de vecinos.
 *   · Averiado (elevator_status ≠ 'ok' en el pozo): fuera de servicio — cancela las rutas
 *     pendientes (todos acaban usando la escalera) y sus botones quedan en rojo.
 *
 * TODO sale del catálogo (rules.view.elevator): capacidad, tiempos de puerta, velocidad.
 * La autoridad del viaje (quién sube, a qué planta) es SIEMPRE del sim: aquí solo se
 * representa el viaje que el grafo ya aprobó.
 */

type Phase = 'waiting' | 'boarding' | 'riding' | 'exiting';

export interface RideStatus {
  phase: Phase;
  /** Planta donde está la cabina (o a la que va). */
  floor: number;
  /** Progreso 0..1 del movimiento de cabina (solo 'riding'). */
  progress: number;
  /** Hueco asignado dentro de la cabina (mundo). */
  slotX: number;
  slotZ: number;
}

interface ShaftState {
  s: 'idle' | 'moving' | 'doors';
  at: number;
  /** 'moving': hacia dónde y cuándo acaba; 'doors': apertura/espera/cierre con propósito. */
  target?: number;
  t?: number;
  dur?: number;
  purpose?: 'pickup' | 'dropoff';
  phase?: 'opening' | 'open' | 'closing';
}

interface Shaft {
  col: number;
  x: number;
  floors: number[];
  cabin: TransformNode;
  mats: { cabin: StandardMaterial; door: StandardMaterial; call: StandardMaterial; broken: StandardMaterial; off: StandardMaterial };
  doorPanels: Map<number, { left: Mesh; right: Mesh }>;
  callButtons: Map<number, Mesh>;
  /** v1.28 — pantallita junto a las puertas: planta donde está la cabina (y flecha de marcha). */
  indicator: { tex: DynamicTexture; mat: StandardMaterial; shown: string } | null;
  state: ShaftState;
  queue: { actorId: string; from: number; to: number }[];
  passengers: { actorId: string; to: number; slot: number }[];
}

interface Ride {
  col: number;
  from: number;
  to: number;
  phase: Phase;
  slot: number;
}

export interface ElevatorsDirector {
  /** Registra una llamada (FIFO). La cabina se mueve sola en update(). */
  requestRide(actorId: string, col: number, from: number, to: number): void;
  /** Estado del viaje de un actor (null = sin viaje; también null si se canceló por avería). */
  status(actorId: string): RideStatus | null;
  /** El actor llegó a su hueco dentro de la cabina: puede cerrarse la puerta y viajar. */
  notifyBoarded(actorId: string): void;
  /** Cancela el viaje de un actor (cutscene que lo toma, reaparición, etc.). */
  cancel(actorId: string): void;
  /** Planta actual de la cabina de una columna. */
  cabinFloor(col: number): number;
  /** Estado interno de un pozo (QA/depuración): FSM, cola y pasajeros. */
  debugState(col: number): { state: ShaftState; queue: { actorId: string; from: number; to: number }[]; passengers: { actorId: string; to: number; slot: number }[] } | null;
  update(dt: number): void;
  dispose(): void;
}

const smooth = (k: number) => k * k * (3 - 2 * k);

/**
 * Física del viaje (v1.12): perfil TRAPEZOIDAL acelerar→crucero→frenar, en función de la
 * distancia. La cabina acelera con `accel` (plantas/s²), cruza a `vMax` (floorsPerSecond) y
 * frena al llegar: los viajes cortos ni llegan al crucero (triangulares) y la duración SIEMPRE
 * crece con la distancia — nunca un teletransporte entre plantas. LA MISMA curva la aplican
 * paintCabin (cabina) y status() (pasajeros NPC y jugador): nadie se desincroniza del vehículo.
 */
const rideDurationSec = (floors: number, vMax: number, accel: number): number =>
  floors <= (vMax * vMax) / accel ? 2 * Math.sqrt(floors / accel) : floors / vMax + vMax / accel;
/** Fracción de distancia recorrida (0..1) tras `tMs` de un viaje de `durMs` y `floors` plantas. */
const rideFraction = (floors: number, tMs: number, durMs: number, vMax: number, accel: number): number => {
  const d = Math.max(1e-6, floors);
  const tTotal = durMs / 1000;
  const t = Math.min(Math.max(tMs, 0), durMs) / 1000;
  const tAcc = vMax / accel;
  const dAcc = (vMax * tAcc) / 2;
  if (tTotal <= 2 * tAcc + 1e-9) {
    // Triangular: acelera hasta media distancia y frena. vPico = a · tTotal/2.
    const tPeak = tTotal / 2;
    if (t <= tPeak) return (0.5 * accel * t * t) / d;
    const tr = tTotal - t;
    return (d - 0.5 * accel * tr * tr) / d;
  }
  if (t <= tAcc) return (0.5 * accel * t * t) / d;
  if (t <= tTotal - tAcc) return (dAcc + vMax * (t - tAcc)) / d;
  const tr = tTotal - t;
  return (d - 0.5 * accel * tr * tr) / d;
};

export function createElevators(scene: Scene, world: World, content: Content): ElevatorsDirector {
  const { Color3, MeshBuilder, StandardMaterial, TransformNode } = B();
  const v = content.rules.view;
  const cfg = v.elevator;
  const frontZ = v.roomZ - v.commonDepth / 2;
  const doorZ = frontZ - 0.09; // plano de las hojas (ligeramente delante de la fachada)
  const shafts: Shaft[] = [];
  const rides = new Map<string, Ride>();

  const mat = (name: string, hex: string, opts: { emissive?: number } = {}): StandardMaterial => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = Color3.FromHexString(hex);
    m.specularColor = Color3.FromHexString('#333333');
    if (opts.emissive) m.emissiveColor = Color3.FromHexString(hex).scale(opts.emissive);
    return m;
  };
  const mats = {
    cabin: mat('asc_cabina', cfg.cabinColor),
    door: mat('asc_puerta', cfg.doorColor, { emissive: 0.08 }),
    call: mat('asc_llamada', cfg.callColor, { emissive: 0.6 }),
    broken: mat('asc_roto', cfg.brokenColor, { emissive: 0.5 }),
    off: mat('asc_apagado', '#3a4149'),
  };
  /** v1.25 — PUERTAS DE ASCENSOR con textura correcta: el arte (dos hojas metálicas con la
   *  partida central) se reparte en DOS texturas (mitad izquierda / mitad derecha), una por
   *  hoja. v1.27 — ENCAJE PERFECTO: cada mitad se re-encaja a la proporción EXACTA de su
   *  caja (0.56 × 1.94) con recorte centrado del exceso — el arte llena la hoja sin estirar
   *  (antes el lienzo 192×768 forzaba un 15% de compresión horizontal) y UN solo vuelco. */
  const halfTex = (side: 'l' | 'r'): DynamicTexture | null => {
    if (!cfg.doorArt) return null;
    const TW = Math.round((768 * 0.56) / 1.94);
    const TH = 768;
    const dt = new (B().DynamicTexture)(`asc_puerta_tex_${side}`, { width: TW, height: TH }, scene, true) as DynamicTexture;
    const img = new Image();
    img.onload = () => {
      const big = document.createElement('canvas');
      big.width = img.naturalWidth;
      big.height = img.naturalHeight;
      const bx = big.getContext('2d', { willReadFrequently: true });
      if (!bx) return;
      bx.drawImage(img, 0, 0);
      stripCorners(big, 0.14);
      const b = alphaBoundsOf(big);
      const sx = b ? b.x0 : 0;
      const sy = b ? b.y0 : 0;
      const sw = b ? b.x1 - b.x0 : img.naturalWidth;
      const sh = b ? b.y1 - b.y0 : img.naturalHeight;
      // Mitad del arte + cover-fit a la proporción de la hoja (sin estirar).
      const halfW = sw / 2;
      const x0 = side === 'l' ? sx : sx + halfW;
      const targetAr = TW / TH;
      const srcAr = halfW / Math.max(1, sh);
      let cw = halfW;
      let ch = sh;
      let cx = x0;
      let cy = sy;
      if (srcAr > targetAr) {
        cw = ch * targetAr;
        cx = x0 + (halfW - cw) / 2;
      } else {
        ch = cw / targetAr;
        cy = sy + (sh - ch) / 2;
      }
      const dctx = dt.getContext() as unknown as CanvasRenderingContext2D;
      dctx.clearRect(0, 0, TW, TH);
      dctx.drawImage(big, cx, cy, Math.max(1, cw), Math.max(1, ch), 0, 0, TW, TH);
      dt.update(true);
    };
    img.src = cfg.doorArt;
    return dt;
  };
  const doorTexL = halfTex('l');
  const doorTexR = halfTex('r');
  const doorMatL = mats.door;
  let doorMatR = mats.door;
  if (doorTexL && doorTexR) {
    // Dos MATERIALES (uno por hoja): el mismo material llevaría solo una de las mitades.
    doorMatL.diffuseTexture = doorTexL;
    doorMatR = doorMatL.clone('asc_puerta_der');
    doorMatR.diffuseTexture = doorTexR;
  }
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, m: StandardMaterial): Mesh => {
    const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    mesh.isPickable = false;
    return mesh;
  };

  // Una FSM por COLUMNA de núcleo (el template trae una; esto escala a varias).
  const cols = new Map<number, { floors: number[]; x: number }>();
  for (const b of Object.values(world.blocks)) {
    if (b.layer !== 'main' || b.params.elevator_status === undefined) continue;
    const x = (b.cell.col + b.size.w / 2) * v.cellW;
    const entry = cols.get(b.cell.col) ?? { floors: [], x };
    entry.floors.push(b.cell.floor);
    cols.set(b.cell.col, entry);
  }
  for (const [col, info] of cols) {
    info.floors.sort((a, b) => a - b);
    const root = new TransformNode(`asc_${col}`, scene);
    const cabin = new TransformNode(`asc_cabina_${col}`, scene);
    cabin.parent = root;
    // Cabina: suelo, techo, fondo y laterales — el FRENTE abierto (corte 2.5D: se ve a quien viaja).
    box(`asc_cab_suelo_${col}`, 1.08, 0.06, 1.06, 0, 0.03, 0, mats.cabin).parent = cabin;
    box(`asc_cab_techo_${col}`, 1.08, 0.06, 1.06, 0, 1.92, 0, mats.cabin).parent = cabin;
    box(`asc_cab_fondo_${col}`, 1.08, 1.86, 0.06, 0, 0.96, 0.72, mats.cabin).parent = cabin;
    box(`asc_cab_izq_${col}`, 0.06, 1.86, 1.0, -0.51, 0.96, 0.1, mats.cabin).parent = cabin;
    box(`asc_cab_der_${col}`, 0.06, 1.86, 1.0, 0.51, 0.96, 0.1, mats.cabin).parent = cabin;
    cabin.position.set(info.x, info.floors[0]! * v.cellH, frontZ + 0.4);
    const doorPanels = new Map<number, { left: Mesh; right: Mesh }>();
    const callButtons = new Map<number, Mesh>();
    // v1.28 — PANTALLA DE PLANTA (catálogo): junto a las puertas (lado espejo del botón de
    // llamada) un display con la planta de la cabina y flecha de marcha; UNA textura por
    // pozo (todas las plantas enseñan lo mismo, como un ascensor de vecinos) redibujada
    // SOLO cuando cambia lo mostrado.
    const ind = cfg.indicator;
    let indicator: Shaft['indicator'] = null;
    if (ind) {
      const tex = new (B().DynamicTexture)(`asc_indicador_${col}_tex`, { width: 128, height: 96 }, scene, true) as DynamicTexture;
      const im = new StandardMaterial(`asc_indicador_${col}_mat`, scene);
      im.diffuseTexture = tex;
      im.emissiveTexture = tex;
      im.emissiveColor = new Color3(0.55, 0.55, 0.55);
      im.specularColor = new Color3(0, 0, 0);
      indicator = { tex, mat: im, shown: '' };
    }
    for (const f of info.floors) {
      const y = f * v.cellH;
      const left = box(`asc_puerta_${col}_${f}_i`, 0.56, 1.94, 0.06, info.x - 0.28, y + 0.97, doorZ, doorMatL);
      const right = box(`asc_puerta_${col}_${f}_d`, 0.56, 1.94, 0.06, info.x + 0.28, y + 0.97, doorZ, doorMatR);
      doorPanels.set(f, { left, right });
      const btn = box(`asc_llamada_${col}_${f}`, 0.12, 0.16, 0.05, info.x + 0.76, y + 1.12, frontZ - 0.08, mats.off);
      callButtons.set(f, btn);
      if (indicator && ind) {
        // Cuerpo empotrado en fachada + pantalla UN POCO por delante del botón (nada coplanar).
        box(`asc_indicador_${col}_${f}`, ind.w, ind.h, 0.05, info.x + ind.dx, y + ind.y, frontZ - 0.055, mats.off);
        const scr = box(`asc_pantalla_${col}_${f}`, ind.w * 0.86, ind.h * 0.8, 0.012, info.x + ind.dx, y + ind.y, frontZ - 0.088, indicator.mat);
        scr.isPickable = false;
      }
    }
    shafts.push({
      col,
      x: info.x,
      floors: info.floors,
      cabin,
      mats,
      doorPanels,
      callButtons,
      indicator,
      state: { s: 'idle', at: info.floors[0]! },
      queue: [],
      passengers: [],
    });
  }

  /** Duración de un viaje de `d` plantas en MS (v1.12: el estado acumula dtMs — el dur era
   *  segundos contra t en ms y la fase moving moría en UN frame: el teletransporte clásico). */
  const rideDurMs = (d: number): number => rideDurationSec(Math.abs(d), cfg.floorsPerSecond, cfg.accelFloorsPerSecond2) * 1000;
  /** Fracción 0..1 del viaje en curso de un pozo (0 si no está moviéndose). */
  const rideFracOf = (s: Shaft): number =>
    s.state.s === 'moving' ? rideFraction(Math.abs(s.state.target! - s.state.at), s.state.t ?? 0, s.state.dur ?? 1, cfg.floorsPerSecond, cfg.accelFloorsPerSecond2) : 0;

  const shaftOf = (col: number): Shaft | undefined => shafts.find((s) => s.col === col);
  const elevatorOk = (col: number, floor: number): boolean => {
    const b = Object.values(world.blocks).find((x) => x.cell.col === col && x.cell.floor === floor);
    return !!b && b.params.elevator_status === 'ok';
  };
  const shaftInService = (s: Shaft): boolean => s.floors.every((f) => elevatorOk(s.col, f));
  const doorOpen01 = (s: Shaft): number => {
    if (s.state.s === 'doors') {
      if (s.state.phase === 'opening') return smooth(Math.min(1, (s.state.t ?? 0) / cfg.doorMoveMs));
      if (s.state.phase === 'open') return 1;
      return 1 - smooth(Math.min(1, (s.state.t ?? 0) / cfg.doorMoveMs));
    }
    return 0;
  };

  /** Aplica la apertura de puertas de una planta (0 cerradas, 1 abiertas) y el estado del botón. */
  const paintDoors = (s: Shaft, floor: number, open: number): void => {
    const panels = s.doorPanels.get(floor);
    if (panels) {
      const slide = open * 0.5;
      panels.left.position.x = s.x - 0.28 - slide;
      panels.right.position.x = s.x + 0.28 + slide;
    }
  };
  const paintCalls = (s: Shaft): void => {
    const called = new Set(s.queue.map((q) => q.from));
    if (s.state.s === 'doors' && s.state.purpose === 'pickup') called.add(s.state.at);
    for (const [f, btn] of s.callButtons) {
      const broken = !s.floors.every((fl) => elevatorOk(s.col, fl));
      btn.material = broken ? mats.broken : called.has(f) ? mats.call : mats.off;
    }
    // v1.28 — pantallita: planta de la cabina + flecha de marcha; solo redibuja al cambiar.
    if (s.indicator) {
      const broken = !s.floors.every((fl) => elevatorOk(s.col, fl));
      let label: string;
      if (broken) label = '✕';
      else if (s.state.s === 'moving') label = `${s.state.target!}${s.state.target! > s.state.at ? ' ▲' : ' ▼'}`;
      else label = `${s.state.at}`;
      if (label !== s.indicator.shown) {
        s.indicator.shown = label;
        const ctx = s.indicator.tex.getContext() as unknown as CanvasRenderingContext2D;
        ctx.fillStyle = '#161b20';
        ctx.fillRect(0, 0, 128, 96);
        ctx.fillStyle = broken ? Color3.FromHexString(cfg.brokenColor).toHexString() : Color3.FromHexString(cfg.callColor).toHexString();
        ctx.font = 'bold 58px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 64, 52);
        s.indicator.tex.update(true);
      }
    }
  };

  /** Sitúa la cabina a la altura que dice su estado (v1.12: física trapezoidal del viaje). */
  const paintCabin = (s: Shaft): void => {
    let y = s.state.at * v.cellH;
    if (s.state.s === 'moving') {
      const k = rideFracOf(s);
      y = (s.state.at + (s.state.target! - s.state.at) * k) * v.cellH;
    }
    s.cabin.position.y = y;
  };

  const nextJob = (s: Shaft): void => {
    // Siguiente tarea: desembarcos pendientes de pasajeros a bordo → llamada más antigua.
    if (s.passengers.length > 0) {
      const dest = s.passengers[0]!.to;
      s.state = { s: 'moving', at: s.state.at, target: dest, t: 0, dur: rideDurMs(dest - s.state.at), purpose: 'dropoff' };
      return;
    }
    const call = s.queue.shift();
    if (!call) {
      s.state = { s: 'idle', at: s.state.at };
      return;
    }
    if (call.from === s.state.at) {
      s.state = { s: 'doors', at: call.from, purpose: 'pickup', phase: 'opening', t: 0 };
    } else {
      s.state = { s: 'moving', at: s.state.at, target: call.from, t: 0, dur: rideDurMs(call.from - s.state.at) };
      // La llamada sigue en cola: se re-encabeza para atenderla al llegar.
      s.queue.unshift(call);
    }
  };

  return {
    requestRide(actorId, col, from, to) {
      const s = shaftOf(col);
      if (!s || from === to) return;
      const existing = rides.get(actorId);
      if (existing && existing.col === col && existing.to === to) return;
      rides.set(actorId, { col, from, to, phase: 'waiting', slot: -1 });
      if (!s.queue.some((q) => q.actorId === actorId)) s.queue.push({ actorId, from, to });
      paintCalls(s);
    },
    status(actorId) {
      const ride = rides.get(actorId);
      if (!ride) return null;
      const s = shaftOf(ride.col)!;
      if (s.state.s === 'moving' && ride.phase === 'riding') {
        // v1.12: LA MISMA fracción trapezoidal que pinta la cabina — el pasajero viaja DENTRO
        // del vehículo (antes la fracción era lineal y la cabina suavizada: se desincronizaban).
        const k = rideFracOf(s);
        const floor = s.state.at + (s.state.target! - s.state.at) * k;
        return { phase: 'riding', floor, progress: k, slotX: s.x + (ride.slot % 2 === 0 ? -0.26 : 0.26), slotZ: frontZ + (ride.slot < 2 ? 0.28 : 0.62) };
      }
      const slotX = s.x + (ride.slot >= 0 && ride.slot % 2 === 0 ? -0.26 : 0.26);
      const slotZ = frontZ + (ride.slot >= 0 && ride.slot < 2 ? 0.28 : 0.62);
      return { phase: ride.phase, floor: s.state.at, progress: 0, slotX, slotZ };
    },
    notifyBoarded(actorId) {
      const ride = rides.get(actorId);
      if (ride && ride.phase === 'boarding') ride.phase = 'riding';
    },
    cancel(actorId) {
      const ride = rides.get(actorId);
      if (!ride) return;
      rides.delete(actorId);
      const s = shaftOf(ride.col);
      if (s) {
        s.queue = s.queue.filter((q) => q.actorId !== actorId);
        if (ride.phase === 'boarding' || ride.phase === 'riding') {
          s.passengers = s.passengers.filter((p) => p.actorId !== actorId);
        }
      }
    },
    cabinFloor(col) {
      return shaftOf(col)?.state.at ?? 0;
    },
    debugState(col) {
      const s = shaftOf(col);
      if (!s) return null;
      return { state: { ...s.state }, queue: s.queue.map((q) => ({ ...q })), passengers: s.passengers.map((p) => ({ ...p })) };
    },
    update(dt) {
      const dtMs = dt * 1000;
      for (const s of shafts) {
        // Fuera de servicio: avería en el pozo → cancela viajes y llamadas (la escalera manda).
        if (!shaftInService(s)) {
          if (s.queue.length > 0 || s.passengers.length > 0 || rides.size > 0) {
            for (const [actorId, ride] of rides) if (ride.col === s.col) rides.delete(actorId);
            s.queue = [];
            s.passengers = [];
            s.state = { s: 'idle', at: s.state.at };
          }
          paintCabin(s);
          paintDoors(s, s.state.at, 0);
          paintCalls(s);
          continue;
        }
        const st = s.state;
        if (st.s === 'moving') {
          st.t = (st.t ?? 0) + dtMs;
          if ((st.t ?? 0) >= (st.dur ?? 0)) {
            const arrived = st.target!;
            s.state = { s: 'doors', at: arrived, purpose: st.purpose ?? 'pickup', phase: 'opening', t: 0 };
          }
        } else if (st.s === 'doors') {
          st.t = (st.t ?? 0) + dtMs;
          if (st.phase === 'opening' && (st.t ?? 0) >= cfg.doorMoveMs) {
            st.phase = 'open';
            st.t = 0;
            if (st.purpose === 'pickup') {
              // Embarco (v1.9-fix): los que aguardan en ESTA planta con hueco libre pasan a
              // 'boarding' (su actor camina al hueco; el viaje arranca cuando TODOS están a
              // bordo o al agotarse la espera — nadie se queda dentro con la puerta cerrada fuera).
              // DOS vías de entrada, porque la llamada puede estar en los DOS sitios:
              //  a) aún en la cola (la cabina VINO de otra planta a buscarla);
              //  b) YA consumida por nextJob (la cabina estaba APARCADA en la planta llamadora:
              //     el shift la sacó de la cola al abrir puertas — sin este barrido nadie
              //     embarcaría jamás y el viaje quedaría huérfano en 'waiting' para siempre).
              let slot = s.passengers.length;
              s.queue = s.queue.filter((call) => {
                if (call.from === st.at && slot < cfg.capacity) {
                  const ride = rides.get(call.actorId);
                  if (ride && ride.phase === 'waiting') {
                    ride.phase = 'boarding';
                    ride.slot = slot;
                    s.passengers.push({ actorId: call.actorId, to: call.to, slot });
                    slot += 1;
                    return false;
                  }
                }
                return true;
              });
              for (const [actorId, ride] of rides) {
                if (ride.col === s.col && ride.phase === 'waiting' && ride.from === st.at && slot < cfg.capacity) {
                  ride.phase = 'boarding';
                  ride.slot = slot;
                  s.passengers.push({ actorId, to: ride.to, slot });
                  slot += 1;
                }
              }
            } else {
              // Desembarco: los pasajeros de ESTA planta salen (el actor camina hacia la puerta).
              for (const p of [...s.passengers]) {
                if (p.to === st.at) {
                  const ride = rides.get(p.actorId);
                  if (ride) ride.phase = 'exiting';
                  s.passengers = s.passengers.filter((x) => x.actorId !== p.actorId);
                }
              }
            }
          } else if (st.phase === 'open' && (st.t ?? 0) >= cfg.doorWaitMs) {
            // Fin de la espera: los rezagados viajan igualmente (la cabina no espera eternidades).
            for (const p of s.passengers) {
              const ride = rides.get(p.actorId);
              if (ride && ride.phase === 'boarding') ride.phase = 'riding';
            }
            st.phase = 'closing';
            st.t = 0;
          } else if (st.phase === 'closing' && (st.t ?? 0) >= cfg.doorMoveMs) {
            const at = st.at;
            s.state = { s: 'idle', at };
            nextJob(s);
          }
        } else if (st.s === 'idle') {
          if (s.queue.length > 0 || s.passengers.length > 0) nextJob(s);
        }
        // Puertas abiertas en 'pickup': en cuanto TODOS los pasajeros están a bordo, se cierra
        // (no se espera el timeout completo si el embarco fue rápido — ascensor de verdad).
        if (st.s === 'doors' && st.purpose === 'pickup' && st.phase === 'open' && s.passengers.length > 0) {
          const allIn = s.passengers.every((p) => rides.get(p.actorId)?.phase === 'riding');
          if (allIn && (st.t ?? 0) > cfg.doorMoveMs) {
            st.phase = 'closing';
            st.t = 0;
          }
        }
        paintCabin(s);
        const openFloor = st.s === 'doors' ? st.at : -1;
        for (const f of s.floors) paintDoors(s, f, f === openFloor ? doorOpen01(s) : 0);
        paintCalls(s);
      }
    },
    dispose() {
      for (const s of shafts) {
        s.cabin.dispose(false, true);
        for (const p of s.doorPanels.values()) {
          p.left.dispose();
          p.right.dispose();
        }
        for (const b of s.callButtons.values()) b.dispose();
        if (s.indicator) s.indicator.tex.dispose();
      }
      shafts.length = 0;
      rides.clear();
    },
  };
}
