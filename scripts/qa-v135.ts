/**
 * QA v1.35 «se ve dentro y hay vida» — el lote del vecino:
 *  1. PORTAL SIN PARED OSCURA: cuerpo/hueco del arte glTF RETIRADOS (hideNodes) y el
 *     VESTÍBULO: v1.36 — es UNA IMAGEN del hall (wall_portal_hall.png en el diorama);
 *     lámpara, diorama y losetas del branch de locales.
 *     El portal entra al branch de LOCALES, es puerta (se entra con E) y su fachada glTF
 *     se desvanece al entrar. El interior TAMBIÉN se revela con las puertas abiertas.
 *  2. GARAJE: basculante que alimenta el reveal (garajeLiftT) + interiores de locales
 *     AUTOILUMINADOS (en sombra ya no son un agujero negro). Sin hoja fantasma NaN (v1.34).
 *  3. TRASTERO COMÚN: la 2ª puerta abre EXACTAMENTE igual que la 1ª (bisagra a la izquierda
 *     en ambas, el pomo del dibujo cae lejos del eje — nada de bisagras alternadas).
 *  4. LAVANDERÍA: MÁQUINAS DE VERDAD — 3 lavadoras abajo + 3 secadoras arriba (volúmenes
 *     apilados con frontal mapeado y escotilla transparente) y BOMBOS que GIRAN (tirada
 *     determinista por bloque+máquina, drumOnChance del catálogo).
 *  5. LOSETAS VISIBLES: textura compartida (pasillos + locales + vestíbulo) con ajedrez
 *     contrast 0.22, moteado terrazo y junta gruesa — helper makeTileTex con uScale/vScale
 *     en metros reales.
 *  6. GRAFITIS: mural en la CABINA (elevator.setGraffiti con cabin_graffiti) + salpique a
 *     MUROS (cubos de escalera + vestíbulo) al pasar spillToWalls; textos y dibujos
 *     graciosos del catálogo; la junta limpia (param a 0) y desaparecen.
 *  7. DECAY VISIBLE: humedades/hollín/grietas por vivienda (params humidity/soot/condition)
 *     y mugre en el pasillo (cleanliness) — opacidad proporcional, todo del catálogo.
 *  8. VIDA SOCIAL: BAILE improvisado (clip dance) y siesta en el SUELO del pasillo (pose
 *     tumbada + «😴 Zzz…» + testigo) en la escalación de cruces — y LLEVAR OBJETOS ENCIMA
 *     (caja de mudanza/paquete) por actividad del catálogo y por beat `carry` de cutscene.
 *  9. COPLANARIDAD C↔ESCALERA: relleno de junta RETRANQUEADO (protrude negativo, jamás
 *     casi-coplano con las soleras) y solera a lo ancho REAL del cubo (spanW).
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

console.log('── 1. PORTAL: adiós a la pared oscura ──');
const rules = JSON.parse(srcOf('public/content/rules.json'));
const crossings = JSON.parse(srcOf('public/content/crossings.json'));
const assetsJson = srcOf('public/content/assets.json');
const blocksJson = srcOf('public/content/blocks.json');
const layoutsJson = srcOf('public/content/layouts.json');
const roomsJson = srcOf('public/content/rooms.json');
const buildingTs = srcOf('src/game/client/building.ts');
const elevatorTs = srcOf('src/game/client/elevator.ts');
const actorsTs = srcOf('src/game/client/actors.ts');
const chatsTs = srcOf('src/game/client/chats.ts');
const cutsceneTs = srcOf('src/game/client/cutscene.ts');
const schemasTs = srcOf('src/game/content/schemas.ts');

check('hideNodes retira cuerpo+hueco de portal y garaje (la fachada oscura era el cuerpo glTF)',
  (rules.view.locals.hideNodes.portal ?? []).includes('cuerpo') &&
  (rules.view.locals.hideNodes.portal ?? []).includes('hueco') &&
  (rules.view.locals.hideNodes.garaje ?? []).includes('cuerpo'));
check('el arte del portal es OVERLAY (la carcasa del vestíbulo sobrevive al modelo)',
  /"portal"[\s\S]{0,240}"overlay": true/.test(assetsJson));
check('el portal entra al branch de LOCALES y lleva layout+room del vestíbulo',
  buildingTs.includes("|| b.defId === 'portal'") && blocksJson.includes('"layout_portal"') &&
  layoutsJson.includes('layout_portal') && roomsJson.includes('estancia_portal'));
check('v1.36 — el interior del portal es UNA IMAGEN del hall (art + interiors + sin muebles 3D)',
  fs.existsSync(path.join(process.cwd(), 'public/art/interiors/raw/wall_portal_hall.png')) &&
  srcOf('public/content/interiors.json').includes('wall_portal_hall.png') &&
  !buildingTs.includes('_buzon_'));
check('locals.portal.lobby (colores del diorama) existe en rules Y en el schema',
  !!rules.view.locals.portal?.lobby && schemasTs.includes('portal: z') && !schemasTs.includes('mailboxColor')); // v1.36: el lobby solo lleva colores (el flag mailboxes de features.blocks es otro)
check('la fachada glTF del portal se desvanece al entrar (regla viviendas)',
  buildingTs.includes("if (b.defId === 'garaje' || b.defId === 'portal') view.model?.setEnabled(wall);"));
check('el interior del garaje/portal se REVELA con la puerta abierta (sin entrar)',
  buildingTs.includes('b.defId === \'portal\' ? portalOpen : garajeLiftT'));

console.log('── 2. GARAJE: reveal + luz, sin hoja fantasma ──');
check('la basculante alimenta el reveal del interior (garajeLiftT)',
  buildingTs.includes('garajeLiftT = d.openT;'));
check('interiores de locales autoiluminados (en sombra se lee dentro)',
  buildingTs.includes("hallGarajeMat.emissiveColor") && buildingTs.includes("hallPortalMat.emissiveColor") &&
  buildingTs.includes("hallLaundryMat.emissiveColor"));
check('sin hoja fantasma del garaje (v1.34: hinge NaN) — hojas SOLO trastero y sala',
  buildingTs.includes("if (b.defId === 'trasteros' || b.defId === 'local_comercial') {"));

console.log('── 3. TRASTERO: la 2ª puerta igual que la 1ª ──');
check('bisagras IGUALES (ambas a la izquierda; el pomo cae lejos del eje)',
  buildingTs.includes('const side: 1 | -1 = 1;') && !buildingTs.includes('li % 2 === 0 ? 1 : -1'));

console.log('── 4. LAVANDERÍA: volúmenes con bombo ──');
check('columnas apiladas lavadora+secadora del catálogo (stacks)',
  buildingTs.includes("lv.stacks ?? 3") && rules.view.locals.lavanderia.stacks === 3 &&
  typeof rules.view.locals.lavanderia.drumOnChance === 'number');
check('frontal mapeado con escotilla TRANSPARENTE + bombo disco detrás',
  buildingTs.includes('_bombo') && buildingTs.includes('machineFrontTex'));
check('los bombos giran en update (deterministas)',
  buildingTs.includes('for (const dr of laundryDrums) dr.mesh.rotation.z += dr.speed * dt;'));
check('schema de lavanderia acepta los volúmenes (sin strip)',
  schemasTs.includes('drumOnChance'));

console.log('── 5. LOSETAS visibles ──');
check('contraste y moteado subidos en el catálogo',
  rules.view.corridorFloor.contrast >= 0.2 && (rules.view.corridorFloor.speckle ?? 0) > 0.1 &&
  (rules.view.corridorFloor.groutW ?? 0) >= 8);
check('helper makeTileTex compartido (pasillos + locales + vestíbulo)',
  buildingTs.includes('const makeTileTex') && buildingTs.includes('makeTileTex(`${b.id}_losas`') &&
  buildingTs.includes('makeTileTex(`${b.id}_losas_int`'));
check('los locales llevan losetas sobre el suelo tintado',
  buildingTs.includes('_losas_int'));

console.log('── 6. GRAFITIS (cabina + muros) ──');
check('mural de cabina: elevator.setGraffiti con el nivel del núcleo',
  elevatorTs.includes('setGraffiti(level: number)') && elevatorTs.includes('asc_grafiti'));
check('el controlador pinta con paintBuilding',
  srcOf('src/game/client/controller.ts').includes('this.elevators?.setGraffiti(level);'));
check('salpique a muros del cubo + vestíbulo con spillToWalls',
  buildingTs.includes('graffitiWalls') && buildingTs.includes('spillToWalls'));
check('textos/dibujos graciosos del catálogo (data-driven)',
  Array.isArray(rules.view.graffiti.texts) && rules.view.graffiti.texts.length >= 4 &&
  rules.view.graffiti.doodles.length >= 4 && schemasTs.includes('graffiti: z'));

console.log('── 7. DECAY visible ──');
check('manchas por vivienda (humedad/hollín/grietas) con umbrales del catálogo',
  buildingTs.includes('decayDecals') && buildingTs.includes("param: k.invert ? 'condition' : k.key === 'hollin' ? 'soot' : 'humidity'") &&
  !!rules.view.decay?.humidity && !!rules.view.decay?.cracks);
check('mugre del pasillo según limpieza',
  buildingTs.includes("param: 'cleanliness'") && !!rules.view.decay?.grime);

console.log('── 8. VIDA SOCIAL: baile, siesta y objetos ──');
check('escalación con BAILE y SIESTA (catálogo)',
  (crossings.escalation?.danceChance ?? 0) > 0 && (crossings.escalation?.sleepChance ?? 0) > 0 &&
  (crossings.escalation.danceLines?.length ?? 0) >= 3);
check('chats: kinds dance/sleep con gestos y Zzz',
  chatsTs.includes("'dance' | 'sleep'") && chatsTs.includes("😴 Zzz…"));
check('pose TUMBADA en el suelo (pitch −π/2) y restauración',
  actorsTs.includes("if (a.gesture === 'sleep')") && actorsTs.includes('-Math.PI / 2') && actorsTs.includes('a.lying = true'));
check('llevar objetos encima: automático por actividad + forzado por teatro',
  actorsTs.includes('setCarrying(id: string, kind:') && actorsTs.includes('carryManual') &&
  buildingTs.includes('v.carry?.') === false && (rules.view.carry?.activities.length ?? 0) >= 2);
check('la mudanza SUBE CON CAJAS (beat carry en cutscene)',
  srcOf('public/content/cutscenes.json').includes('"carry": "box"') && cutsceneTs.includes('beat.carry'));

console.log('── 9. Coplanaridad C↔escalera ──');
check('relleno de junta RETRANQUEADO (protrude negativo, soleras siempre por delante)',
  rules.view.privacy.gapFill.protrude < 0);
check('solera a lo ancho REAL de los cubos (spanW)',
  buildingTs.includes('const spanCells = isStairsBlk ? v.stairs.spanW ?? b.size.w : b.size.w;'));

console.log('── 10. Contenido y determinismo ──');
const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
check('contenido carga sin errores de esquema', issues.length === 0, issues.slice(0, 2).map((i) => i.message).join(' | '));
if (issues.length > 0) {
  console.log(formatIssues(issues).slice(0, 400));
}
const world = createWorld(content, 'slice');
for (let i = 0; i < 240; i++) tick(world, content);
check('sim determinista (240 ticks)', world.tick === 240);
check('la insignia es v1.37', srcOf('src/game/client/i18n.ts').includes('v1.37'));

console.log(`\n═══ QA v1.35: ${pass} ✓ / ${fail} ✗ ═══`);
process.exit(fail > 0 ? 1 : 0);
