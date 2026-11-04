/** Capturas v1.71-noche — A/B del pase de imagen de NOCHE (keyframes de luces bajas).
 * Misma técnica que shots-v171-imageproc.ts: WebGL real (swiftshader), conmutador en vivo,
 * hora del sim forzada vía world.clock.minute (23:30 — noche cerrada de los keyframes).
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
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180_000 });

let booted = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(5000);
  try {
    booted = await page.evaluate(() => !!(window as unknown as { __vecinos?: unknown }).__vecinos);
    if (booted) break;
  } catch { /* boot */ }
}
if (!booted) {
  console.log('SIN __vecinos — capturas nocturnas abortadas');
  await browser.close();
  process.exit(2);
}
for (let i = 0; i < 14; i++) {
  const st = await page.evaluate(`(() => { var d=document.querySelector('[role="dialog"]'); if(!d) return 'none'; var b=d.querySelectorAll('button'); if(b.length) b[b.length-1].click(); return 'c'; })()`).catch(() => 'none');
  if (st === 'none') break;
  await page.waitForTimeout(800);
}
await page.waitForTimeout(4000);

// NOCHE + pase APAGADO
await page.evaluate(`(() => {
  var c = (window).__vecinos.controller;
  c.world.clock.minute = 23.5 * 60;
  var cfg = c.scene.imageProcessingConfiguration;
  cfg.toneMappingEnabled = false; cfg.exposure = 1; cfg.contrast = 1;
  scene_markAll(c.scene);
  function scene_markAll(s){ s.markAllMaterialsAsDirty(2147483647); }
})()`);
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/v171-noche-antes.png' });
console.log('ok /tmp/v171-noche-antes.png (noche, pase APAGADO)');

// NOCHE + pase ACES 1.12/1.04
await page.evaluate(`(() => {
  var c = (window).__vecinos.controller;
  c.world.clock.minute = 23.5 * 60;
  var cfg = c.scene.imageProcessingConfiguration;
  cfg.toneMappingEnabled = true;
  cfg.toneMappingType = (window).BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  cfg.exposure = 1.12; cfg.contrast = 1.04;
  c.scene.markAllMaterialsAsDirty(2147483647);
})()`);
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/v171-noche-despues.png' });
console.log('ok /tmp/v171-noche-despues.png (noche, ACES 1.12/1.04)');
await browser.close();
