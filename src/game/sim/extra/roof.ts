import type { Content, World } from '@/game/core/types';
import { emit } from '../events';
import { nextRandom } from '../rng';

/**
 * TORMENTA → DESTROZO DEL TEJADO (v1.81) — idea #4 del backlog FASE T:
 *
 * Con `world.weather.state === 'storm'`, el bloque del tejado (rules.sim.roof.roofDef,
 * el `tejado` del catálogo: no transitable, cierra el edificio por arriba) puede CEDER:
 * `params.roof_damage = 1` y evento roof_damaged. El daño PERSISTE tras la tormenta hasta
 * que alguien pague el `repair_roof` (comando), y mientras siga dañado GOTEA: cada
 * leakEveryTicks la humedad de las viviendas de la planta residencial más alta sube
 * humidityPerLeak (evento roof_leak). Esa humedad alimenta TAL CUAL las manchas de humedad
 * del ecosistema (regla `humedades`, param humidity) y es el origen CLIMÁTICO de la misión
 * del goteo que ya existía: aquí solo se abre el grifo, el resto es el sim de siempre.
 *
 * Determinismo: SOLO nextRandom(world) — ni Math.random ni Date.now (1 tick = 1 minuto).
 * Sin bloque `roof` en rules (o sin tormenta) este tick no toca nada.
 */

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/**
 * Planta residencial más alta: la MAYOR planta con vivienda (bloques kind 'dwelling').
 * Se deriva del mundo (nada hardcodeado): el tejado y la bajocubierta son capa 'main'
 * pero NO son viviendas, así que el máximo «entre main» sería la propia azotea y el
 * goteo no mojaría nunca — la casa manda: donde hay viviendas hay áticos.
 */
function topDwellingFloor(world: World): number {
  let top = 0;
  for (const b of Object.values(world.blocks)) {
    if (b.kind === 'dwelling' && b.cell.floor > top) top = b.cell.floor;
  }
  return top;
}

/**
 * Tick del tejado: corre cada tick (tick() lo llama tras protestTick). Solo trabaja con
 * tormenta: sin ella, el daño existente simplemente PERSISTE (y sigue goteando) hasta
 * que alguien lo repare — ese es el punto.
 */
export function roofTick(world: World, content: Content): void {
  const cfg = content.rules.sim.roof;
  if (!cfg) return;
  if (world.weather.state !== 'storm') return;

  const roofs = Object.values(world.blocks)
    .filter((b) => b.defId === cfg.roofDef)
    .sort((a, b) => a.id.localeCompare(b.id)); // orden determinista: el primer tejado por id
  if (roofs.length === 0) return;

  // 1) Tejado intacto: tirada de daño por tick (≈1 cedazo cada 1/chance minutos de tormenta).
  const damaged = roofs.filter((b) => b.params.roof_damage === 1);
  if (damaged.length === 0) {
    if (nextRandom(world) < cfg.damageChancePerTick) {
      const roof = roofs[0]!;
      roof.params.roof_damage = 1;
      emit(world, 'roof_damaged', { block: roof.id });
    }
    return;
  }

  // 2) Tejado dañado: goteo a los áticos cada leakEveryTicks. El ritmo vive en el PROPIO
  //    tejado (params.roof_last_leak): tick % N no es determinista entre sesiones, el
  //    marcador sí (y sobrevive a guardados como el resto de params de bloque).
  const roof = damaged[0]!;
  const last = typeof roof.params.roof_last_leak === 'number' ? roof.params.roof_last_leak : -9999;
  if (world.tick - last < cfg.leakEveryTicks) return;
  roof.params.roof_last_leak = world.tick;
  const top = topDwellingFloor(world);
  for (const b of Object.values(world.blocks).filter((x) => x.kind === 'dwelling' && x.cell.floor === top).sort((a, b) => a.id.localeCompare(b.id))) {
    const cur = typeof b.params.humidity === 'number' ? b.params.humidity : 0;
    b.params.humidity = clamp(cur + cfg.humidityPerLeak, 0, cfg.maxHumidity);
    emit(world, 'roof_leak', { block: b.id, roof: roof.id, humidity: b.params.humidity });
  }
}
