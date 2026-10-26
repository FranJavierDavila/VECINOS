// ⚠️ v1.27: el edificio se SIMPLIFICÓ a petición del vecino (3 plantas × 3 viviendas,
// sin trasteros_columna/bajocubierta y con la escalera en la col 8) — las aserciones
// estructurales de esta suite describían el edificio de 10×11 y quedaron OBsoletas.
// Los invariantes que siguen siendo ciertos (rutas, candado, plan abierto, determinismo)
// están cubiertos por qa-v127, qa-routing, qa-interior y qa-v126. Esta suite se retira
// con nota; si el edificio vuelve a crecer, se descomenta su cuerpo.
if (process.env.NO_GUARD !== '1') {
  console.log('↷ v1.27: suite estructural del edificio 10x11 retirada (edificio simplificado). Usa qa-v127 para los invariantes vivos.');
  process.exit(0);
}
/**
 * QA v1.16 — "Cierre del edificio": trasteros por planta, bajocubierta y tejado.
 * Verifica contra el contenido, el mundo y el sim REALES (patrón qa-v115/qa-pozos):
 *  1. Catálogo: rules.view.trasteros/roof/pots declarados y coherentes; 3 defs de bloque nuevos.
 *  2. Plantilla: el edificio crece — 4 plantas de trasteros (p8-p11), bajocubierta (p12) y
 *     tejado (p13); grid.floors ≥ 14; pozos (escalera/núcleo) encadenados hasta p12.
 *  3. Reparto de estanterías (regla del cliente, replicada aquí): 28 viviendas → la estantería
 *     k del nivel i pertenece a la vivienda k+i·8 del listado (planta, columna); 4 ranuras
 *     libres en el último nivel; todas las viviendas tienen una y solo una estantería.
 *  4. Circulación: desde cualquier vivienda se llega por el GRAFO a la planta de trasteros y a
 *     la bajocubierta (escalera con el ascensor averiado); el tejado p13 es inalcanzable a pie
 *     (isla de circulación — no hay forjado).
 *  5. Sim E2E: un vecino real camina (saltos contiguos legales) hasta la bajocubierta.
 *  6. Arte: los 3 glTF existen, parsean y sus nominales cuadran con assets.json.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, dispatch, nextStepTowards, buildCirculation, travelMinutes } from '@/game/sim';
import { storageUnitPlan } from '@/game/storage';

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

// ── 1. Catálogo (rules.view + defs de bloque) ──
const v = content.rules.view;
const tr = v.trasteros;
const roof = content.rules.view.roof;
const pots = content.rules.view.pots;
check('rules.view.trasteros declarado', !!tr && tr.shelvesPerLevel >= 1 && tr.tierH > 0 && tr.junk.length >= 3, tr ? `${tr.shelvesPerLevel}/nivel, ${tr.junk.length} colores de trasto` : 'ausente');
check('rules.view.roof declarado (pitch/overhang/colores)', !!roof && roof.pitchH > 0 && roof.overhang >= 0 && !!roof.color && !!roof.ridge, roof ? `pitch=${roof.pitchH}` : 'ausente');
check('rules.view.pots declarado (rango por planta)', !!pots && pots.perFloorMin >= 0 && pots.perFloorMax >= pots.perFloorMin && pots.potR > 0, pots ? `${pots.perFloorMin}..${pots.perFloorMax}/planta` : 'ausente');
for (const defId of ['trasteros_planta', 'bajocubierta', 'tejado']) {
  const def = content.blocks[defId];
  check(`def de bloque ${defId}`, !!def && def.layer === 'main' && def.size.w >= 9, def ? `w=${def.size.w} transitable=${def.traversable}` : 'ausente');
}
check('el tejado NO es transitable (cierra, no se pisa)', content.blocks['tejado']!.traversable === false, '');

// ── 2. Plantilla crecida ──
const tpl = Object.values(content.templates)[0]!;
check('grid.floors = 11 (0..10: trasteros + bajocubierta + tejado)', tpl.grid.floors === 11, `${tpl.grid.floors}`);
const world = createWorld(content, content.rules.startScenario);
const colTags = ['a', 'b', 'c', 'd'];
const storageIds = colTags.map((t) => `blk_p8_${t}`);
check('4 bloques de trasteros por COLUMNA (p8 a-d)', storageIds.every((id) => world.blocks[id]?.defId === v.trasteros.blockDefId), storageIds.join(','));
check('una sola planta de trasteros (nada en p9-p11)', Object.values(world.blocks).filter((b) => b.defId === v.trasteros.blockDefId).length === 4 && [9, 10, 11].every((f) => !Object.values(world.blocks).some((b) => b.cell.floor === f && b.defId === v.trasteros.blockDefId)), '');
check('bajocubierta p9 con instalaciones', world.blocks['blk_p9_bajocubierta']?.defId === 'bajocubierta', '');
check('tejado p10 cierra el edificio (w 11, cubre la torre de escalera)', world.blocks['blk_p10_tejado']?.size.w === 11, `w=${world.blocks['blk_p10_tejado']?.size.w}`);
const shaftFloors = (defId: string, col: number) =>
  Object.values(world.blocks)
    .filter((b) => b.defId === defId && b.cell.col === col)
    .map((b) => b.cell.floor)
    .sort((a, b) => a - b);
const escShaft = [...shaftFloors('escaleras_planta', 9), ...shaftFloors('escaleras_cota', 9)];
const nucShaft = shaftFloors('nucleo_comunicaciones', 4);
check('shaft de escalera encadenada 0..9 (cota especial arriba: sin tramos fantasma)', escShaft.length === 10 && escShaft[0] === 0 && escShaft[9] === 9, escShaft.join(','));
check('la cota solo vive en la planta alta (tramo especial, nada que suba al vacío)', shaftFloors('escaleras_cota', 9).length === 1 && shaftFloors('escaleras_cota', 9)[0] === 9, shaftFloors('escaleras_cota', 9).join(','));
check('el glTF de la cota existe y el catálogo lo declara', !!content.assets?.blocks?.escaleras_cota, content.assets?.blocks?.escaleras_cota?.model ?? 'ausente');
check('pozo del ascensor encadenado 0..9 (sirve trasteros y bajocubierta)', nucShaft.length === 10 && nucShaft[9] === 9, nucShaft.join(','));

// ── 3. Reparto de trasteros por COLUMNA (v1.18, la MISMA regla que building.ts/storage.ts) ──
const dwellings = Object.values(world.blocks)
  .filter((b) => b.kind === 'dwelling')
  .sort((a, b) => a.cell.floor - b.cell.floor || a.cell.col - b.cell.col);
const storeBlocks = Object.values(world.blocks).filter((b) => b.defId === v.trasteros.blockDefId);
let assigned = 0;
for (const store of storeBlocks) {
  const tag = store.id.slice(store.id.lastIndexOf('_') + 1);
  const colDwell = dwellings.filter((d) => d.id.endsWith(`_${tag}`));
  assigned += colDwell.length;
  const plan = storageUnitPlan(v, colDwell.map((d) => d.cell.floor));
  if (plan.length !== colDwell.length) { assigned = -1; break; }
}
check('cada vivienda tiene UN trastero en el bloque de su columna', assigned === dwellings.length, `${assigned}/${dwellings.length}`);
check('el bloque por columna sirve a TODAS las plantas de su letra (7 pisos → 7 trasteros)', storeBlocks.length === 4 && dwellings.length === 28, '4 columnas × 7 pisos');

// ── 4. Circulación (ascensor averiado por defecto del escenario) ──
const g = buildCirculation(world, content);
const fromHome = world.residents[world.playerId]!.home;
check('vivienda → bloque de trasteros p8 alcanzable', Number.isFinite(travelMinutes(g, fromHome, 'blk_p8_c')), `${travelMinutes(g, fromHome, 'blk_p8_c')} min`);
check('vivienda → bajocubierta p9 alcanzable (escalera, sin ascensor)', Number.isFinite(travelMinutes(g, fromHome, 'blk_p9_bajocubierta')), `${travelMinutes(g, fromHome, 'blk_p9_bajocubierta')} min`);
check('el tejado p10 NO es alcanzable a pie (isla de circulación)', travelMinutes(g, fromHome, 'blk_p10_tejado') === Infinity, `${travelMinutes(g, fromHome, 'blk_p10_tejado')}`);
const reach = (target: string) => {
  const resident = Object.values(world.residents).find((r) => r.home === fromHome)!;
  let cur = resident.location ?? resident.home;
  for (let i = 0; i < 40 && cur !== target; i++) {
    const nxt = nextStepTowards(world, content, cur, target);
    if (!nxt) return { cur, legal: false };
    const r = dispatch(world, content, { type: 'move', resident: resident.id, to: nxt });
    if (!r?.ok) return { cur, legal: false };
    cur = nxt;
  }
  return { cur, legal: cur === target };
};
const walk1 = reach('blk_p9_bajocubierta');
check('sim E2E: un vecino camina hasta la bajocubierta por saltos legales', walk1.legal, `termina en ${walk1.cur}`);
const walk2 = reach('blk_p8_c');
check('sim E2E: baja al bloque de trasteros p8 de su columna', walk2.legal, `termina en ${walk2.cur}`);

// ── 5. Arte glTF (nominales CONTRATO con assets.json) ──
const assetsDir = resolve(process.cwd(), 'public/assets');
const nominals: Record<string, { w: number; h: number; d: number }> = {
  'blocks/trasteros_planta.gltf': { w: 21.48, h: 2.46, d: 2.8 },
  'blocks/bajocubierta.gltf': { w: 21.48, h: 2.46, d: 2.8 },
  'blocks/tejado.gltf': { w: 26.28, h: 2.46, d: 3.5 },
};
for (const [model, nom] of Object.entries(nominals)) {
  const file = resolve(assetsDir, model);
  const okFile = existsSync(file);
  let okJson = false;
  let nodes = 0;
  if (okFile) {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { nodes: unknown[] };
    okJson = Array.isArray(parsed.nodes);
    nodes = parsed.nodes.length;
  }
  const entry = content.assets?.blocks?.[model.replace('blocks/', '').replace('.gltf', '')];
  check(`glTF ${model} en disco, parsea y nominal cuadra`, okFile && okJson && nodes > 0 && !!entry && entry.nominal.w === nom.w && entry.nominal.h === nom.h && entry.nominal.d === nom.d, `${nodes} nodos`);
}

console.log(fails === 0 ? '\nQA V16 OK' : `\nQA V16: ${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
