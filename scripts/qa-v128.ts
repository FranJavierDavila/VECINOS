/**
 * QA v1.28 "se anda de verdad" — el reporte del vecino tras v1.27:
 *  1. ORIENTACIÓN: MODEL_YAW_OFFSET = 0 — probe EN VIVO (v1.27 verificaba solo el PLANO de
 *     vaivén, pero el morro quedaba 180° revés: mv=+X con visor a −X). El rig authora a +X y
 *     el loader no voltea: rotation.y = yaw exacto. Callejero y manifestación coherentes.
 *  2. POSTURA DE PAUSA: los clips no comparten canales (idle no anima piernas) — al cambiar
 *     de clip, play() restaura la pose de reposo de los nodos que quedan sin cubrir (assets).
 *  3. HUECOS DE PUERTA: la fachada de la vivienda se ABRE (tramos izq/der + dintel + umbral
 *     con la caja exacta de privacy.doorW/doorH) y las rutas ENTRAN/SALEN por la puerta
 *     (routing doorX — jamás por la x del objetivo cruzando la pared).
 *  4. Puerta de escalera: canvas RETRATO (H fijo 768, W proporcional) — el v1.27 la tenía
 *     apaisada y el cover-fit aplastaba el arte (estirada y mal colocada).
 *  5. Candado SOBRE la puerta a la altura del tirador (privacy.lockOnDoor, data-driven).
 *  6. Pantallita del ascensor con la planta de la cabina (elevator.indicator).
 *  7. Anti-coplanaridad de verdad: juntas y solera con clearance ≥8 mm de TODA cara vecina
 *     (la v1.27 podía caer EXACTAMENTE en el plano del muro del cubo: frontZ − 0.07).
 *  8. Día de lluvia CERRADO: overcast del catálogo (cielo fundido a gris), sol/luna fuera,
 *     nubes que engordan (stormScale) y lavado gris de la ciudad del fondo (rain.wash).
 *  9. Bloom/glow de las luces: GlowLayer data-driven (rules.view.glow).
 * 10. Árbol del portal REUBICADO: keepOut (sin verde delante de la entrada) + forcedTrees
 *     (replantado a la derecha de la imagen).
 * 11. Suelo de pasillos: losetas de 40 cm gris clarito (corridorFloor, plano a +4 mm).
 *  + Sim intacto: 240 ticks deterministas tras tocar SOLO presentación/contenido.
 */
import fs from 'fs';
import path from 'path';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld } from '@/game/sim';
import { tick } from '@/game/sim/tick';
import { buildCirculation, travelMinutes } from '@/game/sim/graph';
import { horizontalLegs } from '@/game/routing';

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
const srcOf = (rel: string): string => fs.readFileSync(path.join(import.meta.dir, '..', rel), 'utf8');

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}
const v = content.rules.view;
const buildingTs = srcOf('src/game/client/building.ts');
const actorsTs = srcOf('src/game/client/actors.ts');
const assetsTs = srcOf('src/game/client/assets.ts');
const routingTs = srcOf('src/game/routing.ts');
const backdropTs = srcOf('src/game/client/backdrop.ts');
const exteriorTs = srcOf('src/game/client/exterior.ts');
const elevatorTs = srcOf('src/game/client/elevator.ts');
const controllerTs = srcOf('src/game/client/controller.ts');

console.log('── 1. Orientación: el morro coincide con la marcha ──');
check('MODEL_YAW_OFFSET = 0 (probe: mv +X → visor −X con π; el authoría es +X sin flip del loader)', actorsTs.includes('export const MODEL_YAW_OFFSET = 0;'));
check('actors escribe rotación = yaw + offset en rig y cápsula', (actorsTs.match(/a\.yaw \+ MODEL_YAW_OFFSET/g) ?? []).length >= 2 && actorsTs.includes('cur.yaw + MODEL_YAW_OFFSET'));
check('streetlife marcha: 0/π según sentido + offset compartido', exteriorTs.includes('x') && srcOf('src/game/client/streetlife.ts').includes('rig.root.rotation.y = (dir > 0 ? 0 : Math.PI) + MODEL_YAW_OFFSET;'));
check('pedestrians/ecosystem usan el offset compartido', srcOf('src/game/client/pedestrians.ts').includes('MODEL_YAW_OFFSET') && srcOf('src/game/client/ecosystem.ts').includes('MODEL_YAW_OFFSET'));
check('umbral de andar bajado (parar ANTES de andar en el sitio)', actorsTs.includes('speedH > 0.15'));

console.log('── 2. Postura de pausa (idle de verdad) ──');
check('rest pose capturada antes de animar', assetsTs.includes('restQuat.set(node, node.rotationQuaternion ? node.rotationQuaternion.clone() : null);'));
check('nodos de ROTACIÓN por clip (targetedAnimations)', assetsTs.includes('const rotTargetsOf = (g: AnimationGroup)'));
check('cambio de clip restaura los nodos sin cobertura', assetsTs.includes('restoreUncovered(rig.group, nextGroup)') && assetsTs.includes('if (keep?.has(node)) continue'));

console.log('── 3. Huecos de puerta: entrar por la puerta, no por la pared ──');
check('fachada partida: tramos izq/der/dintel/umbral con la caja de la puerta', buildingTs.includes('${b.id}_puerta_i') && buildingTs.includes('${b.id}_puerta_d') && buildingTs.includes('${b.id}_puerta_dintel') && buildingTs.includes('${b.id}_puerta_umbral'));
check('el hueco usa privacy.doorW y el nivel del suelo interior', buildingTs.includes('const doorGapW = pv.doorW;') && buildingTs.includes('const doorFloorY = bottom + v.slab + v.wall;'));
check('frontParts se activan/desactivan juntos (privacidad/candado)', buildingTs.includes('for (const p of view.frontParts) p.setEnabled(wall);'));
check('routing: DestInside.doorX (entrar por el hueco)', routingTs.includes('doorX?: number;') && routingTs.includes('d.doorX !== undefined'));
check('routing: salida por interiorRoute hasta la puerta propia', routingTs.includes('const doorExit = !!hs?.doorX && !!hs?.geo;') && routingTs.includes('interiorRoute(hs!.geo!, fromLocal, doorLocal)'));
check('actors: doorX = centro del bloque de vivienda (donde vive la hoja)', actorsTs.includes('doorX: dest.inside.block.kind === \'dwelling\'') && actorsTs.includes('const doorX = b.kind === \'dwelling\' ? x0 + w / 2 : undefined;'));

console.log('── 4. Puerta de escalera: encaje perfecto (canvas retrato) ──');
check('stairDoorTex RETRATO (H=768, W proporcional — v1.27 la tenía apaisada)', buildingTs.includes('const TH = 768;') && buildingTs.includes('const TW = Math.max(32, Math.round((TH * stF.doorW) / stF.doorH));'));
check('número de planta centrado en la hoja', buildingTs.includes('cctx.fillText(String(floor), TW / 2, TH / 2)') || buildingTs.includes('cctx.fillText(String(floor), TW / 2, TH / 2);'));

console.log('── 5. Candado sobre la puerta a la altura del tirador ──');
check('privacy.lockOnDoor en catálogo', !!v.privacy.lockOnDoor && v.privacy.lockOnDoor.yFrac > 0.4 && v.privacy.lockOnDoor.out > 0.02, JSON.stringify(v.privacy.lockOnDoor));
check('candado montado sobre la hoja (dx/yFrac/out del catálogo)', buildingTs.includes('const lockX = ld ? cx + pv.doorW * ld.dx : cx - pv.doorW / 2 - 0.32;') && buildingTs.includes('const lockZ = ld ? doorZ - ld.out : frontZ - v.wall / 2 - 0.07;'));

console.log('── 6. Pantallita del ascensor ──');
check('elevator.indicator en catálogo', !!v.elevator.indicator && v.elevator.indicator.dx < 0, JSON.stringify(v.elevator.indicator));
check('pantalla con textura dinámica por pozo (planta + flecha)', elevatorTs.includes('asc_indicador') && elevatorTs.includes("label = `${s.state.target!}${s.state.target! > s.state.at ? ' ▲' : ' ▼'}`"));
check('pantalla empotrada + cristal DELANTE (nada coplanar)', elevatorTs.includes('frontZ - 0.055') && elevatorTs.includes('frontZ - 0.088'));
check('avería = ✕ en pantalla', elevatorTs.includes("if (broken) label = '✕';"));

console.log('── 7. Anti-coplanaridad: clearance real frente a TODAS las caras ──');
check('juntas: v1.35 RETRANQUEADAS tras la fachada (protrude −0.030, adiós al casi-coplano con soleras C↔escalera)', v.privacy.gapFill.protrude === -0.03 && v.privacy.gapFill.stagger === 0.008, `out ∈ [${v.privacy.gapFill.protrude}, ${v.privacy.gapFill.protrude + v.privacy.gapFill.stagger})`);
check('solera: protrude 0.034 + stagger 0.010 (banda propia, jamás el plano del muro del cubo)', v.privacy.solera.protrude === 0.034 && v.privacy.solera.stagger === 0.01);
check('sin cara nueva a frontZ − 0.07 (el plano del muro del cubo de v1.27)', !buildingTs.includes('frontZ - v.wall / 2 - 0.02'));

console.log('── 8. Día de lluvia = cielo cerrado ──');
const oc = v.backdrop.sky.overcast;
check('overcast en catálogo (top/horizon/rain/storm)', !!oc && oc.rain > 0.5 && oc.storm > oc.rain, JSON.stringify(oc));
check('cielo fundido al velado cuando llueve', backdropTs.includes('Color3.LerpToRef(kf.top, ocTop, ocF, skyTop.mat.emissiveColor)'));
check('sol y luna se retiran con el cielo cerrado', backdropTs.includes('kf.sun > 0.02 && ocF < 0.5') && backdropTs.includes('(hour >= 20.5 || hour <= 5.5) && ocF < 0.5'));
check('nubes engordan con el chaparrón (stormScale)', (v.backdrop.clouds.stormScale ?? 1) > 1.3 && backdropTs.includes('c.mesh.scaling.setAll(swell);'));
check('estrellas fuera con el cielo cerrado', backdropTs.includes('starMat.alpha = nightF * (1 - ocF);'));
check('lavado gris de la ciudad del fondo (rain.wash)', !!v.backdrop.rain.wash && backdropTs.includes("if (wash && (weather === 'rain' || weather === 'storm'))"));

console.log('── 9. Bloom/glow de las luces ──');
check('rules.view.glow en catálogo', !!v.glow && v.glow.enabled && v.glow.intensity > 0.3, JSON.stringify(v.glow));
check('GlowLayer en el controlador (una por escena, dispose antes de recrear)', controllerTs.includes("new GlowLayer('luz_bloom', this.scene") && controllerTs.includes('this.glowLayer?.dispose();'));

console.log('── 10. Árbol del portal reubicado ──');
check('keepOut delante del portal (sin verde tapando la entrada)', (v.exterior.keepOut ?? []).some((r) => r.x0 <= -6 && r.x1 >= 5 && r.z1 >= 5), JSON.stringify(v.exterior.keepOut));
check('forcedTrees replanta a la DERECHA de la imagen', (v.exterior.forcedTrees ?? []).some((t) => t.x > 30), JSON.stringify(v.exterior.forcedTrees));
check('exterior.ts: keepOut salta árboles y arbustos', exteriorTs.includes('if (isKeepOut(p.x, p.z)) continue;'));
check('exterior.ts: piezas forzadas con el mismo pipeline de recorte', exteriorTs.includes('calle_forzado_arbol'));

console.log('── 11. Suelo de pasillos: losetas de 40 cm ──');
check('corridorFloor en catálogo (tile 0.4 m)', !!v.corridorFloor && Math.abs(v.corridorFloor.tile - 0.4) < 0.001, JSON.stringify(v.corridorFloor));
check('plano de losetas 4 mm sobre la losa (nada coplanar)', buildingTs.includes('bottom + v.slab * 2 + 0.004'));
check('junta = tile metros reales (uScale/vScale del calado y ancho del bloque)', buildingTs.includes('tex.uScale = Math.max(1, Math.round(wMeters / (cf.tile * 2)));'));

console.log('── Rutas: la entrada cae en el hueco de la puerta ──');
const world = createWorld(content, 'slice');
{
  // vivienda p1_a: col 0, w 2 → puerta en el centro del bloque
  const home = world.blocks['blk_p1_a']!;
  const x0 = home.cell.col * v.cellW;
  const w = home.size.w * v.cellW;
  const legs = horizontalLegs({
    view: v,
    from: { x: (home.cell.col + 2.5) * v.cellW, z: v.corridorZ }, // desde el pasillo, a la derecha
    dest: { x: x0 + 0.4, z: 1.2 }, // objetivo cerca de la pared izquierda (antes se entraba AQUÍ)
    destInside: { x0, w, geo: (() => {
      const layoutId = content.blocks[home.defId]!.container!.layout!;
      const layout = content.layouts[layoutId]!;
      return { rooms: layout.rooms.filter((r) => r.rect).map((r) => ({ key: r.key, defId: r.defId, rect: r.rect! })), doorways: layout.doorways };
    })(), target: { x: 0.4, z: 1.2 }, doorX: x0 + w / 2 },
    hostSpan: null,
  });
  const cross = legs.find((l, i) => i > 0 && Math.abs(l.z - legs[i - 1]!.z) > 0.3 && legs[i - 1]!.z <= v.corridorZ + 0.01);
  const entryLegs = legs.filter((l) => Math.abs(l.z - v.corridorZ) < 0.01);
  check('la x de entrada ES la de la puerta (centro del bloque)', entryLegs.some((l) => Math.abs(l.x - (x0 + w / 2)) < 0.01), `puerta ${x0 + w / 2}, legs ${legs.map((l) => `${l.x.toFixed(2)}/${l.z.toFixed(2)}`).join(' → ')}`);
  check('NADIE entra por la x del objetivo (0.4 desde el borde)', !legs.some((l) => Math.abs(l.x - (x0 + 0.4)) < 0.01 && Math.abs(l.z - v.corridorZ) < 0.01));
  void cross;
}

console.log('── Sim intacto ──');
const snap0 = JSON.stringify({ c: world.clock, f: world.community.funds, t: world.tick, locs: Object.fromEntries(Object.values(world.residents).map((r) => [r.id, r.location])) });
for (let i = 0; i < 240; i++) tick(world, content);
const snap1 = JSON.stringify({ c: world.clock, f: world.community.funds, t: world.tick, locs: Object.fromEntries(Object.values(world.residents).map((r) => [r.id, r.location])) });
check('240 ticks viven', snap0 !== snap1);
const w2 = createWorld(content, 'slice');
for (let i = 0; i < 240; i++) tick(w2, content);
check('determinismo (240 ticks idénticos)', JSON.stringify({ c: w2.clock, t: w2.tick, f: w2.community.funds }) === JSON.stringify({ c: world.clock, t: world.tick, f: world.community.funds }));
check('regresión: circulación portal→3C sigue posible', travelMinutes(buildCirculation(world, content), 'blk_p0_portal', 'blk_p3_c') < 60);

console.log(`\nQA v1.28: ${pass} ✓ / ${fail} ✗`);
process.exit(fail > 0 ? 1 : 0);
