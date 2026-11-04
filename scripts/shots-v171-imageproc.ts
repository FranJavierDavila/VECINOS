/** Capturas v1.71 — A/B del PASE GLOBAL DE IMAGEN con WebGL REAL (no NullEngine).
 *
 * El pase de imagen (ACES + exposición/contraste) solo se puede JUZGAR con píxeles, así
 * que esta captura arranca el juego con el motor de verdad (swiftshader por software:
 * el sandbox no tiene GPU) y toma DOS capturas idénticas de la misma escena:
 *   · v171-AB-antes.png  — pase apagado (toneMappingEnabled=false, exposure=1, contrast=1)
 *   · v171-AB-despues.png — pase del catálogo (ACES 1.12/1.04)
 * El conmutador es en VIVO (misma cámara, misma hora del sim): la única variable es el pase.
 *
 * Riesgo conocido: WebGL por software puede agotar memoria (por eso existe ?qaengine=1).
 * Si el navegador muere, el QA geométrico (qa-v171-imageproc.ts) queda como verificación
 * formal y este script documenta el intento.
 */
import { chromium } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.80/chrome';
const URL = 'http://localhost:81/';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-extensions', '--disable-background-networking', '--js-flags=--max-old-space-size=768', '--renderer-process-limit=1'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, locale: 'es-ES' });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text());
});

console.log('boot con WebGL real…');
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180_000 });

// El motor real tarda: esperar al store global (__vecinos lo monta GameStage).
let booted = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(5000);
  try {
    booted = await page.evaluate(() => !!(window as unknown as { __vecinos?: unknown }).__vecinos);
    if (booted) break;
  } catch { /* boot */ }
}
if (!booted) {
  console.log('SIN __vecinos (posible OOM de swiftshader) — capturas abortadas');
  await browser.close();
  process.exit(2);
}

// Cerrar diálogos bloqueantes (intro/cutscene) como hacen los QA de navegador.
for (let i = 0; i < 14; i++) {
  const st = await page.evaluate(`(() => { var d=document.querySelector('[role="dialog"]'); if(!d) return 'none'; var b=d.querySelectorAll('button'); if(b.length) b[b.length-1].click(); return 'c'; })()`).catch(() => 'none');
  if (st === 'none') break;
  await page.waitForTimeout(800);
}
await page.waitForTimeout(6000);

const sceneInfo = await page.evaluate(`(() => {
  var c = (window).__vecinos && (window).__vecinos.controller;
  return { hasCanvas: !!document.querySelector('canvas'), hasController: !!c, hasScene: !!(c && c.scene) };
})()`).catch(() => ({ hasCanvas: false }));
console.log('canvas:', JSON.stringify(sceneInfo));

// ANTES: pase apagado (clásico)
await page.evaluate(`(() => {
  var c = (window).__vecinos && (window).__vecinos.controller;
  var scene = c && c.scene;
  if (!scene) throw new Error('sin escena');
  var cfg = scene.imageProcessingConfiguration;
  cfg.toneMappingEnabled = false;
  cfg.exposure = 1; cfg.contrast = 1;
  scene.markAllMaterialsAsDirty(2147483647);
  return { engine: scene.getEngine().getEngineType ? scene.getEngine().getEngineType() : 'n/a' };
})()`);
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/v171-AB-antes.png' });
console.log('ok /tmp/v171-AB-antes.png (pase APAGADO)');

// DESPUÉS: pase del catálogo (ACES 1.12/1.04)
await page.evaluate(`(() => {
  var c = (window).__vecinos && (window).__vecinos.controller;
  var scene = c && c.scene;
  if (!scene) throw new Error('sin escena');
  var cfg = scene.imageProcessingConfiguration;
  cfg.toneMappingEnabled = true;
  cfg.toneMappingType = (window).BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  cfg.exposure = 1.12; cfg.contrast = 1.04;
  scene.markAllMaterialsAsDirty(2147483647);
  return true;
})()`);
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/v171-AB-despues.png' });
console.log('ok /tmp/v171-AB-despues.png (ACES 1.12/1.04)');

const realErrors = errors.filter((e) => !e.toLowerCase().includes('favicon'));
console.log('errores consola:', realErrors.length, realErrors.slice(0, 3).join(' | '));
await browser.close();
