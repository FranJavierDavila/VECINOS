/**
 * Generador de arte final — v1.16 (cierre del edificio: trasteros por planta, bajocubierta y tejado).
 *   trasteros_planta — nave ABIERTA: forjado, trasera, pilares y pretil (las estanterías, los
 *     trastos y los carteles numerados los levanta el runtime desde rules.view.trasteros:
 *     una sola verdad data-driven, el arte solo aporta el cascarón).
 *   bajocubierta — planta de instalaciones: caldera con tiraje, depósitos de agua, cuadro
 *     eléctrico, estantería de mantenimiento y latas de pintura.
 *   tejado — tejadillo a dos aguas (faldones + cumbrera + aguafaldos en los testeros,
 *     chimenea y antena). CONTRATO con rules.view.roof: mismos colores y misma geometría.
 *
 * Convención de bloques (motor scripts/lib/gltf.ts): base en y=0, centrado en x/z; el frente
 * hacia la calle se authora en +Z (el loader glTF lo aterriza en −Z de mundo, hacia el pasillo).
 *
 * Ejecutar: bun scripts/gen-v16-assets.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Gltf, quatAxis } from './lib/gltf';

/** Nominales CONTRATO con assets.json: trasteros/bajocubierta 9 celdas (21.48 = 9·2.4 − gap),
 *  tejado 11 celdas (26.28) con calado 3.5 = 2.8 + 2·overhang(0.35). */
const NOM_W9 = 21.48;
const NOM_W11 = 26.28;
const NOM_H = 2.46;
const NOM_D28 = 2.8;
const NOM_D_ROOF = 3.5;
const WALL = 0.1;
const SLAB = 0.07;
const ROOF = { pitchH: 1.2, color: '#a44a3f', ridge: '#7d3b32', fascia: '#6f4926' } as const;

/** Nave abierta de trasteros: cascarón estructural (el interior lo viste el runtime). */
function buildTrasterosPlanta(): Record<string, unknown> {
  const g = new Gltf();
  // Root SIEMPRE es el nodo 0 (finish() monta la escena sobre él); hijos al final.
  const root = g.addNode({ name: 'Root', children: [] });
  const nodes: number[] = [];
  const mSlab = g.addMaterial('forjado', '#9a938a', { roughness: 0.95 });
  const mWall = g.addMaterial('trasera', '#cbbfa8', { roughness: 0.9 });
  const mPillar = g.addMaterial('pilar', '#8a8378', { roughness: 0.9 });
  const mWood = g.addMaterial('vigas', '#6f4926');
  const meshSlab = g.addBoxMesh('forjado', mSlab);
  const meshWall = g.addBoxMesh('muro', mWall);
  const meshPillar = g.addBoxMesh('pilar', mPillar);
  const meshWood = g.addBoxMesh('viga', mWood);

  // Forjado (canto slab·2, top y=0.14) y pretil de seguridad en el borde frontal.
  nodes.push(g.addNode({ name: 'forjado', mesh: meshSlab, translation: [0, SLAB, 0], scale: [NOM_W9, SLAB * 2, NOM_D28] }));
  nodes.push(
    g.addNode({
      name: 'pretil',
      mesh: meshSlab,
      translation: [0, SLAB * 2 + 0.05, NOM_D28 / 2 - 0.06],
      scale: [NOM_W9, 0.1, 0.12],
    }),
  );
  // Trasera y pilares laterales (la nave queda ABIERTA al pasillo: sin fachada frontal).
  nodes.push(
    g.addNode({
      name: 'trasera',
      mesh: meshWall,
      translation: [0, SLAB * 2 + (NOM_H - SLAB * 2) / 2, -NOM_D28 / 2 + WALL / 2],
      scale: [NOM_W9, NOM_H - SLAB * 2, WALL],
    }),
  );
  for (const sx of [-1, 1]) {
    nodes.push(
      g.addNode({
        name: `pilar_${sx > 0 ? 'der' : 'izq'}`,
        mesh: meshPillar,
        translation: [(sx * (NOM_W9 - WALL)) / 2, SLAB * 2 + (NOM_H - SLAB * 2) / 2, 0],
        scale: [WALL, NOM_H - SLAB * 2, NOM_D28],
      }),
    );
    // Viga de coronación por pilar (remate superior de la nave abierta).
    nodes.push(
      g.addNode({
        name: `viga_${sx > 0 ? 'der' : 'izq'}`,
        mesh: meshWood,
        translation: [(sx * (NOM_W9 - 0.3)) / 2, NOM_H - 0.11, NOM_D28 / 2 - 0.15],
        scale: [0.3, 0.22, 0.3],
      }),
    );
  }
  // Tirantes de cuelgue bajo el forjado superior (lectura de estructura, v1.16).
  for (let i = 0; i < 5; i++) {
    const x = -NOM_W9 / 2 + 2 + i * 4.4;
    nodes.push(g.addNode({ name: `tirante_${i}`, mesh: meshWood, translation: [x, NOM_H - 0.2, 0.9], scale: [0.12, 0.16, 0.12] }));
  }
  (g.nodes[root] as { children: number[] }).children = nodes;
  return g.finish('vecinos-gen-v16 (trasteros_planta v1)');
}

/** Bajocubierta: sala de instalaciones (caldera, depósitos, cuadro eléctrico, mantenimiento). */
function buildBajocubierta(): Record<string, unknown> {
  const g = new Gltf();
  const root = g.addNode({ name: 'Root', children: [] });
  const nodes: number[] = [];
  const mSlab = g.addMaterial('forjado', '#9a938a', { roughness: 0.95 });
  const mWall = g.addMaterial('trasera', '#b9b2a4', { roughness: 0.9 });
  const mMetal = g.addMaterial('metal', '#8d99ae', { metallic: 0.35, roughness: 0.5 });
  const mBoiler = g.addMaterial('caldera', '#c1666b', { roughness: 0.6 });
  const mTank = g.addMaterial('deposito', '#6d6875', { roughness: 0.7 });
  const mPanel = g.addMaterial('cuadro', '#ffd166', { roughness: 0.5 });
  const mWood = g.addMaterial('estante', '#8a5a33');
  const mCan1 = g.addMaterial('lata_a', '#84a59d');
  const mCan2 = g.addMaterial('lata_b', '#e07a5f');
  const meshSlab = g.addBoxMesh('forjado', mSlab);
  const meshWall = g.addBoxMesh('muro', mWall);
  const meshMetal = g.addBoxMesh('metal', mMetal);
  const meshBoiler = g.addBoxMesh('caldera', mBoiler);
  const meshTank = g.addBoxMesh('deposito', mTank);
  const meshPanel = g.addBoxMesh('cuadro', mPanel);
  const meshWood = g.addBoxMesh('estante', mWood);
  const meshCan = g.addBoxMesh('lata', mCan1);
  const meshCan2 = g.addBoxMesh('lata2', mCan2);

  const base = SLAB * 2;
  nodes.push(g.addNode({ name: 'forjado', mesh: meshSlab, translation: [0, SLAB, 0], scale: [NOM_W9, SLAB * 2, NOM_D28] }));
  nodes.push(
    g.addNode({
      name: 'trasera',
      mesh: meshWall,
      translation: [0, base + (NOM_H - base) / 2, -NOM_D28 / 2 + WALL / 2],
      scale: [NOM_W9, NOM_H - base, WALL],
    }),
  );
  // Caldera contra la trasera (izquierda): cuerpo + puerta + tiraje que sube buscando el tejado.
  nodes.push(g.addNode({ name: 'caldera', mesh: meshBoiler, translation: [-8.2, base + 0.55, -0.55], scale: [1.1, 1.1, 0.7] }));
  nodes.push(g.addNode({ name: 'caldera_puerta', mesh: meshMetal, translation: [-8.2, base + 0.5, -0.14], scale: [0.7, 0.8, 0.06] }));
  nodes.push(g.addNode({ name: 'caldera_tiraje', mesh: meshMetal, translation: [-8.2, NOM_H - 0.35, -0.55], scale: [0.22, 1.6, 0.22] }));
  // Depósitos de agua (derecha): dos cilindros-caja con tapa y grifería.
  const tankXs = [6.4, 8.2];
  for (let i = 0; i < tankXs.length; i++) {
    const x = tankXs[i]!;
    nodes.push(g.addNode({ name: `deposito_${i}`, mesh: meshTank, translation: [x, base + 0.55, -0.6], scale: [1.3, 1.1, 1.1] }));
    nodes.push(g.addNode({ name: `deposito_tapa_${i}`, mesh: meshMetal, translation: [x, base + 1.14, -0.6], scale: [1.4, 0.1, 1.2] }));
    nodes.push(g.addNode({ name: `deposito_bajante_${i}`, mesh: meshMetal, translation: [x - 0.75, base + 0.5, -0.6], scale: [0.1, 1.0, 0.1] }));
  }
  // Colector horizontal que une depósitos y caldera.
  nodes.push(g.addNode({ name: 'colector', mesh: meshMetal, translation: [-0.3, NOM_H - 0.55, -0.85], scale: [16.4, 0.14, 0.14] }));
  // Cuadro eléctrico en la trasera (centro): armario + bisagra de puerta oscura.
  nodes.push(g.addNode({ name: 'cuadro', mesh: meshPanel, translation: [-0.4, base + 1.35, -NOM_D28 / 2 + 0.16], scale: [1.3, 0.9, 0.18] }));
  nodes.push(g.addNode({ name: 'cuadro_puerta', mesh: meshMetal, translation: [-0.4, base + 1.35, -NOM_D28 / 2 + 0.27], scale: [1.14, 0.74, 0.05] }));
  // Estantería de mantenimiento (derecha, frente a los depósitos) con latas de pintura.
  nodes.push(g.addNode({ name: 'estante_poste_a', mesh: meshWood, translation: [6.1, base + 0.75, 0.35], scale: [0.09, 1.5, 0.4] }));
  nodes.push(g.addNode({ name: 'estante_poste_b', mesh: meshWood, translation: [8.5, base + 0.75, 0.35], scale: [0.09, 1.5, 0.4] }));
  nodes.push(g.addNode({ name: 'estante_tabla_a', mesh: meshWood, translation: [7.3, base + 0.55, 0.35], scale: [2.4, 0.06, 0.4] }));
  nodes.push(g.addNode({ name: 'estante_tabla_b', mesh: meshWood, translation: [7.3, base + 1.05, 0.35], scale: [2.4, 0.06, 0.4] }));
  const canSpecs: [number, number, number][] = [
    [5.8, 0.72, 0],
    [6.5, 1.22, 1],
    [7.4, 0.72, 2],
    [8.1, 1.22, 3],
  ];
  for (const [x, y, i] of canSpecs) {
    nodes.push(g.addNode({ name: `lata_${i}`, mesh: i % 2 === 0 ? meshCan : meshCan2, translation: [x, base + y, 0.35], scale: [0.24, 0.28, 0.24] }));
  }
  // Caja de herramientas en el suelo delante del cuadro.
  nodes.push(g.addNode({ name: 'caja_herramientas', mesh: meshMetal, translation: [-1.9, base + 0.16, 0.1], scale: [0.8, 0.32, 0.45] }));
  (g.nodes[root] as { children: number[] }).children = nodes;
  return g.finish('vecinos-gen-v16 (bajocubierta v1)');
}

/** Tejado a dos aguas: faldones inclinados + cumbrera + aguafaldos en testeros + chimenea + antena. */
function buildTejado(): Record<string, unknown> {
  const g = new Gltf();
  const root = g.addNode({ name: 'Root', children: [] });
  const nodes: number[] = [];
  const mSlope = g.addMaterial('faldon', ROOF.color, { roughness: 0.85 });
  const mRidge = g.addMaterial('cumbrera', ROOF.ridge, { roughness: 0.7 });
  const mFascia = g.addMaterial('aguafalda', ROOF.fascia);
  const mChim = g.addMaterial('chimenea', '#8d8378', { roughness: 0.9 });
  const mAnt = g.addMaterial('antena', '#39424e', { metallic: 0.4, roughness: 0.4 });
  const meshSlope = g.addBoxMesh('faldon', mSlope);
  const meshRidge = g.addBoxMesh('cumbrera', mRidge);
  const meshFascia = g.addBoxMesh('aguafalda', mFascia);
  const meshChim = g.addBoxMesh('chimenea', mChim);
  const meshAnt = g.addBoxMesh('antena', mAnt);

  // Aguafaldos (zócalo perimetral) sobre el canto de la bajocubierta.
  nodes.push(g.addNode({ name: 'aguafalda_f', mesh: meshFascia, translation: [0, 0.14, NOM_D_ROOF / 2 - 0.1], scale: [NOM_W11, 0.28, 0.2] }));
  nodes.push(g.addNode({ name: 'aguafalda_b', mesh: meshFascia, translation: [0, 0.14, -NOM_D_ROOF / 2 + 0.1], scale: [NOM_W11, 0.28, 0.2] }));
  // Faldones a dos aguas: corren según X, suben desde los aleros (y=0.28, z=±(D/2)) hasta la
  // cumbrera (y=0.28+pitchH, z=0). Longitud = hipotenusa; rotación sobre X = pendiente.
  const halfD = NOM_D_ROOF / 2;
  const run = halfD + 0.1;
  const slopeLen = Math.hypot(run, ROOF.pitchH);
  const ang = Math.atan2(ROOF.pitchH, run);
  for (const s of [1, -1]) {
    const zC = (s * run) / 2;
    const yC = 0.28 + ROOF.pitchH / 2;
    nodes.push(
      g.addNode({
        name: `faldon_${s > 0 ? 'frente' : 'trasero'}`,
        mesh: meshSlope,
        translation: [0, yC, zC],
        scale: [NOM_W11 + 0.24, 0.1, slopeLen],
        rotation: quatAxis(1, 0, 0, s > 0 ? ang : -ang),
      }),
    );
  }
  // Cumbrera (remate) y limatesa interior.
  nodes.push(g.addNode({ name: 'cumbrera', mesh: meshRidge, translation: [0, 0.28 + ROOF.pitchH + 0.06, 0], scale: [NOM_W11 + 0.3, 0.14, 0.34] }));
  // Testeros: aguafaldos verticales que cierran los triangulitos laterales (escalones).
  for (const sx of [1, -1]) {
    const x = (sx * (NOM_W11 - 0.2)) / 2;
    for (let st = 0; st < 4; st++) {
      const h = 0.28 + (ROOF.pitchH * (4 - st)) / 4;
      const w = ((halfD * st) / 4) * 2;
      nodes.push(
        g.addNode({
          name: `testero_${sx > 0 ? 'der' : 'izq'}_${st}`,
          mesh: meshFascia,
          translation: [x, h / 2, 0],
          scale: [0.12, h, Math.max(0.2, w)],
        }),
      );
    }
  }
  // Chimenea (a un cuarto del frente) con remate y sombrerete.
  nodes.push(g.addNode({ name: 'chimenea', mesh: meshChim, translation: [6.2, 0.28 + ROOF.pitchH * 0.55, 0.5], scale: [0.55, 1.35, 0.55] }));
  nodes.push(g.addNode({ name: 'chimenea_boca', mesh: meshRidge, translation: [6.2, 0.28 + ROOF.pitchH * 0.55 + 0.72, 0.5], scale: [0.7, 0.1, 0.7] }));
  // Antena de TV (hacia el portal) con travesaños.
  nodes.push(g.addNode({ name: 'antena_mastro', mesh: meshAnt, translation: [-7.4, 0.28 + ROOF.pitchH + 0.75, -0.4], scale: [0.06, 1.5, 0.06] }));
  nodes.push(g.addNode({ name: 'antena_travesano', mesh: meshAnt, translation: [-7.4, 0.28 + ROOF.pitchH + 1.28, -0.4], scale: [0.5, 0.05, 0.05] }));
  nodes.push(g.addNode({ name: 'antena_travesano2', mesh: meshAnt, translation: [-7.4, 0.28 + ROOF.pitchH + 1.05, -0.4], scale: [0.34, 0.05, 0.05] }));
  (g.nodes[root] as { children: number[] }).children = nodes;
  return g.finish('vecinos-gen-v16 (tejado v1)');
}

// ───────────────────────── Escritura ─────────────────────────

const outDir = resolve(process.cwd(), 'public/assets');
for (const [path, data] of [
  ['blocks/trasteros_planta.gltf', buildTrasterosPlanta()],
  ['blocks/bajocubierta.gltf', buildBajocubierta()],
  ['blocks/tejado.gltf', buildTejado()],
] as const) {
  const file = resolve(outDir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
  console.log(`✓ ${file}`);
}
console.log('Arte final v1.16 generada (3 bloques de cierre del edificio).');
