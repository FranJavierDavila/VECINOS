/**
 * Sonda E-guest: el mismo flujo de escalera pero como INVITADO (2 páginas), con logging
 * fino: floor/x/mode/climbing/routePending + zone().id + espejo (mirror location).
 */
import { chromium } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.80/chrome';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function boot(url: string) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, locale: 'es-ES' });
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(4000);
    try { if (await page.evaluate(() => !!(window as any).__vecinosQa)) break; } catch { /* boot */ }
  }
  for (let i = 0; i < 12; i++) {
    const open = await page.evaluate(`(() => { var d = document.querySelector('[role="dialog"]'); if (!d) return false; var b = d.querySelectorAll('button'); if (b.length > 0) b[b.length - 1].click(); return true; })()`).catch(() => false);
    if (!open) break;
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(8000); // ventana de gracia anti-auto-reload
  return page;
}

const host = await boot('http://localhost:3000/?qaengine=1');
await host.evaluate(`window.__vecinosQa.getController().hostSession()`);
let code = '';
for (let i = 0; i < 20; i++) {
  await host.waitForTimeout(800);
  code = await host.evaluate<string>(`(() => { var b = document.querySelector('[title="Copiar código"]'); return b ? (b.textContent || '').trim() : ''; })()`).catch(() => '');
  if (code.length === 4) break;
}
console.log('· código:', code);
const guest = await boot('http://localhost:3000/?qaengine=1');
await guest.evaluate(`window.__vecinosQa.getController().joinSession('${code}')`);
await guest.waitForTimeout(5000);
const gid = await guest.evaluate(`window.__vecinosQa.getController().myResidentId`).catch(() => '');
console.log('· invitado:', gid);

const log = async (page: import('playwright-core').Page, tag: string): Promise<void> => {
  const s = await page.evaluate(`(() => {
    var L = window.__vecinosQa.getLogic();
    var w = window.__vecinosQa.getWorld();
    var p = L.position();
    var me = w.residents[${JSON.stringify(gid)}] || w.residents[w.playerId];
    return { f: +p.floor.toFixed(2), x: +p.x.toFixed(2), m: p.mode, cl: !!p.climbing, rp: L.routePending(), z: L.zone().id, mir: me ? me.location : null };
  })()`).catch((e) => ({ err: String(e).slice(0, 80) }));
  console.log(tag, JSON.stringify(s));
};

// Fase D abreviada: teleport a su vivienda y entrar (para salir luego, como el QA).
const ghome = await guest.evaluate(`window.__vecinosQa.getWorld().residents['${gid}'].home`).catch(() => 'blk_p1_a');
await guest.evaluate(`window.__vecinosQa.getLogic().teleportTo(${JSON.stringify(ghome)})`);
await guest.waitForTimeout(600);
await guest.evaluate(`window.__vecinosQa.getController().interact()`);
await guest.waitForTimeout(2500);
await log(guest, '·D-dentro');
await guest.evaluate(`window.__vecinosQa.getController().interact()`); // salir
await guest.waitForTimeout(600);

await guest.evaluate(`window.__vecinosQa.getLogic().teleportTo('blk_p2_escalera')`);
for (let i = 0; i < 10; i++) { await log(guest, '·post-tp ' + (i * 0.3).toFixed(1)); await guest.waitForTimeout(300); }
await guest.evaluate(`window.__vecinosQa.setTouch({ up: true })`);
for (let i = 0; i < 20; i++) { await log(guest, '·up ' + (i * 0.25).toFixed(2)); await guest.waitForTimeout(250); }
await guest.evaluate(`window.__vecinosQa.setTouch({})`);
await browser.close();
