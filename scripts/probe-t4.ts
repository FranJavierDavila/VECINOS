/** PROBE T4 (higiene v1.69) — ¿QUIÉN expulsa al visitante 4 s tras entrar por timbre?
 *  Muestreo en vivo: lógica (mode/inside) vs ESPEJO del servidor (me.location) vs
 *  ruta legal en vuelo (routePending). Si el espejo se mueve, manda el servidor; si no,
 *  algo local empuja. Solo diagnóstico: no toca src/.
 */
import { chromium, type Page } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.73/chrome';
const BASE = 'http://localhost:81/?qaengine=1';

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function boot(url: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-ES' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${url.includes('join') ? 'inv' : 'host'}] PAGEERROR:`, String(e).slice(0, 200)));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  let ok = false;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(4000);
    try { ok = await page.evaluate(() => !!(window as { __vecinosQa?: unknown }).__vecinosQa); if (ok) break; } catch { /* boot */ }
  }
  if (!ok) throw new Error('sin __vecinosQa: ' + url);
  for (let i = 0; i < 12; i++) {
    const open = await page.evaluate(`(() => { var d = document.querySelector('[role="dialog"]'); if (!d) return false; var b = d.querySelectorAll('button'); if (b.length) b[b.length-1].click(); return true; })()`).catch(() => false);
    if (!open) break;
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(400);
  }
  return page;
}

const ev = async <T,>(page: Page, fn: string): Promise<T> => {
  let last: unknown;
  for (let i = 0; i < 6; i++) {
    try { return await page.evaluate(fn) as T; } catch (e) { last = e; await page.waitForTimeout(2000); }
  }
  throw last;
};

const host = await boot(BASE);
await ev<void>(host, `window.__vecinosQa.getController().hostSession()`);
let code = '';
for (let i = 0; i < 20; i++) {
  await host.waitForTimeout(1000);
  code = await host.evaluate(`(() => { var b = document.querySelector('[title="Copiar código"]'); return b ? (b.textContent || '').trim() : ''; })()`);
  if (code.length === 4) break;
}
console.log('· código:', code);

const guest = await boot(BASE + '&join=' + code);
await ev<void>(guest, `window.__vecinosQa.getController().joinSession('${code}')`);
for (let i = 0; i < 30; i++) {
  await guest.waitForTimeout(1500);
  const st = await ev<{ hasGuest: boolean }>(guest, `(() => ({ hasGuest: !!window.__vecinosQa.getWorld().residents['res_guest_1'] }))`).catch(() => null);
  if (st?.hasGuest) break;
}
console.log('· sesión lista');

// El invitado entra en casa del anfitrión por timbre (mismo guion que T4a).
const t4a = await ev<{ hostHome: string | null; mode: string; inside: string | null }>(guest, `(() => {
  const qa = window.__vecinosQa;
  const w = qa.getWorld();
  const hostHome = w.residents[w.playerId] ? w.residents[w.playerId].home : null;
  if (!hostHome) return { hostHome: null, mode: '?', inside: null };
  const logic = qa.getLogic();
  logic.teleportTo(hostHome);
  qa.getController().interact();
  const p = logic.position();
  return { hostHome, mode: p.mode, inside: p.insideBlock };
})()`);
console.log('· tras timbre:', JSON.stringify(t4a));

// Muestreo fino 6 s: ¿quién mueve — el espejo o la lógica local?
const pid = await ev<string>(guest, `window.__vecinosQa.getWorld().playerId`);
const pidHost = await ev<string>(host, `window.__vecinosQa.getWorld().playerId`);
for (let i = 0; i < 13; i++) {
  await guest.waitForTimeout(500);
  const g = await ev<{ mode: string; inside: string | null; mirrorLoc: string | null; pending: boolean; serverLoc: string | null }>(guest, `(() => {
    const qa = window.__vecinosQa;
    const w = qa.getWorld();
    const p = qa.getLogic().position();
    return { mode: p.mode, inside: p.insideBlock, mirrorLoc: w.residents['${pid}']?.location ?? null, pending: qa.getLogic().routePending(), serverLoc: w.residents['${pidHost}']?.location ?? null };
  })()`).catch((e) => ({ mode: 'ERR', inside: null, mirrorLoc: String(e).slice(0, 40), pending: false, serverLoc: null }));
  const hMirror = await ev<string | null>(host, `(() => window.__vecinosQa.getWorld().residents['${pid}']?.location ?? null)`).catch(() => null);
  console.log(`t=${((i + 1) * 0.5).toFixed(1)}s  lógica: ${g.mode}/${g.inside}  espejo-guest(guestTab): ${g.mirrorLoc}  pend:${g.pending}  espejo-guest(hostTab): ${hMirror}`);
}
await browser.close();
process.exit(0);
