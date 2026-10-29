import type { Color3, Mesh, Scene, StandardMaterial, Texture, TransformNode, Vector3 as TVector3 } from '@babylonjs/core';
import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { B } from './babylon';
import { playSoundAt } from './audio';

/**
 * TRÁFICO (v1.22, rehecho en v1.31, v1.32 y VUELTO A HACER en v1.34 «carrocería de verdad»)
 * — vehículos por la carretera que ya no son ni cajones andantes ni «cajas con planos
 * pegados sin recortar»: cada carrocería es UNA SOLID REAL por EXTRUSIÓN del perfil lateral
 * (silueta con MORRO, PILAR A, PARABRISAS y LUNETA en la propia forma) y los ARCOS DE RUEDA
 * son GEOMETRÍA de verdad (escotaduras del perfil por las que se ve la rueda dentro), no
 * agujeros pintados con alpha-test.
 *
 *  ─ CUERPO = ExtrudeShape del perfil cerrado (XY) a lo ancho (Z): las TAPAS son las caras
 *    laterales metálicas reales y las PAREDES son morro/trasera/techo con sombreado propio
 *    — el volumen se lee desde cualquier ángulo, también de frente en el cruce.
 *  ─ BERLINA en dos extrusiones: carrocería hasta la línea de cintura + HABITÁCULO DE
 *    CRISTAL retranqueado (W*0.84) cuyas tapas SON las ventanas laterales y cuyas paredes
 *    inclinadas SON parabrisas y luneta; tapa de techo en color carrocería un pelo más
 *    ancha (pilares + techo metálico). Nada coplanar: el habitáculo nace DENTRO del cuerpo.
 *  ─ FURGONETA/REPARTO/BUS/AMBULANCIA en una extrusión con su silueta real (rake del
 *    parabrisas, caja alta del reparto, panza del bus) y CRISTALES como cajas finas
 *    sobresaliendo 8 mm de la chapa (paneles con grosor, jamás planos pegados).
 *  ─ ROTULACIONES como CALCOMANIAS pequeñas y orgullosas (POLICÍA, MUDANZAS MOLINA, línea
 *    12, cruz de la ambulancia): quads de texto a canvas con alpha-test 8 mm por delante
 *    de la chapa; las bandas (patrulla, taxi, ambulancia) son CAJAS finas de verdad.
 *  ─ RUEDAS QUE GIRAN: neumático + llanta + radios en cruz bajo un cubo que rota con la
 *    marcha (spin = v/R), metidas en su arco con el CHASIS oscuro detrás (no se ve al otro
 *    lado); bajos que cierran la vista bajo el cuerpo.
 *  ─ Detalles: paragolpes, matrícula delantera/trasera, retrovisores, tubo de escape,
 *    cartel de TAXI, rótulo de destino del bus, portaequipajes, climatizador y FAROS que
 *    leen la luz del cielo (de noche se encienden y el GlowLayer hace el halo).
 *  ─ Datos: rules.view.traffic.vehicles[] con plate/sideText/destSign/roofSign/roofRack/
 *    axles — el código solo interpreta (los ejes del catálogo mandan las posiciones).
 *
 * Solo presentación: recorren los carriles del catálogo y se desvanecen al salir; el
 * sim jamás los ve. Solo vista "edificio"/"planta" (setVisible) y congelados en modales.
 */

interface VehicleRig {
  root: TransformNode;
  bodyMat: StandardMaterial;
  wheels: { hub: TransformNode; r: number }[];
  siren: { red: StandardMaterial; blue: StandardMaterial } | null;
  lights: { head: StandardMaterial; tail: StandardMaterial; signs: StandardMaterial[] };
}

interface Active {
  rig: VehicleRig;
  defIndex: number;
  laneIndex: number;
  x: number;
  speed: number;
  /** v1.41 — velocidad de crucero del carril (la frenada/restauración orbitan alrededor). */
  cruise: number;
  passed: boolean;
  phase: number;
  /** v1.41 — segundos de parón tras un susto/accidente cómico (pilotos parpadeando). */
  hazardT: number;
  tailFlash: boolean;
  /** v1.41 — la frenada es imposible (el peatón apareció demasiado cerca): chasca pero acabará pisando el paso. */
  doomed: boolean;
  /** v1.41 — ya avisó el «frenazo heroico» de esta parada (una vez por frenada). */
  nearDone: boolean;
  /** v1.41 — TEATRO DEL TAXI: parada exacta en el punto pedido hasta releaseTaxi(). */
  stage: { stopAtX: number; stopped: boolean; onStopped: () => void } | null;
}

export interface TrafficDirector {
  /** Avanza vehículos, ruedas y sirenas. dt en segundos. */
  update(dt: number): void;
  /** Solo vistas con calle: idempotente. */
  setVisible(visible: boolean): void;
  /** Vehículos vivos (para QA/E2E). */
  aliveCount(): number;
  /** v1.37 — ¿está DESPEJADO el paso de peatones? true si NINGÚN vehículo ronda la banda
   *  [zMin..zMax] a menos de `margin` metros del punto x (por morro o por cola). Lo consulta
   *  el paseo vecinal antes de cruzar («mirando a ambos lados para que no pasen coches»). */
  crossingClear(x: number, zMin: number, zMax: number, margin: number): boolean;
  /** v1.41 — PEATONES EN CALZADA: lista viviente de puntos (los directores de la calle
   *  la sustituyen cada frame). Los coches FRENAN en el paso de peatones si alguno pisa
   *  la banda; si apareció demasiado cerca, no hay freno que baste → accidente cómico. */
  setCrossers(points: { x: number; z: number }[]): void;
  /** v1.41 — TEATRO DEL TAXI: hace venir UN taxi (si hay rig libre) y lo para exactamente
   *  en stopX del carril cercano al edificio. false si ya hay taxi en la calle. */
  hailTaxi(stopX: number, onStopped: () => void): boolean;
  /** v1.41 — el/los taxi(s) en parada reanudan la marcha. */
  releaseTaxi(): void;
  /** v1.41 — ¿hay rig de taxi libre para un encargo? */
  taxiAvailable(): boolean;
  /** RIG de la ambulancia para el teatro de emergencias (ambulance.ts).
   *  null si el catálogo no trae view.traffic.ambulance. */
  buildAmbulance(): AmbulanceRig | null;
  dispose(): void;
}

/** Ambulancia del teatro: furgón con librea, puertas traseras abatibles,
 *  girofarios que alternan y ruedas dentro de sus arcos de verdad. */
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

export function createTraffic(scene: Scene, world: World, content: Content, daylight?: DaylightFn, onIncident?: (x: number, kind: 'near' | 'hit') => void): TrafficDirector {
  const { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3 } = B();
  const cfg = content.rules.view.traffic;
  if (!cfg.enabled || cfg.vehicles.length === 0 || cfg.lanes.length === 0) {
    return { update() {}, setVisible() {}, aliveCount: () => 0, crossingClear: () => true, setCrossers() {}, hailTaxi: () => false, releaseTaxi() {}, taxiAvailable: () => false, dispose() {}, buildAmbulance: () => null };
  }
  // AMBULANCIA (opcional del catálogo): la librea lee franja/cruz del catálogo.
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

  // ── Texturas a canvas ─────────────────────────────────────────────────────────────
  // Matrículas, rótulos y CALCOMANIAS: el mismo camino que puertas y fachadas (canvas →
  // DynamicTexture, update(true) = convención invertY de la casa).
  const texCache = new Map<string, Texture>();

  const dynTex = (name: string, w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): Texture => {
    const { DynamicTexture } = B();
    const dt = new DynamicTexture(name, { width: w, height: h }, scene, true);
    const c = dt.getContext() as CanvasRenderingContext2D;
    draw(c, w, h);
    dt.update(true); // convención de la casa (invertY) — igual que fachadas y puertas
    return dt as unknown as Texture;
  };

  /** CALCOMANIA: canvas TRANSPARENTE + dibujo (texto, cruz…) recortado con alpha-test.
   *  El quad cuelga 8 mm por delante de la chapa: un vinilo, no un panel. */
  const decalTex = (name: string, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): Texture => {
    const key = `decal:${name}`;
    let t = texCache.get(key);
    if (t) return t;
    t = dynTex(`trafico_decal_${name}`, 512, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      draw(c, w, h);
    });
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

  /** Damero del taxi: franja dama pintada en una caja fina (vinilo de verdad). */
  const checkerTex = (): Texture => {
    const key = 'checker:taxi';
    let t = texCache.get(key);
    if (t) return t;
    t = dynTex('trafico_damero', 256, 32, (c, w, h) => {
      const n = Math.ceil(w / (h / 2));
      for (let i = 0; i < n; i++) {
        c.fillStyle = i % 2 === 0 ? '#26221c' : '#e0b54e';
        c.fillRect(i * (h / 2), 0, h / 2 + 1, h);
      }
    });
    texCache.set(key, t);
    return t;
  };

  // ── Cotas por estilo (compartidas por la geometría, los arcos y las calcomanías) ──
  interface Geo {
    L: number;
    W: number;
    R: number;
    y0: number; // canto inferior de la carrocería
    hullH: number; // altura del bloque principal (hasta la línea de cintura)
    cabinH: number; // altura del habitáculo sobre el cuerpo (berlina)
    cabinL: number;
    boxTop: number; // remate de la caja de carga (reparto)
    cabH: number; // altura de la cabina (reparto)
    roofTop: number;
    wheelX: number[];
  }
  const geoOf = (def: { kind: string; length: number; width: number; height: number; cabin: number; axles?: number }): Geo => {
    const L = def.length;
    const W = def.width;
    const H = def.height;
    const R = Math.min(0.42, Math.max(0.26, H * 0.32));
    // Ejos del catálogo (axles): los camiones llevan 3 (tándem trasero más separado para
    // que los arcos jamás se toquen); berlinas y furgonetas, 2.
    const wheelX =
      (def.axles ?? 2) >= 3 ? [L * 0.35, -L * 0.08, -L * 0.36] : def.kind === 'furgoneta' || def.kind === 'ambulancia' ? [L * 0.34, -L * 0.28] : [L * 0.32, -L * 0.33];
    if (def.kind === 'furgoneta' || def.kind === 'ambulancia') {
      const y0 = R * 0.95;
      const hullH = H - y0 - 0.02;
      return { L, W, R, y0, hullH, cabinH: 0, cabinL: 0, boxTop: y0 + hullH, cabH: 0, roofTop: y0 + hullH, wheelX };
    }
    if (def.kind === 'reparto') {
      const y0 = R * 0.92;
      const cabH = H * 0.78;
      const boxTop = y0 + 0.06 + H * 1.02;
      return { L, W, R, y0, hullH: H * 0.5, cabinH: 0, cabinL: 0, boxTop, cabH, roofTop: boxTop, wheelX };
    }
    if (def.kind === 'bus') {
      const y0 = R * 1.05;
      const hullH = H - 0.12 - y0;
      return { L, W, R, y0, hullH, cabinH: 0, cabinL: 0, boxTop: H - 0.12, cabH: 0, roofTop: H - 0.12, wheelX };
    }
    // Berlina (coche / taxi / patrulla): habitáculo centrado-ligeramente atrás.
    const y0 = R * 0.72;
    const hullH = H * 0.52;
    const cabinL = L * (0.34 + def.cabin * 0.32);
    const cabinH = H * 0.44;
    return { L, W, R, y0, hullH, cabinH, cabinL, boxTop: y0 + hullH, cabH: 0, roofTop: y0 + hullH + cabinH - 0.02, wheelX };
  };

  // Cotas por definición (una sola vez: la geometría y las ruedas comparten la verdad).
  const geos = cfg.vehicles.map((d) => geoOf(d));

  /**
   * ESCOTADURA DE RUEDA: puntos del ARCO (radio 1.32R centrado en el eje) que corta el
   * canto inferior del perfil. El arco cruza y=y0 en dos puntos; se recorre del izquierdo
   * al derecho pasando por la clave — así el fondo del coche queda abierto SOLO sobre cada
   * rueda y la rueda se ve DENTRO, como en un coche de verdad.
   */
  const archArc = (pts: TVector3[], wx: number, R: number, y0: number, steps = 10): void => {
    const Ra = R * 1.32;
    const a = Math.asin(Math.max(-0.92, Math.min(0.92, (y0 - R) / Ra)));
    for (let i = 0; i <= steps; i++) {
      const th = Math.PI - a - ((Math.PI - 2 * a) * i) / steps;
      pts.push(new Vector3(wx + Ra * Math.cos(th), R + Ra * Math.sin(th), 0));
    }
  };

  /** Fondo del perfil (de popa a proa) con los arcos de las ruedas en orden real. */
  const bottomWithArches = (geo: Geo, out: TVector3[], noseX: number): void => {
    const Ra = geo.R * 1.32;
    const halfW = Ra * Math.cos(Math.asin(Math.max(-0.92, Math.min(0.92, (geo.y0 - geo.R) / Ra))));
    const sorted = [...geo.wheelX].sort((p, q) => p - q);
    for (let i = 0; i < sorted.length; i++) {
      const wx = sorted[i]!;
      archArc(out, wx, geo.R, geo.y0);
      // Tramo de canto hasta el siguiente arco (o hasta el morro), si hay cuerpo entre medias.
      const nextLeft = i + 1 < sorted.length ? sorted[i + 1]! - halfW : noseX;
      if (nextLeft > wx + halfW) out.push(new Vector3(nextLeft, geo.y0, 0));
    }
  };

  /** Perfil CERRADO de la carrocería por estilo (CCW visto desde +Z, morro a +X). */
  const profileOf = (kind: string, geo: Geo): TVector3[] => {
    const { L, y0, hullH } = geo;
    const pts: TVector3[] = [new Vector3(-L / 2, y0, 0)];
    if (kind === 'reparto') {
      bottomWithArches(geo, pts, L / 2 - 0.03);
      pts.push(new Vector3(L / 2, y0 + 0.09, 0), new Vector3(L / 2, y0 + geo.cabH * 0.5, 0), new Vector3(L * 0.46, y0 + geo.cabH * 0.55, 0), new Vector3(L * 0.4, y0 + geo.cabH * 0.96, 0), new Vector3(L * 0.3, y0 + geo.cabH, 0), new Vector3(L * 0.2, y0 + geo.cabH, 0), new Vector3(L * 0.185, geo.boxTop, 0), new Vector3(-L / 2 + 0.04, geo.boxTop, 0), new Vector3(-L / 2, geo.boxTop - 0.09, 0));
    } else if (kind === 'bus') {
      bottomWithArches(geo, pts, L / 2 - 0.03);
      pts.push(new Vector3(L / 2, y0 + 0.1, 0), new Vector3(L / 2, geo.roofTop - 0.16, 0), new Vector3(L / 2 - 0.06, geo.roofTop, 0), new Vector3(-L / 2 + 0.06, geo.roofTop, 0), new Vector3(-L / 2, geo.roofTop - 0.16, 0));
    } else if (kind === 'furgoneta' || kind === 'ambulancia') {
      bottomWithArches(geo, pts, L / 2 - 0.03);
      pts.push(new Vector3(L / 2, y0 + 0.08, 0), new Vector3(L / 2, y0 + hullH * 0.42, 0), new Vector3(L * 0.46, y0 + hullH * 0.47, 0), new Vector3(L * 0.385, y0 + hullH * 0.97, 0), new Vector3(L * 0.3, y0 + hullH, 0), new Vector3(-L / 2 + 0.05, y0 + hullH, 0), new Vector3(-L / 2, y0 + hullH - 0.08, 0));
    } else {
      // Berlina: carrocería hasta la línea de cintura (el habitáculo va aparte, de cristal).
      bottomWithArches(geo, pts, L / 2 - 0.02);
      pts.push(new Vector3(L / 2, y0 + 0.07, 0), new Vector3(L / 2, y0 + hullH - 0.12, 0), new Vector3(L * 0.34, y0 + hullH, 0), new Vector3(-L * 0.05 + geo.cabinL / 2 + 0.05, y0 + hullH, 0), new Vector3(-L / 2, y0 + hullH, 0));
    }
    return pts;
  };

  /** Habitáculo de cristal de la berlina (parabrisas y luneta INCLINADOS en la forma). */
  const greenhouseOf = (geo: Geo): TVector3[] => {
    const { L, y0, hullH, cabinH, cabinL } = geo;
    const yB = y0 + hullH;
    const yRf = yB + cabinH - 0.02;
    const cx = -L * 0.05;
    return [
      new Vector3(cx - cabinL / 2, yB - 0.05, 0),
      new Vector3(cx - cabinL * 0.3, yRf, 0),
      new Vector3(cx + cabinL * 0.28, yRf, 0),
      new Vector3(cx + cabinL / 2, yB - 0.05, 0),
    ];
  };

  /** Extrusión sólida de un perfil cerrado a lo ancho del vehículo. */
  const extrudeBody = (name: string, profile: TVector3[], w: number, mat: StandardMaterial): Mesh => {
    const m = MeshBuilder.ExtrudeShape(
      name,
      { shape: profile, path: [new Vector3(0, 0, -w / 2), new Vector3(0, 0, w / 2)], cap: Mesh.CAP_ALL, closeShape: true },
      scene,
    );
    m.material = mat;
    return m;
  };

  /** Rueda completa: neumático + llanta + radios, bajo un cubo que GIRA con la marcha.
   *  v1.34 — el cubo cuelga del NODO del vehículo (antes quedaba huérfano en el origen de
   *  la escena: 52 ruedas apiladas en la esquina izquierda del edificio mientras los coches
   *  circulaban sin ellas — la causa de las «ruedas apiladas» y de los coches sin ruedas). */
  const buildWheel = (kind: string, r: number, x: number, z: number, parent: TransformNode): { hub: TransformNode; r: number } => {
    const hub = new TransformNode(`trafico_${kind}_cubo_x${x.toFixed(2)}_z${z.toFixed(1)}`, scene);
    hub.position.set(x, r, z);
    hub.parent = parent;
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

  /** Calcomanía textual (o dibujada) sobre las dos chapas laterales. */
  const decalQuad = (node: TransformNode, kind: string, part: string, w: number, h: number, x: number, y: number, zOff: number, tex: Texture): void => {
    const m = new StandardMaterial(`trafico_${kind}_${part}_mat`, scene);
    m.diffuseTexture = tex;
    m.useAlphaFromDiffuseTexture = true;
    m.transparencyMode = 2; // ALPHATEST: recorte duro del texto, sin velos
    m.alphaCutOff = 0.4;
    m.specularColor = new Color3(0, 0, 0);
    m.backFaceCulling = true;
    for (const sz of [-1, 1]) {
      const q = MeshBuilder.CreatePlane(`trafico_${kind}_${part}_${sz > 0 ? 'd' : 'i'}`, { width: w, height: h }, scene);
      q.material = m;
      q.rotation.y = sz > 0 ? Math.PI : 0; // los planos miran a −Z: el lado +Z gira
      q.position.set(x, y, sz * (zOff + 0.008));
      q.parent = node;
    }
  };

  /** Construye UNA plantilla por tipo de vehículo (pool: se recolorean al salir). */
  const buildRig = (defIndex: number): VehicleRig => {
    const def = cfg.vehicles[defIndex]!;
    const geo = geos[defIndex]!;
    const node = new TransformNode(`trafico_${def.kind}`, scene);
    node.parent = root;
    const bodyMat = new StandardMaterial(`trafico_${def.kind}_mat`, scene);
    bodyMat.diffuseColor = Color3.FromHexString(def.colors[0]!);
    bodyMat.specularColor = new Color3(0, 0, 0);
    const place = (m: Mesh, x: number, y: number, z = 0): Mesh => {
      m.position.set(x, y, z);
      m.parent = node;
      return m;
    };
    const W = geo.W;
    const L = def.length;
    const { R, y0, hullH } = geo;
    const isSedan = def.kind === 'coche' || def.kind === 'taxi' || def.kind === 'policia';

    // Bajos: chasis oscuro que cierra la vista bajo el cuerpo (nada de ver al otro lado).
    place(box(def.kind, 'bajos', L * 0.94, y0 - 0.02, W * 0.5, chassis), 0, (y0 - 0.02) / 2 + 0.02);

    // ── CUERPO POR EXTRUSIÓN (silueta real con arcos de rueda geométricos) ──
    const body = extrudeBody(`trafico_${def.kind}_cuerpo`, profileOf(def.kind, geo), W, bodyMat);
    place(body, 0, 0);

    // Chasis tras los arcos: desde el lateral se ve rueda → chasis oscuro (no el otro lado).
    const ws = [...geo.wheelX].sort((p, q) => p - q);
    const archTop = R + R * 1.32;
    if (ws.length >= 2) {
      place(box(def.kind, 'chasis', ws[ws.length - 1]! - ws[0]!, archTop - 0.04, W * 0.72, chassis), (ws[0]! + ws[ws.length - 1]!) / 2, 0.04 + (archTop - 0.04) / 2);
    }

    // ── CRISTALES Y DETALLES POR ESTILO ──
    if (isSedan) {
      // Habitáculo de cristal retranqueado: sus tapas SON las ventanas laterales y sus
      // paredes inclinadas el parabrisas y la luneta. Nace DENTRO del cuerpo (yB−0.05):
      // nada coplanar. Tapa de techo en color carrocería, un pelo más ancha (techo metálico).
      const cab = extrudeBody(`trafico_${def.kind}_cabina`, greenhouseOf(geo), W * 0.84, glass);
      place(cab, 0, 0);
      place(box(def.kind, 'techo', geo.cabinL * 0.58, 0.035, W * 0.9, bodyMat), -L * 0.05, geo.roofTop + 0.0175);
    } else if (def.kind === 'furgoneta') {
      // Parabrisas (panel transversal con rake, v1.33) + ventanilla de cabina con grosor.
      const ws = box(def.kind, 'parabrisas', 0.04, hullH * 0.5, W * 0.84, glass);
      ws.rotation.z = -0.3;
      place(ws, L * 0.42, y0 + hullH * 0.78);
      for (const sz of [-1, 1]) {
        place(box(def.kind, `ventanilla_${sz > 0 ? 'd' : 'i'}`, L * 0.17, hullH * 0.32, 0.02, glass), L * 0.22, y0 + hullH * 0.7, sz * (W / 2 + 0.008));
      }
    } else if (def.kind === 'reparto') {
      const ws = box(def.kind, 'parabrisas', 0.04, geo.cabH * 0.42, W * 0.84, glass);
      ws.rotation.z = -0.22;
      place(ws, L * 0.44, y0 + geo.cabH * 0.72);
      for (const sz of [-1, 1]) {
        place(box(def.kind, `ventanilla_${sz > 0 ? 'd' : 'i'}`, L * 0.13, geo.cabH * 0.36, 0.02, glass), L * 0.33, y0 + geo.cabH * 0.66, sz * (W / 2 + 0.008));
      }
    } else {
      // Bus: banda de ventanas corrida (caja de cristal con grosor) + luneta trasera.
      for (const sz of [-1, 1]) {
        place(box(def.kind, `ventanas_${sz > 0 ? 'd' : 'i'}`, L * 0.8, hullH * 0.34, 0.02, glass), -L * 0.03, y0 + hullH * 0.74, sz * (W / 2 + 0.008));
      }
      const ws = box(def.kind, 'parabrisas', 0.04, hullH * 0.42, W * 0.86, glass);
      ws.rotation.z = -0.16;
      place(ws, L / 2 - 0.01, y0 + hullH * 0.78);
      const rw = box(def.kind, 'luneta', 0.04, hullH * 0.3, W * 0.8, glass);
      place(rw, -L / 2 - 0.01, y0 + hullH * 0.8);
      // Climatizador de techo.
      place(box(def.kind, 'ac', L * 0.26, 0.14, W * 0.5, dark), -L * 0.05, geo.roofTop + 0.07);
    }

    // Paragolpes, matrícula.
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

    // Tubo de escape y tiradores 3D (berlina y furgoneta: manijas que salen de la chapa).
    const exhaust = MeshBuilder.CreateCylinder(`trafico_${def.kind}_escape`, { diameter: 0.045, height: 0.16, tessellation: 8 }, scene);
    exhaust.rotation.z = Math.PI / 2;
    exhaust.material = dark;
    place(exhaust, -L / 2 + 0.06, y0 + 0.05, W * 0.2);
    if (isSedan || def.kind === 'furgoneta') {
      const hY = y0 + hullH * (isSedan ? 0.72 : 0.55);
      for (const hx of isSedan ? [-geo.L * 0.02, geo.L * 0.2] : [geo.L * 0.05]) {
        for (const sz of [-1, 1]) {
          place(box(def.kind, 'tirador3d', 0.11, 0.035, 0.05, dark), hx, hY, sz * (W / 2 + 0.018));
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

    // ── ROTULACIONES (calcomanías pequeñas + bandas-caja de verdad) ──
    const yStrip = y0 + hullH * 0.55;
    if (def.kind === 'policia') {
      for (const sz of [-1, 1]) {
        place(box(def.kind, `banda_${sz > 0 ? 'd' : 'i'}`, L * 0.72, 0.13, 0.02, matOf('#286090', 'banda_policia')), -L * 0.02, yStrip, sz * (W / 2 + 0.012));
      }
      decalQuad(node, def.kind, 'rotulacion', 1.2, 0.24, -L * 0.02, yStrip, W / 2 + 0.012, decalTex('policia', (c, w, h) => {
        c.fillStyle = 'rgba(255,255,255,0.95)';
        c.font = `900 84px 'Arial Black', Arial, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(def.sideText || 'POLICÍA', w / 2, h / 2 + 2);
      }));
    }
    if (def.kind === 'taxi') {
      // Franja dama: caja fina con damero a canvas (vinilo con grosor, a la altura del panel).
      for (const sz of [-1, 1]) {
        const strip = box(def.kind, `damero_${sz > 0 ? 'd' : 'i'}`, L * 0.62, 0.09, 0.02, new StandardMaterial(`trafico_taxi_damero_mat`, scene));
        const cmat = strip.material as StandardMaterial;
        cmat.diffuseTexture = checkerTex();
        cmat.specularColor = new Color3(0, 0, 0);
        place(strip, -L * 0.02, y0 + hullH * 0.98, sz * (W / 2 + 0.012));
      }
    }
    if (def.sideText && (def.kind === 'furgoneta' || def.kind === 'reparto' || def.kind === 'bus')) {
      const dy = def.kind === 'reparto' ? y0 + (geo.boxTop - y0) * 0.58 : def.kind === 'bus' ? y0 + hullH * 0.4 : y0 + hullH * 0.6;
      const big = def.kind === 'bus';
      decalQuad(node, def.kind, 'rotulacion', big ? 0.6 : L * 0.46, big ? 0.5 : 0.26, big ? L * 0.28 : -L * 0.14, dy, W / 2, decalTex(`${def.kind}_side`, (c, w, h) => {
        c.fillStyle = big ? 'rgba(255,255,255,0.94)' : 'rgba(30,26,20,0.85)';
        // El texto SIEMPRE cabe: se mide y la fuente se encoge hasta caber (nada recortado).
        let px = big ? 96 : 64;
        c.font = `900 ${px}px 'Arial Black', Arial, sans-serif`;
        const text = def.sideText!;
        while (px > 18 && c.measureText(text).width > w * 0.94) {
          px -= 4;
          c.font = `900 ${px}px 'Arial Black', Arial, sans-serif`;
        }
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(text, w / 2, h / 2 + 2);
      }));
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

    // Ruedas (neumático + llanta + radios, giran con la marcha) DENTRO de su arco:
    // la cara exterior del neumático queda 3 cm por dentro de la chapa.
    const wheels: VehicleRig['wheels'] = [];
    const tireZ = W / 2 - 0.14;
    for (const wx of geo.wheelX) {
      for (const sz of [-1, 1]) {
        wheels.push(buildWheel(def.kind, R, wx, sz * tireZ, node));
      }
    }

    node.setEnabled(false);
    return { root: node, bodyMat, wheels, siren, lights: { head, tail, signs } };
  };

  const rigs = cfg.vehicles.map((_, i) => buildRig(i));
  const active = new Set<Active>();
  let nextSpawn = 1.5;
  let roll = 0;
  let nightOn = false;
  // v1.41 — peatones en calzada (la lista la manda el controlador cada frame con los
  // puntos de los directores de la calle: paseo vecinal, teatro del taxi…).
  let crossers: { x: number; z: number }[] = [];
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
    const laneIndex = Math.floor(hash01('trafico_carril', roll) * cfg.lanes.length) % cfg.lanes.length;
    const lane = cfg.lanes[laneIndex]!;
    const dir = lane.dir >= 0 ? 1 : -1;
    const speed = lane.speedMin + hash01('trafico_velo', roll) * Math.max(0.1, lane.speedMax - lane.speedMin);
    const x = dir > 0 ? cfg.xMin - def.length : cfg.xMax + def.length;
    const hex = def.colors[Math.floor(hash01('trafico_color', roll) * def.colors.length) % def.colors.length]!;
    rig.bodyMat.diffuseColor = Color3.FromHexString(hex);
    rig.root.rotation.y = dir > 0 ? 0 : Math.PI;
    rig.root.setEnabled(visible);
    rig.root.position = new Vector3(x, 0, lane.z);
    active.add({ rig, defIndex, laneIndex, x, speed, cruise: speed, passed: false, phase: hash01('trafico_fase', roll) * 6, hazardT: 0, tailFlash: false, doomed: false, nearDone: false, stage: null });
  };

  /** AMBULANCIA del teatro de emergencias: furgón blanco con librea (franja + cruz +
   *  rotulación del catálogo), puertas traseras abatibles, girofarios alternantes y las
   *  MISMAS carrocerías por extrusión con arcos de rueda de verdad que el resto del tráfico. */
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
    // Bajos + carrocería por extrusión (silueta real con arcos) + chasis tras los arcos.
    place(box('ambulancia', 'bajos', L * 0.94, y0 - 0.02, W * 0.5, chassis), 0, (y0 - 0.02) / 2 + 0.02);
    place(extrudeBody('trafico_ambulancia_cuerpo', profileOf('ambulancia', geo), W, white), 0, 0);
    const wsX = [...geo.wheelX].sort((p, q) => p - q);
    const archTop = R + R * 1.32;
    place(box('ambulancia', 'chasis', wsX[wsX.length - 1]! - wsX[0]!, archTop - 0.04, W * 0.72, chassis), (wsX[0]! + wsX[wsX.length - 1]!) / 2, 0.04 + (archTop - 0.04) / 2);
    // Parabrisas transversal + ventanillas de cabina con grosor.
    const ws = box('ambulancia', 'parabrisas', 0.04, hullH * 0.5, W * 0.84, glass);
    ws.rotation.z = -0.3;
    place(ws, L * 0.42, y0 + hullH * 0.78);
    for (const sz of [-1, 1]) {
      place(box('ambulancia', `ventanilla_${sz > 0 ? 'd' : 'i'}`, L * 0.17, hullH * 0.32, 0.02, glass), L * 0.22, y0 + hullH * 0.7, sz * (W / 2 + 0.008));
    }
    // LIBREA: franja naranja (caja fina de verdad), cruz de vida y rotulación (calcomanías).
    for (const sz of [-1, 1]) {
      place(box('ambulancia', `franja_${sz > 0 ? 'd' : 'i'}`, L * 0.94, hullH * 0.16, 0.02, matOf(acfg.stripe, 'franja_ambulancia')), 0, y0 + hullH * 0.34, sz * (W / 2 + 0.012));
    }
    decalQuad(node, 'ambulancia', 'cruz', 0.62, 0.62, -L * 0.16, y0 + hullH * 0.66, W / 2 + 0.012, decalTex('ambulancia_cruz', (c, w, h) => {
      const r = Math.min(w, h) * 0.36;
      const cx = w / 2;
      const cy = h / 2;
      c.fillStyle = '#f6f7f4';
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = acfg.cross;
      const aw = r * 0.34;
      c.fillRect(cx - aw / 2, cy - r * 0.78, aw, r * 1.56);
      c.fillRect(cx - r * 0.78, cy - aw / 2, r * 1.56, aw);
    }));
    if (a.sideText) {
      decalQuad(node, 'ambulancia', 'rotulacion', 1.5, 0.28, L * 0.18, y0 + hullH * 0.66, W / 2 + 0.012, decalTex('ambulancia_texto', (c, w, h) => {
        c.fillStyle = 'rgba(30,26,20,0.85)';
        c.font = `900 72px 'Arial Black', Arial, sans-serif`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(a.sideText, w / 2, h / 2 + 2);
      }));
    }
    // Ruedas dentro de sus arcos (la verdad geométrica).
    const wheels: { hub: TransformNode; r: number }[] = [];
    const tireZ = W / 2 - 0.14;
    for (const wx of geo.wheelX) {
      for (const sz of [-1, 1]) {
        wheels.push(buildWheel('ambulancia', R, wx, sz * tireZ, node));
      }
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
        const laneZ = cfg.lanes[a.laneIndex]!.z;
        // ── v1.41 — CORTESÍA AL VOLANTE ────────────────────────────────────────────
        // TEATRO DEL TAXI: parada exacta donde lo pide el teatro (se queda hasta releaseTaxi).
        if (a.stage && !a.stage.stopped) {
          const frontX = a.x + dir * (def.length / 2);
          if ((dir > 0 && frontX >= a.stage.stopAtX) || (dir < 0 && frontX <= a.stage.stopAtX)) {
            a.rig.root.position.x = a.stage.stopAtX - dir * (def.length / 2);
            a.x = a.rig.root.position.x;
            a.speed = 0;
            a.stage.stopped = true;
            a.stage.onStopped();
          }
        }
        if (a.stage?.stopped) {
          // Aparcado para el teatro: sin movimiento (las ruedas también descansan).
        } else if (a.hazardT > 0) {
          // SUSTO/ACCIDENTE cómico: el coche se planta con los pilotos parpadeando y, al
          // expirar el TheaterSeconds del catálogo, retoma la marcha con vergüenza.
          a.hazardT -= dt;
          a.speed = 0;
          a.tailFlash = true;
          const blink = Math.floor(a.hazardT * 5) % 2 === 0;
          a.rig.lights.tail.emissiveColor = Color3.FromHexString('#d43a2a').scale(blink ? 1.6 : 0.3);
          if (a.hazardT <= 0) {
            a.tailFlash = false;
            a.doomed = false;
            a.nearDone = false;
            a.speed = Math.min(a.cruise, 2.2);
          }
        } else {
          // ¿Hay alguien cruzando delante (banda del paso de peatones)?
          const brk = cfg.braking;
          let danger = false;
          if (brk.enabled && crossers.length > 0) {
            const bandX0 = cfg.passX - brk.zebraHalfWidth - 0.8;
            const bandX1 = cfg.passX + brk.zebraHalfWidth + 0.8;
            for (const c of crossers) {
              if (c.x > bandX0 && c.x < bandX1 && c.z > laneZ - 2.4 && c.z < laneZ + 2.4) {
                danger = true;
                break;
              }
            }
          }
          // Distancia de cortesía con el vehículo de delante (mismo carril).
          if (!danger && brk.enabled) {
            for (const o of active) {
              if (o === a || o.laneIndex !== a.laneIndex) continue;
              const gap = (o.x - a.x) * dir - (cfg.vehicles[o.defIndex]!.length + def.length) / 2;
              if (gap > 0 && gap < brk.followGap) {
                danger = true;
                break;
              }
            }
          }
          const frontX = a.x + dir * (def.length / 2);
          const stopLine = dir > 0 ? cfg.passX - brk.zebraHalfWidth - 0.8 : cfg.passX + brk.zebraHalfWidth + 0.8;
          const distToLine = (stopLine - frontX) * dir;
          if (danger) {
            const brakeDist = (a.speed * a.speed) / (2 * brk.brakeDecel);
            if (!a.doomed && a.speed > 0.5 && distToLine < Math.max(0.5, Math.min(brakeDist * 1.15, brk.minStopDist))) a.doomed = true;
            if (a.doomed) {
              // La física no perdona: chasca frenando pero el morro acaba pisando el paso.
              a.speed = Math.max(0, a.speed - brk.brakeDecel * 0.55 * dt);
              if (distToLine <= 0.45) {
                a.hazardT = brk.hazardSeconds;
                a.speed = 0;
                playSoundAt('claxon', 0.9);
                onIncident?.(a.x, 'hit');
              }
            } else {
              a.speed = Math.max(0, a.speed - brk.brakeDecel * dt);
              if (a.speed <= 0.02 && !a.nearDone && distToLine < 2.8) {
                a.nearDone = true;
                playSoundAt('frenazo', 0.8);
                onIncident?.(a.x, 'near');
              }
            }
          } else {
            a.doomed = false;
            a.nearDone = false;
            // Reaceleración suave hasta el crucero del carril.
            a.speed = Math.min(a.cruise, a.speed + brk.brakeDecel * 0.5 * dt);
          }
        }
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
        // v1.41 — restaurar los pilotos tras el parpadeo del susto (y con la política nocturna).
        if (a.tailFlash && a.hazardT <= 0) {
          a.tailFlash = false;
          a.rig.lights.tail.emissiveColor = Color3.FromHexString('#d43a2a').scale(night ? 0.85 : 0.18);
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
    /** v1.37 — ¿paso despejado? Un vehículo ocupa el cruce si su carril cae en la banda y
     *  su cuerpo (morro o cola, length/2) está a menos de `margin` del punto x. */
    crossingClear(x: number, zMin: number, zMax: number, margin: number): boolean {
      for (const a of active) {
        const laneZ = cfg.lanes[a.laneIndex]!.z;
        if (laneZ < zMin || laneZ > zMax) continue;
        const half = cfg.vehicles[a.defIndex]!.length / 2;
        if (Math.abs(a.x - x) < half + margin) return false;
      }
      return true;
    },
    setCrossers(points: { x: number; z: number }[]): void {
      crossers = points;
    },
    hailTaxi(stopX: number, onStopped: () => void): boolean {
      const idx = cfg.vehicles.findIndex((d) => d.kind === 'taxi');
      if (idx < 0) return false;
      if ([...active].some((a) => a.defIndex === idx)) return false;
      // Carril CERCANO al edificio (el de mayor z con dir +1): la acera de enfrente.
      let laneIndex = -1;
      for (let i = 0; i < cfg.lanes.length; i++) {
        const l = cfg.lanes[i]!;
        if (l.dir > 0 && (laneIndex < 0 || l.z > cfg.lanes[laneIndex]!.z)) laneIndex = i;
      }
      if (laneIndex < 0) return false;
      const def = cfg.vehicles[idx]!;
      const rig = rigs[idx]!;
      const lane = cfg.lanes[laneIndex]!;
      rig.bodyMat.diffuseColor = Color3.FromHexString(def.colors[0]!);
      rig.root.rotation.y = 0;
      rig.root.setEnabled(visible);
      const startX = cfg.xMin - def.length;
      rig.root.position = new Vector3(startX, 0, lane.z);
      const cruise = lane.speedMin + 1.5;
      active.add({ rig, defIndex: idx, laneIndex, x: startX, speed: cruise, cruise, passed: false, phase: 0, hazardT: 0, tailFlash: false, doomed: false, nearDone: false, stage: { stopAtX: stopX, stopped: false, onStopped } });
      return true;
    },
    releaseTaxi(): void {
      for (const a of active) {
        if (a.stage) {
          a.stage = null;
          a.speed = Math.min(a.cruise, 2.0);
        }
      }
    },
    taxiAvailable(): boolean {
      const idx = cfg.vehicles.findIndex((d) => d.kind === 'taxi');
      return idx >= 0 && ![...active].some((a) => a.defIndex === idx);
    },
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
