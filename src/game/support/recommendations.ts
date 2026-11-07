/**
 * RECOMENDACIONES DE LA COMUNIDAD (v1.84) — «¿qué hago ahora?».
 *
 * El vecino preguntó «¿dónde están las últimas recomendaciones?»: este módulo ES la
 * respuesta. Es SOPORTE puro (igual que campaign/achievements): lee una foto del
 * estado (la misma que el HUD) y deriva UNA LISTA CORTA de recomendaciones en orden
 * de prioridad. Nada toca el sim ni la partida: todo es presentación derivada.
 *
 * Las reglas son data-driven sobre el snapshot del store (no hay heurísticas escondidas):
 *   1. Decisión de misión pendiente  → jamás se despista el jugador (máxima prioridad).
 *   2. Ascensor averiado             → el vecindario lo sufre cada día.
 *   3. Arcas justas (< 150 €)        → la comunidad no puede pagar obras.
 *   4. Reputación baja (< 40) / alta (> 75) → el medidor del HUD con consejo.
 *   5. Mandato en curso              → día {d}/{n}: aguantar el cargo.
 *   6. Misión activa                 → «sigue {title}» con lo que falte.
 *   7. Vecino frío (afinidad < 40)   → charla con un tema que le guste.
 *   8. Silencio                      → consejo genérico de paseo/tabón.
 */

/** Tipos de recomendación (la UI los traduce con i18n — nada de textos aquí). */
export type RecoKind =
  | 'decision'
  | 'elevator'
  | 'funds'
  | 'repLow'
  | 'repHigh'
  | 'mandate'
  | 'mission'
  | 'neighbor'
  | 'explore';

export interface Reco {
  kind: RecoKind;
  /** Parámetros de interpolación i18n ({title}, {n}, {d}…). */
  vars: Record<string, string | number>;
}

export interface RecoInput {
  elevator: string;
  reputation: number;
  funds: number;
  missions: ReadonlyArray<{ id: string; title: string; state: string; remaining: string | null }>;
  campaign: { active: boolean; over: boolean; dayOfTerm: number; termDays: number } | null;
  /** Vecinos con afinidad conocida (los null aún no tienen relación). */
  neighbors: ReadonlyArray<{ id: string; name: string; affinity: number | null }>;
}

/** Tope de recomendaciones mostradas (el panel es una nota, no un tratado). */
const MAX_RECOS = 4;

export function recommendationsOf(input: RecoInput): Reco[] {
  const out: Reco[] = [];

  const decision = input.missions.find((m) => m.state === 'awaiting_choice');
  if (decision) out.push({ kind: 'decision', vars: { title: decision.title } });

  if (input.elevator !== 'ok') out.push({ kind: 'elevator', vars: {} });

  if (input.funds < 150) out.push({ kind: 'funds', vars: { n: Math.round(input.funds) } });

  if (input.reputation < 40) out.push({ kind: 'repLow', vars: { n: Math.round(input.reputation) } });
  else if (input.reputation > 75) out.push({ kind: 'repHigh', vars: { n: Math.round(input.reputation) } });

  if (input.campaign?.active && !input.campaign.over) {
    out.push({
      kind: 'mandate',
      vars: { d: input.campaign.dayOfTerm, n: input.campaign.termDays },
    });
  }

  const active = input.missions.find((m) => m.state === 'active');
  if (active) {
    out.push({
      kind: 'mission',
      vars: { title: active.title, rest: active.remaining ? ` — ${active.remaining}` : '' },
    });
  }

  const cold = input.neighbors
    .filter((r) => r.affinity !== null && (r.affinity as number) < 40)
    .sort((a, b) => (a.affinity as number) - (b.affinity as number))[0];
  if (cold) out.push({ kind: 'neighbor', vars: { name: cold.name, n: Math.round(cold.affinity as number) } });

  if (out.length === 0) out.push({ kind: 'explore', vars: {} });

  return out.slice(0, MAX_RECOS);
}
