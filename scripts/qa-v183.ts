/**
 * QA v1.83 "restauración del vecino" — el reporte en vivo tras v1.82 (GitHub Pages):
 *  1. PUERTAS DE ESCALERA: vuelve el arte cartoon v1.26 (door_comunal.png plano de
 *     dos paneles) — adiós la puerta realista «moderna» que v1.27 coló en el cubo.
 *  2. LAVANDERÍA: TODAS las máquinas con el bombo girando (drumOnChance 1.0) —
 *     nunca más «planos grises sin nada» por los agujeros sin bombo.
 *  3. EL RINCÓN: la fachada del local vuelve a anunciar el bar con NEÓN
 *     (sign 'EL RINCÓN' + signGlow 1.35 → emissive fuerte con halo del GlowLayer).
 *  4. PUERTA TRASERA: dentro del local, tabique a media profundidad con hoja con
 *     bisagra (hallDoors) y cartel pequeño de la SALA DE JUNTAS encima — el bar
 *     da paso a la sala por detrás, sin colisiones ni rutas nuevas (sim intacto).
 *  5. VERSIONES espejadas: sw.js = PwaRegister = v1.83 + banner i18n.
 *  + Sim determinista intacto (240 ticks).
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
const pwaTs = srcOf('src/components/game/PwaRegister.tsx');
const swJs = srcOf('public/sw.js');
const i18nTs = srcOf('src/game/client/i18n.ts');

console.log('── 1. Puertas de escalera: arte cartoon restaurado ──');
const doorPath = path.join(import.meta.dir, '..', 'public/art/interiors/raw/door_comunal.png');
check('door_comunal.png existe en disco', fs.existsSync(doorPath));
// El arte cartoon v1.26 (md5 d6cad51c...) frente a la puerta realista v1.27 (cacb88ea...):
// comprobación por TAMAÑO de fichero + paleta dominante (el cartoon es plano y pesa menos).
const doorStat = fs.statSync(doorPath);
const doorBytes = fs.readFileSync(doorPath);
const md5 = (buf: Buffer): string => {
  // md5 ligero vía crypto
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto').createHash('md5').update(buf).digest('hex');
};
const hash = md5(doorBytes);
check('door_comunal.png es el arte cartoon v1.26 (md5)', hash === 'd6cad51cef15f3a8dbb088babac478a1', hash);
check('el arte pesa como el cartoon (no el realista v1.27)', doorStat.size < 900 * 1024, `${doorStat.size} bytes`);

console.log('── 2. Lavandería: todos los bombos giran ──');
const lav = v.locals.lavanderia as unknown as Record<string, number>;
check('drumOnChance = 1.0 (todas las máquinas con bombo)', lav.drumOnChance === 1.0, String(lav.drumOnChance));
check('el runtime sigue creando el bombo bajo el agujero del frontal', buildingTs.includes('drumOnChance'));

console.log('── 3. El Rincón: neón en la fachada ──');
const jh = v.locals.juntaHall as unknown as Record<string, unknown>;
check('la fachada del local vuelve a decir EL RINCÓN', jh.sign === 'EL RINCÓN', String(jh.sign));
check('fondo del neón ámbar', jh.signBg === '#ffb703', String(jh.signBg));
check('signGlow > 1 (el cartel ARDE de noche)', (jh.signGlow as number) > 1, String(jh.signGlow));
check('el runtime escala el emissive con signGlow', buildingTs.includes('signGlow') && buildingTs.includes('sign.glow'));

console.log('── 4. Puerta trasera a la sala de juntas ──');
const rd = jh.rearDoor as unknown as Record<string, unknown>;
check('rearDoor activo en el catálogo', rd?.enabled === true);
check('tabique a media profundidad (z 0.2..1.2)', typeof rd?.z === 'number' && rd.z >= 0.2 && rd.z <= 1.2, String(rd?.z));
check('la hoja trasera cuelga de bisagra y entra en hallDoors', buildingTs.includes('hoja_trasera') && /hallDoors\.push\(\{ hinge: rearHinge/.test(buildingTs));
check('cartel pequeño SALA DE JUNTAS sobre la puerta trasera', rd?.sign === 'SALA DE JUNTAS' && buildingTs.includes('cartel_sala'));
check('tabique del color del pasillo (corridorWall)', buildingTs.includes('_tabique_mat') && buildingTs.includes('corridorWall'));
check('la mesa de la junta SIGUE dentro (nada se pierde)', !!jh.tableW && (jh.seats as unknown[]).length >= 8);
check('asientos de la junta tras el tabique (z > rearDoor.z)', (jh.seats as [number, number][]).every(([, sz]) => sz > (rd.z as number)));

console.log('── 5. Versiones espejadas v1.83 ──');
check('sw.js VERSION = vecinos-v1.83', swJs.includes("vecinos-v1.83"));
check('PwaRegister espeja v1.83', pwaTs.includes('vecinos-v1.83'));
check('banner i18n v1.83 (es)', i18nTs.includes('v1.83 · restauración del vecino'));

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

console.log(`\nqa-v183: ${pass} ✓ / ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
