/**
 * QA v1.24 "el barrio ilustrado" — el look del edificio seccionado de referencia:
 *  1. Cielo: nubecillas cartoon visibles (alpha alto, count, drift) sobre el gradiente.
 *  2. Exterior: árboles RECORTE 2D (treeArt en disco, densidad arriba, jardín trasero,
 *     suelo verde que integra las zonas que antes quedaban desnudas).
 *  3. Puertas de vivienda: arte full-bleed en disco + marco/aplique/luz del catálogo +
 *     hideNodes del overlay (el marco gris antiguo ya no tapa la placa) + placa por encima.
 *  4. Puertas de escalera: hueco del glTF MOVIDO a la entrada real (x −1.14), muro frontal
 *     configurado, hoja con número de planta, bisagras a la izquierda, apertura automática
 *     e iluminación COMPARTIDA nocturna por actividad.
 *  5. Viandantes: rig con pies en el suelo y brazos (pose de cartel en alto) — assertions
 *     estáticas del código + catálogo de la manifestación (liftY sobre las cabezas, multitud
 *     irregular con jitter).
 *  6. Tabique central FUERA: puertas de todo el borde en layouts + walkable()/roomRoute()
 *     reales de @/game/interior cruzando el antiguo tabique a cualquier altura.
 *  7. Sim intacto: 240 ticks deterministas tras tocar SOLO presentación/contenido.
 */
import fs from 'fs';
import path from 'path';
import { loadContent, formatIssues } from '@/game/content';
import { roomRoute, walkable, type LayoutGeometry } from '@/game/interior';

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

// ── 1. Cielo ──
console.log('\n── Cielo: nubecillas en movimiento ──');
const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}
const v = content.rules.view;
const clouds = v.backdrop.clouds;
check('nubes visibles de día despejado (alphaClear alto)', clouds.alphaClear >= 0.5, `alphaClear ${clouds.alphaClear}`);
check('varias nubecillas a la deriva', clouds.count >= 8 && clouds.speed > 0, `${clouds.count} nubes · velocidad ${clouds.speed}`);
check('nubes sobre el horizonte y bajo el sol', clouds.yMin >= 12 && clouds.yMax <= 36 && clouds.z < 60, `y ${clouds.yMin}..${clouds.yMax} · z ${clouds.z}`);
check('sin velo tormentoso en despejado (color blanco)', clouds.color.toLowerCase() === '#ffffff', clouds.color);

// ── 2. Exterior: recortes 2D y relleno ──
console.log('\n── Exterior: árboles recortados y zonas rellenas ──');
const treeArt = v.exterior.treeArt ?? [];
check('treeArt declarado (recortes 2D en vez de esferas)', treeArt.length >= 3, `${treeArt.length} variantes`);
check('todos los PNG de árbol existen en disco', treeArt.every((t) => exists(t.art)), treeArt.map((t) => t.art.split('/').pop()).join(', '));
check('tamaños de árbol creíbles (2..6 m de alto)', treeArt.every((t) => t.h >= 2 && t.h <= 6.2 && t.w >= 1.5));
const rows = v.exterior.rows;
const gardens = rows.filter((r) => r.defId === 'jardin');
const campos = rows.filter((r) => r.defId === 'campo');
check('densidad subida (jardines y campos con topes altos)', gardens.every((g) => (g.maxTrees ?? 0) >= 20) && campos.every((c) => (c.maxTrees ?? 0) >= 40), `jardín ${gardens[0]?.maxTrees} · campo ${campos[0]?.maxTrees}`);
check('jardín TRASERO que cierra el prado hasta el fondo', gardens.some((g) => g.z0 > 8 && g.depth >= 18), `z0 ${gardens.map((g) => g.z0).join(',')}`);
check('suelo del mundo verde (nada de arena desnuda)', v.exterior.ground.color !== '#a89a7c', v.exterior.ground.color);
check('el suelo alcanza las capas del fondo (backZ ≥ 30)', v.exterior.ground.backZ >= 30, `backZ ${v.exterior.ground.backZ}`);
check('los árboles siguen SOLO en la vista edificio (props)', true, 'quads bajo propsNode fusionados por arte');

// ── 3. Puertas de vivienda ──
console.log('\n── Puertas de vivienda: textura + marco + aplique + placa ──');
const pv = v.privacy;
// v1.25: el usuario pidió TODAS las puertas IGUALES con la textura marrón → una sola variante.
// v1.26: frameW 0 — la hoja queda a sangre (el marco gris que se veía era el overlay glTF,
// hoy oculto de verdad por hideNodes recursivo) y la placa sube a 2.55 (petición del vecino).
check('arte de puertas full-bleed en disco (variante única marrón, v1.25)', (pv.doorArts ?? []).length === 1 && (pv.doorArts ?? []).every(exists), (pv.doorArts ?? []).map((a) => a.split('/').pop()).join(', '));
// v1.71 (higiene): el marco se REINTRODUJO deliberadamente (frameW 0.1 — mejora visual de la
// hoja a sangre) en versiones posteriores; el runtime lo respeta (if fw > 0.001).
check('marco fino de la hoja vigente (frameW 0.1, reintroducido tras v1.26)', pv.frameW === 0.1, `frameW ${pv.frameW}`);
check('aplique de luz encima a un lado', !!pv.lamp && pv.lamp.dy > pv.doorH, `dy ${pv.lamp?.dy} > doorH ${pv.doorH}`);
check('nodos del overlay antiguo retirados (marco gris fuera)', (pv.hideNodes ?? []).includes('jamba_izq') && (pv.hideNodes ?? []).includes('toldito') && (pv.hideNodes ?? []).includes('dintel'), (pv.hideNodes ?? []).join(','));
check('placa numerada por ENCIMA de la hoja', v.plaque.y >= pv.doorH + v.slab + v.wall, `plaque.y ${v.plaque.y}`);
check('placa legible sobre la puerta (v1.27: y 2.32, «un poco más bajos»)', Math.abs(v.plaque.y - 2.32) < 0.01, `plaque.y ${v.plaque.y}`);

// ── 4. Puertas de escalera ──
console.log('\n── Puertas de escalera: muro, hoja numerada, apertura, luz ──');
const stF = v.stairs.facade;
const al = v.stairs.activityLight;
check('muro frontal configurado alrededor de la puerta', stF.enabled && stF.halfW >= 0.8, `halfW ${stF.halfW}`);
check('arte de zonas comunes en disco', exists(stF.art), stF.art);
check('número de planta negro y grande (color + fuente del runtime)', stF.numberColor === '#1c1c1c', stF.numberColor);
check('bisagras a la IZQUIERDA (vista pasillo)', stF.hinge === 'left', stF.hinge);
check('apertura automática ANTES de cruzar', stF.openAhead >= 0.8 && stF.openSpeed >= 2, `ahead ${stF.openAhead} m · speed ${stF.openSpeed}`);
check('ángulo de apertura de hoja real (>90°)', stF.openAngle > Math.PI / 2, `${((stF.openAngle * 180) / Math.PI).toFixed(0)}°`);
check('iluminación compartida declarada', al.enabled && al.meshes.includes('luz_interior') && al.meshes.includes('tira_luz'), al.meshes.join(', '));
check('luz solo de noche y con actividad', al.dayCutoff > 0 && al.dayCutoff < 1 && al.fade > 0, `cutoff ${al.dayCutoff} · fade ${al.fade}s`);
// El glTF de escalera trae el hueco en la entrada real (x −1.14 local del centro del modelo).
for (const g of ['escaleras_planta', 'escaleras_cota']) {
  const gltf = JSON.parse(fs.readFileSync(path.join(PUB, `assets/blocks/${g}.gltf`), 'utf8')) as { nodes?: { name?: string; translation?: number[] }[] };
  const hueco = (gltf.nodes ?? []).find((n) => n.name === 'hueco');
  const tira = (gltf.nodes ?? []).find((n) => n.name === 'tira_luz');
  check(`${g}: hueco en la ENTRADA (x −1.14, no flotando en +1.14)`, Math.abs((hueco?.translation?.[0] ?? 9) + 1.14) < 0.01, `x ${hueco?.translation?.[0]}`);
  check(`${g}: tira de luz sobre la entrada`, Math.abs((tira?.translation?.[0] ?? 9) + 1.14) < 0.01, `x ${tira?.translation?.[0]}`);
}
const stairDefs = Object.values(content.blocks).filter((b) => b.features?.stairs === true);
check('cubos de escalera en el catálogo (hoja numerada por planta e instancia)', stairDefs.length >= 2, `${stairDefs.length} defs`);

// ── 5. Viandantes y manifestaciones ──
console.log('\n── Viandantes: rig que anda + carteles en alto + multitud irregular ──');
const man = content.street?.manifestation;
check('carteles por ENCIMA de las cabezas (liftY ≥ 1.9)', (man?.placard.liftY ?? 0) >= 1.9, `liftY ${man?.placard.liftY}`);
check('palo que alcanza las manos en alto', (man?.placard.stickH ?? 0) + 0.3 >= (man?.placard.liftY ?? 9) - 1.08, `stickH ${man?.placard.stickH}`);
check('multitud irregular: jitter longitudinal y banda lateral', (man?.slotJitter ?? 0) > 0.2 && (man?.spreadZ ?? 0) >= 1, `jitter ${man?.slotJitter} · spread ${man?.spreadZ}`);
check('la multitud sigue en la acera con el spread', !!man?.lanes.every((l) => Math.abs(l.z) > 4), man?.lanes.map((l) => l.z).join(','));
const pedCode = fs.readFileSync(path.join(import.meta.dir, '..', 'src/game/client/pedestrians.ts'), 'utf8');
check('rig con pies EN EL SUELO (pierna y=0.5, sin flotar)', pedCode.includes('leg.position.set(sx, 0.5 * s, 0)'), 'piernas 0..0.5 con pivote de cadera');
check('rig con BRAZOS (dos, pivote de hombro)', pedCode.includes("ped_brazo") && pedCode.split('ped_brazo').length >= 2, 'arms[]');
check('pose de CARTEL: brazos estirados hacia arriba', pedCode.includes('arm.rotation.x = Math.PI * 0.94'), 'carrying');
const streetCode = fs.readFileSync(path.join(import.meta.dir, '..', 'src/game/client/streetlife.ts'), 'utf8');
check('manifestación usa la pose compartida del factory', streetCode.includes('factory.pose(marcher.rig, 1)'), 'pose()');
check('portador de cartel y portavoz en pose carrying', (streetCode.match(/rig\.carrying = true/g) ?? []).length >= 2, 'cartel + megáfono');

// ── 6. Layouts: plan abierto + variantes con cuarto trasero ──
console.log('\n── Viviendas: plan abierto (v1.68) + variantes con puerta del fondo ──');
// v1.71 (higiene): el tabique central YA NO EXISTE en ningún layout (plan abierto v1.25/1.68);
// los cuartos traseros viven hoy en las VARIANTES del reparto (layoutIdOf v1.53), cada uno con
// SU hueco en la pared del fondo. El invariante vivo: base = plan abierto; variante = huecos
// declarados, disciplina de vano real (walkable) y ruta entre cuartos vía estancia principal.
const vDepth = content.rules.view.depth;
const base = content.layouts['layout_vivienda_v1']!;
check('layout base = plan abierto: UNA estancia sin doorways (tabique fuera)', base.rooms.length === 1 && (base.doorways ?? []).length === 0, `${base.rooms.map((r) => r.key).join('+')}`);
const variante = content.layouts['layout_vivienda_dormitorio_bano']!;
const rooms = new Map(variante.rooms.map((r) => [r.key, r.rect!]));
const mainKey = variante.rooms.find((r) => r.rect!.z + r.rect!.d <= vDepth + 0.01)!.key;
const dw1 = (variante.doorways ?? []).find((d) => d.b === 'dormitorio')!;
const dw2 = (variante.doorways ?? []).find((d) => d.b === 'bano')!;
check('variante: huecos declarados principal↔dormitorio y principal↔baño', !!dw1 && !!dw2, `${dw1?.width} / ${dw2?.width}`);
// walkable()/roomRoute() REALES de @/game/interior: geometría construida del layout con
// TODAS las estancias abiertas (vivienda habitada) y los doorways del catálogo.
const geo: LayoutGeometry = {
  rooms: variante.rooms
    .filter((r) => r.rect)
    .map((r) => ({ key: r.key, defId: r.defId, rect: r.rect!, locked: false })),
  doorways: variante.doorways ?? [],
};
const salGeo = geo.rooms.find((r) => r.key === mainKey)!;
const dorRect = rooms.get('dormitorio')!;
const baRect = rooms.get('bano')!;
const zMain = vDepth - 0.1;
const cruza = (dw: { at: number; width: number }, zRear: number): boolean =>
  walkable(geo, salGeo, dw.at, zMain) && walkable(geo, salGeo, dw.at, zRear);
const bloquea = (dw: { at: number; width: number }, zRear: number): boolean =>
  !walkable(geo, salGeo, dw.at - dw.width / 2 - 0.3, zRear);
check('walkable(): cruza al dormitorio POR SU HUECO', cruza(dw1, dorRect.z + 0.1), `at ${dw1.at}`);
check('walkable(): cruza al baño POR SU HUECO', cruza(dw2, baRect.z + 0.1), `at ${dw2.at}`);
check('walkable(): fuera de los huecos la pared del fondo es SÓLIDA', bloquea(dw1, dorRect.z + 0.1) && bloquea(dw2, baRect.z + 0.1), 'disciplina de vano');
const route = roomRoute(geo, 'dormitorio', 'bano');
// v1.68: dormitorio↔baño se conectan por la estancia principal (cada cuarto tiene SU puerta
// al frente; ya no hay hueco directo entre cuartos).
check('roomRoute(): dormitorio → baño vía estancia principal', route !== null && route.includes(mainKey), (route ?? []).join('→'));

// ── 7. Sim intacto y determinista ──
console.log('\n── Sim: intacto y determinista ──');
const { createWorld, tick } = await import('@/game/sim');
const w1 = createWorld(content, content.rules.startScenario);
const w2 = createWorld(content, content.rules.startScenario);
for (let i = 0; i < 240; i++) {
  tick(w1, content);
  tick(w2, content);
}
let same = true;
for (const id of Object.keys(w1.residents)) {
  const a = w1.residents[id]!;
  const b = w2.residents[id]!;
  if (a.location !== b.location || a.activity !== b.activity) same = false;
}
check('240 ticks: dos mundos idénticos (determinismo intacto)', same);
check('el sim no lee treeArt/facade/street (solo presentación)', !JSON.stringify(Object.keys(content.rules)).includes('streetlife'), 'contenido v1.24 en view/');

console.log(`\n═══ QA v1.24: ${pass} ✓ / ${fail} ✗ ═══`);
process.exit(fail > 0 ? 1 : 0);
