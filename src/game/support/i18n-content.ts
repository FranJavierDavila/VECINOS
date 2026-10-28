import type { Content } from '@/game/core/types';

/** Idioma del chrome (espejo de options.ts sin importar la capa cliente). */
type Lang = 'es' | 'en';

/**
 * i18n DE CONTENIDO (v1.39) — las plantillas narrativas también hablan inglés.
 *
 * El idioma de origen del proyecto es el español: los catálogos (misiones, diálogos,
 * avisos del ecosistema, mensajes de canales) se escriben en ES. Este overlay aplica un
 * DICCIONARIO ES→EN (public/content/translations.en.json) sobre los catálogos narrativos
 * cuando el jugador elige «English», y los restaura al volver a «Español».
 *
 * Se aplica DESPUÉS de cargar el contenido y ANTES de expandir tokens estructurales
 * (applyStaticTokens), para que las traducciones también reciban {plantas}/{blk:id}.
 * El sim solo lee textos aquí vivos: traducir no toca gameplay ni determinismo.
 */

let originals: Pick<Content, 'missions' | 'dialogs' | 'influences' | 'ecosystem'> | null = null;
let appliedLang: Lang = 'es';

type Dict = Record<string, string>;
let dict: Dict | null = null;
let loading: Promise<void> | null = null;

async function loadDict(): Promise<void> {
  if (dict) return;
  loading ??= (async () => {
    try {
      const res = await fetch('/content/translations.en.json');
      if (res.ok) dict = (await res.json()) as Dict;
    } catch {
      dict = {};
    }
  })();
  await loading;
}

/** Precarga (el controller la llama al inicializar; traducir no bloquea el arranque). */
export function preloadTranslations(): void {
  void loadDict();
}

const tr = (s: string): string => (dict && dict[s]) || s;

/** Sustituye cadenas dentro de estructuras del catálogo (mutación en sitio, como los tokens). */
function walk(o: unknown): void {
  if (Array.isArray(o)) {
    for (let i = 0; i < o.length; i++) {
      if (typeof o[i] === 'string') o[i] = tr(o[i] as string);
      else walk(o[i]);
    }
  } else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      // Los campos estructurales (ids, claves, referencias) NUNCA se tocan: solo textos.
      if (k === 'id' || k === 'dialog' || k === 'mission' || k === 'minigame' || k === 'block' || k === 'target' || k === 'defId') continue;
      if (typeof v === 'string') (o as Record<string, unknown>)[k] = tr(v);
      else walk(v);
    }
  }
}

/**
 * Aplica (o restaura) el idioma sobre los catálogos narrativos del contenido.
 * Idempotente: guarda los originales la primera vez que traduce y desde ahí alterna.
 */
export function applyContentLanguage(content: Content, lang: Lang): void {
  if (lang === appliedLang) return;
  if (lang === 'es') {
    if (originals) {
      content.missions = originals.missions;
      content.dialogs = originals.dialogs;
      content.influences = originals.influences;
      content.ecosystem = originals.ecosystem;
      originals = null;
    }
    appliedLang = 'es';
    return;
  }
  // Traducir: conserva los originales para poder volver a ES sin recargar.
  if (!originals) {
    originals = {
      missions: content.missions,
      dialogs: content.dialogs,
      influences: content.influences,
      ecosystem: content.ecosystem,
    };
  }
  if (dict === null) {
    // Diccionario aún en vuelo: se aplicará cuando llegue (ver applyContentLanguageAsync).
    appliedLang = 'en';
    return;
  }
  walk(content.missions);
  walk(content.dialogs);
  walk(content.influences);
  walk(content.ecosystem);
  appliedLang = 'en';
}

/** Versión asíncrona: garantiza el diccionario antes de traducir (el arranque la usa). */
export async function applyContentLanguageAsync(content: Content, lang: Lang): Promise<void> {
  await loadDict();
  appliedLang = 'es'; // fuerza el pase aunque el idioma no haya cambiado desde el arranque
  applyContentLanguage(content, lang);
}

/** ¿El diccionario de traducciones ya está disponible? (QA/arranque). */
export function translationsReady(): boolean {
  return dict !== null;
}
