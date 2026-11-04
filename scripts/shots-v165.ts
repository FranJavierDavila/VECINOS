/** Pasada visual v1.65 (qaengine=1, NullEngine): 4 capturas DOM de la nueva UI. */
import { chromium } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.80/chrome';
const URL = 'http://localhost:81/?qaengine=1';
const OUT = '/tmp/render-ui';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, locale: 'es-ES', deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });

for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(4000);
  try {
    if (await page.evaluate(() => !!(window as unknown as { __vecinosQa?: unknown }).__vecinosQa)) break;
  } catch { /* boot */ }
}
for (let i = 0; i < 14; i++) {
  const st = await page.evaluate(`(() => { var d = document.querySelector('[role="dialog"]'); if (!d) return 'none'; var b = d.querySelectorAll('button'); if (b.length) b[b.length - 1].click(); return 'c'; })()`).catch(() => 'none');
  if (st === 'none') break;
  await page.waitForTimeout(600);
  if (await page.evaluate(() => !!document.querySelector('[role="dialog"]')).catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(400);
  }
}
await page.evaluate(() => (window as unknown as { __vecinosQa?: { qaResume?: () => void } }).__vecinosQa?.qaResume?.());
await page.waitForTimeout(6000);

// 1 · HUD inicial
await page.screenshot({ path: `${OUT}/ui1-hud.png` });

// 2 · MENÚ con hoja Tiempo abierta
await page.click('button[aria-label^="Menú del juego"]');
await page.waitForTimeout(250);
await page.click('[data-acc="tiempo"] > button');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/ui2-menu.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(250);

// 3 · Panel Misiones + alerta en Edificio
await page.evaluate(() => {
  (window as unknown as { __vecinos: { store: { getState: () => { bumpInfoAlert: (t: string, n?: number) => void } } } }).__vecinos.store.getState().bumpInfoAlert('edificio', 1);
});
await page.click('button[aria-label="Misiones"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/ui3-panel-alerta.png` });

// 4 · Cámara espía activa con post-it abierto
await page.click('button[aria-label^="Modo de cámara"]');
await page.waitForTimeout(250);
await page.click('button[aria-label="Cámara: Espía"]');
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/ui4-espia.png` });

await browser.close();
console.log('capturas listas en', OUT);
