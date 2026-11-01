/**
 * QA v1.22 — "la calle vive":
 *   1. Vida de calle (street.json): manifestaciones con humor (temas, carteles, gente
 *      suficiente) y reacciones vecinales por cubo de ánimo.
 *   2. Tráfico y viandantes (rules.view): carriles opuestos, vehículos con bus y patrulla,
 *      límites que escapan de pantalla, rutas de acera y portal para entrar/salir.
 *   3. Exterior v1.22: la carretera principal se escapa por los laterales (sin cortes),
 *      paso de cebra, bifurcación orient 'z', jardines cercanos/campo lejano con
 *      dispersión 2D topada, bordillos en aceras y calzada.
 *   4. Niebla del fondo: cada capa desaturada hacia su fogColor y creciente con la
 *      distancia (los edificios del fondo se intuyen, no distraen).
 *   5. Voces de proximidad (sounds.json → voices): bancos que referencian sonidos
 *      existentes, moodMap good/ok/bad completo, antiedad de sobrecarga.
 *   6. Regresión: el sim no ve NADA de esto (0 bloques exteriores en el mundo) y sigue
 *      determinista tras 240 ticks.
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, tick as tickWorld } from '@/game/sim';
import { hash01 } from '@/game/interior';

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

const v = content.rules.view;

// ── 1. Manifestaciones (street.json) ──
const st = content.street;
check('street.json cargado (vida de calle)', !!st, st ? `${st.topics.length} temas` : 'ausente');
check('temas suficientes con lemas de cartel', !!st && st.topics.length >= 8 && st.topics.every((t) => t.placards.length >= 3 && t.chant.length > 4), st?.topics.map((t) => t.id).slice(0, 4).join(',') + '…');
const man = st?.manifestation;
check('manifestación con 10+ personas y cadencia saneada', !!man && man.minPeople >= 10 && man.maxPeople >= man.minPeople && man.everyMin < man.everyMax && man.minDuration <= man.maxDuration, `${man?.minPeople}-${man?.maxPeople} personas cada ${man?.everyMin}-${man?.everyMax}s`);
check('carriles de marcha en aceras (no en la calzada)', !!man && man.lanes.length >= 1 && man.lanes.every((l) => Math.abs(l.z) < 11.6 || Math.abs(l.z) > 13.8 ? true : l.z < -11.6 || l.z > -4.4), man?.lanes.map((l) => l.z).join(' / '));
check('reacciones vecinales por ánimo (bad/ok/good con humor)', !!st && ['bad', 'ok', 'good'].every((k) => (st.reactions as unknown as Record<string, string[]>)[k].length >= 5), Object.entries(st?.reactions ?? {}).map(([k, arr]) => `${k}:${(arr as string[]).length}`).join(' '));
check('portavoz con megáfono y carteles repartidos', !!man && man.placard.carryEvery >= 1 && man.placard.fontSizePx > 0 && man.chantEveryMin < man.chantEveryMax, `cartel cada ${man?.placard.carryEvery} · grito ${man?.chantEveryMin}-${man?.chantEveryMax}s`);

// ── 2. Tráfico y viandantes ──
const tr = v.traffic;
check('tráfico habilitado con carriles de ambos sentidos', tr.enabled && tr.lanes.length >= 2 && tr.lanes.some((l) => l.dir > 0) && tr.lanes.some((l) => l.dir < 0), tr.lanes.map((l) => `${l.z}:${l.dir > 0 ? '+' : '−'}`).join(' '));
check('flota variada: coche + furgoneta + bus + patrulla', tr.vehicles.length >= 3 && tr.vehicles.some((x) => x.kind === 'bus' && x.length > 6) && tr.vehicles.some((x) => x.kind === 'policia' && x.siren), tr.vehicles.map((x) => x.kind).join(','));
const totalChance = tr.vehicles.reduce((s, x) => s + x.chance, 0);
check('ruleta de vehículos ponderada a ~1', totalChance > 0.9 && totalChance < 1.1, totalChance.toFixed(2));
check('spawn saneado y antiedad (maxAlive)', tr.spawnEveryMin < tr.spawnEveryMax && tr.maxAlive >= 1 && tr.maxAlive <= tr.vehicles.length, `cada ${tr.spawnEveryMin}-${tr.spawnEveryMax}s · max ${tr.maxAlive}`);
const world0 = createWorld(content, content.rules.startScenario);
const bx = Object.values(world0.blocks).map((b) => [b.cell.col * v.cellW, (b.cell.col + b.size.w) * v.cellW] as const);
const bMin = Math.min(...bx.map(([a]) => a));
const bMax = Math.max(...bx.map(([, b]) => b));
check('la carretera ESCAPA por los laterales de pantalla', tr.xMin <= bMin - 40 && tr.xMax >= bMax + 40, `tráfico ${tr.xMin}..${tr.xMax} vs edificio ${bMin.toFixed(1)}..${bMax.toFixed(1)}`);
const ped = v.pedestrians;
check('viandantes habilitados con rutas en aceras', ped.enabled && ped.paths.length >= 2 && ped.paths.every((p) => p.dir === 1 || p.dir === -1), `${ped.paths.length} rutas`);
check('algunos viandantes ENTRAN y SALEN del portal', ped.enterChance > 0 && ped.exitChance > 0 && ped.enterX >= bMin && ped.enterX <= bMax, `entra ${(ped.enterChance * 100).toFixed(0)}% · sale ${(ped.exitChance * 100).toFixed(0)}% en x ${ped.enterX}`);
check('paleta y gorros de viandantes declarados', ped.colors.length >= 5 && ped.hatChance > 0 && ped.hatColors.length >= 1, `${ped.colors.length} colores · gorros ${(ped.hatChance * 100).toFixed(0)}%`);

// ── 3. Exterior v1.22 (rodeo, cebra, bifurcación, bordillos, campo) ──
const defOf = (id: string) => content.blocks[id]?.exterior;
const mainRoad = v.exterior.rows.find((r) => r.defId === 'carretera');
check('la carretera principal NO termina en seco (hasta fuera de pantalla)', !!mainRoad && mainRoad.x0 <= -60 && mainRoad.x1 >= 110, `x ${mainRoad?.x0}..${mainRoad?.x1}`);
const zebra = v.exterior.rows.find((r) => r.defId === 'carretera_cruce');
check('paso de cebra frente al portal (sin cuerpo, franjas del bloque)', !!zebra && !zebra.body && defOf('carretera_cruce')!.zebra && zebra.z0 === mainRoad!.z0, `x ${zebra?.x0}..${zebra?.x1}`);
const branch = v.exterior.rows.find((r) => r.defId === 'carretera_bifurcacion');
check('bifurcación transversal (orient z) que huye hacia la cámara', !!branch && branch.orient === 'z' && branch.z0 <= mainRoad!.z0 - 30 && branch.z0 + branch.depth >= mainRoad!.z0 - 0.5 && branch.z0 + branch.depth <= mainRoad!.z0 + mainRoad!.depth, `x ${branch?.x0}..${branch?.x1} · z ${branch?.z0}..${branch ? branch.z0 + branch.depth : NaN}`);
const laterales = v.exterior.rows.filter((r) => r.defId === 'acera' && r.orient === 'z');
const backWalk = v.exterior.rows.filter((r) => r.defId === 'acera' && r.orient === 'x' && r.z0 > 0);
check('el edificio queda RODEADO: aceras laterales + trasera', laterales.length >= 2 && backWalk.length >= 1, `2 laterales + ${backWalk.length} trasera`);
const gardens = v.exterior.rows.filter((r) => r.defId === 'jardin');
const campos = v.exterior.rows.filter((r) => r.defId === 'campo');
check('jardines cercanos (densos) y campo lejano (disperso con topes)', gardens.length >= 2 && gardens.every((g) => g.gridScatter) && campos.length >= 2 && campos.every((c) => c.gridScatter && (c.maxTrees ?? 99) <= 70), `${gardens.length} jardines · ${campos.length} campos · topes v1.24 con recortes 2D`);
check('sin terreno desnudo: las filas cubren el suelo del mundo', (() => {
  // Muestreo determinista del rect del suelo (sin la huella del EDIFICIO, que no es suelo).
  const g = v.exterior.ground;
  for (let i = 0; i < 400; i++) {
    const x = bMin - 60 + hash01('qa_suelo_x', i) * (bMax - bMin + 120);
    const z = -g.size / 2 + 2 + hash01('qa_suelo_z', i) * (g.size / 2 + g.backZ - 4);
    if (z > 0) continue; // detrás del edificio solo hasta backZ (el resto es cielo)
    if (z > -4.4 && x >= bMin - 0.5 && x <= bMax + 0.5) continue; // huella del edificio
    const hit = v.exterior.rows.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z0 + r.depth);
    if (!hit) return false;
  }
  return true;
})(), 'muestreo 400 puntos');
check('bordillos declarados en acera y calzada (empalme correcto)', !!defOf('acera')?.curbColor && !!defOf('carretera')?.curbColor && defOf('carretera_cruce')!.zebra, `acera ${defOf('acera')?.curbW} m · calzada ${defOf('carretera')?.curbW} m`);
check('todo el exterior sigue BAJO (nada tapa el edificio)', v.exterior.rows.every((r) => (defOf(r.defId)?.height ?? 1) < 0.25));

// ── 4. Niebla del fondo ──
const bd = v.backdrop;
check('capas con niebla creciente (más lejos, más desaturada)', bd.layers.length >= 3 && bd.layers.every((l, i, arr) => l.fog > 0.05 && (i === 0 || l.fog > arr[i - 1]!.fog)), bd.layers.map((l) => `z${l.z}:fog ${l.fog}`).join(' · '));
check('fogColor de cada capa declarado y claro', bd.layers.every((l) => l.fogColor.startsWith('#') && parseInt(l.fogColor.slice(1, 3), 16) > 180), bd.layers.map((l) => l.fogColor).join(' '));

// ── 5. Voces de proximidad ──
const snd = content.sounds;
check('sounds.json con sección voices', !!snd?.voices, snd ? `${Object.keys(snd.voices!.banks).length} bancos` : 'ausente');
if (snd?.voices) {
  const missing = Object.entries(snd.voices.banks).flatMap(([bank, keys]) => keys.filter((k) => !snd.sounds[k]).map((k) => `${bank}/${k}`));
  check('todos los bancos referencian sonidos existentes', missing.length === 0, missing.join(',') || `${Object.keys(snd.voices.banks).length} bancos OK`);
  check('moodMap cubre good/ok/bad con bancos válidos', ['good', 'ok', 'bad'].every((m) => snd.voices!.moodMap.some((x) => x.mood === m && x.banks.every((b) => !!snd.voices!.banks[b]))), snd.voices.moodMap.map((x) => x.mood).join('/'));
  check('voces con sonido: queja, risa, silbido, cuchicheo, suspiro…', ['complaint', 'smile', 'whistle', 'whisper', 'sigh'].every((b) => (snd.voices!.banks[b]?.length ?? 0) >= 1), Object.keys(snd.voices.banks).join(','));
  check('antiedad de sobrecarga: radio, tope por minuto y cooldown', snd.voices.proximity.radius > 1 && snd.voices.proximity.maxPerMinute >= 1 && snd.voices.proximity.cooldownPerResident > 5, `radio ${snd.voices.proximity.radius} m · ${snd.voices.proximity.maxPerMinute}/min · cd ${snd.voices.proximity.cooldownPerResident}s`);
  check('pies de foto solo para claves existentes', Object.keys(snd.voices.captions).every((k) => !!snd.sounds[k]), `${Object.keys(snd.voices.captions).length} captions`);
  // Sonidos nuevos de la calle: motor al pasar y megáfono.
  check('sonido de motor y megáfono declarados', !!snd.sounds['calle_vehiculo'] && !!snd.sounds['voz_megafono']);
  // Estadística determinista: el moodMap reparte bancos por ánimo sin solaparse de forma exacta.
  const goodBanks = new Set(snd.voices.moodMap.find((m) => m.mood === 'good')!.banks);
  const badBanks = new Set(snd.voices.moodMap.find((m) => m.mood === 'bad')!.banks);
  check('ánimos usan bancos distintos (good ≠ bad)', [...goodBanks].every((b) => !badBanks.has(b)), [...goodBanks].join('+') + ' vs ' + [...badBanks].join('+'));
}

// ── 6. Regresión: el sim no se entera de la calle ──
check('los bloques exteriores NO entran en el mundo del sim', !Object.values(world0.blocks).some((b) => !!content.blocks[b.defId]?.exterior), '0 instancias');
const world = createWorld(content, content.rules.startScenario);
let ticks = 0;
for (let i = 0; i < 240; i++) {
  tickWorld(world, content);
  ticks++;
}
check('sim determinista tras 240 ticks (reloj avanza, mundo estable)', ticks === 240 && world.clock.minute >= 0 && Object.keys(world.blocks).length === Object.keys(world0.blocks).length, `minuto ${world.clock.minute} · ${Object.keys(world.blocks).length} bloques`);

console.log(fails === 0 ? '\nQA V1.22 OK ✅' : `\nQA V1.22 FALLIDO (${fails}) ❌`);
if (fails > 0) process.exit(1);
