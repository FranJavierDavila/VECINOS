/**
 * QA v1.84 "calidad máxima + recomendaciones + medidores" — la tanda del vecino:
 *  1. PUERTAS DE ESCALERA: canon v1.84 — MODERNAS GRISES (door_moderna_gris.png) en
 *     schemas Zod (3 defaults) y en rules.json servido; número de planta claro.
 *  2. RENDIMIENTO: calidad por defecto 'alta' (escala nativa) con migración única
 *     del 'normal' de fábrica; el auto-ajuste recupera SIEMPRE hasta S0 (adiós
 *     MAX_MODE_FLOOR), la resolución se degrada AL FINAL de la escalera y el modo
 *     'máximo' apunta a calidad completa con suelo de 30 FPS.
 *  3. RECOMENDACIONES: support/recommendations.ts (puro, orden por prioridad,
 *     tope 4, fallback 'explore') + RecommendationsPanel enchufado en Misiones.
 *  4. MEDIDORES: reputación con barra en el HUD (data-rep-meter) y afinidad/confianza
 *     con barras en Vecinos (trustView -100..100 → 0..100 con el 0 al 50%).
 *  5. VERSIONES espejadas v1.84 (sw/PwaRegister/banner).
 *  + Sim determinista intacto (240 ticks).
 */
import fs from 'fs';
import path from 'path';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld } from '@/game/sim';
import { tick } from '@/game/sim/tick';
import { recommendationsOf, type RecoInput } from '@/game/support/recommendations';

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
const optionsTs = srcOf('src/game/client/options.ts');
const perfTs = srcOf('src/game/client/perf.ts');
const infoDockTs = srcOf('src/components/game/InfoDock.tsx');
const recoPanelTs = srcOf('src/components/game/RecommendationsPanel.tsx');
const recoSupportTs = srcOf('src/game/support/recommendations.ts');
const hudTs = srcOf('src/components/game/HudBar.tsx');
const residentsTs = srcOf('src/components/game/ResidentsPanel.tsx');
const i18nTs = srcOf('src/game/client/i18n.ts');
const rulesJson = srcOf('public/content/rules.json');
const schemasTs = srcOf('src/game/content/schemas.ts');

console.log('── 1. Puertas de escalera: modernas grises en TODA la cadena ──');
const artRefs = [rulesJson, schemasTs].filter((s) => s.includes('art/interiors/raw/door_moderna_gris.png'));
check('rules.json + schemas.ts apuntan a la puerta gris', artRefs.length === 2, `${artRefs.length}/2`);
check('schemas ya NO usa el cartoon en la escalera', !/stairs[\s\S]{0,400}?door_comunal/.test(schemasTs));
check('numberColor claro #f4f4f5 en schemas', (schemasTs.match(/#f4f4f5/g) ?? []).length >= 3);
check('el runtime rota el color del número (stF.numberColor)', /stF\.numberColor/.test(srcOf('src/game/client/building.ts')));

console.log('── 2. Rendimiento: calidad máxima con suelo de 30 FPS ──');
check("DEFAULT_OPTIONS.quality = 'alta'", /quality: 'alta'/.test(optionsTs));
check('migración única del normal de fábrica (optsVer)', /optsVer/.test(optionsTs) && /legacyNormal/.test(optionsTs));
check("el modo 'max' promete el suelo de 30 (TARGET_FPS)", /max: 30/.test(perfTs));
check('adiós MAX_MODE_FLOOR (el piso SIEMPRE es S0)', !perfTs.includes('MAX_MODE_FLOOR'));
check("setTarget('max') ya no exprime al arrancar", !/setTarget[\s\S]{0,600}setLevel\(MAX/.test(perfTs));
check('recuperación rápida: UP_SAMPLES = 2 y cooldown 6000', /UP_SAMPLES = 2/.test(perfTs) && /COOLDOWN_UP = 6000/.test(perfTs));
const ladderMatch = perfTs.match(/const LADDER: readonly Rung\[\] = \[([\s\S]*?)\];/);
check('escalera de 9 peldaños', !!ladderMatch && (ladderMatch[1]!.match(/\{ scale:/g) ?? []).length === 9);
// La resolución (lo que el vecino nota) se tocha AL FINAL: los 3 primeros peldaños con glow.
check('S0..S2 mantienen el glow (la resolución se toca al final)', !!ladderMatch && (ladderMatch[1]!.split('{ scale:').slice(1, 4).every((s) => s.includes('glow: true'))));
check('el primer salto de resolución es suave (×1.12)', !!ladderMatch && ladderMatch[1]!.includes('scale: 1.12'));

console.log('── 3. Recomendaciones: soporte puro + panel en Misiones ──');
check('RecommendationsPanel enchufado en InfoOverlay', infoDockTs.includes('<RecommendationsPanel />'));
check('el panel consume support/recommendations (sin lógica duplicada)', recoPanelTs.includes('recommendationsOf'));
check('i18n: título y claves de recomendaciones (es/en)', i18nTs.includes("'reco.title'") && i18nTs.includes("'reco.neighbor'"));

const baseInput: RecoInput = {
  elevator: 'ok',
  reputation: 55,
  funds: 400,
  missions: [],
  campaign: null,
  neighbors: [],
};
const quiet = recommendationsOf(baseInput);
check('silencio → consejo genérico de paseo', quiet.length === 1 && quiet[0]!.kind === 'explore');

const decisionFirst = recommendationsOf({
  ...baseInput,
  missions: [
    { id: 'm1', title: 'El mural', state: 'active', remaining: null },
    { id: 'm2', title: 'La antena', state: 'awaiting_choice', remaining: null },
  ],
});
check('la decisión pendiente va PRIMERO', decisionFirst[0]!.kind === 'decision' && decisionFirst[0]!.vars.title === 'La antena');

const crisis = recommendationsOf({
  ...baseInput,
  elevator: 'roto',
  reputation: 30,
  funds: 80,
  campaign: { active: true, over: false, dayOfTerm: 3, termDays: 7 },
  missions: [{ id: 'm1', title: 'Laazotea', state: 'active', remaining: '2 pistas' }],
  neighbors: [{ id: 'r1', name: 'Doña Marisa', affinity: 22 }],
});
const kinds = crisis.map((r) => r.kind);
check('crisis completa: ascensor detectado', kinds.includes('elevator'));
check('crisis completa: arcas justas detectadas', kinds.includes('funds') && crisis.find((r) => r.kind === 'funds')!.vars.n === 80);
check('crisis completa: reputación baja detectada', kinds.includes('repLow') && crisis.find((r) => r.kind === 'repLow')!.vars.n === 30);
check('crisis completa: mandato con día/término', kinds.includes('mandate') && crisis.find((r) => r.kind === 'mandate')!.vars.d === 3);
check('tope de 4 recomendaciones (6 reglas → 4 primeras)', crisis.length === 4, String(crisis.length));
check('la prioridad corta ANTES que misión/vecino', !kinds.includes('mission') && !kinds.includes('neighbor'));

const seguimiento = recommendationsOf({
  ...baseInput,
  missions: [{ id: 'm1', title: 'Laazotea', state: 'active', remaining: '2 pistas' }],
  neighbors: [{ id: 'r1', name: 'Doña Marisa', affinity: 22 }],
});
const kinds2 = seguimiento.map((r) => r.kind);
check('crisis ligera: misión activa con lo que falta', kinds2.includes('mission') && String(seguimiento.find((r) => r.kind === 'mission')!.vars.rest).includes('2 pistas'));
check('crisis ligera: vecino frío por afinidad', kinds2.includes('neighbor') && seguimiento.find((r) => r.kind === 'neighbor')!.vars.name === 'Doña Marisa');

const beloved = recommendationsOf({ ...baseInput, reputation: 90 });
check('reputación alta → felicitación', beloved.some((r) => r.kind === 'repHigh'));
const deterministic = recommendationsOf({ ...baseInput, elevator: 'roto', reputation: 30, funds: 80 });
check('determinismo (misma entrada, misma salida)', JSON.stringify(deterministic) === JSON.stringify(recommendationsOf({ ...baseInput, elevator: 'roto', reputation: 30, funds: 80 })));

console.log('── 4. Medidores de reputación/afinidad/confianza ──');
check('HUD: barra de reputación (data-rep-meter)', hudTs.includes('data-rep-meter'));
check('HUD: aria del medidor con el valor', hudTs.includes('hud.repMeter'));
check('Vecinos: medidor de afinidad (0..100)', residentsTs.includes('neighbors.affinityMeter') && residentsTs.includes('aff.pct'));
check('Vecinos: confianza -100..100 con el 0 al 50%', residentsTs.includes('trustView') && residentsTs.includes('(v + 100) / 2'));
check('i18n: claves de medidores (es/en)', i18nTs.includes("'neighbors.trustMeter'") && i18nTs.includes("'hud.repMeter'"));
check('recoSupport puro sin importar el store', !recoSupportTs.includes('useGameStore') && !recoSupportTs.includes("@/game/client"));

console.log('── 5. Versiones espejadas v1.84 ──');
check('sw.js VERSION = vecinos-v1.84', srcOf('public/sw.js').includes('vecinos-v1.84'));
check('PwaRegister espeja v1.84', srcOf('src/components/game/PwaRegister.tsx').includes('vecinos-v1.84'));
check('banner i18n v1.84 (es)', i18nTs.includes('v1.84 · puertas de escalera modernas grises'));

console.log('── 6. Sim determinista (240 ticks) ──');
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
check('determinismo (240 ticks idénticos)', hashes.join('|') === hashes2.join('|'), hashes[hashes.length - 1] ?? '');

console.log(`\nqa-v184: ${pass} ✓ / ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
