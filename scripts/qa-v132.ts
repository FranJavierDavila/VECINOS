/**
 * QA v1.32 "el vecindario respira" — el vecino pidió: vehículos ya no «cajas con planos
 * pegados sin recortar» + sombras reales en el edificio + personajes con vida (hablar,
 * discutir, pelear, heridos y ambulancia que los recoge) + bloques inferiores con su
 * propia regla de fachada y puertas que abren + junta con asientos y puestos de pie +
 * textos 100% data-driven. Verificación en frío:
 *  1. VEHÍCULOS RECORTADOS: costados con arcos de rueda RECORTADOS (alpha-test), ruedas
 *     DENTRO de los pozos (nada asoma), pozo oscuro detrás, cabina de berlina al ancho
 *     del cuerpo, tubo de escape y tiradores 3D; costados fuera del pase de sombras.
 *  2. SOMBRAS DE VERDAD: rules.view.shadows (casters/receivers/excluidos por patrón),
 *     ShadowGenerator PCF sobre el sol, renombrado de mallas de actores/viandantes para
 *     que los patrones del catálogo los reconozcan, refresco perezoso en el controlador.
 *  3. CLIPS NUEVOS: fight y hurt inyectados en los 15 glTF (canales sobre el rig real) y
 *     declarados como stateAnimations del manifiesto para todos los arquetipos.
 *  4. VIDA SOCIAL DE PASILLO: crossings.escalation (argueChance/fightChance/injured…),
 *     chats.ts con discusión ('argue'), pelea ('fight') y herido ('hurt') + testigo.
 *  5. CALLE VIVA: pedestrians.social (charla/discusión/pelea/herido) + TEATRO DE LA
 *     AMBULANCIA (rig del catálogo, celadores, recogida y traslado) + sonidos nuevos.
 *  6. BLOQUES INFERIORES: fachada SOLO al entrar (jugador/junta) + hojas con BISAGRA que
 *     se abren con el resto de puertas (rules.locals.hallDoors).
 *  7. JUNTA: puestos de pie del catálogo (standSpots) — 1 por silla, el resto de pie
 *     dentro del local, sin solaparse; el aviso del log cuenta sillas y de pie.
 *  8. TEXTOS DATA-DRIVEN: rules.texts.ordinals + resolver de tokens ({planta:x},
 *     {vivienda:x}) en chats/streetlife/voices + auditoría de menciones imposibles
 *     (scanFloorReferences: cero violaciones con el contenido real; detecta inventadas).
 * + Sim intacto: 240 ticks deterministas tras tocar solo presentación/contenido.
 */
import fs from 'fs';
import path from 'path';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld } from '@/game/sim';
import { tick } from '@/game/sim/tick';
import { scanFloorReferences } from '@/game/support/texts';

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
const trafficTs = srcOf('src/game/client/traffic.ts');
const shadowsTs = srcOf('src/game/client/shadows.ts');
const ambulanceTs = srcOf('src/game/client/ambulance.ts');
const pedestriansTs = srcOf('src/game/client/pedestrians.ts');
const chatsTs = srcOf('src/game/client/chats.ts');
const buildingTs = srcOf('src/game/client/building.ts');
const controllerTs = srcOf('src/game/client/controller.ts');
const actorsTs = srcOf('src/game/client/actors.ts');
const textsTs = srcOf('src/game/support/texts.ts');
const schemasTs = srcOf('src/game/content/schemas.ts');
const typesTs = srcOf('src/game/core/types.ts');
const assetsJson = srcOf('public/content/assets.json');
const i18nTs = srcOf('src/game/client/i18n.ts');
const swJs = srcOf('public/sw.js');
const pwaTsx = srcOf('src/components/game/PwaRegister.tsx');

console.log('── 1. Vehículos recortados (adiós «cajas con planos pegados») ──');
check('alpha-test en el material del costado', trafficTs.includes('sideMat.transparencyMode = 2') && trafficTs.includes('useAlphaFromDiffuseTexture'));
check('el canvas del costado nace transparente y RECORTA los arcos (destination-out)', trafficTs.includes('c.clearRect(0, 0, W, H)') && trafficTs.includes("c.globalCompositeOperation = 'destination-out'"));
check('la textura del costado declara hasAlpha', trafficTs.includes('hasAlpha = true'));
check('ruedas DENTRO del cuerpo (tireZ = sideOff − 0.13)', trafficTs.includes('const tireZ = sideOff - 0.13'));
check('pozo oscuro detrás de cada arco', trafficTs.includes("'pozo'"));
check('cabina de berlina al ancho del cuerpo (W*0.86)', trafficTs.includes("body('cabina', geo.cabinL, geo.cabinH, W * 0.86)"));
check('tubo de escape y tiradores 3D', trafficTs.includes('_escape') && trafficTs.includes('tirador3d'));
check('costados excluidos del pase de sombras (noShadow)', trafficTs.includes('noShadow.push(q)') && trafficTs.includes('noShadow: Mesh[]'));
check('geoOf acepta la ambulancia (furgoneta/ambulancia comparten cota)', trafficTs.includes("def.kind === 'furgoneta' || def.kind === 'ambulancia'"));
check('buildAmbulance exporta el rig del teatro', trafficTs.includes('buildAmbulance(): AmbulanceRig | null'));
check('catálogo trae view.traffic.ambulance', !!v.traffic.ambulance && !!v.traffic.ambulance.sideText);
check('schema/types en espejo para ambulance', schemasTs.includes('ambulance: z') && typesTs.includes('ambulance?:'));

console.log('── 2. Sombras de verdad (rules.view.shadows) ──');
const sh = v.shadows!;
check('catálogo shadows con listas por patrón', !!sh && sh.enabled && sh.casters.length > 0 && sh.receivers.length > 0);
check('el edificio proyecta y recibe', sh.casters.includes('blk_') && sh.receivers.includes('blk_'));
check('la calle y el suelo reciben', sh.receivers.includes('suelo_mundo') && sh.receivers.includes('calle_'));
check('excluidos: costados/cristales/arte 2D fuera', sh.excluded.includes('costado') && sh.excluded.includes('cristal'));
check('shadows.ts: ShadowGenerator PCF + transparencyShadow', shadowsTs.includes('usePercentageCloserFiltering') && shadowsTs.includes('transparencyShadow = true'));
check('controller crea el pase con la luz del sol del catálogo', controllerTs.includes('createShadows(this.scene, dirLight, view.shadows)'));
check('refresco perezoso de participantes (2 s)', controllerTs.includes('this.shadowRefreshT = 2'));
check('actores renombrados para el patrón res_', actorsTs.includes('m.name = `${id}_${m.name}`'));
check('viandantes renombrados para el patrón viandante', pedestriansTs.includes('m.name = `viandante_${i}_${m.name}`'));

console.log('── 3. Clips nuevos fight/hurt en los rigs ──');
const actorsDir = path.join(import.meta.dir, '..', 'public/assets/actors');
const gltfFiles = fs.readdirSync(actorsDir).filter((f) => f.endsWith('.gltf'));
let withClips = 0;
for (const f of gltfFiles) {
  const doc = JSON.parse(fs.readFileSync(path.join(actorsDir, f), 'utf8'));
  const names = (doc.animations as { name?: string }[]).map((a) => a.name);
  if (names.includes('fight') && names.includes('hurt')) withClips++;
}
check('fight + hurt presentes en TODOS los glTF', withClips === gltfFiles.length && gltfFiles.length >= 15, `${withClips}/${gltfFiles.length}`);
const stateAnimCount = (assetsJson.match(/"fight": "fight"/g) ?? []).length;
check('manifiesto: fight/hurt como stateAnimations de todos los arquetipos', stateAnimCount >= 15, `${stateAnimCount} arquetipos`);

console.log('── 4. Vida social de pasillo (charla → discusión → pelea) ──');
const esc = content.crossings?.escalation;
check('catálogo crossings.escalation con tiradas', !!esc && esc.argueChance > 0 && esc.fightChance > 0 && esc.injuredChance > 0);
check('grupos de discusión mild/hot con líneas', Object.keys(esc?.argueGroups ?? {}).length >= 2);
check('chats.ts: gesto argue para discusión y fight para pelea', chatsTs.includes("'argue'") && chatsTs.includes("'fight'"));
check('chats.ts: herido con clip hurt + recuperación (se levanta)', chatsTs.includes("'hurt'") && chatsTs.includes('actors.setGesture(ch.injured, null)'));
check('chats.ts: testigo comenta la pelea', chatsTs.includes('scheduleWitness') && chatsTs.includes('witnessLines'));
check('schema/type en espejo para escalation', schemasTs.includes('escalation: z') && typesTs.includes('escalation?:'));

console.log('── 5. Calle viva: encuentros + TEATRO DE LA AMBULANCIA ──');
const soc = v.pedestrians.social!;
check('catálogo pedestrians.social', !!soc && soc.enabled && soc.fightChance > 0 && soc.injuredChance > 0);
check('encuentros: talk/argue/fight por tirada del catálogo', pedestriansTs.includes("kind = roll < soc.fightChance ? 'fight' : roll < soc.fightChance + soc.argueChance ? 'argue' : 'talk'"));
check('herido llama a la ambulancia (requestPickup)', pedestriansTs.includes('requestPickup'));
check('ambulance.ts: fases del teatro (driveIn→doors→walkOut→kneel→carry→board→driveOut)', (['driveIn', 'doors', 'walkOut', 'kneel', 'carry', 'board', 'driveOut'] as const).every((p) => ambulanceTs.includes(`'${p}'`)));
check('celadores con uniforme del catálogo', ambulanceTs.includes('medicColor') && ambulanceTs.includes('medicCapColor'));
check('girofarios alternando y puertas traseras', ambulanceTs.includes('flash(') && ambulanceTs.includes('setDoors('));
check('sonidos nuevos: sirena y golpe', srcOf('public/content/sounds.json').includes('sirena_ambulancia') && srcOf('public/content/sounds.json').includes('golpe_pelea'));
check('controller: teatro antes de viandantes (ellos lo llaman)', controllerTs.indexOf('createAmbulanceTheater') < controllerTs.indexOf('createPedestrians'));
check('bocadillos flotantes de viandantes (emoji billboard)', pedestriansTs.includes('BILLBOARDMODE_ALL'));

console.log('── 6. Bloques inferiores: fachada propia + puertas con bisagra ──');
check('regla v1.32: fachada del local SOLO al entrar (jugador) o con la junta', buildingTs.includes('privacyClosed = playerInside !== b.id && juntaHallId !== b.id'));
check('hojas de los locales con bisagra (hallDoors)', buildingTs.includes('const hallDoors') && buildingTs.includes('hoja_hinge'));
check('animación de apertura por proximidad (movers)', buildingTs.includes('hd.openAhead') && buildingTs.includes('d.hinge.rotation.y = -d.side * hd.openAngle * d.openT'));
check('catálogo locals.hallDoors', !!v.locals.hallDoors && v.locals.hallDoors.enabled);
check('bisagras en doorDecor (apagan con la fachada)', buildingTs.includes('view.doorDecor.push(hinge)'));

console.log('── 7. Junta: sillas libres + resto DE PIE dentro del local ──');
const jh = v.locals.juntaHall;
check('standSpots del catálogo (dentro del local)', (jh.standSpots?.length ?? 0) >= 6, `${jh.standSpots?.length ?? 0} puestos`);
check('hallSeats guarda seats Y stands', buildingTs.includes('hallSeats.set(b.id, { seats: seatsW, stands: standsW })'));
check('juntaHallInfo devuelve stands', controllerTs.includes('hall.stands') || buildingTs.includes('stands: h.stands'));
check('marchJunta: 1 por silla, el resto de pie en spots', controllerTs.includes('const standIdx = i - hall.seats.length') && controllerTs.includes('hall.stands[standIdx]'));
check('aviso del log cuenta sillas y de pie', controllerTs.includes('se quedan de pie en la sala'));

console.log('── 8. Textos data-driven ──');
check('ordinales de planta por idioma en rules.texts', (v.texts?.ordinals.length ?? 0) >= 6 && (v.texts?.ordinalsEn.length ?? 0) >= 6);
check('resolver de tokens en support/texts.ts', textsTs.includes('resolveTokens') && textsTs.includes('{planta:'));
check('chats/streetlife/voices usan el resolver', chatsTs.includes('resolveTokens') && srcOf('src/game/client/streetlife.ts').includes('resolveTokens') && srcOf('src/game/client/voices.ts').includes('resolveTokens'));
const worldScan = createWorld(content, 'slice');
const violations = scanFloorReferences(worldScan, content);
check('contenido real SIN menciones de plantas/viviendas imposibles', violations.length === 0, violations.map((x) => `${x.where}: "${x.mention}"`).join(' · '));
{
  // Auditoría sintética: un edificio de solo planta 0 detecta «cuarta planta» y «4C».
  const fakeWorld = createWorld(content, 'slice');
  const fakeViolations = scanFloorReferences(fakeWorld, content).length;
  void fakeViolations;
  const fake = scanFloorReferences({ blocks: Object.fromEntries(Object.entries(worldScan.blocks).filter(([, b]) => b.cell.floor === 0)) } as never, content);
  check('el auditor CAZA menciones inventadas (edificio recortado)', fake.length > 0, `${fake.length} violaciones detectadas`);
}

console.log('── 9. Versiones ──');
check('insignia v1.33 en i18n (es/en, la 1.32 fue sustituida por la nueva)', i18nTs.includes('v1.33 · cristales en su sitio') && i18nTs.includes('v1.33 · glass in its place'));
check('sw.js bump a vecinos-v1.33 (sigue subiendo)', swJs.includes('vecinos-v1.33'));
check('PwaRegister espera vecinos-v1.33', pwaTsx.includes('vecinos-v1.33'));

console.log('── Sim intacto ──');
const hashes: string[] = [];
for (let i = 0; i < 240; i++) {
  tick(worldScan, content);
  if (i % 60 === 0) hashes.push(JSON.stringify([worldScan.tick, worldScan.funds, Object.keys(worldScan.residents).length]));
}
const world2 = createWorld(content, 'slice');
const hashes2: string[] = [];
for (let i = 0; i < 240; i++) {
  tick(world2, content);
  if (i % 60 === 0) hashes2.push(JSON.stringify([world2.tick, world2.funds, Object.keys(world2.residents).length]));
}
check('determinismo (240 ticks idénticos)', hashes.join('|') === hashes2.join('|'));

console.log(`\nQA v1.32: ${pass} ✓ / ${fail} ✗`);
if (fail > 0) process.exit(1);
