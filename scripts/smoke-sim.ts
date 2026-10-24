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

// ── v0.2: editor de interiores ──
const home3c = world.blocks['blk_p3_c']!;
const salon = home3c.rooms.find((r) => r.key === 'salon')!;
console.log('Ranuras del salón:', Object.keys(salon.furniture).join(', '));
const slotSuelo = 'salon_suelo_1';
const slotPared = 'salon_pared_1';
const wallet0 = world.residents['res_player_01']!.wallet;
const r1 = dispatch(world, content, { type: 'place_furniture', block: 'blk_p3_c', room: 'salon', slot: slotPared, item: 'mue_router' });
const r2 = dispatch(world, content, { type: 'place_furniture', block: 'blk_p3_c', room: 'salon', slot: slotSuelo, item: 'mue_olla' });
const rBad = dispatch(world, content, { type: 'place_furniture', block: 'blk_p3_c', room: 'salon', slot: slotPared, item: 'mue_router' });
const rMismatch = dispatch(world, content, { type: 'place_furniture', block: 'blk_p3_c', room: 'salon', slot: slotSuelo, item: 'mue_router' });
console.log('place router:', r1.ok, '· place olla:', r2.ok, '· repetido rechazado:', !rBad.ok, '· ranura equivocada rechazada:', !rMismatch.ok, '· cartera:', world.residents['res_player_01']!.wallet, '(antes', wallet0 + ')');

// Wifi y olores: tick hasta cruzar umbrales (wifi llega a vecinos, odors se quedan cerca)
for (let i = 0; i < 40; i++) tick(world, content);
const chanTypes = [...new Set(drainEvents(world).map((e) => e.type))];
console.log('Canales activos:', Object.keys(world.channels).join(', '));
console.log('Wifi en vecinos:', Object.keys(world.channels['wifi'] ?? {}).join(', ') || '(ninguno)');
console.log('Eventos de umbral vistos:', chanTypes.filter((t) => t.includes('_complaint') || t === 'wifi_shared' || t === 'leak_detected').join(', ') || '(ninguno)');

// Quitar mueble devuelve parte del precio
const wallet1 = world.residents['res_player_01']!.wallet;
const r3 = dispatch(world, content, { type: 'remove_furniture', block: 'blk_p3_c', room: 'salon', slot: slotPared });
console.log('remove router:', r3.ok, '· reembolso aplicado:', world.residents['res_player_01']!.wallet > wallet1);

// Reforma de estancia bloqueada + colocación en ella
const dorm = home3c.rooms.find((r) => r.key === 'dormitorio')!;
console.log('Dormitorio bloqueado:', dorm.access === 'locked');
const r4 = dispatch(world, content, { type: 'renovate_room', block: 'blk_p3_c', room: 'dormitorio' });
console.log('renovate_room:', r4.ok, '· acceso:', dorm.access, '· cartera:', world.residents['res_player_01']!.wallet);

// ── v0.2: minijuegos (consecuencias data-driven) ──
const hum0 = home3c.params['humidity'];
dispatch(world, content, { type: 'complete_minigame', id: 'mg_desatascar', success: true });
console.log('minijuego éxito → humedad:', hum0, '→', home3c.params['humidity']);
dispatch(world, content, { type: 'complete_minigame', id: 'mg_desatascar', success: false });
console.log('minijuego fallo → humedad:', home3c.params['humidity']);

// ── v0.3: canales plagas y smoke ──
const plagueEvents = (types: string[]) => types.filter((t) => t === 'plague_sighting' || t === 'smoke_alarm');

// Plagas: la caja de trastos emite hacia vecinos (down 0.55, horizontal 0.4, corridor 0.45)
dispatch(world, content, { type: 'place_furniture', block: 'blk_p3_c', room: 'salon', slot: 'salon_suelo_2', item: 'mue_trastos' });
for (let i = 0; i < 20; i++) tick(world, content);
const evPlagas = drainEvents(world);
console.log('Canal plagas activo en:', Object.keys(world.channels['plagas'] ?? {}).sort().join(', ') || '(ninguno)');
console.log('Plaga (param) en 3D/2C:', world.blocks['blk_p3_d']!.params['plague'], '/', world.blocks['blk_p2_c']!.params['plague'], '· eventos:', plagueEvents(evPlagas.map((e) => e.type)).length);

// El absorbente (trampa) reduce el canal en su propio bloque
const plagueBefore = Object.keys(world.channels['plagas'] ?? {}).length;
dispatch(world, content, { type: 'place_furniture', block: 'blk_p3_c', room: 'salon', slot: 'salon_pared_1', item: 'mue_trampa' });
for (let i = 0; i < 10; i++) tick(world, content);
console.log('Trampa colocada: bloques con plagas', plagueBefore, '→', Object.keys(world.channels['plagas'] ?? {}).length);

// Smoke: libera el suelo (olla), pon la plancha de balcón (sube 0.9 al 4C), prueba rechazo en pared y restaura
dispatch(world, content, { type: 'remove_furniture', block: 'blk_p3_c', room: 'salon', slot: 'salon_suelo_2' });
dispatch(world, content, { type: 'remove_furniture', block: 'blk_p3_c', room: 'salon', slot: 'salon_pared_1' });
dispatch(world, content, { type: 'remove_furniture', block: 'blk_p3_c', room: 'salon', slot: 'salon_suelo_1' }); // sale la olla
dispatch(world, content, { type: 'place_furniture', block: 'blk_p3_c', room: 'salon', slot: 'salon_suelo_1', item: 'mue_plancha' });
const rPared = dispatch(world, content, { type: 'place_furniture', block: 'blk_p3_c', room: 'salon', slot: 'salon_pared_1', item: 'mue_plancha' }); // rechazo esperado (salon_suelo)
for (let i = 0; i < 20; i++) tick(world, content);
const evSmoke = drainEvents(world);
console.log('Rechazo plancha en pared:', !rPared.ok);
console.log('Canal smoke activo en:', Object.keys(world.channels['smoke'] ?? {}).sort().join(', ') || '(ninguno)');
console.log('Hollín (param) en 4C:', world.blocks['blk_p4_c']!.params['soot'], '· eventos smoke:', plagueEvents(evSmoke.map((e) => e.type)).length);
dispatch(world, content, { type: 'remove_furniture', block: 'blk_p3_c', room: 'salon', slot: 'salon_suelo_1' }); // sale la plancha
dispatch(world, content, { type: 'place_furniture', block: 'blk_p3_c', room: 'salon', slot: 'salon_suelo_1', item: 'mue_olla' }); // vuelve la olla

// Minijuegos nuevos: consecuencias del catálogo (reflex_targets y memory_pairs)
const plague1b0 = world.blocks['blk_p1_b']!.params['plague'];
dispatch(world, content, { type: 'complete_minigame', id: 'mg_fumigar', success: true });
console.log('mg_fumigar éxito → plague 1B:', plague1b0, '→', world.blocks['blk_p1_b']!.params['plague']);
const walletCorreos = world.residents['res_player_01']!.wallet;
dispatch(world, content, { type: 'complete_minigame', id: 'mg_buzones', success: true });
console.log('mg_buzones éxito → cartera:', walletCorreos, '→', world.residents['res_player_01']!.wallet);
dispatch(world, content, { type: 'complete_minigame', id: 'mg_fusibles', success: false });
console.log('mg_fusibles fallo → condición del núcleo:', world.blocks['blk_p0_nucleo']?.params['condition'] ?? Object.values(world.blocks).find((b) => b.params.condition !== undefined)!.params['condition']);

console.log('Misiones al final:', world.missions.map((m) => `${m.id}:${m.state}`).join(', '));
console.log('SMOKE OK');
