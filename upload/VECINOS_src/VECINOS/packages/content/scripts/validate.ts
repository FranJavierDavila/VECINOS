import { fileURLToPath } from 'node:url';
import { loadContentFromDir } from '../src/node';
import { formatIssues } from '../src/content';

const dir = fileURLToPath(new URL('../data', import.meta.url));
const { content, issues } = loadContentFromDir(dir);
if (issues.length) {
  console.error(formatIssues(issues));
  console.error(`\n${issues.length} error(es) de contenido.`);
  process.exit(1);
}
const counts = Object.entries(content).map(([k, v]) => `${Object.keys(v).length} ${k}`);
console.log(`✓ Contenido válido: ${counts.join(', ')}`);
