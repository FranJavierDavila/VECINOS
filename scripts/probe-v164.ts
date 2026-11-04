/**
 * Sonda mínima: una página, ejecuta el evaluate de la fase A del QA y reporta
 * pageerror/close/consola para ver QUÉ mata la página.
 */
import { chromium } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.80/chrome';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, locale: 'es-ES' });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE-' + m.type() + ':', m.text().slice(0, 200)); });
page.on('close', () => console.log('· PAGE CLOSED'));
page.on('crash', () => console.log('· PAGE CRASHED'));

await page.goto('http://localhost:81/?qaengine=1', { waitUntil: 'domcontentloaded', timeout: 120_000 });
let ok = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(4000);
  try { ok = await page.evaluate(() => !!(window as any).__vecinosQa); if (ok) break; } catch (e) { console.log('boot eval err:', String(e).slice(0, 120)); }
}
console.log('· __vecinosQa:', ok);
for (let i = 0; i < 12; i++) {
  const open = await page.evaluate(`(() => { var d = document.querySelector('[role="dialog"]'); if (!d) return false; var b = d.querySelectorAll('button'); if (b.length > 0) b[b.length - 1].click(); return true; })()`).catch(() => false);
  if (!open) break;
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(500);
}
console.log('· intro cerrada; ejecutando fase A…');
try {
  const target = await page.evaluate(`(() => {
    var w = window.__vecinosQa.getWorld();
    var me = w.playerId;
    for (var id in w.blocks) {
      var b = w.blocks[id];
      if (b.kind !== 'dwelling' || b.occupancy !== 'occupied' || !b.ownerId || b.ownerId === me) continue;
      var o = w.residents[b.ownerId];
      if (!o || !o.present) continue;
      return { id: id, owner: o.id, ownerInside: o.location === id };
    }
    return null;
  })()`);
  console.log('· fase A target:', JSON.stringify(target));
} catch (e) {
  console.log('· fase A FALLO:', String(e).slice(0, 200));
}
await page.waitForTimeout(2000);
console.log('· sigue viva:', !page.isClosed());
await browser.close();
