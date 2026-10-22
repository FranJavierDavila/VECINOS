/** Prueba de humo del sim: valida el contenido JSON, crea el mundo, avanza ticks y sigue el tutorial. */
import { loadContent, formatIssues } from '@/game/content';
import { createWorld, dispatch, drainEvents, tick, buildCirculation, travelMinutes } from '@/game/sim';

const baseUrl = new URL('../public/content/', import.meta.url).href;
const { content, issues } = await loadContent(baseUrl);
if (issues.length) {
  console.error('ISSUES:', formatIssues(issues));
  process.exit(1);
}
const world = createWorld(content, content.rules.startScenario);

console.log('Bloques:', Object.keys(world.blocks).length, '| Residentes:', Object.keys(world.residents).length);
console.log('Misiones iniciales:', world.missions.map((m) => `${m.id}:${m.state}`).join(', '));
console.log('Viaje portal→3C:', travelMinutes(buildCirculation(world, content), world.entry, 'blk_p3_c'), 'min');

// Responde el teléfono del tutorial
const phone = world.missions.find((m) => m.state === 'active');
if (phone) {
  const r = dispatch(world, content, { type: 'answer_call', mission: phone.id });
  console.log('answer_call:', r.ok);
}

// Avanza 200 minutos de mundo (los vecinos AI hacen su vida según los horarios del catálogo)
for (let i = 0; i < 200; i++) tick(world, content);

console.log('Día', world.clock.day, world.clock.minute, 'min · clima:', world.weather.state);
console.log('Misiones:', world.missions.map((m) => `${m.id}:${m.state}`).join(', '));

// El jugador sube legalmente: pasillo0 → núcleo → ... → pasillo3 → puerta → entra
for (const block of ['blk_p0_pasillo', 'blk_p0_nucleo', 'blk_p1_nucleo', 'blk_p2_nucleo', 'blk_p3_nucleo', 'blk_p3_pasillo']) {
  dispatch(world, content, { type: 'move', resident: 'res_player_01', to: block });
}
dispatch(world, content, { type: 'approach', resident: 'res_player_01', block: 'blk_p3_c' });
dispatch(world, content, { type: 'move', resident: 'res_player_01', to: 'blk_p3_c' });
for (let i = 0; i < 60; i++) tick(world, content);

console.log('Misiones tras entrar:', world.missions.map((m) => `${m.id}:${m.state}`).join(', '));
console.log('Cotilla llegó:', world.residents['res_cotilla_01']!.present, '· 1B:', world.blocks['blk_p1_b']!.access);
console.log('Actividad de la cotilla:', world.residents['res_cotilla_01']!.activity, '· ubicación:', world.residents['res_cotilla_01']!.location);

const evs = drainEvents(world);
console.log('Eventos acumulados:', evs.length);
const types = [...new Set(evs.map((e) => e.type))];
console.log('Tipos de evento vistos:', types.join(', '));
console.log('Cartera jugador:', world.residents['res_player_01']!.wallet, '€');
console.log('SMOKE OK');
