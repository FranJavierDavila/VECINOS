import { chromium } from 'playwright-core';
const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.73/chrome';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, locale: 'es-ES' });
await page.goto('http://localhost:81/?qaengine=1', { waitUntil: 'domcontentloaded', timeout: 120_000 });
for (let i = 0; i < 60; i++) { await page.waitForTimeout(4000); try { if (await page.evaluate(() => !!(window as any).__vecinosQa)) break; } catch {} }
for (let i = 0; i < 14; i++) {
  const st = await page.evaluate(`(() => { var d = document.querySelector('[role="dialog"]'); if (!d) return 'none'; var b = d.querySelectorAll('button'); if (b.length) b[b.length-1].click(); return 'c'; })()`).catch(() => 'none');
  if (st === 'none') break;
  await page.waitForTimeout(500);
  if (await page.evaluate(() => !!document.querySelector('[role="dialog"]')).catch(() => false)) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
}
await page.click('button[aria-label^="Menú del juego"]');
await page.waitForTimeout(300);
const info = await page.evaluate(() => {
  const body = document.querySelector('[data-acc="opciones"] .acc-body') as HTMLElement | null;
  if (!body) return 'sin .acc-body';
  const cs = getComputedStyle(body);
  const inner = body.firstElementChild as HTMLElement | null;
  return {
    dataOpen: body.getAttribute('data-open'),
    display: cs.display,
    rows: cs.gridTemplateRows,
    bodyH: body.getBoundingClientRect().height,
    innerH: inner ? inner.getBoundingClientRect().height : null,
    innerOverflow: inner ? getComputedStyle(inner).overflow : null,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
