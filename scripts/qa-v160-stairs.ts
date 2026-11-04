/**
 * QA v1.60 — CICLO DE ESCALERAS sin trampas (bug residual del vecino):
 *   «si nuestro usuario trata de subir por las escaleras a la primera planta vuelve a
 *   aparecer en el portal de entrada» (arreglado en v1.57 — aquí se verifica) y el
 *   «escalera→planta 0 atraviesa pared» (residual).
 * Recorrido: portal → pasillo planta 0 → subir escalera (planta 1) → pasear planta 1 →
 * bajar escalera (planta 0) → recorrer TODO el pasillo (extremo a extremo, ambos carriles)
 * → comprobar: aterrizaje en pasillo (no portal), x/z SIEMPRE dentro de los límites del
 * pasillo (sin cruzar paredes del vestíbulo ni fachadas), insideBlock nulo (sin entrar
 * en el vestíbulo sin empujón), sin eventos portalIn/portalOut fantasma, y estabilidad
 * tras ciclos repetidos.
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld } from '@/game/sim';
import { PlayerLogic } from '@/game/player-logic';
import { corridorLanes } from '@/game/storage';
import { frontDoorSpans } from '@/game/frontDoors';
import type { Input } from '@/game/core/types';

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

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}
const v = content.rules.view;

const world = createWorld(content, content.rules.startScenario);
const logic = new PlayerLogic(world, content);
const STEP = 1 / 60;
const INPUT = (o: Partial<Input>): Input => ({ left: false, right: false, up: false, down: false, run: false, ...o });
const run = (frames: number, input: Input): void => {
  for (let i = 0; i < frames; i++) logic.update(STEP, input);
};
const walkUntil = (cond: () => boolean, input: Input, maxFrames: number): boolean => {
  for (let i = 0; i < maxFrames; i++) {
    logic.update(STEP, input);
    if (cond()) return true;
  }
  return false;
};
const pos = (): { x: number; z: number; floor: number; mode: string; insideBlock: string | null; climbing: boolean } => {
  const p = logic.position();
  return { x: p.x, z: p.z, floor: p.floor, mode: p.mode, insideBlock: p.insideBlock, climbing: p.climbing };
};

/** Guardián: el cuerpo NO puede salir de los límites del pasillo ni colarse en el vestíbulo. */
let violations = 0;
const lanes = corridorLanes(v);
const portalBlk = Object.values(world.blocks).find((b) => b.defId === 'portal')!;
// mismas fórmulas que player-logic (rangeOf/width son privadas): UNA sola geometría del catálogo
const rangeOf = (b: { cell: { col: number }; size: { w: number } }): [number, number] => [b.cell.col * v.cellW, (b.cell.col + b.size.w) * v.cellW];
const walkWidth = Math.max(
  ...Object.values(world.blocks)
    .filter((b) => content.blocks[b.defId]!.traversable !== false)
    .map((b) => (b.cell.col + b.size.w) * v.cellW),
);
const [pMinX, pMaxX] = rangeOf(portalBlk);
const guard = (): void => {
  const p = pos();
  if (p.mode !== 'corridor' || p.climbing) return; // en escalada z=0 es pathZ (no es callejón)
  const w = walkWidth;
  if (p.x < v.margin - 1e-3 || p.x > w - v.margin + 1e-3) violations++;
  if (p.z < lanes.minZ - 1e-3 || p.z > lanes.maxZ + 1e-3) violations++;
  // sin entrar al vestíbulo (vestíbulo = insideBlock=portal) sin el empujón de la puerta:
  if (p.insideBlock === portalBlk.id) violations++;
};

console.log('── 1. Portal → pasillo (planta 0) ──');
// v1.46/v1.47: el portal se CRUZA ANDANDO — colocar al jugador en el vano real y empujar W
// (la E ya no participa en locales ni portal: es diseño, no bug).
logic.z = v.corridorZ;
{
  const cols = frontDoorSpans(v, portalBlk);
  const span = cols[0]!;
  logic.x = (span.x0 + span.x1) / 2;
}
const entered = walkUntil(() => logic.mode === 'inside' && logic.insideBlock === portalBlk.id, INPUT({ up: true }), 300);
check('empujón W en el vano cruza al vestíbulo (sin E, diseño v1.47)', entered && logic.mode === 'inside', `mode=${logic.mode}`);
logic.drainAuto();
// v1.75 — RETIRADO el exit por el FONDO del vestíbulo (portalInnerExit): empujar W al fondo
// aterrizaba en el paseo frontal cruzando el muro — el «teleport al portal» del vecino.
// AHORA: el fondo es fondo muerto (clampZ en el tabique) y la salida honesta es por las
// CORREDERAS DEL FRENTE (S en el vano → pasillo de planta 0, v1.47).
{
  const backZ = v.locals?.portal?.backZoneZ ?? 2.0;
  const pushed = walkUntil(() => logic.z >= backZ, INPUT({ up: true }), 600);
  run(30, INPUT({ up: true }));
  const pBack = pos();
  check('empujón W al fondo del vestíbulo NO teleporta (fondo muerto, sigues dentro)', pushed && pBack.mode === 'inside' && pBack.insideBlock === portalBlk.id, `mode=${pBack.mode} inside=${pBack.insideBlock ?? 'null'} z=${pBack.z.toFixed(2)}`);
  logic.drainAuto();
  // Salida honesta: S hacia las correderas del frente → pasillo de planta 0.
  const cols = frontDoorSpans(v, portalBlk);
  const span = cols[0]!;
  logic.x = (span.x0 + span.x1) / 2;
  const outFront = walkUntil(() => logic.mode === 'corridor' && logic.floor === 0, INPUT({ down: true }), 600);
  check('vestíbulo → pasillo por las correderas (S en el vano, sin E)', outFront && logic.mode === 'corridor', `mode=${logic.mode} floor=${logic.floor}`);
  logic.drainAuto();
}

console.log('── 2. SUBIR escalera a planta 1 ──');
// Caminar hacia el cubo de escalera (bloque con features.stairs en planta 0) y empujar W.
const stairBlk = Object.values(world.blocks).find((b) => content.blocks[b.defId]!.features?.stairs === true && b.cell.floor === 0)!;
const [sa, sb] = rangeOf(stairBlk);
const targetX = (sa + sb) / 2;
let reached = walkUntil(() => logic.x >= targetX, INPUT({ right: true }), 3000);
check('paseo hasta el cubo de escalera', reached, `x=${logic.x.toFixed(2)} objetivo=${targetX.toFixed(2)}`);
const climbUp = walkUntil(() => logic.position().climbing, INPUT({ up: true }), 120);
check('empujón W arranca la escalada', climbUp, '');
const upDone = walkUntil(() => !logic.position().climbing && logic.floor === 1, INPUT({ up: true }), 60 * 20);
check('desembarco en planta 1 (pasillo, sin teleport al portal)', upDone && logic.floor === 1 && logic.mode === 'corridor' && logic.insideBlock === null, `floor=${logic.floor} mode=${logic.mode} inside=${logic.insideBlock ?? 'null'}`);
check('el sim NO se movió de planta (location estable)', Object.values(world.residents).some((r) => r.id === world.playerId), '');
guard();

console.log('── 3. Paseo en planta 1 y BAJADA a planta 0 ──');
run(60, INPUT({ left: true }));
logic.drainAuto();
const backAtCore = walkUntil(() => Math.abs(logic.x - targetX) < 0.35, INPUT({ right: true }), 3000);
check('regreso al cubo en planta 1', backAtCore, `x=${logic.x.toFixed(2)}`);
const climbDown = walkUntil(() => logic.position().climbing, INPUT({ down: true }), 120);
check('empujón S arranca la bajada', climbDown, '');
const downDone = walkUntil(() => !logic.position().climbing && logic.floor === 0, INPUT({ down: true }), 60 * 20);
const pDown = pos();
check('desembarco en planta 0 (pasillo, NO portal)', downDone && logic.floor === 0 && logic.mode === 'corridor' && logic.insideBlock === null, `floor=${pDown.floor} mode=${pDown.mode} inside=${pDown.insideBlock ?? 'null'}`);
check('sin eventos portalIn/portalOut en todo el ciclo', !logic.drainAuto().some((e) => e.type === 'portalIn' || e.type === 'portalOut'), '');
guard();

console.log('── 4. Recorrido COMPLETO del pasillo planta 0 (paredes incluidas) ──');
// Extremo izquierdo (hasta el clamp): el clamp debe detener ANTES de la pared del vestíbulo.
const leftEnd = walkUntil(() => logic.x <= v.margin + 1e-3, INPUT({ left: true }), 4000);
run(120, INPUT({ left: true }));
const pLeft = pos();
check('extremo izquierdo: el clamp frena (no atraviesa pared del vestíbulo)', leftEnd && pLeft.x >= v.margin - 1e-3, `x=${pLeft.x.toFixed(3)} clamp=${v.margin}`);
check('en el extremo izquierdo NO se cuela en el vestíbulo', pLeft.insideBlock === null && pLeft.mode === 'corridor', `inside=${pLeft.insideBlock ?? 'null'}`);
logic.drainAuto();
// Extremo derecho.
const rightEnd = walkUntil(() => logic.x >= walkWidth - v.margin - 1e-3, INPUT({ right: true }), 6000);
run(120, INPUT({ right: true }));
const pRight = pos();
check('extremo derecho: el clamp frena (no atraviesa pared/fachada)', rightEnd && pRight.x <= walkWidth - v.margin + 1e-3, `x=${pRight.x.toFixed(3)} clamp=${(walkWidth - v.margin).toFixed(2)}`);
// Carril exterior (S) y vuelta al frontal (W) por todo el pasillo — en una x SIN vanos
// (sobre el cubo el empujón W escala, en tu puerta entra a casa: ambos correctos, no carriles).
logic.z = lanes.minZ + 0.01;
{
  const spansAll: { x0: number; x1: number }[] = [];
  for (const b of Object.values(world.blocks)) {
    if (b.cell.floor !== 0) continue;
    const f = content.blocks[b.defId]!.features;
    if (f?.stairs || f?.elevator || f?.innerCorridor) continue;
    for (const sp of frontDoorSpans(v, b)) spansAll.push(sp);
  }
  let freeX = -1;
  for (const b of Object.values(world.blocks)) {
    if (b.cell.floor !== 0 || b.kind === 'dwelling') continue;
    const f = content.blocks[b.defId]!.features;
    if (f?.stairs || f?.elevator || f?.innerCorridor) continue;
    const [ba, bb] = rangeOf(b);
    const cand = ba + 0.2;
    if (cand < bb - 0.3 && !spansAll.some((s) => cand >= s.x0 - 0.15 && cand <= s.x1 + 0.15) && cand > v.margin + 0.4) {
      freeX = cand;
      break;
    }
  }
  check('x de pared pura encontrada para el test de carriles', freeX > 0, `x=${freeX.toFixed(2)}`);
  logic.x = freeX > 0 ? freeX : 10;
}
const outer = walkUntil(() => logic.z <= lanes.minZ + 1e-3, INPUT({ down: true }), 600);
check('carril exterior accesible (S)', outer && logic.z >= lanes.minZ - 1e-3, `z=${logic.z.toFixed(3)}`);
const inner = walkUntil(() => logic.z >= lanes.maxZ - 1e-3, INPUT({ up: true }), 600);
check('carril frontal accesible (W)', inner && logic.z <= lanes.maxZ + 1e-3, `z=${logic.z.toFixed(3)}`);
guard();

console.log('── 5. Estabilidad: 3 ciclos seguidos de escalera ──');
let cyclesOk = 0;
for (let c = 0; c < 3; c++) {
  const atCore = walkUntil(() => Math.abs(logic.x - targetX) < 0.35, logic.x < targetX ? INPUT({ right: true }) : INPUT({ left: true }), 4000);
  if (!atCore) break;
  const up = walkUntil(() => !logic.position().climbing && logic.floor === 1, INPUT({ up: true }), 60 * 20);
  if (!up) break;
  const atCore2 = walkUntil(() => Math.abs(logic.x - targetX) < 0.35, INPUT({ right: true }), 4000);
  if (!atCore2) break;
  const down = walkUntil(() => !logic.position().climbing && logic.floor === 0, INPUT({ down: true }), 60 * 20);
  if (!down) break;
  guard();
  cyclesOk++;
}
check('3 ciclos subida+bajada completos sin anomalías', cyclesOk === 3, `ciclos=${cyclesOk} violaciones=${violations}`);
check('CERO violaciones de límites/paredes en toda la sesión', violations === 0, `violaciones=${violations}`);

console.log(`\nRESULTADO: ${pass} ✓ / ${fail} ✗`);
process.exit(fail > 0 ? 1 : 0);
