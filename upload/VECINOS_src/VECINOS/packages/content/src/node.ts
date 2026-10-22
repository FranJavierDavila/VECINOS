import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildContent } from './content';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

/** Lee todos los .json de `dir` (solo Node) y devuelve contenido validado. */
export function loadContentFromDir(dir: string) {
  const records: Record<string, unknown> = {};
  for (const f of walk(dir)) records[f] = JSON.parse(readFileSync(f, 'utf8'));
  return buildContent(records);
}
