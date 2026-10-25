import type { AchievementsCatalog, AssetsCatalog, Content, EcosystemContent, Effect, EmotesCatalog } from '@/game/core/types';
import {
  achievementsCatalogSchema,
  blockListSchema,
  cutsceneListSchema,
  dialogListSchema,
  ecosystemContentSchema,
  emotesCatalogSchema,
  furnitureListSchema,
  influenceListSchema,
  layoutListSchema,
  minigameListSchema,
  missionListSchema,
  roomListSchema,
  rulesSchema,
  archetypeListSchema,
  scenarioListSchema,
  templateListSchema,
  assetsCatalogSchema,
} from './schemas';

export interface Issue {
  severity: 'error';
  where: string;
  message: string;
}

/**
 * Catálogos externos: viven en /public/content/*.json y se validan con Zod al cargar.
 * El código del juego no contiene NINGÚN dato de gameplay: solo lee este catálogo.
 */
const FILES = ['rules', 'blocks', 'rooms', 'layouts', 'influences', 'archetypes', 'dialogs', 'missions', 'cutscenes', 'templates', 'scenarios', 'furniture', 'minigames'] as const;

type Loaded = { [K in (typeof FILES)[number]]: unknown };

let cache: Promise<{ content: Content; issues: Issue[] }> | null = null;

function indexById<T extends { id: string }>(list: T[]): Record<string, T> {
  return Object.fromEntries(list.map((d) => [d.id, d]));
}

/** Descarga y valida los catálogos. Lanza si un fichero no cumple su schema; los errores de referencias se devuelven. */
export async function loadContent(baseUrl: string = '/content/'): Promise<{ content: Content; issues: Issue[] }> {
  cache ??= (async () => {
    const raw = {} as Loaded;
    await Promise.all(
      FILES.map(async (name) => {
        const res = await fetch(`${baseUrl}${name}.json`);
        if (!res.ok) throw new Error(`No se pudo cargar ${baseUrl}${name}.json (HTTP ${res.status})`);
        raw[name] = await res.json();
      }),
    );

    const rules = rulesSchema.parse(raw.rules);
    const blocks = blockListSchema.parse(raw.blocks);
    const rooms = roomListSchema.parse(raw.rooms);
    const layouts = layoutListSchema.parse(raw.layouts);
    const influences = influenceListSchema.parse(raw.influences);
    const archetypes = archetypeListSchema.parse(raw.archetypes);
    const dialogs = dialogListSchema.parse(raw.dialogs);
    const missions = missionListSchema.parse(raw.missions);
    const cutscenes = cutsceneListSchema.parse(raw.cutscenes);
    const templates = templateListSchema.parse(raw.templates);
    const scenarios = scenarioListSchema.parse(raw.scenarios);
    const furniture = furnitureListSchema.parse(raw.furniture);
    const minigames = minigameListSchema.parse(raw.minigames);

    // Manifiesto de arte final (OPCIONAL): si no existe, greybox puro. Si existe y es inválido, error sonoro.
    let assets: AssetsCatalog | undefined;
    try {
      const res = await fetch(`${baseUrl}assets.json`);
      if (res.ok) assets = assetsCatalogSchema.parse(await res.json());
    } catch (e) {
      throw new Error(`assets.json (manifiesto de arte final) inválido: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Bocadillos de expresión (v1.10, OPCIONAL): sin el fichero, la partida funciona sin emotes.
    let emotes: EmotesCatalog | undefined;
    try {
      const res = await fetch(`${baseUrl}emotes.json`);
      if (res.ok) emotes = emotesCatalogSchema.parse(await res.json());
    } catch (e) {
      throw new Error(`emotes.json (bocadillos de expresión) inválido: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Ecosistema del edificio (v1.14, OPCIONAL): sin el fichero, el edificio no "vive" pero
    // la partida funciona exactamente igual (patrón emotes).
    let ecosystem: EcosystemContent | undefined;
    try {
      const res = await fetch(`${baseUrl}ecosystem.json`);
      if (res.ok) ecosystem = ecosystemContentSchema.parse(await res.json()) as EcosystemContent;
    } catch (e) {
      throw new Error(`ecosystem.json (ecosistema del edificio) inválido: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Logros tipo Steam (v1.17, OPCIONAL): sin el fichero no hay logros y la partida
    // funciona exactamente igual (patrón emotes/ecosystem).
    let achievements: AchievementsCatalog | undefined;
    try {
      const res = await fetch(`${baseUrl}achievements.json`);
      if (res.ok) achievements = achievementsCatalogSchema.parse(await res.json()) as AchievementsCatalog;
    } catch (e) {
      throw new Error(`achievements.json (logros) inválido: ${e instanceof Error ? e.message : String(e)}`);
    }

    const content: Content = {
      rules,
      blocks: indexById(blocks),
      rooms: indexById(rooms),
      layouts: indexById(layouts),
      influences: indexById(influences),
      archetypes: indexById(archetypes),
      missions: indexById(missions),
      cutscenes: indexById(cutscenes),
      dialogs: indexById(dialogs),
      templates: indexById(templates),
      scenarios: indexById(scenarios),
      furniture: indexById(furniture),
      minigames: indexById(minigames),
      assets,
      emotes,
      ecosystem,
      achievements,
    };

    const issues = validateContent(content);
    return { content, issues };
  })();
  return cache;
}

/**
 * Validación de referencias del catálogo (equivalente al validador de CI del hito 1):
 * cada id referenciado debe existir; las misiones deben tener pasos y salidas coherentes.
 */
export function validateContent(c: Content): Issue[] {
  const issues: Issue[] = [];
  const err = (where: string, message: string) => issues.push({ severity: 'error', where, message });

  if (!c.scenarios[c.rules.startScenario]) err('rules', `startScenario desconocido: ${c.rules.startScenario}`);

  for (const t of Object.values(c.templates))
    for (const row of t.rows)
      for (const b of row.blocks) if (!c.blocks[b.defId]) err(`templates/${t.id}`, `defId desconocido: ${b.defId}`);

  for (const l of Object.values(c.layouts))
    for (const r of l.rooms) if (!c.rooms[r.defId]) err(`layouts/${l.id}`, `defId de estancia desconocido: ${r.defId}`);

  for (const i of Object.values(c.influences)) {
    if (i.attenuatedBy) {
      const known = Object.values(c.blocks).some((b) => b.params?.[i.attenuatedBy!]);
      if (!known) err(`influences/${i.id}`, `attenuatedBy desconocido en bloques: ${i.attenuatedBy}`);
    }
    if (i.onThreshold?.uiLog && !i.onThreshold.message) err(`influences/${i.id}`, 'uiLog sin message en onThreshold');
  }

  const channelIds = new Set(Object.values(c.influences).map((i) => i.channel));
  const slotKinds = new Set(Object.values(c.rooms).flatMap((r) => (r.furnitureSlots ?? []).map((s) => s.kind)));
  for (const f of Object.values(c.furniture)) {
    if (f.slots.length === 0) err(`furniture/${f.id}`, 'un mueble necesita al menos una categoría de ranura');
    for (const k of f.slots) if (!slotKinds.has(k)) err(`furniture/${f.id}`, `categoría de ranura desconocida: ${k}`);
    for (const ch of Object.keys(f.emits ?? {})) if (!channelIds.has(ch)) err(`furniture/${f.id}`, `canal desconocido: ${ch}`);
  }

  for (const g of Object.values(c.minigames)) {
    switch (g.type) {
      case 'timing_bar':
        if (g.config.zones.length === 0) err(`minigames/${g.id}`, 'un timing_bar necesita al menos una zona');
        for (const z of g.config.zones) if (z < 0 || z > 1) err(`minigames/${g.id}`, `zona fuera de rango (0..1): ${z}`);
        if (g.config.zoneWidth <= 0 || g.config.zoneWidth > 1) err(`minigames/${g.id}`, `zoneWidth fuera de rango: ${g.config.zoneWidth}`);
        break;
      case 'tap_sequence':
        if (g.config.pads.length < 2) err(`minigames/${g.id}`, 'tap_sequence necesita al menos 2 pads');
        if (g.config.rounds < 1) err(`minigames/${g.id}`, 'tap_sequence necesita al menos 1 ronda');
        if (g.config.sequenceStart < 1) err(`minigames/${g.id}`, `sequenceStart fuera de rango: ${g.config.sequenceStart}`);
        if (g.config.sequenceStart + (g.config.rounds - 1) * g.config.sequenceGrow > g.config.pads.length * 2)
          err(`minigames/${g.id}`, 'la secuencia crece más que el doble de pads disponibles');
        if (g.config.showMs <= 0 || g.config.gapMs <= 0 || g.config.inputTimeoutMs <= 0)
          err(`minigames/${g.id}`, 'showMs/gapMs/inputTimeoutMs deben ser positivos');
        break;
      case 'reflex_targets':
        if (g.config.targets < 1) err(`minigames/${g.id}`, 'reflex_targets necesita al menos 1 objetivo');
        if (g.config.spawnIntervalMs < 200) err(`minigames/${g.id}`, `spawnIntervalMs demasiado rápido: ${g.config.spawnIntervalMs}`);
        if (g.config.targetLifeMs < 300) err(`minigames/${g.id}`, `targetLifeMs demasiado corto: ${g.config.targetLifeMs}`);
        if (g.config.radiusPct <= 0 || g.config.radiusPct >= 50) err(`minigames/${g.id}`, `radiusPct fuera de rango (0..50): ${g.config.radiusPct}`);
        if (g.config.decoyChance !== undefined && (g.config.decoyChance < 0 || g.config.decoyChance > 1))
          err(`minigames/${g.id}`, `decoyChance fuera de rango (0..1): ${g.config.decoyChance}`);
        if (g.config.decoyChance !== undefined && !g.config.decoyEmoji) err(`minigames/${g.id}`, 'decoyChance sin decoyEmoji');
        break;
      case 'memory_pairs':
        if (g.config.items.length < 3) err(`minigames/${g.id}`, 'memory_pairs necesita al menos 3 parejas');
        if (new Set(g.config.items).size !== g.config.items.length) err(`minigames/${g.id}`, 'memory_pairs: los emojis de pareja deben ser únicos');
        break;
    }
  }

  const minigameTypes = new Set(Object.values(c.minigames).map((g) => g.type));
  for (const t of minigameTypes)
    if (!c.rules.minigames.introByType[t]) err('rules/minigames', `introByType no cubre el tipo: ${t}`);

  for (const a of Object.values(c.archetypes)) {
    for (const [act, def] of Object.entries(a.activities)) {
      for (const ch of Object.keys(def.emits ?? {}))
        if (!Object.values(c.influences).some((i) => i.channel === ch)) err(`archetypes/${a.id}`, `canal desconocido en ${act}: ${ch}`);
      if (def.at?.startsWith('def:')) {
        const defId = def.at.slice('def:'.length);
        if (!c.blocks[defId]) err(`archetypes/${a.id}`, `at def: desconocido en ${act}: ${defId}`);
      }
    }
  }

  for (const m of Object.values(c.missions)) {
    if (m.steps.length === 0) err(`missions/${m.id}`, 'una misión necesita al menos un paso');
    for (const s of m.steps) if (s.type === 'phone_call' && !c.dialogs[s.dialog]) err(`missions/${m.id}`, `diálogo desconocido: ${s.dialog}`);
    for (const ch of m.choices ?? [])
      for (const e of ch.effects) {
        if (e.op === 'startMission' && !c.missions[e.id]) err(`missions/${m.id}`, `misión desconocida: ${e.id}`);
        if (e.op === 'startMinigame' && !c.minigames[e.id]) err(`missions/${m.id}`, `minijuego desconocido: ${e.id}`);
        if (e.op === 'unlock' && e.resident) {
          const exists = Object.values(c.scenarios).some((s) => s.residents.some((r) => r.id === e.resident));
          if (!exists) err(`missions/${m.id}`, `residente desconocido: ${e.resident}`);
        }
      }
  }

  // Cutscenes (Fase D): el trigger debe referir misión/paso existentes (los bloques/actores de
  // los beats se resuelven en runtime y son indulgentes por diseño: beat saltado, no partida rota).
  for (const cs of Object.values(c.cutscenes)) {
    if (cs.beats.length === 0) err(`cutscenes/${cs.id}`, 'una cutscene necesita al menos un beat');
    if (cs.trigger.mission && !c.missions[cs.trigger.mission]) err(`cutscenes/${cs.id}`, `misión desconocida en el trigger: ${cs.trigger.mission}`);
    if (cs.trigger.step && cs.trigger.mission) {
      const def = c.missions[cs.trigger.mission];
      if (def && !def.steps.some((s) => s.id === cs.trigger.step)) err(`cutscenes/${cs.id}`, `paso desconocido en el trigger: ${cs.trigger.step}`);
    }
  }

  for (const s of Object.values(c.scenarios)) {
    if (!c.templates[s.building.template]) err(`scenarios/${s.id}`, `plantilla desconocida: ${s.building.template}`);
    if (!c.archetypes[s.player.archetype]) err(`scenarios/${s.id}`, `arquetipo del jugador desconocido: ${s.player.archetype}`);
    for (const r of s.residents) if (!c.archetypes[r.archetype]) err(`scenarios/${s.id}`, `arquetipo desconocido: ${r.archetype}`);
    for (const m of s.startMissions) if (!c.missions[m]) err(`scenarios/${s.id}`, `misión inicial desconocida: ${m}`);
  }

  // Bocadillos (v1.10): las actividades emoteadas deben existir en algún arquetipo (indulgente
  // con gestos/eventos, que son estados de presentación y no ids del sim).
  if (c.emotes) {
    const activityIds = new Set(Object.values(c.archetypes).flatMap((a) => Object.keys(a.activities)));
    for (const e of c.emotes.activities)
      if (!activityIds.has(e.id)) err(`emotes/activities/${e.id}`, `actividad desconocida en los arquetipos: ${e.id}`);
    for (const e of c.emotes.events)
      if (e.who === 'blockResidents' && e.on === 'resident_moved') err(`emotes/events/${e.on}`, 'blockResidents sobre resident_moved dispararía bocadillos en cada paso: usa otro evento');
  }

  // Manifiesto de assets: claves que deben existir y animaciones/actividades bien referenciadas.
  if (c.assets) {
    for (const [id, def] of Object.entries(c.assets.actors ?? {})) {
      const arch = c.archetypes[id];
      if (!arch) err(`assets/actors/${id}`, `arquetipo desconocido: ${id}`);
      const anims = def.animations ?? {};
      for (const key of [def.defaultAnimation, def.walkAnimation, ...Object.values(def.activityAnimations ?? {})])
        if (key && !anims[key]) err(`assets/actors/${id}`, `animación lógica sin clip declarado: ${key}`);
      for (const act of Object.keys(def.activityAnimations ?? {}))
        if (arch && !(act in arch.activities)) err(`assets/actors/${id}`, `actividad desconocida en el arquetipo: ${act}`);
    }
    for (const id of Object.keys(c.assets.blocks ?? {}))
      if (!c.blocks[id]) err(`assets/blocks/${id}`, `definición de bloque desconocida: ${id}`);
  }

  // Ecosistema (v1.14): referencias de eventos (arquetipos, misiones, params de bloque y
  // misiones encadenadas desde los outcomes). Indulgente en targets dinámicos (los efectos
  // del sim ya avisan en runtime con effect_unresolved).
  if (c.ecosystem) {
    const eco = c.ecosystem;
    const checkOutcome = (where: string, o: { id: string; effects: Effect[] }) => {
      for (const e of o.effects) {
        if (e.op === 'startMission' && !c.missions[e.id]) err(`${where}/${o.id}`, `misión desconocida: ${e.id}`);
        if (e.op === 'startMinigame' && !c.minigames[e.id]) err(`${where}/${o.id}`, `minijuego desconocido: ${e.id}`);
      }
    };
    for (const ev of eco.events) {
      const where = `ecosystem/events/${ev.id}`;
      if (ev.vendor && !c.archetypes[ev.vendor.archetype]) err(where, `arquetipo desconocido: ${ev.vendor.archetype}`);
      if (ev.pet && !c.missions[ev.pet.mission]) err(where, `misión de mascota desconocida: ${ev.pet.mission}`);
      if (ev.blackout && !c.blocks[ev.blackout.corridorBlock]) err(where, `bloque de pasillo desconocido: ${ev.blackout.corridorBlock}`);
      for (const o of ev.outcomes ?? []) checkOutcome(`${where}/outcomes`, o);
      for (const o of ev.vendor?.perKnockOutcomes ?? []) checkOutcome(`${where}/perKnockOutcomes`, o);
      for (const rule of eco.visuals.deterioration) {
        const bd = c.blocks[rule.blockDef];
        if (!bd) err(`ecosystem/visuals/${rule.id}`, `definición de bloque desconocida: ${rule.blockDef}`);
        else if (!bd.params?.[rule.param]) err(`ecosystem/visuals/${rule.id}`, `param desconocido en ${rule.blockDef}: ${rule.param}`);
        if (rule.below === undefined && rule.above === undefined) err(`ecosystem/visuals/${rule.id}`, 'necesita below o above');
      }
    }
  }

  // Logros (v1.17): las condiciones mission_done deben referir misiones existentes.
  if (c.achievements) {
    for (const a of c.achievements.achievements) {
      if (a.condition.kind === 'mission_done' && !c.missions[a.condition.mission])
        err(`achievements/${a.id}`, `misión desconocida: ${a.condition.mission}`);
    }
  }

  return issues;
}

export function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `✗ ${i.where}: ${i.message}`).join('\n');
}
