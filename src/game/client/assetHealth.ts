'use client';

/**
 * ── Salud de assets (v1.47) ─────────────────────────────────────────────────────
 * Síntoma que motivó esto: si el servidor de assets (dev server) está caído,
 * TODAS las cargas fallan a la vez — texturas en blanco («no se ve nada») y
 * vecinos en cápsula greybox (los glTF no llegaron). El jugador ve un mundo
 * roto sin saber por qué.
 *
 * Este rastreador cuenta los fallos de carga que reportan los cargadores de
 * arte (diorama, locals, árboles, glTF de actores). Si se supera el umbral,
 * declara APAGÓN: muestra un overlay a pantalla completa «reconectando» con
 * cuenta atrás y recarga la página (el reload reintentará todo el fetch).
 * Los éxitos consecutivos cancelan el apagón (una sola textura perdida no es
 * un apagón; puede ser un asset que falta de verdad).
 *
 * Es resiliencia de motor: no toca el sim, no lee reglas, no guarda estado.
 * Los textos van por el diccionario i18n (claves 'assets.*') como el resto
 * del chrome de UI.
 */

import { translate } from './i18n';
import { useGameStore } from './store';

/** Fallos acumulados (no consecutivos) antes de declarar apagón. */
const FAILURE_THRESHOLD = 4;
/** Éxitos consecutivos necesarios para dar por resuelto un apagón anunciado. */
const OK_STREAK_CANCEL = 3;
/** Segundos de cuenta atrás antes del reload automático. */
const RETRY_SECS = 8;

let failures = 0;
let okStreak = 0;
let overlay: HTMLDivElement | null = null;
let label: HTMLDivElement | null = null;
let countdown = 0;
let counting = false;

const t = (): string => translate(useGameStore.getState().lang, 'assets.outage');

function ensureOverlay(): void {
  if (overlay && overlay.isConnected) return;
  if (typeof document === 'undefined') return;
  overlay = document.createElement('div');
  overlay.id = 'vecinos_asset_outage';
  overlay.setAttribute('role', 'alert');
  overlay.setAttribute('aria-live', 'assertive');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(20,18,16,0.86);color:#f5efe4;font:600 15px/1.5 system-ui,sans-serif;text-align:center;';
  label = document.createElement('div');
  label.style.cssText = 'padding:24px 32px;border:2px dashed #c9a86a;border-radius:14px;max-width:520px;';
  overlay.appendChild(label);
  document.body.appendChild(overlay);
}

function renderLabel(): void {
  if (!label) return;
  const n = Math.max(0, countdown);
  label.textContent = t().replace('{n}', String(n));
}

function startCountdown(): void {
  if (counting) return;
  counting = true;
  ensureOverlay();
  countdown = RETRY_SECS;
  renderLabel();
  const tick = (): void => {
    if (!counting) return;
    countdown -= 1;
    if (countdown <= 0) {
      location.reload(); // reintento completo: el mundo se reconstruye con los assets de nuevo
      return;
    }
    renderLabel();
    window.setTimeout(tick, 1000);
  };
  window.setTimeout(tick, 1000);
}

function cancelCountdown(): void {
  counting = false;
  if (overlay) {
    overlay.remove();
    overlay = null;
    label = null;
  }
}

/** Reporta un fallo de carga de asset (URL solo para el log de consola). */
export function reportAssetFailure(url: string): void {
  okStreak = 0;
  failures += 1;
  if (failures >= FAILURE_THRESHOLD && !counting) {
    console.error(`[assets] apagón detectado (${failures} fallos; último: ${url}); overlay de reconexión activo`);
    startCountdown();
  }
}

/** Reporta una carga de asset exitosa: los éxitos consecutivos cancelan el apagón. */
export function reportAssetOk(): void {
  if (failures === 0) return;
  okStreak += 1;
  if (okStreak >= OK_STREAK_CANCEL && counting) cancelCountdown();
}
