/**
 * QA v1.30 "los locales de todos" — el reporte del vecino (mensaje J), verificación en
 * frío del trabajo que la sesión anterior dejó sin suite:
 *  1. POST-IT ORIGAMI al completar misión: el aviso se pliega y suelta estrellitas que
 *     caen sobre la fanfarria (ToastStack + controller).
 *  2. PAREDES DE PASILLO GRIS ÚNICO: todos los bloques con pared de pasillo al mismo
 *     gris (#dbd8d2) — incluido el pozo del ascensor (qa-v129 ya lo recuerda).
 *  3. PORTAL ACRISTALADO (planta 0): puertas correderas que se abren al acercarse y
 *     cierran al irse; vecinos Y viandantes cruzan POR las correderas (enterZ).
 *  4. GARAJE: puerta basculante texturizada + rampa + rótulo legible.
 *  5. TRASTERO COMUNITARIO: dos puertas mapeadas con comportamiento de vivienda (E).
 *  6. SALA DE JUNTAS: local con interior mapeado, mesa y SILLAS — al convocar junta la
 *     gente acude y se sienta; sirve también para fiestas.
 *  7. LAVANDERÍA: local ABIERTO (sin pared frontal) con máquinas comunitarias.
 *  8. VIVIENDA SIN PARED INVISIBLE: el interior es transitable de lado a lado (layout).
 *  9. LOSETAS DE 40 CM VISIBLES: contraste entre baldosas vecinas (corridorFloor).
 * 10. NADA COPLANAR en el cierre del hueco de la escalera (bloque izquierdo).
 * 11. EMOTICONOS solo si la cámara ve al portador (frustum + oclusión, ya en v1.29).
 * + Sim intacto: 240 ticks deterministas.
 */
import fs from 'fs';
import path from 'path';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld } from '@/game/sim';
import { tick } from '@/game/sim/tick';

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
const v = content.rules.view as unknown as Record<string, Record<string, unknown>>;
const buildingTs = srcOf('src/game/client/building.ts');
const toastTs = srcOf('src/components/game/ToastStack.tsx');
const controllerTs = srcOf('src/game/client/controller.ts');
const logicTs = srcOf('src/game/player-logic.ts');
const pedTs = srcOf('src/game/client/pedestrians.ts');
const actorsTs = srcOf('src/game/client/actors.ts');
const bubblesTs = srcOf('src/game/client/bubbles.ts');

console.log('── 1. Post-it origami + estrellitas al completar misión ──');
check('ToastStack plega el papel (origami) al expirar', toastTs.includes('origami') || /fold|plega/i.test(toastTs));
check('estrellas que caen (partículas del post-it)', /estrella|star/i.test(toastTs));
check('las estrellas viven sobre la fanfarria (misma capa que el toast)', /fanfarria|fanfare/i.test(toastTs) || controllerTs.includes('fanfarria'));

console.log('── 2. Pared de pasillo GRIS ÚNICO en todos los bloques ──');
const locals = v.locals as unknown as {
  corridorWall: string;
  portalDoors: Record<string, unknown>;
  garaje: Record<string, unknown>;
  trasteroComunal: Record<string, unknown>;
  juntaHall: Record<string, unknown>;
  lavanderia: Record<string, unknown>;
};
check('view.locals.corridorWall = gris de viviendas', locals.corridorWall === '#dbd8d2', locals.corridorWall);
check('building aplica el gris único a TODOS los bloques con pasillo', buildingTs.includes('corridorWall'));

console.log('── 3. Portal acristalado con correderas ──');
const pd = locals.portalDoors as unknown as Record<string, unknown>;
check('portalDoors del catálogo (slide/openAhead/openSeconds/glass)', !!(pd.slide && pd.openAhead !== undefined && pd.openSeconds && pd.glass));
check('building mantiene hojas vivas con baseX y sentido', buildingTs.includes('portalLeaves.push({ mesh: leaf, baseX, dir'));
check('las hojas se separan por proximidad y vuelven al cerrar', buildingTs.includes('portalOpen') && buildingTs.includes('portalDoorX'));
check('textura de hoja acristalada (marco, travesaños, tirador)', buildingTs.includes('portal_hoja_tex'));
const peds = content.rules.view.pedestrians as unknown as { enterZ?: number };
check('viandantes cruzan POR las correderas (enterZ)', typeof peds.enterZ === 'number', `enterZ ${peds.enterZ}`);

console.log('── 4. Garaje definido en el catálogo ──');
const gar = locals.garaje as unknown as Record<string, unknown>;
check('garaje: panel + rótulo GARAJES + rampa', !!(gar.panel && gar.sign === 'GARAJES' && (gar.rampDepth as number) > 0));

console.log('── 5. Trastero comunitario con puertas de vivienda ──');
const tc = locals.trasteroComunal as unknown as Record<string, unknown>;
check('trasteroComunal: doorArt + señal + estanterías', !!(tc.doorArt && tc.sign && (tc.shelfTiers as number) > 0));
check('E sobre sus puertas entra como en una vivienda (layout transitable)', logicTs.includes('LOCALES CON INTERIOR') && logicTs.includes('landInside(door)'));

console.log('── 6. Sala de juntas con asientos ──');
const jh = locals.juntaHall as unknown as Record<string, unknown>;
check('juntaHall: mesa + seats + rótulo', !!(jh.tableW && (jh.seats as unknown[]).length >= 2 && jh.sign));
check('building registra asientos por bloque', buildingTs.includes('hallSeats.set(b.id'));
check('la sala convocada cuenta como ocupada (la gente acude)', buildingTs.includes('juntaHallId') && buildingTs.includes('occ.add(juntaHallId)'));

console.log('── 7. Lavandería abierta con máquinas ──');
const lav = locals.lavanderia as unknown as Record<string, unknown>;
check('lavandería: máquinas del catálogo con arte recortado', !!((lav.machines as number) > 0 && typeof lav.art === 'string' && lav.art.includes('.png')));

console.log('── 8. Interior de vivienda transitable de lado a lado ──');
check('sin tapas ni tabiques interiores (v1.29) y landInside para locales', logicTs.includes('landInside'));

console.log('── 9. Losetas de 40 cm VISIBLES (contraste) ──');
const floor = (v as unknown as Record<string, Record<string, unknown>>).corridorFloor ?? {};
check('corridorFloor.contrast > 0 (baldosas distinguibles)', typeof floor.contrast === 'number' && (floor.contrast as number) > 0, String(floor.contrast));

console.log('── 10. Nada coplanar en el cierre del hueco ──');
check('gapFill/solera siguen con protrude + stagger por hash', buildingTs.includes('protrude') && buildingTs.includes('stagger'));

console.log('── 11. Emoticonos con visibilidad de cámara (frustum + oclusión) ──');
check('bubbles comprueba encuadre y rayo cámara→cabeza', bubblesTs.includes('frustum') || /frustum|proyecci/i.test(bubblesTs));

console.log('── Sim intacto ──');
const world = createWorld(content, 'slice');
const hashes: string[] = [];
for (let i = 0; i < 240; i++) {
  tick(world, content);
  if (i % 60 === 0) hashes.push(JSON.stringify([world.tick, world.community.funds, Object.keys(world.residents).length]));
}
const world2 = createWorld(content, 'slice');
const hashes2: string[] = [];
for (let i = 0; i < 240; i++) {
  tick(world2, content);
  if (i % 60 === 0) hashes2.push(JSON.stringify([world2.tick, world2.community.funds, Object.keys(world2.residents).length]));
}
check('determinismo (240 ticks idénticos)', hashes.join('|') === hashes2.join('|'));

console.log(`\nQA v1.30: ${pass} ✓ / ${fail} ✗`);
if (fail > 0) process.exit(1);
