/**
 * Sonda E: reproducir la fase de escalera del QA con logging fino cada 200 ms
 * (floor/x/mode/climbing/routePending/zone) para ver quién mueve la x y por qué
 * no arranca la escalada. Una sola página (anfitrión de sesión, para tener net activo).
 */
import { chromium } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.73/chrome';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, locale: 'es-ES' });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
await page.goto('http://localhost:3000/?qaengine=1', { waitUntil: 'domcontentloaded', timeout: 120_000 });
let ok = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(4000);
  try { ok = await page.evaluate(() => !!(window as any).__vecinosQa); if (ok) break; } catch { /* boot */ }
}
if (!ok) { console.log('sin hook'); process.exit(1); }
for (let i = 0; i < 12; i++) {
  const open = await page.evaluate(`(() => { var d = document.querySelector('[role="dialog"]'); if (!d) return false; var b = d.querySelectorAll('button'); if (b.length > 0) b[b.length - 1].click(); return true; })()`).catch(() => false);
  if (!open) break;
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(400);
}
console.log('· intro cerrada');
await page.evaluate(`window.__vecinosQa.getController().hostSession()`);
await page.waitForTimeout(3500);
console.log('· sesión creada (host)');

const log = async (tag: string): Promise<void> => {
  const s = await page.evaluate(`(() => {
    var L = window.__vecinosQa.getLogic();
    var p = L.position();
    return { f: p.floor, x: +p.x.toFixed(2), m: p.mode, cl: !!p.climbing, rp: L.routePending ? L.routePending() : null };
  })()`).catch(() => null);
  console.log(tag, JSON.stringify(s));
};

await page.evaluate(`window.__vecinosQa.getLogic().teleportTo('blk_p2_escalera')`);
for (let i = 0; i < 12; i++) { await log('·post-tp ' + (i * 0.3).toFixed(1) + 's'); await page.waitForTimeout(300); }
await page.evaluate(`window.__vecinosQa.setTouch({ up: true })`);
for (let i = 0; i < 25; i++) { await log('·up ' + (i * 0.25).toFixed(2) + 's'); await page.waitForTimeout(250); }
await page.evaluate(`window.__vecinosQa.setTouch({})`);
await browser.close();
