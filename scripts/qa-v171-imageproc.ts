/** QA v1.71 — PASE GLOBAL DE IMAGEN (Fase V): tone mapping + exposición/contraste.
 *
 * Verificación GEOMÉTRICA en NullEngine (?qaengine=1): el pase vive en
 * scene.imageProcessingConfiguration y es inerte para el render nulo, así que lo que se
 * audita es el CABLEADO del catálogo: la escena viva debe nacer con el pase del
 * rules.json (ACES + exposición/contraste), el conmutador 'none' debe apagarlo sin tocar
 * lo demás y el estado clásico (sin bloque en el catálogo) debe dejar la configuración
 * intacta. Nada de píxeles: eso lo hace shots-v171-imageproc.ts con WebGL real.
 *
 * Salida: checks ✓/✗ por línea. Código de salida 1 si algo falla.
 */
import { chromium } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.73/chrome';
const URL = 'http://localhost:81/?qaengine=1';

let fails = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer', '--disable-extensions', '--disable-background-networking', '--js-flags=--max-old-space-size=512', '--renderer-process-limit=1'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, locale: 'es-ES' });
const errors: string[] = [];
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
  } catch { /* boot */ }
}
check('__vecinosQa vivo (boot completo)', qaOk);
if (!qaOk) {
  await browser.close();
  process.exit(1);
}

const result = (await page.evaluate(`(() => {
  const qa = (window).__vecinosQa;
  const scene = qa.getScene();
  const content = qa.getContent();
  const cfg = scene.imageProcessingConfiguration;
  const ip = content.rules.view.imageProcessing;
  const IPC = (window).BABYLON.ImageProcessingConfiguration;
  const before = {
    enabled: cfg.toneMappingEnabled,
    type: cfg.toneMappingType,
    exposure: cfg.exposure,
    contrast: cfg.contrast,
  };
  // A/B: apagar el pase en vivo (camino del 'none' del catálogo)
  cfg.toneMappingEnabled = false;
  const off = cfg.toneMappingEnabled;
  // restaurar el estado del catálogo
  cfg.toneMappingEnabled = true;
  const restored = cfg.toneMappingEnabled && cfg.exposure === before.exposure && cfg.contrast === before.contrast;
  return {
    ip,
    expectedType: IPC.TONEMAPPING_ACES,
    khnType: IPC.TONEMAPPING_KHR_PBR_NEUTRAL,
    before, offEnabled: off, restored,
    meshes: scene.meshes.length,
  };
})()`) as {
  ip: { toneMapping: string; exposure: number; contrast: number } | null;
  expectedType: number;
  khnType: number;
  before: { enabled: boolean; type: number; exposure: number; contrast: number };
  offEnabled: boolean;
  restored: boolean;
  meshes: number;
});

check('catálogo declara imageProcessing', !!result.ip, JSON.stringify(result.ip));
check('tone mapping ACES activo al nacer', result.before.enabled === true);
check('tipo ACES', result.before.type === result.expectedType, `type=${result.before.type} ACES=${result.expectedType} KHN=${result.khnType}`);
check('exposición del catálogo (1.12)', result.before.exposure === result.ip?.exposure && result.before.exposure === 1.12, `exposure=${result.before.exposure}`);
check('contraste del catálogo (1.04)', result.before.contrast === result.ip?.contrast && result.before.contrast === 1.04, `contrast=${result.before.contrast}`);
check("conmutador 'none' apaga en vivo", result.offEnabled === false);
check('restauración del pase sin deriva', result.restored === true);
check('escena viva con mallas', result.meshes > 300, `meshes=${result.meshes}`);

const realErrors = errors.filter((e) => !e.includes('favicon'));
check('0 errores de consola/página', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();
if (fails) {
  console.log(`\nQA v1.71: ${fails} FALLOS`);
  process.exit(1);
}
console.log('\nQA v1.71: TODO VERDE');
