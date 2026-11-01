/**
 * Sonda sim: topología de bloques (planta/col/layer/features) y prueba del grafo
 * nextStepTowards desde la entrada del invitado hasta su vivienda y la escalera.
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld } from '@/game/sim';
import { nextStepTowards } from '@/game/sim';

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) { console.error(formatIssues(issues)); process.exit(1); }
const world = createWorld(content, content.rules.startScenario);

console.log('· entry:', world.entry, '· playerId:', world.playerId);
for (const b of Object.values(world.blocks)) {
  const f = content.blocks[b.defId]!.features;
  console.log(`  ${b.id.padEnd(18)} floor=${b.cell.floor} col=${String(b.cell.col).padEnd(3)} layer=${b.layer.padEnd(8)} kind=${b.kind.padEnd(9)} stairs=${!!f?.stairs} elev=${!!f?.elevator} acc=${b.access}`);
}

// El invitado hipotético: entra en portal → su vivienda (planta 1 col a) → escalera.
const guestHome = Object.values(world.blocks).find((b) => b.kind === 'dwelling' && b.cell.floor === 1 && b.id.includes('_a'))!;
const stairs1 = Object.values(world.blocks).find((b) => b.cell.floor === 1 && content.blocks[b.defId]!.features?.stairs)!;
const pasillo0 = world.blocks['blk_p0_pasillo']!;
console.log('\n· ruta pasillo0 →', pasillo0.id, '→', stairs1.id, '→', guestHome.id);
let loc: string | null = world.entry;
for (let i = 0; i < 8 && loc !== pasillo0.id; i++) {
  const next = nextStepTowards(world, content, loc, pasillo0.id);
  console.log('   paso →', next);
  if (!next) break;
  loc = next;
}
let loc2: string | null = pasillo0.id;
for (let i = 0; i < 8 && loc2 !== stairs1.id; i++) {
  const next = nextStepTowards(world, content, loc2, stairs1.id);
  console.log('   paso escalera →', next);
  if (!next) break;
  loc2 = next;
}
