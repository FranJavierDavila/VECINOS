/** PROBE T4-v4 — monkey-patch de applyRemoteState en el invitado: cuento llamadas,
 *  seqs vistas y seqs descartadas por el gate. Distingue «no llegan» de «llegan y se
 *  filtran» de «llegan y falla el apply».
 */
import { chromium, type Page } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.73/chrome';
const BASE = 'http://localhost:81/?qaengine=1';

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function boot(url: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-ES' });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 160)); });
  (page as Page & { __errs?: string[] }).__errs = errs;
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

// PATCH: vigilar QUIÉN expulsa — hook a los métodos del PlayerLogic que mueven al jugador.
await ev<void>(guest, `(() => {
  const logic = window.__vecinosQa.getLogic();
  const proto = Object.getPrototypeOf(logic);
  logic.__log = [];
  const hook = (name) => {
    const orig = proto[name];
    proto[name] = function (...args) {
      const stack = (new Error().stack || '').split('\\n').slice(2, 5).map(s => s.trim().replace(/^at /, '').replace(/ \\(.*\\)/, '')).join(' <- ');
      this.__log.push({ t: Math.round(performance.now() / 100) / 10, fn: name, args: JSON.stringify(args).slice(0, 80), stack: stack.slice(0, 220) });
      return orig.apply(this, args);
    };
  };
  ['forceLocation', 'tryExitHome', 'landInside', 'teleportTo', 'tryEnterDoor'].forEach(hook);
})()`);

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

for (let i = 0; i < 6; i++) {
  await guest.waitForTimeout(1000);
  const dump = await ev<{ pos: { mode: string; floor: number; x: number; z: number }; log: { t: number; fn: string; args: string; stack: string }[] }>(guest, `(() => {
    const l = window.__vecinosQa.getLogic();
    const p = l.position();
    return { pos: { mode: p.mode, floor: p.floor, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 }, log: (l.__log || []).splice(0) };
  })()`);
  console.log(`t=${i + 1}s  lógica=${dump.pos.mode}/p${dump.pos.floor} (${dump.pos.x},${dump.pos.z})  eventos nuevos: ${dump.log.length}`);
  for (const e of dump.log) console.log(`   · [${e.t}] ${e.fn}(${e.args})  ← ${e.stack}`);
}
const errs = (guest as Page & { __errs?: string[] }).__errs ?? [];
console.log('· errores JS guest:', errs.length === 0 ? '0' : errs.slice(0, 5).join(' || '));
await browser.close();
process.exit(0);
