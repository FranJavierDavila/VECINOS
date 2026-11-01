/**
 * Sonda v1.67 — AUDITORÍA ANTI-COPLANARIDAD de los cuartos traseros de vivienda.
 * (Petición del vecino: «las ventanas de las estancias traseras están coplanares a las
 *  paredes y dan flickeo».) Arranca ?qaengine=1 (NullEngine) y mide, para cada vivienda
 * con salas traseras, las caras Z en coordenadas de MUNDO de:
 *   · muros del fondo partida alrededor del hueco  · marco (vmarco_*)  · cruceta
 *   · vidrio  · diorama (dio_pared / dio_suelo)  · frente y hoja de puerta.
 * Reporta pares de caras COINCIDENTES (Δ < 1 mm) → z-fighting garantizado.
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
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });

let qaOk = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(4000);
  try { qaOk = await page.evaluate(() => !!(window as unknown as { __vecinosQa?: unknown }).__vecinosQa); if (qaOk) break; } catch { /* boot */ }
}
if (!qaOk) { console.log('FALLO: sin __vecinosQa en 240 s'); await browser.close(); process.exit(1); }

for (let i = 0; i < 14; i++) {
  const open = await page.evaluate(`(() => { var d = document.querySelector('[role="dialog"]'); if (!d) return false; var b = d.querySelectorAll('button'); if (b.length > 0) b[b.length - 1].click(); return true; })()`).catch(() => false);
  if (!open) break;
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(500);
}
await page.evaluate(() => { (window as unknown as { __vecinosQa?: { qaResume?: () => void } }).__vecinosQa?.qaResume?.(); });
await page.waitForTimeout(6000);

const report = await page.evaluate(`(() => {
  var qa = window.__vecinosQa;
  var scene = qa.getScene();
  var world = qa.getWorld();
  var out = { blocks: [], note: '' };

  // AABB de mundo: 8 esquinas del bbox local × matriz de mundo.
  function aabb(m) {
    m.computeWorldMatrix(true);
    var bi = m.getBoundingInfo();
    bi.update(m.getWorldMatrix());
    var mn = bi.boundingBox.minimumWorld, mx = bi.boundingBox.maximumWorld;
    return { x0: mn.x, x1: mx.x, y0: mn.y, y1: mx.y, z0: mn.z, z1: mx.z };
  }

  var rearRoots = {};
  for (var i = 0; i < scene.meshes.length; i++) {
    var m = scene.meshes[i];
    if (m.name.indexOf('_rear_') < 0) continue;
    var root = m.name.split('_rear_')[0];
    (rearRoots[root] = rearRoots[root] || []).push(m);
  }
  var roots = Object.keys(rearRoots);
  out.note = 'bloques con salas traseras: ' + roots.length + ' → ' + roots.slice(0, 6).join(', ');

  roots.slice(0, 3).forEach(function (rootId) {
    var meshes = rearRoots[rootId];
    var blk = { id: rootId, rooms: {}, zPlanes: [] };
    // agrupar por sala (suffix tras '_rear_')
    var byRoom = {};
    meshes.forEach(function (m) {
      var sfx = m.name.split('_rear_')[1] || '';
      var room = sfx.split('_')[0];
      (byRoom[room] = byRoom[room] || []).push(m);
    });
    Object.keys(byRoom).forEach(function (room) {
      var r = { meshes: [], coplanar: [] };
      var items = byRoom[room].map(function (m) {
        var b = aabb(m);
        var kind = (m.name.split('_rear_')[1] || '').replace(room + '_', '');
        return { kind: kind, name: m.name, z0: b.z0, z1: b.z1, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, alpha: m.visibility };
      });
      r.meshes = items;
      blk.rooms[room] = r;
    });
    out.blocks.push(blk);
  });
  return out;
})()`);

// Análisis local: caras Z coincidentes entre piezas del mismo cuarto.
const EPS = 0.001; // 1 mm
let coplanarPairs = 0;
for (const blk of report.blocks) {
  console.log(`\n══ ${blk.id} ══`);
  for (const [room, r] of Object.entries(blk.rooms)) {
    console.log(`  · sala ${room} — ${r.meshes.length} mallas`);
    // Resumen de planos Z (sin duplicados) para leer la estratigrafía de un golpe.
    const zSet = new Map();
    for (const it of r.meshes) {
      for (const z of [it.z0, it.z1]) {
        const k = z.toFixed(4);
        if (!zSet.has(k)) zSet.set(k, []);
        zSet.get(k).push(it.kind);
      }
    }
    const planes = [...zSet.entries()].map(([z, ks]) => ({ z: parseFloat(z), kinds: [...new Set(ks)] })).sort((a, b) => a.z - b.z);
    console.log('    planos Z: ' + planes.map((p) => `${p.z.toFixed(4)}[${p.kinds.join(',')}]`).join('  '));
    // Pares coplanares: dos piezas que comparten cara Z (±1mm) y solapan en X e Y.
    for (let i = 0; i < r.meshes.length; i++) {
      for (let j = i + 1; j < r.meshes.length; j++) {
        const A = r.meshes[i], B = r.meshes[j];
        const faceA = [A.z0, A.z1], faceB = [B.z0, B.z1];
        for (const fa of faceA) for (const fb of faceB) {
          if (Math.abs(fa - fb) > EPS) continue;
          const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
          const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
          if (ox > 0.005 && oy > 0.005) {
            coplanarPairs++;
            console.log(`    ✗ COPLANAR: ${A.kind} (z=${fa.toFixed(4)}) × ${B.kind} (z=${fb.toFixed(4)}) solape ${ox.toFixed(3)}×${oy.toFixed(3)} m`);
          }
        }
      }
    }
  }
}
console.log(`\n────────────────────────────\n${report.note}`);
console.log(coplanarPairs === 0 ? '✓ Sin pares coplanares detectados' : `✗ ${coplanarPairs} pares de caras coplanares (z-fighting)`);
await browser.close();
process.exit(coplanarPairs === 0 ? 0 : 2);
