import type { Content } from '@/game/core/types';
import { BLOCK_DEFS } from './data/blocks';
import { ROOM_DEFS } from './data/rooms';
import { LAYOUT_DEFS } from './data/layouts';
import { INFLUENCE_RULES } from './data/influences';
import { ARCHETYPE_DEFS } from './data/archetypes';
import { DIALOG_DEFS } from './data/dialogs';
import { MISSION_DEFS } from './data/missions';
import { TEMPLATE_DEFS } from './data/templates';
import { SCENARIO_DEFS } from './data/scenario';

export interface Issue {
  severity: 'error';
  where: string;
  message: string;
}

/** Etiquetas visibles de parámetros para la interfaz. */
export const PARAM_LABELS: Record<string, string> = {
  condition: 'Estado',
  soundproofing: 'Aislamiento',
  humidity: 'Humedad',
  style: 'Estilo',
  rent: 'Alquiler/día',
  comfort: 'Confort',
  cleanliness: 'Limpieza',
  elevator_status: 'Ascensor',
};

function index<T extends { id: string }>(list: T[]): Record<string, T> {
  return Object.fromEntries(list.map((d) => [d.id, d]));
}

const content: Content = {
  blocks: index(BLOCK_DEFS),
  rooms: index(ROOM_DEFS),
  layouts: index(LAYOUT_DEFS),
  influences: index(INFLUENCE_RULES),
  archetypes: index(ARCHETYPE_DEFS),
  missions: index(MISSION_DEFS),
  dialogs: index(DIALOG_DEFS),
  templates: index(TEMPLATE_DEFS),
  scenarios: index(SCENARIO_DEFS),
};

/**
 * Validación de referencias del catálogo (equivalente al validador de CI del hito 1):
 * cada id referenciado debe existir; las misiones deben tener pasos y salidas coherentes.
 */
export function validateContent(c: Content): Issue[] {
  const issues: Issue[] = [];
  const err = (where: string, message: string) => issues.push({ severity: 'error', where, message });

  for (const t of Object.values(c.templates))
    for (const row of t.rows)
      for (const b of row.blocks) if (!c.blocks[b.defId]) err(`templates/${t.id}`, `defId desconocido: ${b.defId}`);

  for (const l of Object.values(c.layouts))
    for (const r of l.rooms) if (!c.rooms[r.defId]) err(`layouts/${l.id}`, `defId de estancia desconocido: ${r.defId}`);

  for (const m of Object.values(c.missions)) {
    if (m.steps.length === 0) err(`missions/${m.id}`, 'una misión necesita al menos un paso');
    for (const s of m.steps) if (s.type === 'phone_call' && !c.dialogs[s.dialog]) err(`missions/${m.id}`, `diálogo desconocido: ${s.dialog}`);
    for (const ch of m.choices ?? [])
      for (const e of ch.effects) {
        if ((e.op === 'startMission' || e.op === 'openJunta') && e.op === 'startMission' && !c.missions[e.id]) err(`missions/${m.id}`, `misión desconocida: ${e.id}`);
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

export function buildContent(): { content: Content; issues: Issue[] } {
  return { content, issues: validateContent(content) };
}

export function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `✗ ${i.where}: ${i.message}`).join('\n');
}
