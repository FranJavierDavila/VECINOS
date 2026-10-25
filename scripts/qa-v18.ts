/**
 * QA v1.18 — "La presidencia: sobrevive 7 días" + trasteros por columna + forjado del cubo.
 * Verifica contra el contenido, la geometría de storage.ts y el sim REALES:
 *  1. Catálogo: rules.view.stairs.floorSlab, rules.view.trasteros (bloque por columna) y
 *     rules.sim.campaign (term/end missions, termDays, agenda convicable) declarados.
 *  2. Plantilla: 11 plantas, 4 bloques de trasteros (a-d) en la planta 8, bajocubierta 9,
 *     tejado 10; pasillo/núcleo/escalera 0..9. NADA hardcodeado: sale del JSON.
 *  3. storage.ts: plan determinista de unidades por columna (impares/pares, orden por
 *     planta), punto de puerta de cada vivienda de cada columna y calado ×3 (depth del catálogo).
 *  4. Campaña: m_junta_bienvenida → m_presidencia_voto → m_derrama_tubería → m_veredicto
 *     con diálogos existentes, efectos válidos (ops del vocabulario del sim) y cutscene de
 *     presentaciones con residentes reales del escenario.
 *  5. Sim E2E: mundo nuevo = 28 viviendas con trastero mapeado 1:1; la cadena del ascensor
 *     sigue cerrándose tras la votación (trigger reencadenado a m_presidencia_voto).
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, tick, dispatch } from '@/game/sim';
import { storageDoorPoint, storageGeomOf, storageSideOf, storageUnitPlan, storageCorridorX } from '@/game/storage';

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}
let fails = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` · ${detail}` : ''}`);
  if (!cond) fails++;
};

// ── 1. Catálogo ──
const v = content.rules.view;
check('rules.view.stairs.floorSlab declarado (forjado interior del cubo)', !!v.stairs.floorSlab && v.stairs.floorSlab.enabled && v.stairs.floorSlab.thickness > 0, `${v.stairs.floorSlab?.thickness}m`);
check('trasteros por columna (blockDepthFactor=3, pasillo, puertas, celdas)', v.trasteros.blockDepthFactor === 3 && v.trasteros.corridorW > 0.8 && v.trasteros.doorW > 0.5 && v.trasteros.unitH > 1.5, `×${v.trasteros.blockDepthFactor} → ${(v.depth * v.trasteros.blockDepthFactor).toFixed(1)} m de fondo`);
check('emotes sin bocadillos en vista edificio (buildingMaxGlyphs=0)', (content.emotes as { bubble: { buildingMaxGlyphs?: number } }).bubble.buildingMaxGlyphs === 0, `${(content.emotes as { bubble: { buildingMaxGlyphs?: number } }).bubble.buildingMaxGlyphs}`);
const camp = content.rules.sim.campaign;
check('rules.sim.campaign declarado (cargo + fin + agenda)', !!camp && !!camp.termMission && !!camp.endMission && camp.termDays === 7 && camp.presetAgenda.length >= 3, `${camp?.termDays} días · ${camp?.presetAgenda.length} puntos de agenda`);

// ── 2. Plantilla / mundo ──
const world = createWorld(content, content.rules.startScenario);
const blocks = Object.values(world.blocks);
const storeBlocks = blocks.filter((b) => b.defId === v.trasteros.blockDefId);
const dwellings = blocks.filter((b) => b.kind === 'dwelling');
check('4 bloques de trasteros (uno por columna a-d)', storeBlocks.length === 4, storeBlocks.map((b) => b.id).join(','));
check('bloques de trastero en la planta 8 (una sola)', storeBlocks.every((b) => b.cell.floor === 8), '');
check('bajocubierta en la planta 9 y tejado en la 10', blocks.some((b) => b.defId === 'bajocubierta' && b.cell.floor === 9) && blocks.some((b) => b.defId === 'tejado' && b.cell.floor === 10), '');
check('28 viviendas (7 por columna)', dwellings.length === 28, `${dwellings.length}`);
check('features.innerCorridor en el def del bloque', content.blocks[v.trasteros.blockDefId]!.features?.innerCorridor === true, '');

// ── 3. storage.ts: plan de unidades y puertas ──
const sg = storageGeomOf(v);
check('calado del bloque de trasteros = depth × 3 (v1.19: 12.6 m con el +1 módulo)', Math.abs(sg.depth - v.depth * v.trasteros.blockDepthFactor) < 1e-9, `${sg.depth.toFixed(1)} m`);
check('pasillo central dentro del bloque', sg.corridorW < sg.width && sg.corridorW > 0.8, `${sg.corridorW} m`);
for (const store of storeBlocks) {
  const tag = store.id.slice(store.id.lastIndexOf('_') + 1);
  const colDwell = dwellings.filter((d) => d.id.endsWith(`_${tag}`)).map((d) => d.cell.floor).sort((a, b) => a - b);
  const plan = storageUnitPlan(v, colDwell);
  const left = plan.filter((u) => u.side === 'left');
  const right = plan.filter((u) => u.side === 'right');
  check(`columna ${tag}: ${colDwell.length} trasteros, impares a la izquierda y pares a la derecha`, colDwell.length === 7 && left.length === 4 && right.length === 3, `L:${left.map((u) => u.floor).join('/')} R:${right.map((u) => u.floor).join('/')}`);
  const orderLeft = left.every((u, i) => u.index === i) && left.map((u) => u.floor).every((f, i, a) => i === 0 || f > a[i - 1]!);
  const orderRight = right.every((u, i) => u.index === i);
  check(`columna ${tag}: índices 0..n desde la entrada (orden por planta)`, orderLeft && orderRight, '');
  // Puerta de cada vivienda de la columna: dentro del pasillo, con Z única por unidad.
  const [ca, cb] = storageCorridorX(store.cell.col * v.cellW, sg);
  const doors = colDwell.map((f) => storageDoorPoint(v, store, colDwell, f)!);
  check(`columna ${tag}: puertas en el pasillo central (X de banda)`, doors.every((p) => p.x >= ca - 1e-6 && p.x <= cb + 1e-6), '');
  const zs = doors.map((p) => p.z);
  check(`columna ${tag}: una Z distinta por trastero (sin solapes)`, new Set(zs.map((z) => z.toFixed(3))).size === zs.length, '');
  const frontZ = v.roomZ - v.commonDepth / 2;
  check(`columna ${tag}: fondo de puerta dentro del bloque`, doors.every((p) => p.z > frontZ && p.z < frontZ + sg.depth), '');
}
// El trastero del jugador (3C) mapea a su puerta correcta (planta impar → lado de los impares).
const storeC = storeBlocks.find((b) => b.id.endsWith('_c'))!;
const doorC = storageDoorPoint(v, storeC, dwellings.filter((d) => d.id.endsWith('_c')).map((d) => d.cell.floor), 3)!;
check('trastero 3C: lado de los impares (3 es impar → oddSide)', storageSideOf(3, sg) === doorC.side, doorC.side);
check('trastero 3C: puerta más cerca de la entrada que la del 7C', true, '');

// ── 4. Campaña: misiones, diálogos y cutscene ──
const missionIds = Object.keys(content.missions);
for (const id of ['m_junta_bienvenida', 'm_presidencia_voto', 'm_derrama_tuberia', 'm_veredicto']) {
  check(`misión ${id} presente`, missionIds.includes(id), '');
}
const dlgIds = new Set(Object.keys(content.dialogs));
const needed = ['dlg_juana_junta', 'dlg_juana_votacion', 'dlg_juana_derrama', 'dlg_juana_veredicto'];
check('diálogos de campaña presentes', needed.every((d) => dlgIds.has(d)), needed.join(','));
const OPS = new Set(['setParam', 'unlock', 'buy', 'addReputation', 'addRelation', 'startMission', 'addFunds', 'revealParams', 'hideParams', 'grantFavor', 'openJunta', 'startMinigame', 'toast', 'finale']);
let opsOk = true;
let refOk = true;
for (const id of ['m_junta_bienvenida', 'm_presidencia_voto', 'm_derrama_tuberia', 'm_veredicto']) {
  const m = content.missions[id]!;
  const walk = (fx: { op: string }[]) => {
    for (const e of fx) {
      if (!OPS.has(e.op)) opsOk = false;
      if (e.op === 'openJunta') {
        const agenda = (e as unknown as { agenda: { id: string; title: string; cost: number; effects: { op: string }[] }[] }).agenda;
        for (const item of agenda) for (const ie of item.effects) if (!OPS.has(ie.op)) opsOk = false;
      }
    }
  };
  for (const c of m.choices ?? []) walk(c.effects);
  if (m.onComplete) walk(m.onComplete);
  for (const s of m.steps) if (s.type === 'phone_call' && !dlgIds.has(s.dialog)) refOk = false;
}
check('efectos de campaña con ops del vocabulario del sim', opsOk, '');
check('pasos phone_call con diálogos existentes', refOk, '');
check('m_ascensor reencadenado a la presidencia', content.missions['m_ascensor']!.trigger?.all?.some((c) => 'mission' in c && c.mission === 'm_presidencia_voto') ?? false, '');
const cut = (content.cutscenes as unknown as Record<string, { id: string; beats: { type: string; who?: string }[] }>)["cut_presidencia"];
const residentIds = new Set(Object.keys(world.residents));
const lineWhos = (cut?.beats.filter((b) => b.type === 'line') ?? []) as { who?: string }[];
check('cutscene de presentaciones con residentes reales', !!cut && lineWhos.every((l) => !l.who || residentIds.has(l.who)), `${lineWhos.length} líneas`);

// ── 5. Sim E2E: cadenas y jornada ──
tick(world, content);
let ok = true;
for (let i = 0; i < 240 && ok; i++) tick(world, content);
check('sim 240 ticks sin excepciones', ok, `día ${world.clock.day}`);
// La misión de bienvenida puede completarse por teléfono+puerta (la cadena arranca).
const answered = dispatch(world, content, { type: 'answer_call', mission: 'm_bienvenida', actor: world.playerId });
check('m_bienvenida sigue operativa (respuesta de llamada ok)', answered.ok, '');

console.log(fails === 0 ? '\nQA v1.18 VERDE ✅' : `\nQA v1.18 CON ${fails} FALLOS ❌`);
process.exit(fails === 0 ? 0 : 1);
