import type { Color3, Mesh, Scene, StandardMaterial, Texture, TransformNode } from '@babylonjs/core';
import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { B } from './babylon';
import { playSoundAt } from './audio';

/**
 * TRÁFICO (v1.22, rehecho en v1.31 «tráfico con oficio») — vehículos por la carretera
 * que ya no son cajones andantes: cada tipo es un MODELO MULTI-PIEZA con oficio.
 *
 *  ─ Cuerpo por estilo (berlina / furgoneta / camión de reparto / bus) con morro, pilar
 *    A, parabrisas y luneta trasera INCLINADOS (cristal propio, no pintado).
 *  ─ Costados PINTADOS a canvas por (tipo, color) — ventanas con brillo, pilares,
 *    juntas de puertas, tiradores, faldón y rotulaciones del catálogo (MUDANZAS MOLINA,
 *    línea 12, POLICÍA…): el mismo dialecto 2.5D que puertas y macetas. Los quads van
 *    PROUD de la cara del cuerpo (nada coplanar, regla de la casa).
 *  ─ v1.32 «RECORTADOS DE VERDAD»: el costado ya NO es un plano rectangular entero —
 *    los ARCOS DE RUEDA son AGUJEROS REALES (alpha-test del canvas: el círculo del arco
 *    se RECORTA del plano) y las ruedas viven DENTRO del cuerpo, vistas por el hueco,
 *    con pozo oscuro detrás (nada de discos pintados ni ruedas asomando por fuera:
 *    adiós a las «cajas con planos pegados sin recortar»). El habitáculo de la berlina
 *    se ensancha al ancho del cuerpo para que el costado le abrace sin flotar.
 *  ─ RUEDAS QUE GIRAN de verdad: neumático + llanta clara + radios en cruz, montadas
 *    en un cubo que rota con la distancia recorrida (spin = v/R en el eje del eje).
 *  ─ Detalles: paragolpes oscuros, parrilla, retrovisores, bajos (chasis que no deja
 *    ver al otro lado), FAROS y pilotos traseros (emisivos: de noche se encienden y el
 *    GlowLayer les da el halo), MATRÍCULA con texto del catálogo, cartel de TAXI en el
 *    techo, rótulo de destino del bus, parrilla portaequipajes de la furgoneta y
 *    climatizador del bus. La patrulla mantiene su barra roja/azul alternando.
 *  ─ Datos: rules.view.traffic.vehicles[] con plate/sideText/destSign/roofSign/
 *    roofRack/axles (schema v1.31); el código solo interpreta.
 *
 * Solo presentación: recorren los carriles del catálogo y se desvanecen al salir; el
 * sim jamás los ve. Solo vista "edificio"/"planta" (setVisible) y congelados en modales.
 */

interface VehicleRig {
  root: TransformNode;
  bodyMat: StandardMaterial;
  /** Planos laterales pintados (el material lleva la textura del (tipo, color) vivo). */
  sideMat: StandardMaterial;
  wheels: { hub: TransformNode; r: number }[];
  siren: { red: StandardMaterial; blue: StandardMaterial } | null;
  lights: { head: StandardMaterial; tail: StandardMaterial; signs: StandardMaterial[] };
  /** v1.32: mallas que NO proyectan sombra (costados con alpha-test de arcos). */
  noShadow: Mesh[];
}

interface Active {
  rig: VehicleRig;
  defIndex: number;
  laneIndex: number;
  x: number;
  speed: number;
  passed: boolean;
  phase: number;
}

export interface TrafficDirector {
  /** Avanza vehículos, ruedas y sirenas. dt en segundos. */
  update(dt: number): void;
  /** Solo vistas con calle: idempotente. */
  setVisible(visible: boolean): void;
  /** Vehículos vivos (para QA/E2E). */
  aliveCount(): number;
  /** v1.32 — RIG de la ambulancia para el teatro de emergencias (ambulance.ts).
   *  null si el catálogo no trae view.traffic.ambulance. */
  buildAmbulance(): AmbulanceRig | null;
  dispose(): void;
}

/** v1.32 — Ambulancia del teatro: furgón con librea, puertas traseras abatibles,
 *  girofarios que alternan y ruedas dentro de sus arcos recortados. */
export interface AmbulanceRig {
  root: TransformNode;
  /** Longitud total (para aparcar el morro en el punto del catálogo). */
  length: number;
  wheels: { hub: TransformNode; r: number }[];
  /** Apertura de las puertas traseras 0 (cerradas) .. 1 (abiertas). */
  setDoors(t: number): void;
  /** Girofarios: fase en segundos → alternancia azul/naranja del catálogo. */
  flash(t: number): void;
  dispose(): void;
}

/** Luz de día del cielo (0 noche..1 día) — decide si los faros van encendidos. */
type DaylightFn = () => number;

const NIGHT_DAYLIGHT = 0.42;

export function createTraffic(scene: Scene, world: World, content: Content, daylight?: DaylightFn): TrafficDirector {
  const { Color3, MeshBuilder, StandardMaterial, TransformNode, Vector3 } = B();
  const cfg = content.rules.view.traffic;
  if (!cfg.enabled || cfg.vehicles.length === 0 || cfg.lanes.length === 0) {
    return { update() {}, setVisible() {}, aliveCount: () => 0, dispose() {}, buildAmbulance: () => null };
  }
  // v1.32 — AMBULANCIA (opcional del catálogo): la librea lee franja/cruz del catálogo.
  const acfg = cfg.ambulance ?? { stripe: '#e8641b', cross: '#c0392b' };

  const root = new TransformNode('trafico', scene);
  let visible = true;
  const mats = new Map<string, StandardMaterial>();
  const matOf = (hex: string, name: string, emissive = 0): StandardMaterial => {
    const key = `${name}:${hex}:${emissive}`;
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
  const glass = matOf('#3d4a56', 'cristal_trafico', 0.12);
  const dark = matOf('#3a3a3a', 'trafico_oscuro');
  const tyre = matOf('#26221e', 'rueda');
  const hubMat = matOf('#b8b2a6', 'llanta');
  const chassis = matOf('#26241f', 'bajos');

  // ── Texturas a canvas (v1.31) ────────────────────────────────────────────────────
  // Costados, matrículas y rótulos: el mismo camino que puertas y macetas (canvas →
  // DynamicTexture opaca, sin alpha que se ponga negra en WebGPU).
  const texCache = new Map<string, Texture>();

  const dynTex = (name: string, w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): Texture => {
    const { DynamicTexture } = B();
    const dt = new DynamicTexture(name, { width: w, height: h }, scene, true);
    const c = dt.getContext() as CanvasRenderingContext2D;
    draw(c, w, h);
    dt.update(true); // convención de la casa (invertY) — igual que fachadas y puertas
    return dt as unknown as Texture;
  };

  /** Costado pintado por (tipo, color): el dibujo usa las MISMAS cotas que la geometría.
   *  v1.32: el canvas nace TRANSPARENTE y los arcos de rueda se RECORTAN (destination-out):
   *  el plano del costado queda con agujeros reales por los que se ven las ruedas dentro
   *  de sus pozos — material en ALPHATEST (recorte duro, sin sorting ni velos negros). */
  const sideTex = (def: (typeof cfg.vehicles)[number] | { kind: string; sideText?: string }, hex: string, geo: Geo): Texture => {
    const key = `side:${def.kind}:${hex}`;
    let t = texCache.get(key);
    if (t) return t;
    const S = 96; // píxeles por metro
    const W = Math.max(64, Math.round(geo.L * S));
    const H = Math.max(48, Math.round(geo.roofTop * S));
    t = dynTex(`trafico_side_${def.kind}_${hex.replace('#', '')}`, W, H, (c) => {
      c.clearRect(0, 0, W, H); // sin cuerpo pintado = agujero (alpha-test descarta el texel)
      const X = (x: number): number => (x + geo.L / 2) * S; // morro (+X) a la derecha
      const Y = (y: number): number => geo.roofTop * S - y * S; // mundo arriba → lienzo abajo
      const rr = (x: number, y: number, w: number, h: number, r: number): void => {
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
      };
      const glassFill = (x: number, y: number, w: number, h: number, r: number): void => {
        rr(x, y, w, h, r);
        c.fillStyle = '#2e3a44';
        c.fill();
        c.save();
        c.clip();
        c.fillStyle = 'rgba(255,255,255,0.16)';
        c.beginPath();
        c.moveTo(x + w * 0.12, y + h);
        c.lineTo(x + w * 0.38, y);
        c.lineTo(x + w * 0.55, y);
        c.lineTo(x + w * 0.28, y + h);
        c.closePath();
        c.fill();
        c.restore();
        c.strokeStyle = 'rgba(20,26,32,0.65)';
        c.lineWidth = Math.max(1.5, S * 0.012);
        rr(x, y, w, h, r);
        c.stroke();
      };
      // Base del color del vehículo (el quad cubre de suelo a tejado).
      c.fillStyle = hex;
      c.fillRect(0, 0, W, H);
      // Sombra de la parte alta (techo/caja) para dar volumen al costado.
      const grad = c.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, 'rgba(0,0,0,0.16)');
      grad.addColorStop(0.22, 'rgba(0,0,0,0.02)');
      grad.addColorStop(1, 'rgba(0,0,0,0.08)');
      c.fillStyle = grad;
      c.fillRect(0, 0, W, H);

      const isSedan = def.kind === 'coche' || def.kind === 'taxi' || def.kind === 'policia';
      if (isSedan) {
        // Ventanas del habitáculo (dos por lado con pilar central) sobre la cabina 3D.
        const wy = Y(geo.y0 + geo.hullH + geo.cabinH * 0.86);
        const wh = geo.cabinH * 0.62 * S;
        const x0 = X(-geo.L * 0.28);
        const wWin = geo.cabinL * S * 0.42;
        glassFill(x0, wy, wWin, wh, S * 0.05);
        glassFill(x0 + wWin + S * 0.07, wy, wWin, wh, S * 0.05);
        // Juntas de puertas + tiradores.
        c.strokeStyle = 'rgba(0,0,0,0.32)';
        c.lineWidth = Math.max(1.5, S * 0.014);
        for (const dx of [-geo.L * 0.1, geo.L * 0.13]) {
          c.beginPath();
          c.moveTo(X(dx), Y(geo.y0 + geo.hullH + geo.cabinH * 0.9));
          c.lineTo(X(dx), Y(geo.y0 + 0.03));
          c.stroke();
        }
        c.fillStyle = '#d9d4c8';
        for (const dx of [-geo.L * 0.02, geo.L * 0.2]) {
          rr(X(dx), Y(geo.y0 + geo.hullH * 0.72), S * 0.11, S * 0.045, S * 0.02);
          c.fill();
        }
      } else if (def.kind === 'ambulancia') {
        // v1.32 — LIBREA DE EMERGENCIAS: franja naranja baja, cruz de vida en el costado,
        // rotulación AMBULANCIA y ventanilla de cabina (el texto viene del catálogo).
        const bandY = Y(geo.y0 + geo.hullH * 0.34);
        c.fillStyle = acfg.stripe;
        c.fillRect(0, bandY, W, geo.hullH * 0.16 * S);
        // Cruz de vida (círculo claro + cruz) en el costado de la caja.
        const cxp = X(-geo.L * 0.16);
        const cyp = Y(geo.y0 + geo.hullH * 0.66);
        const rp = geo.hullH * 0.3 * S;
        c.fillStyle = '#f6f7f4';
        c.beginPath();
        c.arc(cxp, cyp, rp, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = acfg.cross;
        const aw = rp * 0.34;
        c.fillRect(cxp - aw / 2, cyp - rp * 0.78, aw, rp * 1.56);
        c.fillRect(cxp - rp * 0.78, cyp - aw / 2, rp * 1.56, aw);
        if (def.sideText) {
          c.fillStyle = 'rgba(30,26,20,0.85)';
          c.font = `900 ${Math.round(S * 0.3)}px 'Arial Black', Arial, sans-serif`;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(def.sideText, X(geo.L * 0.2), Y(geo.y0 + geo.hullH * 0.68));
        }
        glassFill(X(geo.L * 0.16), Y(geo.y0 + geo.hullH * 0.98), geo.L * 0.2 * S, geo.hullH * 0.4 * S, S * 0.05);
      } else if (def.kind === 'furgoneta') {
        // Ventanilla del conductor + puerta corredera con riel.
        glassFill(X(geo.L * 0.16), Y(geo.y0 + geo.hullH * 0.98), geo.L * 0.2 * S, geo.hullH * 0.4 * S, S * 0.05);
        c.strokeStyle = 'rgba(0,0,0,0.35)';
        c.lineWidth = Math.max(1.5, S * 0.016);
        c.beginPath();
        c.moveTo(X(geo.L * 0.05), Y(geo.roofTop - 0.06));
        c.lineTo(X(geo.L * 0.05), Y(geo.y0 + 0.03));
        c.stroke();
        c.beginPath();
        c.moveTo(X(geo.L * 0.05), Y(geo.y0 + geo.hullH * 0.55));
        c.lineTo(X(-geo.L * 0.44), Y(geo.y0 + geo.hullH * 0.55));
        c.stroke();
        if (def.sideText) {
          c.fillStyle = 'rgba(30,26,20,0.78)';
          c.font = `700 ${Math.round(S * 0.34)}px 'Arial Black', Arial, sans-serif`;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(def.sideText, X(-geo.L * 0.16), Y(geo.y0 + geo.hullH * 0.62));
        }
      } else if (def.kind === 'reparto') {
        // Caja de carga: marco + rótulo +_chapa goteada; cabina con su ventanilla.
        const bx = X(-geo.L * 0.44);
        const bw = geo.boxL * S;
        c.strokeStyle = 'rgba(0,0,0,0.3)';
        c.lineWidth = Math.max(2, S * 0.02);
        c.strokeRect(bx, Y(geo.roofTop - 0.02), bw, (geo.roofTop - geo.y0 - 0.1) * S);
        c.strokeStyle = 'rgba(0,0,0,0.14)';
        c.lineWidth = Math.max(1, S * 0.01);
        for (let y = geo.roofTop - 0.16; y > geo.y0 + 0.14; y -= 0.2) {
          c.beginPath();
          c.moveTo(bx + S * 0.04, Y(y));
          c.lineTo(bx + bw - S * 0.04, Y(y));
          c.stroke();
        }
        if (def.sideText) {
          c.fillStyle = 'rgba(28,24,18,0.82)';
          c.font = `800 ${Math.round(S * 0.3)}px 'Arial Black', Arial, sans-serif`;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(def.sideText, bx + bw / 2, Y(geo.y0 + (geo.roofTop - geo.y0) * 0.62));
        }
        glassFill(X(geo.L * 0.3), Y(geo.y0 + geo.cabH * 0.92), geo.L * 0.14 * S, geo.cabH * 0.42 * S, S * 0.04);
      } else {
        // Bus: banda de ventanas con pilares + puerta doble + número de línea grande.
        const wy = Y(geo.y0 + geo.hullH * 0.94);
        const wh = geo.hullH * 0.36 * S;
        const xFront = X(geo.L * 0.42);
        const xBack = X(-geo.L * 0.46);
        const nWin = 7;
        const wWin = (xFront - xBack - S * 0.1) / nWin;
        for (let i = 0; i < nWin; i++) {
          glassFill(xBack + i * wWin + S * 0.012, wy, wWin - S * 0.03, wh, S * 0.04);
        }
        // Puerta doble en el costado (delante del eje trasero).
        c.strokeStyle = 'rgba(0,0,0,0.4)';
        c.lineWidth = Math.max(2, S * 0.018);
        const dx = X(geo.L * 0.12);
        c.strokeRect(dx, Y(geo.y0 + geo.hullH * 0.62), S * 0.5, geo.hullH * 0.62 * S);
        c.beginPath();
        c.moveTo(dx + S * 0.25, Y(geo.y0 + geo.hullH * 0.62));
        c.lineTo(dx + S * 0.25, Y(geo.y0 + 0.06));
        c.stroke();
        if (def.sideText) {
          c.fillStyle = 'rgba(255,255,255,0.94)';
          c.font = `800 ${Math.round(S * 0.52)}px 'Arial Black', Arial, sans-serif`;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.strokeStyle = 'rgba(0,0,0,0.5)';
          c.lineWidth = Math.max(2, S * 0.02);
          c.strokeText(def.sideText, X(geo.L * 0.3), Y(geo.y0 + geo.hullH * 0.42));
          c.fillText(def.sideText, X(geo.L * 0.3), Y(geo.y0 + geo.hullH * 0.42));
        }
      }
      // Banda de la patrulla + rotulación.
      if (def.kind === 'policia') {
        const by = Y(geo.y0 + geo.hullH * 0.62);
        c.fillStyle = '#286090';
        c.fillRect(0, by, W, S * 0.26);
        c.fillStyle = 'rgba(255,255,255,0.95)';
        c.font = `900 ${Math.round(S * 0.26)}px 'Arial Black', Arial, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(def.sideText || 'POLICÍA', W / 2, by + S * 0.13);
      }
      // Franja dama del taxi (tablero bajo las ventanas).
      if (def.kind === 'taxi') {
        const by = Y(geo.y0 + geo.hullH * 0.98);
        const n = Math.ceil(W / (S * 0.14));
        for (let i = 0; i < n; i++) {
          c.fillStyle = i % 2 === 0 ? '#26221c' : hex;
          c.fillRect(i * S * 0.14, by, S * 0.14, S * 0.09);
        }
      }
      // v1.32 — ARCOS DE RUEDA RECORTADOS: el círculo del arco (radio 1.3R, el mismo que
      // la geometría del pozo) se BORRA del canvas (destination-out) → agujero real en el
      // plano por el que se ve la rueda dentro. Un reborde fino pintado alrededor del
      // hueco (guardabarros) remata el corte.
      c.globalCompositeOperation = 'destination-out';
      for (const wx of geo.wheelX) {
        c.beginPath();
        c.arc(X(wx), Y(geo.R), geo.R * 1.3 * S, 0, Math.PI * 2);
        c.fill();
      }
      c.globalCompositeOperation = 'source-over';
      c.strokeStyle = 'rgba(20,16,12,0.55)';
      c.lineWidth = Math.max(2, S * 0.03);
      for (const wx of geo.wheelX) {
        c.beginPath();
        c.arc(X(wx), Y(geo.R), geo.R * 1.3 * S, 0, Math.PI * 2);
        c.stroke();
      }
      // Faldón (franja oscura bajo las puertas).
      c.fillStyle = 'rgba(0,0,0,0.22)';
      c.fillRect(0, Y(geo.y0 + 0.09), W, (0.09 + 0.05) * S);
    });
    // v1.32: la textura lleva ALPHA (agujeros de arco) — el material la recorta.
    (t as unknown as { hasAlpha: boolean }).hasAlpha = true;
    texCache.set(key, t);
    return t;
  };

  const plateTex = (text: string): Texture => {
    const key = `plate:${text}`;
    let t = texCache.get(key);
    if (t) return t;
    t = dynTex('trafico_matricula', 256, 64, (c, w, h) => {
      c.fillStyle = '#eef1f4';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#26313d';
      c.lineWidth = 6;
      c.strokeRect(4, 4, w - 8, h - 8);
      c.fillStyle = '#1d3a5f';
      c.font = '700 38px "Courier New", monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text || '0000 ···', w / 2, h / 2 + 2);
    });
    texCache.set(key, t);
    return t;
  };

  const signTex = (text: string, bg: string, fg: string): Texture => {
    const key = `sign:${text}:${bg}`;
    let t = texCache.get(key);
    if (t) return t;
    t = dynTex('trafico_rotulo', 512, 96, (c, w, h) => {
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(255,255,255,0.25)';
      c.lineWidth = 4;
      c.strokeRect(3, 3, w - 6, h - 6);
      c.fillStyle = fg;
      c.font = '800 56px Arial, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, w / 2, h / 2 + 2);
    });
    texCache.set(key, t);
    return t;
  };

  // ── Cotas por estilo (compartidas por la geometría y el pintado del costado) ──────
  interface Geo {
    L: number;
    R: number;
    y0: number; // canto inferior del cuerpo
    hullH: number; // altura del bloque principal
    cabinH: number; // altura del habitáculo sobre el cuerpo (berlina)
    cabinL: number;
    boxL: number; // caja de carga (reparto)
    cabH: number; // altura de la cabina (reparto)
    roofTop: number;
    wheelX: number[];
    /** Semiancho del cuerpo más profundo: el costado pintado sale de AHÍ + holgura
     *  (regla de la casa: jamás coplanar con la cara del casco). */
    sideHalf: number;
  }
  const geoOf = (def: { kind: string; length: number; width: number; height: number; cabin: number }): Geo => {
    const L = def.length;
    const W = def.width;
    const H = def.height;
    const R = Math.min(0.42, Math.max(0.26, H * 0.32));
    if (def.kind === 'furgoneta' || def.kind === 'ambulancia') {
      const y0 = R * 0.95;
      const hullH = H - y0 - 0.02;
      return { L, R, y0, hullH, cabinH: 0, cabinL: 0, boxL: 0, cabH: 0, roofTop: y0 + hullH, wheelX: [L * 0.34, -L * 0.28], sideHalf: W * 0.46 };
    }
    if (def.kind === 'reparto') {
      const y0 = R * 0.92;
      const boxL = L * 0.66;
      const cabH = H * 0.78;
      return { L, R, y0, hullH: H * 0.5, cabinH: 0, cabinL: 0, boxL, cabH, roofTop: y0 + 0.06 + H * 1.02, wheelX: [L * 0.36, -L * 0.24, -L * 0.38], sideHalf: W * 0.49 };
    }
    if (def.kind === 'bus') {
      const y0 = R * 1.05;
      const hullH = H - 0.12 - y0;
      return { L, R, y0, hullH, cabinH: 0, cabinL: 0, boxL: 0, cabH: 0, roofTop: H - 0.12, wheelX: [L * 0.36, -L * 0.13, -L * 0.27], sideHalf: W * 0.47 };
    }
    // Berlina (coche / taxi / patrulla): habitáculo centrado-ligeramente atrás.
    const y0 = R * 0.72;
    const hullH = H * 0.52;
    const cabinL = L * (0.34 + def.cabin * 0.32);
    const cabinH = H * 0.44;
    return { L, R, y0, hullH, cabinH, cabinL, boxL: 0, cabH: 0, roofTop: y0 + hullH + cabinH - 0.02, wheelX: [L * 0.32, -L * 0.33], sideHalf: W * 0.44 };
  };

  // Cotas por definición (una sola vez: la geometría y las ruedas comparten la verdad).
  const geos = cfg.vehicles.map((d) => geoOf(d));

  /** Rueda completa: neumático + llanta + radios, bajo un cubo que GIRA con la marcha. */
  const buildWheel = (kind: string, r: number, x: number, z: number): { hub: TransformNode; r: number } => {
    const hub = new TransformNode(`trafico_${kind}_cubo_x${x.toFixed(2)}_z${z.toFixed(1)}`, scene);
    hub.position.set(x, r, z);
    const w = MeshBuilder.CreateCylinder(`trafico_${kind}_rueda_x${x.toFixed(2)}_z${z.toFixed(1)}`, { diameter: r * 2, height: 0.22, tessellation: 18 }, scene);
    w.rotation.x = Math.PI / 2;
    w.material = tyre;
    w.parent = hub;
    const cap = MeshBuilder.CreateCylinder(`trafico_${kind}_llanta_x${x.toFixed(2)}_z${z.toFixed(1)}`, { diameter: r * 1.1, height: 0.24, tessellation: 14 }, scene);
    cap.rotation.x = Math.PI / 2;
    cap.material = hubMat;
    cap.parent = hub;
    // Radios en cruz (visibles al girar): dos listones en el plano XY de la llanta.
    for (let i = 0; i < 2; i++) {
      const s = MeshBuilder.CreateBox(`trafico_${kind}_radio_${i}_x${x.toFixed(2)}_z${z.toFixed(1)}`, { width: r * 0.92, height: 0.045, depth: 0.26 }, scene);
      s.rotation.z = i * Math.PI / 2 + Math.PI / 4;
      s.position.z = z > 0 ? 0.075 : -0.075;
      s.material = dark;
      s.parent = hub;
    }
    return { hub, r };
  };

  const box = (kind: string, part: string, w: number, h: number, d: number, m: StandardMaterial): Mesh => {
    const b = MeshBuilder.CreateBox(`trafico_${kind}_${part}`, { width: w, height: h, depth: d }, scene);
    b.material = m;
    return b;
  };

  /** Construye UNA plantilla por tipo de vehículo (pool: se recolorean al salir). */
  const buildRig = (defIndex: number): VehicleRig => {
    const def = cfg.vehicles[defIndex]!;
    const geo = geos[defIndex]!;
    const node = new TransformNode(`trafico_${def.kind}`, scene);
    node.parent = root;
    // v1.32: planos que NO proyectan sombra (costados con alpha-test) — el pase de sombras
    // del controlador los retira de la lista de casters.
    const noShadow: Mesh[] = [];
    let sideOffSafe = geo.sideHalf + 0.014;
    const bodyMat = new StandardMaterial(`trafico_${def.kind}_mat`, scene);
    bodyMat.diffuseColor = Color3.FromHexString(def.colors[0]!);
    bodyMat.specularColor = new Color3(0, 0, 0);
    const body = (part: string, w: number, h: number, d: number): Mesh => box(def.kind, part, w, h, d, bodyMat);
    const place = (m: Mesh, x: number, y: number, z = 0): Mesh => {
      m.position.set(x, y, z);
      m.parent = node;
      return m;
    };
    const sideMat = new StandardMaterial(`trafico_${def.kind}_side`, scene);
    sideMat.specularColor = new Color3(0, 0, 0);
    sideMat.backFaceCulling = true;
    // v1.32 — RECORTADO REAL: alpha-test del difuso (los texels transparentes del arco se
    // descartan — sin blending, sin sorting, sin velos negros en WebGPU; el mismo camino
    // verificado de las máquinas de la lavandería y los recortes de macetas).
    sideMat.useAlphaFromDiffuseTexture = true;
    sideMat.transparencyMode = 2; // ALPHATEST
    sideMat.alphaCutOff = 0.4;

    const W = def.width;
    const L = def.length;
    const { R, y0, hullH } = geo;
    const isSedan = def.kind === 'coche' || def.kind === 'taxi' || def.kind === 'policia';

    // Bajos: chasis oscuro que cierra la vista bajo el cuerpo (nada de ver al otro lado).
    place(box(def.kind, 'bajos', L * 0.94, y0 - 0.02, W * 0.5, chassis), 0, (y0 - 0.02) / 2 + 0.02);

    if (isSedan) {
      // Cuerpo + habitáculo; morro integrado en el bloque (el costado pintado da el perfil).
      // v1.32: la cabina se ensancha al ANCHO DEL CUERPO (W*0.88) — el costado pintado la
      // abraza sin flotar por fuera (antes W*0.8: plano pegado a un cuerpo más estrecho).
      place(body('cuerpo', L, hullH, W * 0.88), 0, y0 + hullH / 2);
      const cab = body('cabina', geo.cabinL, geo.cabinH, W * 0.86);
      place(cab, -L * 0.05, y0 + hullH + geo.cabinH / 2 - 0.04);
      // Parabrisas y luneta inclinados (cristal propio, pilar A del catálogo).
      const ws = box(def.kind, 'parabrisas', W * 0.8, geo.cabinH * 0.92, 0.035, glass);
      ws.rotation.z = -0.5;
      place(ws, -L * 0.05 + geo.cabinL / 2 - 0.02, y0 + hullH + geo.cabinH * 0.52);
      const rw = box(def.kind, 'luneta', W * 0.8, geo.cabinH * 0.88, 0.035, glass);
      rw.rotation.z = 0.52;
      place(rw, -L * 0.05 - geo.cabinL / 2 + 0.02, y0 + hullH + geo.cabinH * 0.5);
    } else if (def.kind === 'furgoneta') {
      // Volumen único (cab-over) con morro corto bajo el parabrisas.
      place(body('cuerpo', L * 0.98, hullH, W * 0.92), -L * 0.01, y0 + hullH / 2);
      const nose = body('morro', L * 0.12, hullH * 0.42, W * 0.92);
      place(nose, L * 0.47, y0 + hullH * 0.21);
      const ws = box(def.kind, 'parabrisas', W * 0.84, hullH * 0.5, 0.04, glass);
      ws.rotation.z = -0.3;
      place(ws, L * 0.42, y0 + hullH * 0.78);
    } else if (def.kind === 'reparto') {
      const cab = body('cabina', L * 0.26, geo.cabH, W * 0.92);
      place(cab, L * 0.35, y0 + geo.cabH / 2);
      const cargo = body('caja', geo.boxL, def.height * 1.02, W * 0.98);
      place(cargo, -L * 0.13, y0 + 0.06 + (def.height * 1.02) / 2);
      const ws = box(def.kind, 'parabrisas', W * 0.84, geo.cabH * 0.42, 0.04, glass);
      ws.rotation.z = -0.22;
      place(ws, L * 0.44, y0 + geo.cabH * 0.72);
    } else {
      // Bus: cuerpo largo a un agua con panza; el costado pintado trae las ventanas.
      place(body('cuerpo', L, hullH, W * 0.94), 0, y0 + hullH / 2);
      place(body('tejadillo', L * 0.99, 0.1, W * 0.9), 0, y0 + hullH + 0.05);
      const ws = box(def.kind, 'parabrisas', W * 0.86, hullH * 0.42, 0.04, glass);
      ws.rotation.z = -0.16;
      place(ws, L * 0.49, y0 + hullH * 0.8);
      const rw = box(def.kind, 'luneta', W * 0.8, hullH * 0.3, 0.04, glass);
      place(rw, -L * 0.49, y0 + hullH * 0.82);
      // Climatizador de techo.
      place(box(def.kind, 'ac', L * 0.26, 0.14, W * 0.5, dark), -L * 0.05, y0 + hullH + 0.16);
    }

    // Paragolpes, parrilla y matrícula.
    const bumpH = Math.max(0.14, R * 0.42);
    place(box(def.kind, 'paragolpes_del', L * 0.045, bumpH, W * 1.0, dark), L / 2 + 0.012, y0 + bumpH * 0.62);
    place(box(def.kind, 'paragolpes_tras', L * 0.045, bumpH, W * 1.0, dark), -L / 2 - 0.012, y0 + bumpH * 0.62);
    if (def.plate) {
      // Planos sin rotar miran a −Z (convención del proyecto): −π/2 gira el frente a +X.
      const plateW = L > 4.5 ? 0.46 : 0.38;
      const pm = new StandardMaterial(`trafico_${def.kind}_matricula`, scene);
      pm.diffuseTexture = plateTex(def.plate);
      pm.specularColor = new Color3(0, 0, 0);
      pm.backFaceCulling = true;
      const pf = MeshBuilder.CreatePlane(`trafico_${def.kind}_matricula_del`, { width: plateW, height: plateW * 0.28 }, scene);
      pf.material = pm;
      pf.rotation.y = -Math.PI / 2;
      place(pf, L / 2 + 0.04, y0 + bumpH * 0.6);
      const pr = MeshBuilder.CreatePlane(`trafico_${def.kind}_matricula_tras`, { width: plateW, height: plateW * 0.28 }, scene);
      pr.material = pm;
      pr.rotation.y = Math.PI / 2;
      place(pr, -L / 2 - 0.04, y0 + bumpH * 0.6);
    }

    // Faros y pilotos (emisivos: de noche se encienden y el bloom hace el resto).
    const head = new StandardMaterial(`trafico_${def.kind}_faro`, scene);
    head.diffuseColor = Color3.FromHexString('#f4ecd8');
    head.emissiveColor = Color3.FromHexString('#fff1c2').scale(0.12);
    head.specularColor = new Color3(0, 0, 0);
    const tail = new StandardMaterial(`trafico_${def.kind}_piloto`, scene);
    tail.diffuseColor = Color3.FromHexString('#8e2418');
    tail.emissiveColor = Color3.FromHexString('#d43a2a').scale(0.18);
    tail.specularColor = new Color3(0, 0, 0);
    const lampH = Math.max(0.1, R * 0.3);
    for (const sz of [-1, 1]) {
      const hl = box(def.kind, 'faro', 0.06, lampH, lampH * 1.5, head);
      place(hl, L / 2 + 0.015, y0 + hullH * 0.66, sz * W * 0.3);
      const tl = box(def.kind, 'piloto', 0.05, lampH * 0.9, lampH * 1.3, tail);
      place(tl, -L / 2 - 0.015, y0 + hullH * 0.68, sz * W * 0.3);
    }

    // v1.32 — POZOS DE RUEDA: caja oscura DETRÁS de cada arco recortado (el hueco del
    // costado muestra el pozo y la rueda, no el otro lado del coche). La caja NO envuelve
    // al neumático: se queda tras su cara interior (la rueda vive en la cavidad del arco,
    // visible por el hueco; el pozo tapa el fondo). Nada asoma por el costado opuesto.
    const wellDepth = Math.max(0.02, (sideOffSafe - 0.25) * 2);
    for (const wx of geo.wheelX) {
      const wellTop = Math.min(geo.roofTop, geo.R + geo.R * 1.3);
      const wh = Math.max(0.02, wellTop - y0);
      place(box(def.kind, 'pozo', geo.R * 2.6 + 0.06, wh, wellDepth, chassis), wx, y0 + wh / 2);
    }

    // v1.32 — DETALLES FINALES: tubo de escape (todos los motorizados) y tiradores 3D
 //    que salen del plano pintado (berlina y furgoneta: puertas con manija de verdad).
    const exhaust = MeshBuilder.CreateCylinder(`trafico_${def.kind}_escape`, { diameter: 0.045, height: 0.16, tessellation: 8 }, scene);
    exhaust.rotation.z = Math.PI / 2;
    exhaust.material = dark;
    place(exhaust, -L / 2 + 0.06, y0 + 0.05, W * 0.2);
    if (isSedan || def.kind === 'furgoneta') {
      const hY = y0 + hullH * (isSedan ? 0.72 : 0.55);
      for (const hx of isSedan ? [-geo.L * 0.02, geo.L * 0.2] : [geo.L * 0.05]) {
        for (const sz of [-1, 1]) {
          place(box(def.kind, 'tirador3d', 0.11, 0.035, 0.05, dark), hx, hY, sz * (sideOffSafe + 0.018));
        }
      }
    }

    // Retrovisores sobre el pilar A.
    const mirrorZ = W * 0.48;
    for (const sz of [-1, 1]) {
      const stalk = box(def.kind, 'retro_base', 0.03, 0.03, 0.09, dark);
      place(stalk, isSedan ? -L * 0.05 + geo.cabinL / 2 - 0.05 : L * 0.4, y0 + hullH + (isSedan ? geo.cabinH * 0.6 : 0.1), sz * mirrorZ * 0.94);
      const mir = box(def.kind, 'retro', 0.05, 0.09, 0.12, bodyMat);
      place(mir, isSedan ? -L * 0.05 + geo.cabinL / 2 - 0.05 : L * 0.4, y0 + hullH + (isSedan ? geo.cabinH * 0.62 : 0.12), sz * (mirrorZ + 0.02));
    }

    // Costados pintados: quads PROUD del semiancho real del cuerpo (regla de la casa:
    // nada coplanar — la v1.31 inicial enterraba el plano en furgoneta/bus/reparto).
    // v1.32: los planos no proyectan sombra (el ALPHATEST del arco no llega al mapa de
    // profundidad: proyectarían un rectángulo entero); la silueta la dan cuerpo y ruedas.
    const sideOff = geo.sideHalf + 0.014;
    sideOffSafe = sideOff;
    const sideH = geo.roofTop;
    for (const sz of [-1, 1]) {
      const q = MeshBuilder.CreatePlane(`trafico_${def.kind}_costado_${sz > 0 ? 'd' : 'i'}`, { width: L, height: sideH, sideOrientation: 2 /* DOUBLESIDE */ }, scene);
      q.material = sideMat;
      q.rotation.y = sz > 0 ? Math.PI : 0;
      q.position.set(0, sideH / 2, sz * sideOff);
      q.parent = node;
      q.receiveShadows = false;
      noShadow.push(q);
    }

    // Ruedas (neumático + llanta + radios, giran con la marcha). v1.32: DENTRO del cuerpo
    // (la cara exterior del neumático queda tras el plano del costado — se ven POR EL ARCO,
    // como en un coche de verdad, ya no asoman por fuera de la carrocería).
    const wheels: VehicleRig['wheels'] = [];
    const tireZ = sideOff - 0.13;
    for (const wx of geo.wheelX) {
      for (const sz of [-1, 1]) {
        wheels.push(buildWheel(def.kind, R, wx, sz * tireZ));
      }
    }

    // Tejado: cartel de TAXI, parrilla de furgoneta o barra de la patrulla.
    const signs: StandardMaterial[] = [];
    if (def.roofSign) {
      const sm = new StandardMaterial(`trafico_${def.kind}_tejado`, scene);
      sm.diffuseTexture = signTex(def.roofSign, '#ffd166', '#26221c');
      sm.emissiveColor = Color3.FromHexString('#ffd166').scale(0.3);
      sm.specularColor = new Color3(0, 0, 0);
      signs.push(sm);
      const s = MeshBuilder.CreateBox(`trafico_${def.kind}_cartel`, { width: 0.34, height: 0.14, depth: 0.18 }, scene);
      s.material = sm;
      place(s, -L * 0.05, geo.roofTop + 0.08);
    }
    if (def.roofRack) {
      for (const sz of [-1, 1]) {
        place(box(def.kind, `riel_${sz > 0 ? 'd' : 'i'}`, L * 0.5, 0.035, 0.04, dark), -L * 0.06, geo.roofTop + 0.03, sz * W * 0.3);
      }
      for (const rx of [L * 0.12, -L * 0.24]) {
        place(box(def.kind, 'travesano', 0.04, 0.03, W * 0.62, dark), rx, geo.roofTop + 0.045);
      }
    }
    if (def.destSign) {
      const sm = new StandardMaterial(`trafico_${def.kind}_destino`, scene);
      sm.diffuseTexture = signTex(def.destSign, '#14161a', '#ffb547');
      sm.emissiveColor = Color3.FromHexString('#ffb547').scale(0.32);
      sm.specularColor = new Color3(0, 0, 0);
      sm.backFaceCulling = true;
      signs.push(sm);
      const q = MeshBuilder.CreatePlane(`trafico_${def.kind}_destino_quad`, { width: 1.15, height: 0.21 }, scene);
      q.material = sm;
      q.rotation.y = -Math.PI / 2; // frente al morro (+X), bajo el canto del tejadillo
      place(q, L / 2 + 0.045, y0 + hullH + 0.06);
    }

    // Barra de la patrulla (rojo/azul alternando, con glow del bloom).
    let siren: VehicleRig['siren'] = null;
    if (def.siren) {
      place(box(def.kind, 'barra_base', 0.56, 0.05, W * 0.44, dark), -L * 0.03, geo.roofTop + 0.035);
      const red = new StandardMaterial('trafico_sirena_rojo', scene);
      red.diffuseColor = Color3.FromHexString('#c0392b');
      red.emissiveColor = Color3.FromHexString('#c0392b').scale(0.2);
      const blue = new StandardMaterial('trafico_sirena_azul', scene);
      blue.diffuseColor = Color3.FromHexString('#286090');
      blue.emissiveColor = Color3.FromHexString('#286090').scale(0.2);
      const a = box(def.kind, 'sirena_a', 0.24, 0.1, W * 0.18, red);
      place(a, -L * 0.03 - 0.14, geo.roofTop + 0.11);
      const b2 = box(def.kind, 'sirena_b', 0.24, 0.1, W * 0.18, blue);
      place(b2, -L * 0.03 + 0.14, geo.roofTop + 0.11);
      siren = { red, blue };
    }

    node.setEnabled(false);
    return { root: node, bodyMat, sideMat, wheels, siren, lights: { head, tail, signs }, noShadow };
  };

  const rigs = cfg.vehicles.map((_, i) => buildRig(i));
  const active = new Set<Active>();
  let nextSpawn = 1.5;
  let roll = 0;
  let nightOn = false;
  const pick = (): number => {
    // Ruleta ponderada determinista por hash (mismo lenguaje que el resto de la calle).
    let acc = 0;
    const total = cfg.vehicles.reduce((s, v) => s + v.chance, 0);
    const r = hash01('trafico_ruleta', roll++) * total;
    for (let i = 0; i < cfg.vehicles.length; i++) {
      acc += cfg.vehicles[i]!.chance;
      if (r <= acc) return i;
    }
    return 0;
  };

  const spawn = (): void => {
    const defIndex = pick();
    const def = cfg.vehicles[defIndex]!;
    // Un rig por tipo: si ya está en la calle, este tipo no sale esta vez (pool honesto).
    if ([...active].some((a) => a.defIndex === defIndex)) return;
    const rig = rigs[defIndex]!;
    const geo = geoOf(def);
    const laneIndex = Math.floor(hash01('trafico_carril', roll) * cfg.lanes.length) % cfg.lanes.length;
    const lane = cfg.lanes[laneIndex]!;
    const dir = lane.dir >= 0 ? 1 : -1;
    const speed = lane.speedMin + hash01('trafico_velo', roll) * Math.max(0.1, lane.speedMax - lane.speedMin);
    const x = dir > 0 ? cfg.xMin - def.length : cfg.xMax + def.length;
    const hex = def.colors[Math.floor(hash01('trafico_color', roll) * def.colors.length) % def.colors.length]!;
    rig.bodyMat.diffuseColor = Color3.FromHexString(hex);
    rig.sideMat.diffuseTexture = sideTex(def, hex, geo);
    rig.root.rotation.y = dir > 0 ? 0 : Math.PI;
    rig.root.setEnabled(visible);
    rig.root.position = new Vector3(x, 0, lane.z);
    active.add({ rig, defIndex, laneIndex, x, speed, passed: false, phase: hash01('trafico_fase', roll) * 6 });
  };

  /** v1.32 — AMBULANCIA del teatro de emergencias: furgón blanco con librea (franja +
   *  cruz + rotulación del catálogo), puertas traseras abatibles, girofarios alternantes
   *  y las MISMAS ruedas dentro de arcos recortados que el resto del tráfico. */
  const buildAmbulance = (): AmbulanceRig | null => {
    const a = cfg.ambulance;
    if (!a) return null;
    const node = new TransformNode('trafico_ambulancia', scene);
    node.parent = root;
    const def = { kind: 'ambulancia', length: a.length, width: a.width, height: a.height, cabin: 0.3 };
    const geo = geoOf(def);
    const L = def.length;
    const W = def.width;
    const { R, y0, hullH } = geo;
    const white = new StandardMaterial('ambulancia_blanco', scene);
    white.diffuseColor = Color3.FromHexString(a.color);
    white.specularColor = new Color3(0, 0, 0);
    const place = (m: Mesh, x: number, y: number, z = 0): Mesh => {
      m.position.set(x, y, z);
      m.parent = node;
      return m;
    };
    // Bajos + cuerpo + morro bajo el parabrisas (misma genealogía que la furgoneta).
    place(box('ambulancia', 'bajos', L * 0.94, y0 - 0.02, W * 0.5, chassis), 0, (y0 - 0.02) / 2 + 0.02);
    place(box('ambulancia', 'cuerpo', L * 0.98, hullH, W * 0.92, white), -L * 0.01, y0 + hullH / 2);
    place(box('ambulancia', 'morro', L * 0.12, hullH * 0.42, W * 0.92, white), L * 0.47, y0 + hullH * 0.21);
    const ws = box('ambulancia', 'parabrisas', W * 0.84, hullH * 0.5, 0.04, glass);
    ws.rotation.z = -0.3;
    place(ws, L * 0.42, y0 + hullH * 0.78);
    // Costados pintados con librea (arcos recortados; NO proyectan sombra).
    const sideMat = new StandardMaterial('ambulancia_side', scene);
    sideMat.specularColor = new Color3(0, 0, 0);
    sideMat.useAlphaFromDiffuseTexture = true;
    sideMat.transparencyMode = 2;
    sideMat.alphaCutOff = 0.4;
    const sideOff = geo.sideHalf + 0.014;
    for (const sz of [-1, 1]) {
      const q = MeshBuilder.CreatePlane(`trafico_ambulancia_costado_${sz > 0 ? 'd' : 'i'}`, { width: L, height: geo.roofTop, sideOrientation: 2 }, scene);
      q.material = sideMat;
      q.rotation.y = sz > 0 ? Math.PI : 0;
      q.position.set(0, geo.roofTop / 2, sz * sideOff);
      q.parent = node;
      q.receiveShadows = false;
    }
    sideMat.diffuseTexture = sideTex({ kind: 'ambulancia', sideText: a.sideText }, a.color, geo);
    // Ruedas dentro de sus pozos (la verdad v1.32).
    const wheels: { hub: TransformNode; r: number }[] = [];
    const tireZ = sideOff - 0.13;
    for (const wx of geo.wheelX) {
      for (const sz of [-1, 1]) wheels.push(buildWheel('ambulancia', R, wx, sz * tireZ));
    }
    // Puertas traseras abatibles: dos hojas con bisagra en los montantes.
    const rearX = -L / 2 - 0.012;
    const doorW = W * 0.4;
    const doorH = hullH * 0.82;
    const doorMat = new StandardMaterial('ambulancia_puerta', scene);
    doorMat.diffuseColor = Color3.FromHexString(a.color);
    doorMat.specularColor = new Color3(0, 0, 0);
    const crossMat = new StandardMaterial('ambulancia_cruz_puerta', scene);
    crossMat.diffuseColor = Color3.FromHexString(acfg.cross);
    crossMat.specularColor = new Color3(0, 0, 0);
    const hinges: TransformNode[] = [];
    for (const sz of [-1, 1]) {
      const hinge = new TransformNode(`trafico_ambulancia_puerta_${sz > 0 ? 'd' : 'i'}`, scene);
      hinge.position.set(rearX, y0 + 0.04, sz * (doorW / 2 + 0.01));
      hinge.parent = node;
      const leaf = MeshBuilder.CreatePlane(`trafico_ambulancia_hoja_${sz > 0 ? 'd' : 'i'}`, { width: doorW, height: doorH }, scene);
      leaf.material = doorMat;
      leaf.rotation.y = -Math.PI / 2; // la cara mira hacia atrás (−X)
      leaf.position.set(0, doorH / 2, (-sz * doorW) / 2);
      leaf.parent = hinge;
      const crossV = box('ambulancia', `cruzv_${sz > 0 ? 'd' : 'i'}`, 0.02, doorH * 0.34, 0.07, crossMat);
      crossV.position.set(-0.02, doorH * 0.62, (-sz * doorW) / 2);
      crossV.parent = hinge;
      const crossH = box('ambulancia', `cruzh_${sz > 0 ? 'd' : 'i'}`, 0.02, 0.07, doorW * 0.34, crossMat);
      crossH.position.set(-0.02, doorH * 0.62, (-sz * doorW) / 2);
      crossH.parent = hinge;
      hinges.push(hinge);
    }
    // Faros y pilotos emisivos (la noche los enciende como al resto del tráfico).
    const head = new StandardMaterial('ambulancia_faro', scene);
    head.diffuseColor = Color3.FromHexString('#f4ecd8');
    head.emissiveColor = Color3.FromHexString('#fff1c2').scale(0.12);
    head.specularColor = new Color3(0, 0, 0);
    const tail = new StandardMaterial('ambulancia_piloto', scene);
    tail.diffuseColor = Color3.FromHexString('#8e2418');
    tail.emissiveColor = Color3.FromHexString('#d43a2a').scale(0.18);
    tail.specularColor = new Color3(0, 0, 0);
    for (const sz of [-1, 1]) {
      const hl = box('ambulancia', 'faro', 0.06, 0.1, 0.16, head);
      place(hl, L / 2 + 0.015, y0 + hullH * 0.66, sz * W * 0.3);
      const tl = box('ambulancia', 'piloto', 0.05, 0.09, 0.14, tail);
      place(tl, -L / 2 - 0.015, y0 + hullH * 0.68, sz * W * 0.3);
    }
    // Caja de girofarios en el techo: dos cubos emisivos que alternan con flash(t).
    const barBase = box('ambulancia', 'giro_base', 0.5, 0.045, W * 0.36, dark);
    place(barBase, L * 0.18, geo.roofTop + 0.03);
    const blueM = new StandardMaterial('ambulancia_giro_azul', scene);
    blueM.diffuseColor = Color3.FromHexString(a.beaconA);
    blueM.emissiveColor = Color3.FromHexString(a.beaconA).scale(0.3);
    const amberM = new StandardMaterial('ambulancia_giro_ambra', scene);
    amberM.diffuseColor = Color3.FromHexString(a.beaconB);
    amberM.emissiveColor = Color3.FromHexString(a.beaconB).scale(0.3);
    const bA = box('ambulancia', 'giro_a', 0.2, 0.11, W * 0.3, blueM);
    place(bA, L * 0.18 - 0.13, geo.roofTop + 0.1);
    const bB = box('ambulancia', 'giro_b', 0.2, 0.11, W * 0.3, amberM);
    place(bB, L * 0.18 + 0.13, geo.roofTop + 0.1);
    node.setEnabled(false);
    return {
      root: node,
      length: L,
      wheels,
      setDoors(t: number) {
        for (let i = 0; i < hinges.length; i++) {
          const sz = i === 0 ? -1 : 1;
          hinges[i]!.rotation.y = sz * Math.min(1, Math.max(0, t)) * Math.PI * 0.55;
        }
      },
      flash(t: number) {
        const on = Math.floor(t * 3.2) % 2 === 0;
        blueM.emissiveColor = Color3.FromHexString(a.beaconA).scale(on ? 1.4 : 0.12);
        amberM.emissiveColor = Color3.FromHexString(a.beaconB).scale(on ? 0.12 : 1.4);
      },
      dispose() {
        node.dispose(false, true);
      },
    };
  };

  return {
    update(dt: number) {
      // Faros: la luz de día del cielo manda (noche → encendidos, con halo del bloom).
      const night = (daylight?.() ?? 1) < NIGHT_DAYLIGHT;
      if (night !== nightOn) {
        nightOn = night;
        for (const r of rigs) {
          r.lights.head.emissiveColor = Color3.FromHexString('#fff1c2').scale(night ? 1 : 0.12);
          r.lights.tail.emissiveColor = Color3.FromHexString('#d43a2a').scale(night ? 0.85 : 0.18);
          for (const s of r.lights.signs) s.emissiveColor = s.emissiveColor.scale(night ? 3 : 1 / 3);
        }
      }
      nextSpawn -= dt;
      if (nextSpawn <= 0) {
        nextSpawn = cfg.spawnEveryMin + hash01('trafico_t', world.tick + roll) * (cfg.spawnEveryMax - cfg.spawnEveryMin);
        if (active.size < cfg.maxAlive) spawn();
      }
      for (const a of [...active]) {
        const def = cfg.vehicles[a.defIndex]!;
        // Movimiento real: la dirección del carril manda.
        const dir = cfg.lanes[a.laneIndex]!.dir >= 0 ? 1 : -1;
        a.rig.root.position.x += dir * a.speed * dt;
        a.x = a.rig.root.position.x;
        // RUEDAS QUE GIRAN: spin = v/R alrededor del eje (marco local: el morro siempre +X).
        const spin = (a.speed * dt) / geos[a.defIndex]!.R;
        for (const w of a.rig.wheels) w.hub.rotation.z -= spin;
        // Balanceo cartoon sutil (los largos se menean menos).
        a.phase += dt * a.speed * 2.4;
        a.rig.root.position.y = Math.sin(a.phase) * 0.015 * Math.min(1, 3.6 / def.length);
        // Sirena: rojo/azul alternando (siempre que la patrulla circula).
        if (a.rig.siren) {
          const on = Math.floor(a.phase * 2.2) % 2 === 0;
          a.rig.siren.red.emissiveColor = Color3.FromHexString('#c0392b').scale(on ? 1 : 0.2);
          a.rig.siren.blue.emissiveColor = Color3.FromHexString('#286090').scale(on ? 0.2 : 1);
        }
        // Sonido de paso frente al portal (una vez por vehículo).
        if (!a.passed && Math.abs(a.x - cfg.passX) < 4) {
          a.passed = true;
          playSoundAt('calle_vehiculo', Math.max(0.25, 1 - Math.abs(a.x - cfg.passX) / cfg.passRadius));
        }
        if ((dir > 0 && a.x > cfg.xMax + def.length + 2) || (dir < 0 && a.x < cfg.xMin - def.length - 2)) {
          a.rig.root.setEnabled(false);
          active.delete(a);
        }
      }
    },
    setVisible(v: boolean) {
      if (visible === v) return;
      visible = v;
      root.setEnabled(v);
    },
    aliveCount: () => active.size,
    buildAmbulance,
    dispose() {
      for (const a of active) a.rig.root.dispose(false, true);
      active.clear();
      for (const r of rigs) r.root.dispose(false, true);
      root.dispose(false, false);
      for (const m of mats.values()) m.dispose();
      mats.clear();
      for (const t of texCache.values()) t.dispose();
      texCache.clear();
    },
  };
}
