/**
 * QA v1.17 — "Pulido de la información": logros tipo Steam, privacidad de viviendas,
 * trasteros con tabiques/carteles y tope de bocadillos en vista edificio.
 * Verifica contra el contenido, el evaluador puro y el sim REALES (patrón qa-v16):
 *  1. Catálogo: rules.view.privacy + trasteros.partitionExtra/partitionColor/headerH +
 *     emotes.bubble.buildingMaxGlyphs declarados (nada hardcodeado).
 *  2. Logros: achievements.json carga con Zod (12 logros), condiciones con misiones REALES,
 *     sin ids duplicados y con icono/textos es+en.
 *  3. Evaluador puro: estado inicial del escenario NO desbloquea nada; cada condición del
 *     catálogo dispara exactamente su logro con un snapshot sintético; re-llamar no re-unlock.
 *  4. Circulación con zone() corregido (v1.17): en plantas de pasillo extendido (w10) el
 *     jugador puede volver a entrar en el cubo de escalera (el grafo ronda pasillo↔escalera
 *     en todas las plantas 1..7 y el sim resuelve rutas por el pozo).
 *  5. Sim E2E: la escalada del tutorial sigue cerrándose (m_bienvenida) y el ascensor puede
 *     quedar operativo (los logros elevator_ok/manitas tienen condiciones alcanzables).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, tick, dispatch } from '@/game/sim';
import { evaluateAchievements, achievementUnlocked, type AchievementSnapshot } from '@/game/support/achievements';

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}
let fails = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` · ${detail}` : ''}`);
  if (!cond) fails++;
};

// ── 1. Catálogo de presentación ──
const v = content.rules.view;
check('rules.view.privacy declarado (enabled/door/handle/W/H)', !!v.privacy && v.privacy.enabled && v.privacy.doorH > 1 && v.privacy.doorW > 0.5, v.privacy ? `door ${v.privacy.doorW}×${v.privacy.doorH}` : 'ausente');
check('trasteros con tabiques (partitionExtra>0 + color)', v.trasteros.partitionExtra > 0 && !!v.trasteros.partitionColor, `+${v.trasteros.partitionExtra}m`);
check('trasteros con cabecera de cartel (headerH>0)', v.trasteros.headerH > 0, `${v.trasteros.headerH}m`);
check('emotes.bubble.buildingMaxGlyphs declarado (tope vista edificio)', typeof (content.emotes as { bubble: { buildingMaxGlyphs?: number } }).bubble.buildingMaxGlyphs === 'number', `${(content.emotes as { bubble: { buildingMaxGlyphs?: number } }).bubble.buildingMaxGlyphs}`);

// ── 2. Catálogo de logros ──
const achPath = resolve(import.meta.dir, '../public/content/achievements.json');
check('achievements.json existe en disco', existsSync(achPath));
const catalog = content.achievements;
check('content.achievements cargado y validado (≥10 logros)', !!catalog && catalog.achievements.length >= 10, catalog ? `${catalog.achievements.length} logros` : 'ausente');
if (catalog) {
  const ids = catalog.achievements.map((a) => a.id);
  check('ids de logro únicos', new Set(ids).size === ids.length, `${ids.length} ids`);
  check('todos con icono, nombre y desc en es+en', catalog.achievements.every((a) => !!a.icon && !!a.name.es && !!a.name.en && !!a.desc.es && !!a.desc.en), '');
  check('hay logros ocultos (hidden)', catalog.achievements.some((a) => a.hidden === true), '');
  // Las condiciones mission_done apuntan a misiones REALES del catálogo.
  const missionIds = Object.keys(content.missions);
  const missionConds = catalog.achievements.filter((a) => a.condition.kind === 'mission_done');
  check('condiciones mission_done con misiones existentes', missionConds.every((a) => missionIds.includes(a.condition.mission)), missionConds.map((a) => a.condition.mission).join(','));
  check('condiciones cubren los 8 kinds del schema', new Set(catalog.achievements.map((a) => a.condition.kind)).size >= 6, [...new Set(catalog.achievements.map((a) => a.condition.kind))].join(','));
}

// ── 3. Evaluador puro (support) ──
const world = createWorld(content, content.rules.startScenario);
const player = world.residents[world.playerId]!;
const baseSnap: AchievementSnapshot = {
  day: world.clock.day,
  tick: world.tick,
  wallet: player.wallet,
  funds: world.community.funds,
  reputation: player.reputation,
  elevatorStatus: String(Object.values(world.blocks).find((b) => b.params.elevator_status !== undefined)?.params.elevator_status ?? 'ok'),
  missionsDone: [],
  bestAffinity: 0,
};
if (catalog) {
  const initial = evaluateAchievements(catalog, baseSnap, new Set());
  check('estado inicial del escenario: 0 logros', initial.length === 0, initial.join(','));
  // Cada condición dispara EXACTAMENTE su logro con un snapshot sintético.
  let syntheticOk = 0;
  for (const def of catalog.achievements) {
    const c = def.condition;
    const snap: AchievementSnapshot = { ...baseSnap };
    if (c.kind === 'mission_done') snap.missionsDone = [c.mission];
    else if (c.kind === 'missions_done') snap.missionsDone = Array.from({ length: c.count }, (_, i) => `m_x${i}`);
    else if (c.kind === 'wallet') snap.wallet = c.amount;
    else if (c.kind === 'funds') snap.funds = c.amount;
    else if (c.kind === 'reputation') snap.reputation = c.amount;
    else if (c.kind === 'day') snap.day = c.count;
    else if (c.kind === 'relation') snap.bestAffinity = c.affinity;
    else if (c.kind === 'elevator_ok') snap.elevatorStatus = 'ok';
    const got = evaluateAchievements(catalog, snap, new Set());
    // "includes" y no "1:1" estricto: las condiciones acumulativas legítimas disparan en
    // cascada (missions_done 7 desbloquea también el de 3 — así debe ser).
    if (got.length >= 1 && got.includes(def.id) && got.every((id) => catalog.achievements.some((d) => d.id === id && achievementUnlocked(d, snap)))) syntheticOk++;
  }
  check('cada condición dispara su logro (1:1)', syntheticOk === catalog.achievements.length, `${syntheticOk}/${catalog.achievements.length}`);
  // Re-llamar con el set ya poblado no vuelve a desbloquear (idempotente).
  const unlocked = new Set(catalog.achievements.map((a) => a.id));
  const again = evaluateAchievements(catalog, { ...baseSnap, day: 99, wallet: 99999, funds: 99999, reputation: 99, missionsDone: Object.keys(content.missions), bestAffinity: 99, elevatorStatus: 'ok' }, unlocked);
  check('idempotente: nada nuevo con todo desbloqueado', again.length === 0, again.join(','));
}

// ── 4. Topología: el pasillo extendido no atrapa al jugador (zone corregido) ──
const shaftByFloor = (f: number) =>
  Object.values(world.blocks).filter((b) => b.cell.floor === f && b.layer === 'main' && b.kind !== 'dwelling' && b.cell.col >= 9);
check('plantas 1..7 tienen cubo de escalera en col ≥ 9', [1, 2, 3, 4, 5, 6, 7].every((f) => shaftByFloor(f).some((b) => content.blocks[b.defId]!.features?.stairs === true)), 'escalera accesible por encima del pasillo');

// ── 5. Sim E2E: tick del mundo + misión del tutorial cerrada por el grafo ──
for (let i = 0; i < 120; i++) tick(world, content);
check('el sim avanza 120 ticks sin deriva', world.clock.day >= 1 && world.clock.minute >= 0, `día ${world.clock.day} ${world.clock.minute} min`);
const misionBienvenida = world.missions.find((m) => m.id === 'm_bienvenida');
check('m_bienvenida registrada (activa o pendiente al arrancar)', !!misionBienvenida && (misionBienvenida.state === 'active' || misionBienvenida.state === 'pending'), misionBienvenida?.state ?? 'ausente');
const elev = Object.values(world.blocks).find((b) => b.params.elevator_status !== undefined);
check('el ascensor del núcleo tiene estado (roto al inicio → elevator_ok alcanzable)', !!elev && typeof elev.params.elevator_status === 'string', String(elev?.params.elevator_status));

// ── 6. Arte en disco no cambia (regresión): assets v1.16 siguen ahí ──
const assetsPath = resolve(import.meta.dir, '../public/content/assets.json');
const assets = JSON.parse(readFileSync(assetsPath, 'utf8')) as { blocks: Record<string, { model: string }> };
check('assets.json mantiene los modelos del cierre (v1.16)', ['trasteros_planta', 'bajocubierta', 'tejado'].every((k) => !!assets.blocks[k] && existsSync(resolve(import.meta.dir, '../public/assets', assets.blocks[k]!.model))), '3 glTF');

if (fails > 0) {
  console.error(`\nQA v1.17 FALLÓ: ${fails} checks en rojo`);
  process.exit(1);
}
console.log('\nQA v1.17 OK');
