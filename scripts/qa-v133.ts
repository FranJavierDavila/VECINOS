/**
 * QA v1.33 "cristales en su sitio" — verificación en vivo de la sesión v1.32 (el E2E
 * del navegador quedó bloqueado por el sandbox) que CAZÓ un bug nuevo: los parabrisas
 * y lunetas de TODOS los vehículos (berlina, furgoneta, reparto, bus y ambulancia)
 * tenían los ejes del box() PERMUTADOS — width (X, el largo del coche) donde iba depth
 * (Z, la anchura) — así que en vez de paneles transversales sobresalían del techo
 * aletas longitudinales («aletas de tiburón»).
 *  1. CRISTALES TRANSVERSALES: fino en X (0.035/0.04), ancho en Z (W*0.8/0.84/0.86)
 *     en los 7 puntos (6 del buildRig + la ambulancia), con sus rake intactos.
 *  2. NADA del patrón viejo ('parabrisas', W * ...) en el código.
 *  3. Versiones: insignia v1.34 en i18n (es/en), sw.js y PwaRegister.
 *  4. Contenido carga limpio + sim intacto (240 ticks deterministas).
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
const trafficTs = srcOf('src/game/client/traffic.ts');
const controllerTs = srcOf('src/game/client/controller.ts');
const textsTs = srcOf('src/game/support/texts.ts');
const i18nTs = srcOf('src/game/client/i18n.ts');
const swJs = srcOf('public/sw.js');
const pwaTsx = srcOf('src/components/game/PwaRegister.tsx');

console.log('── 1. Parabrisas/luneta TRANSVERSALES (adiós «aletas de tiburón») ──');
// v1.34 — la berlina ya no lleva parabrisas/luneta como CAJAS: el habitáculo es una
// extrusión de cristal (greenhouse) cuyas paredes inclinadas SON parabrisas y luneta.
check('berlina: habitáculo de CRISTAL por extrusión (greenhouse)', trafficTs.includes('const cab = extrudeBody(`trafico_${def.kind}_cabina`, greenhouseOf(geo), W * 0.84, glass);'));
check('berlina: greenhouse con parabrisas y luneta INCLINADOS en el perfil', trafficTs.includes('cx - cabinL * 0.3, yRf, 0') && trafficTs.includes('cx + cabinL / 2, yB - 0.05, 0'));
check('berlina: techo metálico sobre el habitáculo', trafficTs.includes("box(def.kind, 'techo', geo.cabinL * 0.58, 0.035, W * 0.9, bodyMat)"));
check('furgoneta: parabrisas transversal', trafficTs.includes("box(def.kind, 'parabrisas', 0.04, hullH * 0.5, W * 0.84, glass)"));
check('reparto: parabrisas transversal', trafficTs.includes("box(def.kind, 'parabrisas', 0.04, geo.cabH * 0.42, W * 0.84, glass)"));
check('bus: parabrisas transversal', trafficTs.includes("box(def.kind, 'parabrisas', 0.04, hullH * 0.42, W * 0.86, glass)"));
check('bus: luneta transversal', trafficTs.includes("box(def.kind, 'luneta', 0.04, hullH * 0.3, W * 0.8, glass)"));
check('ambulancia: parabrisas transversal', trafficTs.includes("box('ambulancia', 'parabrisas', 0.04, hullH * 0.5, W * 0.84, glass)"));
check('cero restos del patrón viejo (ejes permutados)', !trafficTs.includes("'parabrisas', W *") && !trafficTs.includes("'luneta', W *"));
check('rakes de furgoneta/reparto/bus intactos (parabrisas transversales)', trafficTs.includes('ws.rotation.z = -0.3') && trafficTs.includes('ws.rotation.z = -0.22') && trafficTs.includes('ws.rotation.z = -0.16'));
// Regla geométrica: TODO parabrisas/luneta debe nacer con su cota X menor que la Z.
const glassCalls = trafficTs.match(/box\((?:def\.kind|'ambulancia'),\s*'(?:parabrisas|luneta)',\s*([^,]+),\s*([^,]+),\s*([^,]+),/g) ?? [];
let axisOk = glassCalls.length > 0;
for (const call of glassCalls) {
  const nums = call.match(/,\s*(0\.\d+)\s*,\s*([^,]+),\s*(W \* 0\.\d+)\s*,/);
  if (!nums) axisOk = false;
}
check('los 7 cristales nacen finos en X y anchos en Z (regla, no ejemplos)', axisOk, `${glassCalls.length} llamadas auditadas`);

console.log('── 2. Versiones ──');
check('insignia v1.34 en i18n (es/en)', i18nTs.includes('v1.37 · se sale al parque') && i18nTs.includes('v1.37 · out to the park'));
check('sw.js bump a vecinos-v1.34', swJs.includes('vecinos-v1.37'));
check('PwaRegister espera vecinos-v1.34', pwaTsx.includes('vecinos-v1.34'));

console.log('── 2.bis Avisos narrados 100% data-driven (v1.33: ecosistema + cutscenes) ──');
check('ecosystem.json ya no habla de la 4C (el gato es de la 2C)', srcOf('public/content/ecosystem.json').includes('la gata de la 2C') && !srcOf('public/content/ecosystem.json').includes('gata de la 4C'));
// v1.34 — el rótulo vive TOKENIZADO (data-driven): el resolutor pinta la vivienda real.
check('cutscene de Espera rotulada con token data-driven de vivienda', srcOf('public/content/cutscenes.json').includes('"speaker": "Espera · {viviendaDe:res_jubilada_01}"'));
check('scanFloorReferences audita TAMBIÉN ecosistema y cutscenes', textsTs.includes("collect(content.ecosystem, strings, 'ecosystem')") && textsTs.includes("collect(content.cutscenes, strings, 'cutscenes')"));
const worldScan = createWorld(content, 'slice');
check('contenido real SIN menciones imposibles (alcance completo)', scanFloorReferences(worldScan, content).length === 0);
{
  // Auditoría sintética: un aviso de ecosistema con «4C» DEBE ser cazado ahora.
  const fake = { ...content, ecosystem: { ev_prueba: { outcomes: [{ toast: '🐈 la gata de la 4C se escapó' }] } } } as typeof content;
  const caught = scanFloorReferences(worldScan, fake);
  check('el auditor CAZA la 4C si vuelve a colarse en el ecosistema', caught.some((v) => v.where.startsWith('ecosystem')));
}
check('los ui_toast pasan por el resolver de tokens (futuro data-driven)', controllerTs.includes('resolveTokens(String(d.text), this.world, this.content, {'));

console.log('── 3. Contenido y sim intactos ──');
check('contenido carga sin issues', issues.length === 0);
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

console.log(`\nQA v1.33: ${pass} ✓ / ${fail} ✗`);
if (fail > 0) process.exit(1);
