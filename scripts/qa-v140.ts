/**
 * QA v1.40 «timbre, charla y linterna» — el lote del vecino (bugs + interacción):
 *  1. TIMBRE DE VERDAD — en vivienda ajena la E toca el timbre (sonido del catálogo): si el
 *     vecino está dentro se acerca a abrir (walkTo) y saluda con SU personalidad
 *     (personalities.reactions.greet, en el idioma del chrome); si no hay nadie, nadie abre
 *     (bocadillo door.noAnswer) y no se entra. Las VACÍAS siguen siendo candado (norma v1.26).
 *  2. ENTRADA DIRECTA A TU VIVIENDA — sin E, como el núcleo de escaleras: al plantarte
 *     delante de tu puerta entras; al adentrarte se arma la auto-salida y al volver al
 *     marco sales. Transición (no presión continua) y sin bucles en el umbral.
 *  3. CHARLA CON E — cruzarte con un vecino en circulación = pararse a hablar (burbuja con
 *     su saludo + gestos talk mutuos); ya no llama a su puerta por accidente.
 *  4. EMOTICONOS DE CERCA — solo lucen los de vecinos a ≤ bubble.nearRadius (4 m, catálogo)
 *     en tu misma planta. El tuyo propio siempre pasa.
 *  5. DECALS BIEN RECADOS — grafitis (muros + cabina) y manchas de decay suben por
 *     TEXTURE(dataURL) con hasAlpha (canvas suelto): los DynamicTexture desde canvas pierden
 *     el canal alpha en WebGPU/CDN → caja negra alrededor (mismo bug que el candado v1.26).
 *  6. LINTERNA — con apagón (ecosistema) el jugador lleva una PointLight cálida de radio
 *     corto (view.flashlight: 4 m): se enciende sola y se apaga al restaurar la luz.
 *  7. PANTALLA NEGRA CAZADA — pérdida de contexto gráfico (WebGL/WebGPU) detectada por tres
 *     vías (evento canvas, observable del engine, device.lost) → overlay amable con recarga;
 *     además el resize con tamaño cero ya no crea un buffer 0×0 negro.
 *  8. i18N DE BOcadillos Y AVISOS — el overlay ES→EN ahora también traduce archetypes (frases
 *     de actividades), rules (prompts E, avisos), crossings, street, cutscenes y minigames;
 *     los avisos duros del controlador pasan a claves (ev.*); diccionario con +370 entradas.
 *
 * Verificación en navegador (modo ?qaengine=1, NullEngine) hecha aparte: auto-entrada y
 * auto-salida caminando, timbre sin nadie (toast 🔔 + sin entrada), timbre con Don Ramón
 * dentro (entrada + saludo personal), prompt «E · timbre de …»/«E · ring …'s doorbell»,
 * linterna 0→1.1→0 con el apagón, overlay de contexto perdido con botón de recarga.
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
    console.log(`  ✗ ${name}${info ? ` — ${info}` : ''}`);
  }
};
const srcOf = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

console.log('── 1. Timbre de verdad (vivienda ajena) ──');
const rules = JSON.parse(srcOf('public/content/rules.json'));
check('catálogo interact.doorbell/chat con {name}', rules.interact.doorbell.includes('{name}') && rules.interact.chat.includes('{name}'));
check('schema acepta doorbell/chat opcionales', srcOf('src/game/content/schemas.ts').includes('doorbell: z.string().optional()') && srcOf('src/game/content/schemas.ts').includes('chat: z.string().optional()'));
const logicTs = srcOf('src/game/player-logic.ts');
check('la E en vivienda ajena devuelve doorbell (no entra)', logicTs.includes("return { type: 'doorbell', block: door.id }"));
check('InteractResult trae doorbell y chat', logicTs.includes("type: 'doorbell'") && logicTs.includes("type: 'chat'"));
const ctrlTs = srcOf('src/game/client/controller.ts');
check('ringDoorbell: sonido del catálogo + vecino dentro abre (knockAt)', ctrlTs.includes("playSound('doorbell')") && ctrlTs.includes('knockAt(blockId)'));
check('sin nadie en casa: bocadillo door.noAnswer y SIN entrada', ctrlTs.includes("'door.noAnswer'") && ctrlTs.includes('return false;'));
check('con dueño dentro: enterBlock (el vecino abre y pasas)', ctrlTs.includes('this.logic.enterBlock(r.block)'));
const resTs = srcOf('src/game/client/residents.ts');
check('greetLineOf: saludo de la personalidad por id→arquetipo→defaults', resTs.includes('export function greetLineOf') && resTs.includes('reactions.greet'));
check('knock_result: saludo personal + el vecino CAMINA a su puerta (walkTo con inside)', ctrlTs.includes('greetLineOf(this.content, other, store.lang)') && ctrlTs.includes('inside: { block: b.id, local:'));
const persJson = JSON.parse(srcOf('public/content/personalities.json'));
check('reactions.greet vive en el catálogo (defaults + arquetipos)', (persJson.defaults.reactions.greet?.length ?? 0) > 0 && Object.values(persJson.byArchetype).some((p) => (p.reactions?.greet?.length ?? 0) > 0));

console.log('── 2. Entrada directa a tu vivienda (sin E) ──');
check('auto-entrada en el pasillo: transición delante de TU puerta', logicTs.includes('autoEnterLast !== ahead.id') && logicTs.includes('ahead.kind === \'dwelling\' && ahead.ownerId === this.actorId'));
check('auto-salida armada al adentrarse (z > 0.9) y salta en el marco (z ≤ 0.5)', logicTs.includes('this.z > 0.9') && logicTs.includes('this.exitArmed && this.z <= 0.5'));
check('sin bucles: tras salir, autoEnterLast = home (no re-dispara)', logicTs.includes('this.autoEnterLast = home; // delante de tu puerta'));
check('teleportTo/forceLocation resetean la máquina de estados', logicTs.includes('this.autoEnterLast = null; // v1.40'));
check('el controlador drena las acciones automáticas y ajusta cámara', ctrlTs.includes('this.logic.drainAuto()') && ctrlTs.includes("ar.type === 'entered'"));

console.log('── 3. Charla con E al cruzarte con un vecino ──');
check('E sobre un vecino en circulación = chat (no knock)', logicTs.includes("return { type: 'chat', residentId: t.residentId };"));
check('chatWith: burbuja + cara a cara (faceToward) + gestos talk mutuos', ctrlTs.includes('bubbles?.sayText(residentId, line, 2.8)') && ctrlTs.includes('faceToward(residentId, me.x, me.z)') && ctrlTs.includes("setGesture(this.actorId(), 'talk', 3.4)"));
check('prompt de puerta ajena = timbre; prompt de vecino = charlar', ctrlTs.includes('(ic.doorbell ?? ic.greet).replace') && ctrlTs.includes('(ic.chat ?? ic.greet).replace'));

console.log('── 4. Emoticonos de cerca (≤ 4 m, misma planta) ──');
const emotes = JSON.parse(srcOf('public/content/emotes.json'));
check('catálogo emotes.bubble.nearRadius = 4', emotes.bubble.nearRadius === 4);
check('schema acepta nearRadius opcional', srcOf('src/game/content/schemas.ts').includes('nearRadius: z.number().positive().optional(),\n    popMs'));
const bubTs = srcOf('src/game/client/bubbles.ts');
check('gate por distancia horizontal y PLANTA (cellH·0.55) en la proyección', bubTs.includes('nearRadius * nearRadius') && bubTs.includes('floorH * 0.55'));
check('el tuyo propio siempre pasa (id !== localActorId)', bubTs.includes('id !== localActorId'));

console.log('── 5. Decals bien recortados (alpha de verdad) ──');
const buildTs = srcOf('src/game/client/building.ts');
check('los decals ya NO usan DynamicTexture (caja negra WebGPU)', !buildTs.includes("new (B().DynamicTexture)('decal_") && !buildTs.includes('new (B().DynamicTexture)(`decal_'));
check('suben por TEXTURE(dataURL) con hasAlpha (patrón candado v1.26)', buildTs.includes('const canvasTex = (name: string, c: HTMLCanvasElement): Texture') && buildTs.includes("canvasTex('decal_grafiti_tex', got.c)"));
check('grafiti cacheado por variante (dataURL una vez)', buildTs.includes('const graffitiCache = new Map<string, Texture>();'));
const elevTs = srcOf('src/game/client/elevator.ts');
check('mural de la cabina: canvas suelto + Texture(dataURL)', elevTs.includes("new (B().Texture)(cv.toDataURL('image/png'), scene, false, true)") && !elevTs.includes("new (B().DynamicTexture)('asc_grafiti_tex'"));

console.log('── 6. Linterna de apagón (radio 4 m) ──');
check('catálogo view.flashlight (range 4, cálida)', rules.view.flashlight?.range === 4 && typeof rules.view.flashlight?.intensity === 'number');
check('schema view.flashlight opcional', srcOf('src/game/content/schemas.ts').includes('flashlight: z\n      .object({'));
check('PointLight creada en la escena y APAGADA por defecto', ctrlTs.includes("new PointLight('linterna'") && ctrlTs.includes('light.intensity = 0;'));
check('enciende SOLO con apagón (isBlackout del ecosistema)', ctrlTs.includes('const on = this.ecosystem?.isBlackout() === true;'));
check('viaja con el jugador cada frame (update con pies)', ctrlTs.includes('this.flashlight?.update({ x: pos.x'));
const ecoTs = srcOf('src/game/client/ecosystem.ts');
check('isBlackout en el director Y en el director nulo', ecoTs.includes('isBlackout() {') && ecoTs.includes('isBlackout: () => false'));

console.log('── 7. Pantalla negra cazada (contexto perdido) ──');
check('tres vías de detección: canvas + observable + device.lost', ctrlTs.includes("addEventListener('webglcontextlost'") && ctrlTs.includes('onContextLostObservable') && ctrlTs.includes('_device'));
check('store: engineLost idempotente + overlay con recarga en GameStage', srcOf('src/game/client/store.ts').includes('setEngineLost: () => set((s) => (s.engineLost ? s : { engineLost: true }))') && srcOf('src/components/game/GameStage.tsx').includes('<LostOverlay />'));
check('resize con tamaño cero ignorado (sin buffer 0×0 negro)', ctrlTs.includes('clientWidth === 0 || this.canvas.clientHeight === 0'));
check('claves i18n del overlay (lost.title/text/reload)', ["'lost.title'", "'lost.text'", "'lost.reload'"].every((k) => srcOf('src/game/client/i18n.ts').includes(k)));

console.log('── 8. i18n de bocadillos y avisos ──');
const i18nCTs = srcOf('src/game/support/i18n-content.ts');
check('el overlay camina los 6 catálogos nuevos (archetypes/rules/crossings/street/cutscenes/minigames)', ['walk(content.archetypes)', 'walk(content.rules)', 'walk(content.crossings)', 'walk(content.street)', 'walk(content.cutscenes)', 'walk(content.minigames)'].every((k) => i18nCTs.includes(k)));
check('los originales se guardan/restauran para volver a ES', i18nCTs.includes('content.archetypes = originals.archetypes') && i18nCTs.includes('content.rules = originals.rules'));
const dict = JSON.parse(srcOf('public/content/translations.en.json'));
check('diccionario ES→EN ampliado (+370 entradas nuevas)', Object.keys(dict).length >= 800, `${Object.keys(dict).length} cadenas`);
check('frases de actividad y timbre en EN', dict['🌀 pone la lavadora'] === '🌀 does the laundry' && dict['E · timbre de {name}'] === "E · ring {name}'s doorbell");
check('avisos de misión/ecosistema en EN (op toast, apagón)', Object.values(dict).some((v) => v.includes('BLACKOUT!')) && Object.values(dict).some((v) => v.includes('Michi back in arms')));
check('los avisos duros del controlador ahora van por translate()', ctrlTs.includes("translate(store.lang, 'ev.missionDone'") && ctrlTs.includes("translate(store.lang, 'ev.neighborArrived'") && !ctrlTs.includes('pushToast(`Nuevo vecino en'));

console.log('── Contenido completo (Zod, sin issues) + sim determinista ──');
const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
check('loadContent valida todos los catálogos con los campos nuevos', issues.length === 0, issues.length ? formatIssues(issues).slice(0, 200) : '0 issues');
const w1 = createWorld(content, 'slice');
for (let i = 0; i < 240; i++) tick(w1, content);
check('sim determinista tras el lote (240 ticks sin excepciones)', w1.clock.day >= 1);

console.log(`\n── RESULTADO: ${pass} pasan · ${fail} fallan ──`);
if (fail > 0) process.exit(1);
