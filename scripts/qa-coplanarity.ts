/**
 * QA v1.67 — AUDITOR AUTOMÁTICO DE COPLANARIDAD (revisión profunda anti z-fighting).
 *
 * Petición del vecino: «revisión profunda para cazar bugs que se pudieran escapar» tras el
 * flickeo de las ventanas traseras (marcos coplanares al muro, v1.21). Este script recorre
 * TODAS las mallas de la escena viva (?qaengine=1) y caza la firma exacta del z-fighting:
 * dos caras alineadas a ejes que comparten PLANO (+normal del mismo sentido) y SOLAPAN en
 * huella (área > 2 cm²). Culling de falsos positivos:
 *   · Normales opuestas en el mismo plano → una cara siempre culled → sin pelea.
 *   · Actores móviles (res_/viandante_/trafico_/carry/bolsa/sombras) fuera.
 *   · Rotaciones no alineadas a ejes (billboards/rigs) fuera.
 *   · DOS pasadas separadas 700 ms: solo pares PERSISTENTES (lo que camina no repite).
 * La geometría se mide con AABB mundial de 8 esquinas (todas las cajas/quads del juego son
 * axis-aligned tras su rotación de múltiplos de 90°), así las mallas DESACTIVADAS (bloques
 * traseros en reposo) también auditan.
 *
 * Salida: pares agrupados por familia (nombre con ids plantados a *), área y hueco real.
 * 0 pares ⇒ nada coplanar en toda la escena.
 */
import { chromium } from 'playwright-core';

const CHROME = '/home/z/.agent-browser/browsers/chrome-156.0.8078.73/chrome';
const URL = 'http://localhost:81/?qaengine=1';

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
  } catch { /* boot ocupado */ }
}
if (!qaOk) {
  console.log('FALLO: __vecinosQa no apareció en 240 s');
  await browser.close();
  process.exit(1);
}
// Cerrar diálogos del arranque y congelar (los actores paran: menos ruido).
for (let i = 0; i < 14; i++) {
  const dlg = await page.evaluate(() => !!document.querySelector('[role="dialog"]')).catch(() => false);
  if (!dlg) break;
  await page.evaluate(() => {
    const btns = document.querySelectorAll('[role="dialog"] button');
    (btns[btns.length - 1] as HTMLElement | undefined)?.click();
  }).catch(() => undefined);
  await page.waitForTimeout(600);
}
await page.evaluate(() => {
  (window as unknown as { __vecinosQa?: { qaHold?: () => void } }).__vecinosQa?.qaHold?.();
});
await page.waitForTimeout(1200);

const audit = (): Promise<{ pairs: { a: string; b: string; axis: string; at: number; gap: number; area: number; enA: boolean; enB: boolean }[]; meshes: number; faces: number }> =>
  page.evaluate(() => {
    const scene = (window as unknown as { __vecinosQa: { getScene: () => { meshes: unknown[] } } }).__vecinosQa.getScene() as unknown as {
      meshes: Array<{
        name: string;
        geometry?: { getTotalVertices?: () => number } | null;
        getTotalVertices: () => number;
        rotation: { x: number; y: number; z: number };
        isEnabled: () => boolean;
        computeWorldMatrix: (f?: boolean) => { m: number[] };
        getBoundingInfo: () => { boundingBox: { minimum: { x: number; y: number; z: number }; maximum: { x: number; y: number; z: number } } };
      }>;
    };
    const EPS = 0.0015; // 1.5 mm: dos planos a menos de esto PELEAN en profundidad
    const MIN_AREA = 0.0002; // 2 cm² de solape mínimo (costuras de 1-2 mm no cuentan)
    const MAX_SPAN = 80; // skybox/mundo fuera
    const skip = /viandante_|trafico_|_carry_|_bolsa_|sombra|shadow|particula|spark|humo|skybox|sky_|proxy|collider|lensflare|glow|^Clone of |_merged|^asc_|asc_puerta|hinge|_hoja$|_cabina/i;
    type Item = { n: string; en: boolean; mn: number[]; mx: number[]; s: number[] };
    const items: Item[] = [];
    for (const m of scene.meshes) {
      if (!m.geometry || m.getTotalVertices() === 0) continue;
      if (skip.test(m.name)) continue;
      // v1.67 — capas ordenadas por alphaIndex SIN depth-write (nubes, cielo): apilarse en el
      // mismo plano es SU diseño (se mezclan, no pelean) → fuera del audit.
      const mm = m.material as { disableDepthWrite?: boolean } | null;
      if (mm && mm.disableDepthWrite === true) continue;
      // Alineación a ejes por la BASE DEL MUNDO (subsume rotación propia Y heredada de
      // padres — el atril gira con yaw y sus hijos “rectos” no lo son en mundo): cada fila
      // de la 3×3 debe ser paralela a un eje (un componente manda, los otros ~0).
      const wm = m.computeWorldMatrix(true).m;
      const axisRow = (k: number): boolean => {
        const a0 = Math.abs(wm[k]!);
        const a1 = Math.abs(wm[k + 1]!);
        const a2 = Math.abs(wm[k + 2]!);
        const mx = Math.max(a0, a1, a2);
        if (mx < 1e-6) return false;
        return a0 + a1 + a2 < mx * 1.05;
      };
      if (!axisRow(0) || !axisRow(4) || !axisRow(8)) continue;
      const bb = m.getBoundingInfo().boundingBox;
      const mn = [Infinity, Infinity, Infinity];
      const mx = [-Infinity, -Infinity, -Infinity];
      for (let cx = 0; cx < 2; cx++) {
        for (let cy = 0; cy < 2; cy++) {
          for (let cz = 0; cz < 2; cz++) {
            const lx = cx ? bb.maximum.x : bb.minimum.x;
            const ly = cy ? bb.maximum.y : bb.minimum.y;
            const lz = cz ? bb.maximum.z : bb.minimum.z;
            const wx = lx * wm[0]! + ly * wm[4]! + lz * wm[8]! + wm[12]!;
            const wy = lx * wm[1]! + ly * wm[5]! + lz * wm[9]! + wm[13]!;
            const wz = lx * wm[2]! + ly * wm[6]! + lz * wm[10]! + wm[14]!;
            mn[0] = Math.min(mn[0]!, wx); mx[0] = Math.max(mx[0]!, wx);
            mn[1] = Math.min(mn[1]!, wy); mx[1] = Math.max(mx[1]!, wy);
            mn[2] = Math.min(mn[2]!, wz); mx[2] = Math.max(mx[2]!, wz);
          }
        }
      }
      const s = [mx[0]! - mn[0]!, mx[1]! - mn[1]!, mx[2]! - mn[2]!];
      if (Math.max(s[0]!, s[1]!, s[2]!) > MAX_SPAN) continue;
      items.push({ n: m.name, en: m.isEnabled(), mn: mn as number[], mx: mx as number[], s });
    }

    // Caras: caja → 6 caras; eje fino (<0.1 mm) → PLANO (doble cara). Hash espacial por
    // (eje, plano cuantizado a 5 mm) para no caer en O(n²) con miles de mallas.
    type Face = { it: Item; a: number; at: number; dir: -1 | 0 | 1 };
    const buckets = new Map<string, Face[]>();
    let nFaces = 0;
    const push = (f: Face): void => {
      const k = `${f.a}:${Math.round(f.at / 0.005)}`;
      const arr = buckets.get(k) ?? [];
      arr.push(f);
      buckets.set(k, arr);
      nFaces++;
    };
    for (const it of items) {
      for (let a = 0; a < 3; a++) {
        if (it.s[a]! < 1e-4) {
          // PLANO perpendicular al eje: una sola cara, visible por ambos lados.
          if (it.s[(a + 1) % 3]! * it.s[(a + 2) % 3]! >= MIN_AREA) push({ it, a, at: it.mx[a]!, dir: 0 });
          continue;
        }
        const area = it.s[(a + 1) % 3]! * it.s[(a + 2) % 3]!;
        if (area < MIN_AREA) continue; // canto despreciable
        push({ it, a, at: it.mn[a]!, dir: -1 });
        push({ it, a, at: it.mx[a]!, dir: 1 });
      }
    }
    const out = new Map<string, { a: string; b: string; axis: string; at: number; gap: number; area: number; enA: boolean; enB: boolean }>();
    for (const [k, arr] of buckets) {
      const [aStr, qStr] = k.split(':');
      const a = Number(aStr);
      const q = Number(qStr);
      // Vecinos ±1 del cubo de 5 mm: cubre el EPS de 1.5 mm en la frontera.
      const near = [...(buckets.get(`${a}:${q - 1}`) ?? []), ...arr, ...(buckets.get(`${a}:${q + 1}`) ?? [])];
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
          const A = arr[i]!;
          const B = near[j]!;
          if (A.it === B.it) continue;
          if (Math.abs(A.at - B.at) > EPS) continue;
          if (A.dir !== 0 && B.dir !== 0 && A.dir !== B.dir) continue; // normales opuestas: culled
          const o1 = (a + 1) % 3;
          const o2 = (a + 2) % 3;
          const ow = Math.min(A.it.mx[o1]!, B.it.mx[o1]!) - Math.max(A.it.mn[o1]!, B.it.mn[o1]!);
          const od = Math.min(A.it.mx[o2]!, B.it.mx[o2]!) - Math.max(A.it.mn[o2]!, B.it.mn[o2]!);
          if (ow <= 0 || od <= 0) continue;
          const area = ow * od;
          if (area < MIN_AREA) continue;
          const [n1, n2] = A.it.n < B.it.n ? [A.it.n, B.it.n] : [B.it.n, A.it.n];
          const key = `${n1}|${n2}`;
          const prev = out.get(key);
          if (!prev || area > prev.area) {
            out.set(key, { a: n1, b: n2, axis: 'xyz'[a]!, at: +(((A.at + B.at) / 2)).toFixed(4), gap: +Math.abs(A.at - B.at).toFixed(5), area: +area.toFixed(4), enA: A.it.en, enB: B.it.en });
          }
        }
      }
    }
    return { pairs: [...out.values()], meshes: items.length, faces: nFaces };
  });

const run1 = await audit();
await page.waitForTimeout(700);
const run2 = await audit();

// Persistencia: solo pares presentes en ambas pasadas (los móviles no repiten plano).
const key = (p: { a: string; b: string }): string => `${p.a}|${p.b}`;
const set2 = new Set(run2.pairs.map(key));
const persistent = run1.pairs.filter((p) => set2.has(key(p)));

// Resumen por familia (ids dinámicos → *): blk_12_rear_dormitorio_vmarco_sup → *_vmarco_sup
const fam = (n: string): string =>
  n
    .replace(/^(res_|blk_|dw_|trafico_|viandante_)[^_]*_/, '*_')
    .replace(/\d+/g, '#')
    .replace(/_#[^_]*_/g, '_*_');
const byFam = new Map<string, number>();
for (const p of persistent) {
  const k = `${fam(p.a)} ⊥ ${fam(p.b)} [${p.axis}]`;
  byFam.set(k, (byFam.get(k) ?? 0) + 1);
}

console.log(`mallas auditadas: ${run1.meshes} · caras: ${run1.faces} · pares pas1: ${run1.pairs.length} · pas2: ${run2.pairs.length} · PERSISTENTES: ${persistent.length}`);
// Triage: activos↔activos (visibles ya) vs pares con alguna malla OFF (bloques traseros en
// reposo, decals apagados…): los primeros son los candidatos a flickeo REAL.
const bothOn = persistent.filter((p) => p.enA && p.enB);
const withOff = persistent.filter((p) => !(p.enA && p.enB));
console.log('');
console.log(`— ACTIVOS↔ACTIVOS: ${bothOn.length} —`);
const famOn = new Map<string, number>();
for (const p of bothOn) {
  const k = `${fam(p.a)} ⊥ ${fam(p.b)} [${p.axis}]`;
  famOn.set(k, (famOn.get(k) ?? 0) + 1);
}
for (const [k, n] of [...famOn.entries()].sort((x, y) => y[1] - x[1])) console.log(`${String(n).padStart(4)} × ${k}`);
console.log('');
for (const p of bothOn) {
  console.log(`  [${p.axis}] gap=${p.gap}m área=${p.area}m² ${p.a}  ↔  ${p.b} @${p.at}`);
}
console.log('');
console.log(`— con alguna malla OFF: ${withOff.length} (resumen por familia) —`);
const famOff = new Map<string, number>();
for (const p of withOff) {
  const k = `${fam(p.a)} ⊥ ${fam(p.b)} [${p.axis}]`;
  famOff.set(k, (famOff.get(k) ?? 0) + 1);
}
for (const [k, n] of [...famOff.entries()].sort((x, y) => y[1] - x[1]).slice(0, 40)) console.log(`${String(n).padStart(4)} × ${k}`);
// Verificación específica del fix de la ventana trasera: CERO pares vmarco/vidrio.
const win = persistent.filter((p) => /vmarco|vidrio/.test(p.a + p.b));
console.log('');
console.log(`VENTANAS TRASERAS (vmarco/vidrio) persistentes: ${win.length} ${win.length === 0 ? '✔ FIX OK' : '✗ REVISAR'}`);
for (const p of win.slice(0, 10)) console.log(`  [${p.axis}] gap=${p.gap} área=${p.area} ${p.a} ↔ ${p.b}`);
if (errors.length > 0) {
  console.log(`\nerrores JS durante la auditoría: ${errors.length}`);
  for (const e of errors.slice(0, 5)) console.log('  ' + e.slice(0, 200));
}
await browser.close();
process.exit(0);
