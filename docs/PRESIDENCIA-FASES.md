# FASE PRESIDENCIA — el gran diseño multijugador de VECINOS

> Registro del dictado del vecino (sesión de recuperación, 2026-11-04). El diseño MANDA:
> la implementación llegará por fases después de la recuperación v1.75 y del instrumento
> de playtesting (FASE T). Nada de esto toca el sim determinista sin regla explícita.

## 1. LA LÍNEA PRINCIPAL SE ACLARA: «PRESIDENTE POR 7 DÍAS»

- **El objetivo del juego** pasa a ser una carrera clara: **ser presidente de la comunidad
  y aguantar los 7 días de mandato**. Eso ES terminar la partida (victoria del modo historia).
- **Los demás jugadores reales** tienen el objetivo INVERTIDO: **sacar al presidente antes
  de que cumpla los 7 días** (mociones de censura, derramas que fracasan, escándalos, ruido
  y denuncias… todo vale).
- El presidente debe **ganarse a TODOS los vecinos**: cada vecino con su ánimo contando;
  si la mayoría se vuelve contra él, cae.
- Los demás jugadores compiten ENTRE SÍ por la simpatía del vecindario (cada uno quiere
  ser el candidato favorito) y se sabotean unos a otros.

## 2. REPUTACIÓN SECRETA (indicador privado)

- **Cada jugador tiene un valor de REPUTACIÓN que SOLO él ve** (indicador en su HUD).
- La reputación la mueven: misiones cumplidas, derramas pagadas, co-op, favores a vecinos,
  tratos con otros jugadores, escándalos provocados…
- Es la moneda secreta de la junta: al final, cuenta. Nadie sabe la reputación del rival.

## 3. INTRIGA: SOBORNOS Y LA «AMIGA CARIÑOSA»

- **Sobornos**: pagar € a un vecino (IA o jugador) para inclinar su ánimo o su voto.
  Riesgo: si se descubre, reputación cae y hay escándalo.
- **Amiga cariñosa** (mercado de información): un personaje contratado por € que te vende
  **información de los otros jugadores** — su reputación aproximada, con quién habla,
  qué trama. Cada jugador puede tener la suya; las amigas se conocen entre sí (chismorreo).

## 4. LA JUNTA DE VECINOS FINAL (día 7)

- Al terminar los 7 días se convoca la **junta de vecinos general**: votación que decide
  quién se lleva el **BASTÓN DE MANDO** (el mando de la comunidad = la victoria).
- Votan los vecinos IA (según ánimo/reputación con cada candidato) y los jugadores.
- El presidente saliente que sobrevive los 7 días parte con ventaja, no con victoria
  automática: la junta manda.

## 5. MULTIJUGADOR: PERSONAS ÚNICAS Y JUGADORES VISIBLES

- **Los jugadores online pueden RECLAMAR una persona (personaje) del vecindario**.
  - **NO SE PUEDEN REPETIR**: una persona reclamada queda BLOQUEADA para el resto
    (persistente mientras dura la partida/servidor).
- **Los personajes controlados por humanos llevan un ICONO pequeño sobre la cabeza**
  (siempre visible) para distinguirlos de los vecinos IA de un vistazo.
- **Chat de texto entre jugadores**: SOLO frases cortas (banco de frases seleccionables),
  que aparecen como **bocadillo junto al personaje** (el sistema bubbles ya existe:
  los vecinos IA hablan con él — el chat humano reutiliza ese camino).

## 6. ORDEN DE IMPLEMENTACIÓN PROPUESTO (fases futuras)

1. **FASE T** (en curso): instrumento de playtesting — telemetría viva (v1.75), latido
   de actividad, vista de sesiones.
2. **FASE U — Reputación secreta**: HUD privado + eventos que la mueven (data-driven).
3. **FASE V — Mandato de 7 días**: contador de mandato, caída por ánimo medio, mociones.
4. **FASE W — Intriga**: sobornos + amiga cariñosa (mercado de información).
5. **FASE X — Junta final**: votación del bastón de mando con reputación secreta.
6. **FASE Y — Multijugador social**: claim de persona única + icono humano + chat de
   frases cortas con bocadillos.

*El vecino dictó el diseño; esta página es su contrato. La implementación lo traducirá literal.*
