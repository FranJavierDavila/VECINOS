import type { Content, World } from '@/game/core/types';
import { emit } from '../events';

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
const minuteOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/**
 * Economía y vida diaria. Todos los ritmos (hora del alquiler, deriva de necesidades,
 * suciedad del pasillo) vienen de content.rules.sim.economy: aquí solo hay algoritmo.
 */
export function economyTick(world: World, content: Content): void {
  const eco = content.rules.sim.economy;

  // Alquiler diario de las viviendas del jugador ocupadas por otros.
  if (world.clock.minute === minuteOf(eco.rentMinute)) {
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

  // Necesidades: deriva base por necesidad + empuje de la actividad en curso.
  for (const r of Object.values(world.residents)) {
    if (!r.present) continue;
    for (const [need, drift] of Object.entries(eco.needDrift)) {
      const push = r.activity ? (drift.activity[r.activity] ?? 0) : 0;
      r.needs[need] = clamp100((r.needs[need] ?? 50) + drift.base + push);
    }
  }

  // Los espacios con parámetro de suciedad se ensucian solos; la cotilla juzga en silencio.
  for (const b of Object.values(world.blocks)) {
    if (b.params[eco.corridorDirtParam] === undefined) continue;
    const current = Number(b.params[eco.corridorDirtParam]!);
    b.params[eco.corridorDirtParam] = Math.max(0, current - eco.corridorDirtPerTick);
  }
}
