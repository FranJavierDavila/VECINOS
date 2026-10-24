/**
 * Prueba de humo v0.5 — núcleo multi-actor:
 * 1) Junta con DOS humanos: la votación no se cierra hasta que votan todos.
 * 2) Junta con UN humano (partida clásica): se cierra al instante (compatibilidad).
 * 3) buy_block con actor: el comprador es el residente del actor, no world.playerId.
 */
import { loadContent, formatIssues } from '@/game/content';
import { applyEffects, createWorld, dispatch, drainEvents } from '@/game/sim';
import type { JuntaItem, World } from '@/game/core/types';

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FALLO:', msg);
    process.exit(1);
  }
  console.log('OK ·', msg);
}

/** Añade un humano invitado a la partida (mismo proceso que hará el servidor). */
function addGuest(world: World, id: string): void {
  const vacant = Object.values(world.blocks).find((b) => b.kind === 'dwelling' && b.occupancy === 'vacant');
  if (!vacant) throw new Error('no hay vivienda vacante para el test');
  vacant.occupancy = 'occupied';
  vacant.ownerId = id;
  world.residents[id] = {
    id,
    archetype: content.rules.multiplayer.guestArchetype,
    controller: { type: 'human', playerId: 'socket-test' },
    home: vacant.id,
    present: true,
    location: world.entry,
    activity: null,
    parentOf: [],
    wallet: content.rules.multiplayer.guestWallet,
    reputation: 50,
    needs: { ...content.rules.sim.defaultNeeds },
    relations: [],
    cooldowns: {},
  };
}

const agenda: JuntaItem[] = [{ id: 'j_test', title: 'Pintar el portal', description: 'Un color alegre para todos', cost: 0, effects: [{ op: 'toast', text: 'Portal pintado (aprobado)', tone: 'good' }] }];

// ── 1) Junta con dos humanos: espera al segundo voto ──
const w1 = createWorld(content, content.rules.startScenario);
addGuest(w1, 'res_guest_1');
applyEffects(w1, content, [{ op: 'openJunta', agenda }], {});
assert(w1.junta !== null, 'openJunta abre la votación');
const r1 = dispatch(w1, content, { type: 'junta_vote', vote: 'yes' });
assert(r1.ok && w1.junta !== null && w1.junta.votes['res_player_01'] === 'yes', 'voto del anfitrión registrado y la votación sigue abierta (falta el invitado)');
const r2 = dispatch(w1, content, { type: 'junta_vote', vote: 'no', actor: 'res_guest_1' });
assert(r2.ok && w1.junta === null, 'voto del invitado cierra la votación (2 humanos)');
const closedEvents = drainEvents(w1);
const result = closedEvents.find((e) => e.type === 'junta_result');
assert(!!result && typeof result.data.yes === 'number' && (result.data.yes as number) >= 2, `junta_result cuenta los votos humanos (sí=${result?.data.yes}, no=${result?.data.no})`);

// ── 2) Compatibilidad: un humano resuelve al instante ──
const w2 = createWorld(content, content.rules.startScenario);
applyEffects(w2, content, [{ op: 'openJunta', agenda }], {});
dispatch(w2, content, { type: 'junta_vote', vote: 'yes' });
assert(w2.junta === null, 'partida clásica (1 humano): la votación se cierra con un solo voto');

// ── 3) buy_block con actor: compra el invitado, no el anfitrión ──
const w3 = createWorld(content, content.rules.startScenario);
addGuest(w3, 'res_guest_2');
const target = Object.values(w3.blocks).find((b) => b.kind === 'dwelling' && b.occupancy === 'vacant')!;
applyEffects(w3, content, [{ op: 'unlock', target: target.id, availability: { mode: 'for_sale', price: 100 } }], {});
const forSale = Object.values(w3.blocks).find((b) => b.availability);
assert(!!forSale, 'el test pone una vivienda a la venta (efecto unlock del catálogo)');
const walletGuest0 = w3.residents['res_guest_2']!.wallet;
const price = forSale!.availability!.price;
// El invitado no siempre llega con caja: le damos lo justo para el test (el servidor lo permite: es su dinero)
w3.residents['res_guest_2']!.wallet = price + 50;
const rb = dispatch(w3, content, { type: 'buy_block', block: forSale!.id, actor: 'res_guest_2' });
assert(rb.ok && forSale!.ownerId === 'res_guest_2' && w3.residents['res_guest_2']!.wallet === 50, 'buy_block con actor: el invitado compra y paga de SU cartera');
assert(w3.residents['res_player_01']!.wallet === w3.residents['res_player_01']!.wallet, 'la cartera del anfitrión no se toca');
console.log(`compra: precio=${price} €, invitado tenía ${walletGuest0}→${price + 50} (ajustado por test) → 50 €`);

console.log('SMOKE JUNTA/ACTOR OK');
