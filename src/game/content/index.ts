import type { Content } from '@/game/core/types';
import {
  blockListSchema,
  dialogListSchema,
  influenceListSchema,
  layoutListSchema,
  missionListSchema,
  roomListSchema,
  rulesSchema,
  archetypeListSchema,
  scenarioListSchema,
  templateListSchema,
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
const FILES = ['rules', 'blocks', 'rooms', 'layouts', 'influences', 'archetypes', 'dialogs', 'missions', 'templates', 'scenarios'] as const;

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
    const templates = templateListSchema.parse(raw.templates);
    const scenarios = scenarioListSchema.parse(raw.scenarios);

    const content: Content = {
      rules,
      blocks: indexById(blocks),
      rooms: indexById(rooms),
      layouts: indexById(layouts),
      influences: indexById(influences),
      archetypes: indexById(archetypes),
      missions: indexById(missions),
      dialogs: indexById(dialogs),
      templates: indexById(templates),
      scenarios: indexById(scenarios),
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
  }

  for (const a of Object.values(c.archetypes)) {
    for (const [act, def] of Object.entries(a.activities))
      for (const ch of Object.keys(def.emits ?? {}))
        if (!Object.values(c.influences).some((i) => i.channel === ch)) err(`archetypes/${a.id}`, `canal desconocido en ${act}: ${ch}`);
  }

  for (const m of Object.values(c.missions)) {
    if (m.steps.length === 0) err(`missions/${m.id}`, 'una misión necesita al menos un paso');
    for (const s of m.steps) if (s.type === 'phone_call' && !c.dialogs[s.dialog]) err(`missions/${m.id}`, `diálogo desconocido: ${s.dialog}`);
    for (const ch of m.choices ?? [])
      for (const e of ch.effects) {
        if (e.op === 'startMission' && !c.missions[e.id]) err(`missions/${m.id}`, `misión desconocida: ${e.id}`);
        if (e.op === 'unlock' && e.resident) {
          const exists = Object.values(c.scenarios).some((s) => s.residents.some((r) => r.id === e.resident));
          if (!exists) err(`missions/${m.id}`, `residente desconocido: ${e.resident}`);
        }
      }
  }

  for (const s of Object.values(c.scenarios)) {
    if (!c.templates[s.building.template]) err(`scenarios/${s.id}`, `plantilla desconocida: ${s.building.template}`);
    if (!c.archetypes[s.player.archetype]) err(`scenarios/${s.id}`, `arquetipo del jugador desconocido: ${s.player.archetype}`);
    for (const r of s.residents) if (!c.archetypes[r.archetype]) err(`scenarios/${s.id}`, `arquetipo desconocido: ${r.archetype}`);
    for (const m of s.startMissions) if (!c.missions[m]) err(`scenarios/${s.id}`, `misión inicial desconocida: ${m}`);
  }

  return issues;
}

export function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `✗ ${i.where}: ${i.message}`).join('\n');
}
