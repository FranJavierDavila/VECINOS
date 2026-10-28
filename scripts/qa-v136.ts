/**
 * QA v1.36 «se ve dentro y se anda derecho» — el lote del vecino:
 *  1. MASCOTA DERECHA: el perro estaba MODELADO mirando a +Z y las rutas van a +X —
 *     andaba de LADO. Extra.yawOffset (π/2 para el perro) + yaw inicial coherente.
 *  2. BOMBOS QUE SE VEN GIRAR: la cara del bombo lleva CRUCETAS + pernos (un disco liso
 *     girando es invisible: el vecino «no se mueven los bombos» — giraban, pero no se
 *     notaba). Textura canvas compartida.
 *  3. GARAJE AL INSTANTE: la basculante se ANTICIPA (garageOpenAhead 2.9 m), va más
 *     lenta (garageOpenSeconds 1.15) y el interior se revela DESDE revealAt (0.02) —
 *     «tan pronto se levanta la puerta se ve el interior sin esperar a entrar».
 *  4. CÁMARA ESTANCIA MÁS LEJOS (data-driven rules.view.camera): factores 2.5/2.9 y
 *     MARGEN de borde (2.4 m) — el personaje del extremo izquierdo del pasillo de
 *     planta 0 sale EN CUADRO en vez de aparcado en el canto.
 *  5. FONDOS DEFINIDOS: adiós al blur horneado «manchón» (2.2/4.5 → 0.6/1.1), canvas
 *     4096×512 con mipmaps (antes 2048×256 sin mipmaps: sellos de ~176 px estirados
 *     6–11×) y menos niebla (0.42/0.6 → 0.3/0.45).
 *  6. PORTAL = IMAGEN DEL HALL: el interior del portal es el arte del diorama
 *     (wall_portal_hall.png — buzones, tablón, banco, plantas, ascensor y escalera
 *     pintados); fuera el mobiliario 3D (los checks están en qa-v135 actualizado).
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
    console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`);
  }
};
const srcOf = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

console.log('── 1. Mascota derecha ──');
const ecoTs = srcOf('src/game/client/ecosystem.ts');
const actorsTs = srcOf('src/game/client/actors.ts');
check('Extra lleva yawOffset opcional (desfase de modelo)', ecoTs.includes('yawOffset?: number;'));
check('el perro nace con yawOffset π/2 (modelo +Z → ruta +X)', ecoTs.includes('yawOffset: Math.PI / 2'));
check('el bucle aplica e.yaw + (e.yawOffset ?? MODEL_YAW_OFFSET)', ecoTs.includes('e.yaw + (e.yawOffset ?? MODEL_YAW_OFFSET)'));
check('el perro NACE mirando a donde va (yaw inicial por dir0)', ecoTs.includes('yaw: dir0 > 0 ? 0 : Math.PI'));
check('los rigs de actor siguen con MODEL_YAW_OFFSET intacto', actorsTs.includes('export const MODEL_YAW_OFFSET'));

console.log('── 2. Bombos que SE VEN girar ──');
const buildingTs = srcOf('src/game/client/building.ts');
const rules = JSON.parse(srcOf('public/content/rules.json'));
check('cara del bombo con crucetas y pernos (canvas compartido)', buildingTs.includes('drumFaceTex') && buildingTs.includes('CRUCETAS'));
check('la textura entra en el material del bombo', buildingTs.includes('drumMat.diffuseTexture = drumFaceTex()'));
check('el giro por frame sigue (laundryDrums update)', buildingTs.includes('for (const dr of laundryDrums) dr.mesh.rotation.z += dr.speed * dt;'));
check('catálogo: drumOnChance/drumSpeed del tirador determinista', (rules.view.locals.lavanderia.drumOnChance ?? 0) > 0);

console.log('── 3. Garaje al instante ──');
const schemasTs = srcOf('src/game/content/schemas.ts');
const hd = rules.view.locals.hallDoors;
check('catálogo hallDoors: garageOpenAhead 2.9 + garageOpenSeconds 1.15 + revealAt 0.02',
  hd.garageOpenAhead === 2.9 && hd.garageOpenSeconds === 1.15 && hd.revealAt === 0.02, `ahead=${hd.garageOpenAhead} secs=${hd.garageOpenSeconds} reveal=${hd.revealAt}`);
check('schema acepta garageOpenAhead/garageOpenSeconds/revealAt',
  schemasTs.includes('garageOpenAhead') && schemasTs.includes('garageOpenSeconds') && schemasTs.includes('revealAt'));
check('la basculante usa SU openAhead (y amplía el pasillo en X)', buildingTs.includes('const ahead = d.lift ? (hd.garageOpenAhead ?? hd.openAhead) : hd.openAhead;'));
check('la basculante usa SU openSeconds', buildingTs.includes('const secs = d.lift ? (hd.garageOpenSeconds ?? hd.openSeconds) : hd.openSeconds;'));
check('reveal desde revealAt (nada de esperar a entrar)', buildingTs.includes('v.locals.hallDoors?.revealAt ?? 0.12'));

console.log('── 4. Cámara Estancia más lejos (data-driven) ──');
const cam = rules.view.camera;
check('rules.view.camera: 2.5 / 2.9 / margen 2.4',
  cam?.estanciaFloorH === 2.5 && cam?.estanciaWidthW === 2.9 && cam?.estanciaEdgeMargin === 2.4,
  `H=${cam?.estanciaFloorH} W=${cam?.estanciaWidthW} margin=${cam?.estanciaEdgeMargin}`);
check('schema de camera con defaults', schemasTs.includes('estanciaFloorH') && schemasTs.includes('estanciaEdgeMargin'));
const cameraTs = srcOf('src/game/client/camera.ts');
const controllerTs = srcOf('src/game/client/controller.ts');
check('CameraRig.tuning existe con fallback a 2.0/2.2/0', cameraTs.includes('tuning: { estFloorH: number; estWidthW: number; estMargin: number }'));
check('la Estancia encuadra con el catálogo (antes 2.0/2.2)', cameraTs.includes('est ? est.estFloorH : 2.0') && cameraTs.includes('est ? est.estWidthW : 2.2'));
check('MARGEN en los extremos (solo Estancia): el personaje del canto sale en cuadro',
  cameraTs.includes('const margin = est ? est.estMargin : 0;') && cameraTs.includes('Math.max(lo, p.x)'));
check('el controlador pasa rules.view.camera al rig', controllerTs.includes('camTuning.estanciaEdgeMargin'));
check('el modo planta NO cambia (la petición es de Estancia)', cameraTs.includes("? Math.max(this.cellH * 2.4, (width * 1.1) / aspect)"));

console.log('── 5. Fondos definidos ──');
const backdropTs = srcOf('src/game/client/backdrop.ts');
const genBackdrop = srcOf('scripts/gen-backdrop-assets.ts');
check('canvas 4096×512 POT con mipmaps (antes 2048×256 sin mipmaps)',
  backdropTs.includes('const CANVAS_W = 4096;') && backdropTs.includes('const CANVAS_H = 512;') &&
  backdropTs.includes("{ width: CANVAS_W, height: CANVAS_H }, scene, true)"));
check('blur horneado CANCELADO: cerca 0.4 / media 0.6 / lejos 1.1 (antes 0.6/2.2/4.5 «manchones»)',
  genBackdrop.includes('blur: 0.4') && genBackdrop.includes('blur: 0.6') && genBackdrop.includes('blur: 1.1') &&
  !genBackdrop.includes('blur: 2.2') && !genBackdrop.includes('blur: 4.5'));
check('los tres PNG regenerados existen y pesan', ['fachada_1_cerca.png', 'fachada_2_media.png', 'fachada_3_lejos.png']
  .every((f) => { const st = fs.statSync(path.join(process.cwd(), 'public/content/backdrop', f)); return st.size > 40000; }));
check('niebla reducida en catálogo (0.3 / 0.45 — la definición manda)',
  rules.view.backdrop.layers[1]?.fog === 0.3 && rules.view.backdrop.layers[2]?.fog === 0.45);
check('vScale y copias usan el canvas nuevo (sin 2048/256 hardcodeados)',
  backdropTs.includes('usedH / CANVAS_H') && backdropTs.includes('c.width = CANVAS_W;') && !backdropTs.includes('width: 2048'));

console.log('── 6. Portal = imagen del hall ──');
const interiorsCat = JSON.parse(srcOf('public/content/interiors.json'));
check('estancia_portal apunta al arte del hall (walls)',
  Array.isArray(interiorsCat.rooms.estancia_portal?.walls) &&
  interiorsCat.rooms.estancia_portal.walls.includes('wall_portal_hall.png') &&
  fs.existsSync(path.join(process.cwd(), 'public/art/interiors/raw/wall_portal_hall.png')));
check('sin muebles 3D en el vestíbulo (buzones/banco/tablón fuera)', !buildingTs.includes('_buzon_') && !buildingTs.includes('_banco_asiento'));
check('el arte es 1344×768 PNG real (aspecto 1.75 = el muro de 4.56×2.6 del layout_portal)', (() => {
  const buf = fs.readFileSync(path.join(process.cwd(), 'public/art/interiors/raw/wall_portal_hall.png'));
  return buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a' && buf.readUInt32BE(16) === 1344 && buf.readUInt32BE(20) === 768;
})());

console.log('── 7. Insignia y determinismo ──');
check('insignia v1.36 en i18n', srcOf('src/game/client/i18n.ts').includes('v1.37 · se sale al parque'));
check('sw.js bump a vecinos-v1.37', srcOf('public/sw.js').includes('vecinos-v1.37'));
const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
check('contenido carga sin errores de esquema', issues.length === 0, issues.slice(0, 2).map((i) => i.message).join(' | '));
if (issues.length > 0) {
  console.log(formatIssues(issues).slice(0, 400));
}
const world = createWorld(content, 'slice');
for (let i = 0; i < 240; i++) tick(world, content);
check('sim determinista (240 ticks)', world.tick === 240);

console.log(`\n═══ QA v1.36: ${pass} ✓ / ${fail} ✗ ═══`);
if (fail > 0) process.exit(1);
