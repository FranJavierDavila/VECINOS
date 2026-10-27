import type { Content, World } from '@/game/core/types';

/**
 * TEXTOS DATA-DRIVEN (v1.32) — el vecino: «Ojo, los textos que aparecen deben ser
 * data-driven: no puede ser que si el edificio tiene 3 plantas, en los mensajes hablen
 * del vecino del cuarto».
 *
 * Dos piezas:
 *  1. RESOLVER DE TOKENS — los textos del catálogo (crossings, street.reactions,
 *     avisos del controlador) admiten tokens que la presentación sustituye con los
 *     DATOS REALES del mundo:
 *       {a} / {b}        → nombres visibles de los dos vecinos del evento
 *       {planta:a}       → la palabra ordinal de la planta de A según el catálogo
 *                          (rules.texts.ordinals: «baja, primera, segunda…»)
 *       {planta:b}       → lo mismo para B
 *       {vivienda:a}     → el rótulo real de la vivienda de A («3C»)
 *       {vivienda:b}     → lo mismo para B
 *     Si el edificio cambia de plantas o letras, los textos SE ADAPTAN SOLOS.
 *
 *  2. AUDITORÍA DE CONTENIDOS — scanFloorReferences() recorre los catálogos narrativos
 *     buscando menciones LITERALES de plantas («cuarta planta») y viviendas («4C») que
 *     NO EXISTEN en los datos del mundo: la usa el QA para que el contenido jamás
 *     vuelva a descolgarse del edificio de verdad.
 */

/** Palabras ordinales del catálogo (es/en) con fallback razonable si falta el índice. */
export function floorWord(floor: number, content: Content, lang: 'es' | 'en' = 'es'): string {
  const cfg = content.rules.view.texts;
  const list = (lang === 'es' ? cfg?.ordinals : cfg?.ordinalsEn) ?? [];
  return list[floor] ?? (lang === 'es' ? `planta ${floor}` : `floor ${floor}`);
}

/** Rótulo de vivienda desde el id de bloque («blk_p3_c» → «3C») — la misma regla de types. */
export function apartmentLabel(blockId: string): string {
  const m = /^blk_p(\d+)_([a-d])$/.exec(blockId);
  return m ? `${m[1]}${m[2]!.toUpperCase()}` : blockId;
}

export interface TokenCtx {
  /** Residentes del evento (para {a}/{b}); null si el evento no los tiene. */
  a?: string;
  b?: string;
}

/** Sustituye los tokens del catálogo con los datos reales del mundo. */
export function resolveTokens(text: string, world: World, content: Content, ctx: TokenCtx): string {
  const apply = (who: string | undefined, suffix: string): string => {
    const r = who ? world.residents[who] : undefined;
    if (!r) return `?${suffix}?`;
    if (suffix === 'a' || suffix === 'b') {
      return content.archetypes[r.archetype]?.name ?? who!;
    }
    // La planta/vivienda de verdad salen de SU bloque en el mundo (no hay números a mano).
    const home = r.home ?? r.location ?? '';
    if (suffix === 'vivienda') return apartmentLabel(home);
    const m = /^blk_p(\d+)_/.exec(home);
    return m ? floorWord(Number(m[1]), content) : '?';
  };
  return text
    .replaceAll('{a}', apply(ctx.a, 'a'))
    .replaceAll('{b}', apply(ctx.b, 'b'))
    .replaceAll(/\{planta:([ab])\}/g, (_s, who: string) => apply(ctx[who as 'a' | 'b'], 'planta'))
    .replaceAll(/\{vivienda:([ab])\}/g, (_s, who: string) => apply(ctx[who as 'a' | 'b'], 'vivienda'));
}

// ── Auditoría: menciones literales que deben existir en los datos ──────────────────

const ORDINAL_TO_FLOOR: Record<string, number> = {
  baja: 0,
  primera: 1,
  segunda: 2,
  tercera: 3,
  cuarta: 4,
  quinta: 5,
  sexta: 6,
  séptima: 7,
  septima: 7,
};

const collect = (v: unknown, out: { text: string; where: string }[], where: string): void => {
  if (typeof v === 'string') {
    if (v.length > 3) out.push({ text: v, where });
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => collect(x, out, `${where}[${i}]`));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) collect(x, out, `${where}.${k}`);
  }
};

export interface FloorRefViolation {
  where: string;
  text: string;
  mention: string;
}

/**
 * Recorre los catálogos narrativos (crossings, dialogs, influences, street) y devuelve
 * las menciones de plantas/viviendas que NO existen en el mundo (p. ej. «la 4C» si no
 * hay vivienda p4_c, o «la cuarta planta» si el edificio tiene menos plantas).
 */
export function scanFloorReferences(world: World, content: Content): FloorRefViolation[] {
  const maxFloor = Math.max(...Object.values(world.blocks).map((b) => b.cell.floor));
  const floors = new Set(Object.values(world.blocks).map((b) => b.cell.floor));
  const letters = new Set(Object.keys(world.blocks).map((id) => /^blk_p\d+_([a-d])$/.exec(id)?.[1]).filter(Boolean) as string[]);
  const strings: { text: string; where: string }[] = [];
  collect(content.crossings, strings, 'crossings');
  collect(content.dialogs, strings, 'dialogs');
  collect(content.missions, strings, 'missions');
  collect(content.influences, strings, 'influences');
  collect(content.street, strings, 'street');
  collect(content.achievements, strings, 'achievements');
  // v1.33: los AVISOS del ecosistema y las CUTSCENES también narran el edificio
  // (se coló «la gata de la 4C» porque estos catálogos no se auditaban).
  collect(content.ecosystem, strings, 'ecosystem');
  collect(content.cutscenes, strings, 'cutscenes');
  const out: FloorRefViolation[] = [];
  const ordinalRe = /(baja|primera|segunda|tercera|cuarta|quinta|sexta|s[eé]ptima)\s+planta/gi;
  const aptRe = /\b(\d+)([A-Da-d])\b/g;
  for (const { text, where } of strings) {
    for (const m of text.matchAll(ordinalRe)) {
      const floor = ORDINAL_TO_FLOOR[m[1]!.toLowerCase()];
      if (floor !== undefined && !floors.has(floor)) {
        out.push({ where, text, mention: m[0] });
      }
    }
    for (const m of text.matchAll(aptRe)) {
      const floor = Number(m[1]);
      const letter = m[2]!.toLowerCase();
      // Solo cuenta como mención de vivienda si la letra es una columna real del
      // edificio, la planta está en el rango verosímil y no es parte de un número largo.
      if (letters.has(letter) && floor > 0 && floor <= maxFloor + 2 && !/\d{4}/.test(text)) {
        if (!world.blocks[`blk_p${floor}_${letter}`]) {
          out.push({ where, text, mention: m[0] });
        }
      }
    }
  }
  return out;
}
