import type { Color3, DynamicTexture, HemisphericLight, DirectionalLight, Mesh, Scene, StandardMaterial } from '@babylonjs/core';
import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { B } from './babylon';
/**
 * FONDO URBANO (v1.20) — capa de presentación pura, todo del catálogo (rules.view.backdrop).
 *
 * · CIELO DINÁMICO: un plano lejano con textura de gradiente repintada a cadencia según la
 *   HORA DEL DÍA (keyframes 0..24 del catálogo): amanecer, mediodía, ocaso y noche con
 *   estrellas. El clima del sim elige cielo despejado o nublado.
 * · SOL Y LUNA: discos que recorren un arco según la hora (el sol evoluciona hasta la noche,
 *   la luna toma el relevo); su color pasa del amarillo del mediodía al naranja del ocaso.
 * · NUBES: planos blandos a la deriva; densidad/tono según weather.state (sunny → claros).
 * · FACHADAS PARALLAX: capas 2D (texturas canvas con ventanas y galerías, "edificios como
 *   el nuestro") colocadas a DISTINTAS z tras el edificio: planos 3D reales → el barrido
 *   de cámara produce el parallax sin un solo cálculo extra.
 * · LUZ GLOBAL: los keyframes modularizan la hemisférica y el direccional (el sol del
 *   propio catálogo) para que el edificio vive la misma hora que el cielo.
 */

interface LayerView {
  plane: Mesh;
  mat: StandardMaterial;
  tex: DynamicTexture;
}

export interface BackdropDirector {
  /** Avanza el cielo/sol/nubes y las luces con la hora del sim. dt en segundos. */
  update(dt: number): void;
  /** Luz de día efectiva 0..1 (1 = mediodía pleno): la usa el exterior para las farolas. */
  readonly daylight: number;
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

export function createBackdrop(scene: Scene, world: World, content: Content, lights: { hemi: HemisphericLight; dir: DirectionalLight }): BackdropDirector {
  const { Color3, DynamicTexture, MeshBuilder, StandardMaterial } = B();
  const cfg = content.rules.view.backdrop;
  if (!cfg.enabled) {
    return { update() {}, daylight: 1, dispose() {} };
  }
  const v = content.rules.view;
  const width = Math.max(...Object.values(world.blocks).map((b) => b.cell.col + b.size.w)) * v.cellW;
  const cx = width / 2;

  // ── Plano de cielo: gradiente top→horizonte con estrellas; se repinta a cadencia. ──
  const SKY_W = 2048;
  const SKY_H = 1024;
  const sky = MeshBuilder.CreatePlane('cielo', { width: 320, height: 150, sideOrientation: B().Mesh.DOUBLESIDE }, scene);
  const skyMat = new StandardMaterial('cielo_mat', scene);
  const skyTex = new DynamicTexture('cielo_tex', { width: SKY_W, height: SKY_H }, scene, true);
  skyTex.hasAlpha = false;
  skyMat.diffuseTexture = skyTex;
  skyMat.emissiveTexture = skyTex;
  skyMat.disableLighting = true;
  skyMat.specularColor = new Color3(0, 0, 0);
  sky.material = skyMat;
  sky.isPickable = false;
  sky.position.set(cx, 34, cfg.sky.sunZ + 12);

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

  // ── Nubes: textura blanda compartida; planos a la deriva con alpha según el clima. ──
  const CLOUD_W = 512;
  const CLOUD_H = 256;
  const cloudTex = new DynamicTexture('nube_tex', { width: CLOUD_W, height: CLOUD_H }, scene, true);
  cloudTex.hasAlpha = true;
  {
    const ctx = cloudTex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, CLOUD_W, CLOUD_H);
    for (let i = 0; i < 26; i++) {
      const px = 60 + hash01('nube', i * 7) * (CLOUD_W - 120);
      const py = 70 + hash01('nube', i * 13) * (CLOUD_H - 130);
      const r = 26 + hash01('nube', i * 29) * 52;
      const g = ctx.createRadialGradient(px, py, 2, px, py, r);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    cloudTex.update(true);
  }
  const clouds: { mesh: Mesh; speed: number }[] = [];
  for (let i = 0; i < cfg.clouds.count; i++) {
    const w = 16 + hash01('nube_tam', i) * 22;
    const mesh = MeshBuilder.CreatePlane(`nube_${i}`, { width: w, height: w * (CLOUD_H / CLOUD_W) * 0.7, sideOrientation: B().Mesh.DOUBLESIDE }, scene);
    const mat = new StandardMaterial(`nube_${i}_mat`, scene);
    mat.diffuseTexture = cloudTex;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.opacityTexture = cloudTex;
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableDepthWrite = true; // las nubes se mezclan con el cielo, jamás lo tapan
    mesh.material = mat;
    mesh.isPickable = false;
    const x = cx + (hash01('nube_x', i) - 0.5) * 220;
    const y = cfg.clouds.yMin + hash01('nube_y', i) * (cfg.clouds.yMax - cfg.clouds.yMin);
    mesh.position.set(x, y, cfg.clouds.z);
    mesh.rotation.y = Math.PI; // la cara visible hacia la cámara (que mira +Z desde -Z)
    clouds.push({ mesh, speed: 0.6 + hash01('nube_v', i) * 0.8 });
  }

  // ── Capas de fachadas: textura canvas por capa (edificios con ventanas y galerías). ──
  const layers: LayerView[] = cfg.layers.map((l, li) => {
    const TEX_W = 2048;
    const TEX_H = 1024;
    const tex = new DynamicTexture(`fachada_${li}_tex`, { width: TEX_W, height: TEX_H }, scene, true);
    // hasAlpha: el canvas tiene el cielo RECORTE (transparente fuera de los edificios); sin
    // esto, las zonas limpias se mezclan como NEGRO y oscurecen el cielo tras el edificio.
    tex.hasAlpha = true;
    const mat = new StandardMaterial(`fachada_${li}_mat`, scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.alpha = l.alpha;
    // Sin escritura de depth: las capas se MEZCLAN (nunca ocultan el cielo/sol/luna que
    // están detrás — el test de depth sigue activo, así el edificio no se ve afectado).
    mat.disableDepthWrite = true;
    const plane = MeshBuilder.CreatePlane(`fachada_${li}`, { width: 360, height: l.height, sideOrientation: B().Mesh.DOUBLESIDE }, scene);
    plane.material = mat;
    plane.isPickable = false;
    plane.position.set(cx, l.height / 2 - 0.2, l.z);
    return { plane, mat, tex };
  });

  /** Pinta la fachada de una capa (canvas): siluetas de edificios con ventanas/galerías. */
  const paintLayer = (lv: LayerView, li: number, nightF: number): void => {
    const l = cfg.layers[li]!;
    const ctx = lv.tex.getContext() as unknown as CanvasRenderingContext2D;
    const W = 2048;
    const H = 1024;
    const tint = Color3.FromHexString(l.tint);
    const winCol = Color3.FromHexString(l.windowColor);
    const litCol = Color3.FromHexString(l.windowLitColor);
    const galCol = Color3.FromHexString(l.galleryColor);
    // Cuerpo: variación del tinte por hash (mismo idioma que el edificio principal).
    const shadeOf = (bi: number, k: number): string => {
      const s = 0.82 + hash01(`f${li}b${bi}`, k) * 0.3;
      return hexOf(new Color3(tint.r * s, tint.g * s, tint.b * s));
    };
    ctx.clearRect(0, 0, W, H);
    const n = l.buildings;
    const slot = W / n;
    for (let bi = 0; bi < n; bi++) {
      const bw = slot * (0.62 + hash01(`f${li}b${bi}`, 1) * 0.34);
      const bx = bi * slot + (slot - bw) / 2;
      const floors = Math.round(l.floors[0] + hash01(`f${li}b${bi}`, 2) * (l.floors[1] - l.floors[0]));
      const floorH = (H * 0.86) / Math.max(1, l.floors[1]);
      const bh = floors * floorH;
      const by = H - bh;
      ctx.fillStyle = shadeOf(bi, 3);
      ctx.fillRect(bx, by, bw, bh);
      // Cornisa.
      ctx.fillStyle = hexOf(new Color3(tint.r * 0.6, tint.g * 0.6, tint.b * 0.6));
      ctx.fillRect(bx - 4, by - 10, bw + 8, 10);
      // Galerías: franja vertical acristalizada (edificios "como el nuestro").
      if (hash01(`f${li}b${bi}`, 4) < l.galleryChance) {
        const gw = bw * (0.16 + hash01(`f${li}b${bi}`, 5) * 0.12);
        const gx = hash01(`f${li}b${bi}`, 6) < 0.5 ? bx + bw * 0.1 : bx + bw - gw - bw * 0.1;
        ctx.fillStyle = hexOf(galCol);
        ctx.globalAlpha = 0.55;
        ctx.fillRect(gx, by + floorH * 0.3, gw, bh - floorH * 0.3);
        ctx.globalAlpha = 1;
      }
      // Ventanas: retícula con huecos (windowChance); de noche algunas lucen (nightGlow).
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
      // Bajo comercial: banda oscura con toldos cálidos.
      ctx.fillStyle = hexOf(new Color3(tint.r * 0.55, tint.g * 0.55, tint.b * 0.55));
      ctx.fillRect(bx, H - floorH * 0.9, bw, floorH * 0.9);
      if (hash01(`f${li}b${bi}s`, 9) < 0.5) {
        ctx.fillStyle = hexOf(litCol);
        ctx.globalAlpha = 0.5;
        ctx.fillRect(bx + bw * 0.1, H - floorH * 0.9, bw * 0.8, floorH * 0.16);
        ctx.globalAlpha = 1;
      }
    }
    lv.tex.update(true);
  };

  let redrawAcc = 999;
  let lastWeather = world.weather.state;
  let daylight = 1;

  return {
    get daylight(): number {
      return daylight;
    },
    update(dt: number) {
      const hour = (world.clock.minute / 60) % 24;
      const kf = keyframeAt(cfg.sky, hour);
      // Luz global: los keyframes MODULAN la base del catálogo (ambient/sun de view).
      const dim = cfg.sky.weatherDim[world.weather.state] ?? 1;
      daylight = Math.min(1, Math.max(0, kf.sun * dim));
      lights.hemi.intensity = v.ambient.intensity * kf.ambient;
      lights.dir.intensity = v.sun.intensity * kf.sun * dim;
      // El sol de la escena viaja: al alba entra desde -X, al ocaso se va por +X.
      const sunAngle = ((hour - 6) / 14) * Math.PI; // 6:00 → 20:00
      const sunUp = hour >= 5.5 && hour <= 20.5 && kf.sun > 0.02;
      sun.mesh.setEnabled(sunUp);
      if (sunUp) {
        const arc = Math.min(Math.PI, Math.max(0, sunAngle));
        sun.mesh.position.set(cx - Math.cos(arc) * 70, 3 + Math.sin(arc) * cfg.sky.sunArcHeight, cfg.sky.sunZ);
        const low = 1 - Math.min(1, Math.sin(arc) / 0.45);
        sun.mat.emissiveColor = Color3.Lerp(Color3.FromHexString(cfg.sky.sunColorDay), Color3.FromHexString(cfg.sky.sunColorLow), low);
        sun.mesh.scaling.setAll(0.85 + low * 0.5); // más grande al ras del horizonte
      }
      // Luna: relevo nocturno (20:00 → 06:00).
      const nightHour = hour >= 20 ? hour - 20 : hour + 4;
      const moonUp = hour >= 20.5 || hour <= 5.5;
      moon.mesh.setEnabled(moonUp);
      if (moonUp) {
        const arc = Math.min(Math.PI, Math.max(0, (nightHour / 10) * Math.PI));
        moon.mesh.position.set(cx - Math.cos(arc) * 70, 6 + Math.sin(arc) * cfg.sky.sunArcHeight * 0.8, cfg.sky.sunZ - 2);
      }
      // Nubes a la deriva + alpha según el clima (despejado/nublado del catálogo).
      const stormy = world.weather.state === 'storm' || world.weather.state === 'rain';
      const cloudy = world.weather.state !== 'sunny';
      const cloudAlpha = cloudy ? cfg.clouds.alphaCloudy : cfg.clouds.alphaClear;
      const cloudCol = Color3.FromHexString(stormy ? cfg.clouds.stormColor : cfg.clouds.color);
      for (const c of clouds) {
        c.mesh.position.x += c.speed * cfg.clouds.speed * dt;
        if (c.mesh.position.x > cx + 120) c.mesh.position.x = cx - 120;
        (c.mesh.material as StandardMaterial).alpha = cloudAlpha;
        (c.mesh.material as StandardMaterial).emissiveColor = cloudCol;
      }
      // Repintado del gradiente (a cadencia, o al cambiar el clima): barato y con firma.
      redrawAcc += dt;
      const nightF = Math.max(0, Math.min(1, (0.75 - Math.min(kf.ambient, 1)) / 0.45));
      if (redrawAcc >= cfg.sky.redrawSeconds || lastWeather !== world.weather.state) {
        redrawAcc = 0;
        lastWeather = world.weather.state;
        const ctx = skyTex.getContext() as unknown as CanvasRenderingContext2D;
        const grad = ctx.createLinearGradient(0, 0, 0, SKY_H);
        grad.addColorStop(0, hexOf(kf.top));
        grad.addColorStop(0.62, hexOf(kf.horizon));
        grad.addColorStop(1, hexOf(kf.horizon));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, SKY_W, SKY_H);
        // Estrellas: solo asoman con la noche (alpha por oscuridad).
        if (nightF > 0.02 && cfg.sky.stars > 0) {
          const star = cfg.sky.starColor;
          for (let i = 0; i < cfg.sky.stars; i++) {
            const sx = hash01('estrella', i) * SKY_W;
            const sy = hash01('estrella_alto', i) * SKY_H * 0.6;
            const r = 0.6 + hash01('estrella_r', i) * 1.5;
            ctx.globalAlpha = nightF * (0.35 + hash01('estrella_a', i) * 0.65);
            ctx.fillStyle = star;
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        skyTex.update(true);
        for (let li = 0; li < layers.length; li++) paintLayer(layers[li]!, li, nightF);
      }
    },
    dispose() {
      sky.dispose(false, true);
      sun.mesh.dispose(false, true);
      moon.mesh.dispose(false, true);
      for (const c of clouds) c.mesh.dispose(false, true);
      for (const lv of layers) lv.plane.dispose(false, true);
      cloudTex.dispose();
      skyTex.dispose();
    },
  };
}

/** Color3 → #rrggbb (helper local del canvas; los helpers del catálogo no saben de canvas). */
function hexOf(c: Color3): string {
  return `#${[c.r, c.g, c.b].map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('')}`;
}
