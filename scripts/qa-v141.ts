/**
 * QA v1.41 «la calle vive: cortesía al volante, fachada acristalada y vida en el portal» —
 * el lote del vecino (exterior + bugs):
 *  1. CORTESÍA AL VOLANTE — los coches FRENAN en el paso de peatones si hay alguien cruzando
 *     (crossers publicados por el paseo) y guardan distancia con el de delante; si el peatón
 *     aparece demasiado cerca la frenada es imposible → frenazo/claxon + accidente cómico
 *     (líneas del catálogo street.outdoor, peatón tumbado con gesto 'sleep' y se levanta).
 *  2. CÁMARA FACHADA (tecla 0) — un paso más atrás que «edificio» (viewH × fachadaViewHFactor)
 *     y el edificio ENTERO con la fachada CERRADA: cortina acristalada (vidrio translúcido +
 *     montantes cada celda) a la altura de las galerías; el interior solo se entreve por las
 *     ventanas. Sin seccionado: fundidos de trasteros/apilamiento en reposo y dioramas fuera.
 *  3. RUTA LATERAL DEL PORTAL — la única entrada/salida «real»: cruzar el vestíbulo hacia la
 *     PARED IZQUIERDA, fade por la pared, acera lateral (perímetro oeste) hasta la esquina y
 *     acera frontal «justo enfrente del portal». Para entrar, la misma maniobra al revés
 *     (lateral → un poco por detrás del bloque de entrada). Vecinos (paseo) Y viandantes.
 *  4. VIDA EXTERIOR — planes del paseo: PARQUE (calistenia, v1.37), BANCO (sentarse en un
 *     banco exterior con pose sit + líneas del catálogo), PASEO (estirar piernas por la
 *     acera frontal) y TAXI. Diálogos cómicos de salidas/entradas (street.outdoor).
 *  5. PARAGUAS — llueve (rain/storm) y están fuera → paraguas ABIERTO con animación de
 *     apertura (rules.view.outdoor.umbrella) y una línea cómica la primera vez.
 *  6. BOLSAS DE LA COMPRA — el que vuelve en taxi vuelve SIEMPRE con bolsas; el que regresa
 *     de un paseo, a veces (hash del catálogo del teatro). Aparecen al bajarse del taxi.
 *  7. TAXI — pide taxi en el bordillo (línea taxiHail), el coche del catálogo viene y para
     *  EXACTAMENTE en stopX del carril cercano (traffic.hailTaxi/stage), cruza a la puerta
 *     (los coches frenan por él), se sube (fade → desaparece), el taxi arranca, y vuelve
 *     más tarde: nuevo taxi para, se baja CON BOLSAS (taxiBack) y entra por la lateral.
 *  8. EMOTICONOS ARREGLADOS — los emotes 3D de los viandantes eran planos colocados UNA vez
 *     en el mundo: el viandante seguía andando y el emoji quedaba flotando sin dueño (más
 *     visible al cambiar de cámara). Ahora son HIJOS del nodo (viajan, escalan y desaparecen
 *     con él) y se disponen al reciclar el rig; además el cambio de cámara invalida oclusiones.
 *  9. i18N CERRADO — diccionario ES→EN con las 59 frases de actividades, 103+ de charlas de
 *     cruce, las líneas outdoor y las captions de voces; sounds.json entra en el pase del
 *     idioma; TODOS los avisos duros del controlador van por translate() (claves ev.*).
 * 10. DECALS BIEN RECADOS (II) — decalMat con useAlphaFromDiffuseTexture (Babylon 8 no pasa
 *     el alpha de la textura al shader sin la bandera) + recorte a la caja del contenido
 *     (decalTex con alphaBoundsOf, pad 6 px): el quad enmarca el motivo, sin halo vacío.
 * 11. ENTRADA DIRECTA A LOS LOCALES — garaje/lavandería/local/trasteros: te plantas delante
 *     y entras sin E (igual que tu vivienda desde v1.40). Excepciones: viviendas ajenas
 *     (timbre), candados (norma del barrio) y el portal (vestíbulo de buzones).
 *
 * Verificación en navegador (modo ?qaengine=1, NullEngine) hecha aparte: tecla 0 → fachada
 * cerrada con cortina, coches frenando ante el cruce, paseo con banco/taxi y paraguas en
 * lluvia forzada, y cero bocadillos flotando al cambiar de cámara.
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

const rules = JSON.parse(srcOf('public/content/rules.json'));
const street = JSON.parse(srcOf('public/content/street.json'));
const sounds = JSON.parse(srcOf('public/content/sounds.json'));
const trafficTs = srcOf('src/game/client/traffic.ts');
const paseoTs = srcOf('src/game/client/paseo.ts');
const ctrlTs = srcOf('src/game/client/controller.ts');
const actorsTs = srcOf('src/game/client/actors.ts');
const buildTs = srcOf('src/game/client/building.ts');
const camTs = srcOf('src/game/client/camera.ts');
const storeTs = srcOf('src/game/client/store.ts');
const pedTs = srcOf('src/game/client/pedestrians.ts');
const logicTs = srcOf('src/game/player-logic.ts');
const schemaTs = srcOf('src/game/content/schemas.ts');

console.log('── 1. Cortesía al volante (frenan en el paso, o accidente cómico) ──');
check('catálogo traffic.braking (banda, decel, gap, hazard)', rules.view.traffic.braking?.enabled === true && rules.view.traffic.braking.zebraHalfWidth > 0 && rules.view.traffic.braking.minStopDist > 0);
check('schema braking con defaults', schemaTs.includes('braking: z\n          .object({') && schemaTs.includes('hazardSeconds: z.number().positive().default(6)'));
check('crossers: el paseo publica quién pisa la calzada', paseoTs.includes('traffic?.setCrossers(crossers)') && paseoTs.includes("crossers.push({ x: node.x, z: node.z })"));
check('el tráfico FRENA con alguien en la banda del paso', trafficTs.includes('const stopLine = dir > 0 ? cfg.passX - brk.zebraHalfWidth - 0.8') && trafficTs.includes('a.speed - brk.brakeDecel * dt'));
check('distancia de cortesía con el vehículo de delante', trafficTs.includes('gap > 0 && gap < brk.followGap'));
check('frenada imposible → accidente cómico (doomed → hazard + claxon)', trafficTs.includes('a.doomed = true') && trafficTs.includes("playSoundAt('claxon', 0.9)") && trafficTs.includes("onIncident?.(a.x, 'hit')"));
check('frenazo heroico avisado una vez por parada (near)', trafficTs.includes("playSoundAt('frenazo', 0.8)") && trafficTs.includes("onIncident?.(a.x, 'near')"));
check('el controlador conecta el incidente con el peatón (paseo)', ctrlTs.includes('this.paseo?.onTrafficIncident(x, kind)'));
check('peatón protagonista: susto (argue) o accidente (pose sleep) del catálogo', paseoTs.includes("setGesture(w.id, 'argue', 2.2)") && paseoTs.includes("setGesture(w.id, 'sleep', 2.4)"));
check('sonidos del catálogo: claxon + frenazo', !!sounds.sounds.claxon && !!sounds.sounds.frenazo);
check('líneas cómicas del incidente en street.outdoor', (street.outdoor?.nearMiss?.length ?? 0) >= 1 && (street.outdoor?.accident?.length ?? 0) >= 1 && typeof street.outdoor.carHorn === 'string');

console.log('── 2. Cámara FACHADA (tecla 0, fachada cerrada acristalada) ──');
check('Digit0 → fachada en CAM_BY_KEY + normalizador de GameStage', ctrlTs.includes("Digit0: 'fachada'") && srcOf('src/components/game/GameStage.tsx').includes("'0': 'Digit0'"));
check('CamMode incluye fachada (camera/store/bridge)', camTs.includes("'edificio' | 'fachada' | 'planta' | 'estancia'") && storeTs.includes("'edificio' | 'fachada' | 'planta' | 'estancia'") && srcOf('src/game/client/bridge.ts').includes("'edificio' | 'fachada'"));
check('encuadre propio: edificio × fachadaViewHFactor (catálogo)', camTs.includes('* this.tuning.fachadaFactor') && rules.view.camera?.fachadaViewHFactor === 1.32);
check('rueda de cámaras y UI: fachada entre edificio y planta', ctrlTs.includes("['edificio', 'fachada', 'planta', 'estancia']") && srcOf('src/components/game/TouchControls.tsx').includes("'edificio', 'fachada'") && srcOf('src/components/game/PostItControls.tsx').includes("{ value: 'fachada' }"));
check('i18n: ctrl.cam.fachada (Fachada/Facade)', srcOf('src/game/client/i18n.ts').includes("'ctrl.cam.fachada': { es: 'Fachada', en: 'Facade' }"));
check('vista de calle: fachada cuenta (coches/paseo/taxi viven detrás)', ctrlTs.includes("store.camMode === 'edificio' || store.camMode === 'fachada' || store.camMode === 'planta'"));
check('LOD sin foco en fachada (todo el edificio nítido como en edificio)', ctrlTs.includes("camMode === 'edificio' || useGameStore.getState().camMode === 'fachada'"));
check('building: TODAS las fachadas cerradas en vista fachada', buildTs.includes('const wall = (fachadaView || locked || privacyClosed) && !view.lodHiddenPanels;'));
check('cortina acristalada: vidrio translúcido + montantes por celda (nada coplanar)', buildTs.includes("new TransformNode('fachada_cortina', scene)") && buildTs.includes('glassM.alpha = 0.16;') && buildTs.includes('fachada_montante_'));
check('setFachadaView: el controlador manda el cambio de cámara', buildTs.includes('setFachadaView(on: boolean)') && ctrlTs.includes("this.building?.setFachadaView(store.camMode === 'fachada')"));
check('fundidos en reposo: trasteros y apilamiento enteros en fachada', buildTs.includes('const target = fachadaView ? 1 :') && buildTs.includes('const mainT = fachadaView ? 1 :'));

console.log('── 3. Ruta lateral del portal (perímetro izquierdo) ──');
check('catálogo paseo: sideX/sideZ/cornerZ/frontZ/portalSideX', typeof rules.view.paseo.sideX === 'number' && typeof rules.view.paseo.portalSideX === 'number');
check('salir: vestíbulo → pared izquierda → fade → acera lateral → esquina → frontal', paseoTs.includes("'sideOut'") && paseoTs.includes("w.fadeGoal = 'out'") && paseoTs.includes("'sideWalk'") && paseoTs.includes('{ x: cfg.sideX, y: ySide(w), z: cfg.cornerZ }'));
check('entrar: la maniobra al revés (lateral → fade → vestíbulo → pasillo)', paseoTs.includes("'sideIn'") && paseoTs.includes("w.fadeGoal = 'in'") && paseoTs.includes("'enterPortal'"));
check('fade por la pared con setFade (visibilidad por malla)', actorsTs.includes('setFade(id: string, k: number)') && paseoTs.includes('actors.setFade(w.id, w.fadeK)'));
check('viandantes: ruta lateral con cola de puntos (legs)', pedTs.includes("mode: 'walk' | 'enter' | 'exit' | 'leave' | 'legs'") && pedTs.includes("if (w.mode === 'legs')") && rules.view.pedestrians.sideRoute?.sideX === -2.9);

console.log('── 4. Vida exterior (parque, banco, paseo y planes del catálogo) ──');
check('planes con reparto del catálogo (benchChance/strollChance/taxiChance)', typeof rules.view.paseo.benchChance === 'number' && typeof rules.view.paseo.taxiChance === 'number' && paseoTs.includes("planFor"));
check('banco: asientos reales del exterior (benchSpots) y pose sit', srcOf('src/game/client/exterior.ts').includes('benchSpots.push({ x: p.x, z: p.z })') && paseoTs.includes('actors.seatWhenIdle(w.id') && paseoTs.includes('actors.standUp(w.id)'));
check('paseo: estirar piernas por la acera frontal (strollMeters)', rules.view.paseo.strollMeters === 9 && paseoTs.includes("sayOutdoor(w, outLines?.strollLines)"));
check('líneas cómicas de salida/entrada/banco (street.outdoor)', (street.outdoor?.exitLines?.length ?? 0) >= 1 && (street.outdoor?.enterLines?.length ?? 0) >= 1 && (street.outdoor?.benchLines?.length ?? 0) >= 1);
check('schema street.outdoor opcional', schemaTs.includes('outdoor: z\n    .object({') && schemaTs.includes('exitLines: z.array(z.string()).min(1)'));

console.log('── 5. Paraguas bajo la lluvia ──');
check('catálogo outdoor.umbrella (color/palo/tamaño/apertura)', rules.view.outdoor?.umbrella?.color === '#b8452e' && rules.view.outdoor.umbrella.openSeconds > 0);
check('actor: paraguas colgado del nodo con animación de apertura', actorsTs.includes('_umbrella') && actorsTs.includes('a.umbrellaK') && actorsTs.includes('umbrellaWant'));
check('paseo: llueve y están fuera → setUmbrella + línea cómica una vez', paseoTs.includes("world.weather.state === 'rain' || world.weather.state === 'storm'") && paseoTs.includes('actors.setUmbrella(w.id, rain && outside)') && paseoTs.includes('sayOutdoor(w, outLines?.umbrellaLines)'));
check('al soltar al vecino, el paraguas y las bolsas se recogen', paseoTs.includes('actors?.setUmbrella(w.id, false)') && paseoTs.includes('actors?.setBags(w.id, false)'));

console.log('── 6. Bolsas de la compra al volver ──');
check('catálogo outdoor.bags (dos colores)', rules.view.outdoor?.bags?.colorA === '#d8c9a3');
check('actor: bolsas en las dos manos (hijas del nodo)', actorsTs.includes('_bolsas') && actorsTs.includes('bagsWant'));
check('taxi: vuelve SIEMPRE con bolsas; paseo, a veces (hash del teatro)', paseoTs.includes('w.bags = true;') && paseoTs.includes("hash01('paseo_compra', roll + w.lineIdx) < 0.35"));
check('línea cómica de la compra (bagsLines)', (street.outdoor?.bagsLines?.length ?? 0) >= 1);

console.log('── 7. Teatro del taxi ──');
check('catálogo view.taxi (recogida, carril, espera, vuelta)', rules.view.taxi?.enabled === true && typeof rules.view.taxi.stopX === 'number');
check('traffic: hailTaxi para EXACTO + releaseTaxi + taxiAvailable', trafficTs.includes('hailTaxi(stopX: number, onStopped: () => void)') && trafficTs.includes('releaseTaxi(): void') && trafficTs.includes('taxiAvailable(): boolean'));
check('parada con stage: se queda hasta que el teatro suelta', trafficTs.includes('stage: { stopAtX: stopX, stopped: false, onStopped }') && trafficTs.includes('a.stage = null;'));
check('paseo: hailT → crossTaxi → board (fade) → rideT → vuelta con bolsas', paseoTs.includes("'hailT'") && paseoTs.includes("'crossTaxi'") && paseoTs.includes("'board'") && paseoTs.includes("'rideT'") && paseoTs.includes("'crossTaxiBack'"));
check('cruce al taxi también frena a los coches (crossers en crossTaxi)', paseoTs.includes("w.fase === 'crossTaxi' || w.fase === 'crossTaxiBack'"));
check('líneas del taxi (hail/board/back) en el catálogo', (street.outdoor?.taxiHail?.length ?? 0) >= 1 && (street.outdoor?.taxiBoard?.length ?? 0) >= 1 && (street.outdoor?.taxiBack?.length ?? 0) >= 1);

console.log('── 8. Emoticonos arreglados (nada de flotantes sin dueño) ──');
check('viandantes: el emote es HIJO del nodo (viaja con el que lo lleva)', pedTs.includes('m.parent = node;') && pedTs.includes('m.position.set(0, w.gltf ? 1.75 : 1.62, 0);'));
check('recycle dispone los emotes vivos (nada reaparece en otra cabeza)', pedTs.includes('if (it.m.parent === node) {') && pedTs.includes('entry.meshes.splice(entry.meshes.indexOf(it), 1);'));
check('bubbles: cambio de cámara invalida oclusiones y reevalúa ya', srcOf('src/game/client/bubbles.ts').includes('unsubCam = useGameStore.subscribe') && srcOf('src/game/client/bubbles.ts').includes('b.occludedAt = 0;'));
check('regla de proximidad intacta (nearRadius 4, misma planta)', JSON.parse(srcOf('public/content/emotes.json')).bubble.nearRadius === 4);
check('fachada = vista general: sin lluvia de texto ni glifos lejanos', srcOf('src/game/client/bubbles.ts').includes("cam === 'edificio' || cam === 'fachada'"));

console.log('── 9. i18n cerrado (bocadillos y avisos en EN) ──');
const dict = JSON.parse(srcOf('public/content/translations.en.json'));
check('diccionario con say/crossings/outdoor/captions (+220 nuevas)', Object.keys(dict).length >= 1040, `${Object.keys(dict).length} cadenas`);
check('frase de actividad y caption en EN', dict['Zzz... el examen es a las 8... zzz...'] === 'Zzz... the exam is at 8... zzz...' && dict['*suspira*'] === '*sighs*');
check('línea outdoor en EN (taxi y accidente)', Object.values(dict).includes('Taxi! I\'m too old for stairs.') && Object.values(dict).includes('My back... and my dignity, lost to the crosswalk.'));
check('sounds.json entra en el pase del idioma (captions)', srcOf('src/game/support/i18n-content.ts').includes('if (content.sounds) walk(content.sounds);'));
check('TODOS los avisos duros del controlador van por translate()', ctrlTs.includes("translate(store.lang, 'ev.saved')") && ctrlTs.includes("translate(store.lang, 'ev.weatherChange'") && !ctrlTs.includes('pushToast(`Contenido inválido') && !ctrlTs.includes("pushLog('🗳️ Junta"));
check('nuevas claves ev.* con EN (guardado, clima, voto…)', dict === null ? false : srcOf('src/game/client/i18n.ts').includes("'ev.weatherChange': { es: 'El cielo cambia: {state}', en: 'The sky is changing: {state}' }"));

console.log('── 10. Decals bien recortados (II) ──');
check('decalMat pasa el alpha de la textura al shader (Babylon 8)', buildTs.includes('m.useAlphaFromDiffuseTexture = true;'));
check('decalTex recorta a la caja del contenido (pad 6 px)', buildTs.includes('const decalTex = (name: string, src: HTMLCanvasElement): Texture') && buildTs.includes('const b = alphaBoundsOf(src);'));
check('grafitis y manchas suben recortados', buildTs.includes("decalTex('decal_grafiti_tex', got.c)") && buildTs.includes("decalTex('decal_humedad_tex', got.c)"));
check('tipos: kinds de decay con Texture (sin errores TS)', buildTs.includes('tex: Texture | null;'));

console.log('── 11. Entrada directa a los locales (sin E, salvo vecinos) ──');
check('locales con auto-entrada: kind !== dwelling + no portal + sin candado', logicTs.includes("ahead.kind !== 'dwelling' && ahead.defId !== 'portal' && ahead.access !== 'locked'"));
check('tu vivienda sigue con auto-entrada propia (v1.40 intacta)', logicTs.includes("ahead.kind === 'dwelling' && ahead.ownerId === this.actorId"));
check('la E sigue mandando en viviendas ajenas (timbre) — sin autoentrada', !logicTs.includes("ahead.ownerId !== this.actorId"));

console.log('── Contenido completo (Zod, sin issues) + sim determinista ──');
const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
check('loadContent valida todos los catálogos con los campos nuevos', issues.length === 0, issues.length ? formatIssues(issues).slice(0, 200) : '0 issues');
const w1 = createWorld(content, 'slice');
for (let i = 0; i < 240; i++) tick(w1, content);
check('sim determinista tras el lote (240 ticks sin excepciones)', w1.clock.day >= 1);
check('street.outdoor pasa la validación Zod (líneas del teatro exterior)', (content.street?.outdoor?.exitLines?.length ?? 0) >= 1 && (content.street?.outdoor?.carHorn?.length ?? 0) > 0);
check('rules.view.outdoor/taxi/braking validados por Zod', content.rules.view.outdoor?.umbrella?.size === 1.02 && content.rules.view.taxi?.stopX === 4.4 && content.rules.view.traffic.braking.brakeDecel === 13);

console.log(`\n── RESULTADO: ${pass} pasan · ${fail} fallan ──`);
if (fail > 0) process.exit(1);
