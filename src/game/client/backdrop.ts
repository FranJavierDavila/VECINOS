import type { Color3, DynamicTexture, HemisphericLight, DirectionalLight, Mesh, ParticleSystem, Scene, StandardMaterial, Vector3 as Vector3Type } from '@babylonjs/core';
import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { B } from './babylon';
import { playSoundAt } from './audio';
/**
 * FONDO URBANO (v1.21) — capa de presentación pura, todo del catálogo (rules.view.backdrop).
 *
 * · CIELO DINÁMICO: plano lejano con gradiente repintado a cadencia según la HORA DEL DÍA
 *   (keyframes 0..24): amanecer, mediodía, ocaso y noche con estrellas. El clima del sim
 *   elige cielo despejado o nublado (las nubes engordan y se tiñen con la tormenta).
 * · SOL Y LUNA: discos emisivos que recorren su arco; color del mediodía al ocaso.
 * · FACHADAS PARALLAX (v1.21, reescrito): CAPAS DE SELLOS REALES — el catálogo declara un
 *   PNG RGBA de fachada por capa (public/content/backdrop/, blur HORNEADO en el asset:
 *   cuanto más lejos, más desenfocada) y el runtime lo REPTIE a lo largo de la banda
 *   formando un paisaje de edificios "como el nuestro". Planos 3D reales a distintas z →
 *   el parallax sale del barrido de cámara sin un cálculo extra. De noche, la capa se
 *   oscurece SOLO sobre los edificios (composite source-atop) y una retícula de ventanas
 *   se enciende con nightGlow (color windowLitColor del catálogo).
 * · LLUVIA (v1.21): partículas de trazo que caen con viento cuando el clima es rain/storm;
 *   velocidad y densidad del catálogo (look cartoon, caída creíble).
 * · LUZ GLOBAL: los keyframes modularizan la hemisférica y el direccional para que el
 *   edificio viva la misma hora que el cielo.
 * · PROFUNDIDAD REAL (v1.49): las capas de fachadas viven en ALPHATEST y ESCRIBEN depth
 *   (reglas.view.backdrop.layers[].depthWrite) — los edificios MÁS CERCANOS tapan SIEMPRE
 *   a los lejanos por buffer de profundidad (no por orden de mezcla, que dependía de la
 *   cámara). El orden entre transparentes (estrellas, capas legadas, nubes) es determinista
 *   vía alphaIndex: lejos→cerca sin importar dónde esté la cámara.
 * · HUECOS DE CIELO (v1.62): skipChance por capa — fracción de sellos que quedan SIN
 *   pintar («solares»): el cielo asoma entre los bloques del fondo (petición del vecino:
 *   «eliminar alguno de los edificios altos para ver algo más de cielo»). Determinista.
 * · MÁSCARA DE TINTE ALINEADA (v1.62): el destination-in del tinte heredaba el translate
 *   de banda y borraba cuerpos de edificios (la capa cercana conservaba ~12%) — corregido.
 */

interface LayerView {
  plane: Mesh;
  mat: StandardMaterial;
  tex: DynamicTexture;
  /** Carga del sello PNG (capas con `image`): null en capas procedurales. */
  img: HTMLImageElement | null;
  ready: boolean;
  lastNight: number;
  lastWeather: string;
  /** Medidas REALES del canvas de la textura: el motor puede recortarlas
   *  (NullEngine QA limita maxTextureSize a 512 — en producción WebGL2 son 4096×512). */
  realW: number;
  realH: number;
  /** Filas del canvas que ocupa la banda (el resto, transparente). */
  usedH: number;
}

export interface BackdropDirector {
  /** Avanza el cielo/sol/nubes/lluvia y las luces con la hora del sim. dt en segundos.
   *  v1.48 — opts.bolts: rayos visibles (solo cámaras exteriores edificio/fachada); el
   *  FOGONAZO y el trueno valen en toda la escena igualmente. */
  update(dt: number, opts?: { bolts?: boolean }): void;
  /** Luz de día efectiva 0..1 (1 = mediodía pleno): la usan farolas y luces interiores. */
  readonly daylight: number;
  /** v1.61 — ESTADO DEL SOL VISIBLE (el disco del fondo): up = disco en el cielo y
   *  arc = 0..π (0 al alba, π/2 a mediodía, π al ocaso). La sombra del edificio la lee
   *  para alargarse y barrer con el mismo sol que se ve — una sola verdad. */
  sunState(): { up: boolean; arc: number };
  dispose(): void;
}

/** Interpola entre los keyframes por hora (el último y el primero cierran el círculo 0..24). */
function keyframeAt(cfg: Content['rules']['view']['backdrop']['sky'], hour: number): { top: Color3; horizon: Color3; ambient: number; sun: number } {
  const { Color3 } = B();
  const kfs = cfg.keyframes;
  if (kfs.length === 0) {
    return { top: Color3.White(), horizon: Color3.White(), ambient: 1, sun: 1 };
  }
  let i = 0;
  while (i < kfs.length - 1 && kfs[i]!.hour <= hour) i++;
  const a = kfs[i - 1] ?? kfs[kfs.length - 1]!;
  const b = kfs[i % kfs.length]!;
  const span = Math.max(0.001, b.hour - a.hour);
  const t = Math.min(1, Math.max(0, (hour - a.hour) / span));
  const lerp = (ha: string, hb: string) => Color3.Lerp(Color3.FromHexString(ha), Color3.FromHexString(hb), t);
  return {
    top: lerp(a.top, b.top),
    horizon: lerp(a.horizon, b.horizon),
    ambient: a.ambient + (b.ambient - a.ambient) * t,
    sun: a.sun + (b.sun - a.sun) * t,
  };
}

/** Medidas del plano de una capa: 360 m de banda y su altura del catálogo. */
const STRIP_W = 360;

export function createBackdrop(scene: Scene, world: World, content: Content, lights: { hemi: HemisphericLight; dir: DirectionalLight }): BackdropDirector {
  const { Color3, DynamicTexture, MeshBuilder, ParticleSystem, StandardMaterial, Vector3 } = B();
  const cfg = content.rules.view.backdrop;
  if (!cfg.enabled) {
    return { update() {}, daylight: 1, sunState: () => ({ up: false, arc: 0 }), dispose() {} };
  }
  const v = content.rules.view;
  const width = Math.max(...Object.values(world.blocks).map((b) => b.cell.col + b.size.w)) * v.cellW;
  const cx = width / 2;

  // ── CIELO DE DOS BANDAS (v1.21): planos de COLOR PLANO (emissiveColor, la vía probada
  // del sol/luna — cero texturas que re-subir: el canvas iba siempre con un ciclo de retraso
  // respecto al render). La banda superior sigue kf.top y la inferior kf.horizon.
  const horizonY = cfg.sky.horizonY;
  const flat = (name: string, y0: number, y1: number): { mesh: Mesh; mat: StandardMaterial } => {
    const mesh = MeshBuilder.CreatePlane(name, { width: 320, height: y1 - y0, sideOrientation: B().Mesh.DOUBLESIDE }, scene);
    const mat = new StandardMaterial(`${name}_mat`, scene);
    mat.emissiveColor = Color3.White();
    mat.diffuseColor = Color3.Black();
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.position.set(cx, (y0 + y1) / 2, cfg.sky.sunZ + 12);
    return { mesh, mat };
  };
  const skyTop = flat('cielo_alto', horizonY, 109);
  const skyLow = flat('cielo_bajo', -41, horizonY);

  // Estrellas: textura estática pintada UNA vez (subida única → sin lag); el alpha del
  // material sube con la noche. useAlphaFromDiffuseTexture: el alpha del canvas manda
  // (sin esto, las zonas transparentes del canvas se mezclan como NEGRO).
  const starTex = new DynamicTexture('estrellas_tex', { width: 1024, height: 512 }, scene, false);
  starTex.hasAlpha = true;
  {
    const sctx = starTex.getContext() as unknown as CanvasRenderingContext2D;
    sctx.clearRect(0, 0, 1024, 512);
    for (let i = 0; i < cfg.sky.stars; i++) {
      const sx = hash01('estrella', i) * 1024;
      const sy = hash01('estrella_alto', i) * 512 * 0.62;
      const r = 0.7 + hash01('estrella_r', i) * 1.6;
      sctx.globalAlpha = 0.35 + hash01('estrella_a', i) * 0.65;
      sctx.fillStyle = cfg.sky.starColor;
      sctx.beginPath();
      sctx.arc(sx, sy, r, 0, Math.PI * 2);
      sctx.fill();
    }
    sctx.globalAlpha = 1;
    starTex.update(true);
  }
  const starMat = new StandardMaterial('estrellas_mat', scene);
  starMat.diffuseTexture = starTex;
  starMat.emissiveTexture = starTex;
  starMat.useAlphaFromDiffuseTexture = true;
  starMat.disableLighting = true;
  starMat.specularColor = new Color3(0, 0, 0);
  starMat.disableDepthWrite = true;
  starMat.alpha = 0;
  const starsMesh = MeshBuilder.CreatePlane('estrellas', { width: 320, height: 150, sideOrientation: B().Mesh.DOUBLESIDE }, scene);
  starsMesh.material = starMat;
  starsMesh.isPickable = false;
  // v1.49 — lo más lejano del mundo: primera en la cola transparente (alphaIndex), detrás
  // de las capas de fachadas y de las nubes SIEMPRE.
  starsMesh.alphaIndex = 1;
  starsMesh.position.set(cx, 34, cfg.sky.sunZ + 11.5);

  // ── Sol y luna: discos emisivos que recorren el arco del día / de la noche. ──
  const disc = (name: string, color: string, size: number): { mesh: Mesh; mat: StandardMaterial } => {
    const mesh = MeshBuilder.CreateDisc(name, { radius: size, tessellation: 40, sideOrientation: B().Mesh.DOUBLESIDE }, scene);
    const mat = new StandardMaterial(`${name}_mat`, scene);
    mat.emissiveColor = Color3.FromHexString(color);
    mat.diffuseColor = Color3.Black();
    mat.disableLighting = true;
    mesh.material = mat;
    mesh.isPickable = false;
    return { mesh, mat };
  };
  const sun = disc('sol', cfg.sky.sunColorDay, cfg.sky.sunSize);
  const moon = disc('luna', cfg.sky.moonColor, cfg.sky.moonSize);

  // ── Nubes (v1.24): nubecillas cartoon DE DIBUJO — tres sellos distintos (grumos planos
  // con base sombreada) dibujados en canvas y a la deriva. Alpha del catálogo alto: se VEN. ──
  const CLOUD_W = 512;
  const CLOUD_H = 288;
  const paintPuff = (ctx: CanvasRenderingContext2D, px: number, py: number, r: number, flat: boolean): void => {
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    if (flat) {
      // Base aplanada: recorta la mitad inferior con la silueta del propio canvas.
      ctx.arc(px + r * 0.9, py + r * 0.32, r * 0.62, 0, Math.PI * 2);
      ctx.arc(px - r * 0.9, py + r * 0.28, r * 0.58, 0, Math.PI * 2);
    }
    ctx.fill();
  };
  const cloudTexs = [0, 1, 2].map((variant) => {
    const tex = new DynamicTexture(`nube_tex_${variant}`, { width: CLOUD_W, height: CLOUD_H }, scene, false);
    tex.hasAlpha = true;
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, CLOUD_W, CLOUD_H);
    // Silueta blanca: 5-7 grumos solapados, composición distinta por variante.
    ctx.fillStyle = '#ffffff';
    const blobs = 5 + variant;
    for (let i = 0; i < blobs; i++) {
      const px = 90 + (i / Math.max(1, blobs - 1)) * (CLOUD_W - 180) + (hash01(`nubeV${variant}`, i) - 0.5) * 46;
      const py = 150 + (hash01(`nubeY${variant}`, i) - 0.5) * 52;
      const r = 42 + hash01(`nubeR${variant}`, i) * 40;
      paintPuff(ctx, px, py, r, i === Math.floor(blobs / 2));
    }
    // Base sombreada (tono del catálogo, alfa suave) SOLO sobre la silueta.
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(148,158,172,0.28)';
    ctx.beginPath();
    ctx.ellipse(CLOUD_W / 2, CLOUD_H * 0.86, CLOUD_W * 0.42, CLOUD_H * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    tex.update(true);
    return tex;
  });
  const clouds: { mesh: Mesh; speed: number }[] = [];
  for (let i = 0; i < cfg.clouds.count; i++) {
    const w = 13 + hash01('nube_tam', i) * 17;
    const tex = cloudTexs[i % cloudTexs.length]!;
    const mesh = MeshBuilder.CreatePlane(`nube_${i}`, { width: w, height: w * (CLOUD_H / CLOUD_W) }, scene);
    const mat = new StandardMaterial(`nube_${i}_mat`, scene);
    mat.diffuseTexture = tex;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.opacityTexture = tex;
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableDepthWrite = true; // las nubes se mezclan con el cielo, jamás lo tapan
    mesh.material = mat;
    mesh.isPickable = false;
    // v1.49 — lo más cercano del cielo (delante de las capas): última en la cola transparente.
    mesh.alphaIndex = 20;
    const x = cx + (hash01('nube_x', i) - 0.5) * 220;
    const y = cfg.clouds.yMin + hash01('nube_y', i) * (cfg.clouds.yMax - cfg.clouds.yMin);
    mesh.position.set(x, y, cfg.clouds.z);
    clouds.push({ mesh, speed: 0.6 + hash01('nube_v', i) * 0.8 });
  }

  // ── Capas de fachadas: sello PNG real (v1.21) o pintado procedural (fallback). ──
  // Canvas POT 4096×512 (v1.36 — el vecino veía los fondos «como manchones»: a 2048×256
  // cada sello eran ~176 px estirados 6–11× por pantalla; a 4096 con mipmaps la definición
  // DUPLICA y el minificado deja de emborronar). Los sellos se dibujan en las filas
  // inferiores y el plano recorta por UV (vScale = filas usadas / altura real). v1.62:
  // el pintado usa el tamaño REAL del canvas (motores con tope lo recortan sin romperse).
  const CANVAS_W = 4096;
  const CANVAS_H = 512;
  const layers: LayerView[] = cfg.layers.map((l, li) => {
    const tex = new DynamicTexture(`fachada_${li}_tex`, { width: CANVAS_W, height: CANVAS_H }, scene, true);
    // v1.62 — tamaño REAL del canvas: el motor puede limitar las texturas (NullEngine QA
    // fija maxTextureSize=512 y recorta el canvas pedido) — el pintado se adapta a lo que
    // haya de verdad (misma proporción: el plano muestrea UV 0..1, da igual el ancho px).
    const texSize = tex.getSize();
    const realW = texSize.width;
    const realH = texSize.height;
    const usedH = Math.min(realH, Math.max(64, Math.round((realW * l.height) / STRIP_W)));
    // hasAlpha: fuera de los edificios el canvas es transparente (el cielo asoma entre ellos).
    tex.hasAlpha = true;
    tex.vScale = usedH / realH;
    const mat = new StandardMaterial(`fachada_${li}_mat`, scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    // v1.21: el ALPHA del canvas manda (sin esto las zonas transparentes se mezclan como
    // NEGRO con el alpha uniforme — el velo oscuro entre edificios del fondo).
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    // v1.49 — PROFUNDIDAD REAL (petición del vecino: «cuanto más cerca, siempre por delante
    // de los que están más lejos»). Con depthWrite la capa vira a ALPHATEST (recorte binario:
    // los sellos PNG son alfa 0/1, medido <1% intermedio) y ESCRIBE depth: un edificio
    // cercano tapa a los lejanos POR BUFFER DE PROFUNDIDAD — da igual dónde esté la cámara.
    // El cielo/sol/luna siguen asomando por los huecos (alpha del canvas bajo el corte).
    if (l.depthWrite) {
      mat.transparencyMode = 1; // ALPHATEST (1, no 2=ALPHABLEND): profundidad por píxel
      mat.alphaCutOff = l.alphaCutOff ?? 0.4; // 0.4 = el valor del catálogo v1.49
      mat.alpha = 1; // sin mezcla: con alpha<1 la capa se colaría en la cola transparente
      mat.disableDepthWrite = false; // escribe depth → oclusión verdadera entre capas
    } else {
      // Legado v1.21: capas en mezcla sin depth — el orden de pintado manda (alphaIndex).
      mat.alpha = l.alpha;
      mat.disableDepthWrite = true;
    }
    const plane = MeshBuilder.CreatePlane(`fachada_${li}`, { width: STRIP_W, height: l.height, sideOrientation: B().Mesh.DOUBLESIDE }, scene);
    plane.material = mat;
    plane.isPickable = false;
    // Orden DETERMINISTA entre transparentes (legado/mixto): lejos→cerca SIEMPRE (alphaIndex
    // manda sobre la distancia de cámara). Con ALPHATEST lo resuelve el depth y sobra.
    plane.alphaIndex = 10 - li;
    plane.position.set(cx, l.height / 2 - 0.2, l.z);
    // Sello real: se carga el PNG del catálogo (blur ya horneado por distancia).
    let img: HTMLImageElement | null = null;
    if (l.image) {
      img = new Image();
      img.onload = () => {
        lv.ready = true;
      };
      img.src = l.image;
    }
    const lv: LayerView = { plane, mat, tex, img, ready: !img, lastNight: -1, lastWeather: '', realW, realH, usedH };
    return lv;
  });

  /** v1.62 — HUECOS DE CIELO: ¿queda este sello SIN pintar? Fracción skipChance del
   *  catálogo → «solares» entre bloques por donde asoma el cielo (el vecino pidió ver
   *  más cielo eliminando alguno de los edificios altos del fondo). Determinista por
   *  hash: el mismo solar queda vacío en el pintado, la copia de tinte y las ventanas
   *  nocturnas — una sola verdad. ?? 0: contenido legacy sin zod entre medias.
   *  Semilla POR SELLO (no por índice): el hash agrupaba rachas consecutivas que
   *  abrían un solo boquete gigante en mitad de la tira; con `_${k}` los solares se
   *  reparten sin pares largos. */
  const stampSkipped = (li: number, k: number): boolean => {
    const skip = cfg.layers[li]!.skipChance ?? 0;
    return skip > 0 && hash01(`selloSkip${li}_${k}`, 3) < skip;
  };

  /** Pinta una capa al canvas: sellos repetidos (image) o edificios procedurales. */
  const paintLayer = (lv: LayerView, li: number, nightF: number, weather: string): void => {
    const l = cfg.layers[li]!;
    const W = lv.realW;
    const canvasH = lv.realH;
    const H = lv.usedH;
    const offY = canvasH - H;
    const ctx = lv.tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, canvasH);
    ctx.save();
    ctx.translate(0, offY);
    // NIEBLA (v1.22): los bloques del fondo se DEsaturan (perspectiva aérea) y se funden
    // hacia su fogColor — se intuyen sin distraer. El filtro actúa solo al dibujar los
    // sellos (sin tocar el alpha del canvas); el lavado posterior respeta la transparencia.
    if (l.fog > 0.01) {
      const sat = Math.max(5, Math.round((1 - l.fog * 0.85) * 100));
      ctx.filter = `saturate(${sat}%)`;
    }
    if (lv.img && lv.ready) {
      // ── SELLOS: la fachada del catálogo repetida a lo ancho (edificios similares al nuestro). ──
      const aspect = lv.img.naturalWidth / Math.max(1, lv.img.naturalHeight);
      const stampW = l.height * aspect; // ancho del sello en metros (sin deformar)
      const stampPx = (stampW / STRIP_W) * W;
      const n = Math.ceil(W / stampPx) + 1;
      for (let k = 0; k < n; k++) {
        if (stampSkipped(li, k)) continue; // v1.62: solar vacío — asoma el cielo
        const jitter = (hash01(`sello${li}`, k) - 0.5) * stampPx * 0.14;
        const scale = 0.86 + hash01(`selloS${li}`, k) * 0.16;
        const drawH = H * scale;
        const drawW = stampPx * scale;
        const flip = hash01(`selloF${li}`, k) < 0.5;
        const x = k * stampPx + (stampPx - drawW) / 2 + jitter;
        ctx.save();
        if (flip) {
          ctx.translate(x + drawW, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(lv.img, 0, H - drawH, drawW, drawH);
        } else {
          ctx.drawImage(lv.img, x, H - drawH, drawW, drawH);
        }
        ctx.restore();
      }
      // Armonización con la paleta: tinte sutil SOLO sobre los píxeles del sello.
      if (l.tint && l.tint.toLowerCase() !== '#ffffff') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = l.tint;
        ctx.fillRect(0, 0, W, H);
        // destination-in con la copia limpia: recupera la transparencia fuera de los sellos.
        // v1.62 — CORRECCIÓN de un desastre silencioso de v1.21: el drawImage de la máscara
        // heredaba el translate(0, offY) → la máscara quedaba DESPLAZADA offY píxeles hacia
        // abajo y destination-in BORRABA los cuerpos de los edificios (la capa cercana
        // conservaba ~12% y la media ~60% — ese «cielo de más» que veía el vecino era esto).
        // La copia ya lleva su propia disposición: se alinea con el CANVAS (transform a 1).
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(canvasCopyOf(lv, li), 0, 0);
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
      }
      // Noche: oscurecer SOLO los edificios (source-atop respeta la transparencia del cielo).
      if (l.fog > 0.01) {
        // Lavado de niebla hacia fogColor, solo sobre píxeles de edificio (perspectiva aérea).
        ctx.filter = 'none';
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = l.fog * 0.45;
        ctx.fillStyle = l.fogColor;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      if (nightF > 0.02) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(18,24,40,${(nightF * 0.55).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
        // Ventanas encendidas: retícula determinista por sello, brillo del catálogo.
        const lit = Color3.FromHexString(l.windowLitColor);
        const stampWm = l.height * (lv.img.naturalWidth / Math.max(1, lv.img.naturalHeight));
        const stamps = Math.ceil(STRIP_W / stampWm) + 1;
        const rows = Math.max(2, Math.round(l.height / 2.4));
        const cols = Math.max(2, Math.round(stampWm / 2.6));
        ctx.fillStyle = hexOf(lit);
        for (let k = 0; k < stamps; k++) {
          if (stampSkipped(li, k)) continue; // v1.62: sin edificio no hay ventanas encendidas
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const h = hash01(`vw${li}`, (k * rows + r) * cols + c);
              if (h > l.nightGlow) continue;
              const px = ((k + 0.14 + (c + 0.5) / cols) * stampWm) / STRIP_W * W;
              const py = H - (0.1 + (r + 0.5) / rows) * H * 0.84;
              ctx.globalAlpha = 0.35 + nightF * 0.65 * (0.5 + hash01(`vwa${li}`, (k * rows + r) * cols + c) * 0.5);
              ctx.fillRect(px, py, (W / STRIP_W) * 0.34, (H / Math.max(1, l.height)) * 0.4);
            }
          }
        }
        ctx.globalAlpha = 1;
      }
    } else {
      // ── Fallback procedural (v1.20): siluetas con ventanas y galerías. ──
      paintProcedural(lv, li, nightF, ctx, W, H);
      ctx.filter = 'none';
      if (l.fog > 0.01) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = l.fog * 0.45;
        ctx.fillStyle = l.fogColor;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    // V1.28 — LAVADO DE LLUVIA: con el cielo cerrado, la ciudad del fondo se apaga (gris
    // azulado del catálogo sobre los píxeles de edificio; source-atop respeta el alpha).
    const wash = cfg.rain.wash;
    if (wash && (weather === 'rain' || weather === 'storm')) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = wash.alpha;
      ctx.fillStyle = wash.color;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.filter = 'none';
    ctx.restore();
    lv.lastNight = nightF;
    lv.lastWeather = weather;
    lv.tex.update(true);
  };

  /** Copia limpia de los sellos (para el tinte multiply sin perder alpha). */
  const copies = new Map<number, HTMLCanvasElement>();
  function canvasCopyOf(lv: LayerView, li: number): HTMLCanvasElement {
    let c = copies.get(li)!;
    if (!c) {
      c = document.createElement('canvas');
      c.width = lv.realW;
      c.height = lv.realH;
      const cctx = c.getContext('2d')!;
      const H = lv.usedH;
      const offY = lv.realH - H;
      cctx.save();
      cctx.translate(0, offY);
      const aspect = lv.img!.naturalWidth / Math.max(1, lv.img!.naturalHeight);
      const stampW = cfg.layers[li]!.height * aspect;
      const stampPx = (stampW / STRIP_W) * c.width;
      const n = Math.ceil(c.width / stampPx) + 1;
      for (let k = 0; k < n; k++) {
        if (stampSkipped(li, k)) continue; // v1.62: MISMA regla que el pintado (tinte coherente)
        const jitter = (hash01(`sello${li}`, k) - 0.5) * stampPx * 0.14;
        const scale = 0.86 + hash01(`selloS${li}`, k) * 0.16;
        const drawH = H * scale;
        const drawW = stampPx * scale;
        const flip = hash01(`selloF${li}`, k) < 0.5;
        cctx.save();
        if (flip) {
          cctx.translate(k * stampPx + (stampPx - drawW) / 2 + jitter + drawW, 0);
          cctx.scale(-1, 1);
          cctx.drawImage(lv.img!, 0, H - drawH, drawW, drawH);
        } else {
          cctx.drawImage(lv.img!, k * stampPx + (stampPx - drawW) / 2 + jitter, H - drawH, drawW, drawH);
        }
        cctx.restore();
      }
      cctx.restore();
      copies.set(li, c);
    }
    return c;
  }

  /** Fachada procedural (catálogo antiguo sin image): misma rutina verificada de v1.20. */
  function paintProcedural(lv: LayerView, li: number, nightF: number, ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const l = cfg.layers[li]!;
    const tint = Color3.FromHexString(l.tint);
    const winCol = Color3.FromHexString(l.windowColor);
    const litCol = Color3.FromHexString(l.windowLitColor);
    const galCol = Color3.FromHexString(l.galleryColor);
    const shadeOf = (bi: number, k: number): string => {
      const s = 0.82 + hash01(`f${li}b${bi}`, k) * 0.3;
      return hexOf(new Color3(tint.r * s, tint.g * s, tint.b * s));
    };
    const n = l.buildings;
    const slot = W / n;
    for (let bi = 0; bi < n; bi++) {
      if (stampSkipped(li, bi)) continue; // v1.62: hueco de cielo también en el fallback
      const bw = slot * (0.62 + hash01(`f${li}b${bi}`, 1) * 0.34);
      const bx = bi * slot + (slot - bw) / 2;
      const floors = Math.round(l.floors[0] + hash01(`f${li}b${bi}`, 2) * (l.floors[1] - l.floors[0]));
      const floorH = (H * 0.86) / Math.max(1, l.floors[1]);
      const bh = floors * floorH;
      const by = H - bh;
      ctx.fillStyle = shadeOf(bi, 3);
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = hexOf(new Color3(tint.r * 0.6, tint.g * 0.6, tint.b * 0.6));
      ctx.fillRect(bx - 4, by - 10, bw + 8, 10);
      if (hash01(`f${li}b${bi}`, 4) < l.galleryChance) {
        const gw = bw * (0.16 + hash01(`f${li}b${bi}`, 5) * 0.12);
        const gx = hash01(`f${li}b${bi}`, 6) < 0.5 ? bx + bw * 0.1 : bx + bw - gw - bw * 0.1;
        ctx.fillStyle = hexOf(galCol);
        ctx.globalAlpha = 0.55;
        ctx.fillRect(gx, by + floorH * 0.3, gw, bh - floorH * 0.3);
        ctx.globalAlpha = 1;
      }
      const cols = Math.max(2, Math.floor(bw / 42));
      const cw = bw / cols;
      for (let f = 0; f < floors; f++) {
        for (let c = 0; c < cols; c++) {
          if (hash01(`f${li}b${bi}w${f}_${c}`, 7) > l.windowChance) continue;
          const wx = bx + c * cw + cw * 0.22;
          const wy = by + f * floorH + floorH * 0.28;
          const ww = cw * 0.56;
          const wh = floorH * 0.42;
          const lit = nightF > 0.05 && hash01(`f${li}b${bi}l${f}_${c}`, 8) < l.nightGlow * nightF + 0.02;
          ctx.fillStyle = lit ? hexOf(litCol) : hexOf(winCol);
          ctx.globalAlpha = lit ? 0.4 + nightF * 0.6 : 0.8;
          ctx.fillRect(wx, wy, ww, wh);
          ctx.globalAlpha = 1;
        }
      }
      ctx.fillStyle = hexOf(new Color3(tint.r * 0.55, tint.g * 0.55, tint.b * 0.55));
      ctx.fillRect(bx, H - floorH * 0.9, bw, floorH * 0.9);
      if (hash01(`f${li}b${bi}s`, 9) < 0.5) {
        ctx.fillStyle = hexOf(litCol);
        ctx.globalAlpha = 0.5;
        ctx.fillRect(bx + bw * 0.1, H - floorH * 0.9, bw * 0.8, floorH * 0.16);
        ctx.globalAlpha = 1;
      }
    }
    void lv;
  }

  // ── LLUVIA (v1.21): partículas de trazo; velocidad/viento/densidad del catálogo. ──
  const rain = new ParticleSystem('lluvia', Math.max(1, cfg.rain.stormCount * 2), scene);
  {
    const rainTex = new DynamicTexture('lluvia_tex', { width: 16, height: 96 }, scene, false);
    rainTex.hasAlpha = true;
    const rctx = rainTex.getContext() as unknown as CanvasRenderingContext2D;
    const grad = rctx.createLinearGradient(0, 0, 0, 96);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0.15)');
    rctx.clearRect(0, 0, 16, 96);
    rctx.fillStyle = grad;
    rctx.fillRect(5, 0, 6, 96);
    rainTex.update(true);
    rain.particleTexture = rainTex;
    rain.emitter = new Vector3(cx, 20, -2);
    rain.minEmitBox = new Vector3(-95, -20, -22);
    rain.maxEmitBox = new Vector3(95, 18, 16);
    // Física calibrada con la integración de Babylon (velocity = dir·power·updateSpeed·60fps):
    // updateSpeed = fallSpeed/60 con power ≈ 1 → caída EXACTA a fallSpeed m/s.
    rain.updateSpeed = cfg.rain.fallSpeed / 60;
    rain.minEmitPower = 0.92;
    rain.maxEmitPower = 1.08;
    rain.direction1 = new Vector3(cfg.rain.wind / cfg.rain.fallSpeed - 0.03, -1, 0.015);
    rain.direction2 = new Vector3(cfg.rain.wind / cfg.rain.fallSpeed + 0.03, -1, -0.015);
    const boxH = 38;
    rain.minLifeTime = (boxH / cfg.rain.fallSpeed) * 0.9;
    rain.maxLifeTime = (boxH / cfg.rain.fallSpeed) * 1.2;
    rain.minSize = 1;
    rain.maxSize = 1;
    rain.minScaleX = cfg.rain.width;
    rain.maxScaleX = cfg.rain.width * 1.5;
    rain.minScaleY = cfg.rain.length;
    rain.maxScaleY = cfg.rain.length * 1.35;
    const col = Color3.FromHexString(cfg.rain.color);
    rain.color1 = new (B().Color4)(col.r, col.g, col.b, cfg.rain.alpha);
    rain.color2 = new (B().Color4)(Math.min(1, col.r + 0.08), Math.min(1, col.g + 0.08), Math.min(1, col.b + 0.08), cfg.rain.alpha * 0.8);
    rain.colorDead = new (B().Color4)(col.r, col.g, col.b, 0);
    rain.emitRate = 0; // sin lluvia: nada nace (las gotas vivas caen y mueren solas)
    rain.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    rain.minAngularSpeed = 0;
    rain.maxAngularSpeed = 0;
    rain.start();
  }
  let lastRainState: string = world.weather.state;

  // ── TORMENTA (v1.48): fogonazos + RAYOS desde las nubes + trueno con retardo. ──
  //  · El FOGONAZO sube la hemisférica y el sol un instante (toda la escena reluce) y
  //    blanquea el cielo; el RAYO (solo cámaras exteriores) es una línea dentada que baja
  //    de una nube al suelo con parpadeo; ~2 s después llega el TRUENO (catálogo sounds).
  const stormCfg = cfg.storm;
  const bolts: Mesh[] = [];
  const boltMats: StandardMaterial[] = [];
  if (stormCfg) {
    const boltMatProto = (): StandardMaterial => {
      const m = new StandardMaterial('rayo_mat', scene);
      m.emissiveColor = new Color3(1, 1, 1);
      m.disableLighting = true;
      m.alpha = 0;
      return m;
    };
    for (let bi = 0; bi < 3; bi++) {
      const pts: Vector3Type[] = [];
      let px = 0;
      const segs = 7;
      for (let sgi = 0; sgi <= segs; sgi++) {
        const t = sgi / segs;
        const y = stormCfg.topY + (stormCfg.groundY - stormCfg.topY) * t;
        px += (hash01(`rayo${bi}_${sgi}`, 61) - 0.5) * 3.4;
        pts.push(new Vector3(px, y, cfg.clouds.z - 3));
      }
      // Rama secundaria corta (los rayos de cómic se ramifican).
      const branch = [pts[3]!, pts[4]!].map((p, i) => new Vector3(p.x + 1.4 + i * 1.8, p.y - 3.5 - i * 3.2, p.z));
      const mesh = MeshBuilder.CreateLineSystem(`rayo_${bi}`, { lines: [pts, branch] }, scene);
      mesh.isPickable = false;
      mesh.setEnabled(false);
      const bm = boltMatProto();
      mesh.material = bm;
      mesh.alphaIndex = 3; // sobre las nubes, bajo nada crítico
      bolts.push(mesh);
      boltMats.push(bm);
    }
  }
  let flashT = 0; // 1 = fogonazo recién caído; decae con flashDecay
  let boltTimer = 3; // cuenta atrás para el próximo rayo (solo con storm)
  let boltSlot = 0;

  let daylight = 1;
  // v1.61 — último estado del sol visible (lo escribe update, lo lee la sombra del edificio).
  let sunVisible = false;
  let sunArc = Math.PI / 2;

  return {
    get daylight(): number {
      return daylight;
    },
    sunState() {
      return { up: sunVisible, arc: sunArc };
    },
    update(dt: number, opts?: { bolts?: boolean }) {
      const hour = (world.clock.minute / 60) % 24;
      const kf = keyframeAt(cfg.sky, hour);
      // V1.28 — DÍA DE LLUVIA = CIELO CERRADO (petición del vecino): con rain/storm el cielo
      // se funde hacia el velado del catálogo (overcast), el sol y la luna se retiran y las
      // nubes ENGORDAN (stormScale) hasta cerrar el panel.
      const oc = cfg.sky.overcast;
      const ocF = oc ? (world.weather.state === 'storm' ? oc.storm : world.weather.state === 'rain' ? oc.rain : 0) : 0;
      // Luz global: los keyframes MODULAN la base del catálogo (ambient/sun de view).
      const dim = cfg.sky.weatherDim[world.weather.state] ?? 1;
      daylight = Math.min(1, Math.max(0, kf.sun * dim));
      lights.hemi.intensity = v.ambient.intensity * kf.ambient;
      lights.dir.intensity = v.sun.intensity * kf.sun * dim;
      // El sol de la escena viaja: al alba entra desde -X, al ocaso se va por +X.
      const sunAngle = ((hour - 6) / 14) * Math.PI; // 6:00 → 20:00
      const sunUp = hour >= 5.5 && hour <= 20.5 && kf.sun > 0.02 && ocF < 0.5; // bajo nubes cerradas no hay disco
      sun.mesh.setEnabled(sunUp);
      sunVisible = sunUp; // v1.61 — el estado que lee la sombra del edificio
      if (sunUp) {
        const arc = Math.min(Math.PI, Math.max(0, sunAngle));
        sunArc = arc;
        sun.mesh.position.set(cx - Math.cos(arc) * 70, 3 + Math.sin(arc) * cfg.sky.sunArcHeight, cfg.sky.sunZ);
        const low = 1 - Math.min(1, Math.sin(arc) / 0.45);
        sun.mat.emissiveColor = Color3.Lerp(Color3.FromHexString(cfg.sky.sunColorDay), Color3.FromHexString(cfg.sky.sunColorLow), low);
        sun.mesh.scaling.setAll(0.85 + low * 0.5); // más grande al ras del horizonte
      }
      // Luna: relevo nocturno (20:00 → 06:00) — también se esconde con el cielo cerrado.
      const nightHour = hour >= 20 ? hour - 20 : hour + 4;
      const moonUp = (hour >= 20.5 || hour <= 5.5) && ocF < 0.5;
      moon.mesh.setEnabled(moonUp);
      if (moonUp) {
        const arc = Math.min(Math.PI, Math.max(0, (nightHour / 10) * Math.PI));
        moon.mesh.position.set(cx - Math.cos(arc) * 70, 6 + Math.sin(arc) * cfg.sky.sunArcHeight * 0.8, cfg.sky.sunZ - 2);
      }
      // Nubes a la deriva + alpha según el clima (despejado/nublado del catálogo).
      const stormy = world.weather.state === 'storm' || world.weather.state === 'rain';
      const cloudy = world.weather.state !== 'sunny';
      const cloudAlpha = cloudy ? Math.min(1, cfg.clouds.alphaCloudy + ocF * 0.4) : cfg.clouds.alphaClear;
      const cloudCol = Color3.FromHexString(stormy ? cfg.clouds.stormColor : cfg.clouds.color);
      const swell = 1 + ((cfg.clouds.stormScale ?? 1) - 1) * ocF; // engordan con el chaparrón
      for (const c of clouds) {
        c.mesh.position.x += c.speed * cfg.clouds.speed * dt;
        if (c.mesh.position.x > cx + 120) c.mesh.position.x = cx - 120;
        (c.mesh.material as StandardMaterial).alpha = cloudAlpha;
        (c.mesh.material as StandardMaterial).emissiveColor = cloudCol;
        c.mesh.scaling.setAll(swell);
      }
      // LLUVIA: densidad según el clima (rain vs storm); con cielo seco, emisión a cero.
      // Estado estacionario: vivos ≈ emitRate × vida → emitRate = count × velocidad / altura.
      const wantRain = world.weather.state === 'rain' || world.weather.state === 'storm';
      if (lastRainState !== world.weather.state) {
        lastRainState = world.weather.state;
        const count = world.weather.state === 'storm' ? cfg.rain.stormCount : cfg.rain.count;
        rain.emitRate = wantRain ? (count * cfg.rain.fallSpeed) / 38 : 0;
      }
      // CIELO de dos bandas: color directo por frame (cero texturas, cero lag) + estrellas
      // que asoman con la noche (suben su alpha con la oscuridad). Con lluvia, el velado
      // del catálogo tiñe ambas bandas (cielo cerrado).
      const nightF = Math.max(0, Math.min(1, (0.75 - Math.min(kf.ambient, 1)) / 0.45));
      if (ocF > 0.001 && oc) {
        const ocTop = Color3.FromHexString(oc.top);
        const ocHor = Color3.FromHexString(oc.horizon);
        Color3.LerpToRef(kf.top, ocTop, ocF, skyTop.mat.emissiveColor);
        Color3.LerpToRef(kf.horizon, ocHor, ocF, skyLow.mat.emissiveColor);
      } else {
        skyTop.mat.emissiveColor.copyFrom(kf.top);
        skyLow.mat.emissiveColor.copyFrom(kf.horizon);
      }
      starMat.alpha = nightF * (1 - ocF); // con el cielo cerrado ni las estrellas asoman
      // ── v1.48 — TORMENTA: cuenta atrás del próximo fogonazo/rayo; el flash decays y
      // mientras vive EMPUJA la luz global (toda la escena) y blanquea el cielo un resto.
      if (stormCfg) {
        const isStorm = world.weather.state === 'storm';
        boltTimer -= dt;
        if (isStorm && boltTimer <= 0) {
          const [mn, mx] = stormCfg.flashEverySecs;
          boltTimer = mn + hash01('rayo_t', Math.floor(world.clock.minute * 60 + world.clock.day * 1440) + Math.round(boltTimer * 7)) * Math.max(0.001, mx - mn);
          flashT = 1;
          boltSlot = (boltSlot + 1) % bolts.length;
          // Rayo en otro sitio de la ciudad + TRUENO con retardo (catálogo).
          const bx = stormCfg.boltXRange[0] + hash01('rayo_x', Math.round(world.clock.minute * 3.7)) * (stormCfg.boltXRange[1] - stormCfg.boltXRange[0]);
          bolts[boltSlot]!.position.x = bx;
          const gain = stormCfg.thunderGain * (0.7 + hash01('rayo_g', Math.round(world.clock.minute * 1.3)) * 0.3);
          const delayMs = Math.round(stormCfg.thunderDelaySecs * 1000);
          const timer = setTimeout(() => playSoundAt('trueno', gain), delayMs);
          if (typeof timer.unref === 'function') timer.unref(); // no retener el proceso en QA
        }
        if (flashT > 0) {
          flashT = Math.max(0, flashT - dt / Math.max(0.2, stormCfg.flashDecay));
          const flash = Math.pow(flashT, 1.35) * (0.72 + 0.28 * Math.sin(flashT * 47));
          if (flash > 0.003) {
            lights.hemi.intensity += flash * 2.6;
            lights.dir.intensity += flash * 1.7;
            const white = Color3.White();
            skyTop.mat.emissiveColor = Color3.Lerp(skyTop.mat.emissiveColor, white, Math.min(0.85, flash));
            skyLow.mat.emissiveColor = Color3.Lerp(skyLow.mat.emissiveColor, white, Math.min(0.85, flash));
          }
          // El rayo solo se dibuja en cámaras exteriores; parpadea mientras el flash vive.
          const showBolts = opts?.bolts === true && flashT > 0.42;
          for (let bi = 0; bi < bolts.length; bi++) {
            const bm = boltMats[bi]!;
            if (showBolts && bi === boltSlot) {
              bolts[bi]!.setEnabled(true);
              bm.alpha = Math.min(1, flashT * 1.6) * (0.55 + 0.45 * Math.sin(flashT * 60));
            } else {
              bolts[bi]!.setEnabled(false);
              bm.alpha = 0;
            }
          }
        } else {
          for (const bolt of bolts) bolt.setEnabled(false);
        }
      }
      // Capas: repintan cuando cambia el nightF (cubo de 0.09) o el clima — no cada frame.
      for (let li = 0; li < layers.length; li++) {
        const lv = layers[li]!;
        if (lv.ready && (Math.abs(nightF - lv.lastNight) > 0.09 || lv.lastWeather !== world.weather.state || lv.lastNight < 0)) {
          paintLayer(lv, li, Math.round(nightF / 0.09) * 0.09, world.weather.state);
        }
      }
    },
    dispose() {
      skyTop.mesh.dispose(false, true);
      skyLow.mesh.dispose(false, true);
      starsMesh.dispose(false, true);
      starTex.dispose();
      sun.mesh.dispose(false, true);
      moon.mesh.dispose(false, true);
      for (const c of clouds) c.mesh.dispose(false, true);
      for (const t of cloudTexs) t.dispose();
      for (const lv of layers) lv.plane.dispose(false, true);
      for (const bolt of bolts) bolt.dispose(false, true);
      rain.stop();
      rain.dispose();
    },
  };
}

/** Color3 → #rrggbb (helper local del canvas; los helpers del catálogo no saben de canvas). */
function hexOf(c: Color3): string {
  return `#${[c.r, c.g, c.b].map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('')}`;
}
