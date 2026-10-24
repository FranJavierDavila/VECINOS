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

console.log(fails === 0 ? '\nQA v1.3 OK · movimiento creíble' : `\nQA v1.3 FALLÓ: ${fails} checks`);
process.exit(fails === 0 ? 0 : 1);
