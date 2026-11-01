/**
 * QA v1.26 "sin tabiques" — el reporte del vecino tras v1.25:
 *  1. hideNodes RECURSIVO: jambas/dintel/toldito/placa/rodapie (vivienda) y hueco/jambas/
 *     dintel/rótulo (cubo) viven bajo "__root__ → Root" — el bucle de hijos directos era un
 *     no-op silencioso (la repisa sobre la puerta y la puerta oscura flotante sobrevivían).
 *  2. Sin marco 3D en la puerta de vivienda (frameW 0 — la hoja queda a sangre, el arte ya
 *     lleva su marco pintado).
 *  3. Placa numerada más arriba (petición: ~+25 cm sobre la posición v1.24).
 *  4. Zócalo CORTADO en la puerta (dos tramos) — skirtingDoorGap.
 *  5. Juntas entre bloques rellenas con el color de la pared (gapFill).
 *  6. Cubo de escalera: muro frontal COMPLETO (fullWall) grueso (wallT 0.3) con la hoja
 *     DELANTE (doorZ/wallT del catálogo) — barandillas y peldaños ya no se ven "a través".
 *  7. Macetas: ninguna delante de una puerta (doorClearance) y recorte billboard con el
 *     alpha de la textura llegando de verdad al shader (useAlphaFromDiffuseTexture —
 *     Babylon 8 lo dejó a false y el ALPHATEST veía alpha=1: fondos NEGROS).
 *  8. Tapa de estancia cerrada CON ARTE DE PUERTA (coverArt) — dejó de leerse como tabique.
 *  9. Norma: NO se entra en una vivienda vacía (bloqueo en player-logic + bocadillo).
 * 10. Orientación: MODEL_YAW_OFFSET (−π/2) en actors/pedestrians/ecosystem — el rig mira
 *     hacia donde anda (perfil al cruzar el pasillo, no de frente con las piernas cruzadas).
 * 11. Repartidor: anda con clip sincronizado, sube escaleras peldaño a peldaño (umbral
 *     vertical 0.05) y abre puertas (extraPositions → movers).
 *  + Sim intacto: 240 ticks deterministas tras tocar SOLO presentación/contenido.
 */
import fs from 'fs';
import path from 'path';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld } from '@/game/sim';
import type { World } from '@/game/core/types';
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

const PUB = path.join(import.meta.dir, '..', 'public');
const exists = (rel: string): boolean => fs.existsSync(path.join(PUB, rel.replace(/^\//, '')));
const srcOf = (rel: string): string => fs.readFileSync(path.join(import.meta.dir, '..', rel), 'utf8');

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}
const v = content.rules.view;
const buildingTs = srcOf('src/game/client/building.ts');
const dioramaTs = srcOf('src/game/client/diorama.ts');
const actorsTs = srcOf('src/game/client/actors.ts');
const pedestriansTs = srcOf('src/game/client/pedestrians.ts');
const ecosystemTs = srcOf('src/game/client/ecosystem.ts');
const playerLogicTs = srcOf('src/game/player-logic.ts');

// ── 1. hideNodes recursivo ──
console.log('\n── hideNodes recursivo (la repisa y la puerta flotante) ──');
check('privacy.hideNodes incluye toldito (la repisa)', (v.privacy.hideNodes ?? []).includes('toldito'), (v.privacy.hideNodes ?? []).join(', '));
check('privacy.hideNodes incluye rodapie', (v.privacy.hideNodes ?? []).includes('rodapie'));
check('stairs.facade.hideNodes incluye hueco+jambas+dintel+rótulo', ['hueco', 'jamba_izq', 'jamba_der', 'dintel', 'rotulo'].every((n) => (v.stairs.facade.hideNodes ?? []).includes(n)));
check('building recorre el ÁRBOL de nodos (getChildren anidado)', buildingTs.includes('hideTree') && buildingTs.includes("model.root.getChildren()"));

// ── 2. Sin marco 3D ──
console.log('\n── Puerta de vivienda: hoja a sangre, sin marco gris ──');
check('privacy.frameW = 0 (sin marco 3D)', (v.privacy.frameW ?? 1) === 0, `frameW ${v.privacy.frameW}`);
check('el runtime respeta frameW 0 (skip condicional)', buildingTs.includes('if (fw > 0.001)'));

// ── 3. Placa numerada más arriba ──
console.log('\n── Placa numerada centrada con la parte superior de la puerta ──');
check('plaque.y bajada a 2.32 (v1.27: «un poco más bajos para que se puedan leer»)', Math.abs(v.plaque.y - 2.32) < 0.01, `y ${v.plaque.y}`);
check('la placa sigue dentro de la fachada con su z propio', v.plaque.z < -0.05, `z ${v.plaque.z}`);

// ── 4. Zócalo cortado en la puerta ──
console.log('\n── Zócalo cortado en la puerta ──');
check('skirtingDoorGap activo', v.privacy.skirtingDoorGap === true);
check('building genera DOS tramos de zócalo frontal', buildingTs.includes('zocalo_frente_i') && buildingTs.includes('zocalo_frente_d'));

// ── 5. Juntas entre bloques ──
console.log('\n── Juntas entre bloques rellenas ──');
check('privacy.gapFill declarado', !!v.privacy.gapFill && /^#/.test(v.privacy.gapFill!.color), v.privacy.gapFill?.color);
check('building crea rellenos de junta', buildingTs.includes('junta_p'));

// ── 6. Cubo de escalera: muro completo grueso + hoja delante ──
console.log('\n── Cubo de escalera: muro completo y grueso ──');
check('stairs.facade.fullWall activo', v.stairs.facade.fullWall === true);
check('wallT grueso (≥0.25 — envuelve peldaños/barandillas)', (v.stairs.facade.wallT ?? 0) >= 0.25, `wallT ${v.stairs.facade.wallT}`);
check('doorZ menor que wallT/2 (hoja delante del canto)', v.stairs.facade.doorZ <= (v.stairs.facade.wallT ?? 0.3) / 2, `doorZ ${v.stairs.facade.doorZ}`);
check('la hoja se monta en leafZ (delante del muro)', buildingTs.includes('leafZ'));

// ── 7. Macetas: clearance + alpha que llega al shader ──
console.log('\n── Macetas: sin tapar puertas y recorte de verdad ──');
check('pots.doorClearance declarado', (v.pots.doorClearance ?? 0) >= 0.6, `doorClearance ${v.pots.doorClearance}`);
check('plantas eligen posición con reintentos que respetan puertas', buildingTs.includes('doors.every'));
check('diorama activa useAlphaFromDiffuseTexture (Babylon 8)', dioramaTs.includes('useAlphaFromDiffuseTexture = true'));
check('macetas y candado también (mismo arreglo)', buildingTs.split('useAlphaFromDiffuseTexture = true').length >= 3);

// ── 8. Tapa de estancia cerrada con arte de puerta ──
console.log('\n── Tapa "en obras": hoja de puerta, no tabique ──');
check('privacy.coverArt declarado y en disco', !!v.privacy.coverArt && exists(v.privacy.coverArt!), v.privacy.coverArt);
// v1.29 - el vecino pidio quitar las tapas (no exista ninguna pared divisoria): el runtime ya no las usa.
check('sin tapas de estancia cerrada (peticion v1.29)', !buildingTs.includes('b.id}_tapa_'));

// ── 9. Norma: no entrar en vivienda vacía ──
console.log('\n── Norma del barrio: vivienda vacía cerrada ──');
check('player-logic bloquea entradas a vacías', playerLogicTs.includes("occupancy !== 'occupied'") && playerLogicTs.includes("reason: 'vacant'"));
check('el controlador avisa con bocadillo traducido', srcOf('src/game/client/controller.ts').includes("'door.vacant'"));
check('i18n tiene la clave door.vacant (es/en)', srcOf('src/game/client/i18n.ts').includes("'door.vacant'"));

// ── 10. Orientación de personajes ──
console.log('\n── Orientación: el rig mira hacia donde anda ──');
check('MODEL_YAW_OFFSET exportado en actors', actorsTs.includes('MODEL_YAW_OFFSET'));
check('actors aplica el offset en la rotación del nodo', (actorsTs.match(/MODEL_YAW_OFFSET/g) ?? []).length >= 3);
check('pedestrians aplica el offset', pedestriansTs.includes('MODEL_YAW_OFFSET'));
check('ecosystem aplica el offset (vecinos y extras)', ecosystemTs.includes('MODEL_YAW_OFFSET'));
check('la manifestación mira a la dirección de marcha (v1.28: offset compartido 0)', srcOf('src/game/client/streetlife.ts').includes('rig.root.rotation.y = (dir > 0 ? 0 : Math.PI) + MODEL_YAW_OFFSET;'));

// ── 11. Repartidor creíble ──
console.log('\n── Repartidor: anda, sube y llama a puertas ──');
check('umbral vertical 0.05 (peldaño a peldaño, sin patinaje)', ecosystemTs.includes('dH < 0.05'));
check('el vendedor reproduce el clip de andar', ecosystemTs.includes("e.rig.play('walk'"));
check('el vendedor gestiona al llamar (clip de charla)', ecosystemTs.includes("e.rig.play('talk'"));
check('extraPositions expone a los extras para los movers', ecosystemTs.includes('extraPositions'));
check('controller los añade a movers', srcOf('src/game/client/controller.ts').includes('extraPositions()'));

// ── Sim intacto ──
console.log('\n── Sim intacto: 240 ticks deterministas ──');
{
  const world: World = createWorld(content, content.rules.startScenario);
  const t0 = JSON.stringify(world.clock);
  for (let i = 0; i < 240; i++) tick(world, content);
  check('240 ticks avanzan el reloj sin errores', world.clock.day >= 1 && JSON.stringify(world.clock) !== t0, `día ${world.clock.day} minuto ${world.clock.minute}`);
  check('vivienda del jugador determinista', world.residents[world.playerId]?.home === 'blk_p3_c', world.residents[world.playerId]?.home ?? '');
  const vacantAtStart = Object.values(world.blocks).filter((b) => b.kind === 'dwelling' && b.occupancy !== 'occupied').length;
  check('hay viviendas vacías (la norma tiene aplicación)', vacantAtStart > 0, `${vacantAtStart} vacías`);
}

console.log(`\nQA v1.26: ${pass} ✓ / ${fail} ✗`);
process.exit(fail > 0 ? 1 : 0);
