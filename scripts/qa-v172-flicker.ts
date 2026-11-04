/** QA v1.72 — DETECTOR DE FLICKEO POR PÍXELES (veredicto visual del z-fighting).
 *
 * El auditor geométrico (qa-coplanarity.ts) lista pares coplanares, pero NO puede saber
 * si dos caras son VISIBLES a la vez (muchas están enterradas en sólidos vecinos —
 * benignas por oclusión — o comparten material — píxeles idénticos al pelear). Este script
 * da el veredicto de la única autoridad que importa: los PÍXELES.
 *
 * Técnica: WebGL real (swiftshader, misma ventana probada en shots-v171-*), sim CONGELADO
 * (store.paused=true) y DOS capturas separadas 350 ms por cada cámara del juego
 * (edificio/fachada/planta). El z-fighting es el único fenómeno que altera píxeles de
 * GEOMETRÍA ESTÁTICA entre dos frames congelados: lo que cambie en el diff corto es
 * flickeo (motas en aristas) o animación de presentación (nubes — región grande y blanda,
 * se distingue a la vista en el PNG de recorte).
 *
 * Salida: por cámara, píxeles diferentes (umbral 12/255) y rejilla de celdas afectadas
 * con recorte PNG de las regiones para inspección en /tmp/flicker-<mode>.png.
 * La estadística fina corre en Python/PIL aparte (este script solo captura).
 */
import { chromium } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.73/chrome';
const URL = 'http://localhost:81/';
const MODES = ['edificio', 'fachada', 'planta'] as const;

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-extensions', '--disable-background-networking', '--js-flags=--max-old-space-size=768', '--renderer-process-limit=1'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, locale: 'es-ES' });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180_000 });

let booted = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(5000);
  try {
    booted = await page.evaluate(() => !!(window as unknown as { __vecinos?: unknown }).__vecinos);
    if (booted) break;
  } catch { /* boot */ }
}
if (!booted) {
  console.log('SIN __vecinos — detector abortado');
  await browser.close();
  process.exit(2);
}
// Cerrar diálogos (intro/bienvenida) para ver la escena limpia.
for (let i = 0; i < 14; i++) {
  const st = await page.evaluate(`(() => { var d=document.querySelector('[role="dialog"]'); if(!d) return 'none'; var b=d.querySelectorAll('button'); if(b.length) b[b.length-1].click(); return 'c'; })()`).catch(() => 'none');
  if (st === 'none') break;
  await page.waitForTimeout(800);
}
// Congelar sim + ocultar overlays que parpadean por diseño (toasts/banners/aviso).
await page.evaluate(`(() => {
  var st = (window).__vecinos.store.getState();
  st.setPaused(true);
  (window).__vecinos.store.setState({ paused: true, pauseMenuOpen: false, priorityBanner: null, toasts: [], infoAlerts: {} });
})()`);
await page.waitForTimeout(2500);

for (const mode of MODES) {
  await page.evaluate(`(() => { (window).__vecinos.store.getState().setCamMode('${mode}'); })()`);
  await page.waitForTimeout(3000); // la cámara vuela suave hasta el encuadre nuevo
  await page.screenshot({ path: `/tmp/flicker-${mode}-A.png` });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `/tmp/flicker-${mode}-B.png` });
  console.log(`ok /tmp/flicker-${mode}-{A,B}.png`);
}
await browser.close();
console.log('capturas listas — difundir con python3 (PIL)');
