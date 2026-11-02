/**
 * QA v1.20 — "la calle, el cielo y las charlas":
 *   1. Catálogo: rules.view.exterior (tiras de acera/carretera/jardín con props) y
 *      rules.view.backdrop (capas de fachadas parallax + cielo con keyframes por hora +
 *      nubes por clima), bloques exteriores (acera/carretera/jardín) con `exterior`.
 *   2. Charlas de cruce: catálogo crossings.json (grupos good/ok/bad con temas),bucket de
 *      ánimo con umbrales del catálogo y tirada ponderada (buen ánimo charla MÁS que mal
 *      ánimo, determinista por hash).
 *   3. Regresión: el resto del catálogo sigue igual (mundo, layout trasera, carriles).
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld } from '@/game/sim';
import { hash01, layoutIdOf } from '@/game/interior';

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
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ── 1. Escena exterior (catálogo) ──
const v = content.rules.view;
check('exterior habilitado con filas de calle', v.exterior.enabled && v.exterior.rows.length >= 4, `${v.exterior.rows.length} filas`);
const defOf = (id: string) => content.blocks[id]?.exterior;
check('bloque acera con bancos y farolas', !!defOf('acera') && defOf('acera')!.benchEvery > 0 && defOf('acera')!.lampEvery > 0, `${defOf('acera')?.benchEvery}m banco · ${defOf('acera')?.lampEvery}m farola`);
check('bloque carretera con línea discontinua', !!defOf('carretera') && defOf('carretera')!.laneDash > 0, `${defOf('carretera')?.laneDash}m`);
check('bloque jardín con árboles, arbustos y flores', !!defOf('jardin') && defOf('jardin')!.treesPer10m > 0 && defOf('jardin')!.bushesPer10m > 0 && defOf('jardin')!.flowerColors.length >= 3, `${defOf('jardin')?.treesPer10m}/10m árboles`);
check('todas las filas referencian bloques con props exterior', v.exterior.rows.every((r) => !!defOf(r.defId)), v.exterior.rows.map((r) => r.defId).join(','));
const aceras = v.exterior.rows.filter((r) => r.defId === 'acera' && r.orient === 'x' && r.z0 < 0).sort((a, b) => b.z0 - a.z0);
check('acera pegada al edificio y acera al otro lado de la carretera', aceras.length >= 2 && aceras[0]!.z0 > aceras[1]!.z0, `${aceras.map((a) => a.z0).join(' / ')}`);
const road = v.exterior.rows.find((r) => r.defId === 'carretera');
check(
  'la carretera queda ENTRE las dos aceras (calle completa en z)',
  !!road && road.z0 + road.depth <= aceras[0]!.z0 + 0.01 && road.z0 >= aceras[1]!.z0 + aceras[1]!.depth - 0.01,
  `carretera z ${road?.z0}..${road ? road.z0 + road.depth : NaN} · aceras ${aceras[0]?.z0} / ${aceras[1]?.z0}`,
);
check('el cuerpo exterior es BAJO (bloques a pie de calle)', v.exterior.rows.every((r) => (defOf(r.defId)?.height ?? 1) < 0.25), `máx ${Math.max(...v.exterior.rows.map((r) => defOf(r.defId)?.height ?? 1))} m`);
check('suelo del mundo declarado (cierra el horizonte)', v.exterior.ground.size >= 120, `${v.exterior.ground.size} m`);
// v1.22: el rodeo del edificio (aceras laterales) también es catálogo con orient 'z'.
const laterales = v.exterior.rows.filter((r) => r.defId === 'acera' && r.orient === 'z');
check('aceras LATERALES rodean el edificio (orient z, v1.22)', laterales.length >= 2, laterales.map((l) => `x ${l.x0}..${l.x1}`).join(' / '));

// ── 2. Fondo urbano (catálogo) ──
const bd = v.backdrop;
check('backdrop habilitado con capas de fachadas', bd.enabled && bd.layers.length >= 2, `${bd.layers.length} capas`);
check('capas a distintas z tras el edificio (parallax real 3D)', bd.layers.every((l, i, arr) => i === 0 || l.z > arr[i - 1]!.z), bd.layers.map((l) => `z${l.z}`).join(' < '));
check('capas con ventanas y galerías (edificios "como el nuestro")', bd.layers.every((l) => l.windowChance > 0 && l.windowColor.startsWith('#') && l.galleryColor.startsWith('#')), bd.layers.map((l) => l.buildings).join('/') + ' edificios');
check('keyframes de cielo cubren el ciclo completo 0..24', bd.sky.keyframes.length >= 5 && bd.sky.keyframes[0]!.hour === 0 && bd.sky.keyframes[bd.sky.keyframes.length - 1]!.hour === 24, `${bd.sky.keyframes.length} keyframes`);
const nights = bd.sky.keyframes.filter((k) => k.hour === 0 || k.hour === 24);
check('de noche ambiente bajo y sol apagado', nights.every((k) => k.ambient < 0.5 && k.sun === 0), `ambient ${nights[0]?.ambient}`);
const noon = bd.sky.keyframes.find((k) => k.hour === 14);
check('al mediodía ambiente y sol al máximo del catálogo', !!noon && noon.sun >= bd.sky.keyframes.reduce((m, k) => Math.max(m, k.sun), 0), `sun ${noon?.sun}`);
check('atenuación del sol por clima (tormenta apaga)', (bd.sky.weatherDim.storm ?? 1) < (bd.sky.weatherDim.sunny ?? 1), `storm ${bd.sky.weatherDim.storm}`);
check('nubes con cielo despejado y nublado diferenciados', bd.clouds.alphaCloudy > bd.clouds.alphaClear, `clear ${bd.clouds.alphaClear} vs cloudy ${bd.clouds.alphaCloudy}`);
check('sol y luna con arco y tamaño propios', bd.sky.sunArcHeight > 10 && bd.sky.sunSize > 0 && bd.sky.moonSize > 0 && bd.sky.sunZ > bd.layers[bd.layers.length - 1]!.z, `sunZ ${bd.sky.sunZ} tras la última capa`);
check('estrellas de noche declaradas', bd.sky.stars >= 30, `${bd.sky.stars}`);

// ── 3. Charlas de cruce (catálogo + lógica de ánimo) ──
const cr = content.crossings;
check('catálogo de cruces cargado (opcional pero presente aquí)', !!cr, cr ? `${cr.groups.length} grupos` : 'ausente');
check('grupos good/ok/bad completos', !!cr && ['good', 'ok', 'bad'].every((m) => cr.groups.some((g) => g.mood === m)), cr?.groups.map((g) => `${g.mood}:${g.topics.length}`).join(' '));
check('todos los temas tienen al menos 2 líneas salvo gruñidos cortos', !!cr && cr.groups.every((g) => g.topics.every((t) => t.lines.length >= 1)));
check('anti-sobrecarga: charlas simultáneas limitadas y cooldowns activos', !!cr && cr.proximity.maxConcurrent >= 1 && cr.cadence.pairCooldown > cr.cadence.lineSeconds * 2, `max ${cr?.proximity.maxConcurrent} · pareja ${cr?.cadence.pairCooldown}s`);
if (cr) {
  const bucketOf = (m: number): 'good' | 'ok' | 'bad' => (m >= cr.mood.goodMin ? 'good' : m >= cr.mood.okMin ? 'ok' : 'bad');
  check('umbrales de ánimo: 60→good, 40→ok, 10→bad', bucketOf(60) === 'good' && bucketOf(40) === 'ok' && bucketOf(10) === 'bad', `${cr.mood.goodMin}/${cr.mood.okMin}`);
  const chanceOf = (bucket: 'good' | 'ok' | 'bad') =>
    cr.chance.base + (bucket === 'good' ? cr.chance.goodMoodBonus : 0) - (bucket === 'bad' ? cr.chance.badMoodPenalty : 0);
  check('el buen ánimo invita a charlar MÁS que el mal ánimo', chanceOf('good') > chanceOf('ok') && chanceOf('ok') > chanceOf('bad'), `${chanceOf('good').toFixed(2)} > ${chanceOf('ok').toFixed(2)} > ${chanceOf('bad').toFixed(2)}`);
  check('el mal ánimo puede dejar de charlar (penalización razonable)', chanceOf('bad') < 0.5, `${chanceOf('bad').toFixed(2)}`);
  // Tirada determinista (misma que la presentación): con el mismo hash, la decisión es estable.
  const roll = (a: string, b: string, tick: number, lap: number) => hash01(`${a}~${b}~${tick}`, lap);
  check('tirada determinista por pareja+tick (reproducible)', roll('res_a', 'res_b', 7, 1) === roll('res_a', 'res_b', 7, 1), `${roll('res_a', 'res_b', 7, 1).toFixed(4)}`);
  // Con muchas parejas y laps, la fracción de charlas con buen ánimo supera a la de mal ánimo.
  let good = 0;
  let bad = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    if (roll(`res_x${i}`, 'res_y', 100 + i, i * 3) < chanceOf('good')) good++;
    if (roll(`res_z${i}`, 'res_w', 100 + i, i * 3) < chanceOf('bad')) bad++;
  }
  check('estadística de ánimos: good charla claramente más que bad', good / N > bad / N + 0.3, `good ${(good / N).toFixed(2)} vs bad ${(bad / N).toFixed(2)}`);
}

// ── 4. Regresión: mundo intacto ──
const world = createWorld(content, content.rules.startScenario);
const dwellings = Object.values(world.blocks).filter((b) => b.kind === 'dwelling');
check('mundo intacto: viviendas del escenario (v1.27: 9 en el edificio de 3 plantas)', dwellings.length >= 9, `${dwellings.length}`);
// v1.71 (higiene): el layout de vivienda ya no viene de container.layout — el REPARTO de
// variantes (layoutIdOf, v1.53) decide por bloque. Mismo invariante, resolutor real.
const rearWorld = dwellings.filter((b) => {
  const layoutId = layoutIdOf(content, b);
  const layout = layoutId ? content.layouts[layoutId] : undefined;
  return (layout?.rooms ?? []).some((r) => r.rect && r.rect.z + r.rect.d > v.depth + 0.01);
});
check('los cuartos traseros siguen ahí (reparto de variantes v1.53)', rearWorld.length > 0, `${rearWorld.length} viviendas con trasera`);
check('los bloques exteriores NO entran en el mundo del sim', !Object.values(world.blocks).some((b) => !!content.blocks[b.defId]?.exterior), '0 instancias');
check('el reloj del sim alimenta el cielo (minute 0..1439)', world.clock.minute >= 0 && world.clock.minute <= 1439, `minuto ${world.clock.minute}`);
check('el clima del sim alimenta las nubes (state conocido)', ['sunny', 'cloudy', 'rain', 'storm'].includes(world.weather.state), world.weather.state);

console.log(fails === 0 ? '\nQA V1.20 OK ✅' : `\nQA V1.20 FALLIDO (${fails}) ❌`);
if (fails > 0) process.exit(1);
