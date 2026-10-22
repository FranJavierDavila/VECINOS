import { FOLDERS, FOLDER_SCHEMAS, type Folder, type BlockDef, type RoomDef, type LayoutDef, type InfluenceRule, type ArchetypeDef, type MissionDef, type DialogDef, type TemplateDef, type ScenarioDef } from './schemas';
import { validateContent } from './validate';

export interface Issue {
  severity: 'error';
  file: string;
  path: string;
  message: string;
}

export interface Content {
  blocks: Record<string, BlockDef>;
  rooms: Record<string, RoomDef>;
  layouts: Record<string, LayoutDef>;
  influences: Record<string, InfluenceRule>;
  archetypes: Record<string, ArchetypeDef>;
  missions: Record<string, MissionDef>;
  dialogs: Record<string, DialogDef>;
  templates: Record<string, TemplateDef>;
  scenarios: Record<string, ScenarioDef>;
}

const FILE_RE = new RegExp(`(?:^|/)(${FOLDERS.join('|')})/([^/]+)\\.json$`);

/**
 * Valida y organiza el contenido. `records` asocia rutas de archivo (p. ej. "data/blocks/vivienda_estandar.json")
 * con su JSON ya parseado. Funciona igual en Node y en el navegador.
 */
export function buildContent(records: Record<string, unknown>): { content: Content; issues: Issue[] } {
  const content: Content = { blocks: {}, rooms: {}, layouts: {}, influences: {}, archetypes: {}, missions: {}, dialogs: {}, templates: {}, scenarios: {} };
  const issues: Issue[] = [];

  for (const [file, raw] of Object.entries(records).sort(([a], [b]) => a.localeCompare(b))) {
    const m = FILE_RE.exec(file.replace(/\\/g, '/'));
    if (!m) continue;
    const folder = m[1] as Folder;
    const stem = m[2];
    const parsed = FOLDER_SCHEMAS[folder].safeParse(raw);
    if (!parsed.success) {
      for (const i of parsed.error.issues) issues.push({ severity: 'error', file, path: i.path.join('.') || '(raíz)', message: i.message });
      continue;
    }
    const value = parsed.data as { id: string };
    if (value.id !== stem) issues.push({ severity: 'error', file, path: 'id', message: `el id "${value.id}" debe coincidir con el nombre del archivo "${stem}"` });
    const bucket = content[folder] as Record<string, unknown>;
    if (bucket[value.id]) issues.push({ severity: 'error', file, path: 'id', message: `id duplicado "${value.id}"` });
    bucket[value.id] = parsed.data;
  }

  if (issues.length === 0) issues.push(...validateContent(content));
  return { content, issues };
}

export function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `✗ ${i.file} › ${i.path}: ${i.message}`).join('\n');
}
