/**
 * QA v1.62 — «más cielo en el fondo» + «cuaderno del vecino» (2.ª pasada).
 * Todo el DOM se maneja DENTRO de page.evaluate (el repintado del cielo cada 6 s
 * inanicia el hilo principal y la maquinaria de accionabilidad de Playwright se
 * agota; un evaluate único entre frames pasa sin problema).
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.80/chrome';
const URL = 'http://localhost:3000/?qaengine=1';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: 'es-ES' });

const errors: string[] = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text());
});

console.log('· goto', URL);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });

let qaOk = false;
for (let i = 0; i < 48; i++) {
  await page.waitForTimeout(5000);
  try {
    qaOk = await page.evaluate(() => !!(window as any).__vecinosQa);
    if (qaOk) break;
  } catch {
    /* boot ocupado: seguimos */
  }
}
if (!qaOk) {
  console.log('FALLO: __vecinosQa no apareció en 240 s');
  await browser.close();
  process.exit(1);
}
console.log('· hook __vecinosQa presente');

// evaluate con reintentos (el repintado del cielo puede robar el hilo un rato)
const ev = async <T,>(fn: string, tries = 6): Promise<T> => {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await page.evaluate(fn) as T;
    } catch (e) {
      last = e;
      await page.waitForTimeout(3000);
    }
  }
  throw last;
};

// ── A. Catálogo cargado ──
const skips = await ev<number[]>(`(() => {
  const c = window.__vecinosQa.getContent();
  return c.rules.view.backdrop.layers.map(l => l.skipChance);
})()`);
console.log('A. skipChance por capa:', JSON.stringify(skips));
// v1.62-final — SIN valores hard-coded: se compara contra el catálogo real (rules.json);
// se exige 0<v<0.75 y creciente con la distancia (los altos del fondo, los que más cielo).
const catSkips = (
  JSON.parse(readFileSync('public/content/rules.json', 'utf8')) as {
    view: { backdrop: { layers: { skipChance: number }[] } };
  }
).view.backdrop.layers.map((l) => l.skipChance);
const aOk =
  JSON.stringify(skips) === JSON.stringify(catSkips) &&
  catSkips.every((v) => v > 0 && v < 0.75) &&
  catSkips[0]! < catSkips[1]! &&
  catSkips[1]! < catSkips[2]!;
console.log('   catálogo rules.json:', JSON.stringify(catSkips));

// ── B. Huecos de cielo por píxel ──
// Los sellos PNG (~2 MB) cargan en diferido y el primer pintado llega con el
// repintado del cielo (redrawSeconds=6): esperamos a img completa + 1 ciclo.
for (let i = 0; i < 12; i++) {
  const st = await ev<{ ready: boolean; painted: boolean }>(`(() => {
    const scene = window.__vecinosQa.getScene();
    let ready = true, painted = false;
    for (let li = 0; li < 3; li++) {
      const tex = scene.getTextureByName('fachada_' + li + '_tex');
      if (!tex) { ready = false; continue; }
      const ctx = tex.getContext();
      const sz = tex.getSize();
      for (const fx of [0.25, 0.5, 0.75]) {
        const d = ctx.getImageData(Math.round(sz.width * fx), sz.height - 10, 1, 1).data;
        if (d[3] > 40) { painted = true; break; }
      }
    }
    return { ready, painted };
  })()`, 2).catch(() => ({ ready: false, painted: false }));
  if (st.painted) break;
  await page.waitForTimeout(4000);
}
const layers = await ev<Array<null | { runs: number; gaps: number; w: number; usedH: number }>>(`(() => {
  const scene = window.__vecinosQa.getScene();
  const out = [];
  for (let li = 0; li < 3; li++) {
    const tex = scene.getTextureByName('fachada_' + li + '_tex');
    if (!tex) { out.push(null); continue; }
    const sz = tex.getSize();
    const W = sz.width, H = sz.height;
    const ctx = tex.getContext();
    const img = ctx.getImageData(0, 0, W, H);
    // una columna está "pintada" si tiene algún píxel opaco en la zona baja (base de edificios)
    const painted = new Uint8Array(W);
    for (let x = 0; x < W; x++) {
      for (let y = Math.max(0, H - 140); y < H; y += 2) {
        if (img.data[(y * W + x) * 4 + 3] > 40) { painted[x] = 1; break; }
      }
    }
    let runs = 0, gaps = 0, inRun = false;
    for (let x = 0; x < W; x++) {
      if (painted[x] && !inRun) { runs++; inRun = true; }
      else if (!painted[x] && inRun) { gaps++; inRun = false; }
    }
    out.push({ runs, gaps, w: W, usedH: Math.round((W * [24,32,42][li]) / 360) });
  }
  return out;
})()`);
console.log('B. bandas pintadas/huecos por capa (0=cerca, 2=lejos):', JSON.stringify(layers));
const totalGaps = layers.reduce((a, l) => a + (l?.gaps ?? 0), 0);
const bOk =
  layers.every((l) => l && l.runs > 0) &&
  totalGaps >= 5 &&
  (layers[2]?.gaps ?? 0) >= 2 &&
  (layers[1]?.gaps ?? 0) >= 1 &&
  (layers[0]?.gaps ?? 0) >= 1;
console.log('   totalGaps:', totalGaps);

// ── C. DOM del cuaderno ──
// v1.71 (higiene): el HUD v1.65 cambió el DOM — el dock es ahora un div[role=tablist] con
// etiqueta "Cuaderno del vecino" y el panel vive FUERA (InfoOverlay, [role=tabpanel] global).
// El post-it 'Ayuda' se retiró (dock.tab.help legacy fuera): hoy los 4 post-its del cuaderno
// son Misiones/Edificio/Vecinos/Logros (+ menú y cámara) y el panel nace PLEGADO al boot.
type Dom1 = {
  dock: boolean;
  tabs?: (string | null)[];
  panelOpen?: boolean;
  panelHead?: string;
  ayudaEnDock?: boolean;
  miCasaEnDock?: boolean;
  postitsNotebook?: number;
  versionChip?: string;
};
const dom1 = await ev<Dom1>(`(() => {
  const dock = document.querySelector('[role="tablist"][aria-label="Cuaderno del vecino"]');
  if (!dock) return { dock: false };
  const tabs = Array.from(dock.querySelectorAll('button[role="tab"]')).map(b => b.getAttribute('aria-label'));
  const panel = document.querySelector('[role="tabpanel"]');
  const postitLabels = Array.from(document.querySelectorAll('button.postit')).map(b => (b.getAttribute('aria-label') ?? ''));
  return {
    dock: true,
    tabs,
    panelOpen: !!panel,
    panelHead: (panel?.textContent ?? '').slice(0, 60),
    ayudaEnDock: tabs.includes('Ayuda'),
    miCasaEnDock: tabs.includes('Mi casa'),
    postitsNotebook: ['Misiones', 'Edificio', 'Vecinos', 'Logros'].filter((lb) => postitLabels.includes(lb)).length,
    versionChip: (Array.from(document.querySelectorAll('header span')).map(s => s.textContent).find(tx => tx && tx.startsWith('v1.'))) ?? ''
  };
})()`);
console.log('C1. cuaderno:', JSON.stringify(dom1));

const dockClick = (label: string) =>
  page.evaluate((lb) => {
    const dock = document.querySelector('[role="tablist"][aria-label="Cuaderno del vecino"]');
    const btn = Array.from(dock?.querySelectorAll('button[role="tab"]') ?? []).find(
      (b) => b.getAttribute('aria-label') === lb,
    );
    if (!btn) return false;
    (btn as HTMLButtonElement).click();
    return true;
  }, label);

await dockClick('Edificio');
await page.waitForTimeout(500);
const dom2 = await ev<{ panelOpen: boolean; notaCasa: boolean; conContenido: boolean }>(`(() => {
  const panel = document.querySelector('[role="tabpanel"]');
  const tx = panel?.textContent ?? '';
  return { panelOpen: !!panel, notaCasa: tx.includes('reforma') || tx.includes('🏠'), conContenido: tx.length > 40 };
})()`);
console.log('C2. Edificio abierto:', JSON.stringify(dom2));

await dockClick('Edificio');
await page.waitForTimeout(500);
const dom3 = await ev<{ panelOpen: boolean }>(`(() => {
  return { panelOpen: !!document.querySelector('[role="tabpanel"]') };
})()`);
console.log('C3. plegado tras 2.º clic:', JSON.stringify(dom3));

await dockClick('Logros');
await page.waitForTimeout(500);
const dom4 = await ev<{ panelOpen: boolean; head: string }>(`(() => {
  const panel = document.querySelector('[role="tabpanel"]');
  return { panelOpen: !!panel, head: (panel?.textContent ?? '').slice(0, 40) };
})()`);
console.log('C4. Logros:', JSON.stringify(dom4));

const cOk =
  dom1.dock &&
  dom1.tabs?.length === 4 &&
  !dom1.ayudaEnDock &&
  !dom1.miCasaEnDock &&
  dom1.postitsNotebook === 4 &&
  !dom1.panelOpen && // v1.65: el panel nace PLEGADO al boot (la prioridad del día lo abre si toca)
  dom2.panelOpen &&
  dom2.notaCasa &&
  dom2.conContenido &&
  !dom3.panelOpen &&
  dom4.panelOpen;

// ── D. Errores JS ──
const fatal = errors.filter((e) => !/radix|pointerdown|hydrat/i.test(e));
console.log('D. errores JS totales:', errors.length, '· fatales:', fatal.length);
fatal.slice(0, 5).forEach((e) => console.log('   ', e.slice(0, 200)));

const ok = aOk && bOk && cOk && fatal.length === 0;
console.log(ok ? 'QA v1.62: TODO OK' : 'QA v1.62: FALLO');
await browser.close();
process.exit(ok ? 0 : 1);
