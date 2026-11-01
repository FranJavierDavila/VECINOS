/**
 * QA v1.63 — SOMBRA DE CONTACTO bajo los pies («una sombra de contacto simulada entre
 * el personaje y el suelo para que dé la sensación de que está realmente sobre el suelo»).
 *
 * Verifica, contra el dev server con ?qaengine=1 (NullEngine):
 *  A. Catálogo: rules.view.shadows.contact cargado por zod (valores = rules.json) y
 *     'contact_shadow' presente en shadows.excluded (los discos jamás entran en el
 *     generador de sombras del sol: su nombre contiene 'res_').
 *  B. Discos: hay un disco `contact_shadow_<id>` por personaje en escena, con el
 *     material compartido (textura radial), isPickable=false y receiveShadows=false.
 *  C. Anclaje: cada disco reposa cerca de un NIVEL DE FORJADO (no flota entre plantas).
 *  D. Seguimiento: en ~2,5 s al menos un disco acompaña a su vecino (Δ > 5 cm) y el
 *     número de discos es estable (sin fugas).
 *  E. Jugador: con el táctil se empuja al jugador — su disco lo sigue (Δ > 25 cm).
 *  F. Cero errores JS.
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.73/chrome';
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

// ── Cerrar el diálogo de bienvenida (Inmobiliaria): congela el input del jugador.
//  Puede tener varios pasos: se pulsa el ÚLTIMO botón de cada paso (cualquier etiqueta)
//  y, si algún paso se resiste, Escape (los diálogos Radix cierran con Esc).
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
const dialogsLeft = await page.evaluate(`document.querySelectorAll('[role="dialog"]').length`).catch(() => -1);
console.log(`· intro de la inmobiliaria cerrado (diálogos restantes: ${dialogsLeft})`);

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

let fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? '✓' : '✗ FALLO'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fail++;
};

// ── A. Catálogo ──
const cat = await ev<{ contact: Record<string, number | string | boolean>; excludedHas: boolean; cellH: number }>(`(() => {
  const c = window.__vecinosQa.getContent();
  const sh = c.rules.view.shadows;
  return {
    contact: sh.contact ?? null,
    excludedHas: (sh.excluded ?? []).includes('contact_shadow'),
    cellH: c.rules.view.cellH,
  };
})()`);
const catJson = JSON.parse(
  readFileSync('public/content/rules.json', 'utf8'),
) as { view: { shadows: { contact: Record<string, number | string | boolean>; excluded: string[] } } };
const want = catJson.view.shadows.contact;
const same =
  !!cat.contact &&
  Object.keys(want).length === Object.keys(cat.contact).length &&
  Object.entries(want).every(([k, v]) => String(cat.contact[k]) === String(v));
check('A1 catálogo contact = rules.json (zod)', same, JSON.stringify(cat.contact));
check('A2 excluded contiene contact_shadow', cat.excludedHas);

// ── B/C/D. Discos: presencia, material y anclaje ──
interface DiscInfo {
  id: string;
  x: number; y: number; z: number;
  enabled: boolean;
  vis: number;
  scale: number;
  hasQ: boolean;
  nUp: number;
  matOk: boolean;
  pickable: boolean;
  recv: boolean;
  frac: number;
}
const readDiscs = (): Promise<DiscInfo[]> => ev<DiscInfo[]>(`(() => {
  const scene = window.__vecinosQa.getScene();
  const cellH = window.__vecinosQa.getContent().rules.view.cellH;
  const out = [];
  for (const m of scene.meshes) {
    if (!m.name.startsWith('contact_shadow_')) continue;
    const off = 0.022;
    const rel = ((m.position.y - off) % cellH + cellH) % cellH;
    out.push({
      id: m.name.slice('contact_shadow_'.length),
      x: +m.position.x.toFixed(3), y: +m.position.y.toFixed(3), z: +m.position.z.toFixed(3),
      enabled: m.isEnabled(),
      vis: +m.visibility.toFixed(3),
      scale: +m.scaling.x.toFixed(3),
      hasQ: !!m.rotationQuaternion,
      // Orientación: la normal LOCAL del disco es +Z → en mundo es la fila 2 de la matriz
      // (Babylon filas: base X=m[0..2], Y=m[4..6], Z=m[8..10]). Horizontal ⇔ wm[9]≈+1.
      nUp: +(m.computeWorldMatrix(true).m[9]).toFixed(3),
      matOk: m.material && m.material.name === 'contact_shadow_mat' && m.material.diffuseTexture && m.material.diffuseTexture.name === 'contact_shadow_tex',
      pickable: m.isPickable === false,
      recv: m.receiveShadows === false,
      frac: +rel.toFixed(3),
    });
  }
  return out;
})()`);

let discs: DiscInfo[] = [];
for (let i = 0; i < 10; i++) {
  discs = await readDiscs();
  if (discs.length >= 2) break;
  await page.waitForTimeout(3000);
}
check('B1 hay discos de contacto (≥2)', discs.length >= 2, `${discs.length} discos`);
check('B2 material compartido + textura radial', discs.every((d) => d.matOk), discs.filter((d) => !d.matOk).map((d) => d.id).join(',') || 'todos ok');
check('B3 isPickable=false y receiveShadows=false', discs.every((d) => d.pickable && d.recv));
// Los discos de actores OCULTOS conservan la rotación de nacimiento (identidad):
// solo los habilitados tienen orientación real — el denominador es el de los visibles.
const enabledDiscs = discs.filter((d) => d.enabled);
const flat = enabledDiscs.filter((d) => d.nUp > 0.9);
check('B4 discos HORIZONTALES (normal ≈ +Y, ≥80% de los visibles)', enabledDiscs.length > 0 && flat.length / enabledDiscs.length >= 0.8,
  discs.map((d) => `${d.id.slice(0, 14)}:${d.enabled ? 'on' : 'off'}/nUp=${d.nUp}`).join(' · '));
const anchored = discs.filter((d) => d.frac <= 0.45 || d.frac >= cat.cellH - 0.1);
check('C1 discos pegados a un nivel de forjado (≥80%)', discs.length > 0 && anchored.length / discs.length >= 0.8,
  anchored.map((d) => `${d.id.slice(0, 14)}:y=${d.y}`).join(' · '));

// ── D. Seguimiento (vecinos deambulando): hasta 20 s esperando a que ALGUIEN se mueva
//  (la cadencia de deambulación del catálogo es lenta: 2,5 s fijos se quedaban cortos).
const before = new Map(discs.map((d) => [d.id, d]));
let after: DiscInfo[] = discs;
let maxDelta = 0;
let movedId = '';
for (let i = 0; i < 16 && maxDelta <= 0.05; i++) {
  await page.waitForTimeout(1250);
  after = await readDiscs();
  for (const d of after) {
    const b = before.get(d.id);
    if (!b || !d.enabled) continue;
    const delta = Math.hypot(d.x - b.x, d.z - b.z);
    if (delta > maxDelta) {
      maxDelta = delta;
      movedId = d.id;
    }
  }
}
check('D1 algún disco acompaña a su actor (Δ>5 cm)', maxDelta > 0.05, `Δ=${maxDelta.toFixed(3)} (${movedId})`);
check('D2 sin fugas de discos', Math.abs(after.length - discs.length) <= 1, `${discs.length} → ${after.length}`);

// ── E. El disco del JUGADOR lo sigue al andar ──
const playerId = await ev<string>(`(() => {
  const c = window.__vecinosQa.getController();
  try { return c.actorId(); } catch { return ''; }
})()`);
const pDisc = after.find((d) => d.id === playerId);
if (pDisc && playerId) {
  const startX = pDisc.x;
  await ev<void>(`window.__vecinosQa.setTouch({ left: true })`);
  await page.waitForTimeout(1400);
  await ev<void>(`window.__vecinosQa.setTouch({})`);
  await page.waitForTimeout(600);
  const discs2 = await readDiscs();
  const p2 = discs2.find((d) => d.id === playerId);
  const deltaP = p2 ? Math.abs(p2.x - startX) : 0;
  check('E1 el disco del jugador sigue al cuerpo al andar (Δx>25 cm)', deltaP > 0.25, `Δx=${deltaP.toFixed(3)}`);
  await ev<void>(`window.__vecinosQa.setTouch({ right: true })`);
  await page.waitForTimeout(700);
  await ev<void>(`window.__vecinosQa.setTouch({})`);
} else {
  check('E1 disco del jugador presente', false, `playerId='${playerId}' discos=${after.map((d) => d.id).join(',')}`);
}

// ── F. Errores JS ──
// Los «Failed to load resource» son de RED (p. ej. el autosave POST /api/save puede
// toparse con la recompilación del dev server y el juego reintenta solo): no son
// errores JS del juego. Pageerror y console.error de la app SÍ fallan el QA.
const realErrors = errors.filter((e) => !e.startsWith('console.error: Failed to load resource'));
const netErrors = errors.filter((e) => e.startsWith('console.error: Failed to load resource'));
check('F1 cero errores JS', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
if (netErrors.length > 0) console.log(`  ⚠ ${netErrors.length} recursos de red con error (dev-compile race, con reintento): ${netErrors[0]}`);

console.log(fail === 0 ? '\nQA v1.63 TODO VERDE' : `\nQA v1.63 con ${fail} fallos`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
