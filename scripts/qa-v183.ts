/**
 * QA v1.83→v1.84 "la puerta que el vecino quería" — ACTUALIZADO en v1.84: el vecino
 * aclaró el canon de las puertas («ya dijimos que se sustituyeran por unas puertas
 * modernas GRISES»), así que la suite v1.83 verifica ahora:
 *  1. PUERTAS DE ESCALERA: arte MODERNO GRIS (door_moderna_gris.png, md5 de la generación
 *     IA v1.84) en el catálogo, con número de planta CLARO (legible sobre el grafito).
 *     door_comunal.png (cartoon verde) sigue en el repo para trasteros/vivienda.
 *  2. LAVANDERÍA: TODAS las máquinas con el bombo girando (drumOnChance 1.0) —
 *     nunca más «planos grises sin nada» por los agujeros sin bombo.
 *  3. EL RINCÓN: la fachada del local vuelve a anunciar el bar con NEÓN
 *     (sign 'EL RINCÓN' + signGlow 1.35 → emissive fuerte con halo del GlowLayer).
 *  4. PUERTA TRASERA: dentro del local, tabique a media profundidad con hoja con
 *     bisagra (hallDoors) y cartel pequeño de la SALA DE JUNTAS encima — el bar
 *     da paso a la sala por detrás, sin colisiones ni rutas nuevas (sim intacto).
 *  5. VERSIONES espejadas: sw.js = PwaRegister = v1.84 + banner i18n.
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

console.log('── 1. Puertas de escalera: MODERNAS GRISES (canon v1.84) ──');
const doorPath = path.join(import.meta.dir, '..', 'public/art/interiors/raw/door_moderna_gris.png');
check('door_moderna_gris.png existe en disco', fs.existsSync(doorPath));
// v1.84 — el canon del vecino: «ya dijimos que se sustituyeran por unas puertas
// modernas GRISES». Arte IA generado (grafito, pomo de acero, vista frontal).
const doorStat = fs.statSync(doorPath);
const doorBytes = fs.readFileSync(doorPath);
const md5 = (buf: Buffer): string => {
  // md5 ligero vía crypto
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto').createHash('md5').update(buf).digest('hex');
};
const hash = md5(doorBytes);
check('door_moderna_gris.png es el arte generado v1.84 (md5)', hash === 'bbf74c18beea4f6167860b1fd9a9ff62', hash);
check('el arte pesa como una textura razonable', doorStat.size > 20 * 1024 && doorStat.size < 3 * 1024 * 1024, `${doorStat.size} bytes`);
const facadeArt = (v.stairs.facade as { art?: string; numberColor?: string }).art;
check('el catálogo apunta a la puerta gris', facadeArt === 'art/interiors/raw/door_moderna_gris.png', String(facadeArt));
const facadeNum = (v.stairs.facade as { numberColor?: string }).numberColor;
check('número de planta CLARO (legible sobre grafito)', facadeNum === '#f4f4f5', String(facadeNum));
check('door_comunal.png sigue en el repo (trasteros/vivienda)', fs.existsSync(path.join(import.meta.dir, '..', 'public/art/interiors/raw/door_comunal.png')));

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

console.log('── 5. Versiones espejadas v1.84 ──');
check('sw.js VERSION = vecinos-v1.84', swJs.includes("vecinos-v1.84"));
check('PwaRegister espeja v1.84', pwaTs.includes('vecinos-v1.84'));
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

console.log(`\nqa-v183 (actualizada v1.84): ${pass} ✓ / ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
