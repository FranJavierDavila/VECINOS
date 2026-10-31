import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { resolveTokens } from '@/game/support/texts';
import type { ActorsDirector } from './actors';
import type { BubblesDirector } from './bubbles';
import type { TrafficDirector } from './traffic';

/**
 * PASEO VECINAL v2 (v1.41) — «La única forma de entrar y salir del edificio es recorriendo
 * la acera lateral por el perímetro izquierdo del edificio y entrando lateralmente un poco
 * por detrás del bloque de entrada.»
 *
 * RUTA OFICIAL DEL BARRIO (100% del catálogo):
 *  ─ SALIR: pasillo del portal → cruzar el vestíbulo hacia su PARED IZQUIERDA (fade: se
 *    atraviesa la pared lateral como los viandantes) → acera lateral (perímetro oeste) →
 *    esquina → acera frontal: el vecino queda «justo enfrente, a la altura del portal,
 *    en la acera exterior».
 *  ─ ENTRAR: la misma maniobra al revés — acera frontal → esquina → acera lateral →
 *    fade por la pared lateral (un poco por detrás del bloque de entrada) → cruzar el
 *    portal hacia dentro → pasillo.
 *
 * PLANES de la salida (reparto del catálogo): PARQUE (cruzar por el paso mirando ambos
 * lados y calistenia en el jardín de enfrente — v1.37), BANCO (sentarse en un banco
 * exterior), PASEO (estirar las piernas por la acera frontal) y TAXI (pide taxi, se sube
 * — desaparece — y vuelve más tarde EN TAXI con las bolsas de la compra).
 *
 * CORTESÍA COMPARTIDA: mientras alguien pisa la calzada, el paseo publica sus puntos como
 * «crossers» del tráfico — los coches FRENAN en el paso de peatones (y si uno aparece
 * demasiado tarde, frenazo/accidente cómico del catálogo, con el peatón como protagonista).
 *
 * CLIMA: si llueve y están fuera, PARAGUAS ABIERTO con animación (rules.view.outdoor).
 *
 * Teatro de presentación 100%: el sim NO se entera (los vecinos siguen "en casa" para el
 * mundo lógico); el director de actores los TOMA (take → directed) y los SUELTA al volver.
 * Solo visible con calle en cuadro (edificio/fachada/planta).
 */

type Plan = 'parque' | 'banco' | 'paseo' | 'taxi';

type Fase =
  | 'toPortal' // ruta del edificio hasta la línea del pasillo ante el portal
  | 'doorWait' // espera a que las correderas del portal terminen de abrir
  | 'sideOut' // cruza el vestíbulo del portal hacia su PARED IZQUIERDA
  | 'fade' // fundido atravesando la pared lateral (out: hacia la acera lateral)
  | 'sideWalk' // acera lateral (perímetro oeste) hasta la esquina frontal
  | 'branch' // acera frontal hasta el objetivo del plan (paso, banco, paseo, taxi)
  // ── plan PARQUE ──
  | 'lookL' | 'lookR' | 'waitTraffic' | 'cross' | 'toPark' | 'exercise'
  | 'returnCurb' | 'backLookL' | 'backLookR' | 'backWait' | 'backCross'
  // ── plan BANCO ──
  | 'sitT' // sentado en el banco exterior (pose sit del catálogo)
  // ── plan TAXI ──
  | 'hailT' // espera al taxi en el bordillo (dice la línea del catálogo y lo pide)
  | 'crossTaxi' // cruza la calzada hasta la puerta del taxi (crossers → los coches frenan)
  | 'board' // fundido subiendo al taxi; el taxi arranca y se lo lleva
  | 'rideT' // «de compras»: invisible; al terminar pide el taxi de vuelta
  | 'crossTaxiBack' // se baja (con bolsas) y cruza de vuelta a la acera
  // ── salida común ──
  | 'returnFront' // acera frontal de vuelta hacia la esquina de la lateral
  | 'toCorner' | 'sideIn' | 'enterPortal' | 'done';

interface Walker {
  id: string;
  plan: Plan;
  fase: Fase;
  /** Cuenta atrás de la fase actual (esperas, seguridad del cruce, sentencia del banco). */
  t: number;
  /** Segundos de ejercicio restantes. */
  exerciseLeft: number;
  /** Altura (y de nodo) sobre el pasillo de planta 0: todas las cotas de la calle cuelgan de ella. */
  yWalk: number;
  lineIdx: number;
  /** Destino del tramo 'branch'/'returnFront' (x en la acera frontal). */
  targetX: number;
  /** Banco elegido (plan banco). */
  bench: { x: number; z: number } | null;
  /** Fundido en curso (0..1) y sentido. */
  fadeK: number;
  fadeDir: -1 | 1;
  /** ¿El fundido cruza hacia FUERA (acera lateral) o hacia DENTRO (vestíbulo)? */
  fadeGoal: 'out' | 'in';
  taxiStage: 'none' | 'requested' | 'here';
  bags: boolean;
  saidUmbrella: boolean;
}

export interface PaseoDirector {
  update(dt: number): void;
  /** Vecinos de paseo en este momento (QA/E2E). */
  activeCount(): number;
  /** Fuerza una salida YA (QA/E2E: no esperar la cadencia). */
  spawnNow(): boolean;
  /** Fase del paseo de un vecino (QA/E2E). */
  faseOf(id: string): string | null;
  /** Plan del paseo de un vecino (QA/E2E). */
  planOf(id: string): string | null;
  /** v1.41 — los coches avisaron: frenazo heroico ('near') o accidente cómico ('hit'). */
  onTrafficIncident(x: number, kind: 'near' | 'hit'): void;
  dispose(): void;
}

export function createPaseo(
  world: World,
  content: Content,
  actors: ActorsDirector | null,
  bubbles: BubblesDirector | null,
  traffic: TrafficDirector | null,
  isStreetView: () => boolean,
  benches: () => { x: number; z: number }[] = () => [],
): PaseoDirector {
  const cfg = content.rules.view.paseo;
  const portalBlk = Object.values(world.blocks).find((b) => b.defId === 'portal');
  if (!cfg?.enabled || !portalBlk) {
    return {
      update() {}, activeCount: () => 0, spawnNow: () => false, faseOf: () => null, planOf: () => null,
      onTrafficIncident() {}, dispose() {},
    };
  }
  const v = content.rules.view;
  const taxiCfg = v.taxi;
  /** v1.41 — líneas cómicas del teatro exterior (catálogo street.outdoor, data-driven). */
  const outLines = content.street?.outdoor;
  const corridorZ = v.corridorZ;
  const portalX = (portalBlk.cell.col + portalBlk.size.w / 2) * v.cellW;
  // Banda de calzada a partir de los carriles del tráfico (con hombros de 1.5 m): el cruce
  // pisa la acera → bajarse a la calzada → volver a subir. Si no hay catálogo de tráfico,
  // la banda sale de los bordes del catálogo del paseo.
  const laneZs = v.traffic.enabled ? v.traffic.lanes.map((l) => l.z) : [];
  const roadZ0 = laneZs.length > 0 ? Math.min(...laneZs) - 1.5 : cfg.curbNearZ - 1.2;
  const roadZ1 = laneZs.length > 0 ? Math.max(...laneZs) + 1.5 : cfg.curbFarZ + 1.2;
  const roadNearZ = laneZs.length > 0 ? Math.max(...laneZs.filter((z) => z < cfg.curbNearZ + 6)) : cfg.curbNearZ - 2.4;
  // Ancho del taxi (catálogo) para plantar la puerta al lado correcto.
  const taxiDef = v.traffic.vehicles.find((d) => d.kind === 'taxi');
  const taxiDoorZ = taxiCfg ? taxiCfg.stopLaneZ + (taxiDef ? taxiDef.width / 2 : 0.85) + 0.35 : cfg.curbNearZ - 2.2;

  const walkers = new Set<Walker>();
  // ── v1.57 — CALLE COMÚN: quién sale de paseo y cuándo lo decide el TICK del sim
  // (autoridad del servidor): cita absoluta por slot con la cadencia del catálogo y las
  // tiradas (quién, ganas, plan, línea) salen del hash de ese tick — no del reloj local.
  const tickSecs = Math.max(0.5, content.rules.multiplayer?.tickSecondsPerTick ?? 1);
  const slotTicks = Math.max(1, Math.round((cfg.everyMin + cfg.everyMax) / 2 / tickSecs));
  let seenTick = world.tick;
  const due = (t: number): boolean => {
    const s = Math.floor(t / slotTicks);
    return t - s * slotTicks === Math.floor(hash01('paseo_slot', s) * slotTicks);
  };

  const crossX = cfg.crossX;
  const ySide = (w: Walker): number => w.yWalk - 0.02; // acera (0.12 de canto)
  const yRoad = (w: Walker): number => w.yWalk - 0.14; // calzada a ras de suelo
  const yPark = (w: Walker): number => w.yWalk; // el campo de enfrente, casi a la altura del pasillo
  const OUTSIDE: Fase[] = ['sideWalk', 'branch', 'lookL', 'lookR', 'waitTraffic', 'cross', 'toPark', 'exercise', 'returnCurb', 'backLookL', 'backLookR', 'backWait', 'backCross', 'sitT', 'hailT', 'crossTaxi', 'board', 'rideT', 'crossTaxiBack', 'returnFront', 'toCorner', 'sideIn'];

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
    actors?.setUmbrella(w.id, false);
    actors?.setBags(w.id, false);
    actors?.setFade(w.id, 1);
    actors?.release(w.id);
    walkers.delete(w);
  };

  const candidates = (): string[] =>
    Object.values(world.residents)
      .filter((r) => {
        if (!r.present || r.location === null) return false;
        if (r.id === world.playerId) return false;
        // v1.57 — los AVATARES DE JUGADORES (controller human, p. ej. invitados) jamás los
        // secuestra el teatro local: su cuerpo lo pasea su dueño por la red (poses remotas).
        if (r.controller.type === 'human') return false;
        if (!actors || actors.isRiding(r.id) || actors.isDirected(r.id) || actors.gestureOf(r.id)) return false;
        return actors.nodeOf(r.id) !== null;
      })
      .map((r) => r.id);

  /** El plan lo decide el catálogo: banco / paseo / taxi / parque (resto) — con la tirada del tick. */
  const planFor = (t: number): Plan => {
    if (traffic && taxiCfg?.enabled) {
      const r = hash01('paseo_plan', t * 7 + 13);
      if (r < cfg.benchChance) return 'banco';
      if (r < cfg.benchChance + cfg.strollChance) return 'paseo';
      if (r < cfg.benchChance + cfg.strollChance + cfg.taxiChance) return 'taxi';
    } else {
      const r = hash01('paseo_plan2', t * 7 + 13);
      if (r < cfg.benchChance) return 'banco';
      if (r < cfg.benchChance + cfg.strollChance) return 'paseo';
    }
    return 'parque';
  };

  /** Sale un vecino con el guion del tick t (quién, ganas, plan y línea salen de ese tick). */
  const spawn = (t: number): boolean => {
    if (!actors) return false;
    const pool = candidates();
    if (pool.length === 0) return false;
    const who = pool[Math.floor(hash01('paseo_quien', t) * pool.length) % pool.length]!;
    // «algunos si quieren»: la tirada del catálogo decide si este vecino sale hoy.
    if (hash01('paseo_ganas', t) > cfg.chance) return false;
    if (!actors.take(who)) return false;
    const plan = planFor(t);
    walkers.add({
      id: who,
      plan,
      fase: 'toPortal',
      t: 45,
      exerciseLeft: 0,
      yWalk: 0.16, // provisional: la altura REAL se captura al llegar a planta 0
      lineIdx: Math.floor(hash01('paseo_linea', t) * 7) % 7,
      targetX: 0,
      bench: null,
      fadeK: 1,
      fadeDir: -1,
      fadeGoal: 'out',
      taxiStage: 'none',
      bags: false,
      saidUmbrella: false,
    });
    actors.walkTo(who, { x: portalX, z: corridorZ, floor: 0 });
    return true;
  };

  /** Línea del catálogo outdoor por clave (data-driven; si falta la sección, nada). */
  const sayOutdoor = (w: Walker, pool: string[] | undefined, seconds = 4.6): void => {
    if (!bubbles || !pool || pool.length === 0) return;
    const line = pool[(w.lineIdx + Math.floor(hash01('paseo_vuelta', world.tick + w.lineIdx) * pool.length)) % pool.length]!;
    bubbles.sayText(w.id, resolveTokens(line, world, content, { a: w.id }), seconds);
  };

  const lookAt = (w: Walker, dx: number): void => {
    const node = actors?.nodeOf(w.id);
    if (!node) return;
    actors?.faceToward(w.id, node.x + dx, node.z);
    actors?.setHold(w.id, cfg.lookSeconds);
  };

  /** Banco exterior más próximo a la esquina (determinista por paseo): mima la acera frontal. */
  const benchFor = (w: Walker): { x: number; z: number } | null => {
    const spots = benches().filter((b) => Math.abs(b.x - portalX) < 26);
    if (spots.length === 0) return null;
    return spots[Math.floor(hash01('paseo_banco', roll + w.lineIdx) * spots.length) % spots.length]!;
  };

  return {
    update(dt: number) {
      // La calle solo vive en las vistas con calle (igual que tráfico/viandantes): fuera de
      // ellas el paseo queda en PAUSA (los walkers dirigidos se quedan donde están).
      if (!isStreetView()) return;
      // v1.57 — paseos por TICK del sim (calle común): citas absolutas, guard anti-racha.
      if (world.tick < seenTick) seenTick = world.tick; // reinicio local: el tick vuelve a empezar
      let guard = 0;
      while (seenTick < world.tick && guard < 40) {
        seenTick += 1;
        guard += 1;
        if (due(seenTick) && walkers.size < cfg.maxOut) spawn(seenTick);
      }
      // v1.41 — CLIMA: llueve y están fuera → PARAGUAS ABIERTO (una línea cómica la primera vez).
      const rain = world.weather.state === 'rain' || world.weather.state === 'storm';
      // v1.41 — CROSSERS: quien pisa la calzada se publica para que los coches FRENEN.
      const crossers: { x: number; z: number }[] = [];
      for (const w of [...walkers]) {
        const r = world.residents[w.id];
        const node = actors?.nodeOf(w.id);
        if (!r || !r.present || !node || !actors) {
          // El vecino se fue (o el mundo cambió): soltar sin teatro.
          release(w);
          continue;
        }
        if (w.fase === 'cross' || w.fase === 'backCross' || w.fase === 'crossTaxi' || w.fase === 'crossTaxiBack') {
          crossers.push({ x: node.x, z: node.z });
        }
        // Paraguas: fuera de casa (tras la pared lateral) y bajo la lluvia.
        const outside = OUTSIDE.includes(w.fase);
        actors.setUmbrella(w.id, rain && outside);
        if (rain && outside && !w.saidUmbrella) {
          w.saidUmbrella = true;
          sayOutdoor(w, outLines?.umbrellaLines);
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
              sayOutdoor(w, outLines?.exitLines);
              actors.strollPath(w.id, [
                { x: portalX, y: w.yWalk, z: corridorZ - 0.4 },
                { x: portalX, y: w.yWalk, z: -0.4 },
                { x: cfg.portalSideX, y: w.yWalk, z: cfg.sideZ },
              ]);
              w.fase = 'sideOut';
              w.t = 30;
            }
            break;
          }
          case 'sideOut': {
            if (actors.idle(w.id)) {
              w.fadeK = 1;
              w.fadeDir = -1;
              w.fadeGoal = 'out';
              w.fase = 'fade';
              w.t = 20;
            }
            break;
          }
          case 'fade': {
            // Atravesar la PARED IZQUIERDA del portal desvaneciéndose: fuera aparece en la
            // acera lateral; dentro, en el vestíbulo junto a la pared (un poco hacia el fondo).
            w.fadeK = Math.max(0, Math.min(1, w.fadeK + w.fadeDir * dt / 0.4));
            actors.setFade(w.id, w.fadeK);
            if (w.fadeK <= 0.001) {
              if (w.fadeGoal === 'out') {
                actors.stageAt(w.id, cfg.sideX + 0.5, 0, cfg.sideZ);
                actors.faceToward(w.id, cfg.sideX, cfg.cornerZ);
                w.fadeDir = 1;
              } else {
                // Dentro: junto a la pared izquierda del vestíbulo; se recompone andando al pasillo.
                actors.stageAt(w.id, cfg.portalSideX, 0, cfg.sideZ);
                w.fadeK = 1;
                actors.setFade(w.id, 1);
                w.fase = 'enterPortal';
                actors.strollPath(w.id, [
                  { x: portalX, y: w.yWalk, z: -0.4 },
                  { x: portalX, y: w.yWalk, z: corridorZ },
                ]);
                w.t = 30;
              }
            } else if (w.fadeGoal === 'out' && w.fadeDir > 0 && w.fadeK >= 0.999) {
              w.fase = 'sideWalk';
              actors.strollPath(w.id, [
                { x: cfg.sideX, y: ySide(w), z: cfg.sideZ },
                { x: cfg.sideX, y: ySide(w), z: cfg.cornerZ },
              ]);
              w.t = 40;
            }
            break;
          }
          case 'sideWalk': {
            if (actors.idle(w.id)) {
              // Plan: destino en la acera frontal (paso de peatones, banco, paseo o taxi).
              if (w.plan === 'banco') {
                const b = benchFor(w);
                w.bench = b;
                w.targetX = b ? b.x : portalX + 3;
              } else if (w.plan === 'taxi') {
                w.targetX = taxiCfg ? taxiCfg.pickupX : portalX + 2;
              } else if (w.plan === 'paseo') {
                w.targetX = portalX + (hash01('paseo_dir', roll + w.lineIdx) < 0.5 ? -1 : 1) * cfg.strollMeters;
              } else {
                w.targetX = crossX;
              }
              actors.strollPath(w.id, [
                { x: cfg.sideX, y: ySide(w), z: cfg.cornerZ },
                { x: w.targetX, y: ySide(w), z: cfg.frontZ },
              ]);
              w.fase = 'branch';
              w.t = 60;
            }
            break;
          }
          case 'branch': {
            if (actors.idle(w.id)) {
              if (w.plan === 'parque') {
                w.fase = 'lookL';
                w.t = cfg.lookSeconds;
                lookAt(w, -7);
              } else if (w.plan === 'banco') {
                const b = w.bench;
                if (b) {
                  actors.faceToward(w.id, b.x, b.z + 1); // mirando al edificio (el respaldo da a la calle)
                  actors.seatWhenIdle(w.id, { x: b.x, z: b.z, yaw: -Math.PI / 2 });
                  sayOutdoor(w, outLines?.benchLines);
                  w.fase = 'sitT';
                  w.t = cfg.sitSecondsMin + hash01('paseo_sit', roll + w.lineIdx) * Math.max(0.1, cfg.sitSecondsMax - cfg.sitSecondsMin);
                } else {
                  w.fase = 'returnFront';
                  w.t = 60;
                }
              } else if (w.plan === 'taxi') {
                sayOutdoor(w, outLines?.taxiHail);
                w.fase = 'hailT';
                w.t = taxiCfg ? taxiCfg.waitMin + hash01('paseo_taxi1', world.tick + w.lineIdx) * Math.max(0.1, taxiCfg.waitMax - taxiCfg.waitMin) : 8;
              } else {
                // paseo: media vuelta por la acera y de vuelta
                sayOutdoor(w, outLines?.strollLines);
                w.fase = 'returnFront';
                w.t = 60;
              }
            }
            break;
          }
          // ── plan PARQUE (v1.37, intacto) ──
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
              sayOutdoor(w, cfg.lines); // «Un rato de barras y vuelvo…» (catálogo)
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
              // v1.41 — la vuelta con bolsas de la compra (a veces, catálogo del teatro).
              w.bags = hash01('paseo_compra', roll + w.lineIdx) < 0.35;
              if (w.bags) {
                actors.setBags(w.id, true);
                sayOutdoor(w, outLines?.bagsLines);
              }
              w.fase = 'returnFront';
              w.t = 60;
            }
            break;
          }
          // ── plan BANCO ──
          case 'sitT': {
            if (w.t <= 0) {
              actors.standUp(w.id);
              actors.strollPath(w.id, [{ x: cfg.sideX, y: ySide(w), z: cfg.cornerZ }]);
              w.fase = 'returnFront';
              w.t = 60;
            }
            break;
          }
          // ── plan TAXI ──
          case 'hailT': {
            if (w.taxiStage === 'none' && w.t <= 0 && traffic && taxiCfg) {
              if (traffic.taxiAvailable()) {
                w.taxiStage = 'requested';
                traffic.hailTaxi(taxiCfg.stopX, () => {
                  if (walkers.has(w)) w.taxiStage = 'here';
                });
              } else {
                w.t = 2; // hay un taxi dando vueltas: reintentar enseguida
              }
            }
            if (w.taxiStage === 'here') {
              const yB = yRoad(w);
              actors.strollPath(w.id, [
                { x: node.x, y: ySide(w), z: cfg.curbNearZ },
                { x: (taxiCfg?.stopX ?? portalX) + 0.7, y: yB, z: cfg.curbNearZ - 1.2 },
                { x: (taxiCfg?.stopX ?? portalX) + 0.7, y: yB, z: taxiDoorZ },
              ]);
              w.fase = 'crossTaxi';
              w.t = 30;
            }
            break;
          }
          case 'crossTaxi': {
            if (actors.idle(w.id)) {
              sayOutdoor(w, outLines?.taxiBoard);
              w.fadeK = 1;
              w.fadeDir = -1;
              w.fase = 'board';
              w.t = 20;
            }
            break;
          }
          case 'board': {
            w.fadeK = Math.max(0, w.fadeK - dt / 0.5);
            actors.setFade(w.id, w.fadeK);
            if (w.fadeK <= 0) {
              traffic?.releaseTaxi(); // el taxi arranca con el vecino dentro
              w.taxiStage = 'none';
              w.fase = 'rideT';
              w.t = taxiCfg ? taxiCfg.rideMin + hash01('paseo_taxi2', world.tick + w.lineIdx) * Math.max(0.1, taxiCfg.rideMax - taxiCfg.rideMin) : 30;
            }
            break;
          }
          case 'rideT': {
            // «de compras»: invisible para el mundo (el actor sigue tomado). Al volver, taxi nuevo.
            if (w.t <= 0 && traffic && taxiCfg) {
              if (traffic.taxiAvailable()) {
                w.taxiStage = 'requested';
                traffic.hailTaxi(taxiCfg.stopX, () => {
                  if (walkers.has(w)) w.taxiStage = 'here';
                });
                if (w.taxiStage === 'requested') w.t = 90;
              } else {
                w.t = 2;
              }
            }
            if (w.taxiStage === 'here') {
              // Aparece EN la puerta del taxi, con las BOLSAS DE LA COMPRA.
              const yB = yRoad(w);
              actors.stageAt(w.id, (taxiCfg?.stopX ?? portalX) + 0.7, 0, taxiDoorZ);
              w.bags = true;
              actors.setBags(w.id, true);
              actors.setUmbrella(w.id, rain);
              w.saidUmbrella = false;
              actors.setFade(w.id, 1);
              sayOutdoor(w, outLines?.taxiBack);
              actors.strollPath(w.id, [
                { x: (taxiCfg?.stopX ?? portalX) + 0.7, y: yB, z: cfg.curbNearZ - 1.2 },
                { x: taxiCfg?.pickupX ?? portalX, y: ySide(w), z: cfg.curbNearZ },
              ]);
              w.fase = 'crossTaxiBack';
              w.t = 30;
            }
            break;
          }
          case 'crossTaxiBack': {
            if (actors.idle(w.id)) {
              traffic?.releaseTaxi(); // el taxi se marcha
              w.taxiStage = 'none';
              if (!w.bags && hash01('paseo_compra_b', roll + w.lineIdx) < 0.4) {
                w.bags = true;
                actors.setBags(w.id, true);
                sayOutdoor(w, outLines?.bagsLines);
              }
              w.fase = 'returnFront';
              w.t = 60;
            }
            break;
          }
          // ── vuelta común: acera frontal → esquina → lateral → portal ──
          case 'returnFront': {
            if (actors.idle(w.id)) {
              w.fase = 'toCorner';
              w.t = 60;
            }
            break;
          }
          case 'toCorner': {
            if (actors.idle(w.id)) {
              sayOutdoor(w, outLines?.enterLines);
              actors.strollPath(w.id, [
                { x: cfg.sideX, y: ySide(w), z: cfg.cornerZ },
                { x: cfg.sideX, y: ySide(w), z: cfg.sideZ },
              ]);
              w.fase = 'sideIn';
              w.t = 40;
            }
            break;
          }
          case 'sideIn': {
            if (actors.idle(w.id)) {
              w.fadeK = 1;
              w.fadeDir = -1;
              w.fadeGoal = 'in';
              w.fase = 'fade';
              w.t = 20;
            }
            break;
          }
          case 'enterPortal': {
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
      traffic?.setCrossers(crossers);
    },
    activeCount: () => walkers.size,
    spawnNow: () => (walkers.size < cfg.maxOut ? spawn(world.tick) : false),
    faseOf: (id: string) => [...walkers].find((w) => w.id === id)?.fase ?? null,
    planOf: (id: string) => [...walkers].find((w) => w.id === id)?.plan ?? null,
    /** v1.41 — LOS COCHES AVISAN: frenazo heroico o accidente cómico con el peatón como
     *  protagonista (líneas y gestos del catálogo street.outdoor). */
    onTrafficIncident(x: number, kind: 'near' | 'hit'): void {
      for (const w of walkers) {
        if (w.fase !== 'cross' && w.fase !== 'backCross' && w.fase !== 'crossTaxi' && w.fase !== 'crossTaxiBack') continue;
        const node = actors?.nodeOf(w.id);
        if (!node || Math.abs(node.x - x) > 3.2) continue;
        if (kind === 'near') {
          actors?.setHold(w.id, 1.4);
          actors?.setGesture(w.id, 'argue', 2.2);
          actors?.faceToward(w.id, node.x + (node.x < x ? -3 : 3), node.z);
          sayOutdoor(w, outLines?.nearMiss, 3.6);
        } else {
          // Accidente cómico: el vecino acaba sentado/tumbado en la calzada (pose sleep del
          // rig), suelta la queja del catálogo y sigue cruzando cuando se recupera.
          actors?.setHold(w.id, 3.2);
          actors?.setGesture(w.id, 'sleep', 2.4);
          sayOutdoor(w, outLines?.accident, 4.2);
          if (w.bags) {
            w.bags = false;
            actors?.setBags(w.id, false);
          }
        }
        return; // un solo protagonista por incidente
      }
    },
    dispose() {
      for (const w of [...walkers]) release(w);
    },
  };
}
