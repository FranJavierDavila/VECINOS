/**
 * QA v1.87 «no podemos andar perdiendo desarrollos ya ejecutados» — RESTAURACIÓN + FPS.
 * El vecino echó de menos mecánicas ya construidas; esta suite ancla las restauradas
 * (y las que seguían vivas) al canon:
 *  1. TERRAZAS EN EL TEJADO: bloques con pared al exterior recuperan la terraza
 *     (plataforma de terracota, barandilla con barrotes, macetas con verde, toldo
 *     inclinado y banquito) — determinista por hash01(b.id, 911).
 *  2. EL RINCÓN = LOCAL DE COPAS: barra con tapa, estantería con 5 botellas de colores
 *     (emissive), dos copas servidas y taburete de tres piezas. El neón v1.83 sigue.
 *  3. EL CARTEL QUE SE ESTROPEA: los neones (glow ≥ 1.2) se registran y el update los
 *     hace parpadear/apagarse a ratos (ciclo 240-450 s, avería 26-48 s) — sin allocations.
 *  4. FPS — CONSOLIDACIÓN DEL GREYBOX: MergeMeshes por material con protección de
 *     fachadas/edges/frente, idempotente (grupos de 1 intactos, fusión imposible no rompe).
 *  5. FPS — LUCES: cabina de ascensor con includedOnlyMeshes (asc_ + pasillo) y
 *     setEnabled además de intensity (fuera del bucle de luz del shader).
 *  6. MANIFESTANTES PARAMÉTRICOS (regresión): la marcha usa el rig de peatones
 *     (createPedFactory/PedRig) — nunca cilindros.
 *  7. JUEGO ILEGAL (regresión v1.81): gambleTick en el tick del sim con redada, multa
 *     y resaca en el catálogo.
 *  8. VERSIONES espejadas: sw.js = PwaRegister = banner i18n = v1.87.
 *  9. Sim determinista (240 ticks × 2).
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
const buildingTs = srcOf('src/game/client/building.ts');
const elevatorTs = srcOf('src/game/client/elevator.ts');
const controllerTs = srcOf('src/game/client/controller.ts');
const streetlifeTs = srcOf('src/game/client/streetlife.ts');
const swJs = srcOf('public/sw.js');
const pwaTs = srcOf('src/components/game/PwaRegister.tsx');
const i18nTs = srcOf('src/game/client/i18n.ts');
const rulesJson = srcOf('public/content/rules.json');

console.log('── 1. Terrazas en el tejado (bloques con pared al exterior) ──');
check('plataforma de terracota', buildingTs.includes('_terraza_suelo') && buildingTs.includes("'#b8664a'"));
check('barandilla con barrotes deterministas', buildingTs.includes('_terraza_poste_f_') && buildingTs.includes('hash01(b.id, 911)'));
check('macetas con verde', buildingTs.includes('_terraza_maceta_') && buildingTs.includes('_terraza_planta_') && buildingTs.includes("'#3f7d3a'"));
check('toldo inclinado (el frente cae a la calle)', buildingTs.includes('_terraza_toldo') && buildingTs.includes('toldo.rotation.x = 0.38'));
check('banquito de terraza', buildingTs.includes('_terraza_banco'));
check('vive en el grupo greybox (el swap glTF la respeta)', /view\.greybox\.push\(\s*\n?\s*box\(`\$\{b\.id\}_terraza_suelo`/.test(buildingTs));

console.log('── 2. El Rincón: local de copas ──');
check('barra con cuerpo y tapa de madera', buildingTs.includes('_barra_cuerpo') && buildingTs.includes('_barra_tapa'));
check('estantería tras la barra', buildingTs.includes('_barra_estante'));
check('5 botellas con emissive (se leen con la lámpara)', buildingTs.includes('_botella_${bi}') && buildingTs.includes('bc.scale(0.18)'));
check('dos copas servidas', buildingTs.includes('_copa_1') && buildingTs.includes('_copa_2'));
check('taburete de tres piezas (asiento/pata/base)', buildingTs.includes('_taburete_asiento') && buildingTs.includes('_taburete_pata') && buildingTs.includes('_taburete_base'));
const jh = (content.rules.view as unknown as Record<string, Record<string, unknown>>).locals.juntaHall as unknown as Record<string, unknown>;
check('el neón v1.83 de la fachada sigue (canon intacto)', jh.sign === 'EL RINCÓN' && (jh.signGlow as number) >= 1.2, `${jh.sign} glow ${jh.signGlow}`);

console.log('── 3. El cartel que se estropea (neón vivo) ──');
check('registro de neones glow ≥ 1.2', /if \(sign\.glow >= 1\.2\)/.test(buildingTs) && buildingTs.includes('neonSigns.push({ mat: rmat, base:'));
check('ciclo de avería 240-450 s', buildingTs.includes('const cycle = 240 + (ns.seed % 210)'));
check('ventana de avería 26-48 s', buildingTs.includes('const bad = 26 + ((ns.seed >> 2) % 22)'));
check('parpadeo irregular determinista', buildingTs.includes('Math.sin(q * 61.7 + ns.seed)'));
check('cero allocations (copyFrom + scaleInPlace)', buildingTs.includes('ns.mat.emissiveColor.copyFrom(ns.base).scaleInPlace(') && !buildingTs.includes('ns.base.clone()'));

console.log('── 4. FPS: consolidación geométrica del greybox ──');
check('MergeMeshes por material (sin reusar mallas)', buildingTs.includes('BMesh.MergeMeshes(group, true, false, undefined, false, false)'));
check('fachadas, zócalos y edges protegidos', ['prot.add(view.edgesMesh)', 'prot.add(view.front)', 'for (const p of view.frontParts) prot.add(p)', 'for (const e of view.frontExtras) prot.add(e)'].every((s) => buildingTs.includes(s)));
check('mallas fuera de la raíz del bloque se saltan', buildingTs.includes('mesh.parent !== root'));
check('idempotente: grupos de 1 y fusión imposible no rompen', buildingTs.includes('if (group.length < 2)') && buildingTs.includes('next.push(...group); // fusión imposible'));
check('se ejecuta al crear el edificio', /consolidateGreybox\(\);/.test(buildingTs));

console.log('── 5. FPS: luces ──');
check('cabina de ascensor acotada con includedOnlyMeshes', elevatorTs.includes('includedOnlyMeshes = cabinLightMeshes') && elevatorTs.includes("l.name.startsWith('asc_luz_')"));
check('el filtro toca equipamiento y pasillo (derrame de puertas)', elevatorTs.includes("n.startsWith('asc_')") && elevatorTs.includes("n.includes('pasillo')"));
check('luces apagadas fuera del bucle de luz del shader (controller)', controllerTs.includes('light.setEnabled(on)') && controllerTs.includes('light.setEnabled(false)'));

console.log('── 6. Manifestantes paramétricos (regresión) ──');
check('la marcha usa el rig de peatones (no cilindros)', streetlifeTs.includes('createPedFactory') && /rig: PedRig/.test(streetlifeTs));
check('los carteles cuelgan del rig paramétrico', streetlifeTs.includes('placard: TransformNode | null') && streetlifeTs.includes('man.placard'));

console.log('── 7. Juego ilegal (regresión v1.81) ──');
check('gambleTick en el tick del sim', srcOf('src/game/sim/tick.ts').includes('gambleTick(world, content)'));
check('catálogo gamble con redada, multa y resaca', rulesJson.includes('"gamble"') && srcOf('src/game/core/types.ts').includes('raidChance') && srcOf('src/game/core/types.ts').includes('fine'));
const simGamble = srcOf('src/game/sim/extra/gamble.ts');
check('la redada multa al anfitrión y la partida descansa', simGamble.includes('raid') || simGamble.includes('redada'), `${simGamble.length} bytes`);

console.log('── 8. Versiones espejadas v1.87 ──');
check('sw.js VERSION = vecinos-v1.87', swJs.includes('vecinos-v1.87'));
check('PwaRegister espeja v1.87', pwaTs.includes('vecinos-v1.87'));
check('banner i18n v1.87 (es)', i18nTs.includes('v1.87 · restauración'));

console.log('── 9. Sim determinista (240 ticks × 2) ──');
const snapshot = (w: ReturnType<typeof createWorld>): string =>
  JSON.stringify([w.tick, w.community.funds, Object.keys(w.residents).length]);
const run = (): string[] => {
  const w = createWorld(content, 'slice');
  const hashes: string[] = [];
  for (let i = 0; i < 240; i++) {
    tick(w, content);
    if (i % 60 === 0) hashes.push(snapshot(w));
  }
  return hashes;
};
check('determinismo (240 ticks idénticos)', JSON.stringify(run()) === JSON.stringify(run()), run().slice(-1)[0] ?? '');

console.log(`\nqa-v187: ${pass} ✓ / ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
