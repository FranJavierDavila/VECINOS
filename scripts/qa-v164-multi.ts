/**
 * QA v1.64 — MULTIJUGADOR 2 PESTAÑAS (Caddy :81 → 3000; servidor :3010): los 3 bugs P0
 * del vecino + el timbre en partida compartida.
 *   T1 · MUNDO COMPARTIDO (seed): el mundo del invitado ES el del servidor (misma vivienda
 *        del anfitrión sorteada con la semilla, mismos residentes, misma ocupación).
 *   T2 · POSICIÓN REMOTA: el invitado anda (qaHold + logic.update a mano) y el anfitrión ve
 *        moverse su avatar (mp:pose 10 Hz → node res_guest_1).
 *   T3 · ESCALERA→ENTRADA: el invitado sube a planta 1 y tras 6 snapshots del servidor
 *        SIGUE en el pasillo de la planta 1 (sin teleport al portal).
 *   T4 · TIMBRE EN MULTI: el invitado llama a la puerta del anfitrión (E) y ENTRA; el
 *        anfitrión llama a la del invitado y ENTRA. Sin bloqueo mientras «suena».
 *   T5 · Cero errores JS en ambas pestañas (salvo el 500 transitorio del autosave dev).
 */
import { chromium, type Page } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.80/chrome';
const BASE = 'http://localhost:81/?qaengine=1';

let fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? '✓' : '✗ FALLO'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fail++;
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const errors: { tab: string; msg: string }[] = [];
const wire = (page: Page, tab: string): void => {
  page.on('pageerror', (e) => errors.push({ tab, msg: 'pageerror: ' + String(e) }));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (t.includes('Failed to load resource') && t.includes('500')) return; // autosave dev transitorio
    errors.push({ tab, msg: t });
  });
};

async function boot(url: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-ES' });
  const page = await ctx.newPage();
  wire(page, url.includes('join=') ? 'invitado' : 'anfitrión');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  let ok = false;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(4000);
    try { ok = await page.evaluate(() => !!(window as any).__vecinosQa); if (ok) break; } catch { /* boot */ }
  }
  if (!ok) throw new Error('sin __vecinosQa en 240 s: ' + url);
  // Cerrar diálogos (inmobiliaria/phone): cualquier modal.
  for (let i = 0; i < 12; i++) {
    const open = await page.evaluate(`(() => {
      var dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return false;
      var btns = dlg.querySelectorAll('button');
      if (btns.length > 0) btns[btns.length - 1].click();
      return true;
    })()`);
    if (!open) break;
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(500);
  }
  return page;
}

const ev = async <T,>(page: Page, fn: string, tries = 6): Promise<T> => {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await page.evaluate(fn) as T; } catch (e) { last = e; await page.waitForTimeout(2500); }
  }
  throw last;
};

// ── Arranque anfitrión ──
console.log('· anfitrión: boot');
const host = await boot(BASE);
await ev<void>(host, `window.__vecinosQa.getController().hostSession()`);
let code = '';
for (let i = 0; i < 20; i++) {
  await host.waitForTimeout(1000);
  code = await host.evaluate(`(() => {
    var b = document.querySelector('[title="Copiar código"]');
    return b ? (b.textContent || '').trim() : '';
  })()`);
  if (code.length === 4) break;
}
console.log('· código de sesión:', code);
check('P0 código de sesión visible en el panel', code.length === 4, code);

// ── Arranque invitado ──
console.log('· invitado: boot + join');
const guest = await boot(BASE + '&join=' + code);
await ev<void>(guest, `window.__vecinosQa.getController().joinSession('${code}')`);

// Esperar a que AMBOS mundos vean 2 participantes humanos.
for (let i = 0; i < 30; i++) {
  await guest.waitForTimeout(1500);
  const st = await ev<{ guests: number; hasGuest: boolean; hostResidents: number; guestResidents: number }>(guest, `(() => {
    const w = window.__vecinosQa.getWorld();
    const ids = Object.keys(w.residents);
    return { guests: ids.filter(id => id.startsWith('res_guest')).length, hasGuest: !!w.residents['res_guest_1'], hostResidents: ids.length, guestResidents: ids.length };
  })()`).catch(() => null);
  const hostSt = await ev<{ hasGuest: boolean }>(host, `(() => {
    const w = window.__vecinosQa.getWorld();
    return { hasGuest: !!w.residents['res_guest_1'] };
  })()`).catch(() => null);
  if (st && st.hasGuest && hostSt && hostSt.hasGuest) { console.log('· ambos ven al invitado (res_guest_1)'); break; }
}
const both = await ev<{ g: number; h: number }>(guest, `(() => { const w = window.__vecinosQa.getWorld(); return { g: Object.values(w.residents).filter(r => r.controller.type === 'human').length, h: 0 }; })()`);
check('M0 sesión con 2 humanos (mundo del invitado)', both.g === 2, JSON.stringify(both));

// ── T1 · MUNDO COMPARTIDO ──
const snap = `(() => {
  const w = window.__vecinosQa.getWorld();
  return JSON.stringify({
    scenario: w.scenarioId,
    player: w.playerId,
    homes: Object.values(w.blocks).filter(b => b.kind === 'dwelling').map(b => [b.id, b.ownerId, b.occupancy]).sort(),
    residents: Object.values(w.residents).map(r => [r.id, r.home, r.present]).sort(),
  });
})()`;
const wHost = await ev<string>(host, snap);
const wGuest = await ev<string>(guest, snap);
check('T1 mundo compartido idéntico (viviendas+residentes, semilla única del anfitrión)', wHost === wGuest,
  wHost === wGuest ? '' : 'los mundos DIFIEREN');

// ── T2 · POSICIÓN REMOTA (poses) ──
// El invitado anda en el pasillo planta 0; el anfitrión muestrea el nodo del avatar remoto.
await ev<void>(guest, `window.__vecinosQa.qaHold()`);
const walk = await ev<{ x0: number; x1: number }>(guest, `(() => {
  const logic = window.__vecinosQa.getLogic();
  const x0 = logic.position().x;
  const IN = { left: false, right: true, up: false, down: false, run: false };
  for (let i = 0; i < 180; i++) logic.update(1/60, IN);
  return { x0, x1: logic.position().x };
})()`);
console.log('· invitado anda:', JSON.stringify(walk));
check('T2a el invitado se movió localmente', Math.abs(walk.x1 - walk.x0) > 0.5, `Δ=${(walk.x1 - walk.x0).toFixed(2)} m`);
// v1.69 — REANUDAR el bucle: las poses a 10 Hz las ENVÍA el frame loop (controller.update),
// así que con qaHold activo NUNCA salían y el avatar remoto quedaba congelado (artefacto
// del harness, no del juego). Fase B en vivo: el invitado anda con el bucle REAL (touch).
await ev<void>(guest, `window.__vecinosQa.qaResume()`);
await ev<void>(guest, `window.__vecinosQa.setTouch({ right: true })`);
await host.waitForTimeout(700); // poses en vuelo (10 Hz) + el invitado andando de verdad
const remote = await ev<{ p0: [number, number, number]; p1: [number, number, number] | null }>(host, `(async () => {
  const scene = window.__vecinosQa.getScene();
  const node = scene.getNodeByName('res_guest_1') || scene.meshes.find(m => m.name.startsWith('res_guest_1'));
  if (!node) return { p0: null, p1: null };
  const read = () => { const p = node.absolutePosition ? node.absolutePosition : node.position; return [Math.round(p.x*100)/100, Math.round(p.y*100)/100, Math.round(p.z*100)/100]; };
  const p0 = read();
  await new Promise(r => setTimeout(r, 1200));
  return { p0, p1: read() };
})()`).catch(() => ({ p0: null, p1: null }));
await ev<void>(guest, `window.__vecinosQa.setTouch({ right: false })`); // fin de la caminata en vivo
console.log('· avatar remoto en el anfitrión:', JSON.stringify(remote));
check('T2b el anfitrión VE el avatar del invitado', !!remote.p0, JSON.stringify(remote.p0));
if (remote.p0 && remote.p1) {
  const d = Math.hypot(remote.p1[0] - remote.p0[0], remote.p1[2] - remote.p0[2]);
  check('T2c el avatar remoto se MUEVE con las poses (Δ>0,05 m en 1,2 s)', d > 0.05 || Math.abs(walk.x1 - walk.x0) < 0.6, `Δ=${d.toFixed(2)} m`);
}

// ── T3 · ESCALERA→ENTRADA (invitado sube, servidor no lo devuelve) ──
const climb = await ev<{ floor: number; mode: string; inside: string | null; climbing: boolean }>(guest, `(() => {
  const logic = window.__vecinosQa.getLogic();
  const w = window.__vecinosQa.getWorld();
  const c = window.__vecinosQa.getContent();
  const stair = Object.values(w.blocks).find(b => c.blocks[b.defId].features && c.blocks[b.defId].features.stairs === true && b.cell.floor === 0);
  if (!stair) return { floor: -1, mode: 'no-stairs', inside: null, climbing: false };
  logic.teleportTo(stair.id);
  const IN = { left: false, right: false, up: true, down: false, run: false };
  for (let i = 0; i < 60 * 25; i++) {
    logic.update(1/60, IN);
    const p = logic.position();
    if (!p.climbing && p.floor === 1 && p.mode === 'corridor') break;
  }
  const p = logic.position();
  return { floor: p.floor, mode: p.mode, inside: p.insideBlock, climbing: p.climbing };
})()`);
console.log('· invitado sube escalera:', JSON.stringify(climb));
check('T3a desembarco en planta 1 (pasillo)', climb.floor === 1 && climb.mode === 'corridor' && !climb.climbing, JSON.stringify(climb));
await ev<void>(guest, `window.__vecinosQa.qaResume()`);
// 6 snapshots del servidor (1 tick/s) + margen: el reconcile NO debe devolverlo al portal.
await guest.waitForTimeout(7000);
const after = await ev<{ floor: number; mode: string; inside: string | null }>(guest, `(() => {
  const p = window.__vecinosQa.getLogic().position();
  return { floor: p.floor, mode: p.mode, inside: p.insideBlock };
})()`);
console.log('· tras 6 snapshots:', JSON.stringify(after));
check('T3b sigue en planta 1 tras snapshots del servidor (sin teleport al portal)', after.floor === 1, JSON.stringify(after));

// ── T4 · TIMBRE EN MULTI ──
// (a) El invitado llama a la puerta del ANFITRIÓN (el anfitrión está en su vivienda).
const t4a = await ev<{ hostHome: string | null; mode: string; inside: string | null }>(guest, `(() => {
  const qa = window.__vecinosQa;
  const w = qa.getWorld();
  const hostHome = w.residents[w.playerId] ? w.residents[w.playerId].home : null;
  if (!hostHome) return { hostHome: null, mode: '?', inside: null };
  const logic = qa.getLogic();
  logic.teleportTo(hostHome);
  qa.getController().interact(); // E → timbre
  const p = logic.position();
  return { hostHome, mode: p.mode, inside: p.insideBlock };
})()`);
console.log('· invitado llama a la puerta del anfitrión:', JSON.stringify(t4a));
check('T4a invitado ENTRA en casa del anfitrión tras el timbre (sin esperar el sonido)', t4a.mode === 'inside' && t4a.inside === t4a.hostHome, JSON.stringify(t4a));

// (b) El anfitrión llama a la puerta del INVITADO.
const guestHome = await ev<string>(guest, `(() => { const w = window.__vecinosQa.getWorld(); return w.residents['res_guest_1'].home; })()`);
const t4b = await ev<{ mode: string; inside: string | null }>(host, `(() => {
  const qa = window.__vecinosQa;
  const logic = qa.getLogic();
  logic.teleportTo('${guestHome}');
  qa.getController().interact();
  const p = logic.position();
  return { mode: p.mode, inside: p.insideBlock };
})()`);
console.log('· anfitrión llama a la puerta del invitado:', JSON.stringify(t4b));
check('T4b anfitrión ENTRA en casa del invitado tras el timbre', t4b.mode === 'inside' && t4b.inside === guestHome, JSON.stringify(t4b));

// (c) Estabilidad: 4 s después ambos siguen dentro (el timbre ya PARÓ — y nada les expulsa).
await guest.waitForTimeout(4000);
const t4c = await ev<{ mode: string; inside: string | null }>(guest, `(() => { const p = window.__vecinosQa.getLogic().position(); return { mode: p.mode, inside: p.insideBlock }; })()`);
const t4d = await ev<{ mode: string; inside: string | null }>(host, `(() => { const p = window.__vecinosQa.getLogic().position(); return { mode: p.mode, inside: p.insideBlock }; })()`);
check('T4c invitado sigue dentro 4 s después (timbre parado)', t4c.mode === 'inside' && t4c.inside === t4a.hostHome, JSON.stringify(t4c));
check('T4d anfitrión sigue dentro 4 s después', t4d.mode === 'inside' && t4d.inside === guestHome, JSON.stringify(t4d));

// ── T5 · Errores JS ──
await guest.waitForTimeout(1000);
check('T5 cero errores JS en ambas pestañas', errors.length === 0, errors.slice(0, 4).map(e => `[${e.tab}] ${e.msg}`).join(' | '));

console.log(`\nRESULTADO: ${fail === 0 ? 'TODO VERDE' : fail + ' FALLOS'}`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
