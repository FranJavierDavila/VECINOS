import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { FOLDER_SCHEMAS } from '../src/schemas';

const out = fileURLToPath(new URL('../schemas', import.meta.url));
mkdirSync(out, { recursive: true });
for (const [folder, schema] of Object.entries(FOLDER_SCHEMAS)) {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  writeFileSync(`${out}/${folder}.schema.json`, JSON.stringify(json, null, 2) + '\n');
}
console.log(`✓ JSON Schema generado en packages/content/schemas (${Object.keys(FOLDER_SCHEMAS).length} archivos)`);
