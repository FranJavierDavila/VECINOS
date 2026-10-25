/**
 * Generador v1.19 — el tramo ESPECIAL de la escalera (planta de arriba):
 *   - public/assets/blocks/escaleras_cota.gltf — el cubo superior del hueco de escalera:
 *     forjado de entrada + muros + hueco/marco + rótulo, SIN tramos que suban a ninguna
 *     parte (allí arriba ya no hay planta: los tramos de bajada viven en el cubo inferior).
 *
 * Ejecutar: bun scripts/gen-v119-assets.ts
 * La geometría sale del CONTRATO de rules.view.stairs y los calados de rules.view
 * (mismos nominales que assets.json: 4.68 × 2.46 × commonDepth).
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Gltf } from './lib/gltf';

function buildEscaleraCota(): Record<string, unknown> {
  const rules = JSON.parse(readFileSync(resolve(process.cwd(), 'public/content/rules.json'), 'utf8')) as {
    view: { cellW: number; cellH: number; gapW: number; gapH: number; slab: number; wall: number; commonDepth: number; stairs: { spanW: number; doorLocalX: number; entryHalf: number } };
  };
  const v = rules.view;
  const st = v.stairs;
  const CD = v.commonDepth;
  const W = st.spanW * v.cellW - v.gapW; // 4.68
  const H = v.cellH - v.gapH; // 2.46
  const halfD = CD / 2;
  const doorX = st.doorLocalX; // -1.14 (centro de la celda lógica)
  const entryTop = v.slab * 2;

  const g = new Gltf();
  // NODO 0 = Root (convención del generador: sin mesh, evita herencias de escala).
  g.addNode({ name: 'Root', children: [] });
  const mBody = g.addMaterial('hormigon', '#b8c0a8', { roughness: 0.95 });
  const mDark = g.addMaterial('hueco', '#2f353b');
  const mWall = g.addMaterial('muro', '#efe9dc');
  const mLamp = g.addMaterial('lamp_cota', '#fff6de', { emissive: '#ffedbe' });
  const mSign = g.addMaterial('rotulo', '#f2e8cf');
  const mStrip = g.addMaterial('luz', '#e9ecef');

  const box = (name: string, m: number, t: [number, number, number], s: [number, number, number]) =>
    g.addNode({ name, mesh: g.addBoxMesh(name, m), translation: t, scale: s });

  // Estructura del cubo superior: MISMA puerta y forjado que un bloque normal, pero sin
  // peldaños ni descansillo — el desembarco de esta planta ES el forjado de la puerta y el
  // vacío del pozo sigue hacia abajo (los tramos cuelgan del cubo inferior).
  box('forjado_entrada', mBody, [doorX, entryTop / 2, 0], [st.entryHalf * 2 + 0.04, entryTop, CD - 0.04]);
  box('muro_izq', mWall, [-W / 2 + v.wall / 2, H / 2, 0], [v.wall, H, CD]);
  box('muro_der', mWall, [W / 2 - v.wall / 2, H / 2, 0], [v.wall, H, CD]);
  box('muro_fondo', mWall, [0, H / 2, -halfD + v.wall / 2], [W, H, v.wall]);
  // Tira de luz interior junto a la entrada (arriba, donde el vecino aterriza).
  box('luz_interior', mLamp, [doorX, H - 0.35, -halfD + v.wall + 0.03], [1.4, 0.08, 0.04]);
  // Hueco oscuro tras la entrada + marco (jambas y dintel) en la cara abierta.
  box('hueco', mDark, [doorX, (entryTop + 1.98) / 2, halfD - 0.14], [st.entryHalf * 2 - 0.04, 1.98 - entryTop, 0.06]);
  box('jamba_izq', mDark, [doorX - st.entryHalf - 0.02, 0.99, halfD - 0.05], [0.08, 1.98, 0.1]);
  box('jamba_der', mDark, [doorX + st.entryHalf + 0.02, 0.99, halfD - 0.05], [0.08, 1.98, 0.1]);
  box('dintel', mDark, [doorX, 2.02, halfD - 0.05], [st.entryHalf * 2 + 0.16, 0.08, 0.1]);
  // Rótulo de bajada + tira de luz sobre la entrada.
  box('rotulo', mSign, [doorX, 2.2, halfD - 0.03], [0.9, 0.16, 0.05]);
  box('tira_luz', mStrip, [doorX, 2.34, halfD - 0.03], [1.2, 0.05, 0.05]);

  // Cierra el Root con TODOS los nodos (convención) y ESPEJO X (el loader glTF de Babylon
  // voltea X y Z: la Z ya se compensó autorando el frente en +z; la X se espeja aquí igual
  // que en escaleras_planta para que la puerta aterrice en el centro de la celda lógica).
  (g.nodes[0] as { children: number[] }).children = g.nodes.map((_, i) => i).slice(1);
  for (const n of g.nodes) {
    const node = n as { translation?: number[] };
    if (node.translation) node.translation[0] = -node.translation[0]!;
  }
  return g.finish('vecinos-gen-v119-assets (escaleras_cota v1 — cubo de bajada sin tramos fantasma)');
}

const outDir = resolve(process.cwd(), 'public/assets');
for (const [path, data] of [['blocks/escaleras_cota.gltf', buildEscaleraCota()]] as const) {
  const file = resolve(outDir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  console.log(`✓ ${file}`);
}
console.log('Assets v1.19 generados.');
