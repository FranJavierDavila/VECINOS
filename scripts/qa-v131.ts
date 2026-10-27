/**
 * QA v1.31 "tráfico con oficio" — el vecino: «mejora esos vehículos que circulan por
 * las calles que parecen cajones andantes, haz unos modelos de vehículos bastante más
 * detallados». Verificación en frío del tráfico rehecho:
 *  1. CATÁLOGO: seis tipos (coche, taxi, furgoneta, reparto, bus, patrulla) con pesos
 *     de ruleta y DETALLE data-driven (plate/sideText/destSign/roofSign/roofRack/axles).
 *  2. MODELOS MULTI-PIEZA: rueda = neumático + llanta + radios en cruz bajo un cubo que
 *     GIRA (spin = v/R); parabrisas y lunetas inclinados con cristal propio; paragolpes,
 *     parrilla, retrovisores y bajos (chasis que cierra la vista bajo el cuerpo).
 *  3. COSTADOS PINTADOS por (tipo, color) a canvas — ventanas con brillo, juntas,
 *     tiradores, arcos de rueda y rotulaciones — y el plano SIEMPRE fuera del semiancho
 *     real del cuerpo (la primera versión lo enterró en furgoneta/bus/reparto: se veía
 *     el casco liso = «cajón»). Regla de la casa: nada coplanar (+14 mm).
 *  4. MATRÍCULAS y RÓTULOS a canvas (convención invertY de la casa), cartel de TAXI en
 *     el techo, rótulo de destino del bus bajo el canto del tejadillo.
 *  5. FAROS DE NOCHE: la luz de día del cielo manda (umbral del catálogo de código);
 *     faros #fff1c2 y pilotos #d43a2a se encienden al anochecer (bloom del GlowLayer),
 *     y la sirena de la patrulla alterna rojo/azul como siempre.
 *  6. NUEVOS ACTORES: taxi (cartel de techo) y camión de reparto (caja con rótulo y
 *     rueda doble = 3 ejes).
 * + Sim intacto: 240 ticks deterministas tras tocar solo presentación/contenido.
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
const tr = content.rules.view.traffic;
const trafficTs = srcOf('src/game/client/traffic.ts');
const schemasTs = srcOf('src/game/content/schemas.ts');
const typesTs = srcOf('src/game/core/types.ts');
const controllerTs = srcOf('src/game/client/controller.ts');
const i18nTs = srcOf('src/game/client/i18n.ts');
const swJs = srcOf('public/sw.js');
const pwaTsx = srcOf('src/components/game/PwaRegister.tsx');

const kinds = new Map(tr.vehicles.map((d) => [d.kind, d]));

console.log('── 1. Catálogo: seis tipos con detalle ──');
check('seis tipos de vehículo', tr.vehicles.length === 6, tr.vehicles.map((d) => d.kind).join(' / '));
check('pesos de ruleta suman ~1', Math.abs(tr.vehicles.reduce((s, d) => s + d.chance, 0) - 1) < 0.02);
check('carriles de ambos sentidos', tr.lanes.length >= 2 && tr.lanes.some((l) => l.dir > 0) && tr.lanes.some((l) => l.dir < 0));
const coche = kinds.get('coche');
const taxi = kinds.get('taxi');
const furgo = kinds.get('furgoneta');
const reparto = kinds.get('reparto');
const bus = kinds.get('bus');
const policia = kinds.get('policia');
check('coche con matrícula', !!(coche && coche.plate && coche.colors.length >= 3), coche?.plate);
check('taxi con cartel de techo', !!(taxi && taxi.roofSign === 'TAXI'), taxi?.plate);
check('furgoneta con rotulación y parrilla de techo', !!(furgo && furgo.sideText && furgo.roofRack), furgo?.sideText);
check('reparto con caja rotulada y rueda doble (3 ejes)', !!(reparto && reparto.sideText && reparto.axles === 3), reparto?.sideText);
check('bus con rótulo de destino y línea en el costado', !!(bus && bus.destSign && bus.sideText), bus?.destSign);
check('patrulla con rotulación POLICÍA y sirena', !!(policia && policia.sideText === 'POLICÍA' && policia.siren));

console.log('── 2. Esquema y tipos en espejo (campos v1.31) ──');
for (const f of ['plate', 'sideText', 'destSign', 'roofSign', 'roofRack', 'axles']) {
  check(`schema acepta vehicles[].${f}`, schemasTs.includes(`${f}: z.`));
  check(`types declara vehicles[].${f}?`, typesTs.includes(`${f}?:`));
}

console.log('── 3. Modelos multi-pieza (adiós cajones) ──');
check('rueda = cubo que gira + neumático + llanta + radios en cruz', /buildWheel/.test(trafficTs) && trafficTs.includes('_cubo_') && trafficTs.includes('_llanta_') && trafficTs.includes('_radio_'));
check('neumático redondo de verdad (tessellation ≥ 18)', /tessellation: 18/.test(trafficTs));
check('spin = v/R alrededor del eje (ruedas que giran con la marcha)', trafficTs.includes('hub.rotation.z -= spin') && trafficTs.includes('geos[a.defIndex]!.R'));
check('parabrisas inclinado con cristal propio', trafficTs.includes("'parabrisas'") && trafficTs.includes('rotation.z = -0.5'));
check('luneta trasera inclinada', trafficTs.includes("'luneta'"));
check('paragolpes delante/detrás + parrilla', trafficTs.includes("'paragolpes_del'") && trafficTs.includes("'paragolpes_tras'"));
check('retrovisores sobre el pilar A', trafficTs.includes("'retro'"));
check('bajos: chasis que cierra la vista bajo el cuerpo', trafficTs.includes("'bajos'") && trafficTs.includes('chassis'));

console.log('── 4. Costados pintados y NUNCA enterrados ──');
check('Geo.sideHalf por estilo (el semiancho real del cuerpo)', trafficTs.includes('sideHalf') && trafficTs.includes('sideHalf: W * 0.49') && trafficTs.includes('sideHalf: W * 0.47') && trafficTs.includes('sideHalf: W * 0.46') && trafficTs.includes('sideHalf: W * 0.44'));
check('plano lateral PROUD del casco (+14 mm, nada coplanar)', trafficTs.includes('const sideOff = geo.sideHalf + 0.014;'));
check('costado pintado a canvas por (tipo, color) con caché', trafficTs.includes('sideTex') && trafficTs.includes('`side:${def.kind}:${hex}`'));
check('ventanas pintadas #2e3a44 con brillo', trafficTs.includes("'#2e3a44'") && trafficTs.includes('rgba(255,255,255,0.16)'));
check('arcos de rueda pintados tras el neumático', trafficTs.includes("'#1d1a17'") && trafficTs.includes('geo.R * 1.3 * S'));
check('cotas compartidas geometría ↔ pintado (una sola verdad)', trafficTs.includes('const geos = cfg.vehicles.map((d) => geoOf(d));'));
check('bus: banda de ventanas con pilares y puerta doble', /nWin = 7/.test(trafficTs) && trafficTs.includes('Puerta doble'));
check('patrulla: banda azul con POLICÍA en el costado', trafficTs.includes("'#286090'"));
check('taxi: franja dama bajo las ventanas', trafficTs.includes('Franja dama del taxi'));

console.log('── 5. Matrículas y rótulos (convención de la casa) ──');
check('DynamicTexture con update(true) (invertY del proyecto)', trafficTs.includes('dt.update(true)'));
check('matrícula delante y detrás con el texto del catálogo', trafficTs.includes('plateTex(def.plate)') && trafficTs.includes('pf.rotation.y = -Math.PI / 2'));
check('cartel de TAXI emisivo en el techo', trafficTs.includes('def.roofSign') && trafficTs.includes("'#ffd166'"));
check('rótulo de destino del bus frente al morro', trafficTs.includes('def.destSign') && trafficTs.includes('bajo el canto del tejadillo'));
check('signos en la lista de emisivos nocturnos', trafficTs.includes('signs: StandardMaterial[]'));

console.log('── 6. Faros de noche con la luz del cielo ──');
check('umbral nocturno y lectura de daylight del backdrop', trafficTs.includes('NIGHT_DAYLIGHT') && trafficTs.includes('daylight?.()'));
check('controller pasa la luz de día al tráfico', controllerTs.includes('createTraffic(this.scene, this.world, this.content, () => this.backdrop?.daylight ?? 1)'));
check('faros encendidos de noche (#fff1c2 ×1) y apagados de día (×0.12)', trafficTs.includes("night ? 1 : 0.12"));
check('pilotos traseros nocturnos (#d43a2a ×0.85)', trafficTs.includes("night ? 0.85 : 0.18"));
check('sirena rojo/azul alternando (patrulla)', trafficTs.includes("Color3.FromHexString('#c0392b').scale(on ? 1 : 0.2)"));
check('matrícula sin emissive pero con textura (sin negros de alpha)', trafficTs.includes('pm.diffuseTexture = plateTex(def.plate)'));

console.log('── 7. Versiones ──');
check('insignia v1.31 en i18n (es/en)', i18nTs.includes('v1.31 · tráfico con oficio') && i18nTs.includes('v1.31 · traffic with craft'));
check('sw.js bump a vecinos-v1.31', swJs.includes("vecinos-v1.31"));
check('PwaRegister espera vecinos-v1.31', pwaTsx.includes('vecinos-v1.31'));

console.log('── Sim intacto ──');
const world = createWorld(content, 'slice');
const hashes: string[] = [];
for (let i = 0; i < 240; i++) {
  tick(world, content);
  if (i % 60 === 0) hashes.push(JSON.stringify([world.tick, world.funds, Object.keys(world.residents).length]));
}
const world2 = createWorld(content, 'slice');
const hashes2: string[] = [];
for (let i = 0; i < 240; i++) {
  tick(world2, content);
  if (i % 60 === 0) hashes2.push(JSON.stringify([world2.tick, world2.funds, Object.keys(world2.residents).length]));
}
check('determinismo (240 ticks idénticos)', hashes.join('|') === hashes2.join('|'));

console.log(`\nQA v1.31: ${pass} ✓ / ${fail} ✗`);
if (fail > 0) process.exit(1);
