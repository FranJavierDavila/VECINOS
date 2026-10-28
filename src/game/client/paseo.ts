import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { resolveTokens } from '@/game/support/texts';
import type { ActorsDirector } from './actors';
import type { BubblesDirector } from './bubbles';
import type { TrafficDirector } from './traffic';

/**
 * PASEO VECINAL (v1.37) — «Los vecinos pueden salir a la calle y algunos si quieren pueden
 * cruzar la calle por el paso de peatones, mirando a ambos lados para que no pasen coches e
 * ir al jardín de enfrente donde habrá un parque de calistenia para practicar algo de
 * deporte.»
 *
 * Teatro de presentación 100%: el sim NO se entera (los vecinos siguen "en casa" para el
 * mundo lógico); el director de actores los TOMA (take → directed), les marca tramos crudos
 * por la calle (strollPath: acera → paso de peatones → jardín de enfrente) y los SUELTA al
 * volver (release → la IA de siempre los lleva a su sitio). En el paso de peatones SE PARAN,
 * miran a ambos lados y esperan a que el tráfico despeje el cruce (traffic.crossingClear).
 * En el parque de calistenia practican deporte (gesto del catálogo + sentadillas).
 *
 * Todo del catálogo (rules.view.paseo); solo visible con calle en cuadro (edificio/planta).
 */

type Fase =
  | 'toPortal' // ruta del edificio hasta la línea del pasillo ante el portal
  | 'doorWait' // espera a que las correderas del portal terminen de abrir
  | 'toCurb' // sale del portal y camina la acera hasta el paso de peatones
  | 'lookL' // mira a la IZQUIERDA (¿viene algún coche?)
  | 'lookR' // mira a la DERECHA
  | 'waitTraffic' // espera a que el cruce despeje (o vence el plazo de seguridad)
  | 'cross' // cruza por el paso de cebra
  | 'toPark' // entra en el jardín de enfrente hasta el parque de calistenia
  | 'exercise' // práctica deporte (gesto del catálogo + sentadillas del catálogo)
  | 'returnCurb' // vuelve del parque al paso (lado del jardín)
  | 'backLookL' // vuelve a mirar a la izquierda (para volver a cruzar)
  | 'backLookR'
  | 'backWait'
  | 'backCross' // recruza hacia la acera del portal
  | 'toDoor' // camina la acera de vuelta hasta la puerta del portal
  | 'doorWaitBack' // espera correderas antes de entrar
  | 'goIn' // cruza las correderas hasta la línea del pasillo
  | 'done'; // release: la IA normal lo lleva a su ubicación del sim

interface Walker {
  id: string;
  fase: Fase;
  /** Cuenta atrás de la fase actual (esperas, seguridad del cruce). */
  t: number;
  /** Segundos de ejercicio restantes. */
  exerciseLeft: number;
  /** Altura (y de nodo) sobre el pasillo de planta 0: todas las cotas de la calle cuelgan de ella. */
  yWalk: number;
  lineIdx: number;
}

export interface PaseoDirector {
  update(dt: number): void;
  /** Vecinos de paseo en este momento (QA/E2E). */
  activeCount(): number;
  /** Fuerza una salida YA (QA/E2E: no esperar la cadencia). */
  spawnNow(): boolean;
  /** Fase del paseo de un vecino (QA/E2E). */
  faseOf(id: string): string | null;
  dispose(): void;
}

export function createPaseo(
  world: World,
  content: Content,
  actors: ActorsDirector | null,
  bubbles: BubblesDirector | null,
  traffic: TrafficDirector | null,
  isStreetView: () => boolean,
): PaseoDirector {
  const cfg = content.rules.view.paseo;
  const portalBlk = Object.values(world.blocks).find((b) => b.defId === 'portal');
  if (!cfg?.enabled || !portalBlk) {
    return { update() {}, activeCount: () => 0, spawnNow: () => false, faseOf: () => null, dispose() {} };
  }
  const v = content.rules.view;
  const corridorZ = v.corridorZ;
  const portalX = (portalBlk.cell.col + portalBlk.size.w / 2) * v.cellW;
  // Banda de calzada a partir de los carriles del tráfico (con hombros de 1.5 m): el cruce
  // pisa la acera → bajarse a la calzada → volver a subir. Si no hay catálogo de tráfico,
  // la banda sale de los bordes del catálogo del paseo.
  const laneZs = v.traffic.enabled ? v.traffic.lanes.map((l) => l.z) : [];
  const roadZ0 = laneZs.length > 0 ? Math.min(...laneZs) - 1.5 : cfg.curbNearZ - 1.2;
  const roadZ1 = laneZs.length > 0 ? Math.max(...laneZs) + 1.5 : cfg.curbFarZ + 1.2;

  const walkers = new Set<Walker>();
  let nextIn = cfg.everyMin + hash01('paseo_primero', world.tick) * Math.max(0.1, cfg.everyMax - cfg.everyMin);
  let roll = 0;

  const crossX = cfg.crossX;
  const ySide = (w: Walker): number => w.yWalk - 0.02; // acera (0.12 de canto)
  const yRoad = (w: Walker): number => w.yWalk - 0.14; // calzada a ras de suelo
  const yPark = (w: Walker): number => w.yWalk; // el campo de enfrente, casi a la altura del pasillo

  /** Tramos del cruce (paso de cebra) en un sentido: acera → hombro → calzada → hombro →
   *  acera contraria. Los puntos van SIEMPRE en orden monótono de z (¡el zigzag antiguo
   *  hacía ir y volver al vecino encima del paso!). roadZ1 = borde cercano al edificio,
   *  roadZ0 = borde lejano; las aceras van a altura de acera y la calzada a ras de suelo. */
  const crossLegs = (w: Walker, from: 'near' | 'far'): { x: number; y: number; z: number }[] => {
    const yA = ySide(w);
    const yB = yRoad(w);
    const stops = [cfg.curbNearZ, roadZ1 + 0.7, roadZ1 - 0.3, roadZ0 + 0.3, roadZ0 - 0.7, cfg.curbFarZ];
    const seq = from === 'near' ? stops : [...stops].reverse();
    return seq.map((z) => ({ x: crossX, y: z > roadZ1 || z < roadZ0 ? yA : yB, z }));
  };

  const release = (w: Walker): void => {
    actors?.release(w.id);
    walkers.delete(w);
  };

  const candidates = (): string[] =>
    Object.values(world.residents)
      .filter((r) => {
        if (!r.present || r.location === null) return false;
        if (r.id === world.playerId) return false;
        if (!actors || actors.isRiding(r.id) || actors.isDirected(r.id) || actors.gestureOf(r.id)) return false;
        return actors.nodeOf(r.id) !== null;
      })
      .map((r) => r.id);

  const spawn = (): boolean => {
    if (!actors) return false;
    const pool = candidates();
    if (pool.length === 0) return false;
    const who = pool[Math.floor(hash01('paseo_quien', roll) * pool.length) % pool.length]!;
    roll++;
    // «algunos si quieren»: la tirada del catálogo decide si este vecino sale hoy.
    if (hash01('paseo_ganas', roll) > cfg.chance) return false;
    if (!actors.take(who)) return false;
    walkers.add({
      id: who,
      fase: 'toPortal',
      t: 45,
      exerciseLeft: 0,
      yWalk: 0.16, // provisional: la altura REAL se captura al llegar a planta 0
      lineIdx: Math.floor(hash01('paseo_linea', roll) * cfg.lines.length) % cfg.lines.length,
    });
    actors.walkTo(who, { x: portalX, z: corridorZ, floor: 0 });
    return true;
  };

  /** Líneas del catálogo (data-driven) al llegar al parque o al arrancar el paseo. */
  const sayLine = (w: Walker): void => {
    if (!bubbles) return;
    const line = cfg.lines[w.lineIdx % cfg.lines.length]!;
    bubbles.sayText(w.id, resolveTokens(line, world, content, { a: w.id }), 4.6);
  };

  const lookAt = (w: Walker, dx: number): void => {
    const node = actors?.nodeOf(w.id);
    if (!node) return;
    actors?.faceToward(w.id, node.x + dx, node.z);
    actors?.setHold(w.id, cfg.lookSeconds);
  };

  return {
    update(dt: number) {
      // La calle solo vive en las vistas con calle (igual que tráfico/viandantes): fuera de
      // ellas el paseo queda en PAUSA (los walkers dirigidos se quedan donde están).
      if (!isStreetView()) return;
      nextIn -= dt;
      if (nextIn <= 0) {
        nextIn = cfg.everyMin + hash01('paseo_t', world.tick + roll) * (cfg.everyMax - cfg.everyMin);
        if (walkers.size < cfg.maxOut) spawn();
      }
      for (const w of [...walkers]) {
        const r = world.residents[w.id];
        const node = actors?.nodeOf(w.id);
        if (!r || !r.present || !node || !actors) {
          // El vecino se fue (o el mundo cambió): soltar sin teatro.
          release(w);
          continue;
        }
        w.t -= dt;
        switch (w.fase) {
          case 'toPortal': {
            if (actors.idle(w.id)) {
              w.yWalk = node.y; // altura real sobre el pasillo de planta 0
              w.fase = 'doorWait';
              w.t = cfg.doorWait;
            }
            break;
          }
          case 'doorWait': {
            if (w.t <= 0) {
              actors.strollPath(w.id, [
                { x: portalX, y: w.yWalk, z: corridorZ - 0.4 },
                { x: portalX, y: ySide(w), z: cfg.curbNearZ },
                { x: crossX, y: ySide(w), z: cfg.curbNearZ },
              ]);
              w.fase = 'toCurb';
              w.t = 45;
            }
            break;
          }
          case 'toCurb': {
            if (actors.idle(w.id)) {
              w.fase = 'lookL';
              w.t = cfg.lookSeconds;
              lookAt(w, -7);
            }
            break;
          }
          case 'lookL': {
            if (w.t <= 0) {
              w.fase = 'lookR';
              w.t = cfg.lookSeconds;
              lookAt(w, 7);
            }
            break;
          }
          case 'lookR': {
            if (w.t <= 0) {
              w.fase = 'waitTraffic';
              w.t = 45; // plazo de seguridad: nadie cruza contra el tráfico eterno
            }
            break;
          }
          case 'waitTraffic': {
            // «mirando a ambos lados para que no pasen coches»: solo cruza con la vía despejada.
            const clear = traffic?.crossingClear(crossX, roadZ0 - 1.2, roadZ1 + 1.2, cfg.crossMargin) ?? true;
            if (clear || w.t <= 0) {
              actors.strollPath(w.id, crossLegs(w, 'near'));
              w.fase = 'cross';
              w.t = 45;
            } else if (hash01('paseo_reloj', world.tick + Math.floor(w.t)) < 0.02) {
              lookAt(w, hash01('paseo_lado', world.tick) < 0.5 ? -7 : 7); // sigue mirando mientras espera
            }
            break;
          }
          case 'cross': {
            if (actors.idle(w.id)) {
              actors.strollPath(w.id, [
                { x: crossX, y: ySide(w), z: cfg.curbFarZ - 0.7 },
                { x: cfg.parkX, y: yPark(w), z: cfg.parkZ },
              ]);
              w.fase = 'toPark';
              w.t = 45;
            }
            break;
          }
          case 'toPark': {
            if (actors.idle(w.id)) {
              sayLine(w); // «Un rato de barras y vuelvo…» (catálogo)
              w.exerciseLeft = cfg.exerciseMin + hash01('paseo_suda', roll + w.lineIdx) * Math.max(0.1, cfg.exerciseMax - cfg.exerciseMin);
              actors.setGesture(w.id, cfg.gesture, w.exerciseLeft + 0.6);
              w.fase = 'exercise';
              w.t = w.exerciseLeft;
            }
            break;
          }
          case 'exercise': {
            if (w.t <= 0) {
              actors.setGesture(w.id, null);
              actors.strollPath(w.id, [{ x: crossX, y: yPark(w), z: cfg.curbFarZ }]);
              w.fase = 'returnCurb';
              w.t = 45;
            }
            break;
          }
          case 'returnCurb': {
            if (actors.idle(w.id)) {
              w.fase = 'backLookL';
              w.t = cfg.lookSeconds;
              lookAt(w, -7);
            }
            break;
          }
          case 'backLookL': {
            if (w.t <= 0) {
              w.fase = 'backLookR';
              w.t = cfg.lookSeconds;
              lookAt(w, 7);
            }
            break;
          }
          case 'backLookR': {
            if (w.t <= 0) {
              w.fase = 'backWait';
              w.t = 45;
            }
            break;
          }
          case 'backWait': {
            const clear = traffic?.crossingClear(crossX, roadZ0 - 1.2, roadZ1 + 1.2, cfg.crossMargin) ?? true;
            if (clear || w.t <= 0) {
              actors.strollPath(w.id, crossLegs(w, 'far'));
              w.fase = 'backCross';
              w.t = 45;
            }
            break;
          }
          case 'backCross': {
            if (actors.idle(w.id)) {
              actors.strollPath(w.id, [{ x: portalX, y: ySide(w), z: cfg.curbNearZ }]);
              w.fase = 'toDoor';
              w.t = 45;
            }
            break;
          }
          case 'toDoor': {
            if (actors.idle(w.id)) {
              w.fase = 'doorWaitBack';
              w.t = cfg.doorWait; // las correderas ya se están abriendo (el vecino es un mover)
            }
            break;
          }
          case 'doorWaitBack': {
            if (w.t <= 0) {
              actors.strollPath(w.id, [{ x: portalX, y: w.yWalk, z: corridorZ }]);
              w.fase = 'goIn';
              w.t = 30;
            }
            break;
          }
          case 'goIn': {
            if (actors.idle(w.id)) {
              w.fase = 'done';
              w.t = 0.2;
            }
            break;
          }
          case 'done': {
            if (w.t <= 0) release(w); // la IA normal lo lleva a su ubicación del sim
            break;
          }
        }
      }
    },
    activeCount: () => walkers.size,
    spawnNow: () => (walkers.size < cfg.maxOut ? spawn() : false),
    faseOf: (id: string) => [...walkers].find((w) => w.id === id)?.fase ?? null,
    dispose() {
      for (const w of [...walkers]) release(w);
    },
  };
}
