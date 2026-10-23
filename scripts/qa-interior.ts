/**
 * QA Fase C: movimiento interior 2D + layouts de estancias (100% data-driven).
 * Verifica contra el contenido y la PlayerLogic REALES (caja negra: update/interact/position):
 *  1. Al entrar en la vivienda, si la puerta cae en una estancia cerrada se aterriza en la abierta.
 *  2. Los tabiques bloquean: no se cruza a una estancia cerrada ni fuera de los huecos declarados.
 *  3. Reformar una estancia abre su hueco: se cruza andando (movimiento 2D con deslizamiento).
 *  4. Interactivos por posición 2D del catálogo (portátil en el salón, cama en el dormitorio).
 *  5. La profundidad se acota a los márgenes del catálogo (z ∈ [margin, depth − margin]).
 *  6. Salir devuelve al pasillo (modo corridor) y el sim queda sincronizado.
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, dispatch } from '@/game/sim';
import { PlayerLogic } from '@/game/player-logic';

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
const close = (a: number, b: number, eps = 0.02) => Math.abs(a - b) < eps;

const world = createWorld(content, content.rules.startScenario);
const HOME = world.residents[world.playerId]!.home; // blk_p3_c (col 5, x mundo 12..16.8)
const homeBlock = world.blocks[HOME]!;
const X0 = homeBlock.cell.col * content.rules.view.cellW; // borde izquierdo en metros de mundo
const logic = new PlayerLogic(world, content);

// Entrar legalmente: teleport del editor + E en la puerta.
logic.teleportTo(HOME);
check('teleport coloca delante de la puerta', logic.position().mode === 'corridor' && close(logic.position().x, X0 + 2.4), `x=${logic.position().x.toFixed(2)}`);
const entered = logic.interact();
check('E entra en la vivienda', entered.type === 'entered', JSON.stringify(entered));
check('aterriza en el salón (la puerta cae en el dormitorio, cerrado)', close(logic.position().x, X0 + 1.15), `x=${logic.position().x.toFixed(2)}`);
check('profundidad de entrada = 0.45', close(logic.position().z, 0.45), `z=${logic.position().z.toFixed(2)}`);

// ── Tabiques: andar a la derecha con el dormitorio cerrado NO cruza (ni por el hueco)
for (let i = 0; i < 240; i++) logic.update(1 / 60, { left: false, right: true, up: false, down: false });
check('tabique bloquea hacia el dormitorio cerrado', logic.position().x < X0 + 2.31, `x=${logic.position().x.toFixed(2)}`);

// ── Profundidad: acotada por los márgenes del catálogo
for (let i = 0; i < 600; i++) logic.update(1 / 60, { left: false, right: false, up: true, down: false });
check('z llega al fondo del catálogo (depth − margin)', close(logic.position().z, content.rules.view.depth - content.rules.view.margin), `z=${logic.position().z.toFixed(2)}`);
for (let i = 0; i < 600; i++) logic.update(1 / 60, { left: false, right: true, up: false, down: false });
check('tampoco cruza al baño cerrado por el fondo', logic.position().x < X0 + 2.31, `x=${logic.position().x.toFixed(2)}`);

// ── Reformar el baño (sim) abre el hueco del fondo: se cruza andando
const rBano = dispatch(world, content, { type: 'renovate_room', block: HOME, room: 'bano' });
check('reforma del baño aceptada (cartera 800 €)', rBano.ok);
for (let i = 0; i < 240; i++) logic.update(1 / 60, { left: false, right: true, up: false, down: false });
check('cruza por el hueco del fondo al baño reformado', logic.position().x > X0 + 2.4, `x=${logic.position().x.toFixed(2)}`);

// ── Interactivos por posición 2D del catálogo
logic.x = X0 + 0.4 + 0.05; // portátil del salón en [0.4, 0.55]
logic.z = 0.55;
check('portátil detectado por proximidad 2D', logic.interactTarget()?.kind === 'laptop');
const wallet0 = world.residents[world.playerId]!.wallet;
const used = logic.interact();
check('E usa el portátil (work del sim)', used.type === 'used' && (used as { kind?: string }).kind === 'laptop');
check('work paga +120 €', world.residents[world.playerId]!.wallet === wallet0 + content.rules.sim.work.pay, `${wallet0}→${world.residents[world.playerId]!.wallet}`);

const rDorm = dispatch(world, content, { type: 'renovate_room', block: HOME, room: 'dormitorio' });
check('reforma del dormitorio aceptada', rDorm.ok);
logic.x = X0 + 2.3 + 1.75; // cama del dormitorio en local [1.75, 0.8]
logic.z = 0.8;
check('cama detectada en el dormitorio', logic.interactTarget()?.kind === 'bed');
const usedBed = logic.interact();
const needs = world.residents[world.playerId]!.needs;
check('E usa la cama (sleep del sim)', usedBed.type === 'used' && (usedBed as { kind?: string }).kind === 'bed');
check('sleep restaura por completo', needs['sleep'] === 100, `sleep=${needs['sleep']}`);

// ── Salir: E con objetivo puerta → corridor y location en el pasillo
logic.x = X0 + 3.0; // dormitorio, lejos de la cama (radio 0.9)
logic.z = 0.45;
check('objetivo puerta dentro de casa', logic.interactTarget()?.kind === 'door');
const exited = logic.interact();
check('E sale al pasillo', exited.type === 'exited');
check('modo corridor y sim sincronizado', logic.position().mode === 'corridor' && world.residents[world.playerId]!.location === `blk_p${homeBlock.cell.floor}_pasillo`, world.residents[world.playerId]!.location ?? 'null');
check('vuelta al pasillo: z reset', logic.position().z === 0);

// ── Fallback 1D: un layout sin rects mantiene el comportamiento clásico (sin interior 2D)
for (const r of content.layouts['layout_vivienda_v1']!.rooms) delete r.rect;
content.layouts['layout_vivienda_v1']!.doorways = [];
logic.teleportTo(HOME);
logic.interact();
check('layout sin rects: entra sin geometría 2D (fallback 1D)', logic.position().mode === 'inside');
const xBefore = logic.position().x;
for (let i = 0; i < 120; i++) logic.update(1 / 60, { left: false, right: false, up: true, down: false });
check('fallback 1D: W/S no mueve profundidad', close(logic.position().z, 0.45) && close(logic.position().x, xBefore), `z=${logic.position().z.toFixed(2)}`);

console.log(fails === 0 ? '\nQA INTERIOR OK' : `\nQA INTERIOR: ${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
