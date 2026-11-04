/** Capturas v1.66 — banner de máxima prioridad + badges gigantes (NullEngine ?qaengine=1). */
import { chromium } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.80/chrome';
const URL = 'http://localhost:81/?qaengine=1';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer', '--disable-extensions', '--disable-background-networking', '--js-flags=--max-old-space-size=512', '--renderer-process-limit=1'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, locale: 'es-ES' });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
let qaOk = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(4000);
  try {
    qaOk = await page.evaluate(() => !!(window as unknown as { __vecinosQa?: unknown }).__vecinosQa);
    if (qaOk) break;
  } catch { /* boot */ }
}
if (!qaOk) throw new Error('sin __vecinosQa');
for (let i = 0; i < 14; i++) {
  const st = await page.evaluate(`(() => { var d=document.querySelector('[role="dialog"]'); if(!d) return 'none'; var b=d.querySelectorAll('button'); if(b.length) b[b.length-1].click(); return 'c'; })()`).catch(() => 'none');
  if (st === 'none') break;
  await page.waitForTimeout(600);
}
await page.evaluate(() => (window as unknown as { __vecinosQa?: { qaResume?: () => void } }).__vecinosQa?.qaResume?.());
await page.waitForTimeout(4000);

// Banner de misión nueva + badges gigantes con anillo en la barra
await page.evaluate(() => {
  const st = (window as unknown as { __vecinos: { store: { getState: () => { pushPriorityBanner: (i: unknown) => void; bumpInfoAlert: (t: string, n?: number) => void } } } }).__vecinos.store.getState();
  st.pushPriorityBanner({ kind: 'mission_new', title: 'NUEVA MISIÓN', text: 'Arregla la Caldera de la azotea (bloque C)', tab: 'misiones' });
  st.bumpInfoAlert('misiones', 2);
  st.bumpInfoAlert('logros', 1);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/shot-v166-banner.png' });
console.log('ok /tmp/shot-v166-banner.png');
await browser.close();
