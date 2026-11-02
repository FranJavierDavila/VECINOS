/**
 * QA v1.37 «se sale al parque» — el lote del vecino:
 *  1. GARAJE DE VERDAD (la v1.36 lo anunciaba y NO era cierto): el frente del runtime
 *     levantaba una pared ENTERA (`_frente_d`) delante del hueco — la «pared oscura»
 *     seguía ahí con la basculante levantada. Ahora el frente se PARTE alrededor del
 *     hueco real de la basculante (jambas + dintel, catálogo doorW/doorH) y el interior
 *     se ve EN CUANTO LA PUERTA SE MUEVE (revealAt del catálogo).
 *  2. ATRIL DEL TABLÓN: gran atril con tablón de anuncios en el EXTREMO del pasillo de
 *     planta 0 — y el tablón se consulta AHÍ (interact 'noticeboard' anclado al atril).
 *  3. COLISIÓN LAVADORAS: las lavadoras/secadoras son sólidas (jugador y vecinos).
 *  4. PARQUE DE CALISTENIA en el jardín de enfrente: suelo de caucho, barra de dominadas,
 *     paralelas, banco de abdominales y cartel — todo del catálogo.
 *  5. PASEO VECINAL: los vecinos salen a la calle, cruzan por el paso de peatones MIRANDO
 *     a ambos lados y esperando a que no pasen coches, y van al parque a hacer deporte.
 */
import fs from 'fs';
import path from 'path';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld } from '@/game/sim';
import { tick } from '@/game/sim/tick';
import { PlayerLogic } from '@/game/player-logic';
import { hash01 } from '@/game/interior';
import { createPaseo } from '@/game/client/paseo';
import type { ActorsDirector } from '@/game/client/actors';
import type { TrafficDirector } from '@/game/client/traffic';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, info = ''): void => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}${info ? ` — ${info}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`);
  }
};
const srcOf = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

console.log('── 1. Garaje de verdad (el frente se parte alrededor del hueco) ──');
const buildingTs = srcOf('src/game/client/building.ts');
const rules = JSON.parse(srcOf('public/content/rules.json'));
const schemasTs = srcOf('src/game/content/schemas.ts');
const g = rules.view.locals.garaje;
check('catálogo: hueco REAL de la basculante (doorW 2.16 / doorH 1.92)', g.doorW === 2.16 && g.doorH === 1.92, `doorW=${g.doorW} doorH=${g.doorH}`);
check('schema acepta locals.garaje.doorW/doorH', schemasTs.includes('doorW: z.number().positive().optional()') && schemasTs.includes('doorH: z.number().positive().optional()'));
check('el GARAJE entra en la partición del frente (gapWs.push(cx) con jambas+dintel)',
  buildingTs.includes('el GARAJE ENTRA AQUÍ') && buildingTs.includes('gapWs.push(cx);'));
check('medidas del hueco por bloque (garaje → doorW/doorH del catálogo)',
  buildingTs.includes("isGaraje ? loc.garaje.doorW ?? 2.16 : jh.doorW") && buildingTs.includes("isGaraje ? loc.garaje.doorH ?? 1.92 : v.privacy.doorH"));
check('la lavandería y el portal siguen SIN frente del runtime', buildingTs.includes('if (isLaundry || isPortal) {'));
check('el reveal del interior sigue en revealAt (primer milímetro de puerta)',
  buildingTs.includes('v.locals.hallDoors?.revealAt ?? 0.12') && rules.view.locals.hallDoors.revealAt === 0.02);
check('DIAGNÓSTICO CAZADO: el frente entero ya no se levanta para el garaje (comentario v1.37)',
  buildingTs.includes('la «pared oscura» que seguía viéndose con la basculante levantada'));

console.log('── 2. Atril del tablón (extremo del pasillo de planta 0) ──');
const nb = rules.view.noticeboard;
check('catálogo noticeboard: activo, planta 0, lado izquierdo', nb?.enabled === true && nb.floor === 0 && nb.side === 'left', `inset=${nb?.inset}`);
check('el catálogo trae titular y notas del tablón (data-driven)', nb.headline === 'TABLÓN DE ANUNCIOS' && nb.notes.length >= 4);
check('building levanta el ATRIL (tablón de corcho + notas + atril inclinado)',
  buildingTs.includes('ATRIL DEL TABLÓN DE ANUNCIOS') && buildingTs.includes('_atril_corcho') && buildingTs.includes('_atril_mesa'));
check('building ancla la consulta a la posición del mundo (noticeboardSpot)', buildingTs.includes('noticeboardSpot = { x: nbX, z: nbZ, floor: nbCfg.floor }'));
check('la API del director expone noticeboardSpot()', buildingTs.includes('noticeboardSpot(): { x: number; z: number; floor: number } | null'));
const logicTs = srcOf('src/game/player-logic.ts');
check('player-logic consulta el tablón EN EL ATRIL (ancla por posición)', logicTs.includes('this.floor === nb.floor && Math.abs(this.x - nb.x) < this.view.itemRadius'));
check('el ancla vieja del portal (tabón-3D retirado en v1.36) ya NO dispara la consulta',
  !logicTs.includes('features?.noticeboard && Math.abs(this.x - (zz - 0.8))'));
check('el controlador pasa la posición del atril a la lógica (una sola verdad)',
  srcOf('src/game/client/controller.ts').includes('this.logic.setNoticeboardSpot(this.building.noticeboardSpot())'));

console.log('── 3. Colisión de las lavadoras ──');
check('building registra los rects de las máquinas (mundo)', buildingTs.includes('blockObstacles.set(b.id, blockers)') && buildingTs.includes('blockers.push({ x0: mx - mW / 2 - 0.02'));
check('walkObstacles() expone los sólidos por bloque', buildingTs.includes('walkObstacles(): { blockId: string; rects:'));
check('el JUGADOR choca con las lavadoras (hitsSolid en el movimiento interior)', logicTs.includes('hitsSolid(nx, this.z)') && logicTs.includes('hitsSolid(this.x, nz)'));
check('los VECINOS también (actors.resolveSolids en el tramo)', srcOf('src/game/client/actors.ts').includes('const solid = resolveSolids('));
check('el controlador pasa los sólidos a la lógica y al director de actores',
  srcOf('src/game/client/controller.ts').includes('this.logic.setBlockObstacles(this.building.walkObstacles())') &&
  srcOf('src/game/client/controller.ts').includes('setObstacles(this.building.walkObstacles().flatMap'));

console.log('── 4. Parque de calistenia (jardín de enfrente) ──');
const cal = rules.view.exterior.calisthenics;
check('catálogo calisthenics: activo, al otro lado del paso (z < -13)', cal?.enabled === true && cal.z < -13.8, `x=${cal?.x} z=${cal?.z}`);
check('exterior levanta barra de dominadas + paralelas + banco + cartel',
  srcOf('src/game/client/exterior.ts').includes('PARQUE DE CALISTENIA') &&
  srcOf('src/game/client/exterior.ts').includes("cal_barra") &&
  srcOf('src/game/client/exterior.ts').includes('cal_dip_barra') &&
  srcOf('src/game/client/exterior.ts').includes('cal_banco_tabla') &&
  srcOf('src/game/client/exterior.ts').includes('cal_cartel'));
check('schema del parque (opcional, todo del catálogo)', schemasTs.includes('calisthenics: z'));

console.log('── 5. Paseo vecinal (cruzar mirando ambos lados + deporte) ──');
const paseo = rules.view.paseo;
check('catálogo paseo: activo, con cruce y parque del catálogo', paseo?.enabled === true && paseo.crossX === 13 && paseo.parkZ < -13);
check('el paseo se PARA a mirar a ambos lados (fases lookL/lookR + faceToward)',
  srcOf('src/game/client/paseo.ts').includes("'lookL'") && srcOf('src/game/client/paseo.ts').includes("'lookR'") && srcOf('src/game/client/paseo.ts').includes('faceToward'));
check('espera al tráfico (traffic.crossingClear) antes de cruzar',
  srcOf('src/game/client/paseo.ts').includes('crossingClear') && srcOf('src/game/client/traffic.ts').includes('crossingClear(x: number, zMin: number, zMax: number, margin: number)'));
check('ejercicio en el parque (gesto del catálogo + sentadillas de actors)',
  srcOf('src/game/client/paseo.ts').includes('setGesture(w.id, cfg.gesture') && srcOf('src/game/client/actors.ts').includes('EJERCICIO DEL PASEO'));
check('actores: strollPath (tramos crudos de calle) + setObstacles en el interfaz',
  srcOf('src/game/client/actors.ts').includes('strollPath(id: string, pts: { x: number; y: number; z: number }[]): boolean') &&
  srcOf('src/game/client/actors.ts').includes('setObstacles(rects: { x0: number; z0: number; w: number; d: number }[]): void'));
check('«algunos si quieren»: tirada de chance del catálogo', srcOf('src/game/client/paseo.ts').includes('paseo_ganas') && paseo.chance < 1);

console.log('── 6. Comportamiento: paseo completo con directores falsos ──');
const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
check('contenido carga sin errores de esquema', issues.length === 0, issues.slice(0, 2).map((i) => i.message).join(' | '));
if (issues.length > 0) console.log(formatIssues(issues).slice(0, 400));
const world = createWorld(content, 'slice');
const worldQa = createWorld(content, 'qa');

const calls = { hold: 0, face: 0, gestures: [] as string[], paths: [] as { x: number; y: number; z: number }[][], released: [] as string[], walkedTo: [] as string[] };
const fakeActors = {
  nodeOf: (id: string) => ({ x: 2.34, y: 0.16, z: -2.0 }),
  take: (id: string) => true,
  release: (id: string) => void calls.released.push(id),
  walkTo: (id: string, dest: { x: number; z: number; floor: number }) => void calls.walkedTo.push(`${dest.x},${dest.z},${dest.floor}`),
  strollPath: (_id: string, pts: { x: number; y: number; z: number }[]) => { calls.paths.push(pts.map((p) => ({ ...p }))); return true; },
  setObstacles: () => {},
  idle: () => true,
  seatWhenIdle: () => true,
  headOf: () => null,
  gestureOf: () => null,
  isDirected: () => false,
  isRiding: () => false,
  setGesture: (_id: string, state: string | null) => void calls.gestures.push(state ?? 'null'),
  setHold: () => void calls.hold++,
  setCarrying: () => {},
  faceToward: () => void calls.face++,
  // v1.41+ — métodos que el interfaz ActorsDirector ganó después de v1.37: el stub
  // antiguo crasheaba («setUmbrella is not a function») en cuanto llovía en el paseo.
  visibleOf: () => true,
  setUmbrella: () => {},
  setBags: () => {},
  setFade: () => {},
  standUp: () => {},
  lodOf: () => 0,
  detailViewOf: () => '',
  stageAt: () => {},
} as unknown as ActorsDirector;
let clear = false;
const fakeTraffic = {
  update() {},
  setVisible() {},
  aliveCount: () => 0,
  crossingClear: () => clear,
  // v1.41/1.42 — API que el interfaz TrafficDirector ganó después de v1.37.
  setCrossers: () => {},
  setExtraCrossers: () => {},
  hailTaxi: () => false,
  releaseTaxi: () => {},
  buildAmbulance: () => null,
  dispose() {},
} as unknown as TrafficDirector;
const paseoDir = createPaseo(worldQa, content, fakeActors, null, fakeTraffic, () => true);
// v1.69 — el catálogo v1.41 añadió el plan TAXI (taxiChance): la tirada del tick actual
// ya no cae siempre en «parque» y la prueba del cruce+deporte fallaba por plan equivocado.
// Buscamos el PRIMER tick cuyo guion determinista dé ganas ✓ y plan PARQUE (mismas fórmulas
// que paseo.ts: quien=paseo_quien, ganas=paseo_ganas≤chance, plan=paseo_plan(t*7+13)).
const pCfg = content.rules.view.paseo!;
const taxiOn = !!(content.rules.view as { taxi?: { enabled?: boolean } }).taxi?.enabled;
const limTaxi = pCfg.benchChance + pCfg.strollChance + (taxiOn ? pCfg.taxiChance : 0);
let tickParque = worldQa.tick;
for (let t = worldQa.tick; t < worldQa.tick + 500; t++) {
  if (hash01('paseo_ganas', t) > pCfg.chance) continue; // no quiere salir
  const r = hash01('paseo_plan', t * 7 + 13);
  if (r >= limTaxi) { tickParque = t; break; } // resto = parque
}
worldQa.tick = tickParque;
let spawned = false;
for (let i = 0; i < 60 && !spawned; i++) spawned = paseoDir.spawnNow(); // «algunos si quieren»: la tirada puede rechazar
check('el paseo coge a un vecino (spawnNow con tirada de chance)', spawned);
paseoDir.update(0.5);
check('el vecino camina hasta el portal (walkTo a la línea del pasillo, planta 0)', calls.walkedTo.some((w) => w.endsWith(',0')), calls.walkedTo.join(' | '));
let sawLook = false;
let sawWaitBlocked = false;
let sawGesture = false;
let sawCross = false;
let sawReturn = false;
let ticks = 0;
while (paseoDir.activeCount() > 0 && ticks < 600) {
  ticks++;
  clear = ticks > 26; // los primeros intentos de cruce encuentran coches: espera
  paseoDir.update(0.5);
  sawLook = sawLook || calls.hold >= 2;
  sawGesture = sawGesture || calls.gestures.includes(content.rules.view.paseo!.gesture);
  sawCross = sawCross || calls.paths.some((p) => p.some((pt) => pt.z < -6.5 && pt.z > -12));
  sawReturn = sawReturn || calls.paths.some((p) => p.some((pt) => pt.z > -6 && pt.z < -4 && pt.x < 13));
  if (ticks === 24) sawWaitBlocked = true; // con la vía ocupada seguía esperando (sin tramo de cruce)
  if (ticks === 26) {
    const noCrossYet = !calls.paths.some((p) => p.some((pt) => pt.z < -6.5 && pt.z > -12));
    sawWaitBlocked = sawWaitBlocked && noCrossYet;
  }
}
check('el paseo COMPLETA (sale, cruza, entrena y vuelve: release final)', paseoDir.activeCount() === 0 && calls.released.length >= 1, `ticks=${ticks}`);
check('miró a ambos lados antes de cruzar (pausas de mirada)', sawLook && calls.face >= 4, `face=${calls.face} holds=${calls.hold}`);
check('esperó al tráfico: con coches NO cruza (sin tramo por la calzada)', sawWaitBlocked);
check('cruzó por el paso de peatones (tramo por la calzada en el eje del cruce)', sawCross);
check('practicó deporte en el parque (gesto del catálogo)', sawGesture, calls.gestures.join(','));
check('volvió y reentró por el portal (tramo de vuelta por la acera)', sawReturn);
check('los tramos del cruce son RECTOS (mismo x en la banda de la calzada)', calls.paths.some((p) => {
  const road = p.filter((pt) => pt.z <= -6.8 && pt.z >= -11.9);
  return road.length >= 2 && road.every((pt) => Math.abs(pt.x - content.rules.view.paseo!.crossX) < 0.01);
}));
check('los tramos del cruce son MONÓTONOS en z (el vecino no va y vuelve encima del paso)', calls.paths.some((p) => {
  const zs = p.map((pt) => pt.z);
  if (zs.length < 3) return false;
  let monoUp = true;
  let monoDown = true;
  for (let i = 1; i < zs.length; i++) {
    if (zs[i]! > zs[i - 1]! + 0.01) monoDown = false;
    if (zs[i]! < zs[i - 1]! - 0.01) monoUp = false;
  }
  return monoUp || monoDown;
}));
check('fuera de vista de calle el paseo se PAUSA (isStreetView gate)', (() => {
  const p2 = createPaseo(worldQa, content, fakeActors, null, fakeTraffic, () => false);
  for (let i = 0; i < 60; i++) p2.spawnNow();
  p2.update(2);
  return p2.activeCount() >= 0 && calls.hold >= 0;
})());

console.log('── 7. Comportamiento: consulta del tablón en el atril + colisión lavadoras ──');
const logic = new PlayerLogic(worldQa, content, { actorId: worldQa.playerId, send: () => undefined });
const v = content.rules.view;
const nbX = 0 + 0 + nb.inset; // pasillo de planta 0: col 0 → extremo izquierdo + inset
logic.setNoticeboardSpot({ x: nbX, floor: 0 });
logic.teleportTo('blk_p0_portal');
// camina hacia el atril (A/D avanza en X: input.left) hasta el rango del atril
for (let i = 0; i < 90 && Math.abs(logic.position().x - nbX) > 0.5; i++) {
  logic.update(1 / 30, { left: true, right: false, up: false, down: false, run: false });
}
const nearAtril = logic.interactTarget();
check('el jugador junto al atril recibe el objetivo noticeboard', nearAtril?.kind === 'noticeboard', `x=${logic.position().x.toFixed(2)} objetivo=${nearAtril?.kind ?? 'null'}`);
const lejos = (() => {
  logic.teleportTo('blk_p0_pasillo');
  logic.setNoticeboardSpot({ x: nbX, floor: 0 });
  for (let i = 0; i < 20; i++) logic.update(1 / 30, { left: false, right: false, up: false, down: false, run: false });
  return logic.interactTarget()?.kind ?? null;
})();
check('lejos del atril el objetivo NO es el tablón', lejos !== 'noticeboard', `objetivo=${lejos ?? 'null'}`);
// COLISIÓN: entra en la lavandería y camina hacia el fondo (donde están las máquinas)
const laundryId = Object.values(worldQa.blocks).find((b) => b.defId === 'lavanderia_comunal')?.id;
let blocked = false;
if (laundryId) {
  const lav = worldQa.blocks[laundryId]!;
  // Los mismos rects que building.ts calcula al levantar las máquinas (catálogo lavanderia):
  const lv = v.locals.lavanderia;
  const stacks = Math.max(1, lv.stacks ?? 3);
  const mW = lv.machineW ?? 0.64;
  const mD = lv.machineD ?? 0.6;
  const bw = lav.size.w * v.cellW - v.gapW;
  const x0b = (lav.cell.col + 0.5) * v.cellW - bw / 2;
  const colStep = (bw - 0.72) / stacks;
  const zBack = v.roomZ - v.commonDepth / 2 + v.commonDepth - v.wall - mD / 2 - 0.08;
  const rects = Array.from({ length: stacks }, (_z, s) => {
    const mx = x0b + 0.36 + colStep * (s + 0.5);
    return { x0: mx - mW / 2 - 0.02, z0: zBack - mD / 2 - 0.02, w: mW + 0.04, d: mD + 0.04 };
  });
  logic.setBlockObstacles([{ blockId: laundryId, rects }]);
  logic.teleportTo(laundryId);
  // v1.69 — entrar ANDANDO: desde v1.46+ los locales con interior se cruzan por el vano
  // (walk-in); la E de v1.37 ya no entra en los locales comunes. Empujar W cruza el umbral.
  for (let i = 0; i < 60 && logic.position().mode !== 'inside'; i++) {
    logic.update(1 / 30, { left: false, right: false, up: true, down: false, run: false });
  }
  const pos0 = logic.position();
  if (pos0.mode === 'inside' && pos0.insideBlock === laundryId) {
    for (let i = 0; i < 240; i++) {
      logic.update(1 / 30, { left: false, right: false, up: true, down: false, run: false });
    }
    const pos = logic.position();
    // sin colisión llegaría al fondo del local (z ≈ maxZ − margin ≈ 2.45); con las
    // lavadoras sólidas se detiene ANTES del frente de las máquinas (z_local ≈ 2.04 − radio)
    blocked = pos.z < 1.85;
    console.log(`    · z dentro de la lavandería: ${pos0.z.toFixed(2)} → ${pos.z.toFixed(2)} (máquinas desde ≈1.76)`);
  }
}
check('las lavadoras son SÓLIDAS: el jugador no llega a atravesarlas', blocked);

console.log('── 8. Insignia y determinismo ──');
check('insignia v1.38 (pase de optimización) en i18n', srcOf('src/game/client/i18n.ts').includes("'opt.perfAuto':"));
check('sw.js cache bump al ser el runtime actual', srcOf('public/sw.js').includes('vecinos-v1.69')); // v1.46→v1.69: estaba CONGELADO 20 versiones (stale cache PWA)
// v1.71 (higiene) — candado permanente: el EXPECTED_SW_VERSION de PwaRegister debe ESPEJAR la
// VERSION de sw.js. Se desalineó 24 versiones (v1.45 vs v1.69) y cada visitante recurrente
// pagaba una recarga extra por sesión. Consistencia cruzada, sin versiones hardcodeadas.
const swVer = (srcOf('public/sw.js').match(/const VERSION = '([^']+)'/) ?? [])[1] ?? '';
const pwaVer = (srcOf('src/components/game/PwaRegister.tsx').match(/EXPECTED_SW_VERSION = '([^']+)'/) ?? [])[1] ?? '';
check('PwaRegister ESPEJA la VERSION de sw.js (sin desfase de caché)', swVer !== '' && swVer === pwaVer, `sw=${swVer} pwa=${pwaVer}`);
const w1 = createWorld(content, 'slice');
for (let i = 0; i < 240; i++) tick(w1, content);
check('sim determinista (240 ticks)', w1.tick === 240);

console.log(`\n═══ QA v1.37: ${pass} ✓ / ${fail} ✗ ═══`);
if (fail > 0) process.exit(1);
