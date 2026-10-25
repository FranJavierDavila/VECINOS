import type { Color3, Mesh, Scene, StandardMaterial } from '@babylonjs/core';
import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { B } from './babylon';
import type { BackdropDirector } from './backdrop';

/**
 * ESCENA EXTERIOR (v1.20) — decorado urbano a pie de calle, 100% del catálogo.
 *
 * rules.view.exterior.rows coloca TIRAS (acera, carretera, jardín) frente al edificio y
 * blocks.json define cada tipo con sus props (`exterior`): bancos y farolas y papeleras
 * en las aceras, línea discontinua en la carretera, árboles/arbustos/flores en los
 * jardines. Bloques BAJOS que dan forma a la calle; nunca se instancian en el sim.
 * Las farolas se encienden al anochecer leyendo la luz de día del fondo (backdrop).
 */

export interface ExteriorDirector {
  /** Las farolas siguen la hora del fondo; el resto es estático. dt en segundos. */
  update(dt: number): void;
  dispose(): void;
}

export function createExterior(scene: Scene, world: World, content: Content, backdrop: BackdropDirector): ExteriorDirector {
  const { Color3, MeshBuilder, StandardMaterial } = B();
  const cfg = content.rules.view.exterior;
  if (!cfg.enabled || cfg.rows.length === 0) {
    return { update() {}, dispose() {} };
  }
  const mats = new Map<string, StandardMaterial>();
  const root: Mesh[] = [];
  /** Materiales compartidos por hex (los colores se repiten MUCHO en la calle). */
  const matOf = (hex: string, name: string, emissive = 0): StandardMaterial => {
    const key = `${name}:${hex}`;
    let m = mats.get(key);
    if (!m) {
      m = new StandardMaterial(key, scene);
      m.diffuseColor = Color3.FromHexString(hex);
      m.specularColor = new Color3(0, 0, 0);
      if (emissive > 0) m.emissiveColor = Color3.FromHexString(hex).scale(emissive);
      mats.set(key, m);
    }
    return m;
  };
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, m: StandardMaterial): Mesh => {
    const mesh = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    mesh.isPickable = false;
    root.push(mesh);
    return mesh;
  };
  const cyl = (name: string, dTop: number, dBot: number, h: number, x: number, y: number, z: number, m: StandardMaterial): Mesh => {
    const mesh = MeshBuilder.CreateCylinder(name, { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: 12 }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    mesh.isPickable = false;
    root.push(mesh);
    return mesh;
  };
  const sphere = (name: string, d: number, x: number, y: number, z: number, m: StandardMaterial): Mesh => {
    const mesh = MeshBuilder.CreateSphere(name, { diameter: d, segments: 6 }, scene);
    mesh.position.set(x, y, z);
    mesh.material = m;
    mesh.isPickable = false;
    mesh.scaling.y = 0.82;
    root.push(mesh);
    return mesh;
  };

  // ── Suelo del mundo: cierra el horizonte bajo todo el decorado. ──
  const blocks = Object.values(world.blocks);
  const cx = (Math.max(...blocks.map((b) => b.cell.col + b.size.w)) * content.rules.view.cellW) / 2;
  const ground = MeshBuilder.CreateGround('suelo_mundo', { width: cfg.ground.size, height: cfg.ground.size }, scene);
  ground.position.set(cx, -0.02, 0);
  ground.material = matOf(cfg.ground.color, 'suelo');
  ground.isPickable = false;

  // Farolas encendidas/apagadas: sus materiales emisivos se actualizan por frame.
  const lampMats: { mat: StandardMaterial; hex: string }[] = [];

  cfg.rows.forEach((row, ri) => {
    const def = content.blocks[row.defId];
    const ex = def?.exterior;
    if (!def || !ex) return; // fila desconocida: el validador ya avisó; el resto pinta igual
    const zc = row.z0 + row.depth / 2;
    const w = row.x1 - row.x0;
    // ── Cuerpo del bloque (bajo): color del catálogo; el jardín tapa con césped. ──
    if (row.body) {
      const bodyHex = ex.grassColor && ex.treesPer10m > 0 ? ex.grassColor : def.view.color;
      box(`calle_${ri}`, w, Math.max(0.02, ex.height), row.depth, row.x0 + w / 2, ex.height / 2 - 0.02, zc, matOf(bodyHex, 'cuerpo'));
    }
    // ── Carretera: línea discontinua al centro. ──
    if (ex.laneDash > 0) {
      const dash = ex.laneDash;
      const pitch = dash * 2.2;
      const n = Math.floor(w / pitch);
      for (let i = 0; i < n; i++) {
        const x = row.x0 + pitch * (i + 0.5);
        box(`calle_${ri}_dash_${i}`, dash, 0.015, 0.14, x, ex.height + 0.008, zc, matOf(ex.laneDashColor, 'dash'));
      }
    }
    // ── Acera: farolas + bancos + papeleras, reparto determinista por hash. ──
    if (ex.lampEvery > 0) {
      const n = Math.floor(w / ex.lampEvery);
      for (let i = 0; i < n; i++) {
        const x = row.x0 + ex.lampEvery * (i + 0.5) + (hash01(`lamp${ri}`, i) - 0.5) * 0.6;
        const z = zc + (hash01(`lampZ${ri}`, i) - 0.5) * row.depth * 0.4;
        cyl(`calle_${ri}_farola_${i}`, 0.05, 0.07, ex.lampH, x, ex.height + ex.lampH / 2, z, matOf(ex.lampColor, 'lamp_post'));
        // Cabeza: brazo corto + farol emisivo (se enciende con la noche).
        box(`calle_${ri}_farola_brazo_${i}`, 0.5, 0.05, 0.05, x + 0.2, ex.height + ex.lampH, z, matOf(ex.lampColor, 'lamp_post'));
        const head = matOf(ex.lampHeadColor, 'lamp_head', 0.05);
        lampMats.push({ mat: head, hex: ex.lampHeadColor });
        box(`calle_${ri}_farola_foco_${i}`, 0.26, 0.12, 0.2, x + 0.42, ex.height + ex.lampH - 0.06, z, head);
      }
    }
    if (ex.benchEvery > 0) {
      const n = Math.floor(w / ex.benchEvery);
      for (let i = 0; i < n; i++) {
        const x = row.x0 + ex.benchEvery * (i + 0.5) + (hash01(`bench${ri}`, i) - 0.5) * 0.8;
        const z = zc + (hash01(`benchZ${ri}`, i) - 0.5) * row.depth * 0.4;
        const y = ex.height;
        box(`calle_${ri}_banco_asiento_${i}`, 1.6, 0.07, 0.5, x, y + 0.42, z, matOf(ex.benchColor, 'bench'));
        box(`calle_${ri}_banco_respaldo_${i}`, 1.6, 0.42, 0.06, x, y + 0.66, z - 0.22, matOf(ex.benchColor, 'bench'));
        box(`calle_${ri}_banco_pata_a_${i}`, 0.08, 0.42, 0.44, x - 0.66, y + 0.21, z, matOf(ex.benchLegColor, 'bench_leg'));
        box(`calle_${ri}_banco_pata_b_${i}`, 0.08, 0.42, 0.44, x + 0.66, y + 0.21, z, matOf(ex.benchLegColor, 'bench_leg'));
        if (ex.binEvery > 0 && hash01(`bin${ri}`, i) < 0.7) {
          cyl(`calle_${ri}_papelera_${i}`, 0.24, 0.2, 0.55, x + 1.2, y + 0.28, z + 0.1, matOf(ex.binColor, 'bin'));
        }
      }
    }
    // ── Jardín: árboles, arbustos y flores deterministas por cada 10 m. ──
    const treeEvery = ex.treesPer10m > 0 ? 10 / ex.treesPer10m : 0;
    if (treeEvery > 0) {
      const n = Math.floor(w / treeEvery);
      const trunk = matOf(ex.trunkColor, 'tronco');
      const leafs = ex.leafColors.map((hex, i) => matOf(hex, `hoja_${i}`));
      for (let i = 0; i < n; i++) {
        const x = row.x0 + treeEvery * (i + 0.5) + (hash01(`tree${ri}`, i) - 0.5) * treeEvery * 0.5;
        const z = row.z0 + 0.5 + hash01(`treeZ${ri}`, i) * (row.depth - 1);
        const s = 0.85 + hash01(`treeS${ri}`, i) * 0.5;
        const trunkH = 1.7 * s;
        cyl(`calle_${ri}_arbol_tronco_${i}`, 0.12 * s, 0.18 * s, trunkH, x, ex.height + trunkH / 2, z, trunk);
        const leaf = leafs[Math.floor(hash01(`treeC${ri}`, i) * leafs.length) % leafs.length]!;
        sphere(`calle_${ri}_arbol_copa_a_${i}`, 1.9 * s, x, ex.height + trunkH + 0.7 * s, z, leaf);
        sphere(`calle_${ri}_arbol_copa_b_${i}`, 1.3 * s, x + 0.5 * s, ex.height + trunkH + 1.3 * s, z - 0.3 * s, leaf);
      }
    }
    const bushEvery = ex.bushesPer10m > 0 ? 10 / ex.bushesPer10m : 0;
    if (bushEvery > 0) {
      const n = Math.floor(w / bushEvery);
      const bushes = ex.bushColors.map((hex, i) => matOf(hex, `arbusto_${i}`));
      const flowers = ex.flowerColors.map((hex, i) => matOf(hex, `flor_${i}`));
      for (let i = 0; i < n; i++) {
        const x = row.x0 + bushEvery * (i + 0.5) + (hash01(`bush${ri}`, i) - 0.5) * bushEvery * 0.6;
        const z = row.z0 + 0.35 + hash01(`bushZ${ri}`, i) * (row.depth - 0.7);
        const s = 0.5 + hash01(`bushS${ri}`, i) * 0.45;
        const mat = bushes[Math.floor(hash01(`bushC${ri}`, i) * bushes.length) % bushes.length]!;
        sphere(`calle_${ri}_arbusto_${i}`, 0.9 * s, x, ex.height + 0.34 * s, z, mat);
        // Flores puntual junto al arbusto (hash): un toque de color de la paleta.
        if (hash01(`flor${ri}`, i) < ex.flowerChance) {
          const fm = flowers[Math.floor(hash01(`florC${ri}`, i) * flowers.length) % flowers.length]!;
          const fx = x + (hash01(`florX${ri}`, i) - 0.5) * 1.4;
          const fz = z + (hash01(`florZ${ri}`, i) - 0.5) * 1.2;
          box(`calle_${ri}_flor_${i}`, 0.09, 0.2, 0.09, fx, ex.height + 0.1, fz, fm);
          sphere(`calle_${ri}_flor_cabeza_${i}`, 0.14, fx, ex.height + 0.24, fz, fm);
        }
      }
    }
  });

  return {
    update() {
      // Farolas: el anochecer las enciende (luz de día del fondo), el mediodía las apaga.
      const day = backdrop.daylight;
      const glow = Math.max(0, Math.min(1, (0.42 - day) / 0.42));
      for (const { mat, hex } of lampMats) mat.emissiveColor = Color3.FromHexString(hex).scale(0.05 + glow * 1.1);
    },
    dispose() {
      for (const m of root) m.dispose(false, true);
      ground.dispose(false, true);
      for (const m of mats.values()) m.dispose();
      mats.clear();
      root.length = 0;
      lampMats.length = 0;
    },
  };
}
