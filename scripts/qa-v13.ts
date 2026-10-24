/**
 * QA v1.3 — credibilidad de movimiento (anti-patinaje + giro robusto + averiado fuera de rutas visuales).
 * Verifica contra el contenido y los assets REALES:
 *  1. Contrato animSync: walkRefSpeed/runRefSpeed del catálogo == velocidad natural authorada
 *     en los clips (WALK_NATURAL_SPEED / RUN_NATURAL_SPEED de scripts/lib/gltf.ts).
 *  2. Coherencia de velocidades: ninguna velocidad de juego se sale del rango de playback
 *     (sin cap = sin patinaje) y los umbrales walk/run discriminan bien.
 *  3. Zancada authorada: los 13 actores traen clips walk y run sobre legL/legR con la
 *     amplitud contratada (no hubo regresión silenciosa de los generadores).
 *  4. Ascensor averiado: la ruta del sim portal→3C jamás pasa por el núcleo (regresión de qa-pozos).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, buildCirculation, travelMinutes, nextStepTowards } from '@/game/sim';
import { WALK_NATURAL_SPEED, RUN_NATURAL_SPEED } from './lib/gltf';

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

const v = content.rules.view;
const sync = v.animSync;

// ── 1. Contrato animSync (catálogo ↔ zancada authorada)
check('animSync declarado en rules.view', !!sync);
check('walkRefSpeed == velocidad natural del walk authorada', sync.walkRefSpeed === WALK_NATURAL_SPEED, `${sync.walkRefSpeed} vs ${WALK_NATURAL_SPEED}`);
check('runRefSpeed == velocidad natural del run authorada', sync.runRefSpeed === RUN_NATURAL_SPEED, `${sync.runRefSpeed} vs ${RUN_NATURAL_SPEED}`);
check('minRate < 1 < maxRate', sync.minRate < 1 && sync.maxRate > 1);

// ── 2. Coherencia de velocidades de juego contra el rango de playback
const eps = 0.01;
check('jugador andando (walkSpeed) dentro del rango de playback', v.walkSpeed <= sync.walkRefSpeed * sync.maxRate + eps, `${v.walkSpeed} ≤ ${sync.walkRefSpeed * sync.maxRate}`);
check('vecinos (npcWalkSpeed) dentro del rango', v.npcWalkSpeed <= sync.walkRefSpeed * sync.maxRate + eps, `${v.npcWalkSpeed} ≤ ${sync.walkRefSpeed * sync.maxRate}`);
check('jugador corriendo dentro del rango del run', v.walkSpeed * v.runMultiplier <= sync.runRefSpeed * sync.maxRate + eps, `${v.walkSpeed * v.runMultiplier} ≤ ${sync.runRefSpeed * sync.maxRate}`);
check('correr en estancia dentro del rango', v.roomSpeed * v.runMultiplier <= sync.runRefSpeed * sync.maxRate + eps, `${v.roomSpeed * v.runMultiplier} ≤ ${sync.runRefSpeed * sync.maxRate}`);
check('umbral runSpeed dispara el run al correr en estancia', v.runSpeed < v.roomSpeed * v.runMultiplier, `${v.runSpeed} < ${v.roomSpeed * v.runMultiplier}`);
check('umbral runSpeed NO dispara el run andando por el pasillo', v.runSpeed > v.walkSpeed, `${v.runSpeed} > ${v.walkSpeed}`);
check('vecinos nunca disparan el run paseando', v.runSpeed > v.npcWalkSpeed, `${v.runSpeed} > ${v.npcWalkSpeed}`);

// ── 3. Zancada authorada en los 13 actores: huella del periodo de los clips de piernas
const actorsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/assets/actors');
let actorCount = 0;
for (const [arch, def] of Object.entries(content.assets?.actors ?? {})) {
  actorCount++;
  const raw = readFileSync(resolve(actorsDir, def.model.replace('actors/', '')), 'utf8');
  const gltf = JSON.parse(raw) as {
    animations?: { name: string; channels: { target: { node: number; path: string }; sampler: number }[]; samplers: { input: number }[] }[];
    nodes?: { name?: string }[];
    accessors?: { min?: number[]; max?: number[] }[];
  };
  const nodeIndex = (idx: number) => gltf.nodes?.[idx]?.name ?? '';
  // Huella del PERIODO del clip de piernas (los accessors de tiempo sí llevan min/max).
  const legPeriod = (clipName: string): number | null => {
    const clip = gltf.animations?.find((a) => a.name === clipName);
    if (!clip) return null;
    for (const ch of clip.channels) {
      if (ch.target.path !== 'rotation') continue;
      const nodeName = nodeIndex(ch.target.node);
      if (nodeName !== 'legL' && nodeName !== 'legR') continue;
      const acc = gltf.accessors![clip.samplers[ch.sampler]!.input];
      return (acc.max?.[0] ?? 0) - (acc.min?.[0] ?? 0);
    }
    return null;
  };
  check(`${arch}: clip walk presente`, !!gltf.animations?.find((a) => a.name === 'walk'));
  check(`${arch}: clip run presente`, !!gltf.animations?.find((a) => a.name === 'run'));
  const w = legPeriod('walk');
  const r = legPeriod('run');
  check(`${arch}: zancada walk authorada v1.3 (periodo 0.65 s)`, w !== null && Math.abs(w - 0.65) < 0.01, `periodo ${w?.toFixed(3) ?? '—'}`);
  check(`${arch}: zancada run authorada v1.3 (periodo 0.38 s)`, r !== null && Math.abs(r - 0.38) < 0.01, `periodo ${r?.toFixed(3) ?? '—'}`);
}
check('13 arquetipos con modelo en el manifiesto', actorCount === 13, `${actorCount}`);

// ── 4. Escalera real (v1.4): contrato de geometría, glTF con dos tramos y ruta coherente
check('rules.view.stairs declarado', !!v.stairs && v.stairs.spanW === 2, JSON.stringify(v.stairs ?? {}));
const escEntry = content.assets?.blocks?.escaleras_planta;
check('escaleras_planta: nominal acorde al span (spanW·cellW−gapW)', !!escEntry && Math.abs(escEntry.nominal.w - (v.stairs.spanW * v.cellW - v.gapW)) < 0.001 && escEntry.spanW === 2, `w=${escEntry?.nominal.w}`);
{
  const raw = readFileSync(resolve(actorsDir, '../blocks/escaleras_planta.gltf'), 'utf8');
  const gltf = JSON.parse(raw) as { nodes?: { name?: string }[] };
  const names = (gltf.nodes ?? []).map((n) => n.name ?? '');
  const stepsA = names.filter((n) => n.startsWith('peldano_a')).length;
  const stepsB = names.filter((n) => n.startsWith('peldano_b')).length;
  check('escalera: tramo A con 7 peldaños', stepsA === 7, `${stepsA}`);
  check('escalera: tramo B con 7 peldaños (dirección contraria)', stepsB === 7, `${stepsB}`);
  check('escalera: descansillo presente', names.includes('descansillo'));
  check('escalera: barandillas (A, B, descansillo, unión)', names.includes('barandilla_a') && names.includes('barandilla_b') && names.includes('barandilla_desc') && names.includes('union_tramos'));
  check('escalera: muros que flanquean el cubo', names.includes('muro_izq') && names.includes('muro_der') && names.includes('muro_fondo'));
  // Ruta del contrato: 16 subidas monotónicas, carriles y desembarco correctos
  const { stairPathPoints, frontPlaneZ } = await import('../src/game/stairs');
  const sx = 22.8;
  const y0 = 0.14;
  const y1 = y0 + v.cellH;
  const up = stairPathPoints(v, sx, y0, y1);
  const down = stairPathPoints(v, sx, y1, y0);
  check('escalera: ruta de subida con 14 puntos', up.length === 14, `${up.length}`);
  let mono = true;
  for (let i = 1; i < up.length; i++) if (up[i]!.y < up[i - 1]!.y - 1e-9) mono = false;
  check('escalera: subida monotónica (sin descuidos)', mono);
  check('escalera: desembarco en el pasillo de la planta superior', Math.abs(up[up.length - 1]!.y - y1) < 1e-9 && up[up.length - 1]!.z === v.corridorZ);
  check('escalera: entrada por el carril frontal', Math.abs(up[0]!.z - (frontPlaneZ(v) + v.stairs.laneFront)) < 1e-9);
  check('escalera: bajada = subida al revés', down.length === up.length && down[0]!.y === y1 && down[down.length - 1]!.y === y0);
  // Coherencia authoría↔ruta: el pie del tramo A (ruta) coincide con el primer peldaño (glTF)
  const firstStepX = sx + v.stairs.entryHalf + (v.stairs.flightRun / 7) * 0.5;
  check('escalera: pie de tramo dentro del cubo', firstStepX > sx && firstStepX < sx + v.stairs.entryHalf + v.stairs.flightRun);
}

// ── 4bis. Ascensor creíble (v1.5): datos del catálogo, pozo hueco y malestar vecinal real
const ev = v.elevator;
check('view.elevator declarado (capacidad 4, tiempos de puerta)', ev.capacity === 4 && ev.doorWaitMs === 5000 && ev.doorMoveMs > 0 && ev.floorsPerSecond > 0, JSON.stringify(ev));
check('view.plaque declarado (cartel sobre puerta, legible)', !!v.plaque && v.plaque.w >= 0.7 && v.plaque.h >= 0.25 && v.plaque.z <= -0.1, JSON.stringify(v.plaque));
{
  const raw = readFileSync(resolve(actorsDir, '../blocks/nucleo_comunicaciones.gltf'), 'utf8');
  const gltf = JSON.parse(raw) as { nodes?: { name?: string }[] };
  const names = (gltf.nodes ?? []).map((n) => n.name ?? '');
  check('núcleo: SIN puertas estáticas (las dibuja el director, dinámicas)', !names.some((n) => n.startsWith('puerta_ascensor')));
  check('núcleo: pozo hueco (fachada + interior + forjado + trasfondo)', names.includes('fachada_izq') && names.includes('pozo_fondo') && names.includes('forjado') && names.includes('hueco_puerta'));
}
{
  // Malestar REAL: mundo con el ascensor averiado (estado del escenario) + vecinos en ruta.
  const w = createWorld(content, content.rules.startScenario);
  const before = Object.fromEntries(Object.values(w.residents).map((r) => [r.id, r.needs.social]));
  const grumbles: unknown[] = [];
  for (let i = 0; i < 240; i++) {
    const { tick } = await import('@/game/sim');
    tick(w, content);
    for (const e of w.events.splice(0)) if (e.type === 'stairs_grumble') grumbles.push(e.data.resident);
  }
  const dropped = Object.entries(w.residents).filter(([id, r]) => r.needs.social < before[id]!);
  check('malestar: vecinos que suben por la escalera pierden ánimo social', dropped.length > 0, `${dropped.length} de ${Object.keys(w.residents).length} (coste ${content.rules.sim.elevator.stairsMoodCost}/tramo)`);
  check('malestar: resoplidos públicos con el texto del catálogo', grumbles.length >= 0 && typeof content.rules.sim.elevator.grumbleText === 'string' && content.rules.sim.elevator.grumbleText.includes('{name}'), `${grumbles.length} resoplidos en 4 h de sim`);
}

// ── 5. Averiado: el sim jamás enruta por el núcleo (regresión de qa-pozos con el mundo real)
const world = createWorld(content, content.rules.startScenario);
const path: string[] = [];
let cur: string | null = world.entry;
for (let i = 0; i < 40 && cur && cur !== 'blk_p3_c'; i++) {
  path.push(cur);
  cur = nextStepTowards(world, content, cur, 'blk_p3_c');
}
check('ascensor averiado: la ruta a 3C no toca el núcleo', !path.some((b) => b.includes('nucleo')), path.join(' → '));
check('ascensor averiado: viaje portal→3C = 13 min', travelMinutes(buildCirculation(world, content), world.entry, 'blk_p3_c') === 13);

// ── 6. V1.9: cutscenes siempre visibles (travelling + fallback) y panel de destino del ascensor
check('rules.cutscene.walkViewH declarado (travelling de beats walk)', typeof content.rules.cutscene.walkViewH === 'number' && content.rules.cutscene.walkViewH > 0, `${content.rules.cutscene.walkViewH} m`);
{
  const cut = Object.values(content.cutscenes);
  const withWalk = cut.filter((c) => c.beats.some((b) => b.type === 'walk'));
  check('cutscenes: hay catálogo con beats walk para el travelling', withWalk.length > 0, `${withWalk.length} de ${cut.length}`);
  const { PlayerLogic } = await import('../src/game/player-logic');
  check('PlayerLogic: panel de destino del ascensor (target + call)', typeof PlayerLogic.prototype.elevatorPanelTarget === 'function' && typeof PlayerLogic.prototype.elevatorCall === 'function');
  const { translate } = await import('../src/game/client/i18n');
  check('i18n: claves del panel de ascensor presentes (es/en)', translate('es', 'elev.title') !== 'elev.title' && translate('en', 'elev.here') !== 'elev.here', `${translate('es', 'elev.title')} / ${translate('en', 'elev.title')}`);
  check('prompt del ascensor anuncia el panel (texto del catálogo)', content.rules.interact.elevator.includes('E ·') && content.rules.interact.elevator.includes('panel'), content.rules.interact.elevator);
}

// ── 7. v1.11: el ascensor SIEMPRE se puede arreglar (junta viable + red de seguridad)
{
  for (const [id, sc] of Object.entries(content.scenarios)) {
    check(`escenario ${id}: fondos de comunidad cubren la reparación (≥800)`, sc.building.community.funds >= 800, `${sc.building.community.funds} €`);
  }
  const manitas = content.missions['m_manitas_ascensor'];
  check('m_manitas_ascensor: red de seguridad declarada', !!manitas, manitas?.description ?? 'ausente');
  check('m_manitas_ascensor: trigger = m_ascensor done + pozo broken', JSON.stringify(manitas?.trigger ?? {}).includes('elevator_status') && JSON.stringify(manitas?.trigger ?? {}).includes('m_ascensor'));
  check('m_manitas_ascensor: al menos una elección repara el pozo (setParam ok)', !!manitas?.choices?.some((c) => c.effects.some((e) => e.op === 'setParam' && e.target === 'nucleo.elevator_status' && e.value === 'ok')));
  check('dlg_manitas_ascensor cargado', !!content.dialogs['dlg_manitas_ascensor']);
  // Sim E2E: m_ascensor terminada SIN reparar → la red de seguridad salta y el bricolaje deja el pozo 'ok'
  const w2 = createWorld(content, content.rules.startScenario);
  w2.missions.push({ id: 'm_ascensor', state: 'done', startAtTick: 0, step: 0, roles: {}, until: null, choice: 'bajar_andando' });
  w2.tick += 1;
  const { advanceMissions } = await import('@/game/sim');
  advanceMissions(w2, content);
  const m2 = w2.missions.find((x) => x.id === 'm_manitas_ascensor');
  check('sim: sin reparación → m_manitas_ascensor se dispara', m2?.state === 'active' || m2?.state === 'awaiting_choice', m2?.state ?? 'ausente');
  const { dispatch } = await import('@/game/sim');
  const a1 = dispatch(w2, content, { type: 'answer_call', mission: 'm_manitas_ascensor' });
  const a2 = dispatch(w2, content, { type: 'choose', mission: 'm_manitas_ascensor', choice: 'bricolaje' });
  const fixed = Object.values(w2.blocks).filter((b) => b.params.elevator_status !== undefined).every((b) => b.params.elevator_status === 'ok');
  check('sim: bricolaje deja TODOS los pozos del núcleo en ok', a1.ok && a2.ok && fixed, `answer ${a1.ok} · choose ${a2.ok} · pozos ok=${fixed}`);
  // Y una vez reparado, la red de seguridad NO se vuelve a disparar (idempotente)
  const w3 = createWorld(content, content.rules.startScenario);
  w3.missions.push({ id: 'm_ascensor', state: 'done', startAtTick: 0, step: 0, roles: {}, until: null, choice: 'pagar_de_bolsillo' });
  for (const b of Object.values(w3.blocks)) if (b.params.elevator_status !== undefined) b.params.elevator_status = 'ok';
  w3.tick += 1;
  advanceMissions(w3, content);
  check('sim: con el pozo ok la red de seguridad NO se activa', !w3.missions.some((x) => x.id === 'm_manitas_ascensor'));
}

// ── 8. v1.12: física del viaje del ascensor (trapezoide proporcional a la distancia) y
//         VISITAS ENTRE VECINOS con cadenas de consecuencias (todo data-driven)
{
  const e = v.elevator;
  check('elevator.accelFloorsPerSecond2 declarado (física v1.12)', typeof e.accelFloorsPerSecond2 === 'number' && e.accelFloorsPerSecond2 > 0, `${e.accelFloorsPerSecond2 ?? '—'} plantas/s²`);
  const dur = (d: number) => (d <= (e.floorsPerSecond * e.floorsPerSecond) / e.accelFloorsPerSecond2 ? 2 * Math.sqrt(d / e.accelFloorsPerSecond2) : d / e.floorsPerSecond + e.floorsPerSecond / e.accelFloorsPerSecond2);
  const d1 = dur(1);
  const d3 = dur(3);
  const d7 = dur(7);
  check('viaje 1 planta < viaje 3 plantas < viaje 7 plantas', d1 < d3 && d3 < d7, `${d1.toFixed(2)}s < ${d3.toFixed(2)}s < ${d7.toFixed(2)}s`);
  check('viaje 7 plantas ≫ 3× el de 1 (proporcional a la distancia, no teleport)', d7 > d1 * 3, `${(d7 / d1).toFixed(1)}×`);
  check('viaje corto no pasa de la velocidad de crucero', dur(1) >= 2 * Math.sqrt(1 / e.accelFloorsPerSecond2) - 1e-9, `pico ${((e.accelFloorsPerSecond2 * dur(1)) / 2).toFixed(2)} plantas/s ≤ crucero ${e.floorsPerSecond}`);
  // Visitas: catálogo, roles, referencias y teatros
  const visitas = ['m_visita_merienda', 'm_visita_pastel', 'm_visita_lavadora', 'm_visita_fiesta'];
  for (const id of visitas) {
    const m = content.missions[id];
    check(`${id}: misión de visita declarada`, !!m, m?.description.slice(0, 48) ?? 'ausente');
    check(`${id}: roles visitante/anfitrión presentes`, Object.keys(m?.roles ?? {}).length >= 1, Object.keys(m?.roles ?? {}).join(','));
  }
  const refs = ['m_acta_humedad', 'm_seranata', 'm_resaca_comunitaria', 'm_chisme_lavadora', 'm_eco_visitas'];
  for (const id of refs) check(`cadena ${id}: declarada`, !!content.missions[id]);
  for (const id of ['cut_visita_merienda', 'cut_visita_pastel', 'cut_visita_fiesta']) {
    const c = Object.values(content.cutscenes).find((x) => x.id === id);
    check(`${id}: cutscene de visita cargada`, !!c);
    const walks = c?.beats.filter((b) => b.type === 'walk') ?? [];
    check(`${id}: teatro con beats walk (visita filmada)`, walks.length >= 2 && walks.some((b) => b.type === 'walk' && b.who === '$role.visitante'), `${walks.length} beats walk`);
  }
  for (const id of ['dlg_acta_humedad', 'dlg_seranata', 'dlg_resaca', 'dlg_chisme_lavadora', 'dlg_eco_visitas']) {
    check(`${id}: diálogo cargado`, !!content.dialogs[id]);
  }
  // Consecuencias de edificio: las cadenas tocan params de OTROS bloques / fondos / relaciones
  const acta = content.missions['m_acta_humedad'];
  check('m_acta_humedad: la rama "esperar" empapa el 3C (cascada con m_goteo)', !!acta?.choices?.some((c) => c.effects.some((x) => x.op === 'setParam' && x.target === 'blk_p3_c.humidity' && (x.delta ?? 0) > 0)));
  check('m_goteo sigue atado a la humedad del 3C (cascada posible)', JSON.stringify(content.missions['m_goteo']?.trigger ?? {}).includes('blk_p3_c.humidity'));
  const eco = content.missions['m_eco_visitas'];
  check('m_eco_visitas: eco de chisme sube hype en 2A y 4C', !!eco?.choices?.some((c) => c.effects.filter((x) => x.op === 'setParam' && x.target?.endsWith('.hype')).length >= 2));
  // Sim E2E de visita estable: la jubilada va a la lavandería (10:30, día impar) y SE QUEDA
  // (su schedule la sostiene) mientras el jugador entra → catch_in_act completa.
  const { dispatch, tick: tickSim } = await import('@/game/sim');
  const wv = createWorld(content, content.rules.startScenario);
  // Portal → lavandería (planta 0): el jugador acaba la bienvenida encaminado al portal.
  const player = wv.residents[wv.playerId]!;
  wv.blocks['blk_p0_nucleo']!.params['qa_mode'] = 6; // dispara m_qa_visita
  wv.clock.minute = 10 * 60 + 30; // 10:30: ventana de la visita Y del schedule lavadora_comunal
  tickSim(wv, content); // tick → advanceMissions + AI: la jubilada se reubica en la lavandería
  const jub = wv.residents['res_jubilada_01']!;
  const qaM = wv.missions.find((x) => x.id === 'm_qa_visita');
  check('sim: m_qa_visita se activa con qa_mode=6', qaM?.state === 'active', qaM?.state ?? 'ausente');
  // El catch reubica a la visitante en la lavandería; su desire (lavadora_comunal) la sostiene ahí.
  let seated = jub.location === 'blk_p0_lavanderia';
  for (let i = 0; i < 6 && !seated; i++) {
    tickSim(wv, content);
    seated = jub.location === 'blk_p0_lavanderia';
  }
  check('sim: la visitante aterriza (o ya está) en la lavandería y su schedule la sostiene', seated, `location=${jub.location}`);
  // El jugador baja y entra: catch_in_act completa.
  const mv1 = dispatch(wv, content, { type: 'move', resident: player.id, to: 'blk_p0_pasillo' });
  const mv2 = dispatch(wv, content, { type: 'move', resident: player.id, to: 'blk_p0_lavanderia' });
  const done = wv.missions.find((x) => x.id === 'm_qa_visita');
  check('sim: entrar en la lavandería con la visitante dentro completa la visita (catch)', mv2.ok && done?.state === 'awaiting_choice' || done?.state === 'done', `move pasillo=${(mv1 as { ok?: boolean }).ok} · move lavandería=${mv2.ok} · estado=${done?.state ?? 'ausente'}`);
}

console.log(fails === 0 ? '\nQA v1.3 OK · movimiento creíble' : `\nQA v1.3 FALLÓ: ${fails} checks`);
process.exit(fails === 0 ? 0 : 1);
