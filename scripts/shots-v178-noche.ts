/** Capturas v1.78-noche — verificación visual de la «niebla nocturna»: solares nuevos
 * (skipChance 0.4/0.5/0.6), velo desaturado + lavado azulado y ambiente nocturno 0.56.
 * Hora del sim forzada a 23:30 (noche cerrada de los keyframes); cámara exterior por defecto.
 */
import { chromium } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.73/chrome';
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
// Cerrar diálogos de onboarding si asoman.
for (let i = 0; i < 14; i++) {
  const st = await page.evaluate(`(() => { var d=document.querySelector('[role="dialog"]'); if(!d) return 'none'; var b=d.querySelectorAll('button'); if(b.length) b[b.length-1].click(); return 'c'; })()`).catch(() => 'none');
  if (st === 'none') break;
  await page.waitForTimeout(800);
}
await page.waitForTimeout(4000);

// DÍA (14:00) + captura de contraste — el mediodía NO debe cambiar con la v1.78.
await page.evaluate(`(() => {
  var c = (window).__vecinos.controller;
  c.world.clock.minute = 14 * 60;
})()`);
await page.waitForTimeout(6000); // repintado de capas (cubo nightF 0.09)
await page.screenshot({ path: '/tmp/v178-dia-fachada.png' });
console.log('ok /tmp/v178-dia-fachada.png (14:00, vista por defecto)');

// NOCHE (23:30) + captura de la vista por defecto (fachada/exterior)
await page.evaluate(`(() => {
  var c = (window).__vecinos.controller;
  c.world.clock.minute = 23.5 * 60;
})()`);
await page.waitForTimeout(6000); // repintado de capas (cubo nightF 0.09) + farolas
await page.screenshot({ path: '/tmp/v178-noche-fachada.png' });
console.log('ok /tmp/v178-noche-fachada.png (23:30, vista por defecto)');

// Muestreo de píxeles: luminancia media del cielo (arriba) y de la banda de edificios (centro).
const stats = await page.evaluate(`(() => {
  var cv = document.querySelector('canvas');
  if (!cv) return null;
  var off = document.createElement('canvas');
  off.width = cv.width; off.height = cv.height;
  var ctx = off.getContext('2d');
  ctx.drawImage(cv, 0, 0);
  function lum(x0, y0, x1, y1) {
    var w = x1 - x0, h = y1 - y0;
    var d = ctx.getImageData(x0, y0, w, h).data;
    var acc = 0, n = 0;
    for (var i = 0; i < d.length; i += 40) { acc += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
    return Math.round(acc / n);
  }
  return {
    cielo: lum(0, 0, cv.width, Math.round(cv.height * 0.22)),
    banda: lum(0, Math.round(cv.height * 0.35), cv.width, Math.round(cv.height * 0.75)),
  };
})()`) as { cielo: number; banda: number } | null;
console.log('luminancia media 0-255 → cielo:', stats && stats.cielo, '| banda edificios:', stats && stats.banda);

await browser.close();
