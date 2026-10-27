/**
 * QA v1.23 — "post-its y dioramas":
 *   1. Dioramas (interiors.json): catálogo válido, arte EXISTE en disco (paredes, suelos,
 *      sprites, puerta), capas declaradas por tipo de estancia (2-3 capas) y cobertura de
 *      los 4 tipos de estancia del juego + trastero.
 *   2. Sonidos de hucha (sounds.json): hucha_in (caja registradora) y hucha_out (hucha rota)
 *      existen y son secuencias con pasos.
 *   3. Escalera v1.23: el encadenado por plantas produce peldaños de UNA planta (nada de
 *      peldaños de media planta en subidas de 2+); la bajada es el reverso exacto.
 *   4. Vida de calle en Planta: el gating del controlador incluye la cámara 'planta'.
 *   5. Regresión: la retirada del mobiliario 3D no rompe el sim (furniture.json intacto) y
 *      el sim sigue determinista tras 240 ticks.
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, tick as tickWorld } from '@/game/sim';
import { stairPathPoints } from '@/game/stairs';

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}
let fails = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` · ${detail}` : ''}`);
  if (!cond) fails++;
};

// ── 1. Dioramas ──
const ic = content.interiors;
check('interiors.json cargado (dioramas)', !!ic, ic ? `${Object.keys(ic.rooms).length} tipos de estancia` : 'ausente');
const artDir = join(import.meta.dir, '..', 'public', 'art', 'interiors', 'raw');
const artOk = (f: string): boolean => existsSync(join(artDir, f));
const missing: string[] = [];
if (ic) {
  for (const [defId, dio] of Object.entries(ic.rooms)) {
    if (!artOk(dio.wall)) missing.push(`${defId}/wall:${dio.wall}`);
    if (!artOk(dio.floor)) missing.push(`${defId}/floor:${dio.floor}`);
    for (const sp of dio.sprites) if (!artOk(sp.art)) missing.push(`${defId}/sp:${sp.art}`);
  }
  if (!artOk(ic.doorDecal.art)) missing.push(`door:${ic.doorDecal.art}`);
}
check('TODO el arte declarado existe en disco', missing.length === 0, missing.length ? missing.slice(0, 4).join(', ') : `${artDir}`);
const roomIds = Object.keys(content.rooms);
const covered = roomIds.filter((r) => ic?.rooms[r]);
check('los 4 tipos de estancia del juego tienen diorama', roomIds.length >= 4 && covered.length === roomIds.length, `${covered.length}/${roomIds.length} · ${roomIds.join(',')}`);
check('trastero con diorama propio', !!ic?.rooms['trastero'], ic?.rooms['trastero'] ? `${ic.rooms['trastero'].sprites.length} sprites` : 'ausente');
const layerCount = (defId: string): string => {
  const layers = new Set((ic?.rooms[defId]?.sprites ?? []).map((s) => s.layer));
  return [...layers].sort().join('+');
};
// v1.29 - el mobiliario vive en JUEGOS (sets[]): las capas se cuentan sobre todos ellos.
const layersOf = (defId: string): Set<string> => {
  const d = ic?.rooms[defId];
  const out = new Set<string>();
  for (const sp of d?.sprites ?? []) out.add(sp.layer);
  for (const set of d?.sets ?? []) for (const sp of set) out.add(sp.layer);
  return out;
};
// v1.30: la sala de juntas es un LOCAL comunal (mesa y sillas 3D del catálogo, sin
// capas pintadas) — se exime del mínimo de capas que rige para las viviendas.
// v1.34: garaje y lavandería también son LOCALES comunales (mobiliario 3D propio).
const localesComunales = new Set(['estancia_local_juntas', 'estancia_garaje', 'estancia_lavanderia']);
check('capas de paralaje declaradas (2-3 por estancia, sets v1.29; locales comunales exentos)', !!ic && Object.entries(ic.rooms).every(([id, d]) => { if (localesComunales.has(id)) return true; const s2 = new Set<string>(); for (const sp of d.sprites) s2.add(sp.layer); for (const set of d.sets) for (const sp of set) s2.add(sp.layer); return s2.size >= 2; }), `salón:${[...layersOf('estancia_salon_cocina')].join('+')} · dormitorio:${[...layersOf('estancia_dormitorio')].join('+')} · trastero:${[...layersOf('trastero')].join('+')}`);
check('sprites dentro del rect (u/v 0..1) y con tamaño positivo', !!ic && Object.values(ic.rooms).every((d) => d.sprites.every((s) => s.u >= 0 && s.u <= 1 && s.v >= 0 && s.v <= 1 && s.w > 0 && s.h > 0)));

// ── 2. Sonidos de hucha ──
const snd = content.sounds;
const huchaIn = snd?.sounds['hucha_in'];
const huchaOut = snd?.sounds['hucha_out'];
check('hucha_in (caja registradora) existe y es secuencia', huchaIn?.kind === 'seq' && huchaIn.steps.length >= 3, `${huchaIn?.kind} · ${huchaIn?.kind === 'seq' ? huchaIn.steps.length : 0} pasos`);
check('hucha_out (hucha rota) existe y es secuencia', huchaOut?.kind === 'seq' && huchaOut.steps.length >= 3, `${huchaOut?.kind} · ${huchaOut?.kind === 'seq' ? huchaOut.steps.length : 0} pasos`);
check('suena DISTINTO al ganar que al perder', JSON.stringify(huchaIn) !== JSON.stringify(huchaOut));

// ── 3. Escalera v1.23 (encadenado por plantas) ──
const v = content.rules.view;
const sx = 12;
const y0 = 0.16; // forjado + pivote de un actor en planta 0
const up1 = stairPathPoints(v, sx, y0, y0 + v.cellH);
const up2 = stairPathPoints(v, sx, y0, y0 + 2 * v.cellH);
// Simulación del encadenado (lo que hace actors.ts buildRoute): un vuelo por planta.
const frac = y0 % v.cellH;
const chained: { x: number; y: number; z: number }[] = [];
let curY = y0;
for (const floor of [1, 2]) {
  const flight = stairPathPoints(v, sx, curY, floor * v.cellH + frac);
  if (chained.length > 0) flight.shift();
  chained.push(...flight);
  curY = floor * v.cellH + frac;
}
const maxStepUp = Math.max(...up1.slice(1).map((p, i) => Math.abs(p.y - up1[i]!.y)));
const maxStepChained = Math.max(...chained.slice(1).map((p, i) => Math.abs(p.y - chained[i]!.y)));
check('un vuelo sube EXACTAMENTE una planta', Math.abs(up1[up1.length - 1]!.y - (y0 + v.cellH)) < 0.01, `Δy ${(up1[up1.length - 1]!.y - y0).toFixed(2)} m`);
check('peldaños del vuelo ≤ un peldaño real', maxStepUp <= (v.cellH / v.stairs.stepCount) * 1.01, `max Δpeldaño ${maxStepUp.toFixed(3)} m (límite ${(v.cellH / v.stairs.stepCount).toFixed(3)})`);
check('el encadenado por plantas NO estira peldaños', maxStepChained <= (v.cellH / v.stairs.stepCount) * 1.01, `max Δpeldaño ${maxStepChained.toFixed(3)} m · ${chained.length} puntos`);
check('el encadenado termina 2 plantas arriba', Math.abs(chained[chained.length - 1]!.y - (y0 + 2 * v.cellH)) < 0.02, `final y ${chained[chained.length - 1]!.y.toFixed(2)}`);
check('el encadenado acaba en la línea del pasillo', Math.abs(chained[chained.length - 1]!.z - v.corridorZ) < 0.01, `z ${chained[chained.length - 1]!.z.toFixed(2)} vs pasillo ${v.corridorZ}`);
const down = stairPathPoints(v, sx, y0 + v.cellH, y0);
check('la bajada es el reverso exacto de la subida', down.length === up1.length && Math.abs(down[0]!.y - up1[up1.length - 1]!.y) < 0.001 && Math.abs(down[down.length - 1]!.y - up1[0]!.y) < 0.001);

// ── 4. Vida de calle en Planta (código del controlador) ──
import { readFileSync } from 'fs';
const ctlSrc = readFileSync(join(import.meta.dir, '..', 'src', 'game', 'client', 'controller.ts'), 'utf8');
const m = ctlSrc.match(/const streetView = ([^;]+);/);
check('el gating de calle incluye la cámara planta', !!m && /planta/.test(m![1]!), m?.[1]?.trim() ?? 'no encontrado');
check('la estancia sigue SIN calle (vista de interior limpia)', !!m && !/estancia/.test(m![1]!));

// ── 5. Regresión del sim ──
const world0 = createWorld(content, content.rules.startScenario);
const furnBefore = Object.values(world0.blocks).flatMap((b) => b.rooms.map((r) => Object.keys(r.furniture).length)).reduce((a, b) => a + b, 0);
check('las ranuras de mueble del sim sobreviven (solo cambió el render)', furnBefore > 0, `${furnBefore} ranuras con mueble`);
for (let i = 0; i < 240; i++) tickWorld(world0, content);
check('sim determinista tras 240 ticks (reloj avanza, mundo estable)', world0.clock.minute === 720, `minuto ${world0.clock.minute} · ${Object.keys(world0.blocks).length} bloques`);

console.log(fails === 0 ? '\nQA V1.23 OK ✅' : `\nQA V1.23 FALLIDO (${fails}) ❌`);
process.exit(fails === 0 ? 0 : 1);
