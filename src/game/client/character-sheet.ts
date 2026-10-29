import type { Scene, Texture as BTexture, TransformNode } from '@babylonjs/core';
import type { CharacterDetailSpec } from '@/game/core/types';
import { B } from './babylon';

/**
 * v1.46 — HOJA DE SPRITES ANIMADA (sprite sheet) del personaje: el LOD cercano ya no es
 * un recorte estático sino ANIMACIÓN DE FRAMES de verdad — andar en 4 direcciones, idle,
 * sentado, hablando y tumbado — reproducida según el estado del actor.
 *
 * Dos orígenes de hoja, MISMA retícula (la «regla para todos»):
 *  1. GENERADA: este módulo dibuja al arquetipo (colores/ropa/pelo/bigote/gafas de
 *     character-details.json) frame a frame en un canvas y sube el atlas como PNG
 *     (dataURL — el camino verificado). Determinista, sin arte externo, un atlas por arquetipo.
 *  2. EXTERNA: character-sprites.json → sheets[arquetipo] = URL de un PNG con la misma
 *     retícula (mismo nº de filas/columnas, pies abajo, mirando a la derecha en
 *     walk_right). Si existe, MANDA sobre la generada — pasar sprites propios no toca código.
 *
 * Retícula por defecto (la que hornea y la que se pide al arte externo):
 *   · 8 columnas × 8 filas, frames cuadrados 256×256 px.
 *   · Filas: 0 idle · 1 walk_right · 2 walk_left · 3 walk_down (de cara a cámara)
 *     4 walk_up (de espaldas) · 5 sit · 6 talk · 7 lie (tumbado).
 *   · Pies en el borde inferior (margen ~3%), figura centrada horizontalmente.
 *
 * Visualización: un quad billboard-Y con material ALPHATEST (profundidad por píxel, la
 * lección de los árboles) y UV-pan por frame — cero coste por frame salvo escribir
 * uOffset/vOffset. La dirección (fila) se elige por ángulo cámara↔rumbo con el signo
 * VERIFICADO: en left-handed, la derecha de pantalla es R = (−dz, dx) ⇒ f·R = dx·fz − dz·fx.
 */

/** Tamaño mundial del quad: 1.6 m de lado (la figura de 1.3 m llena el frame con margen). */
export const SHEET_QUAD_M = 1.6;

export type SheetRow =
  | 'idle'
  | 'walk_right'
  | 'walk_left'
  | 'walk_down'
  | 'walk_up'
  | 'sit'
  | 'talk'
  | 'lie';

export const SHEET_ROW_NAMES: SheetRow[] = [
  'idle',
  'walk_right',
  'walk_left',
  'walk_down',
  'walk_up',
  'sit',
  'talk',
  'lie',
];

export interface SheetLayout {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  /** Nombre de fila → índice de fila en el PNG. */
  rows: Record<string, number>;
  /** fps de reproducción por fila. */
  fps: Record<string, number>;
}

export const DEFAULT_SHEET_LAYOUT: SheetLayout = {
  frameWidth: 256,
  frameHeight: 256,
  columns: 8,
  rows: { idle: 0, walk_right: 1, walk_left: 2, walk_down: 3, walk_up: 4, sit: 5, talk: 6, lie: 7 },
  fps: { idle: 6, walk_right: 10, walk_left: 10, walk_down: 10, walk_up: 10, sit: 3, talk: 8, lie: 2 },
};

/** Estado por frame que la presentación le pasa a la hoja (extiende el del billboard). */
export interface SheetFrameState {
  speedH: number;
  gesture: string | null;
  /** Rumbo del actor (rad, convención de rutas: yaw = atan2(−dz, dx)). */
  yaw: number;
  /** Posición del NODO del actor (con pivotY incluido). */
  pos: { x: number; y: number; z: number };
  /** Altura del SUELO bajo los pies (node.y − pivotY; tumbado corrige la elevación del teatro). */
  groundY: number;
  /** Posición de la cámara (para elegir fila por ángulo). */
  camPos: { x: number; y: number; z: number };
  /** Fundido del actor (0..1). */
  fade: number;
  /** El actor está en un asiento (ancla del catálogo) → fila sit. */
  seated: boolean;
  /** Pose tumbada (gesto 'sleep') → fila lie. */
  lying: boolean;
  /** Pausa de charla (chatT > 0) → fila talk. */
  chatting: boolean;
}

export interface CharacterSheetRig {
  root: TransformNode;
  /** true cuando la textura está lista (horneada o cargada). */
  ready: boolean;
  /** Fila vigente ('idle'|'walk_left'|…) — sonda de verificación E2E. */
  view: string;
  /** La hoja tiene filas sit/lie/talk propias (el billboard estático no). */
  supportsPoses: boolean;
  setEnabled(v: boolean): void;
  setFade(v: number): void;
  sync(dt: number, state: SheetFrameState): void;
  dispose(): void;
}

// ────────────────────────────── paleta y utilidades ──────────────────────────────

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** f < 0 oscurece, f > 0 aclara. */
function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  if (f < 0) {
    const k = 1 + f;
    return `rgb(${clamp255(r * k)},${clamp255(g * k)},${clamp255(b * k)})`;
  }
  const k = 255 - f * 255;
  return `rgb(${clamp255(r + (k - r) * f)},${clamp255(g + (k - g) * f)},${clamp255(b + (k - b) * f)})`;
}

function withAlpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

interface Palette {
  skin: string;
  hair: string;
  top: string;
  shirt: string | null;
  tie: string | null;
  bottom: string;
  shoe: string;
  strap: string | null;
  buckle: string | null;
  mustache: string | null;
  lensFill: string | null;
  lensLine: string;
  capColor: string;
  prop: string;
  /** tinta de rasgos (ojos, cejas, contorno de boca). */
  ink: string;
}

function buildPalette(spec: CharacterDetailSpec): Palette {
  const ink = '#241d18';
  const isSuit = !!spec.suit;
  return {
    skin: spec.skin,
    hair: spec.hairColor,
    top: isSuit ? spec.suit!.lapel : spec.top,
    shirt: isSuit ? spec.suit!.shirt : null,
    tie: isSuit ? spec.suit!.tie : null,
    bottom: spec.bottom,
    shoe: spec.shoes,
    strap: spec.belt?.strap ?? null,
    buckle: spec.belt?.buckle ?? null,
    mustache: spec.mustache ?? null,
    lensFill: spec.glasses === 'sun' ? 'rgba(38,42,52,0.92)' : spec.glasses === 'clear' ? 'rgba(228,240,248,0.45)' : null,
    lensLine: spec.glasses === 'sun' ? '#20242c' : '#3c3a36',
    capColor: shade(spec.top, -0.08),
    prop: spec.prop ?? 'none',
    ink,
  };
}

// ────────────────────────────── métricas del cuerpo ──────────────────────────────

interface V {
  x: number;
  y: number;
}

interface Metrics {
  H: number;
  headR: number;
  torsoW: number;
  hipY: number;
  torsoH: number;
  shoulderY: number;
  shoulderX: number;
  upperLeg: number;
  lowerLeg: number;
  legR: number;
  ankleY: number;
  upperArm: number;
  lowerArm: number;
  armR: number;
  footL: number;
  footH: number;
  stride: number;
  lift: number;
  lean: number;
  hunchShift: number;
  hipOff: number;
}

function metricsOf(spec: CharacterDetailSpec): Metrics {
  const H = spec.height && spec.height > 0.3 ? spec.height : 1.3;
  const headScale = spec.headScale ?? 1;
  const bulk = spec.bulk ?? 1;
  const headR = 0.15 * H * headScale;
  const hipY = 0.32 * H;
  const torsoH = Math.max(0.18 * H, H - hipY - headR * 1.96);
  const girth = 0.85 + 0.35 * bulk;
  return {
    H,
    headR,
    torsoW: 0.1 * H * bulk,
    hipY,
    torsoH,
    shoulderY: hipY + torsoH * 0.9,
    shoulderX: 0.072 * H * bulk,
    upperLeg: 0.175 * H,
    lowerLeg: 0.16 * H,
    legR: 0.04 * H * girth,
    ankleY: 0.045 * H,
    upperArm: 0.16 * H,
    lowerArm: 0.15 * H,
    armR: 0.026 * H * girth,
    footL: 0.115 * H,
    footH: 0.036 * H,
    stride: 0.1 * H,
    lift: 0.05 * H,
    lean: 0.05 + (spec.hunch ?? 0) * 0.45,
    hunchShift: (spec.hunch ?? 0) * 0.12 * H,
    hipOff: 0.045 * H,
  };
}

/** IK de dos huesos: devuelve la rodilla (o codo) resolviendo la intersección de círculos. */
function solveJoint(a: V, target: V, la: number, lb: number, sideSign: number): V {
  let dx = target.x - a.x;
  let dy = target.y - a.y;
  let d = Math.hypot(dx, dy);
  const dMax = (la + lb) * 0.999;
  const dMin = Math.abs(la - lb) + 1e-4;
  const dc = Math.min(dMax, Math.max(dMin, d || 1e-4));
  dx = (dx / (d || 1e-4)) * dc;
  dy = (dy / (d || 1e-4)) * dc;
  d = dc;
  const t = (la * la - lb * lb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, la * la - t * t));
  const mx = a.x + dx * (t / d);
  const my = a.y + dy * (t / d);
  // perpendicular unitaria elegida para que la articulación quede del lado pedido
  let px = dy / d;
  let py = -dx / d;
  if (px * sideSign < 0) {
    px = -px;
    py = -py;
  }
  return { x: mx + px * h, y: my + py * h };
}

// ────────────────────────────── primitivas de dibujo ──────────────────────────────

type Ctx = CanvasRenderingContext2D;

const OL = 0.011; // contorno en metros

function limb(ctx: Ctx, a: V, b: V, c: V, w: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.strokeStyle = shade(color, -0.46);
  ctx.lineWidth = w + 2 * OL;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

function capsule(ctx: Ctx, a: V, b: V, w: number, color: string, lineAlpha = 0.46): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = shade(color, -lineAlpha);
  ctx.lineWidth = w + 2 * OL;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

function disc(ctx: Ctx, p: V, r: number, color: string, line = true): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (line) {
    ctx.strokeStyle = shade(color, -0.46);
    ctx.lineWidth = OL;
    ctx.stroke();
  }
}

function blob(ctx: Ctx, p: V, rx: number, ry: number, rot: number, color: string, alphaLine = 0.46): void {
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = shade(color, -alphaLine);
  ctx.lineWidth = OL;
  ctx.stroke();
}

/** Arco grueso (pelo, gorra, diadema) alrededor de un centro. */
function band(ctx: Ctx, p: V, r: number, w: number, a0: number, a1: number, color: string): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, a0, a1);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'butt';
  ctx.stroke();
  ctx.lineCap = 'round';
  ctx.strokeStyle = shade(color, -0.4);
  ctx.lineWidth = 0.006;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r + w / 2, a0, a1);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(0.004, r - w / 2), a0, a1);
  ctx.stroke();
}

function shadow(ctx: Ctx, x: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, 0.012, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(24,26,30,0.20)';
  ctx.fill();
}

// ────────────────────────────── cabeza (3 vistas) ──────────────────────────────

function hairSide(ctx: Ctx, head: V, r: number, spec: CharacterDetailSpec, pal: Palette): void {
  const style = spec.hairStyle;
  if (style === 'baldSides') {
    // v1.46.1 — calva con laterales: mechón SOBRE LA OREJA + nuca corta (no un capuchón).
    band(ctx, head, r * 0.99, r * 0.2, Math.PI * 0.86, Math.PI * 1.42, pal.hair);
    blob(ctx, { x: head.x - r * 0.42, y: head.y + r * 0.38 }, r * 0.22, r * 0.26, 0.3, pal.hair);
    blob(ctx, { x: head.x + r * 0.22, y: head.y + r * 0.94 }, r * 0.2, r * 0.1, -0.3, pal.hair);
  } else if (style === 'bun') {
    band(ctx, head, r * 0.99, r * 0.5, Math.PI * 0.28, Math.PI * 1.62, pal.hair);
    disc(ctx, { x: head.x - r * 0.5, y: head.y + r * 0.78 }, r * 0.28, pal.hair);
  } else if (style === 'cap') {
    band(ctx, head, r * 1.0, r * 0.55, Math.PI * 0.18, Math.PI * 1.3, pal.capColor);
    blob(ctx, { x: head.x + r * 0.72, y: head.y + r * 0.42 }, r * 0.6, r * 0.16, -0.12, pal.capColor);
    disc(ctx, { x: head.x - r * 0.06, y: head.y + r * 1.06 }, r * 0.09, shade(pal.capColor, 0.2));
  } else if (style === 'full') {
    band(ctx, head, r * 1.02, r * 0.62, Math.PI * 0.12, Math.PI * 1.68, pal.hair);
    blob(ctx, { x: head.x + r * 0.5, y: head.y + r * 0.66 }, r * 0.34, r * 0.2, -0.45, pal.hair);
  } else if (style === 'headphones') {
    band(ctx, head, r * 0.99, r * 0.4, Math.PI * 0.3, Math.PI * 1.5, pal.hair);
    band(ctx, head, r * 1.12, r * 0.14, Math.PI * 0.12, Math.PI * 0.94, '#2b2b30');
    disc(ctx, { x: head.x - r * 0.1, y: head.y - r * 0.14 }, r * 0.27, '#2b2b30');
    disc(ctx, { x: head.x - r * 0.1, y: head.y - r * 0.14 }, r * 0.15, shade('#2b2b30', 0.35), false);
  } else {
    // short
    band(ctx, head, r * 1.0, r * 0.46, Math.PI * 0.2, Math.PI * 1.55, pal.hair);
  }
}

function hairFront(ctx: Ctx, head: V, r: number, spec: CharacterDetailSpec, pal: Palette): void {
  const style = spec.hairStyle;
  if (style === 'baldSides') {
    blob(ctx, { x: head.x - r * 0.86, y: head.y - r * 0.05 }, r * 0.2, r * 0.34, 0, pal.hair);
    blob(ctx, { x: head.x + r * 0.86, y: head.y - r * 0.05 }, r * 0.2, r * 0.34, 0, pal.hair);
  } else if (style === 'bun') {
    band(ctx, head, r * 0.99, r * 0.42, Math.PI * 0.14, Math.PI * 0.86, pal.hair);
    disc(ctx, { x: head.x, y: head.y + r * 1.0 }, r * 0.27, pal.hair);
  } else if (style === 'cap') {
    band(ctx, head, r * 1.02, r * 0.5, Math.PI * 0.1, Math.PI * 0.9, pal.capColor);
    blob(ctx, { x: head.x, y: head.y + r * 0.52 }, r * 1.04, r * 0.2, 0, shade(pal.capColor, -0.12));
    disc(ctx, { x: head.x, y: head.y + r * 1.04 }, r * 0.09, shade(pal.capColor, 0.2));
  } else if (style === 'full') {
    band(ctx, head, r * 1.03, r * 0.58, Math.PI * 0.06, Math.PI * 0.94, pal.hair);
    blob(ctx, { x: head.x - r * 0.4, y: head.y + r * 0.68 }, r * 0.3, r * 0.18, 0.35, pal.hair);
    blob(ctx, { x: head.x + r * 0.4, y: head.y + r * 0.68 }, r * 0.3, r * 0.18, -0.35, pal.hair);
  } else if (style === 'headphones') {
    band(ctx, head, r * 1.0, r * 0.38, Math.PI * 0.16, Math.PI * 0.84, pal.hair);
    band(ctx, head, r * 1.13, r * 0.13, Math.PI * 0.06, Math.PI * 0.94, '#2b2b30');
    disc(ctx, { x: head.x - r * 0.95, y: head.y - r * 0.06 }, r * 0.26, '#2b2b30');
    disc(ctx, { x: head.x + r * 0.95, y: head.y - r * 0.06 }, r * 0.26, '#2b2b30');
  } else {
    band(ctx, head, r * 1.01, r * 0.42, Math.PI * 0.12, Math.PI * 0.88, pal.hair);
  }
}

function hairBack(ctx: Ctx, head: V, r: number, spec: CharacterDetailSpec, pal: Palette): void {
  const style = spec.hairStyle;
  if (style === 'baldSides') {
    band(ctx, head, r * 0.98, r * 0.42, Math.PI * 0.72, Math.PI * 1.28, pal.hair);
  } else if (style === 'bun') {
    disc(ctx, { x: head.x, y: head.y + r * 0.05 }, r * 1.0, pal.hair);
    disc(ctx, { x: head.x, y: head.y + r * 0.72 }, r * 0.3, shade(pal.hair, -0.1));
  } else if (style === 'cap') {
    disc(ctx, { x: head.x, y: head.y + r * 0.08 }, r * 1.02, pal.capColor);
    capsule(ctx, { x: head.x, y: head.y - r * 0.72 }, { x: head.x, y: head.y - r * 0.98 }, r * 0.1, shade(pal.capColor, -0.25));
  } else if (style === 'headphones') {
    disc(ctx, { x: head.x, y: head.y + r * 0.05 }, r * 0.98, pal.hair);
    band(ctx, head, r * 1.13, r * 0.13, Math.PI * 0.06, Math.PI * 0.94, '#2b2b30');
    disc(ctx, { x: head.x - r * 0.95, y: head.y - r * 0.02 }, r * 0.26, '#2b2b30');
    disc(ctx, { x: head.x + r * 0.95, y: head.y - r * 0.02 }, r * 0.26, '#2b2b30');
  } else {
    disc(ctx, { x: head.x, y: head.y + r * 0.06 }, r * 1.0, pal.hair);
    blob(ctx, { x: head.x, y: head.y - r * 0.55 }, r * 0.8, r * 0.4, 0, shade(pal.hair, -0.08));
  }
}

/** Perfil (mirando a +x). blink: ojo cerrado. mouthOpen: boca abierta (hablar). */
function headSide(ctx: Ctx, head: V, m: Metrics, spec: CharacterDetailSpec, pal: Palette, blink: boolean, mouthOpen: boolean): void {
  const r = m.headR;
  disc(ctx, head, r, pal.skin);
  // oreja (centro-atrás, como la hoja de referencia)
  disc(ctx, { x: head.x - r * 0.26, y: head.y - r * 0.1 }, r * 0.14, pal.skin);
  // nariz (bulto al frente)
  disc(ctx, { x: head.x + r * 0.96, y: head.y - r * 0.02 }, r * 0.24, shade(pal.skin, -0.06));
  // ojo + ceja
  const eye: V = { x: head.x + r * 0.48, y: head.y + r * 0.16 };
  if (blink) {
    capsule(ctx, { x: eye.x - r * 0.1, y: eye.y }, { x: eye.x + r * 0.1, y: eye.y }, r * 0.05, pal.ink);
  } else {
    disc(ctx, eye, r * 0.075, pal.ink, false);
  }
  capsule(ctx, { x: eye.x - r * 0.16, y: eye.y + r * 0.3 }, { x: eye.x + r * 0.18, y: eye.y + r * 0.26 }, r * 0.07, shade(pal.hair, -0.2));
  // boca (hablar) — entre nariz y mandíbula
  const mouth: V = { x: head.x + r * 0.6, y: head.y - r * 0.42 };
  if (mouthOpen) {
    blob(ctx, mouth, r * 0.16, r * 0.12, -0.2, '#5d3230');
  } else {
    capsule(ctx, { x: mouth.x - r * 0.12, y: mouth.y }, { x: mouth.x + r * 0.1, y: mouth.y - r * 0.02 }, r * 0.05, shade(pal.ink, 0.25));
  }
  // bigote
  if (pal.mustache) {
    blob(ctx, { x: head.x + r * 0.56, y: head.y - r * 0.27 }, r * 0.27, r * 0.1, -0.12, pal.mustache);
  }
  // gafas: lente + patilla hasta la oreja
  if (pal.lensFill) {
    ctx.beginPath();
    ctx.arc(head.x + r * 0.46, head.y + r * 0.14, r * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = pal.lensFill;
    ctx.fill();
    ctx.strokeStyle = pal.lensLine;
    ctx.lineWidth = OL * 1.2;
    ctx.stroke();
    capsule(ctx, { x: head.x + r * 0.2, y: head.y + r * 0.2 }, { x: head.x - r * 0.16, y: head.y + r * 0.06 }, OL, pal.lensLine);
  }
  hairSide(ctx, head, r, spec, pal);
}

/** Frente (mirando a cámara). */
function headFront(ctx: Ctx, head: V, m: Metrics, spec: CharacterDetailSpec, pal: Palette, blink: boolean, mouthOpen: boolean): void {
  const r = m.headR;
  // orejas asomando
  disc(ctx, { x: head.x - r * 0.98, y: head.y - r * 0.05 }, r * 0.16, pal.skin);
  disc(ctx, { x: head.x + r * 0.98, y: head.y - r * 0.05 }, r * 0.16, pal.skin);
  disc(ctx, head, r, pal.skin);
  const ex = r * 0.36;
  const ey = head.y + r * 0.14;
  for (const s of [-1, 1] as const) {
    if (blink) {
      capsule(ctx, { x: head.x + s * ex - r * 0.09, y: ey }, { x: head.x + s * ex + r * 0.09, y: ey }, r * 0.05, pal.ink);
    } else {
      disc(ctx, { x: head.x + s * ex, y: ey }, r * 0.08, pal.ink, false);
    }
    capsule(ctx, { x: head.x + s * ex - r * 0.16, y: ey + r * 0.3 }, { x: head.x + s * ex + r * 0.16, y: ey + r * 0.28 }, r * 0.07, shade(pal.hair, -0.2));
  }
  // nariz
  disc(ctx, { x: head.x, y: head.y - r * 0.12 }, r * 0.14, shade(pal.skin, -0.08));
  // boca
  const my = head.y - r * 0.5;
  if (mouthOpen) {
    blob(ctx, { x: head.x, y: my }, r * 0.17, r * 0.13, 0, '#5d3230');
  } else {
    capsule(ctx, { x: head.x - r * 0.14, y: my }, { x: head.x + r * 0.14, y: my }, r * 0.05, shade(pal.ink, 0.25));
  }
  if (pal.mustache) {
    blob(ctx, { x: head.x - r * 0.22, y: head.y - r * 0.34 }, r * 0.24, r * 0.1, 0.12, pal.mustache);
    blob(ctx, { x: head.x + r * 0.22, y: head.y - r * 0.34 }, r * 0.24, r * 0.1, -0.12, pal.mustache);
  }
  if (pal.lensFill) {
    for (const s of [-1, 1] as const) {
      ctx.beginPath();
      ctx.arc(head.x + s * ex, ey, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = pal.lensFill;
      ctx.fill();
      ctx.strokeStyle = pal.lensLine;
      ctx.lineWidth = OL * 1.2;
      ctx.stroke();
    }
    capsule(ctx, { x: head.x - r * 0.1, y: ey + r * 0.06 }, { x: head.x + r * 0.1, y: ey + r * 0.06 }, OL, pal.lensLine);
  }
  hairFront(ctx, head, r, spec, pal);
}

/** Espalda. */
function headBack(ctx: Ctx, head: V, m: Metrics, spec: CharacterDetailSpec, pal: Palette): void {
  const r = m.headR;
  disc(ctx, { x: head.x - r * 0.98, y: head.y - r * 0.05 }, r * 0.15, pal.skin);
  disc(ctx, { x: head.x + r * 0.98, y: head.y - r * 0.05 }, r * 0.15, pal.skin);
  disc(ctx, head, r, pal.skin);
  hairBack(ctx, head, r, spec, pal);
}

// ────────────────────────────── ropa ──────────────────────────────

function suitSide(ctx: Ctx, neck: V, hipTop: V, m: Metrics, pal: Palette): void {
  if (!pal.shirt) return;
  const fx = neck.x + m.torsoW * 0.62;
  capsule(ctx, { x: fx, y: neck.y - m.torsoH * 0.02 }, { x: fx + m.torsoW * 0.1, y: neck.y - m.torsoH * 0.52 }, m.torsoW * 0.42, pal.shirt);
  if (pal.tie) {
    capsule(ctx, { x: fx + m.torsoW * 0.18, y: neck.y - m.torsoH * 0.06 }, { x: fx + m.torsoW * 0.2, y: neck.y - m.torsoH * 0.5 }, m.torsoW * 0.16, pal.tie);
  }
}

function suitFront(ctx: Ctx, neck: V, hipTop: V, m: Metrics, pal: Palette): void {
  if (!pal.shirt) return;
  const w = m.torsoW * 0.92;
  ctx.beginPath();
  ctx.moveTo(neck.x - w, neck.y + m.torsoH * 0.02);
  ctx.lineTo(neck.x, neck.y - m.torsoH * 0.34);
  ctx.lineTo(neck.x + w, neck.y + m.torsoH * 0.02);
  ctx.closePath();
  ctx.fillStyle = pal.shirt;
  ctx.fill();
  ctx.strokeStyle = shade(pal.shirt, -0.4);
  ctx.lineWidth = OL * 0.9;
  ctx.stroke();
  if (pal.tie) {
    capsule(ctx, { x: neck.x, y: neck.y - m.torsoH * 0.05 }, { x: neck.x, y: neck.y - m.torsoH * 0.32 }, m.torsoW * 0.24, pal.tie);
    blob(ctx, { x: neck.x, y: neck.y - m.torsoH * 0.02 }, m.torsoW * 0.16, m.torsoW * 0.11, 0, pal.tie);
  }
  // solapas
  for (const s of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(neck.x + s * w * 0.95, neck.y + m.torsoH * 0.03);
    ctx.lineTo(neck.x + s * w * 0.32, neck.y - m.torsoH * 0.3);
    ctx.lineTo(neck.x + s * w * 0.16, neck.y + m.torsoH * 0.02);
    ctx.closePath();
    ctx.fillStyle = shade(pal.top, 0.07);
    ctx.fill();
    ctx.strokeStyle = shade(pal.top, -0.4);
    ctx.lineWidth = OL * 0.8;
    ctx.stroke();
  }
}

function beltSide(ctx: Ctx, hip: V, m: Metrics, pal: Palette): void {
  if (!pal.strap) return;
  capsule(ctx, { x: hip.x - m.torsoW * 0.5, y: hip.y + 0.015 }, { x: hip.x + m.torsoW * 0.75, y: hip.y + 0.015 }, 0.035 * m.H, pal.strap);
  if (pal.buckle) disc(ctx, { x: hip.x + m.torsoW * 0.52, y: hip.y + 0.015 }, 0.02 * m.H, pal.buckle);
}

function beltFront(ctx: Ctx, hip: V, m: Metrics, pal: Palette): void {
  if (!pal.strap) return;
  capsule(ctx, { x: hip.x - m.torsoW * 0.9, y: hip.y + 0.015 }, { x: hip.x + m.torsoW * 0.9, y: hip.y + 0.015 }, 0.038 * m.H, pal.strap);
  if (pal.buckle) disc(ctx, { x: hip.x, y: hip.y + 0.015 }, 0.024 * m.H, pal.buckle);
}

function shoeSide(ctx: Ctx, ankle: V, m: Metrics, pal: Palette, dir: number): void {
  blob(
    ctx,
    { x: ankle.x + dir * m.footL * 0.42, y: ankle.y - m.footH * 0.35 },
    m.footL * 0.62,
    m.footH * 0.62,
    0,
    pal.shoe,
  );
}

function shoeFront(ctx: Ctx, ankle: V, m: Metrics, pal: Palette): void {
  blob(ctx, { x: ankle.x, y: ankle.y - m.footH * 0.35 }, m.legR * 1.55, m.footH * 0.55, 0, pal.shoe);
}

// ────────────────────────────── accesorios ──────────────────────────────

function drawProp(ctx: Ctx, hand: V, m: Metrics, pal: Palette, swing: number): void {
  const H = m.H;
  if (pal.prop === 'clipboard') {
    ctx.save();
    ctx.translate(hand.x + 0.02 * H, hand.y + 0.02 * H);
    ctx.rotate(-0.3 + swing * 0.1);
    blob(ctx, { x: 0, y: 0 }, 0.055 * H, 0.075 * H, 0, '#c8a06a');
    blob(ctx, { x: 0, y: 0.004 * H }, 0.042 * H, 0.06 * H, 0, '#f4f1e8', 0.3);
    capsule(ctx, { x: 0, y: 0.07 * H }, { x: 0, y: 0.085 * H }, 0.02 * H, '#8d8d92');
    ctx.restore();
  } else if (pal.prop === 'briefcase') {
    blob(ctx, { x: hand.x + 0.01 * H, y: hand.y - 0.075 * H - swing * 0.008 * H }, 0.075 * H, 0.055 * H, 0, '#4a3527');
    capsule(ctx, { x: hand.x - 0.02 * H, y: hand.y - 0.03 * H }, { x: hand.x + 0.04 * H, y: hand.y - 0.03 * H }, 0.012 * H, '#2e2018');
  } else if (pal.prop === 'spray') {
    blob(ctx, { x: hand.x + 0.02 * H, y: hand.y - 0.045 * H }, 0.024 * H, 0.04 * H, 0, '#d84f3f');
    capsule(ctx, { x: hand.x + 0.02 * H, y: hand.y - 0.012 * H }, { x: hand.x + 0.02 * H, y: hand.y + 0.006 * H }, 0.014 * H, '#e8e4dc');
  } else if (pal.prop === 'baguette') {
    capsule(ctx, { x: hand.x - 0.01 * H, y: hand.y - 0.02 * H }, { x: hand.x + 0.05 * H, y: hand.y + 0.1 * H }, 0.03 * H, '#d8a75b');
  }
}

function guitarOnBack(ctx: Ctx, neck: V, hipTop: V, m: Metrics, pal: Palette): void {
  if (pal.prop !== 'guitar') return;
  ctx.save();
  ctx.translate(neck.x - m.torsoW * 0.4, (neck.y + hipTop.y) / 2);
  ctx.rotate(2.35);
  blob(ctx, { x: 0, y: 0 }, 0.085 * m.H, 0.065 * m.H, 0, '#a06a38');
  blob(ctx, { x: 0, y: 0 }, 0.05 * m.H, 0.038 * m.H, 0, '#7c4e26', 0.25);
  capsule(ctx, { x: 0, y: 0.05 * m.H }, { x: 0, y: 0.3 * m.H }, 0.022 * m.H, '#5d3a1c');
  ctx.restore();
}

// ────────────────────────────── poses ──────────────────────────────

interface WalkJoints {
  hip: V;
  neck: V;
  head: V;
  legA: { hip: V; knee: V; ankle: V };
  legB: { hip: V; knee: V; ankle: V };
  armA: { sh: V; el: V; hand: V };
  armB: { sh: V; el: V; hand: V };
}

function walkSideJoints(m: Metrics, spec: CharacterDetailSpec, gait: number): WalkJoints {
  const th = gait * Math.PI * 2;
  const bob = 0.011 * m.H * Math.sin(2 * th + 0.7);
  const hip: V = { x: 0, y: m.hipY + bob };
  const lean = m.lean;
  const neck: V = { x: hip.x + m.hunchShift + Math.sin(lean) * m.torsoH, y: hip.y + m.torsoH * Math.cos(lean) };
  const head: V = { x: neck.x + m.hunchShift * 0.5 + Math.sin(lean) * m.headR * 0.9, y: neck.y + m.headR * 0.94 };
  const legPose = (phase: number, off: number) => {
    const p = phase * Math.PI * 2;
    const foot: V = { x: -Math.cos(p) * m.stride, y: m.ankleY + m.lift * Math.max(0, Math.sin(p)) };
    const hipJ: V = { x: hip.x + off * 0.4, y: hip.y };
    const knee = solveJoint(hipJ, foot, m.upperLeg, m.lowerLeg, 1);
    return { hip: hipJ, knee, ankle: foot };
  };
  const legA = legPose(gait, 1);
  const legB = legPose(gait + 0.5, -1);
  const armPose = (phase: number, off: number) => {
    const p = (phase + 0.5) * Math.PI * 2;
    const phi = 0.5 * Math.sin(p);
    const sh: V = { x: neck.x - off * m.shoulderX * 0.9, y: m.shoulderY + bob };
    const el: V = { x: sh.x + Math.sin(phi) * m.upperArm * 0.9, y: sh.y - Math.cos(phi) * m.upperArm };
    const bend = 0.5 + 0.3 * Math.max(0, Math.sin(p));
    const hand: V = { x: el.x + Math.sin(phi + bend) * m.lowerArm * 0.9, y: el.y - Math.cos(phi + bend) * m.lowerArm };
    return { sh, el, hand };
  };
  const armA = armPose(gait, 1);
  const armB = armPose(gait + 0.5, -1);
  return { hip, neck, head, legA, legB, armA, armB };
}

function walkFrontJoints(m: Metrics, spec: CharacterDetailSpec, gait: number): WalkJoints {
  const th = gait * Math.PI * 2;
  const bob = 0.011 * m.H * Math.sin(2 * th + 0.7);
  const hip: V = { x: 0, y: m.hipY + bob };
  const neck: V = { x: 0, y: hip.y + m.torsoH * Math.cos(m.lean * 0.5) };
  const head: V = { x: 0, y: neck.y + m.headR * 0.94 };
  const legPose = (phase: number, side: number) => {
    const p = phase * Math.PI * 2;
    const hipJ: V = { x: side * m.hipOff, y: hip.y };
    const foot: V = { x: side * (m.hipOff + 0.012 * m.H * Math.sin(p)), y: m.ankleY + m.lift * 0.85 * Math.max(0, Math.sin(p)) };
    const knee = solveJoint(hipJ, foot, m.upperLeg, m.lowerLeg, side);
    return { hip: hipJ, knee, ankle: foot };
  };
  const legA = legPose(gait, 1);
  const legB = legPose(gait + 0.5, -1);
  const armPose = (phase: number, side: number) => {
    const p = (phase + 0.5) * Math.PI * 2;
    const phi = 0.32 * Math.sin(p);
    const sh: V = { x: side * m.shoulderX, y: m.shoulderY + bob };
    const el: V = { x: sh.x + side * 0.02 * m.H + Math.sin(phi) * m.upperArm * 0.25, y: sh.y - Math.cos(phi) * m.upperArm };
    const hand: V = { x: el.x + side * 0.015 * m.H + Math.sin(phi + 0.25) * m.lowerArm * 0.25, y: el.y - Math.cos(phi + 0.25) * m.lowerArm };
    return { sh, el, hand };
  };
  const armA = armPose(gait, 1);
  const armB = armPose(gait + 0.5, -1);
  return { hip, neck, head, legA, legB, armA, armB };
}

function idleJoints(m: Metrics, spec: CharacterDetailSpec, t: number): WalkJoints {
  const th = t * Math.PI * 2;
  const bob = 0.004 * m.H * Math.sin(2 * th);
  const hip: V = { x: 0, y: m.hipY + bob };
  const lean = (spec.hunch ?? 0) * 0.4;
  const neck: V = { x: hip.x + m.hunchShift + Math.sin(lean) * m.torsoH, y: hip.y + m.torsoH * Math.cos(lean) };
  const head: V = { x: neck.x + Math.sin(lean) * m.headR * 0.9, y: neck.y + m.headR * 0.94 + 0.004 * m.H * Math.sin(2 * th + 1) };
  const leg = (side: number) => {
    const hipJ: V = { x: side * m.hipOff * 0.55, y: hip.y };
    const foot: V = { x: side * m.hipOff * 0.9, y: m.ankleY };
    // perfil: AMBAS rodillas doblan hacia delante (+x)
    const knee = solveJoint(hipJ, foot, m.upperLeg, m.lowerLeg, 1);
    return { hip: hipJ, knee, ankle: foot };
  };
  const legA = leg(1);
  const legB = leg(-1);
  const arm = (side: number) => {
    const phi = 0.05 * Math.sin(th + (side > 0 ? 0 : Math.PI));
    const sh: V = { x: side * m.shoulderX * 0.92, y: m.shoulderY + bob };
    const el: V = { x: sh.x + Math.sin(phi) * m.upperArm, y: sh.y - Math.cos(phi) * m.upperArm };
    const hand: V = { x: el.x + Math.sin(phi + 0.12) * m.lowerArm, y: el.y - Math.cos(phi + 0.12) * m.lowerArm };
    return { sh, el, hand };
  };
  const armA = arm(1);
  const armB = arm(-1);
  return { hip, neck, head, legA, legB, armA, armB };
}

function talkJoints(m: Metrics, spec: CharacterDetailSpec, t: number): WalkJoints {
  const th = t * Math.PI * 2;
  const bounce = 0.005 * m.H * Math.abs(Math.sin(2 * th));
  const hip: V = { x: 0, y: m.hipY + bounce };
  const lean = 0.03 + (spec.hunch ?? 0) * 0.4;
  const neck: V = { x: hip.x + m.hunchShift + Math.sin(lean) * m.torsoH, y: hip.y + m.torsoH * Math.cos(lean) };
  const nod = 0.008 * m.H * Math.sin(2 * th + 0.5);
  const head: V = { x: neck.x + Math.sin(lean) * m.headR * 0.9, y: neck.y + m.headR * 0.94 + nod };
  const leg = (side: number) => {
    const hipJ: V = { x: side * m.hipOff * 0.55, y: hip.y };
    const foot: V = { x: side * m.hipOff * 1.1, y: m.ankleY };
    // perfil: AMBAS rodillas doblan hacia delante (+x)
    const knee = solveJoint(hipJ, foot, m.upperLeg, m.lowerLeg, 1);
    return { hip: hipJ, knee, ankle: foot };
  };
  const legA = leg(1);
  const legB = leg(-1);
  // brazo cercano GESTIONANDO (sube y baja), el lejano suelto
  const phi = 0.75 + 0.35 * Math.sin(2 * th + 1.2);
  const armA = (() => {
    const sh: V = { x: m.shoulderX * 0.92, y: m.shoulderY + bounce };
    const el: V = { x: sh.x + Math.sin(phi) * m.upperArm, y: sh.y - Math.cos(phi) * m.upperArm };
    const bend = 1.15 + 0.4 * Math.sin(2 * th + 2.2);
    const hand: V = { x: el.x + Math.sin(phi + bend) * m.lowerArm, y: el.y - Math.cos(phi + bend) * m.lowerArm };
    return { sh, el, hand };
  })();
  const armB = (() => {
    const phiB = 0.08 * Math.sin(th);
    const sh: V = { x: -m.shoulderX * 0.92, y: m.shoulderY + bounce };
    const el: V = { x: sh.x + Math.sin(phiB) * m.upperArm * 0.6, y: sh.y - Math.cos(phiB) * m.upperArm };
    const hand: V = { x: el.x + Math.sin(phiB + 0.15) * m.lowerArm * 0.6, y: el.y - Math.cos(phiB + 0.15) * m.lowerArm };
    return { sh, el, hand };
  })();
  return { hip, neck, head, legA, legB, armA, armB };
}

interface SitJoints {
  hip: V;
  neck: V;
  head: V;
  legA: { hip: V; knee: V; ankle: V };
  legB: { hip: V; knee: V; ankle: V };
  armA: { sh: V; el: V; hand: V };
  armB: { sh: V; el: V; hand: V };
}

function sitJoints(m: Metrics, spec: CharacterDetailSpec, t: number): SitJoints {
  const th = t * Math.PI * 2;
  const seatH = m.hipY * 1.04 + 0.004 * m.H * Math.sin(2 * th);
  const hip: V = { x: 0, y: seatH };
  const lean = -0.04 + (spec.hunch ?? 0) * 0.4;
  const neck: V = { x: hip.x + m.hunchShift * 0.6 + Math.sin(lean) * m.torsoH, y: hip.y + m.torsoH * Math.cos(lean) };
  const head: V = { x: neck.x + Math.sin(lean) * m.headR * 0.9, y: neck.y + m.headR * 0.94 };
  const legPose = (off: number) => {
    const hipJ: V = { x: hip.x - off * 0.012 * m.H, y: hip.y - off * 0.008 * m.H };
    const knee: V = { x: hipJ.x + 0.185 * m.H, y: hipJ.y - 0.01 * m.H - off * 0.012 * m.H };
    const ankle: V = { x: knee.x, y: m.ankleY };
    return { hip: hipJ, knee, ankle };
  };
  const legA = legPose(1);
  const legB = legPose(-1);
  const armPose = (off: number) => {
    const sh: V = { x: neck.x - off * m.shoulderX * 0.5, y: m.shoulderY + (seatH - m.hipY) };
    const el: V = { x: sh.x + 0.075 * m.H, y: sh.y - 0.13 * m.H };
    const hand: V = { x: legA.knee.x - 0.05 * m.H + off * 0.02 * m.H, y: legA.hip.y + 0.03 * m.H };
    return { sh, el, hand };
  };
  const armA = armPose(1);
  const armB = armPose(-1);
  return { hip, neck, head, legA, legB, armA, armB };
}

// ────────────────────────────── renderizadores de fila ──────────────────────────────

function renderSideFigure(
  ctx: Ctx,
  j: WalkJoints,
  m: Metrics,
  spec: CharacterDetailSpec,
  pal: Palette,
  opts: { blink: boolean; mouthOpen: boolean; showFace: boolean },
): void {
  const far = (c: string): string => shade(c, -0.14);
  // sombra
  shadow(ctx, j.hip.x + m.stride * 0.12, 0.17 * m.H, 0.032 * m.H);
  // brazo lejano
  limb(ctx, j.armB.sh, j.armB.el, j.armB.hand, m.armR * 1.9, far(spec.suit ? spec.suit!.lapel : spec.top));
  disc(ctx, j.armB.hand, m.armR * 1.05, far(pal.skin));
  // pierna lejana
  limb(ctx, j.legB.hip, j.legB.knee, j.legB.ankle, m.legR * 1.9, far(spec.bottom));
  shoeSide(ctx, j.legB.ankle, m, { ...pal, shoe: shade(pal.shoe, -0.16) }, 1);
  // torso
  const hipTop: V = { x: j.hip.x, y: j.hip.y + m.torsoH * 0.12 };
  capsule(ctx, j.hip, j.neck, m.torsoW * 1.92, spec.suit ? spec.suit!.lapel : spec.top);
  suitSide(ctx, j.neck, hipTop, m, pal);
  beltSide(ctx, j.hip, m, pal);
  guitarOnBack(ctx, j.neck, hipTop, m, pal);
  // pierna cercana
  limb(ctx, j.legA.hip, j.legA.knee, j.legA.ankle, m.legR * 1.9, spec.bottom);
  shoeSide(ctx, j.legA.ankle, m, pal, 1);
  // cabeza
  if (opts.showFace) headSide(ctx, j.head, m, spec, pal, opts.blink, opts.mouthOpen);
  else headBack(ctx, j.head, m, spec, pal);
  // brazo cercano + prop
  limb(ctx, j.armA.sh, j.armA.el, j.armA.hand, m.armR * 1.9, spec.suit ? spec.suit!.lapel : spec.top);
  disc(ctx, j.armA.hand, m.armR * 1.05, pal.skin);
  drawProp(ctx, j.armA.hand, m, pal, Math.sin(0));
}

function renderFrontFigure(
  ctx: Ctx,
  j: WalkJoints,
  m: Metrics,
  spec: CharacterDetailSpec,
  pal: Palette,
  back: boolean,
  opts: { blink: boolean; mouthOpen: boolean },
): void {
  const far = (c: string): string => shade(c, -0.14);
  shadow(ctx, 0, 0.17 * m.H, 0.032 * m.H);
  // brazo lejano (izquierdo del personaje → derecha de pantalla NO: mantenemos lados)
  limb(ctx, j.armB.sh, j.armB.el, j.armB.hand, m.armR * 1.9, far(spec.suit ? spec.suit!.lapel : spec.top));
  disc(ctx, j.armB.hand, m.armR * 1.05, far(pal.skin));
  // pierna lejana
  limb(ctx, j.legB.hip, j.legB.knee, j.legB.ankle, m.legR * 1.9, far(spec.bottom));
  shoeFront(ctx, j.legB.ankle, m, { ...pal, shoe: shade(pal.shoe, -0.16) });
  // torso
  const hipTop: V = { x: j.hip.x, y: j.hip.y + m.torsoH * 0.12 };
  capsule(ctx, j.hip, j.neck, m.torsoW * 2.05, spec.suit ? spec.suit!.lapel : spec.top);
  if (!back) suitFront(ctx, j.neck, hipTop, m, pal);
  else {
    // cuello del abrigo por detrás
    capsule(ctx, { x: j.neck.x - m.torsoW * 0.7, y: j.neck.y - 0.01 }, { x: j.neck.x + m.torsoW * 0.7, y: j.neck.y - 0.01 }, 0.03 * m.H, shade(spec.suit ? spec.suit!.lapel : spec.top, -0.15));
  }
  beltFront(ctx, j.hip, m, pal);
  guitarOnBack(ctx, j.neck, hipTop, m, pal);
  // pierna cercana
  limb(ctx, j.legA.hip, j.legA.knee, j.legA.ankle, m.legR * 1.9, spec.bottom);
  shoeFront(ctx, j.legA.ankle, m, pal);
  // cabeza
  if (back) headBack(ctx, j.head, m, spec, pal);
  else headFront(ctx, j.head, m, spec, pal, opts.blink, opts.mouthOpen);
  // brazo cercano
  limb(ctx, j.armA.sh, j.armA.el, j.armA.hand, m.armR * 1.9, spec.suit ? spec.suit!.lapel : spec.top);
  disc(ctx, j.armA.hand, m.armR * 1.05, pal.skin);
}

function renderSit(ctx: Ctx, j: SitJoints, m: Metrics, spec: CharacterDetailSpec, pal: Palette, blink: boolean): void {
  const far = (c: string): string => shade(c, -0.14);
  shadow(ctx, 0.12 * m.H, 0.2 * m.H, 0.03 * m.H);
  // brazo lejano
  limb(ctx, j.armB.sh, j.armB.el, j.armB.hand, m.armR * 1.9, far(spec.suit ? spec.suit!.lapel : spec.top));
  disc(ctx, j.armB.hand, m.armR * 1.05, far(pal.skin));
  // pierna lejana
  limb(ctx, j.legB.hip, j.legB.knee, j.legB.ankle, m.legR * 1.9, far(spec.bottom));
  shoeSide(ctx, j.legB.ankle, m, { ...pal, shoe: shade(pal.shoe, -0.16) }, 1);
  // torso
  capsule(ctx, j.hip, j.neck, m.torsoW * 1.92, spec.suit ? spec.suit!.lapel : spec.top);
  suitSide(ctx, j.neck, j.hip, m, pal);
  // muslos (el asiento lo sugiere el propio cuerpo)
  // pierna cercana
  limb(ctx, j.legA.hip, j.legA.knee, j.legA.ankle, m.legR * 1.9, spec.bottom);
  shoeSide(ctx, j.legA.ankle, m, pal, 1);
  // cabeza
  headSide(ctx, j.head, m, spec, pal, blink, false);
  // brazo cercano sobre el muslo
  limb(ctx, j.armA.sh, j.armA.el, j.armA.hand, m.armR * 1.9, spec.suit ? spec.suit!.lapel : spec.top);
  disc(ctx, j.armA.hand, m.armR * 1.05, pal.skin);
  drawProp(ctx, j.armA.hand, m, pal, 0);
}

function renderLie(ctx: Ctx, m: Metrics, spec: CharacterDetailSpec, pal: Palette, t: number): void {
  const H = m.H;
  const far = (c: string): string => shade(c, -0.14);
  const breath = Math.sin(t * Math.PI * 2);
  const baseY = 0.1 * H + 0.006 * H * breath;
  shadow(ctx, -0.02 * H, 0.52 * H, 0.05 * H);
  // pierna lejana
  capsule(ctx, { x: 0.16 * H, y: baseY - 0.02 * H }, { x: 0.52 * H, y: baseY - 0.035 * H }, m.legR * 1.7, far(spec.bottom));
  blob(ctx, { x: 0.56 * H, y: baseY - 0.03 * H }, m.footL * 0.5, m.footH * 0.6, 0, shade(pal.shoe, -0.16));
  // brazo lejano
  capsule(ctx, { x: -0.2 * H, y: baseY + 0.02 * H }, { x: 0.08 * H, y: baseY - 0.05 * H }, m.armR * 1.6, far(spec.suit ? spec.suit!.lapel : spec.top));
  // torso horizontal (el pecho respira)
  const chest = m.torsoW * (2.05 + 0.12 * breath);
  capsule(ctx, { x: -0.2 * H, y: baseY + 0.01 * H }, { x: 0.17 * H, y: baseY }, chest, spec.suit ? spec.suit!.lapel : spec.top);
  // cinturón vertical
  if (pal.strap) capsule(ctx, { x: 0.15 * H, y: baseY - 0.05 * H }, { x: 0.15 * H, y: baseY + 0.06 * H }, 0.035 * H, pal.strap);
  // pierna cercana
  capsule(ctx, { x: 0.17 * H, y: baseY + 0.02 * H }, { x: 0.53 * H, y: baseY }, m.legR * 1.7, spec.bottom);
  blob(ctx, { x: 0.57 * H, y: baseY + 0.005 * H }, m.footL * 0.5, m.footH * 0.6, 0, pal.shoe);
  // cabeza (boca arriba, cara hacia arriba-izquierda)
  const headC: V = { x: -0.36 * H, y: baseY + 0.035 * H + m.headR * 0.35 };
  disc(ctx, headC, m.headR, pal.skin);
  // pelo en la nuca (lado izquierdo-abajo)
  band(ctx, headC, m.headR * 0.97, m.headR * 0.4, Math.PI * 0.72, Math.PI * 1.5, pal.hair);
  // cara hacia arriba: ojo cerrado, nariz, bigote
  capsule(ctx, { x: headC.x - m.headR * 0.05, y: headC.y + m.headR * 0.6 }, { x: headC.x + m.headR * 0.28, y: headC.y + m.headR * 0.6 }, m.headR * 0.06, shade(pal.ink, 0.25));
  disc(ctx, { x: headC.x - m.headR * 0.2, y: headC.y + m.headR * 0.98 }, m.headR * 0.2, shade(pal.skin, -0.06));
  if (pal.mustache) blob(ctx, { x: headC.x - m.headR * 0.02, y: headC.y + m.headR * 0.78 }, m.headR * 0.24, m.headR * 0.1, 0.2, pal.mustache);
  if (pal.lensFill) {
    ctx.beginPath();
    ctx.arc(headC.x + m.headR * 0.12, headC.y + m.headR * 0.5, m.headR * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = pal.lensFill;
    ctx.fill();
    ctx.strokeStyle = pal.lensLine;
    ctx.lineWidth = OL;
    ctx.stroke();
  }
  // brazo cercano sobre el pecho
  capsule(ctx, { x: -0.18 * H, y: baseY + 0.07 * H }, { x: 0.05 * H, y: baseY + 0.05 * H }, m.armR * 1.7, spec.suit ? spec.suit!.lapel : spec.top);
  disc(ctx, { x: 0.07 * H, y: baseY + 0.05 * H }, m.armR * 1.0, pal.skin);
}

// ────────────────────────────── horneado del atlas ──────────────────────────────

function drawFrameInto(
  ctx: Ctx,
  spec: CharacterDetailSpec,
  pal: Palette,
  row: SheetRow,
  rowIndex: number,
  col: number,
  layout: SheetLayout,
): void {
  const fw = layout.frameWidth;
  const fh = layout.frameHeight;
  const m = metricsOf(spec);
  const t = col / layout.columns;
  ctx.save();
  // pies en el borde inferior (margen 3% del frame), figura centrada
  ctx.translate(col * fw + fw / 2, rowIndex * fh + fh - fh * 0.035);
  const s = fw / SHEET_QUAD_M; // px por metro
  ctx.scale(s, -s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const blink = row === 'idle' && col === 5;
  const mouthOpen = row === 'talk' && Math.sin(t * Math.PI * 4) > -0.2;
  try {
    if (row === 'idle') {
      renderSideFigure(ctx, idleJoints(m, spec, t), m, spec, pal, { blink, mouthOpen: false, showFace: true });
    } else if (row === 'walk_right') {
      renderSideFigure(ctx, walkSideJoints(m, spec, t), m, spec, pal, { blink: false, mouthOpen: false, showFace: true });
    } else if (row === 'walk_left') {
      // espejo exacto de walk_right: misma zancada, mirando a −x de pantalla
      ctx.scale(-1, 1);
      renderSideFigure(ctx, walkSideJoints(m, spec, t), m, spec, pal, { blink: false, mouthOpen: false, showFace: true });
    } else if (row === 'walk_down') {
      renderFrontFigure(ctx, walkFrontJoints(m, spec, t), m, spec, pal, false, { blink: false, mouthOpen: false });
    } else if (row === 'walk_up') {
      renderFrontFigure(ctx, walkFrontJoints(m, spec, t), m, spec, pal, true, { blink: false, mouthOpen: false });
    } else if (row === 'sit') {
      renderSit(ctx, sitJoints(m, spec, t), m, spec, pal, col === 5);
    } else if (row === 'talk') {
      renderSideFigure(ctx, talkJoints(m, spec, t), m, spec, pal, { blink: false, mouthOpen, showFace: true });
    } else if (row === 'lie') {
      renderLie(ctx, m, spec, pal, t);
    }
  } catch {
    /* un frame fallido no tumba la partida: la celda queda transparente */
  }
  ctx.restore();
}

type Ctx2D = CanvasRenderingContext2D;

/**
 * v1.47 — HORNEADO EN CANVAS SUELTO: dibuja el atlas completo (8 filas × N columnas) en un
 * HTMLCanvasElement normal. Es la fuente de DOS salidas: la textura del juego (vía dataURL,
 * el único camino que sube a GPU en este entorno) y el PNG descargable de referencia del
 * arte final (?artref=1). Sin escena, sin motor: servible también fuera de partida.
 */
export function bakeCharacterSheetCanvas(
  spec: CharacterDetailSpec,
  layout: SheetLayout,
): HTMLCanvasElement | null {
  if (!spec?.skin) return null;
  const c = document.createElement('canvas');
  c.width = layout.frameWidth * layout.columns;
  c.height = layout.frameHeight * 8;
  const ctx = c.getContext('2d', { willReadFrequently: true }) as Ctx2D | null;
  if (!ctx) return null;
  ctx.clearRect(0, 0, c.width, c.height);
  const pal = buildPalette(spec);
  for (const row of SHEET_ROW_NAMES) {
    const rowIndex = layout.rows[row] ?? 0;
    for (let col = 0; col < layout.columns; col++) {
      drawFrameInto(ctx, spec, pal, row, rowIndex, col, layout);
    }
  }
  return c;
}

/**
 * Hornea el atlas procedural del arquetipo (8 filas × N columnas) como Texture de escena.
 * v1.47 — CAMINO DEL PNG VERIFICADO: el DynamicTexture de este entorno (WebGPU/CDN) no sube
 * el canvas a la GPU (la hoja se veía lisa/invisible — la misma enfermedad de las losas y de
 * los decals v1.40). Ahora el atlas nace en bakeCharacterSheetCanvas y sube por
 * Texture(dataURL) vía updateURL, el camino verificado de macetas/candado/decals.
 */
export function bakeCharacterSheetTexture(
  scene: Scene,
  id: string,
  spec: CharacterDetailSpec,
  layout: SheetLayout,
): BTexture | null {
  const { Texture } = B();
  const canvas = bakeCharacterSheetCanvas(spec, layout);
  if (!canvas) return null;
  const tex = new Texture(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    scene,
    false,
    true,
  );
  tex.name = `${id}_sheet`;
  tex.hasAlpha = true;
  tex.wrapU = 0; // WRAP: el UV-pan del frame cae dentro del atlas, el clamp evita sangrado
  tex.wrapV = 0;
  tex.updateURL(canvas.toDataURL('image/png'));
  return tex;
}

// ────────────────────────────── el rig de hoja (quad + animator) ──────────────────────────────

const WALK_ROWS: ReadonlySet<string> = new Set(['walk_right', 'walk_left', 'walk_down', 'walk_up']);
const TALK_GESTURES = new Set(['talk', 'argue', 'laugh']);

/**
 * Crea el rig de hoja de sprites: si `sheetUrl` existe (arte externo del manifiesto) carga
 * ese PNG; si no, hornea el procedural. Devuelve null solo si ni eso es posible (entonces
 * el caller cae al billboard estático / rig glTF).
 */
export function buildCharacterSheet(
  scene: Scene,
  id: string,
  spec: CharacterDetailSpec,
  height: number,
  sheetUrl: string | null,
  layoutOverride?: Partial<SheetLayout>,
): CharacterSheetRig | null {
  const { Color3, Mesh, MeshBuilder, StandardMaterial, Texture, TransformNode } = B();
  if (!spec || height <= 0) return null;
  const layout: SheetLayout = { ...DEFAULT_SHEET_LAYOUT, ...layoutOverride };
  const rowsCount = Math.max(...SHEET_ROW_NAMES.map((r) => (layout.rows[r] ?? 0) + 1));
  const cols = layout.columns;

  const tex = sheetUrl
    ? (() => {
        const t = new Texture(sheetUrl, scene, true, true);
        t.hasAlpha = true;
        t.wrapU = 0;
        t.wrapV = 0;
        return t;
      })()
    : bakeCharacterSheetTexture(scene, id, spec, layout);
  if (!tex) return null;

  const mat = new StandardMaterial(`${id}_sheet_mat`, scene);
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  mat.transparencyMode = 1; // ALPHATEST: profundidad por píxel
  mat.alphaCutOff = 0.3;
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;

  const fw = layout.frameWidth;
  const fh = layout.frameHeight;
  const quadH = SHEET_QUAD_M;
  const quadW = quadH * (fw / Math.max(1, fh));
  const root = new TransformNode(`${id}_sheet_root`, scene);
  const quad = MeshBuilder.CreatePlane(`${id}_sheet_quad`, { width: quadW, height: quadH }, scene);
  quad.material = mat;
  quad.isPickable = false;
  // anclaje: el margen de pies del frame (3.5% del frame) cuelga por debajo del centro
  quad.position.y = quadH * (0.5 - 0.035);
  quad.billboardMode = Mesh.BILLBOARDMODE_Y;
  quad.parent = root;
  quad.setEnabled(false);

  // UV por defecto: un frame concreto (se actualiza por frame de animación)
  tex.uScale = 1 / cols;
  tex.vScale = 1 / rowsCount;

  // v1.47 — las DOS procedencias (PNG externo y atlas procedural vía dataURL) cargan async:
  // `ready` salta con onLoadObservable en ambos casos (el quad no se muestra hasta entonces).
  let ready = false;
  let disposed = false;
  tex.onLoadObservable.addOnce(() => {
    if (!disposed) ready = true;
  });

  let fade = 1;
  let lastFade = -1;
  let view: SheetRow = 'idle';
  // fases: los 4 andares COMPARTEN fase (el cambio de dirección no reinicia la zancada)
  let walkPhase = 0;
  let miscPhase = 0;

  return {
    root,
    get ready() {
      return ready;
    },
    get view() {
      return view;
    },
    supportsPoses: true,
    setEnabled(v: boolean) {
      root.setEnabled(v);
      if (!v) quad.setEnabled(false);
    },
    setFade(v: number) {
      fade = v;
      if (v === lastFade) return;
      lastFade = v;
      quad.visibility = v;
    },
    sync(dt: number, state: SheetFrameState) {
      if (!ready) return;

      // ── fila por ESTADO del actor (prioridad: tumbado > sentado > gesto/charla > andar > idle) ──
      let wanted: SheetRow = 'idle';
      if (state.lying) wanted = 'lie';
      else if (state.seated || state.gesture === 'sit') wanted = 'sit';
      else if (state.gesture && TALK_GESTURES.has(state.gesture)) wanted = 'talk';
      else if (state.chatting) wanted = 'talk';
      else if (state.speedH > 0.15) {
        // dirección por ángulo cámara↔rumbo — signo verificado (left-handed: R = (−dz, dx))
        const fx = Math.cos(state.yaw);
        const fz = -Math.sin(state.yaw);
        const dx = state.camPos.x - state.pos.x;
        const dz = state.camPos.z - state.pos.z;
        const len = Math.max(1e-4, Math.hypot(dx, dz));
        const dot = (dx / len) * fx + (dz / len) * fz;
        const side = dx * fz - dz * fx; // f·R normalizado
        if (dot > 0.5) wanted = 'walk_down';
        else if (dot < -0.5) wanted = 'walk_up';
        else wanted = side > 0 ? 'walk_right' : 'walk_left';
      }

      // ── avance de fase (fps del manifiesto; los andares comparten fase y escalan con la velocidad) ──
      if (wanted !== view) {
        view = wanted;
        quad.setEnabled(true);
      }
      const baseFps = layout.fps[view] ?? 6;
      const rate = WALK_ROWS.has(view) ? Math.min(1.55, Math.max(0.75, 0.72 + state.speedH * 0.55)) : 1;
      if (WALK_ROWS.has(view)) {
        walkPhase += dt * baseFps * rate;
        miscPhase = 0;
      } else {
        miscPhase += dt * baseFps;
        walkPhase = 0;
      }
      const phase = WALK_ROWS.has(view) ? walkPhase : miscPhase;
      const col = Math.floor(phase) % cols;
      const rowIndex = layout.rows[view] ?? 0;

      // ── UV del frame: u = col/cols · v = fila (origen de textura abajo-izquierda) ──
      tex.uOffset = col / cols;
      tex.vOffset = 1 - (rowIndex + 1) / rowsCount;

      // ── anclaje: pies en el suelo (el quad pivota en su borde inferior − margen del frame) ──
      root.position.set(state.pos.x, state.groundY, state.pos.z);
      quad.visibility = state.fade;
    },
    dispose() {
      disposed = true;
      quad.dispose(false, true);
      root.dispose(false, true);
      mat.dispose();
      tex.dispose();
    },
  };
}
