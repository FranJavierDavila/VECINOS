/**
 * QA v1.42 — «el jugador es un vecino más» + emoticonos sólidos + fachada ciega:
 *   1. CATÁLOGO: view.outside (rects transitables, portal SIN tecla E, bancos/calistenia,
 *      líneas cómicas), view.fachadaCortina (zonas ciegas arriba/abajo por nivel) y prompts
 *      de interacción nuevos — todo en rules.json con sus traducciones EN.
 *   2. GEOMETRÍA: la ruta oficial del perímetro izquierdo (sideX/sideZ → esquina → acera
 *      frontal) queda DENTRO de los rects transitables; el paso de cebra es el ÚNICO cruce
 *      de la calzada; el parque de calistenia es alcanzable; los disparadores del portal son
 *      coherentes con el vestíbulo (nada coplanar tampoco en la cortina: bandas detrás del
 *      vidrio, sin solapar montantes ni canto).
 *   3. FUENTE: bubbles.ts purga fantasmas (dropBubble real, hideAll sin cámara, destrucción
 *      por dueño perdido), actors.ts exige no-desvanecido en headOf, traffic fusiona al
 *      jugador como peatón, building pinta las bandas ciegas.
 *   4. SIM E2E (mundo real + PlayerLogic): E al portal → salir por la PARED IZQUIERDA sin
 *      pulsar nada más → acera lateral → acera frontal → cruzar por el PASO DE CEBRA →
 *      banco (sentarse/levantarse) → calistenia → volver y entrar por el frente → salir por
 *      el frente. Jaywalking IMPOSIBLE y límites del plano de cámara respetados.
 */
import fs from 'fs';
import path from 'path';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld } from '@/game/sim';
import { PlayerLogic } from '@/game/player-logic';
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
const srcOf = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}
const v = content.rules.view;
const frontZ = v.roomZ - v.commonDepth / 2;

console.log('── 1. Catálogo: la calle y el portal sin E ──');
const out = v.outside!;
check('view.outside declarado (rects + portal + ejercicio + líneas)', !!out, out ? `${out.walk.length} rects` : 'ausente');
if (out) {
  check('límites del plano de cámara cubren portal, paso y parque',
    out.xMin <= -6 && out.xMax >= 15.8 && out.xMax < 32.2, `x ∈ [${out.xMin}, ${out.xMax}]`);
  check('disparadores del portal SIN tecla E: pared izquierda, frente y acera lateral',
    out.portal.wallInnerX > frontZ * 0 + 0.2 && out.portal.wallInnerX < 1.2
    && out.portal.sideExitX < -2 && out.portal.sideZ > -1
    && out.portal.outFrontZ < -1.6 && out.portal.inFrontZ < -1.4 && out.portal.fadeSeconds > 0,
    `pared x≤${out.portal.wallInnerX} · lateral (${out.portal.sideExitX}, ${out.portal.sideZ}) · frente z=${out.portal.outFrontZ}`);
  check('ejercicio de calistenia con radio y duración', out.exercise.radius > 0.5 && out.exercise.secondsMax > out.exercise.secondsMin && out.exercise.secondsMin > 0, `${out.exercise.secondsMin}–${out.exercise.secondsMax} s`);
  check('líneas cómicas del jugador en 4 momentos', ['out', 'into', 'sit', 'exercise'].every((k) => (out.says as unknown as Record<string, string[]>)[k].length > 0), 'out/into/sit/exercise');
  check('prompts de banco/calistenia/levantarse en interact',
    !!content.rules.interact.bench && !!content.rules.interact.exercise && !!content.rules.interact.standUp, content.rules.interact.bench ?? '');
  const dict = JSON.parse(srcOf('public/content/translations.en.json')) as Record<string, string>;
  const esLines = [content.rules.interact.bench!, content.rules.interact.exercise!, content.rules.interact.standUp!,
    ...out.says.out, ...out.says.into, ...out.says.sit, ...out.says.exercise];
  check('todas las cadenas nuevas tienen EN (overlay i18n)', esLines.every((s) => !!dict[s]), `${esLines.filter((s) => !!dict[s]).length}/${esLines.length}`);
}

console.log('── 2. Geometría: ruta oficial, paso de cebra y vestíbulo ──');
if (out) {
  const insideWalk = (x: number, z: number): boolean =>
    out.walk.some((r) => x >= r.x0 - 1e-4 && x <= r.x1 + 1e-4 && z >= r.z0 - 1e-4 && z <= r.z1 + 1e-4);
  const p = v.paseo!;
  check('aterrizaje de la ruta lateral (pared izquierda) es transitable', insideWalk(out.portal.sideExitX, out.portal.sideZ), `(${out.portal.sideExitX}, ${out.portal.sideZ})`);
  check('esquina y acera frontal de la ruta oficial transitables', insideWalk(p.sideX, p.cornerZ) && insideWalk(p.sideX, -5.7) && insideWalk(2.4, p.frontZ), `(${p.sideX}, ${p.cornerZ}) → (${2.4}, ${p.frontZ})`);
  const zebra = out.walk.find((r) => r.z0 <= -11.6 + 1e-4 && r.z1 >= -7 - 1e-4);
  check('el paso de cebra conecta ambas aceras (único cruce)', !!zebra && zebra.x0 <= 10.8 && zebra.x1 >= 15.2, zebra ? `x ∈ [${zebra.x0}, ${zebra.x1}]` : 'ausente');
  check('cruzar por el paso atraviesa TODA la calzada', (() => {
    if (!zebra) return false;
    const xm = (zebra.x0 + zebra.x1) / 2;
    for (let z = -5.6; z >= -13.1; z -= 0.25) if (!insideWalk(xm, z)) return false;
    return true;
  })(), 'muestreo z de −5.6 a −13.1');
  check('cruzar FUERA del paso es imposible (jaywalk bloqueado)', !insideWalk(5, -9) && !insideWalk(20, -9), 'x=5 e x=20 sobre la calzada');
  check('parque de calistenia alcanzable', insideWalk(out.exercise.x, out.exercise.z), `(${out.exercise.x}, ${out.exercise.z})`);
  check('entrante del portal (fachada) transitable', insideWalk(2.4, out.portal.outFrontZ), `z=${out.portal.outFrontZ}`);
  // Vestíbulo: layout rect x 0.06..4.62, z local 0.06..2.62 (world z = frontZ + local)
  const portalLayout = content.layouts['layout_portal'];
  const vr = portalLayout?.rooms?.[0]?.rect;
  check('disparador de la PARED IZQUIERDA cae dentro del vestíbulo', !!vr && out.portal.wallInnerX > vr.x + v.margin * 0.5 && out.portal.wallInnerX < vr.x + vr.w, `x=${out.portal.wallInnerX}`);
  const sideLocalZ = out.portal.sideZ - frontZ;
  check('aterrizaje lateral mapea a z local del vestíbulo', !!vr && sideLocalZ > v.margin && sideLocalZ < vr.z + vr.d - v.margin, `local z=${sideLocalZ.toFixed(2)}`);
  check('disparador del FRENTE dentro del vestíbulo', !!vr && out.portal.frontInnerZ > vr.z && out.portal.frontInnerZ < vr.z + vr.d - v.margin, `local z=${out.portal.frontInnerZ}`);
  // Cortina: bandas ciegas DETRÁS del vidrio (nada coplanar)
  const fc = v.fachadaCortina;
  check('view.fachadaCortina declarado (bandas + paneles ciegos)', !!fc, fc ? `abajo ${fc.bottomBlind} · arriba ${fc.topBlind}` : 'ausente');
  if (fc) {
    const openH = v.cellH - v.slab * 2 - 0.18;
    check('las bandas ciegas NO tapan todo el nivel (queda franja de vidrio)', fc.bottomBlind > 0.1 && fc.topBlind > 0.1 && fc.bottomBlind + fc.topBlind < openH - 0.4, `franja ${Math.max(0.2, openH - fc.bottomBlind - fc.topBlind).toFixed(2)} m de ${openH.toFixed(2)}`);
    const railZ = v.roomZ - v.commonDepth / 2 - v.corridorDepth;
    const blindMin = railZ; // cara frontal de la banda (calado 0.08 hacia dentro)
    const frameMax = railZ - 0.06 + 0.09 / 2; // cara trasera de los montantes
    const glassZ = railZ - 0.045;
    check('bandas DETRÁS del vidrio y SIN solapar montantes (anti-coplanar)', frameMax < blindMin && glassZ < blindMin, `vidrio ${glassZ.toFixed(3)} · montante ≤ ${frameMax.toFixed(3)} · banda ≥ ${blindMin.toFixed(3)}`);
    check('paneles ciegos deterministas con el tono ventana del fondo', fc.panelChance > 0 && fc.panelChance < 0.6 && !!fc.panelColor && !!fc.bandColor, `${Math.round(fc.panelChance * 100)} % · ${fc.panelColor}`);
  }
}

console.log('── 3. Fuente: emoticonos sólidos + fusión de peatones ──');
const bubblesTs = srcOf('src/game/client/bubbles.ts');
check('dropBubble YA SE LLAMA en update (purga de fantasmas por residente ausente)', bubblesTs.includes('if (!world.residents[id]) dropBubble(id)'));
check('sin cámara activa → hideAll() (nada congelado en la última coordenada)', bubblesTs.includes('if (!cam) {\n        hideAll();\n        return;\n      }'));
check('bocadillo sin dueño visible > 1.2 s → nodo DOM destruido', bubblesTs.includes('noOwnerDropSeconds = 1.2') && bubblesTs.includes('b.lostT += dt'));
check('visibilidad DOM doble (opacity + visibility)', bubblesTs.includes("b.el.style.visibility = on ? 'visible' : 'hidden'"));
check('dropBubble limpia TODO el estado (transitorio, habla, cooldowns)', bubblesTs.includes('transient.delete(id)') && bubblesTs.includes('speech.delete(id)'));
const actorsTs = srcOf('src/game/client/actors.ts');
check('headOf exige nodo habilitado CON ancestros y NO desvanecido', actorsTs.includes('!a.node.isEnabled(true) || a.fade <= 0.04'));
check('setFade recuerda el fundido (fuente de verdad de visibilidad)', actorsTs.includes('a.fade = val'));
const logicTs = srcOf('src/game/player-logic.ts');
check('salida del portal por dirección (sin E): pared izquierda y frente', logicTs.includes('portalExitTriggers(input)') && logicTs.includes("input.left && this.x <= cfg.portal.wallInnerX") && logicTs.includes("input.down && this.z <= cfg.portal.frontInnerZ"));
check('entrada al portal por dirección (sin E): frente y lateral', logicTs.includes('enterPortal(true)') && logicTs.includes('enterPortal(false)'));
check('límites del plano de cámara en el movimiento exterior', logicTs.includes('Math.min(cfg.xMax, Math.max(cfg.xMin, this.x + dirX * step))'));
const ctrlTs = srcOf('src/game/client/controller.ts');
check('el jugador publica su punto como peatón (traffic.setExtraCrossers)', ctrlTs.includes('setExtraCrossers(pos.mode'));
check('cámara: portalOut → planta, portalIn → estancia', ctrlTs.includes("ar.type === 'portalOut'") && ctrlTs.includes("ar.type === 'portalIn'"));
check('líneas cómicas del jugador por bocadillo (sayOutdoorLine)', ctrlTs.includes('private sayOutdoorLine(kind'));
const buildingTs = srcOf('src/game/client/building.ts');
check('bandas ciegas pintadas en la cortina (fachada_ciega_abajo/arriba + paneles)', buildingTs.includes('fachada_ciega_abajo_') && buildingTs.includes('fachada_ciega_arriba_') && buildingTs.includes('fachada_ciega_panel_'));
const trafficTs = srcOf('src/game/client/traffic.ts');
check('tráfico fusiona la lista de crossers con el jugador', trafficTs.includes('const frameCrossers = extraCrossers.length > 0 ? crossers.concat(extraCrossers) : crossers;'));

console.log('── 4. Sim E2E: el jugador sale a la calle y vuelve ──');
const world = createWorld(content, content.rules.startScenario);
const logic = new PlayerLogic(world, content);
const STEP = 1 / 60;
const INPUT = (o: Partial<Input>): Input => ({ left: false, right: false, up: false, down: false, run: false, ...o });
const run = (frames: number, input: Input): void => {
  for (let i = 0; i < frames; i++) logic.update(STEP, input);
};
/** Camina en una dirección HASTA que se cumple la condición (o se agota el tope de frames). */
const walkUntil = (cond: () => boolean, input: Input, maxFrames: number): boolean => {
  for (let i = 0; i < maxFrames; i++) {
    logic.update(STEP, input);
    if (cond()) return true;
  }
  return false;
};
const drainHas = (type: string): boolean => logic.drainAuto().some((e) => e.type === type);

// a) Entrar al portal desde el pasillo (E: el vestíbulo sigue siendo puerta con aviso).
const portalBlk = Object.values(world.blocks).find((b) => b.defId === 'portal')!;
logic.x = (portalBlk.cell.col + portalBlk.size.w / 2) * v.cellW;
logic.z = v.corridorZ;
const entered = logic.interact();
check('E · entrar en el portal (el vestíbulo sigue pidiendo E desde el pasillo)', entered.type === 'entered' && logic.mode === 'inside' && logic.insideBlock === portalBlk.id, entered.type);

// b) SALIR SIN E por la PARED IZQUIERDA (ruta oficial del perímetro oeste).
let sawOut = false;
let posOut = logic.position();
let fadeAtOut = 1;
for (let i = 0; i < 400 && !sawOut; i++) {
  logic.update(STEP, INPUT({ left: true }));
  if (logic.isOutside()) {
    sawOut = true;
    posOut = logic.position();
    fadeAtOut = posOut.fade;
  }
}
logic.drainAuto();
check('salir por la pared izquierda SIN pulsar E (auto por dirección)', sawOut && logic.isOutside(), `mode=${logic.mode}`);
check('aterrizaje en la acera lateral (perímetro oeste)', Math.abs(posOut.x - out.portal.sideExitX) < 1e-6 && Math.abs(posOut.z - out.portal.sideZ) < 1e-6, `(${posOut.x.toFixed(2)}, ${posOut.z.toFixed(2)})`);
check('el cuerpo nace desvanecido al cruzar la pared', fadeAtOut < 0.3, `fade=${fadeAtOut.toFixed(2)}`);
run(60, INPUT({}));
check('el fundido termina en visible', logic.position().fade === 1, `fade=${logic.position().fade}`);
check('el sim NO se entera de la calle (teatro): location sigue en el portal', world.residents[world.playerId]!.location === portalBlk.id, world.residents[world.playerId]!.location ?? 'null');

// c) Bajar a la esquina por la acera lateral y caminar la frontal hasta el paso de cebra.
check('esquina frontal alcanzada por la acera lateral', walkUntil(() => logic.position().z <= -7 + 1e-6, INPUT({ down: true }), 300), `z=${logic.position().z.toFixed(2)}`);
check('acera frontal hasta el paso de cebra', walkUntil(() => logic.position().x >= 12.8, INPUT({ right: true }), 700), `x=${logic.position().x.toFixed(2)}`);

// d) CRUZAR por el paso de peatones (down = hacia la acera de enfrente; el único cruce legal).
const zStart = logic.position().z;
const crossed = walkUntil(() => logic.position().z <= -11.6 + 1e-6, INPUT({ down: true }), 900);
const posFar = logic.position();
check('cruce completo hasta la acera de enfrente', crossed, `z=${posFar.z.toFixed(2)} (desde ${zStart.toFixed(2)})`);
check('el cruce respetó el paso de cebra (x en banda)', posFar.x >= 10.2 && posFar.x <= 15.8, `x=${posFar.x.toFixed(2)}`);

// e) Jaywalking imposible fuera del paso.
logic.x = 5; logic.z = -5.7;
run(300, INPUT({ up: true }));
check('jaywalk bloqueado: sin paso de cebra no se pisa la calzada', logic.position().z >= -7 - 1e-3, `z=${logic.position().z.toFixed(3)}`);

// f) Banco exterior: sentarse a contemplar el edificio (y levantarse).
logic.setOutdoorSpots([{ x: 13, z: -12.7 }], null);
logic.x = 13; logic.z = -12.2;
let target = logic.interactTarget();
check('banco exterior detectado cerca', target?.kind === 'bench', target?.kind ?? 'nada');
const sit = logic.interact();
check('E · sentarse (pose y coordenadas del banco)', sit.type === 'sit' && logic.isSitting(), String(sit.type));
check('prompt = levantarse estando sentado', logic.interactTarget()?.kind === 'bench' && logic.isSitting(), '');
const stood = logic.interact();
check('E · levantarse', stood.type === 'stand' && !logic.isSitting(), String(stood.type));

// g) Calistenia en el parque de enfrente.
logic.setOutdoorSpots([], { x: out.exercise.x, z: out.exercise.z });
logic.x = out.exercise.x; logic.z = out.exercise.z;
target = logic.interactTarget();
check('punto de calistenia detectado', target?.kind === 'exercise', target?.kind ?? 'nada');
const ex = logic.interact();
check('E · hacer ejercicio (duración del catálogo)', ex.type === 'exerciseStart' && (ex as { seconds: number }).seconds >= out.exercise.secondsMin, String(ex.type));
run(60, INPUT({ up: true }));
check('ejercitando no te mueves (quieto en la barra)', Math.abs(logic.position().x - out.exercise.x) < 1e-6, '');
let ended = false;
for (let i = 0; i < 60 * 30 && !ended; i++) {
  logic.update(STEP, INPUT({}));
  ended = logic.drainAuto().some((e) => e.type === 'exerciseEnd');
}
check('el ejercicio termina solo (exerciseEnd)', ended, `${(60 * 30).toString()} frames de tope`);

// h) Volver: parque → paso de cebra → acera frontal → entrar por el FRENTE sin E.
check('vuelta a la acera frontal cruzando por el paso', walkUntil(() => logic.position().z >= -4.5, INPUT({ up: true }), 1200), `z=${logic.position().z.toFixed(2)}`);
check('regreso por la frontal hasta el entrante del portal', walkUntil(() => logic.position().x <= 2.45, INPUT({ left: true }), 900), `x=${logic.position().x.toFixed(2)}`);
let reentered = false;
for (let i = 0; i < 200 && !reentered; i++) {
  logic.update(STEP, INPUT({ up: true }));
  if (logic.mode === 'inside') reentered = true;
}
logic.drainAuto();
check('entrar por las correderas del frente SIN E', reentered && logic.mode === 'inside' && logic.insideBlock === portalBlk.id, `mode=${logic.mode}`);

// i) Salir por el FRENTE sin E (segunda puerta «real» del portal).
let outFront = false;
let zOut = 0;
for (let i = 0; i < 200 && !outFront; i++) {
  logic.update(STEP, INPUT({ down: true }));
  if (logic.isOutside()) {
    outFront = true;
    zOut = logic.position().z;
  }
}
logic.drainAuto();
check('salir por el frente SIN E (dirección correcta basta)', outFront && Math.abs(zOut - out.portal.outFrontZ) < 1e-6, `z=${zOut.toFixed(2)}`);

// j) Límites del plano de cámara: no se puede salir del cuadro lejano (en la acera frontal).
logic.z = -5.7;
logic.x = out.xMax - 0.2;
run(120, INPUT({ right: true }));
check('límite derecho del plano de cámara respetado', logic.position().x <= out.xMax + 1e-6, `x=${logic.position().x.toFixed(2)}`);
logic.x = out.xMin + 0.2;
run(120, INPUT({ left: true }));
check('límite izquierdo del plano de cámara respetado', logic.position().x >= out.xMin - 1e-6, `x=${logic.position().x.toFixed(2)}`);

console.log(`\nQA v1.42 — ${pass} ✓ / ${fail} ✗`);
process.exit(fail > 0 ? 1 : 0);
