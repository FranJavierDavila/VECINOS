/**
 * Sonda sim: tras entrar en una vivienda (planta 1), ¿a dónde apunta zone()/sync?
 * Imprime la ubicación del sim frame a frame (5 s) para ver si el sim «sale» solo.
 */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, dispatch } from '@/game/sim';
import { PlayerLogic } from '@/game/player-logic';

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) { console.error(formatIssues(issues)); process.exit(1); }
const world = createWorld(content, content.rules.startScenario);
const logic = new PlayerLogic(world, content);
const me = world.residents[world.playerId]!;
console.log('· start:', me.location, '· home:', me.home);

// Teleport delante de la puerta de UN vecino en planta 1 y entrar (timbre → enterBlock).
const target = Object.values(world.blocks).find((b) => b.id === 'blk_p1_c')!;
logic.teleportTo(target.id);
console.log('· tras teleport: mode=', logic.mode, 'floor=', logic.floor, 'sim location=', me.location);
const r = logic.enterBlock(target.id);
console.log('· enterBlock →', r.type, '· sim location=', me.location);

// 300 frames de update (5 s) sin input: ¿el sim se queda en blk_p1_c?
const IN = { left: false, right: false, up: false, down: false, run: false };
for (let i = 0; i < 300; i++) {
  logic.update(1 / 60, IN);
  if (i % 60 === 0) console.log(`  t=${(i / 60).toFixed(0)}s sim location=`, me.location, '· modo=', logic.mode, 'inside=', logic.insideBlock);
}
console.log('· final: sim location=', me.location, '· modo=', logic.mode, '· dentro=', logic.insideBlock);
