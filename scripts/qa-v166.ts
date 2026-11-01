/**
 * QA v1.66 — MISIONES Y LOGROS DE MÁXIMA PRIORIDAD (petición del vecino: «las marcas de
 * misiones y logros mucho más evidentes… deben ser algo de máxima prioridad»).
 *
 * A. BANNER gigante sobre el escenario: cola FIFO del store (priorityQueue), un aviso cada
 *    bannerShowMs del catálogo; papel/emoji por clase; «Abrir» lleva a su pestaña del
 *    cuaderno y limpia su alerta; ✕ descarta; auto-cierre sin clic.
 * B. Botones del cuaderno: badge post-it GIGANTE (37px, borde rojo, meneo + glow) y ANILLO
 *    rojo pulsante en el botón con novedades; abrir el apartado limpia badge y anillo.
 * C. Catálogo: rules.view.infoDock.bannerShowMs/bannerQueueMax llegan vivos al cliente.
 * D. Regresión: 0 errores JS y el juego vivo (ticks avanzando).
 */
import { chromium } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.73/chrome';
const URL = 'http://localhost:81/?qaengine=1';

let fails = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` · ${detail}` : ''}`);
  if (!cond) fails++;
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer', '--disable-extensions', '--disable-background-networking', '--js-flags=--max-old-space-size=512', '--renderer-process-limit=1'],
});
const errors: string[] = [];
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, locale: 'es-ES' });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text());
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });

let qaOk = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(4000);
  try {
    qaOk = await page.evaluate(() => !!(window as unknown as { __vecinosQa?: unknown }).__vecinosQa);
    if (qaOk) break;
  } catch { /* boot ocupado */ }
}
if (!qaOk) {
  console.log('FALLO: __vecinosQa no apareció en 240 s');
  await browser.close();
  process.exit(1);
}

// Cerrar diálogos que el arranque pueda abrir (bienvenida, etc.).
for (let i = 0; i < 14; i++) {
  const st = await page.evaluate(`(() => {
    var dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return 'none';
    var btns = dlg.querySelectorAll('button');
    if (btns.length > 0) btns[btns.length - 1].click();
    return 'clicked';
  })()`).catch(() => 'none');
  if (st === 'none') break;
  await page.waitForTimeout(700);
  const still = await page.evaluate(() => !!document.querySelector('[role="dialog"]')).catch(() => false);
  if (still) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(500);
  }
}
await page.evaluate(() => {
  (window as unknown as { __vecinosQa?: { qaResume?: () => void } }).__vecinosQa?.qaResume?.();
});
await page.waitForTimeout(6000);

type Store = {
  pushPriorityBanner: (i: { kind: string; title: string; text: string; tab: string }) => void;
  shiftPriorityBanner: () => void;
  bumpInfoAlert: (t: string, n?: number) => void;
  clearInfoAlert: (t: string) => void;
  infoAlerts: Record<string, number>;
  priorityQueue: { kind: string; title: string; text: string; tab: string }[];
  setInfoTab: (t: string | null) => void;
  infoTab: string | null;
};

const push = (item: { kind: string; title: string; text: string; tab: string }) =>
  page.evaluate((i) => {
    (window as unknown as { __vecinos: { store: { getState: () => { pushPriorityBanner: (x: typeof i) => void } } } }).__vecinos.store.getState().pushPriorityBanner(i);
  }, item);

// ══════════════ A. BANNER de máxima prioridad ══════════════
{
  // A1 — el banner aparece con la clase, el kind y el papel correctos
  await push({ kind: 'mission_new', title: 'NUEVA MISIÓN', text: 'Prueba A1 del banner', tab: 'misiones' });
  await page.waitForTimeout(400);
  const b = await page.evaluate(() => {
    const el = document.querySelector('[data-priority-banner="1"]') as HTMLElement | null;
    if (!el) return null;
    const role = el.closest('[role="alert"]');
    return {
      kind: el.getAttribute('data-priority-kind'),
      title: el.querySelector('p')?.textContent ?? '',
      text: el.textContent ?? '',
      hasAlert: !!role,
      visible: el.offsetWidth > 100 && el.offsetHeight > 40,
    };
  });
  check('A1 banner visible con role=alert', !!b && b.visible && b.hasAlert, JSON.stringify(b));
  check('A2 kind=mission_new y titular', b?.kind === 'mission_new' && (b?.title ?? '').includes('NUEVA MISIÓN'), `title=${b?.title}`);
  check('A3 detalle de la misión en el texto', (b?.text ?? '').includes('Prueba A1'));

  // A4 — «Abrir» lleva a Misiones y limpia su alerta de la barra
  await page.evaluate(() => {
    (window as unknown as { __vecinos: { store: { getState: () => { bumpInfoAlert: (t: string, n?: number) => void } } } }).__vecinos.store.getState().bumpInfoAlert('misiones', 2);
  });
  await page.waitForTimeout(200);
  // v1.66-QA: el papel tiene meneo infinito (prioridad = llamativo), así que el clic de
  // Playwright necesita force (la estabilidad estricta nunca llega — artefacto del test).
  await page.click('[data-priority-banner="1"] button:has-text("Abrir")', { force: true });
  await page.waitForTimeout(400);
  const afterOpen = await page.evaluate(() => {
    const st = (window as unknown as { __vecinos: { store: { getState: () => { infoTab: string | null; infoAlerts: Record<string, number>; priorityQueue: unknown[] } } } }).__vecinos.store.getState();
    return {
      tab: st.infoTab,
      alert: st.infoAlerts.misiones,
      queue: st.priorityQueue.length,
      overlay: !!document.querySelector('[data-info-overlay="misiones"]'),
      bannerGone: !document.querySelector('[data-priority-banner="1"]'),
    };
  });
  check('A4 Abrir abre la pestaña Misiones', afterOpen.tab === 'misiones' && afterOpen.overlay, JSON.stringify(afterOpen));
  check('A5 Abrir limpia la alerta de la barra', afterOpen.alert === 0);
  check('A6 el banner sale al consultarse', afterOpen.bannerGone && afterOpen.queue === 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // A7 — FIFO: dos avisos en cola, el primero en pantalla; ✕ pasa al segundo
  await push({ kind: 'mission_done', title: '¡MISIÓN CONSEGUIDA!', text: 'FIFO 1', tab: 'misiones' });
  await push({ kind: 'achievement', title: '¡LOGRO DESBLOQUEADO!', text: 'FIFO 2', tab: 'logros' });
  await page.waitForTimeout(400);
  const fifo1 = await page.evaluate(() => document.querySelector('[data-priority-banner="1"]')?.getAttribute('data-priority-kind'));
  check('A7 FIFO: primero mission_done', fifo1 === 'mission_done', `kind=${fifo1}`);
  await page.click('[data-priority-banner="1"] button[aria-label="Cerrar aviso"]', { force: true });
  await page.waitForTimeout(300);
  const fifo2 = await page.evaluate(() => document.querySelector('[data-priority-banner="1"]')?.getAttribute('data-priority-kind'));
  check('A8 ✕ pasa al segundo aviso (achievement)', fifo2 === 'achievement', `kind=${fifo2}`);
  await page.click('[data-priority-banner="1"] button[aria-label="Cerrar aviso"]', { force: true });
  await page.waitForTimeout(300);
  check('A9 cola vacía → sin banner', (await page.locator('[data-priority-banner="1"]').count()) === 0);

  // A10 — auto-cierre a bannerShowMs (6000 ms del catálogo) sin tocar nada
  await push({ kind: 'decision', title: '¡DECISIÓN PENDIENTE!', text: 'Autocierre', tab: 'misiones' });
  await page.waitForTimeout(500);
  const alive = await page.locator('[data-priority-banner="1"]').count();
  await page.waitForTimeout(6500);
  const gone = (await page.locator('[data-priority-banner="1"]').count()) === 0;
  check('A10 auto-cierre ~bannerShowMs', alive === 1 && gone);
}

// ══════════════ B. Badge gigante + anillo en los botones ══════════════
{
  await page.evaluate(() => {
    const st = (window as unknown as { __vecinos: { store: { getState: () => { bumpInfoAlert: (t: string, n?: number) => void } } } }).__vecinos.store.getState();
    st.bumpInfoAlert('misiones', 3);
    st.bumpInfoAlert('logros', 1);
    st.bumpInfoAlert('edificio', 1);
  });
  await page.waitForTimeout(400);
  const badges = await page.evaluate(() => {
    const pick = (tab: string) => {
      const btn = document.querySelector(`[data-info-tab-btn="${tab}"]`) as HTMLElement | null;
      const badge = btn?.querySelector('.postit-alert') as HTMLElement | null;
      return {
        text: badge?.textContent ?? null,
        w: badge ? Math.round(badge.getBoundingClientRect().width) : 0,
        ring: !!btn?.classList.contains('postit-alert-ring'),
      };
    };
    return { misiones: pick('misiones'), logros: pick('logros'), edificio: pick('edificio'), vecinos: pick('vecinos') };
  });
  check('B1 badge Misiones «3» GIGANTE (≥34px)', badges.misiones.text === '3' && badges.misiones.w >= 34, `w=${badges.misiones.w}`);
  check('B2 anillo pulsante en Misiones', badges.misiones.ring);
  check('B3 badge Logros «!» + anillo', badges.logros.text === '!' && badges.logros.ring);
  check('B4 badge Edificio + anillo', badges.edificio.text === '!' && badges.edificio.ring);
  check('B5 Vecinos SIN novedad: ni badge ni anillo', badges.vecinos.text === null && !badges.vecinos.ring);

  // B6 — abrir Misiones limpia badge y anillo (y la pestaña queda abierta: regresión v1.65)
  await page.click('[data-info-tab-btn="misiones"]');
  await page.waitForTimeout(400);
  const clean = await page.evaluate(() => {
    const btn = document.querySelector('[data-info-tab-btn="misiones"]') as HTMLElement | null;
    const st = (window as unknown as { __vecinos: { store: { getState: () => { infoAlerts: Record<string, number> } } } }).__vecinos.store.getState();
    return { badge: !!btn?.querySelector('.postit-alert'), ring: !!btn?.classList.contains('postit-alert-ring'), alert: st.infoAlerts.misiones };
  });
  check('B6 abrir Misiones limpia badge+anillo', !clean.badge && !clean.ring && clean.alert === 0, JSON.stringify(clean));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// ══════════════ C. Catálogo data-driven ══════════════
{
  const cat = await page.evaluate(() => {
    const c = (window as unknown as { __vecinosQa: { getContent: () => { rules: { view: { infoDock: { bannerShowMs: number; bannerQueueMax: number; overlayMaxHeightFactor: number; alerts: boolean } } } } } }).__vecinosQa.getContent();
    return c.rules.view.infoDock;
  });
  check('C1 rules.view.infoDock.bannerShowMs=6000 vivo', cat?.bannerShowMs === 6000, JSON.stringify(cat));
  check('C2 bannerQueueMax=6 vivo', cat?.bannerQueueMax === 6);
}

// ══════════════ D. Regresión ══════════════
{
  // El reloj del sim avanza con tickN (QoL de E2E para pestaña en segundo plano).
  const minute1 = await page.evaluate(() => (window as unknown as { __vecinosDebug: () => { clock: { minute: number } | null } }).__vecinosDebug().clock?.minute ?? -1);
  await page.evaluate(() => (window as unknown as { __vecinosDebug: () => { tickN: (n: number) => void } }).__vecinosDebug().tickN(3));
  const minute2 = await page.evaluate(() => (window as unknown as { __vecinosDebug: () => { clock: { minute: number } | null } }).__vecinosDebug().clock?.minute ?? -2);
  check('D1 el juego sigue vivo (el reloj avanza con tickN)', minute2 > minute1, `${minute1}→${minute2}`);

  const errs = errors.filter((e) => !e.includes('favicon') && !e.includes('the server responded with a status of 500') && !e.includes('Failed to load resource'));
  check('D2 0 errores JS', errs.length === 0, errs.slice(0, 3).join(' | '));
}

console.log(fails === 0 ? '\nTODO VERDE' : `\n${fails} FALLOS`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
