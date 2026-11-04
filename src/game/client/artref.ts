import type { Content } from '@/game/core/types';
import { STATIC_EXPORT } from '@/game/support/paths';
import {
  DEFAULT_SHEET_LAYOUT,
  SHEET_ROW_NAMES,
  bakeCharacterSheetCanvas,
} from './character-sheet';

/**
 * v1.47 — REFERENCIA DE ARTE DEL PERSONAJE (?artref=1): overlay de QA con la HOJA DE
 * SPRITES del arquetipo elegido, la REGLA de la retícula y descarga directa del PNG.
 *
 * Para qué: el vecino pidió «la imagen del PNG de un personaje para descargarla y tenerla
 * de referencia para montar el arte final». Este panel entrega exactamente eso:
 *   · La hoja completa 8×8 (idle, walk_right, walk_left, walk_down, walk_up, sit, talk, lie)
 *     — la retícula que el arte externo debe respetar (character-sprites.json).
 *   · El PNG SUELTO (sin etiquetas, fondo transparente) listo para descargar.
 *   · La hoja ANOTADA (etiquetas de fila + regla al pie) como referencia visual.
 *   · El TURNOAROUND de 3 vistas (perfil / frente / espalda) en grande.
 *
 * Herramienta de QA/dev: sus textos van aquí (no son contenido del juego).
 */

interface ArtRefStrings {
  title: string;
  subtitle: string;
  archetype: string;
  downloadSheet: string;
  downloadAnnotated: string;
  downloadTurnaround: string;
  close: string;
  ruleLine1: string;
  ruleLine2: string;
  ruleLine3: string;
  rowLabels: Record<string, string>;
  viewSide: string;
  viewFront: string;
  viewBack: string;
  frameLabel: string;
  hint: string;
  saveProject: string;
  saved: string;
  saving: string;
}

const STR: ArtRefStrings = {
  title: 'Referencia de arte · personaje',
  subtitle: 'Hoja de sprites generada — la retícula que debe respetar el arte final',
  archetype: 'Personaje',
  downloadSheet: 'Descargar hoja limpia (PNG)',
  downloadAnnotated: 'Descargar hoja anotada (PNG)',
  downloadTurnaround: 'Descargar 3 vistas (PNG)',
  close: 'Cerrar',
  ruleLine1: 'Retícula: 8 columnas × 8 filas · frame 256×256 px · pies abajo (margen 3 %) · figura centrada',
  ruleLine2: 'walk_right mira a la DERECHA de pantalla (walk_left es su espejo exacto)',
  ruleLine3: 'Filas (de arriba a abajo): idle · walk_right · walk_left · walk_down (de frente) · walk_up (de espaldas) · sit · talk · lie',
  rowLabels: {
    idle: 'idle · quieto (6 fps)',
    walk_right: 'walk_right · andar → (10 fps)',
    walk_left: 'walk_left · andar ← (10 fps)',
    walk_down: 'walk_down · andar de frente (10 fps)',
    walk_up: 'walk_up · andar de espaldas (10 fps)',
    sit: 'sit · sentado (3 fps)',
    talk: 'talk · hablando (8 fps)',
    lie: 'lie · tumbado (2 fps)',
  },
  viewSide: 'PERFIL',
  viewFront: 'FRENTE',
  viewBack: 'ESPALDA',
  frameLabel: '256 px',
  hint: 'El arte externo (character-sprites.json) sustituye a esta hoja automáticamente si respeta la retícula.',
  saveProject: 'Guardar PNGs en /art/preview/',
  saved: 'Guardado ✓',
  saving: 'Guardando…',
};

const downloadCanvas = (canvas: HTMLCanvasElement, filename: string): void => {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, 'image/png');
};

/** Hoja ANOTADA: atlas + columna de etiquetas a la izquierda + regla al pie (fondo oscuro). */
const buildAnnotatedCanvas = (atlas: HTMLCanvasElement): HTMLCanvasElement => {
  const LABEL_W = 300;
  const FOOT_H = 150;
  const c = document.createElement('canvas');
  c.width = LABEL_W + atlas.width;
  c.height = atlas.height + FOOT_H;
  const ctx = c.getContext('2d');
  if (!ctx) return atlas;
  ctx.fillStyle = '#22252b';
  ctx.fillRect(0, 0, c.width, c.height);
  // cuadrícula tenue por frame (guía de alineación para el arte externo)
  const fh = DEFAULT_SHEET_LAYOUT.frameHeight;
  const fw = DEFAULT_SHEET_LAYOUT.frameWidth;
  const cols = DEFAULT_SHEET_LAYOUT.columns;
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  for (let r = 0; r <= 8; r++) {
    ctx.beginPath();
    ctx.moveTo(LABEL_W, r * fh + 0.5);
    ctx.lineTo(LABEL_W + atlas.width, r * fh + 0.5);
    ctx.stroke();
  }
  for (let k = 0; k <= cols; k++) {
    ctx.beginPath();
    ctx.moveTo(LABEL_W + k * fw + 0.5, 0);
    ctx.lineTo(LABEL_W + k * fw + 0.5, atlas.height);
    ctx.stroke();
  }
  // etiquetas de fila
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  SHEET_ROW_NAMES.forEach((row, i) => {
    const cy = i * fh + fh / 2;
    ctx.fillStyle = '#f2d16b';
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.fillText(`${i}`, 26, cy - 22);
    ctx.fillStyle = '#e8e5de';
    ctx.font = '24px Arial, sans-serif';
    const label = STR.rowLabels[row] ?? row;
    // parte antes del «·» en negrita, el resto normal
    const dot = label.indexOf(' · ');
    ctx.font = 'bold 26px Arial, sans-serif';
    ctx.fillText(dot > 0 ? label.slice(0, dot) : label, 52, cy - (dot > 0 ? 16 : 0));
    if (dot > 0) {
      ctx.font = '22px Arial, sans-serif';
      ctx.fillStyle = '#b7b3a8';
      ctx.fillText(label.slice(dot + 3), 52, cy + 18);
    }
  });
  // atlas encima (respetando transparencias sobre el fondo oscuro)
  ctx.drawImage(atlas, LABEL_W, 0);
  // pie: la regla
  ctx.fillStyle = '#f2d16b';
  ctx.font = 'bold 26px Arial, sans-serif';
  ctx.fillText(STR.ruleLine1, 26, atlas.height + 36);
  ctx.fillStyle = '#e8e5de';
  ctx.fillText(STR.ruleLine2, 26, atlas.height + 74);
  ctx.fillText(STR.ruleLine3, 26, atlas.height + 112);
  return c;
};

/** Turnaround: perfil (idle f0), frente (walk_down f0) y espalda (walk_up f0) a 512 px. */
const buildTurnaroundCanvas = (atlas: HTMLCanvasElement): HTMLCanvasElement => {
  const FH = DEFAULT_SHEET_LAYOUT.frameHeight;
  const FW = DEFAULT_SHEET_LAYOUT.frameWidth;
  const OUT = 512;
  const PAD = 56;
  const LABEL_H = 64;
  const c = document.createElement('canvas');
  c.width = PAD * 4 + OUT * 3;
  c.height = PAD + OUT + LABEL_H + PAD;
  const ctx = c.getContext('2d');
  if (!ctx) return atlas;
  ctx.fillStyle = '#22252b';
  ctx.fillRect(0, 0, c.width, c.height);
  const rows = DEFAULT_SHEET_LAYOUT.rows;
  const drawView = (rowIndex: number, label: string, slot: number): void => {
    const dx = PAD + slot * (OUT + PAD);
    ctx.drawImage(atlas, 0, rowIndex * FH, FW, FH, dx, PAD, OUT, OUT);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f2d16b';
    ctx.font = 'bold 34px Arial, sans-serif';
    ctx.fillText(label, dx + OUT / 2, PAD + OUT + 12);
  };
  drawView(rows.idle ?? 0, STR.viewSide, 0);
  drawView(rows.walk_down ?? 3, STR.viewFront, 1);
  drawView(rows.walk_up ?? 4, STR.viewBack, 2);
  return c;
};

/** Abre el overlay de referencia. Idempotente (si ya está abierto, lo rellena de nuevo). */
export function openArtReference(content: Content): void {
  const prev = document.getElementById('vecinos-artref');
  if (prev) prev.remove();
  const catalog = content.characterDetails;
  const root = document.createElement('div');
  root.id = 'vecinos-artref';
  root.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9999', 'display:flex', 'align-items:center', 'justify-content:center',
    'background:rgba(12,14,18,0.82)', 'padding:18px', 'box-sizing:border-box',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'background:#f7f4ec', 'color:#2b2a26', 'border-radius:14px', 'box-shadow:0 18px 60px rgba(0,0,0,0.5)',
    'max-width:min(1060px, 96vw)', 'max-height:94vh', 'display:flex', 'flex-direction:column',
    'padding:18px 20px', 'gap:10px', 'font-family:Arial, sans-serif',
  ].join(';');
  root.appendChild(card);

  // cabecera
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;';
  const title = document.createElement('div');
  title.textContent = STR.title;
  title.style.cssText = 'font-size:20px;font-weight:800;';
  const sub = document.createElement('div');
  sub.textContent = STR.subtitle;
  sub.style.cssText = 'font-size:13px;color:#6b675c;';
  head.appendChild(title);
  head.appendChild(sub);
  card.appendChild(head);

  // selector de arquetipo + botones
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;';
  const label = document.createElement('label');
  label.textContent = STR.archetype + ':';
  label.style.cssText = 'font-size:13px;font-weight:700;';
  const sel = document.createElement('select');
  sel.style.cssText = 'padding:7px 10px;border-radius:8px;border:2px solid #2b2a26;font-size:14px;background:#fff;';
  const ids = catalog ? Object.keys(catalog.byArchetype) : [];
  for (const id of ids) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    if (id === 'presidente') opt.selected = true;
    sel.appendChild(opt);
  }
  bar.appendChild(label);
  bar.appendChild(sel);
  const mkBtn = (text: string, primary: boolean): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = [
      'padding:9px 14px', 'border-radius:9px', 'font-size:13px', 'font-weight:700', 'cursor:pointer',
      primary ? 'background:#e08a2e;color:#fff;border:2px solid #a15c12;' : 'background:#fff;color:#2b2a26;border:2px solid #2b2a26;',
    ].join(';');
    return b;
  };
  const btnSheet = mkBtn(STR.downloadSheet, true);
  const btnAnnotated = mkBtn(STR.downloadAnnotated, false);
  const btnTurn = mkBtn(STR.downloadTurnaround, false);
  const btnSave = mkBtn(STR.saveProject, false);
  const spacer = document.createElement('div');
  spacer.style.cssText = 'flex:1;';
  const btnClose = mkBtn(STR.close, false);
  bar.append(btnSheet, btnAnnotated, btnTurn, btnSave, spacer, btnClose);
  card.appendChild(bar);

  // visor (con scroll interno)
  const viewer = document.createElement('div');
  viewer.style.cssText = [
    'overflow:auto', 'background:#22252b', 'border-radius:10px', 'padding:8px',
    'min-height:220px', 'flex:1', 'display:flex', 'align-items:flex-start', 'justify-content:center',
  ].join(';');

  let raw: HTMLCanvasElement | null = null;
  const stash = (w: unknown): void => {
    (window as unknown as { __vecinosArtRef?: unknown }).__vecinosArtRef = w;
  };
  const render = (): void => {
    const id = sel.value;
    const spec = catalog ? (catalog.byArchetype[id] ?? catalog.defaults) : undefined;
    if (!spec) return;
    raw = bakeCharacterSheetCanvas(spec, DEFAULT_SHEET_LAYOUT);
    viewer.textContent = '';
    if (!raw) {
      const err = document.createElement('div');
      err.textContent = 'No se pudo generar la hoja para ' + id;
      err.style.cssText = 'color:#f2b8b8;padding:30px;font-size:14px;';
      viewer.appendChild(err);
      stash(null);
      return;
    }
    const annotated = buildAnnotatedCanvas(raw);
    annotated.style.cssText = 'width:100%;max-width:940px;height:auto;display:block;border-radius:6px;';
    viewer.appendChild(annotated);
    // QA/E2E: los tres canvas del arquetipo vigente (verificación y horneado).
    stash({ archetype: id, raw, annotated: buildAnnotatedCanvas(raw), turnaround: buildTurnaroundCanvas(raw) });
  };
  sel.addEventListener('change', render);
  card.appendChild(viewer);

  const hint = document.createElement('div');
  hint.textContent = STR.hint + ' ' + STR.ruleLine1 + '. ' + STR.ruleLine2 + '.';
  hint.style.cssText = 'font-size:12px;color:#6b675c;';
  card.appendChild(hint);

  btnSheet.addEventListener('click', () => {
    if (raw) downloadCanvas(raw, `vecinos_${sel.value}_spritesheet_8x8.png`);
  });
  btnAnnotated.addEventListener('click', () => {
    if (raw) downloadCanvas(buildAnnotatedCanvas(raw), `vecinos_${sel.value}_referencia.png`);
  });
  btnTurn.addEventListener('click', () => {
    if (raw) downloadCanvas(buildTurnaroundCanvas(raw), `vecinos_${sel.value}_3vistas.png`);
  });
  // Guardar en el proyecto: persiste los 3 PNG bajo public/art/preview/ (URL estable para descargar).
  // v1.77 — en export estático el handler hace descarga directa (ver STATIC_EXPORT arriba).
  btnSave.addEventListener('click', () => {
    if (!raw) return;
    // v1.77 — export estático: no hay /api/artref-save; fallback honesto = descarga
    // directa de los 3 PNG al equipo (la herramienta de arte sigue sirviendo offline).
    if (STATIC_EXPORT) {
      downloadCanvas(raw, `vecinos_${sel.value}_spritesheet_8x8.png`);
      downloadCanvas(buildAnnotatedCanvas(raw), `vecinos_${sel.value}_referencia.png`);
      downloadCanvas(buildTurnaroundCanvas(raw), `vecinos_${sel.value}_3vistas.png`);
      btnSave.textContent = 'Descargado (export estático)';
      setTimeout(() => { btnSave.textContent = STR.saveProject; }, 2200);
      return;
    }
    const set = { raw, annotated: buildAnnotatedCanvas(raw), turnaround: buildTurnaroundCanvas(raw) };
    btnSave.disabled = true;
    btnSave.textContent = STR.saving;
    const items: [HTMLCanvasElement, string][] = [
      [set.raw, `vecinos_${sel.value}_spritesheet_8x8`],
      [set.annotated, `vecinos_${sel.value}_referencia`],
      [set.turnaround, `vecinos_${sel.value}_3vistas`],
    ];
    void Promise.all(
      items.map(([c, name]) =>
        fetch('/api/artref-save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, dataUrl: c.toDataURL('image/png') }),
        }).then((r) => r.json()),
      ),
    )
      .then((res) => {
        const ok = Array.isArray(res) && res.every((x) => (x as { ok?: boolean }).ok);
        btnSave.textContent = ok ? STR.saved : 'Error al guardar';
      })
      .catch(() => {
        btnSave.textContent = 'Error al guardar';
      })
      .finally(() => {
        btnSave.disabled = false;
        setTimeout(() => {
          btnSave.textContent = STR.saveProject;
        }, 2500);
      });
  });
  btnClose.addEventListener('click', () => root.remove());
  root.addEventListener('click', (e) => {
    if (e.target === root) root.remove();
  });

  document.body.appendChild(root);
  render();
}
