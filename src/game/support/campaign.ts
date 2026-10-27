import type { Content, World } from '@/game/core/types';
import { useGameStore, type CampaignHud } from '@/game/client/store';

/**
 * Campaña de presidencia (v1.18) — soporte PURO: deriva el estado del mandato del mundo
 * (misiones del catálogo) y lo publica en el HUD. El sim no la consume; el tablón y el
 * chip del HUD sí.
 *
 *   · termMission done + endMission pending → presidencia ACTIVA.
 *   · El día de inicio se captura en el mission_completed y persiste en localStorage
 *     (vecinos.campaign.v1): sobrevive a cargas como el resto del perfil.
 *   · endMission done → mandato juzgado: chip fuera y registro limpio.
 */

const LS_KEY = 'vecinos.campaign.v1';

interface Stored { startDay: number }

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Stored;
    return typeof p.startDay === 'number' && p.startDay >= 1 ? p : null;
  } catch {
    return null;
  }
}

function writeStored(s: Stored): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* almacenamiento lleno o privado: el HUD cae a día de reloj */
  }
}

function clearStored(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* noop */
  }
}

/** Reevalúa la campaña contra el mundo y publica el chip del HUD (o lo limpia). */
export function syncCampaign(world: World, content: Content): void {
  const cfg = content.rules.sim.campaign;
  const store = useGameStore.getState();
  if (!cfg) {
    if (store.campaign) store.setCampaign(null);
    return;
  }
  const stateOf = (id: string): string | null => world.missions.find((m) => m.id === id)?.state ?? null;
  const termDone = stateOf(cfg.termMission) === 'done';
  const endDone = stateOf(cfg.endMission) === 'done';

  if (!termDone || endDone) {
    // Sin mandato activo (aún no tocó / ya juzgado): registro limpio y chip fuera.
    // El día de inicio se recaptura SIEMPRE en el mission_completed del cargo, así que
    // un mundo nuevo (restart) no hereda el arranque del anterior.
    if (readStored()) clearStored();
    if (store.campaign) store.setCampaign(null);
    return;
  }

  const stored = readStored();
  const startDay = stored?.startDay ?? world.clock.day;
  if (!stored) writeStored({ startDay });

  const dayOfTerm = Math.max(1, world.clock.day - startDay + 1);
  const hud: CampaignHud = {
    active: true,
    dayOfTerm,
    termDays: cfg.termDays,
    label: cfg.presidentLabel,
    over: dayOfTerm >= cfg.termDays,
  };
  const cur = store.campaign;
  if (!cur || cur.dayOfTerm !== hud.dayOfTerm || cur.over !== hud.over) store.setCampaign(hud);
}

/** Limpia el chip (reset de partida). */
export function resetCampaignHud(): void {
  clearStored();
  useGameStore.getState().setCampaign(null);
}
