/**
 * QA v1.29 "el ascensor de verdad" — el reporte del vecino tras v1.28:
 *  1. POZO GRIS OSCURO: la pared del núcleo lleva el gris del zócalo (elevator.wallColor,
 *     fijado como fixedDiffuse sobre el arte glTF — el mismo mecanismo de la vivienda).
 *  2. ASCENSOR CON INTERIOR: hueco_puerta oculto (hideNodes del catálogo), cabina con
 *     paneles metálicos/suelo/plafón/pasamanos (texturas a canvas del catálogo) y luz
 *     propia (PointLight) — al abrirse las puertas SE VE el interior y se puede entrar.
 *  3. RUTAS FIELES: el trepe vertical solo existe dentro de un pozo real (actors.ts);
 *     fuera de un pozo, recolocación directa (nadie trepa por el aire hacia el ascensor).
 *  4. EMOTICONOS SOLO SI SE VE AL PERSONAJE: frustum (proyección dentro del encuadre) +
 *     oclusión por rayo cámara→cabeza con presupuesto por frame y TTL; las mallas de los
 *     actores nacen no-pickable (no roban bocadillos) y las puertas cerradas ocultan.
 *  5. AVISOS COMO POST-ITS: 7.5 s en pantalla y papel de color por tono (ToastStack).
 *  6. VIVIENDA = UN BLOQUE: sin tapas ni tabiques interiores (la pared divisoria que
 *     leía como dos bloques unidos ha desaparecido del código y del catálogo).
 *  7. PARALLAX COMPLETO: el diorama mapea TODAS las caras (fondo, laterales, techo y
 *     suelo) con shell() por vivienda; ≥10 variaciones por tipo de estancia
 *     (walls × floors × sets) y reparto de mobiliario SIN SOLAPES (spreadU).
 *  8. GLOW SUTIL: privacy.night bajo (dio/floor/lamp), las mallas interiores EXCLUIDAS
     del GlowLayer (material autoiluminado sin halo) y groundColor de rebote (ambient.ground).
 *  9. ESTRUCTURA: muros de vivienda a célula completa (hFull) + dintel trasero hasta el
 *     canto (adiós la banda negra sobre los interiores) + pared del diorama continua.
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
const assetsTs = srcOf('src/game/client/assets.ts');
const bubblesTs = srcOf('src/game/client/bubbles.ts');
const dioramaTs = srcOf('src/game/client/diorama.ts');
const elevatorTs = srcOf('src/game/client/elevator.ts');
const controllerTs = srcOf('src/game/client/controller.ts');
const storeTs = srcOf('src/game/client/store.ts');
const toastTs = srcOf('src/components/game/ToastStack.tsx');

console.log('── 1. Pozo del ascensor gris oscuro como el zócalo ──');
// v1.30: el vecino pidió unificar TODAS las paredes de pasillo al mismo gris (#dbd8d2,
// el de las viviendas) — el pozo incluye ese muro, así que cambia de #a3a19b a #dbd8d2.
check('elevator.wallColor en el catálogo', v.elevator.wallColor === '#dbd8d2', v.elevator.wallColor);
check('building fija el color sobre el arte glTF (fixedDiffuse del pozo)', buildingTs.includes('view.fixedDiffuse = Color3.FromHexString(v.elevator.wallColor)'));

console.log('── 2. Interior del ascensor (se ve y se entra) ──');
const evo = v.elevator as unknown as { hideNodes?: string[]; interior?: Record<string, unknown> };
check('hueco_puerta oculto por el catálogo', Array.isArray(evo.hideNodes) && evo.hideNodes.includes('hueco_puerta'), JSON.stringify(evo.hideNodes));
check('interior configurado (paneles/suelo/techo/luz/pasamanos)', !!evo.interior && typeof evo.interior.panelColor === 'string' && typeof evo.interior.lightRange === 'number');
check('cabina con textura de paneles a canvas', elevatorTs.includes('panelTex') && elevatorTs.includes('asc_panel_tex'));
check('suelo antideslizante con rombos', elevatorTs.includes('floorTex') && elevatorTs.includes('asc_suelo_tex'));
check('plafón autoiluminado + PointLight en la cabina', elevatorTs.includes('asc_cab_plafon') && elevatorTs.includes('PointLight'));
check('pasamanos en la pared del fondo', elevatorTs.includes('asc_cab_pasamanos'));

console.log('── 3. Rutas fieles a los datos reales ──');
check('el trepe vertical exige pozo bajo los pies (actors)', actorsTs.includes('if (!shaftHere) {'));
check('sin pozo: recolocación directa, sin escalera invisible', actorsTs.includes('node.y = w.y; // sin pozo bajo los pies'));

console.log('── 4. Emoticonos solo si la cámara ve al personaje ──');
check('frustum: fuera de encuadre = sin bocadillo', bubblesTs.includes('nx < -0.04 || nx > 1.04'));
check('oclusión por rayo con presupuesto por frame', bubblesTs.includes('rayBudgetPerFrame') && bubblesTs.includes('pickWithRay'));
check('TTL de la decisión de oclusión', bubblesTs.includes('occlusionTtlMs'));
check('los actores nacen no-pickable (no roban bocadillos)', assetsTs.includes('mesh.isPickable = false; // v1.29') || assetsTs.includes('for (const mesh of root.getChildMeshes(false)) mesh.isPickable = false;'));
check('las puertas cerradas ocultan (pickables para el rayo)', buildingTs.includes('view.door.isPickable = true') && buildingTs.includes('leaf.isPickable = true'));

console.log('── 5. Avisos como Post-its ──');
check('duración 7.5 s', storeTs.includes('7500'));
check('papel de color por tono (post-it)', toastTs.includes('#fef9a7') && toastTs.includes('#d4f0c0') && toastTs.includes('#fdd9e0'));
check('cinta adhesiva + esquinita doblada', toastTs.includes('Cinta adhesiva') && toastTs.includes('Esquina doblada'));

console.log('── 6. Vivienda = UN solo bloque (sin pared divisoria) ──');
check('sin tapas de estancia cerrada (código)', !buildingTs.includes('b.id}_tapa_'));
check('sin tapas en el InteriorView', !buildingTs.includes('covers:'));
check('el catálogo ya no trae coverArt', !JSON.stringify(Object.values(content.rules.view.privacy)).includes('coverArt'));

console.log('── 7. Parallax completo + ≥10 variaciones + sin solapes ──');
check('shell() del carcaso en el director', dioramaTs.includes('shell(') && dioramaTs.includes('dio_lateral_izq') && dioramaTs.includes('dio_techo'));
check('building llama al carcaso UNA vez por vivienda', buildingTs.includes('interior.dio.shell.push(...shellSurfs)'));
check('techo doble cara (visible desde abajo)', dioramaTs.includes('matC.backFaceCulling = false'));
check('laterales doble cara', dioramaTs.includes('matL.backFaceCulling = false') && dioramaTs.includes('matR.backFaceCulling = false'));
check('reparto sin solapes (spreadU determinista)', dioramaTs.includes('const spreadU') && dioramaTs.includes('holgura entre muebles'));
{
  const cat = content.interiors!;
  const counts: Record<string, number> = {};
  for (const [k, r] of Object.entries(cat.rooms)) {
    const walls = Math.max(1, r.walls.length || 1);
    const floors = Math.max(1, r.floors.length || 1);
    const sets = Math.max(1, r.sets.length || 1);
    counts[k] = walls * floors * sets;
  }
  for (const key of ['estancia_salon_cocina', 'estancia_dormitorio', 'estancia_bano']) {
    check(`≥10 variaciones de ${key}`, (counts[key] ?? 0) >= 10, `${counts[key]} (walls × floors × sets)`);
  }
  check('artes nuevos presentes en el disco (walls/floors/ceilings/sets)', (() => {
    const dir = path.join(import.meta.dir, '..', 'public', 'art', 'interiors', 'raw');
    const need = ['wall_salon_c.png', 'wall_salon_d.png', 'wall_salon_e.png', 'wall_dormitorio_c.png', 'wall_bano_b.png', 'side_wall_a.png', 'side_wall_b.png', 'ceiling_a.png', 'ceiling_b.png', 'floor_parket.png', 'floor_baldosa_b.png', 'f_sofa_b.png', 'f_cama_b.png', 'f_armario_b.png', 'f_estanteria_b.png', 'f_planta_b.png'];
    return need.every((f) => fs.existsSync(path.join(dir, f)));
  })());
}

console.log('── 8. Glow sutil en interiores + rebote ──');
check('night reducido (dio/floor/lamp por debajo de 1.0)', v.privacy.night.dioGlow <= 0.4 && v.privacy.night.floorGlow <= 0.35 && v.privacy.night.lampGlow <= 1.0, `dio ${v.privacy.night.dioGlow}, floor ${v.privacy.night.floorGlow}, lamp ${v.privacy.night.lampGlow}`);
check('wallSelf data-driven', typeof v.privacy.night.wallSelf === 'number' && v.privacy.night.wallSelf > 0);
check('glowExcluded() en building (dio + suelos)', buildingTs.includes('glowExcluded()') && buildingTs.includes('dio.shell'));
check('controller registra las exclusiones en la GlowLayer', controllerTs.includes('gl.addExcludedMesh'));
check('luz de rebote (ambient.ground)', !!v.ambient.ground && controllerTs.includes('hemi.groundColor'), String(v.ambient.ground));

console.log('── 9. Estructura anti-banda-negra ──');
check('muros de vivienda a célula completa (hFull)', buildingTs.includes('const hFull = v.cellH;'));
check('dintel trasero hasta el canto del bloque', buildingTs.includes('const doorTopY = bottom + v.slab + v.wall + doorH;'));
check('pared del diorama continua (sin hueco que enseña el fondo urbano)', !dioramaTs.includes('gap.a - origin.x0'));

console.log('── Sim intacto ──');
const world = createWorld(content, 'slice');
const snap0 = JSON.stringify({ c: world.clock, f: world.community.funds, t: world.tick, locs: Object.fromEntries(Object.values(world.residents).map((r) => [r.id, r.location])) });
for (let i = 0; i < 240; i++) tick(world, content);
const snap1 = JSON.stringify({ c: world.clock, f: world.community.funds, t: world.tick, locs: Object.fromEntries(Object.values(world.residents).map((r) => [r.id, r.location])) });
check('240 ticks viven', snap0 !== snap1);
const w2 = createWorld(content, 'slice');
for (let i = 0; i < 240; i++) tick(w2, content);
check('determinismo (240 ticks idénticos)', JSON.stringify({ c: w2.clock, t: w2.tick, f: w2.community.funds }) === JSON.stringify({ c: world.clock, t: world.tick, f: world.community.funds }));
check('regresión: circulación portal→3C sigue posible', travelMinutes(buildCirculation(world, content), 'blk_p0_portal', 'blk_p3_c') < 60);

console.log(`\nQA v1.29: ${pass} ✓ / ${fail} ✗`);
process.exit(fail > 0 ? 1 : 0);
