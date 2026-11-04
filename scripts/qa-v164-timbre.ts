/**
 * QA v1.64 — TIMBRE: «cuando llamamos a una puerta, hasta que no para de sonar el
 * timbre no podremos entrar» (informe del vecino). Reproduce el flujo COMPLETO en el
 * navegador real (?qaengine=1, controlador real) y mide:
 *   A. Vecino EN CASA: E → timbre → ¿el jugador entra? ¿cuándo? (t=0, 0.5 s, 2 s, 4 s)
 *      ¿le dejan los states siguientes del servidor/sim o le expulsan?
 *   B. Timbre EN CURSO: E repetida mientras «suena» (5 pulsaciones) — ¿re-suena? ¿bloquea?
 *   C. Vecino FUERA (presente pero en otra parte): E → aviso «no responde» y sin entrada.
 *   D. Estado del sim tras el timbre (knock_result, afinidad).
 *   E. Cero errores JS.
 */
import { chromium } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.80/chrome';
const URL = 'http://localhost:3000/?qaengine=1';

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'es-ES' });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

console.log('· goto', URL);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
let qaOk = false;
for (let i = 0; i < 48; i++) {
  await page.waitForTimeout(5000);
  try { qaOk = await page.evaluate(() => !!(window as any).__vecinosQa); if (qaOk) break; } catch { /* boot */ }
}
if (!qaOk) { console.log('FALLO: sin __vecinosQa en 240 s'); await browser.close(); process.exit(1); }
console.log('· __vecinosQa presente');

// Cerrar diálogo de bienvenida (congela el input).
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
  await page.waitForTimeout(700);
}
console.log('· diálogo inicial cerrado');

const ev = async <T,>(fn: string, tries = 6): Promise<T> => {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await page.evaluate(fn) as T; } catch (e) { last = e; await page.waitForTimeout(3000); }
  }
  throw last;
};
let fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? '✓' : '✗ FALLO'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fail++;
};

// ── A. Preparación: mundo, vivienda ajena ocupada con dueño EN CASA, y dueño FUERA ──
const info = await ev<Record<string, unknown>>(`(() => {
  const qa = window.__vecinosQa;
  const w = qa.getWorld();
  const c = qa.getContent();
  const me = w.playerId;
  const homes = Object.values(w.blocks).filter(b => b.kind === 'dwelling' && b.occupancy === 'occupied' && b.ownerId && b.ownerId !== me);
  const res = (id) => w.residents[id];
  // dueño en casa: presente y location == su vivienda
  const inHome = homes.find(b => { const o = res(b.ownerId); return o && o.present && o.location === b.id; }) || null;
  // dueño presente pero FUERA (location != vivienda): el timbre ABRE (v1.64: el knock lo trae)
  const awayHome = homes.find(b => { const o = res(b.ownerId); return o && o.present && o.location !== b.id; }) || null;
  // dueño AUSENTE del vecindario (present false): el timbre NO abre (nadie puede abrir)
  const absentHome = homes.find(b => { const o = res(b.ownerId); return o && !o.present; }) || null;
  return {
    me,
    tick: w.tick,
    scenario: w.scenarioId,
    inHome: inHome ? { id: inHome.id, owner: inHome.ownerId, floor: inHome.cell.floor, col: inHome.cell.col, access: inHome.access, ownerLoc: res(inHome.ownerId).location, ownerActivity: res(inHome.ownerId).activity } : null,
    awayHome: awayHome ? { id: awayHome.id, owner: awayHome.ownerId, floor: awayHome.cell.floor, access: awayHome.access, ownerLoc: res(awayHome.ownerId).location } : null,
    absentHome: absentHome ? { id: absentHome.id, owner: absentHome.ownerId, floor: absentHome.cell.floor, access: absentHome.access, ownerLoc: res(absentHome.ownerId).location } : null,
    totalHomes: homes.length,
  };
})()`);
console.log('· info:', JSON.stringify(info));
check('A1 hay vivienda ajena ocupada con dueño EN CASA', !!info.inHome, JSON.stringify(info.inHome));

if (info.inHome) {
  const blk = (info.inHome as { id: string }).id;
  // Teleport al pasillo delante de esa puerta y llamar con E (controlador real).
  const before = await ev<Record<string, unknown>>(`(() => {
    const qa = window.__vecinosQa;
    const logic = qa.getLogic();
    logic.teleportTo('${blk}');
    const p = logic.position();
    return { x: p.x, z: p.z, floor: p.floor, mode: p.mode, inside: p.insideBlock };
  })()`);
  console.log('· delante de la puerta:', JSON.stringify(before));
  check('A2 teleport coloca al jugador en pasillo', before.mode === 'corridor', JSON.stringify(before));

  // Llamada al timbre (E real del controlador).
  const ring = await ev<Record<string, unknown>>(`(() => {
    const qa = window.__vecinosQa;
    const ctrl = qa.getController();
    const logic = qa.getLogic();
    ctrl.interact(); // delante de la puerta ajena → timbre
    const p = logic.position();
    return { t: 'inmediato', mode: p.mode, inside: p.insideBlock, floor: p.floor };
  })()`);
  console.log('· tras E:', JSON.stringify(ring));
  check('A3 timbre con dueño en casa: entrada INMEDIATA (sin esperar al sonido)', ring.mode === 'inside' && ring.inside === blk, JSON.stringify(ring));

  // Muestras en el tiempo: ¿nos dejan dentro o algo nos expulsa mientras «suena»?
  await page.waitForTimeout(500);
  const t05 = await ev<Record<string, unknown>>(`(() => { const p = window.__vecinosQa.getLogic().position(); return { t: 0.5, mode: p.mode, inside: p.insideBlock }; })()`);
  await page.waitForTimeout(1500);
  const t2 = await ev<Record<string, unknown>>(`(() => { const p = window.__vecinosQa.getLogic().position(); return { t: 2, mode: p.mode, inside: p.insideBlock }; })()`);
  await page.waitForTimeout(2000);
  const t4 = await ev<Record<string, unknown>>(`(() => { const p = window.__vecinosQa.getLogic().position(); return { t: 4, mode: p.mode, inside: p.insideBlock }; })()`);
  console.log('· estancia:', JSON.stringify([t05, t2, t4]));
  check('A4 seguimos dentro a 0,5 s (el timbre suena aún ~2,7 s)', t05.mode === 'inside' && t05.inside === blk, JSON.stringify(t05));
  check('A5 seguimos dentro a 2 s (timbre aún activo ~0,7 s)', t2.mode === 'inside' && t2.inside === blk, JSON.stringify(t2));
  check('A6 seguimos dentro a 4 s (timbre YA PARADO: aquí «podemos entrar»)', t4.mode === 'inside' && t4.inside === blk, JSON.stringify(t4));

  // B. Salir y repetir con E SPAM (5 pulsaciones seguidas mientras «suena»).
  const spam = await ev<Record<string, unknown>>(`(async () => {
    const qa = window.__vecinosQa;
    const ctrl = qa.getController();
    const logic = qa.getLogic();
    // salir a pasillo (E dentro de vivienda = salir)
    logic.forceLocation(null); // al pasillo de la planta actual
    const p0 = logic.position();
    logic.teleportTo('${blk}');
    const samples = [];
    for (let i = 0; i < 5; i++) {
      ctrl.interact();
      const p = logic.position();
      samples.push({ i, mode: p.mode, inside: p.insideBlock });
      await new Promise(r => setTimeout(r, 120));
    }
    const pEnd = logic.position();
    return { p0, samples, end: { mode: pEnd.mode, inside: pEnd.insideBlock } };
  })()`);
  console.log('· spam E:', JSON.stringify(spam));
  const endInside = (spam.end as { mode: string; inside: string | null });
  check('B1 spam de E durante el timbre no rompe el estado', endInside.mode === 'inside' || endInside.mode === 'corridor', JSON.stringify(spam.end));
}

// ── C. Timbre según QUIÉN puede abrir (diseño v1.64) ──
//  · dueño AUSENTE del vecindario: nadie abre → NO se entra.
//  · dueño presente FUERA de casa: el knock lo trae caminando → SÍ se entra.
if (info.absentHome) {
  const blk2 = (info.absentHome as { id: string }).id;
  const away = await ev<Record<string, unknown>>(`(() => {
    const qa = window.__vecinosQa;
    const ctrl = qa.getController();
    const logic = qa.getLogic();
    logic.teleportTo('${blk2}');
    ctrl.interact();
    const p = logic.position();
    return { mode: p.mode, inside: p.insideBlock, floor: p.floor };
  })()`);
  console.log('· dueño ausente:', JSON.stringify(away));
  check('C1 dueño AUSENTE: timbre suena y NO se entra (nadie puede abrir)', away.mode !== 'inside' || away.inside !== blk2, JSON.stringify(away));
} else {
  console.log('· C1 sin dueño ausente en el vecindario: prueba omitida');
}
if (info.awayHome) {
  const blk3 = (info.awayHome as { id: string }).id;
  const brought = await ev<Record<string, unknown>>(`(() => {
    const qa = window.__vecinosQa;
    const ctrl = qa.getController();
    const logic = qa.getLogic();
    logic.teleportTo('${blk3}');
    ctrl.interact();
    const p = logic.position();
    return { mode: p.mode, inside: p.insideBlock, floor: p.floor };
  })()`);
  console.log('· dueño fuera pero presente:', JSON.stringify(brought));
  check('C2 dueño PRESENTE fuera: el timbre lo trae y se entra (diseño v1.64)', brought.mode === 'inside' && brought.inside === blk3, JSON.stringify(brought));
}

// ── D. Sim: knock registró afinidad y evento ──
if (info.inHome) {
  const sim = await ev<Record<string, unknown>>(`(() => {
    const w = window.__vecinosQa.getWorld();
    const me = w.residents[w.playerId];
    const owner = w.residents['${(info.inHome as { owner: string }).owner}'];
    const rel = (me.relations || []).find(r => r.with === owner.id);
    return { affinity: rel ? rel.affinity : null, ownerPresent: owner.present, ownerLoc: owner.location };
  })()`);
  console.log('· sim tras timbre:', JSON.stringify(sim));
  check('D1 el sim registró el toque (afinidad > 0)', typeof sim.affinity === 'number' && (sim.affinity as number) > 0, JSON.stringify(sim));
}

await page.waitForTimeout(800);
check('E1 cero errores JS', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\nRESULTADO: ${fail === 0 ? 'TODO VERDE' : fail + ' FALLOS'}`);
await browser.close();
process.exit(fail > 0 ? 1 : 0);
