# FASE T — PLAYTESTING: protocolo de sesiones (v1.76+)

> El instrumento vive: el juego reporta sesiones, minutos activos y errores deduplicados.
> Este documento es el protocolo para convertir ese ruido en decisiones.

## 1. ANTES DE CADA PLAYTEST (5 min)

1. **Versión del SW**: `curl -s localhost:3000/sw.js | grep VERSION` debe coincidir con el
   banner del juego y con `PwaRegister.EXPECTED_SW_VERSION`. Un playtester con shell vieja
   reporta bugs de hace 20 versiones (lección v1.75).
2. **Lienzo vivo**: abre el juego, mira que el canvas renderice y la consola esté limpia.
3. Anota la hora de inicio: la primera sesión del playtester nace con su primer `boot`.

## 2. DURANTE (sesiones de 15–30 min)

- Deja jugar SIN interrumpir. La telemetría mide sola:
  - `activeMins` por sesión — latido por minuto SOLO con pestaña visible (atención real).
  - Errores JS/rejections/console.error con huella FNV-1a y pila del primer avistamiento.
- Si el playtester verbaliza algo («esto no se entiende», «me aburro aquí»), apunta el
  minuto aproximado: se cruza con la línea de tiempo de la sesión.

## 3. DESPUÉS (10 min) — leer la vista agregada

`curl -s localhost:3000/api/telemetry | python3 -m json.tool` (o abrir en el navegador):

- **`totals.sessions` / `totals.events`**: actividad de la tanda.
- **`sessions[]`** ordenadas por `lastSeen`: quién jugó, cuántos minutos activos
  (`activeMins`), con cuántos errores. Sesión con `activeMins` alto y 0 errores = buena.
- **`errors[]`** ordenadas por `count`: el error más repetido manda en el triage. Con
  `sessions === 1` casi siempre es problema local (extensión, pestaña vieja); con
  `sessions >= 2` es bug de producto y sube al worklog.
- **`recent[]`**: los últimos 50 eventos tal cual (para cronología).

## 4. CRITERIOS DE ÉXITO DE FASE T (iniciales, a calibrar con datos)

| Métrica | Objetivo inicial |
|---|---|
| Sesión de un jugador nuevo | ≥ 20 `activeMins` antes de cerrar |
| Errores por sesión de 30 min | ≤ 1 (y nunca `sessions >= 2` sin worklog) |
| Reentrada al día siguiente | la sesión persiste en `localStorage` (mismo `session` id) |

## 5. SIGUIENTE INSTRUMENTO (cuando el playtest lo pida)

- Eventos de gameplay anónimos (misión empezada/abandonada, muerte de sesión, compra).
- Los 4 ítems del contrato de diseño viven en `docs/PRESIDENCIA-FASES.md` (Fases U–Y):
  cada uno se validará con este mismo instrumento antes de considerarse terminado.
