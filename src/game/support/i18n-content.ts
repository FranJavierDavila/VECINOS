import type { Content } from '@/game/core/types';
import { withBase } from '@/game/support/paths';

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
 *
 * v1.41 — SNAPSHOT ÚNICO: el clon ES se captura UNA sola vez (en el PRIMER pase a EN).
 * Antes se guardaba la REFERENCIA (el walk la mutaba: restaurar era un no-op) y después
 * se re-guardaba en cada apply — si el overlay corría dos veces (doble restart), el
 * segundo «original» era contenido ya en EN y volver a ES quedaba envenenado. Ahora el
 * snapshot nace siempre de contenido castellano y la ida y vuelta ES↔EN es idempotente.
 */

type SnapshotKeys = 'missions' | 'dialogs' | 'influences' | 'ecosystem' | 'archetypes' | 'rules' | 'crossings' | 'street' | 'cutscenes' | 'minigames' | 'sounds';
let esSnapshot: Partial<Pick<Content, SnapshotKeys>> | null = null;
let appliedLang: Lang = 'es';

type Dict = Record<string, string>;
let dict: Dict | null = null;
let loading: Promise<void> | null = null;

async function loadDict(): Promise<void> {
  if (dict) return;
  loading ??= (async () => {
    try {
      const res = await fetch(withBase('/content/translations.en.json'));
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

function snapshotOf(content: Content): Partial<Pick<Content, SnapshotKeys>> {
  return {
    missions: structuredClone(content.missions),
    dialogs: structuredClone(content.dialogs),
    influences: structuredClone(content.influences),
    ecosystem: structuredClone(content.ecosystem),
    archetypes: structuredClone(content.archetypes),
    rules: structuredClone(content.rules),
    crossings: structuredClone(content.crossings),
    street: structuredClone(content.street),
    cutscenes: structuredClone(content.cutscenes),
    minigames: structuredClone(content.minigames),
    sounds: content.sounds ? structuredClone(content.sounds) : undefined,
  };
}

function restore(content: Content): void {
  if (!esSnapshot) return;
  content.missions = esSnapshot.missions!;
  content.dialogs = esSnapshot.dialogs!;
  content.influences = esSnapshot.influences!;
  content.ecosystem = esSnapshot.ecosystem!;
  content.archetypes = esSnapshot.archetypes!;
  content.rules = esSnapshot.rules!;
  content.crossings = esSnapshot.crossings!;
  content.street = esSnapshot.street!;
  content.cutscenes = esSnapshot.cutscenes!;
  content.minigames = esSnapshot.minigames!;
  if (esSnapshot.sounds) content.sounds = esSnapshot.sounds;
}

/**
 * Aplica (o restaura) el idioma sobre los catálogos narrativos del contenido.
 * Idempotente: el snapshot ES se captura una sola vez; repetir 'en' re-pasea (no-op
 * sobre texto ya traducido) y repetir 'es' restaura el mismo clon.
 */
export function applyContentLanguage(content: Content, lang: Lang): void {
  if (lang === 'es') {
    restore(content);
    appliedLang = 'es';
    return;
  }
  // Traducir: el snapshot ES nace SIEMPRE de contenido castellano (primera vez).
  if (!esSnapshot) esSnapshot = snapshotOf(content);
  if (dict === null) {
    // Diccionario aún en vuelo: se aplicará cuando llegue (ver applyContentLanguageAsync).
    appliedLang = 'en';
    return;
  }
  walk(content.missions);
  walk(content.dialogs);
  walk(content.influences);
  walk(content.ecosystem);
  // v1.40 — «los bocadillos y avisos también en inglés»: los textos que se DICEN y se
  // AVISAN viven en más catálogos (frases de actividades, timbre/chat, avisos de misiones
  // y del ecosistema, charlas de cruce, calle, cutscenes y minijuegos). El diccionario es
  // ES→EN exacto: lo que no está traducido pasa intacto (paths, colores, ids).
  walk(content.archetypes);
  walk(content.rules);
  walk(content.crossings);
  walk(content.street);
  walk(content.cutscenes);
  walk(content.minigames);
  // v1.41 — las VOCES DE PROXIMIDAD (captions «grr…», «fiu-fiu~») también se traducen:
  // vivían en sounds.json y el pase del idioma las dejaba en castellano.
  if (content.sounds) walk(content.sounds);
  appliedLang = 'en';
}

/** Versión asíncrona: garantiza el diccionario antes de traducir (el arranque la usa). */
export async function applyContentLanguageAsync(content: Content, lang: Lang): Promise<void> {
  await loadDict();
  applyContentLanguage(content, lang);
}

/** ¿El diccionario de traducciones ya está disponible? (QA/arranque). */
export function translationsReady(): boolean {
  return dict !== null;
}

// v1.41 — sonda de QA (SOLO dev): estado del overlay observable desde el E2E.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as Record<string, unknown>).__vecinosI18n = {
    hasSnapshot: () => esSnapshot !== null,
    applied: () => appliedLang,
    dictReady: () => dict !== null,
    dictSize: () => (dict ? Object.keys(dict).length : 0),
  };
}
