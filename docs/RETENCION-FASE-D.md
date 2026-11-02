# FASE D — Diseño de retención (one-pager)

> v1.74 · El bucle completo en una página: qué hace un vecino en una sesión de
> 30/60/90 minutos, con qué economía y con qué reglas competitivas. Todo lo
> tunable vive en `public/content/*.json` (regla inquebrantable nº 1).

## 1. El bucle de juego

```
        ┌── MISIONES DE LA JUNTA (historia · 100–200 pts · 60–300 €) ──┐
        │                                                              ▼
   LLEGAR → CONOCER → ARREGLAR → EMBELLECER   ◄── CO-OP (social · 150–200 pts · 100–150 €)
        ▲              │                              │
        │              ▼                              ▼
        └── TRABAJO (grind corto · 90 €/2,5 min) ── MINIJUEGOS (skill · récord = 50 pts)
                       │                              │
                       ▼                              ▼
                 MOBILIARIO (meta · €) ────► «VECINO DEL MES» (ranking · pts)
```

Cada actividad alimenta la siguiente: las misiones dan dinero y puntos, el trabajo
financia el mobiliario, los minijuegos arreglan lo que las misiones rompen (y puntuán),
la co-op multiplica puntos y paga en equipo, y el ranking corona la sesión.

## 2. Arcos de sesión

| Sesión | Contenido | Sensación objetivo |
|---|---|---|
| **30 min** | Onboarding completo (m_bienvenida → m_ascensor) + 1 co-op + 2 muebles baratos | «Ya soy vecino: tengo piso, tengo acta, tengo sofá» |
| **60 min** | Un arco de saga (ascensor con plan B, o festival I–II) + set de salón + top-3 del marcador | «Tengo un proyecto en este edificio» |
| **90 min** | Saga completa + las 3 co-op + mobiliario premium (placas/TV/HiFi) + «Vecino del mes» | «Tengo reputación: el edificio me conoce» |

## 3. Economía balanceada (antes → después)

| Palanca | v1.73 | v1.74 | Por qué |
|---|---|---|---|
| Trabajo | 120 € / 120 ticks (60 €/min) | **90 € / 150 ticks (36 €/min)** | 3600 €/h compraba el edificio entero en 40 min: sin horizonte |
| Mobiliario (19 piezas) | 2.390 € | **2.765 €** | Premium re-precisado (placas 380, TV 320, HiFi 260…); baratos intactos (impulso) |
| Misiones | 1.215 € | 1.215 € (sin cambio) | Son el pilar de la sesión, no el grifo |
| Co-op | 0 € | **+100/100/150 € por rol** | El dinero en equipo existe y se reparte |
| Alquiler | ya existía | sin cambio | Ingreso de arco largo (propietario) |

**Horizonte resultante**: sesión mixta de 60 min ≈ 1.600–1.900 € (misiones + trabajo)
→ set completo de mobiliario ≈ **2 sesiones de 90 min** o ~4 de 60. La cartera del
invitado (300 €) compra 2 piezas baratas de arranque, sin más cambios.

## 4. Reglas competitivas: catálogo de puntos «Vecino del mes»

| Fuente | Puntos | Notas |
|---|---|---|
| Misión normal completada (anfitrión) | 100 | base `missionCompletedPoints` |
| Saga del ascensor (m_ascensor, m_manitas_ascensor) | +50 | `missionBonus` |
| Festival del Portal (I/II/III) | +75 / +75 / +100 | `missionBonus` |
| Historia mayor (m_llegada_buitre, m_okupa, m_veredicto) | +50 / +50 / +100 | `missionBonus` |
| Récord personal mejorado en minijuego | 50 × **6 minijuegos** | antes solo mg_fusibles puntuaba: los otros 5 daban 0 |
| Co-op completada (por rol asignado) | 150 / 150 / 200 | `pointsBonus` (negociación sube) |
| Misiones QA (m_qa_1…5) | **0 — excluidas** | `score.excluded`: son herramientas, no juego |

Anti-abuso ya existente (v1.55): solo puntúa MEJORAR el récord personal, éxito
recente ≤ 30 s obligatorio, 3 s entre marcas, tiempos imposibles fuera.

## 5. Verificación (definición de «hecho»)

- `qa-v174-faseD.ts` — unidad (matemática de economía dentro de presupuesto de diseño,
  catálogo de 6 minijuegos, exclusiones) + E2E en servidor propio :3017 (misión QA
  excluida → 0 pts; m_ascensor → 150 pts; récord mg_buzones → +50; co-op completa →
  pts + € por rol, visible en world.residents).
- Regresión: qa-v164-multi, qa-v137, test-pose en :3010, tsc 0 sin caché, eslint limpio.
