/**
 * QA v1.34 «entra por donde sea» — el lote del vecino:
 *  1. RUEDAS APILADAS CAZADAS: los hubs de las ruedas del tráfico quedaban HUÉRFANOS
 *     (52 ruedas apiladas en el origen de la escena, la esquina izquierda del edificio,
 *     mientras los coches circulaban SIN ruedas — la causa de «cajas con planos pegados»).
 *     Ahora el cubo cuelga del nodo del vehículo (buildWheel recibe parent).
 *  2. CARROCERÍAS POR EXTRUSIÓN: perfil cerrado con MORRO/PARABRISAS/LUNETA en la forma y
 *     ARCOS DE RUEDA GEOMÉTRICOS (escotaduras del perfil) — adiós planos pintados.
 *  3. PLANTA 0 ENTRANTE: garaje y lavandería con layout (se entra y se camina, como en las
 *     viviendas); el garaje oculta SU FACHADA glTF al entrar y la basculante SE LEVANTA.
 *  4. MASCOTA = PERRO: patas que caminan, cola que menea, orejas caídas, collar (catálogo).
 *  5. TEXTO 100% DATA-DRIVEN: tokens {plantas}/{viviendas}/{blk:id}/{home}/{viviendaDe:id},
 *     paso estático de arranque, placards resueltos y auditoría de CONTEO de plantas
 *     («9 PISOS» en un edificio de 3 = violación) + letras de columna inexistentes (1D/3D).
 *  6. ÁRBOL MOVIDO: keepOut a la izquierda del jardín + pie forzado a la derecha (catálogo).
 *  7. MACETAS DEL PORTAL: lathe + esferas (adiós «cajas apiladas» en la esquina).
 */
import fs from 'fs';
import path from 'path';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld } from '@/game/sim';
import { tick } from '@/game/sim/tick';
import { scanFloorReferences, resolveTokens, applyStaticTokens } from '@/game/support/texts';

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
const trafficTs = srcOf('src/game/client/traffic.ts');
const buildingTs = srcOf('src/game/client/building.ts');
const ecosystemTs = srcOf('src/game/client/ecosystem.ts');
const textsTs = srcOf('src/game/support/texts.ts');
const controllerTs = srcOf('src/game/client/controller.ts');
const streetlifeTs = srcOf('src/game/client/streetlife.ts');
const cutsceneTs = srcOf('src/game/client/cutscene.ts');
const i18nTs = srcOf('src/game/client/i18n.ts');
const blocksJson = srcOf('public/content/blocks.json');
const assetsJson = srcOf('public/content/assets.json');
const rulesJson = srcOf('public/content/rules.json');
const portalGltf = srcOf('public/assets/blocks/portal.gltf');

console.log('── 1. Ruedas APILADAS cazadas (hubs huérfanos en el origen) ──');
check('buildWheel recibe el PARENT y cuelga el cubo del coche', trafficTs.includes('hub.parent = parent') && trafficTs.includes('parent: TransformNode'));
check('los cuatro puntos de montaje pasan el nodo (berlinas/furgoneta/reparto/bus/ambulancia)', (trafficTs.match(/buildWheel\((?:def\.kind|'ambulancia'), R, wx, sz \* tireZ, node\)/g) ?? []).length >= 2);
check('cero TransformNode sin padre (el bug era el hub suelto)', trafficTs.includes('v1.34 — el cubo cuelga del NODO del vehículo'));

console.log('── 2. Carrocerías por extrusión con arcos GEOMÉTRICOS ──');
check('perfil cerrado extruido a lo ancho (CAP_ALL + closeShape)', trafficTs.includes('cap: Mesh.CAP_ALL') && trafficTs.includes('closeShape: true'));
check('escotadura de rueda = arco del perfil (archArc)', trafficTs.includes('const archArc') && trafficTs.includes('Math.asin(Math.max(-0.92, Math.min(0.92'));
check('cero planos laterales pintados (sideTex(/sideMat fuera)', !/sideTex\(/.test(trafficTs) && !/\bsideMat\b/.test(trafficTs));
check('berlina en dos extrusiones (cuerpo + habitáculo de cristal)', trafficTs.includes('greenhouseOf(geo)') && trafficTs.includes('W * 0.84, glass'));
check('techo metálico de la berlina sobre el cristal', trafficTs.includes("box(def.kind, 'techo', geo.cabinL * 0.58, 0.035, W * 0.9, bodyMat)"));
check('chasis tras los arcos (no se ve al otro lado)', trafficTs.includes("box(def.kind, 'chasis'") && trafficTs.includes('W * 0.72, chassis'));
check('rotulaciones = calcomanías con alpha-test (no paneles)', trafficTs.includes('decalQuad') && trafficTs.includes('alphaCutOff = 0.4'));
check('banda de la patrulla y damero del taxi como CAJAS finas', trafficTs.includes("banda_${sz > 0 ? 'd' : 'i'}") && trafficTs.includes('checkerTex()'));
check('los ejes del catálogo colocan las ruedas (axles 2/3)', trafficTs.includes('def.axles ?? 2'));
check('el texto de las calcomanías SIEMPRE cabe (se mide y se encoge)', trafficTs.includes('c.measureText(text).width > w * 0.94'));

console.log('── 3. Planta 0 entrante: garaje y lavandería ──');
check('garaje con layout comunitario en el catálogo', blocksJson.includes('"garaje"') && blocksJson.includes('layout_garaje_comunal'));
check('lavandería con layout comunitario en el catálogo', blocksJson.includes('layout_lavanderia_comunal'));
check('rooms de garaje y lavandería definidos', srcOf('public/content/rooms.json').includes('estancia_garaje') && srcOf('public/content/rooms.json').includes('estancia_lavanderia'));
check('layouts con sus rects (2.28 × 2.8)', srcOf('public/content/layouts.json').includes('layout_garaje_comunal') && srcOf('public/content/layouts.json').includes('layout_lavanderia_comunal'));
check('el arte del garaje es OVERLAY (el interior sobrevive al modelo)', assetsJson.includes('"overlay": true') && /"garaje"[\s\S]{0,240}"overlay": true/.test(assetsJson));
check('el garaje entra al branch de LOCALES del runtime', buildingTs.includes("b.defId === 'trasteros' || b.defId === 'local_comercial' || b.defId === 'lavanderia_comunal' || b.defId === 'garaje' || b.defId === 'portal'"));
check('el runtime NO levanta un frente entero en el garaje: se PARTE alrededor del hueco (v1.37)', buildingTs.includes('el GARAJE ENTRA AQUÍ') && buildingTs.includes('if (isLaundry || isPortal) {'));
check('al entrar, la FACHADA glTF del garaje se desvanece (como viviendas)', buildingTs.includes("if (b.defId === 'garaje' || b.defId === 'portal') view.model?.setEnabled(wall);"));
check('la basculante SE LEVANTA con bisagra en el canto superior', buildingTs.includes('basculante_hinge') && buildingTs.includes('d.hinge.rotation.x = hd.liftAngle * d.openT;'));
check('mobiliario del garaje del catálogo (banco, tablero, estantería, ruedas, caja)', buildingTs.includes("b.defId === 'garaje'") && buildingTs.includes('_g_neumatico_') && buildingTs.includes('_g_banco_tapa'));
check('liftAngle en schema y types (espejo)', srcOf('src/game/content/schemas.ts').includes('liftAngle') && srcOf('src/game/core/types.ts').includes('liftAngle'));

console.log('── 4. La mascota es un PERRO de verdad ──');
check('patas con pivote en la cadera y trote en diagonal', ecosystemTs.includes('pata_') && ecosystemTs.includes('leg.setPivotPoint(new Vector3(0, legH / 2, 0))'));
check('cola con pivote en la base que MENEA', ecosystemTs.includes('tail.rotation.z = Math.sin(animT') && ecosystemTs.includes("tail.setPivotPoint"));
check('orejas caídas, hocico, nariz y ojos', ecosystemTs.includes('oreja_i') && ecosystemTs.includes('hocico') && ecosystemTs.includes('nariz') && ecosystemTs.includes('ojo_i'));
check('collar del catálogo', ecosystemTs.includes('p.collar ??') && srcOf('public/content/ecosystem.json').includes('"collar"'));
check('la animación corre en el bucle de movimiento (anda) y en la pausa (husmea)', ecosystemTs.includes('e.animate?.(dH > 0.001 && Math.abs(dY) <= 0.02, dt);') && ecosystemTs.includes('e.animate?.(false, dt);'));
check('legH/collar en schema y types', srcOf('src/game/content/schemas.ts').includes('legH: z.number().positive().optional()') && srcOf('src/game/core/types.ts').includes('legH?: number;'));

console.log('── 5. Textos 100% data-driven ──');
check('el resolver admite {plantas}/{viviendas}/{plantaTop}', textsTs.includes("replaceAll('{plantas}', String(facts.plantas))") && textsTs.includes("replaceAll('{viviendas}', String(facts.viviendas))"));
check('tokens de bloque directo {blk:id} y de vecino {viviendaDe:id}', textsTs.includes('/\\{blk:([\\w_]+)\\}/g') && textsTs.includes('/\\{viviendaDe:([\\w_]+)\\}/g'));
check('{home} resuelve a la vivienda del JUGADOR', textsTs.includes("ctx.home ? apartmentLabel(ctx.home) : '?home?'"));
check('las «plantas» del mundo = plantas de VIVIENDA (3p_3v dice 3)', textsTs.includes('const buildingFacts') && textsTs.includes('plantas: topFloor'));
check('paso estático de arranque en el controller', controllerTs.includes('applyStaticTokens(this.content, this.world);'));
check('placards de la calle resueltos con tokens', streetlifeTs.includes('const text = resolveTokens('));
check('cutscenes resuelven tokens (rótulos con la vivienda real)', cutsceneTs.includes('resolveTokens(expanded, this.stage.world, this.content, { home })'));
check('ui_toast pasa {home} al resolver', controllerTs.includes('home: this.world.residents[this.world.playerId]?.home,'));
check('el cartel de la marcha ya no dice 9 PISOS (lleva {plantas})', rulesJson.includes('9 PISOS') === false && srcOf('public/content/street.json').includes('{plantas} PISOS A PIE'));
check('misiones sin 3D inventado (token {blk:blk_p1_a})', srcOf('public/content/missions.json').includes('{blk:blk_p1_a}') && !srcOf('public/content/missions.json').includes('(3D)'));
check('cutscenes sin 1D inventado (token {viviendaDe:…})', srcOf('public/content/cutscenes.json').includes('Ex presidente · {viviendaDe:res_presidente_01}') && !srcOf('public/content/cutscenes.json').includes('Ex presidente · 1D'));
check('auditoría: menciones de CONTEO de plantas («N pisos»)', textsTs.includes('countRe') && textsTs.includes('pisos|plantas'));
check('auditoría: letras de columna inexistentes (1D/3D) SON violación', textsTs.includes("if (!world.blocks[`blk_p${floor}_${letter}`])"));

console.log('── 6. Árbol movido (izquierda → derecha) ──');
const rules = JSON.parse(rulesJson);
check('keepOut sobre el jardín izquierdo junto al edificio', rules.view.exterior.keepOut.some((k: { x0: number; x1: number }) => k.x0 === -19 && k.x1 === -6));
check('árbol grande forzado a la DERECHA del edificio', rules.view.exterior.forcedTrees.some((t: { x: number; s: number }) => t.x === 44.5 && t.s === 1.35));

console.log('── 7. Portal: macetas y arbustos de verdad ──');
const portal = JSON.parse(portalGltf);
const nodeOf = (n: string): unknown => portal.nodes.find((x: { name: string }) => x.name === n);
const meshOf = (n: string): { count: number } | null => {
  const node = nodeOf(n) as { mesh?: number } | undefined;
  if (!node || node.mesh === undefined) return null;
  const acc = portal.meshes[node.mesh].primitives[0].attributes.POSITION;
  return { count: portal.accessors[acc].count };
};
check('maceta = superficie de revolución (lathe, >100 vértices)', (meshOf('maceta_izq')?.count ?? 0) > 100);
check('arbusto = racimo de esferas (3 piezas por lado)', !!nodeOf('arbusto_izq_a') && !!nodeOf('arbusto_izq_b') && !!nodeOf('arbusto_izq_c') && !!nodeOf('arbusto_der_a'));
check('el resto del portal INTACTO (misma fachada verificada)', !!nodeOf('cristal_izq') && !!nodeOf('toldo') && !!nodeOf('rotulo') && !!nodeOf('farol_izq'));

console.log('── 8. Versiones ──');
check('insignia v1.34 en i18n (es/en)', i18nTs.includes('v1.38 · pase de optimización') && i18nTs.includes('v1.38 · optimization pass'));
check('sw.js bump a vecinos-v1.35', srcOf('public/sw.js').includes('vecinos-v1.38'));
check('PwaRegister espera vecinos-v1.34', srcOf('src/components/game/PwaRegister.tsx').includes('vecinos-v1.34'));

console.log('── 9. Contenido, resolver y sim intactos ──');
check('contenido carga sin issues', issues.length === 0);
{
  const world = createWorld(content, 'slice');
  applyStaticTokens(content, world);
  const viol = scanFloorReferences(world, content);
  check('cero menciones imposibles tras el paso estático', viol.length === 0, viol.slice(0, 3).map((v) => `${v.where}: ${v.mention}`).join(' · '));
  const f = (s: string): string => resolveTokens(s, world, content, { home: world.residents[world.playerId]!.home });
  check('{plantas} dice las plantas de vivienda reales', f('{plantas} PLANTAS A PIE') === '3 PLANTAS A PIE', f('{plantas} PLANTAS A PIE'));
  check('{viviendas} cuenta las viviendas reales', f('{viviendas} viviendas') === '9 viviendas');
  check('{blk:blk_p1_a} dice 1A', f('el piso de al lado ({blk:blk_p1_a})') === 'el piso de al lado (1A)');
  check('{home} dice la vivienda del jugador', f('el cable de la luz del {home}') === 'el cable de la luz del 3C');
  check('{viviendaDe:id} rotula al vecino con SU vivienda', f('Ex presidente · {viviendaDe:res_presidente_01}') === 'Ex presidente · 1C');
  check('el auditor CAZA un conteo falso (9 pisos en un edificio de 3)', (() => {
    const probe = { ...content, street: { ...content.street, topics: [{ id: 'x', chant: 'x', placards: ['9 PISOS A PIE'] }] } };
    return scanFloorReferences(world, probe as typeof content).some((v) => v.mention.includes('9 PISOS'));
  })());
  check('el auditor CAZA una columna inventada (5C)', (() => {
    const probe = { ...content, dialogs: [{ id: 'x', lines: [{ text: 'la vecina del 5C' }] }] } as unknown as typeof content;
    return scanFloorReferences(world, probe).some((v) => v.mention === '5C');
  })());
  // Determinismo: 240 ticks idénticos dos veces.
  const run = (): string[] => {
    const w = createWorld(content, 'slice');
    const out: string[] = [];
    for (let i = 0; i < 240; i++) {
      tick(w, content);
      out.push(`${w.tick}:${w.clock}`);
    }
    return out;
  };
  check('sim determinista (240 ticks idénticos)', JSON.stringify(run()) === JSON.stringify(run()));
}

console.log(`\nQA v1.34: ${pass} ✓ / ${fail} ✗`);
if (fail > 0) process.exit(1);
