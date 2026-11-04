import { chromium } from 'playwright-core';
const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.80/chrome';
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
await page.waitForTimeout(400);
const info = await page.evaluate(() => {
  const out: Record<string, unknown>[] = [];
  for (const sec of document.querySelectorAll('[data-acc]')) {
    const id = sec.getAttribute('data-acc');
    const body = sec.querySelector(':scope > .acc-body') as HTMLElement;
    const inner = body.firstElementChild as HTMLElement;
    out.push({
      id,
      open: body.getAttribute('data-open'),
      bodyH: +body.getBoundingClientRect().height.toFixed(1),
      innerH: +inner.getBoundingClientRect().height.toFixed(1),
      overflow: getComputedStyle(inner).overflow,
      minH: getComputedStyle(inner).minHeight,
      rows: getComputedStyle(body).gridTemplateRows,
    });
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
