/**
 * QA rutas blindadas (v1.14) — LEY DEL PASILLO en horizontalLegs() (@/game/routing).
 * El usuario cazó al vecino del 2B "atravesar para entrar en su casa por la vivienda 2C
 * y por el ascensor": la ruta antigua iba en diagonal del pozo a la puerta, cortando la
 * banda de viviendas. Este QA demuestra sobre el contenido y el mundo REALES que:
 *  1. Ningún segmento de ruta cruza la banda de bloques en horizontal (el avance en X
 *     ocurre solo sobre la línea del pasillo z = corridorZ).
 *  2. Todo cambio de z dentro de la banda ocurre en la x del bloque propio (destino u
 *     host del que se sale) — jamás dentro del span de un bloque ajeno.
 *  3. El caso exacto del reporte (escalera col 9 → interior de una vivienda al otro lado
 *     del edificio) no pisa ni la vivienda intermedia ni el núcleo del ascensor.
 *  4. Salir de una vivienda ajena (sim saltó de bloque) sale por la puerta del bloque
 *     bajo los pies, luego pasillo, luego entra por la puerta del destino.
 *  5. Rutas interiores (misma vivienda) no salen del span y respetan la deduplicación.
 * Las pruebas con interior usan la vivienda del JUGADOR (desbloqueada, con estancias
 * abiertas); la geometría es idéntica en todas las plantas.
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld } from '@/game/sim';
import { layoutGeometryOf, interiorTarget } from '@/game/interior';
import { horizontalLegs, type RouteLegXZ, type HostSpan, type DestInside } from '@/game/routing';

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
const FRONT = v.roomZ - v.commonDepth / 2;
const CORR = v.corridorZ;
const world = createWorld(content, 'slice');

/** Spans reales (x0, w) de los bloques main de una planta. */
const spansOf = (floor: number): { label: string; x0: number; w: number; kind: string }[] =>
  Object.values(world.blocks)
    .filter((b) => b.cell.floor === floor && b.layer === 'main')
    .map((b) => ({ label: b.id, x0: b.cell.col * v.cellW, w: b.size.w * v.cellW, kind: b.kind }))
    .sort((a, b) => a.x0 - b.x0);

const spanOf = (floor: number, pred: (label: string) => boolean): { label: string; x0: number; w: number } => {
  const s = spansOf(floor).find((s) => pred(s.label));
  if (!s) throw new Error(`span no encontrado en planta ${floor}`);
  return s;
};

const blockAt = (floor: number, col: number): string => {
  const b = Object.values(world.blocks).find((b) => b.cell.floor === floor && b.cell.col === col && b.layer === 'main');
  if (!b) throw new Error(`bloque no encontrado p${floor} col${col}`);
  return b.id;
};

const P = 3; // planta del jugador: su vivienda (3C) está desbloqueada y con estancias abiertas
const A3 = blockAt(P, 0);
const B3 = blockAt(P, 2);
const NUC3 = blockAt(P, 4);
const C3 = blockAt(P, 5); // vivienda del jugador (col 5): mismo lado "lejano" que el 2C del reporte
const D3 = blockAt(P, 7);
const STAIR3 = blockAt(P, 9);

const spanB = spanOf(P, (l) => l === B3);
const spanC = spanOf(P, (l) => l === C3);
const spanNuc = spanOf(P, (l) => l === NUC3);
const spanStair = spanOf(P, (l) => l === STAIR3);
const spanPlayer = spanC; // la vivienda del jugador ES la "C" de su planta

const geoOf = (blockId: string) => layoutGeometryOf(content, world.blocks[blockId]!);
const insideOf = (blockId: string): DestInside => {
  const geo = geoOf(blockId);
  if (!geo) throw new Error(`${blockId} sin geometría`);
  const target = interiorTarget(content, geo, undefined, 'res_qa_rutas', 3);
  if (!target) throw new Error(`${blockId} sin objetivo interior`);
  const s = spanOf(P, (l) => l === blockId);
  return { x0: s.x0, w: s.w, geo, target };
};

const shaftXOf = (s: { x0: number; w: number }): number => s.x0 + s.w / 2;

/**
 * Invariante de segmentos: entre waypoints consecutivos el actor anda RECTO.
 *  - Tramo con Δx: debe ser puro pasillo (|z − CORR| < 0.02) — jamás dentro de la banda.
 *  - Tramo con Δz: la x fija debe caer dentro del span del destino o del host (su puerta).
 *  - Todo waypoint en banda (z > FRONT) debe estar en span de destino o host.
 */
function assertLaw(
  name: string,
  legs: RouteLegXZ[],
  from: { x: number; z: number },
  allowed: { x0: number; w: number }[],
): void {
  let ok = true;
  const bad: string[] = [];
  const pts: { x: number; z: number }[] = [from, ...legs];
  const inAllowed = (x: number): boolean => allowed.some((s) => x >= s.x0 - 0.01 && x <= s.x0 + s.w + 0.01);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = Math.abs(b.x - a.x);
    const dz = Math.abs(b.z - a.z);
    // Tramo INTERIOR de la vivienda destino (ambos extremos en banda y en span): la garantía
    // de tabiques la da interiorRoute (estancias convexas + huecos); la ley estricta del
    // pasillo solo gobierna lo que toca el exterior.
    const bothInterior = a.z > FRONT + 0.02 && b.z > FRONT + 0.02 && inAllowed(a.x) && inAllowed(b.x);
    if (!bothInterior) {
      if (dx > 0.02 && dz > 0.02) {
        // diagonal: solo tolerable si AMBOS extremos están fuera de banda (pasillo puro con jitter)
        if (a.z > FRONT + 0.02 || b.z > FRONT + 0.02) {
          ok = false;
          bad.push(`diag(${a.x.toFixed(2)},${a.z.toFixed(2)}→${b.x.toFixed(2)},${b.z.toFixed(2)})`);
        }
      }
      if (dx > 0.02 && (Math.abs(a.z - CORR) > 0.02 || Math.abs(b.z - CORR) > 0.02)) {
        ok = false;
        bad.push(`x-fuera-pasillo(${a.x.toFixed(2)},${a.z.toFixed(2)}→${b.x.toFixed(2)},${b.z.toFixed(2)})`);
      }
    }
    if (dz > 0.02 && !inAllowed(a.x)) {
      ok = false;
      bad.push(`z-fuera-span(${a.x.toFixed(2)},${a.z.toFixed(2)}→${b.x.toFixed(2)},${b.z.toFixed(2)})`);
    }
  }
  for (const p of legs) {
    if (p.z > FRONT + 0.02 && !inAllowed(p.x)) {
      ok = false;
      bad.push(`punto-en-banda-ajena(${p.x.toFixed(2)},${p.z.toFixed(2)})`);
    }
  }
  check(name, ok, ok ? '' : bad.join(' | '));
}

// ── 0. Mapa real del mundo (el QA se apoya en spans REALES, no en supuestos)
check('planta 3 trae 4 viviendas + núcleo + escalera', spansOf(P).length === 6, spansOf(P).map((s) => s.label).join(','));
check('el pasillo está delante del plano frontal (ley geométrica)', CORR < FRONT, `corridorZ ${CORR} < frontZ ${FRONT}`);

// ── 1. EL CASO DEL REPORTE: escalera (col 9) → interior de la vivienda C (lado opuesto)
{
  const dest = insideOf(C3);
  const from = { x: shaftXOf(spanStair), z: CORR };
  const legs = horizontalLegs({ view: v, from, dest: { x: spanPlayer.x0 + spanPlayer.w / 2, z: FRONT + 0.6 }, destInside: dest, hostSpan: null });
  assertLaw('reporte C: escalera→casa cumple la ley del pasillo', legs, from, [spanPlayer, spanStair]);
  const crosses = legs.some(
    (l) =>
      l.z > FRONT + 0.02 &&
      ((l.x >= spanB.x0 && l.x <= spanB.x0 + spanB.w) || (l.x >= spanNuc.x0 && l.x <= spanNuc.x0 + spanNuc.w) || (l.x >= spanOf(P, (l) => l === A3).x0 && l.x <= spanOf(P, (l) => l === A3).x0 + spanOf(P, (l) => l === A3).w)),
  );
  check('reporte C: NINGÚN punto en banda cae en A, B ni el núcleo', !crosses);
  const last = legs[legs.length - 1]!;
  check('reporte C: la ruta termina dentro del span de la vivienda destino', last.x >= spanPlayer.x0 && last.x <= spanPlayer.x0 + spanPlayer.w);
  check('reporte C: hay tramo de pasillo puro (recorrido visible entero)', legs.some((l) => Math.abs(l.z - CORR) < 0.02));
}

// ── 2. Desde DENTRO de la vivienda B (ajena) hasta el interior de la C: puerta propia → pasillo → puerta destino
{
  const dest = insideOf(C3);
  const hostB: HostSpan = { x0: spanB.x0, w: spanB.w };
  const from = { x: spanB.x0 + 1.3, z: FRONT + 1.2 };
  const legs = horizontalLegs({ view: v, from, dest: { x: spanPlayer.x0 + spanPlayer.w / 2, z: FRONT + 0.6 }, destInside: dest, hostSpan: hostB });
  assertLaw('B→C: salida por puerta propia + pasillo + entrada por puerta destino', legs, from, [spanPlayer, spanB]);
  const firstTwo = legs.slice(0, 2);
  check('B→C: las dos primeras legs salen EN la x de B', firstTwo.length === 2 && firstTwo.every((l) => l.x >= spanB.x0 && l.x <= spanB.x0 + spanB.w));
  check('B→C: hay tramo de pasillo puro entre ambas puertas', legs.filter((l) => Math.abs(l.z - CORR) < 0.02).length >= 1);
}

// ── 3. Del interior de la C al POZO (núcleo): salida por su puerta y pasillo, sin banda
{
  const hostC: HostSpan = { x0: spanPlayer.x0, w: spanPlayer.w };
  const from = { x: spanPlayer.x0 + 1.1, z: FRONT + 0.9 };
  const legs = horizontalLegs({ view: v, from, dest: { x: shaftXOf(spanNuc), z: CORR }, destInside: null, hostSpan: hostC });
  assertLaw('C→núcleo: sin atravesar banda', legs, from, [spanPlayer, spanNuc]);
  check('C→núcleo: termina en la línea del pasillo bajo el pozo', legs.length >= 1 && Math.abs(legs[legs.length - 1]!.z - CORR) < 0.02 && Math.abs(legs[legs.length - 1]!.x - shaftXOf(spanNuc)) < 0.02);
}

// ── 4. Interior de la MISMA vivienda: sin salir, ruta por huecos del catálogo
{
  const dest = insideOf(C3);
  const from = { x: spanPlayer.x0 + 0.6, z: FRONT + 0.7 };
  const legs = horizontalLegs({ view: v, from, dest: { x: spanPlayer.x0 + dest.target.x, z: FRONT + dest.target.z }, destInside: dest, hostSpan: null });
  assertLaw('misma vivienda: ruta interior legal', legs, from, [spanPlayer]);
  check('misma vivienda: no sale al pasillo para moverse dentro', !legs.some((l) => Math.abs(l.z - CORR) < 0.02));
}

// ── 5. Pasillo → común (lavandería planta 0): todo sobre la línea del pasillo
{
  const lav = Object.values(world.blocks).find((b) => b.defId === 'lavanderia_comunal');
  if (lav) {
    const from = { x: 1.2, z: CORR };
    const dest = { x: (lav.cell.col + lav.size.w / 2) * v.cellW, z: CORR };
    const legs = horizontalLegs({ view: v, from, dest, destInside: null, hostSpan: null });
    check('pasillo→lavandería: una sola leg sobre la línea del pasillo', legs.length <= 1 && legs.every((l) => Math.abs(l.z - CORR) < 0.02));
  } else {
    check('pasillo→lavandería: la lavandería existe en el mundo', false);
  }
}

// ── 6. Desde el pozo (salida de ascensor) → interior de la C: la ruta no retrocede a banda ajena
{
  const dest = insideOf(C3);
  const from = { x: shaftXOf(spanNuc), z: CORR };
  const legs = horizontalLegs({ view: v, from, dest: { x: spanPlayer.x0 + spanPlayer.w / 2, z: FRONT + 0.6 }, destInside: dest, hostSpan: null });
  assertLaw('núcleo→C: salida del ascensor a casa por el pasillo', legs, from, [spanPlayer, spanNuc]);
  const crosses = legs.some((l) => l.z > FRONT + 0.02 && l.x >= spanB.x0 && l.x <= spanB.x0 + spanB.w);
  check('núcleo→C: sin pisar la vivienda B', !crosses);
}

// ── 7. Deduplicación y destino ya alcanzado
{
  const legs = horizontalLegs({ view: v, from: { x: 5.0, z: CORR }, dest: { x: 5.0, z: CORR }, destInside: null, hostSpan: null });
  check('dedupe: destino ya alcanzado → cero legs', legs.length === 0);
  const legs2 = horizontalLegs({ view: v, from: { x: 5.0, z: CORR }, dest: { x: 9.0, z: CORR }, destInside: null, hostSpan: null });
  check('dedupe: una sola leg limpia', legs2.length === 1 && Math.abs(legs2[0]!.x - 9) < 0.001);
}

// ── 8. Vivienda SIN layout (destInside null): pasillo y salto final en su x
{
  const from = { x: 22.0, z: CORR };
  const legs = horizontalLegs({ view: v, from, dest: { x: spanPlayer.x0 + 1.2, z: FRONT + 0.6 }, destInside: null, hostSpan: null });
  assertLaw('sin layout: pasillo + salto final en x del destino', legs, from, [spanPlayer]);
}

console.log(fails === 0 ? '\nQA rutas blindadas OK · la ley del pasillo se cumple' : `\nQA rutas blindadas FALLÓ (${fails})`);
process.exit(fails === 0 ? 0 : 1);
