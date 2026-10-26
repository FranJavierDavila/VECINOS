/**
 * QA v1.27 "obra en fase ligera" — el reporte del vecino tras v1.26:
 *  1. Juntas anti-coplanaridad: gapFill con protrude+stagger (caras jamás compartidas) y
 *     relleno SALIENDO delante de la cara de fachada (nada de tapas al ras que parpadean).
 *  2. SOLERA en la base de los bloques: banda que sella la junta vertical entre bloques
 *     apilados (privacy.solera, data-driven).
 *  3. VENTANAL del cubo de escalera: banda de vidrio sill..head partida alrededor de la
 *     puerta, montantes DELANTE del plano del vidrio, muro trasero opcional, y el muro
 *     frontal cubre la célula COMPLETA (sin ranura de gapH entre cubos apilados).
 *  4. Texturas de puerta: UN solo vuelco (adiós «dos puertas pegadas») y ENCAJE PERFECTO
 *     (cover-fit a la proporción del plano: viviendas, escalera y mitades del ascensor).
 *  5. Macetas de pasillo con arte IA declarado (pots.art) + base HUNDIDA en la losa
 *     (toca el suelo, jamás vuela) + reescalado onTrim del quad.
 *  6. Placas más bajas (y 2.32 — «un poco más bajos para que se puedan leer»).
 *  7. EDIFICIO SIMPLIFICADO: plantilla edificio_3p_3v (cols 9, floors 5) — 3 plantas de
 *     viviendas con 3 viviendas por planta (a/b/c en cols 0/3/5), núcleo en col 2,
 *     escalera en col 8 (cota en la planta 3), tejado en la planta 4; sin filas de
 *     trasteros_columna ni bajocubierta. Escenarios con hogares remapeados (ningún
 *     residente sin vivienda) y vendor visits a plantas [0..3].
 *  8. Orientación DEFINITIVA: MODEL_YAW_OFFSET = π en actors (el único offset que alinea
 *     el morro con la marcha en TODAS las direcciones; el vaivén de piernas/brazos queda
 *     PARALELO al movimiento) — streetlife usa el mismo offset.
 *  + Sim intacto: 240 ticks deterministas tras tocar SOLO presentación/contenido.
 */
import fs from 'fs';
import path from 'path';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld } from '@/game/sim';
import { tick } from '@/game/sim/tick';
import { buildCirculation, travelMinutes } from '@/game/sim/graph';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, info = ''): void => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}${info ? ` — ${info}` : ''}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${info ? ` — ${info}` : ''}`);
  }
};

const PUB = path.join(import.meta.dir, '..', 'public');
const exists = (rel: string): boolean => fs.existsSync(path.join(PUB, rel.replace(/^\//, '')));
const srcOf = (rel: string): string => fs.readFileSync(path.join(import.meta.dir, '..', rel), 'utf8');

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}
const v = content.rules.view;
const buildingTs = srcOf('src/game/client/building.ts');
const actorsTs = srcOf('src/game/client/actors.ts');
const streetlifeTs = srcOf('src/game/client/streetlife.ts');
const elevatorTs = srcOf('src/game/client/elevator.ts');

console.log('── 1-2. Juntas anti-coplanaridad + solera ──');
check('gapFill.protrude/stagger en catálogo', typeof v.privacy.gapFill.protrude === 'number' && typeof v.privacy.gapFill.stagger === 'number', `protrude ${v.privacy.gapFill.protrude}, stagger ${v.privacy.gapFill.stagger}`);
check('solera declarada (color/h/protrude/stagger)', !!v.privacy.solera && v.privacy.solera.h > 0 && v.privacy.solera.protrude > 0);
check('junta: cara frontal delante de la fachada (frontZ − wall/2 − out)', buildingTs.includes('const zFront = frontZ - v.wall / 2 - out;'));
check('junta: escalonado por hash01', buildingTs.includes("hash01(`junta_p${floor}_${i}`, 41)"));
check('solera: banda construida con escalonado por hash01', buildingTs.includes('hash01(b.id, 43)'));
check('solera: cubre la ranura vertical (yBot = floor·cellH − gapH/2)', buildingTs.includes('const yBot = b.cell.floor * v.cellH - v.gapH / 2;'));
check('solera: tejado/bajocubierta sin solera (remates)', buildingTs.includes("if (b.defId === 'tejado' || b.defId === 'bajocubierta') continue; // remates: sin solera"));

console.log('── 3. Ventanal del cubo de escalera ──');
const wv = v.stairs.facade.window;
check('ventanal declarado (enabled/sill/head)', !!wv && wv.enabled && wv.head > wv.sill, `sill ${wv?.sill}, head ${wv?.head}`);
check('cubo: muro frontal a CÉLULA COMPLETA (hFull = cellH)', buildingTs.includes('const hFull = v.cellH;'));
check('vidrio partido alrededor de la puerta (3 paneles: izq/der/sobre hoja)', buildingTs.includes('glassPane(left, dL, ySill, yHead)') && buildingTs.includes('glassPane(dR, right, ySill, yHead)') && buildingTs.includes('glassPane(dL, dR, dTop, yHead)'));
check('montantes DELANTE del plano del vidrio (profundidad 0.06 en zF)', buildingTs.includes('yHead - ySill, 0.06'));
check('muro trasero del cubo (window.rear)', buildingTs.includes('fondo_cubo') && wv.rear === true);
check('vidrio del ventanal entra en la autoiluminación nocturna', buildingTs.includes('el vidrio brilla con la luz del cubo'));

console.log('── 4. Texturas de puerta: un vuelco + encaje perfecto ──');
check('doorLeafCanvas: recorte cover-fit a la proporción del plano', buildingTs.includes('const targetAr = outW / outH;') && buildingTs.includes('ctx.drawImage(big, cx, cy, Math.max(1, cw), Math.max(1, ch), 0, 0, outW, outH);'));
check('doorArtTex: canvas con proporción privacy.doorW/doorH', buildingTs.includes('const W = Math.round((H * pw) / ph);'));
check('stairDoorTex: canvas con proporción doorW/doorH del cubo', buildingTs.includes('const TH = Math.round((TW * stF.doorW) / stF.doorH);'));
check('ascensor: mitad re-encajada a su caja (sin 15% de compresión)', elevatorTs.includes('const TW = Math.round((768 * 0.56) / 1.94);'));
check('puertas full-bleed nuevas en disco', exists('/art/interiors/raw/door_casa_a.png') && exists('/art/interiors/raw/door_comunal.png'));

console.log('── 5. Macetas de pasillo ──');
check('arte IA declarado en catálogo', (v.pots.art ?? []).length >= 2 && (v.pots.art ?? []).every((a) => exists(a)), (v.pots.art ?? []).join(' '));
check('macetas más grandes (artH ≥ 0.85)', v.pots.artH >= 0.85, `artH ${v.pots.artH}`);
check('base HUNDIDA 3 cm (la maceta toca la losa)', buildingTs.includes('q.position.set(x, ySlab + h / 2 - 0.03, z);'));
check('reescalado onTrim del quad (aspect real del arte)', buildingTs.includes('art.onTrim.push((nar) =>'));
check('recorte alpha en runtime (stripCorners + alphaBounds + dataURL)', buildingTs.includes('entry0.dt.updateURL(out.toDataURL'));

console.log('── 6. Placas más bajas ──');
check('placa y = 2.32 (antes 2.55)', v.plaque.y === 2.32, `y ${v.plaque.y}`);

console.log('── 7. Edificio simplificado 3 plantas × 3 viviendas ──');
const templates = JSON.parse(fs.readFileSync(path.join(PUB, 'content/templates.json'), 'utf8')) as { id: string; grid: { cols: number; floors: number }; rows: { floors: [number, number]; blocks: { col: number; defId: string; tag: string }[] }[] }[];
const tpl = templates.find((t) => t.id === 'edificio_3p_3v');
check('plantilla edificio_3p_3v existe', !!tpl);
if (tpl) {
  check('grid cols 9 × floors 5', tpl.grid.cols === 9 && tpl.grid.floors === 5, JSON.stringify(tpl.grid));
  const viviendasRow = tpl.rows.find((r) => r.blocks.some((b) => b.defId === 'vivienda_estandar'));
  check('3 viviendas por planta (cols 0/3/5)', !!viviendasRow && viviendasRow.blocks.filter((b) => b.defId === 'vivienda_estandar').length === 3 && viviendasRow.floors[0] === 1 && viviendasRow.floors[1] === 3);
  const stairsRows = tpl.rows.filter((r) => r.blocks.some((b) => b.defId === 'escaleras_planta' || b.defId === 'escaleras_cota'));
  const planta = stairsRows.find((r) => r.blocks.some((b) => b.defId === 'escaleras_planta'));
  const cota = stairsRows.find((r) => r.blocks.some((b) => b.defId === 'escaleras_cota'));
  check('escaleras_planta plantas 0..2 y escaleras_cota en la 3 (sin duplicar)', !!planta && planta.floors[0] === 0 && planta.floors[1] === 2 && !!cota && cota.floors[0] === 3 && cota.floors[1] === 3);
  check('núcleo llega a la planta 3', tpl.rows.some((r) => r.blocks.some((b) => b.defId === 'nucleo_comunicaciones') && r.floors[1] === 3));
  check('tejado en la planta 4', tpl.rows.some((r) => r.blocks.some((b) => b.defId === 'tejado') && r.floors[0] === 4));
  check('sin trasteros_columna ni bajocubierta', !tpl.rows.some((r) => r.blocks.some((b) => b.defId === 'trasteros_columna' || b.defId === 'bajocubierta')));
}
const blocks = JSON.parse(fs.readFileSync(path.join(PUB, 'content/blocks.json'), 'utf8')) as { id: string; size: { w: number } }[];
const defOf = (id: string): { size: { w: number } } | undefined => blocks.find((b) => b.id === id);
check('pasillo_planta w=9', defOf('pasillo_planta')?.size.w === 9);
check('tejado w=10', defOf('tejado')?.size.w === 10);
check('lavanderia_comunal w=1 (cabe en la cruja con la escalera)', defOf('lavanderia_comunal')?.size.w === 1);

const scenarios = JSON.parse(fs.readFileSync(path.join(PUB, 'content/scenarios.json'), 'utf8')) as { id: string; building: { template: string }; residents: { id: string; home: string }[]; player: { homeCandidates: string[] } }[];
for (const s of scenarios) {
  check(`scenario ${s.id} → edificio_3p_3v`, s.building.template === 'edificio_3p_3v');
}

const world = createWorld(content, 'slice');
const viviendas = Object.values(world.blocks).filter((b) => b.kind === 'dwelling');
check('9 viviendas (3 plantas × 3)', viviendas.length === 9, viviendas.map((b) => b.id).sort().join(' '));
const sinHogar = Object.values(world.residents).filter((r) => !world.blocks[r.home]);
check('ningún residente sin vivienda válida', sinHogar.length === 0, sinHogar.map((r) => `${r.id}→${r.home}`).join(', '));
const candOk = (content, worldRef) => true; // placeholder no usado
check('homeCandidates blk_p3_c existe y queda libre para el jugador', !!world.blocks['blk_p3_c'] && world.residents[world.playerId].home === 'blk_p3_c');
const g = buildCirculation(world, content);
check('circulación portal→3C posible (escalera/ascensor)', travelMinutes(g, 'blk_p0_portal', 'blk_p3_c') < 60, `${travelMinutes(g, 'blk_p0_portal', 'blk_p3_c')} min`);
// sin referencias huérfanas a bloques antiguos en contenido activo
const activeJson = ['missions.json', 'cutscenes.json', 'ecosystem.json', 'rules.json', 'scenarios.json']
  .map((f) => fs.readFileSync(path.join(PUB, 'content', f), 'utf8'))
  .join('\n');
check('sin referencias a bloques retirados (p4/p5/p3_d)', !/blk_p[45]_[a-z]+|blk_p3_d|blk_p4_pasillo/.test(activeJson));

console.log('── 8. Orientación definitiva (offset π) ──');
check('MODEL_YAW_OFFSET = Math.PI en actors.ts', actorsTs.includes('export const MODEL_YAW_OFFSET = Math.PI;'));
check('streetlife marcha usa el MISMO offset', streetlifeTs.includes('rig.root.rotation.y = dir > 0 ? MODEL_YAW_OFFSET : 0;'));
check('pedestrians usa el offset compartido', srcOf('src/game/client/pedestrians.ts').includes('MODEL_YAW_OFFSET'));

console.log('── Sim intacto ──');
const snap0 = JSON.stringify({ c: world.clock, f: world.community.funds, t: world.tick, locs: Object.fromEntries(Object.values(world.residents).map((r) => [r.id, r.location])) });
for (let i = 0; i < 240; i++) tick(world, content);
const snap1 = JSON.stringify({ c: world.clock, f: world.community.funds, t: world.tick, locs: Object.fromEntries(Object.values(world.residents).map((r) => [r.id, r.location])) });
check('240 ticks viven', snap0 !== snap1);
const w2 = createWorld(content, 'slice');
for (let i = 0; i < 240; i++) tick(w2, content);
check('determinismo (240 ticks idénticos)', JSON.stringify({ c: w2.clock, t: w2.tick, f: w2.community.funds }) === JSON.stringify({ c: world.clock, t: world.tick, f: world.community.funds }));

console.log(`\nQA v1.27: ${pass} ✓ / ${fail} ✗`);
process.exit(fail > 0 ? 1 : 0);
