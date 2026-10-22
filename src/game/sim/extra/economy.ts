import type { Content, World } from '@/game/core/types';
import { emit } from '../events';

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Economía y vida diaria: alquiler del jugador a las 9:00, deriva de necesidades
 * (sueño, diversión, social) y deterioro suave de la limpieza del pasillo.
 */
export function economyTick(world: World, _content: Content): void {
  // Alquiler diario a las 09:00 de las viviendas del jugador ocupadas por otros.
  if (world.clock.minute === 540) {
    for (const b of Object.values(world.blocks)) {
      if (b.ownerId !== world.playerId || b.id === world.residents[world.playerId]!.home) continue;
      if (b.occupancy !== 'occupied') continue;
      const tenant = Object.values(world.residents).find((r) => r.home === b.id && r.id !== world.playerId);
      if (!tenant) continue;
      const rent = Number(b.params['rent'] ?? 0);
      if (rent <= 0) continue;
      world.residents[world.playerId]!.wallet += rent;
      emit(world, 'rent_collected', { block: b.id, amount: rent, tenant: tenant.id });
    }
  }

  // Necesidades: deriva lenta; las actividades relevantes empujan al alza.
  for (const r of Object.values(world.residents)) {
    if (!r.present) continue;
    const sleeping = r.activity === 'sleep';
    r.needs['sleep'] = clamp100((r.needs['sleep'] ?? 50) + (sleeping ? 0.35 : -0.04));
    r.needs['fun'] = clamp100((r.needs['fun'] ?? 50) + (r.activity === 'party' ? 0.5 : -0.02));
    r.needs['social'] = clamp100((r.needs['social'] ?? 50) + (r.activity === 'watch_corridor' ? 0.3 : -0.015));
  }

  // El pasillo se ensucia solo; la cotilla juzga en silencio.
  for (const b of Object.values(world.blocks)) {
    if (b.defId !== 'pasillo_planta') continue;
    const c = Number(b.params['cleanliness'] ?? 70);
    b.params['cleanliness'] = Math.max(0, c - 0.005);
  }
}
