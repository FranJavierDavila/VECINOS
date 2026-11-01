/**
 * QA v1.65 — HUD DE JUEGO LIMPIO: MENÚ acordeón + postit CÁMARA (1-5 con ESPÍA)
 * + cuaderno SOBRE el escenario (≤ media ventana, pase de hoja, alertas postit).
 *
 * A. MENÚ: los 5 mandos (Tiempo/Opciones/Partida/Ayuda/Jugadores) viven en UN post-it
 *    en acordeón (una hoja abierta, clic fuera cierra); «Abrir panel» abre el diálogo MP.
 * B. CÁMARA: post-it con el modo vigente + desplegable con las 5 cámaras y sus teclas;
 *    ESPÍA autoelige al vecino más cercano, la lista permite elegir uno, la tecla 5
 *    repetida cicla al siguiente; teclas 1-4 reordenadas (estancia→planta→edificio→fachada).
 * C. CUADERNO sobre el escenario: Misiones/Edificio/Vecinos/Logros abren un panel POR
 *    ENCIMA del stage con altura ≤ 50% del escenario + scroll propio + pase de hoja
 *    (En curso/Archivo, Parámetros/Registro/Proyecto, Conseguidos/Por lograr);
 *    clic fuera y Escape lo cierran; re-pulsar la pestaña activa también.
 * D. ALERTAS postit: bumpInfoAlert pinta la nota wiggle sobre el botón (n o «!») y
 *    abrir el apartado la limpia.
 * E. Regresión: 0 errores JS, el juego sigue vivo (ticks, cámara, mando táctil intacto).
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
// v1.65-fix: el Escape SOLO se pulsa si el diálogo SIGUE abierto tras el clic del último
// botón — un Escape «huérfano» (el clic ya cerró el diálogo) abre el menú de pausa del
// juego y contaminaba las secciones siguientes (capturado en la 2.ª corrida).
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
// Estado limpio GARANTIZADO antes de medir: descongela el mundo y cierra cualquier
// modal/pausa que hubiera quedado viva (qaHold inverso; solo existe en ?qaengine=1).
await page.evaluate(() => {
  (window as unknown as { __vecinosQa?: { qaResume?: () => void } }).__vecinosQa?.qaResume?.();
});
await page.waitForTimeout(9000);

const dbg = () =>
  page.evaluate(() => {
    const d = (window as unknown as { __vecinosDebug: () => { camMode: string; spy: { id: string | null; target: { x: number; y: number; z: number } | null } } }).__vecinosDebug();
    return { camMode: d.camMode, spyId: d.spy.id, spyTarget: d.spy.target };
  });

const pressCamKey = (code: string) =>
  page.evaluate((c) => (window as unknown as { __vecinosQa: { getController: () => { onKeyDown: (c: string) => void } } }).__vecinosQa.getController().onKeyDown(c), code);

/** Cierra CUALQUIER diálogo remanente con Escape (defensa: que un fallo no cascada). */
const closeAllDialogs = async () => {
  for (let i = 0; i < 5; i++) {
    const open = await page.locator('[role="dialog"]').count();
    if (open === 0) return;
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(500);
  }
};

// ══════════════ A. MENÚ en acordeón ══════════════
{
  const menuBtn = page.locator('button[aria-label^="Menú del juego"]');
  check('A1 el post-it MENÚ existe en la barra', (await menuBtn.count()) === 1);

  await menuBtn.click();
  await page.waitForTimeout(300);
  const panelOpen = await page.locator('div[data-postit-panel]').count();
  check('A2 MENÚ despliega su panel', panelOpen === 1);

  // Acordeón: Tiempo abre su hoja (botón de pausa visible)
  const t0 = await page.getAttribute('[data-acc="tiempo"] > button', 'aria-expanded');
  check('A3 acordeón arranca todo plegado', t0 === 'false');
  await page.click('[data-acc="tiempo"] > button');
  await page.waitForTimeout(350);
  const t1 = await page.getAttribute('[data-acc="tiempo"] > button', 'aria-expanded');
  check('A4 hoja Tiempo se abre', t1 === 'true');
  const pauseVisible = await page.locator('[data-acc="tiempo"] .acc-body button').first().isVisible();
  check('A5 contenido de Tiempo visible (pausa/velocidades)', pauseVisible);

  // Otra hoja abre y la anterior SE PLIEGA (acordeón de una hoja)
  await page.click('[data-acc="opciones"] > button');
  await page.waitForTimeout(350);
  const t2 = await page.getAttribute('[data-acc="tiempo"] > button', 'aria-expanded');
  const o1 = await page.getAttribute('[data-acc="opciones"] > button', 'aria-expanded');
  check('A6 abrir Opciones pliega Tiempo', t2 === 'false' && o1 === 'true');
  const optContent = await page.locator('[data-acc="opciones"] .acc-body button').count();
  check('A7 contenido de Opciones presente', optContent > 3, `${optContent} botones`);

  // Multijugador desde el MENÚ: abrir panel → diálogo → Escape (solo cierra lo suyo)
  await page.click('[data-acc="jugadores"] > button');
  await page.waitForTimeout(250);
  await page.click('[data-acc="jugadores"] .acc-body button');
  await page.waitForTimeout(700);
  const dlg = await page.locator('[role="dialog"]').count();
  check('A8 «Abrir panel» abre el diálogo multijugador', dlg >= 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const dlgAfter = await page.locator('[role="dialog"]').count();
  check('A9 Escape cierra el diálogo SIN abrir el menú de pausa', dlgAfter === 0);
  await closeAllDialogs();

  // Clic fuera cierra el MENÚ
  await menuBtn.click();
  await page.waitForTimeout(250);
  const canvas = await page.locator('canvas').first().boundingBox();
  if (canvas) await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.waitForTimeout(300);
  const menuExpanded = await menuBtn.getAttribute('aria-expanded');
  check('A10 clic fuera del MENÚ lo cierra', menuExpanded === 'false');
}

// ══════════════ B. Post-it CÁMARA + ESPÍA ══════════════
{
  const camBtn = page.locator('button[aria-label^="Modo de cámara"]');
  check('B1 el post-it Cámara existe', (await camBtn.count()) === 1);
  const tip = await camBtn.getAttribute('title');
  check('B2 tooltip con las teclas 1-5', !!tip && tip.includes('1') && tip.includes('5'), tip ?? '');
  const label0 = (await camBtn.getAttribute('aria-label')) ?? '';
  check('B3 muestra la cámara vigente (Edificio al empezar)', label0.includes('Edificio'), label0);

  await camBtn.click();
  await page.waitForTimeout(300);
  const five = await page.locator('div[data-postit-panel] button[aria-label^="Cámara:"]').count();
  check('B4 desplegable con las 5 cámaras', five === 5, `${five} botones`);

  // ESPÍA: autoelige al vecino más cercano
  await page.click('button[aria-label="Cámara: Espía"]');
  await page.waitForTimeout(600);
  const spyState = await dbg();
  check('B5 tecla 5 → modo espía con vecino autoelegido', spyState.camMode === 'espia' && !!spyState.spyId && spyState.spyId.startsWith('res_'), JSON.stringify(spyState));
  await page.waitForTimeout(400);
  const spyState2 = await dbg();
  check('B6 el objetivo del espía es una posición viva (nodeOf)', !!spyState2.spyTarget, JSON.stringify(spyState2.spyTarget));

  // Lista de vecinos: elegir uno CONCRETO distinto del espiado cambia el objetivo.
  // v1.65-fix: el autoelegido (el más cercano) puede ocupar cualquier posición de la
  // lista — nth(1) a veces ERA el mismo vecino y el caso fallaba sin haber bug. Ahora
  // se elige por id (data-spy-id) un vecino PRESENTE distinto del actual.
  const chips = await page.locator('div[data-postit-panel] [role="option"]').count();
  const otherSpy = await page.evaluate(() => {
    const st = (window as unknown as { __vecinos: { store: { getState: () => { spyTargetId: string | null; residentsUi: { id: string; present: boolean }[] } } } }).__vecinos.store.getState();
    const cand = st.residentsUi.find((r) => r.present && r.id !== st.spyTargetId);
    return cand?.id ?? null;
  });
  if (chips > 1 && otherSpy) {
    await page.locator(`div[data-postit-panel] [data-spy-id="${otherSpy}"]`).click();
    await page.waitForTimeout(400);
    const spy2 = await dbg();
    check('B7 elegir vecino de la lista cambia el espiado', chips >= 2 && !!spy2.spyId && spy2.spyId === otherSpy, `chips=${chips} · ${spyState.spyId} → ${spy2.spyId} (esperado ${otherSpy})`);
  } else {
    check('B7 lista de vecinos disponible', chips >= 1, `chips=${chips} · other=${otherSpy}`);
  }

  // Tecla 5 repetida: cicla al siguiente vecino
  const before = await dbg();
  await pressCamKey('Digit5');
  await page.waitForTimeout(400);
  const after = await dbg();
  check('B8 tecla 5 repetida cicla de vecino', before.spyId !== after.spyId && after.camMode === 'espia', `${before.spyId} → ${after.spyId}`);

  // Teclas reordenadas: 4 = fachada (SALE del espía y limpia el objetivo), 1/2/3 reordenadas
  await pressCamKey('Digit4');
  await page.waitForTimeout(250);
  const afterFour = await dbg();
  check('B9 tecla 4 = fachada y limpia al espiado', afterFour.camMode === 'fachada' && afterFour.spyId === null, JSON.stringify(afterFour));
  await pressCamKey('Digit1');
  await page.waitForTimeout(250);
  check('B10 tecla 1 = estancia', (await dbg()).camMode === 'estancia');
  await pressCamKey('Digit2');
  await page.waitForTimeout(250);
  check('B11 tecla 2 = planta', (await dbg()).camMode === 'planta');
  await pressCamKey('Digit3');
  await page.waitForTimeout(250);
  check('B12 tecla 3 = edificio', (await dbg()).camMode === 'edificio');

  // Clic fuera cierra el post-it de cámara
  const canvas = await page.locator('canvas').first().boundingBox();
  if (canvas) await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.waitForTimeout(250);
  check('B14 clic fuera cierra el post-it Cámara', (await camBtn.getAttribute('aria-expanded')) === 'false');
}

// ══════════════ C. Cuaderno SOBRE el escenario ══════════════
{
  const overlayCount = async () => await page.locator('[data-info-overlay]').count();
  check('C1 sin panel al empezar (pantalla de juego limpia)', (await overlayCount()) === 0);

  await page.click('button[aria-label="Misiones"]');
  await page.waitForTimeout(350);
  check('C2 Misiones despliega el panel sobre el escenario', (await page.locator('[data-info-overlay="misiones"]').count()) === 1);

  // Altura ≤ 52% del escenario (catálogo: 50%)
  const sizes = await page.evaluate(() => {
    const panel = document.querySelector('[data-info-overlay]') as HTMLElement | null;
    if (!panel) return null;
    const stage = panel.parentElement?.parentElement as HTMLElement | null;
    if (!stage) return null;
    return { panelH: panel.getBoundingClientRect().height, stageH: stage.getBoundingClientRect().height };
  });
  check('C3 el panel ocupa ≤ ~50% de la ventana de juego', !!sizes && sizes.panelH <= sizes!.stageH * 0.52 + 2, sizes ? `${Math.round(sizes.panelH)}px de ${Math.round(sizes.stageH)}px (${Math.round((sizes.panelH / sizes.stageH) * 100)}%)` : 'sin medidas');

  // Pase de hoja en Misiones: En curso → Archivo
  const hasCurso = await page.locator('[data-pager-page="curso"]').count();
  await page.click('[data-info-overlay] [role="tab"]:has-text("Archivo")');
  await page.waitForTimeout(350);
  const hasArchivo = await page.locator('[data-pager-page="archivo"]').count();
  check('C4 pase de hoja Misiones: En curso → Archivo', hasCurso === 1 && hasArchivo === 1);

  // Edificio: 3 hojas (Parámetros/Registro/Proyecto)
  await page.click('button[aria-label="Edificio"]');
  await page.waitForTimeout(350);
  const hasParams = await page.locator('[data-pager-page="params"]').count();
  await page.click('[data-info-overlay] [role="tab"]:has-text("Registro")');
  await page.waitForTimeout(300);
  const hasLog = await page.locator('[data-pager-page="log"]').count();
  await page.click('[data-info-overlay] [role="tab"]:has-text("Proyecto")');
  await page.waitForTimeout(300);
  const hasProject = await page.locator('[data-pager-page="proyecto"]').count();
  check('C5 Edificio: Parámetros/Registro/Proyecto con pase de hoja', hasParams === 1 && hasLog === 1 && hasProject === 1);

  // Vecinos: lista con scroll (sin hojas)
  await page.click('button[aria-label="Vecinos"]');
  await page.waitForTimeout(350);
  const vecArticle = await page.locator('[data-info-overlay="vecinos"] article').count();
  check('C6 Vecinos lista a los residentes', vecArticle >= 1, `${vecArticle} fichas`);

  // Re-pulsar la pestaña activa la pliega
  await page.click('button[aria-label="Vecinos"]');
  await page.waitForTimeout(250);
  check('C7 re-pulsar la pestaña activa pliega el panel', (await overlayCount()) === 0);

  // Escape cierra
  await page.click('button[aria-label="Logros"]');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check('C8 Escape cierra el panel', (await overlayCount()) === 0);

  // Clic fuera cierra (y Logros muestra sus hojas Conseguidos/Por lograr antes)
  await page.click('button[aria-label="Logros"]');
  await page.waitForTimeout(300);
  const ganados = await page.locator('[data-pager-page="ganados"]').count();
  const canvas = await page.locator('canvas').first().boundingBox();
  if (canvas) await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.waitForTimeout(250);
  check('C9 clic fuera cierra el panel de Logros', ganados === 1 && (await overlayCount()) === 0);
}

// ══════════════ D. Alertas postit ══════════════
{
  await page.evaluate(() => {
    const s = (window as unknown as { __vecinos: { store: { getState: () => { bumpInfoAlert: (t: string, n?: number) => void } } } }).__vecinos.store.getState();
    s.bumpInfoAlert('misiones', 2);
    s.bumpInfoAlert('edificio', 1);
  });
  await page.waitForTimeout(300);
  const alerts = await page.evaluate(() => {
    const mis = document.querySelector('[data-info-tab-btn="misiones"] .postit-alert');
    const ed = document.querySelector('[data-info-tab-btn="edificio"] .postit-alert');
    return { mis: mis?.textContent ?? null, ed: ed?.textContent ?? null };
  });
  check('D1 alerta postit en Misiones con recuento', alerts.mis === '2', `texto=${alerts.mis}`);
  check('D2 alerta postit en Edificio («!»)', alerts.ed === '!', `texto=${alerts.ed}`);

  // Abrir el apartado LIMPIA su alerta
  await page.click('button[aria-label="Misiones"]');
  await page.waitForTimeout(350);
  const afterOpen = await page.evaluate(() => {
    const st = (window as unknown as { __vecinos: { store: { getState: () => { infoAlerts: Record<string, number> } } } }).__vecinos.store.getState();
    return {
      misiones: st.infoAlerts.misiones,
      badge: !!document.querySelector('[data-info-tab-btn="misiones"] .postit-alert'),
      edificioBadge: !!document.querySelector('[data-info-tab-btn="edificio"] .postit-alert'),
    };
  });
  check('D3 abrir Misiones limpia su alerta (y solo la suya)', afterOpen.misiones === 0 && !afterOpen.badge && afterOpen.edificioBadge, JSON.stringify(afterOpen));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
}

// ══════════════ E. Regresión ══════════════
{
  const alive = await page.evaluate(() => {
    const d = (window as unknown as { __vecinosDebug: () => { clock: { day: number; minute: number } | null; paused: boolean } }).__vecinosDebug();
    return { day: d.clock?.day ?? 0, paused: d.paused };
  });
  check('E1 el mundo sigue vivo y sin pausar', alive.day >= 1 && !alive.paused, JSON.stringify(alive));
  await page.evaluate(() => (window as unknown as { __vecinosDebug: () => { tickN: (n: number) => string } }).__vecinosDebug().tickN(5));
  const errs = errors.filter((e) => !e.includes('favicon') && !e.includes('404'));
  check('E2 cero errores JS en la página', errs.length === 0, errs.slice(0, 3).join(' | '));
}

await browser.close();
console.log(fails === 0 ? '\nTODO VERDE — v1.65 HUD limpio verificado E2E' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
