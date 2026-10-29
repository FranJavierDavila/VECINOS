/**
 * QA v1.39 «vida, música y accesibilidad» — el lote de EXPERIENCIA aprobado por el jugador:
 *  1. MÚSICA PROCEDURAL — banda sonora generativa 100% Web Audio (sin ficheros): un contexto
 *     musical por franja horaria (mañana/tarde/evening/noche: tempo, tónica, escala, acordes,
 *     ganancias por capa) + capa de lluvia/tormenta; ducking en pausa; opción «Música».
 *  2. MENÚ DE PAUSA DE VERDAD — overlay a pantalla completa (Reanudar/Opciones/Guardar/Salir),
 *     abre con Escape/Start/botón, congela el mundo (paused) y pliega Opciones dentro.
 *  3. ONBOARDING «PRIMER DÍA» — tutorial guiado no bloqueante (bienvenida + 4 pasos + consejos
 *     contextuales one-shot), data-driven (onboarding.json), persistente por perfil de navegador.
 *  4. META DE LARGO PLAZO — «Mejorar el edificio» con 3 niveles (misiones/arcas/reputación),
 *     tarjeta siempre visible y recompensa narrativa (project.json + support/project.ts).
 *  5. VECINOS COMO PERSONAJES — personalities.json en superficie: nombre, gustos, frase
 *     característica y reacciones contextuales (lluvia/sol/noche/saludo/misión) por arquetipo.
 *  6. ACCESIBILIDAD — tamaño de texto (raíz), modo daltónico (filtros SVG), reducir animaciones
 *     (game-no-anim) e i18n del CONTENIDO (overlay ES→EN de misiones/diálogos).
 *
 * Verificación en navegador (modo ?qaengine=1, NullEngine) hecha aparte: música sonando con
 * contexto morning→night, menú de pausa completo, tutorial 4 pasos con caminar/leer tablón,
 * tarjeta del proyecto con arcas en vivo, Dolores/Kevin con gustos, filtros aplicados.
 */
import fs from 'fs';
import path from 'path';
import { loadContent, formatIssues } from '@/game/content';
import { evaluateProject } from '@/game/support/project';
import type { Content, MusicCatalog, ProjectCatalog, OnboardingCatalog, PersonalitiesCatalog } from '@/game/core/types';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, info = ''): void => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}${info ? ` — ${info}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`);
  }
};
const srcOf = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

console.log('── 1. Música procedural (sin ficheros, franja horaria + lluvia) ──');
const musicJson = JSON.parse(srcOf('public/content/music.json')) as MusicCatalog;
check('catálogo music.json: 4 contextos horarios', Object.keys(musicJson.contexts).sort().join(',') === 'afternoon,evening,morning,night');
check('franjas cubren las 24 h (morning 360-720, afternoon 720-1140, evening 1140-1410, night resto)',
  musicJson.dayParts.morning.from === 360 && musicJson.dayParts.afternoon.to === 1140 && musicJson.dayParts.evening.to === 1410);
check('cada contexto trae tempo/escala/acordes/ganancias y ondas por capa',
  Object.values(musicJson.contexts).every((c) => c.tempo > 40 && c.scale.length >= 5 && c.chords.length >= 3 && c.waves.bass === 'sine'));
check('capa de lluvia del catálogo (ganancia normal y de tormenta + filtro)', musicJson.rain.gain > 0 && musicJson.rain.stormGain > musicJson.rain.gain && musicJson.rain.filterHz > 0);
const musicTs = srcOf('src/game/client/music.ts');
check('director agenda compases por adelantado y cambia de contexto en BORDE de compás',
  musicTs.includes('setInterval(scheduleAhead, 400)') && musicTs.includes('pendingCtx ?? currentCtx'));
check('el bus de música cuelga del BUS MAESTRO (hereda volumen/silencio del jugador)', musicTs.includes('audioBus()') && musicTs.includes('bus.connect(got.master)'));
check('DUCKING en pausa/modal (siempre, lluvia incluida)', musicTs.includes('const goal = ducked ? base * catalog.duckGain : base;'));
const audioTs = srcOf('src/game/client/audio.ts');
check('audio.ts expone el bus maestro para el director de música', audioTs.includes('export function audioBus()'));
check('opción «Música» persistida + applyMusic en el controlador',
  srcOf('src/game/client/options.ts').includes('music: boolean') && srcOf('src/game/client/controller.ts').includes('applyMusic(v: boolean)'));
check('el frame alimenta al director (minuto, clima, ducking)', srcOf('src/game/client/controller.ts').includes('this.music?.update(this.world.clock.minute, this.world.weather.state, frozenMusic)'));

console.log('── 2. Menú de pausa de verdad (overlay completo) ──');
const pauseTs = srcOf('src/components/game/PauseMenu.tsx');
check('overlay a pantalla completa con las 4 acciones (Reanudar/Opciones/Guardar/Salir)',
  pauseTs.includes("t('pause.resume')") && pauseTs.includes("t('pause.options')") && pauseTs.includes("t('ctrl.save')") && pauseTs.includes("t('pause.exit')"));
check('aria-modal + role=dialog (accesible)', pauseTs.includes('aria-modal="true"') && pauseTs.includes('role="dialog"'));
const ctrlTs = srcOf('src/game/client/controller.ts');
check('abrir el menú CONGELA el mundo (setPaused(open))', ctrlTs.includes('store.setPauseMenuOpen(open);') && ctrlTs.includes('store.setPaused(open);'));
check('se abre con Escape (teclado), Start del mando y el botón de la barra',
  ctrlTs.includes('togglePauseMenu()') && srcOf('src/game/client/gamepad.ts').includes('c?.togglePauseMenu()') && srcOf('src/components/game/PostItControls.tsx').includes('togglePauseMenu()'));
check('montado en GameStage junto al tutorial', srcOf('src/components/game/GameStage.tsx').includes('<PauseMenu />') && srcOf('src/components/game/GameStage.tsx').includes('<TutorialCard />'));
const i18nTs = srcOf('src/game/client/i18n.ts');
check('textos del menú en ES/EN (pause.title/resume/options/exit)', ["'pause.title'", "'pause.resume'", "'pause.options'", "'pause.exit'"].every((k) => i18nTs.includes(k)));

console.log('── 3. Onboarding «primer día» (no bloqueante, data-driven) ──');
const onbJson = JSON.parse(srcOf('public/content/onboarding.json')) as OnboardingCatalog;
check('catálogo onboarding.json activo con bienvenida + 4 pasos', onbJson.enabled === true && onbJson.steps.length === 4 && onbJson.welcome.cta.es.length > 0);
check('pasos = moverse, tablón, tarea, vecino (en este orden)', onbJson.steps.map((s) => s.id).join(',') === 'move,noticeboard,task,neighbor');
check('consejos contextuales one-shot (teléfono, junta, ascensor, minijuego…)', onbJson.tips.length >= 4 && onbJson.tips.every((tp) => tp.text.es.length > 0));
check('bilingüe ES/EN en todos los pasos', onbJson.steps.every((s) => s.title.es.length > 0 && s.title.en.length > 0 && s.text.en.length > 0));
const tutTs = srcOf('src/game/client/tutorial.ts');
check('director con señales (movimiento, interacción, misión) y persistencia por perfil',
  tutTs.includes('moved(meters: number)') && tutTs.includes('notify(signal: TutorialSignal)') && tutTs.includes("localStorage.setItem(KEY"));
check('el controlador alimenta: pasos caminados, E en tablón/vecino y misión completada',
  ctrlTs.includes('this.tutorial.moved(d)') && ctrlTs.includes('this.tutorial.notify(`used:${r.kind}`)') && ctrlTs.includes("this.tutorial.notify('mission_completed')"));
check('consejos contextuales al desbloquear sistemas (teléfono/junta/ascensor/minijuego)',
  ctrlTs.includes("this.tutorial.tip('phone')") && ctrlTs.includes("this.tutorial.tip('junta')") && ctrlTs.includes("this.tutorial.tip('elevator')") && ctrlTs.includes("this.tutorial.tip('minigame')"));

console.log('── 4. Meta de largo plazo («mejorar el edificio» a nivel 3) ──');
const projJson = JSON.parse(srcOf('public/content/project.json')) as ProjectCatalog;
check('catálogo project.json con 3 niveles de temporada', projJson.levels.length === 3 && projJson.levels[2]!.id === 'orgullo');
check('nivel 3 exige proyecto comunitario (15 misiones + 4500 € + reputación)', projJson.levels[2]!.goal.missions === 15 && projJson.levels[2]!.goal.funds === 4500 && projJson.levels[2]!.goal.reputation === 70);
check('recompensa narrativa bilingüe en cada nivel', projJson.levels.every((l) => l.reward.es.length > 0 && l.reward.en.length > 0));
check('evaluador puro support/project.ts + tarjeta siempre visible',
  fs.existsSync(path.join(process.cwd(), 'src/game/support/project.ts')) && srcOf('src/app/page.tsx').includes('<ProjectCard'));
const projState = evaluateProject(projJson, { missions: 8, funds: 2500, reputation: 62 });
check('evaluador: 8 misiones + 2500 € + rep 62 ⇒ NIVEL 2 cumplido (querido)', projState.level === 2, `level=${projState.level}`);

console.log('── 5. Vecinos como personajes (personalidad en superficie) ──');
const persJson = JSON.parse(srcOf('public/content/personalities.json')) as PersonalitiesCatalog;
const archKeys = Object.keys(persJson.byArchetype);
check('personalidad por arquetipo (≥10 arquetipos con nombre propio)', archKeys.length >= 10 && !!persJson.byArchetype.cotilla?.name, archKeys.slice(0, 5).join(','));
check('cada uno trae GUSTOS y FRASE CARACTERÍSTICA', archKeys.every((k) => (persJson.byArchetype[k]!.tastes?.length ?? 0) > 0 && !!persJson.byArchetype[k]!.signature));
check('reacciones contextuales diferenciadas (lluvia/sol/noche/saludo/misión)',
  archKeys.filter((k) => Object.keys(persJson.byArchetype[k]!.reactions ?? {}).length >= 3).length >= 8);
check('bilingüe en nombre/gustos/frases', archKeys.every((k) => !!persJson.byArchetype[k]!.signature!.en));
const resTs = srcOf('src/game/client/residents.ts');
check('resolución por vecino → arquetipo → defaults (una sola verdad)', resTs.includes('p.byResident[resident.id] ?? p.byArchetype[resident.archetype] ?? p.defaults'));
check('comentarios ambientales con carácter en el juego (update elige contexto y pool de reacciones)',
  resTs.includes('persona.reactions[ctx]') && resTs.includes('tastes: (persona?.tastes ?? [])'));
check('pestaña Vecinos muestra nombre/gustos/frase (superficie de verdad)',
  srcOf('src/components/game/ResidentsPanel.tsx').includes('tastes') && srcOf('src/components/game/ResidentsPanel.tsx').includes('quote'));

console.log('── 6. Accesibilidad + i18n del contenido ──');
const optTs = srcOf('src/game/client/options.ts');
check('opciones: textScale (4), colorblind (4 modos) y reduceMotion persistidos',
  optTs.includes("textScale: 'normal'") && optTs.includes("colorblind: 'off'") && optTs.includes('reduceMotion: false') && optTs.includes('TEXT_SCALE_PCT'));
const stageTs = srcOf('src/components/game/GameStage.tsx');
check('tamaño de texto escala la RAÍZ (toda la partida)', stageTs.includes('document.documentElement.style.fontSize') && stageTs.includes('TEXT_SCALE_PCT[textScale]'));
check('modo daltónico: filtros SVG (protanopía/deuteranopía/tritanopía) sobre el lienzo',
  stageTs.includes('filter: `url(#cb-${colorblind})`') && stageTs.includes('id="cb-protanopia"') && stageTs.includes('id="cb-deuteranopia"') && stageTs.includes('id="cb-tritanopia"'));
check('reducir animaciones: clase game-no-anim en el lienzo + regla CSS real',
  stageTs.includes("reduceMotion ? ' game-no-anim'") && srcOf('src/app/globals.css').includes('.game-no-anim *,'));
check('monedas suprimidas con reduce-motion (MoneyOverlay)', srcOf('src/components/game/MoneyOverlay.tsx').includes('reduceMotion ? 0 :'));
check('controles en el panel de opciones (compartido post-it + pausa)',
  srcOf('src/components/game/OptionsPanel.tsx').includes('opt.music') && srcOf('src/components/game/OptionsPanel.tsx').includes('opt.textScale') && srcOf('src/components/game/OptionsPanel.tsx').includes('opt.colorblind') && srcOf('src/components/game/OptionsPanel.tsx').includes('opt.reduceMotion'));
const trEn = JSON.parse(srcOf('public/content/translations.en.json')) as Record<string, string>;
check('overlay de contenido EN con cientos de cadenas (misiones/diálogos)', Object.keys(trEn).length >= 300, `${Object.keys(trEn).length} cadenas`);
check('el overlay se aplica ANTES de expandir tokens (idioma del contenido en boot)', ctrlTs.includes('applyContentLanguageAsync') && ctrlTs.includes('preloadTranslations()'));

console.log('── Contenido completo (Zod, sin issues) ──');
const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
check('loadContent valida los 21 catálogos sin errores', issues.length === 0, issues.length ? formatIssues(issues).slice(0, 200) : '0 issues');
check('los catálogos nuevos quedaron indexados', !!content.music && !!content.onboarding && !!content.project && !!content.personalities);
check('validateContent no añade quejas sobre onboarding/música/proyecto', validateExtra(content) === '');

function validateExtra(c: Content): string {
  const out: string[] = [];
  if (!c.music || !c.music.dayParts) out.push('music.dayParts');
  if (!c.onboarding || c.onboarding.steps.length < 3) out.push('onboarding.steps');
  if (!c.project || c.project.levels.length !== 3) out.push('project.levels');
  if (!c.personalities || Object.keys(c.personalities.byArchetype).length < 8) out.push('personalities.byArchetype');
  return out.join(', ');
}

console.log(`\n── RESULTADO: ${pass} pasan · ${fail} fallan ──`);
if (fail > 0) process.exit(1);
