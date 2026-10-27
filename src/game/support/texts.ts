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
  /** v1.34 — vivienda del JUGADOR (para {home}); null si no aplica. */
  home?: string;
}

/** Datos estructurales del mundo que alimentan los tokens de EDIFICIO.
 *  «Plantas» = PLANTAS DE VIVIENDA (el edificio_3p_3v dice 3 aunque tenga ático y locales:
 *  es lo que la gente llama «un edificio de 3 plantas»); «viviendas» = dwellings reales. */
const buildingFacts = (world: World): { plantas: number; viviendas: number; topFloor: number } => {
  let topFloor = 0;
  let viviendas = 0;
  for (const b of Object.values(world.blocks)) {
    if (b.kind === 'dwelling') {
      if (b.cell.floor > topFloor) topFloor = b.cell.floor;
      viviendas++;
    }
  }
  return { plantas: topFloor, viviendas, topFloor };
};

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
  const facts = buildingFacts(world);
  const blockLabel = (id: string): string => {
    const b = world.blocks[id];
    if (!b) return id;
    if (b.kind === 'dwelling') return apartmentLabel(id);
    return content.blocks[b.defId]?.label ?? id;
  };
  return text
    .replaceAll('{a}', apply(ctx.a, 'a'))
    .replaceAll('{b}', apply(ctx.b, 'b'))
    // v1.34 — el JUGADOR y su vivienda: los avisos ya no citan pisos que no son los suyos.
    .replaceAll('{home}', ctx.home ? apartmentLabel(ctx.home) : '?home?')
    // v1.34 — el EDIFICIO entero: los textos se adaptan al nº de plantas y viviendas real
    // («{plantas} PLANTAS A PIE» con un edificio de 3 dice 3; con uno de 9, 9).
    .replaceAll('{plantas}', String(facts.plantas))
    .replaceAll('{viviendas}', String(facts.viviendas))
    .replaceAll('{plantaTop}', floorWord(facts.topFloor, content))
    .replaceAll(/\{blk:([\w_]+)\}/g, (_s, id: string) => blockLabel(id))
    .replaceAll(/\{viviendaDe:([\w_]+)\}/g, (_s, who: string) => {
      const r = world.residents[who];
      return r ? apartmentLabel(r.home ?? '') : `?${who}?`;
    })
    .replaceAll(/\{plantaDe:([\w_]+)\}/g, (_s, who: string) => {
      const r = world.residents[who];
      const m = r ? /^blk_p(\d+)_/.exec(r.home ?? '') : null;
      return m ? floorWord(Number(m[1]), content) : '?';
    })
    .replaceAll(/\{planta:([ab])\}/g, (_s, who: string) => apply(ctx[who as 'a' | 'b'], 'planta'))
    .replaceAll(/\{vivienda:([ab])\}/g, (_s, who: string) => apply(ctx[who as 'a' | 'b'], 'vivienda'));
}

/**
 * v1.34 — PASO ESTÁTICO DE ARRANQUE: expande los tokens ESTRUCTURALES ({plantas},
 * {viviendas}, {blk:id}) en los catálogos narrativos ANTES de que la UI los lea. Así un
 * título de misión («El piso de al lado ({blk:blk_p1_a})») muestra la vivienda REAL aunque
 * el jugador nunca abra un evento. Los tokens con contexto ({a}, {planta:x}, {home}…)
 * siguen resolviéndose en caliente donde hay evento.
 */
export function applyStaticTokens(content: Content, world: World): void {
  const facts = buildingFacts(world);
  const blockLabel = (id: string): string => {
    const b = world.blocks[id];
    if (!b) return id;
    if (b.kind === 'dwelling') return apartmentLabel(id);
    return content.blocks[b.defId]?.label ?? id;
  };
  const expand = (s: string): string =>
    s
      .replaceAll('{plantas}', String(facts.plantas))
      .replaceAll('{viviendas}', String(facts.viviendas))
      .replaceAll(/\{blk:([\w_]+)\}/g, (_s, id: string) => blockLabel(id));
  const walk = (o: unknown): void => {
    if (typeof o === 'string') return; // las cadenas se mutan desde su contenedor
    if (Array.isArray(o)) {
      for (let i = 0; i < o.length; i++) {
        if (typeof o[i] === 'string') o[i] = expand(o[i] as string);
        else walk(o[i]);
      }
    } else if (o && typeof o === 'object') {
      for (const [k, x] of Object.entries(o as Record<string, unknown>)) {
        if (typeof x === 'string') (o as Record<string, unknown>)[k] = expand(x);
        else walk(x);
      }
    }
  };
  walk(content.missions);
  walk(content.dialogs);
  walk(content.cutscenes);
  walk(content.street);
  walk(content.ecosystem);
  walk(content.influences);
  walk(content.achievements);
  walk(content.crossings);
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
  // v1.34 — el edificio de verdad tiene X plantas: «9 PISOS A PIE» con un bloque de 3 es
  // exactamente la mentira del vecino («hablan del vecino del cuarto»). Estos avisos deben
  // llevar {plantas} para adaptarse solos.
  const countRe = /(\d+)\s*(pisos|plantas)\b/gi;
  // v1.34 — «plantas» del edificio = plantas de VIVIENDA (la convención del catálogo:
  // edificio_3p_3v = 3 plantas), no los niveles técnicos (ático/tejado cuentan aparte).
  const plantas = Math.max(...Object.values(world.blocks).filter((b) => b.kind === 'dwelling').map((b) => b.cell.floor), 0);
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
      // v1.34 — la letra TAMBIÉN debe existir: «el Ex presidente · 1D» en un edificio sin
      // columna D es una mención imposible (antes se dejaba pasar y ahí quedó).
      if (floor > 0 && floor <= maxFloor + 2 && !/\d{4}/.test(text)) {
        if (!world.blocks[`blk_p${floor}_${letter}`]) {
          out.push({ where, text, mention: m[0] });
        }
      }
    }
    for (const m of text.matchAll(countRe)) {
      if (Number(m[1]) !== plantas) {
        out.push({ where, text, mention: m[0] });
      }
    }
  }
  return out;
}
