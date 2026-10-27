import type { AbstractEngine, Ray, Scene, Vector3 } from '@babylonjs/core';
import type { Content, GameEvent, ResidentInstance, World } from '@/game/core/types';
import { B } from './babylon';
import { useGameStore } from './store';
import type { ActorsDirector } from './actors';

/**
 * Bocadillos de expresión (v1.10) + BOCADILLOS CON TEXTO (v1.15) — capa de PRESENTACIÓN pura.
 *
 * Cada personaje en escena puede lucir un bocadillo sobre la cabeza con la expresión de su
 * estado (ánimo, actividad, gesto social o reacción a un evento del sim). Además, las
 * actividades con líneas `say` en el arquetipo se DICEN: un bocadillo de texto legible
 * cicla las líneas (dice → silencio con glifo → línea siguiente → pausa larga).
 * El QUÉ se muestra vive 100% en public/content/emotes.json (y las líneas en
 * archetypes.json); este módulo solo decide con esas tablas, proyecta la posición
 * 3D→pantalla y pinta el DOM. Cero datos de gameplay: si los catálogos faltan, no hay
 * bocadillos y la partida funciona exactamente igual.
 */

interface EmotePick {
  emoteId: string;
  glyph: string;
  priority: number;
  /** Modo TEXTO (v1.15): se pinta esta línea en vez del glifo. */
  text?: string;
}

/** Estado del ciclo de habla de un actor (v1.15): qué línea toca y en qué fase. */
interface SpeechState {
  activityId: string;
  lines: string[];
  idx: number;
  phase: 'say' | 'gap' | 'cycle';
  t: number;
}

interface TransientEmote extends EmotePick {
  /** performance.now()/1000 en el que expira. */
  until: number;
}

interface BubbleView {
  /** Contenedor posicionado (transform = posición en pantalla). */
  el: HTMLDivElement;
  /** Burbuja visual (glifo/texto + cola); hija de el. */
  inner: HTMLDivElement;
  /** Contenido pintado (glifo o clave de línea): evita re-animar si no cambia. */
  key: string;
  /** Modo de estilo activo: glifo circular o texto multilínea. */
  mode: 'glyph' | 'text';
  /** Prioridad del pick actual (ordenación del tope de glifos en vista edificio). */
  priority: number;
  hidden: boolean;
  /** v1.18: SOLO se muestra tras la primera proyección con transform real. Sin esto, un
   *  bocadillo creado mientras su actor no proyecta nace en (0,0) — la esquina superior
   *  izquierda — y se pinta ENCIMA del indicador de FPS hasta su primera reposición. */
  placed: boolean;
  /** v1.29 — VISIBILIDAD EN CÁMARA: ¿se ve el personaje que lleva el bocadillo? El rayo
   *  cámara→cabeza se reparte por frames (presupuesto) con TTL por actor: la oclusión es
   *  un rayo barato y la decisión cambia poco. */
  occluded: boolean;
  occludedAt: number;
}

export interface BubblesDirector {
  /** Refresco por frame: a cadencia decisionMs reevalúa el estado; SIEMPRE reposiciona. */
  update(dt: number, localActorId: string): void;
  /** Eventos del sim → bocadillos temporales según emotes.events del catálogo. */
  onEvent(e: GameEvent): void;
  /** Texto puntual (v1.20, charlas de cruce): pinta una línea que expira sola. */
  sayText(id: string, text: string, seconds: number): void;
  /** Desmonta la capa DOM (cambio de mundo/escena). */
  dispose(): void;
}

/** Ordena de mayor a menor prioridad y devuelve el primero cuyo rango contiene `m` (rangos abiertos). */
function moodPick(defs: { id: string; glyph: string; priority: number; min?: number; max?: number }[], m: number): EmotePick | null {
  const sorted = [...defs].sort((a, b) => b.priority - a.priority);
  for (const d of sorted) {
    if (d.min !== undefined && m < d.min) continue;
    if (d.max !== undefined && m > d.max) continue;
    return { emoteId: `mood:${d.id}`, glyph: d.glyph, priority: d.priority };
  }
  return null;
}

/** Ánimo del residente: media ponderada de las necesidades que dice el catálogo (0..100). */
function moodOf(r: ResidentInstance, needs: Record<string, number>): number | null {
  let sum = 0;
  let total = 0;
  for (const [k, w] of Object.entries(needs)) {
    const v = r.needs[k];
    if (typeof v === 'number') {
      sum += v * w;
      total += w;
    }
  }
  return total > 0 ? sum / total : null;
}

export function createBubbles(host: HTMLElement, scene: Scene, engine: AbstractEngine, world: World, content: Content, actors: ActorsDirector): BubblesDirector {
  const { Matrix, Vector3 } = B();
  const cfg = content.emotes;
  if (!cfg) {
    // Sin catálogo: director nulo funcional (la partida no depende de los bocadillos).
    return { update() {}, onEvent() {}, sayText() {}, dispose() {} };
  }

  // ── Capa DOM: un contenedor absoluto sobre el canvas; los bocadillos son hijos suyos. ──
  const layer = document.createElement('div');
  layer.dataset.vecinos = 'bubbles';
  layer.setAttribute('aria-hidden', 'true'); // decorativo: el estado del vecindario ya vive en el HUD accesible
  layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5;';
  host.appendChild(layer);

  const bubbles = new Map<string, BubbleView>();
  const transient = new Map<string, TransientEmote>();
  const cooldown = new Map<string, number>();
  /** Ciclos de habla activos por actor (solo actividades con líneas say, v1.15). */
  const speech = new Map<string, SpeechState>();
  const speechCfg = cfg.speech;
  /** Vista EDIFICIO (v1.17): tope de glifos visibles (emotes.bubble.buildingMaxGlyphs);
   *  null = sin tope (cámaras cercanas) o catálogo sin límite. */
  const buildingMaxGlyphs = cfg.bubble.buildingMaxGlyphs;
  let cappedIds: Set<string> | null = null;
  /** Líneas say de la actividad en curso del residente (o null). */
  const sayLinesOf = (r: ResidentInstance): { activityId: string; lines: string[] } | null => {
    if (!speechCfg || !r.activity) return null;
    const lines = content.archetypes[r.archetype]?.activities[r.activity]?.say;
    if (!lines || lines.length === 0) return null;
    return { activityId: r.activity, lines };
  };
  /** Ids pendientes de reevaluación INMEDIATA (acaban de recibir un evento). */
  const dirty = new Set<string>();
  let localActorId = world.playerId;
  let decisionAcc = 0;

  const byId = <T extends { id: string }>(list: T[]): Map<string, T> => new Map(list.map((d) => [d.id, d]));
  const activitiesById = byId(cfg.activities);
  const gesturesById = byId(cfg.gestures);
  const eventRules = cfg.events;

  const ensureBubble = (id: string): BubbleView => {
    const existing = bubbles.get(id);
    if (existing) return existing;
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:0;top:0;will-change:transform;';
    const inner = document.createElement('div');
    inner.style.cssText =
      `display:flex;align-items:center;justify-content:center;` +
      `width:${cfg.bubble.sizePx + 14}px;height:${cfg.bubble.sizePx + 10}px;` +
      `background:#fffdf7;border:2px solid #2b2b2b;border-radius:999px;box-shadow:0 2px 6px rgba(0,0,0,.35);` +
      `font-size:${cfg.bubble.sizePx}px;line-height:1;transform-origin:50% 100%;` +
      `transition:opacity ${cfg.bubble.popMs}ms ease;position:relative;`;
    const span = document.createElement('span');
    span.style.cssText = 'transform:translateY(-1px);font-family:"Segoe UI Emoji","Noto Color Emoji",sans-serif;';
    inner.appendChild(span);
    // Cola del bocadillo (triángulo CSS).
    const tail = document.createElement('div');
    tail.style.cssText =
      'position:absolute;left:50%;bottom:-6px;width:10px;height:10px;background:#fffdf7;' +
      'border-right:2px solid #2b2b2b;border-bottom:2px solid #2b2b2b;transform:translateX(-50%) rotate(45deg);';
    inner.appendChild(tail);
    el.appendChild(inner);
    layer.appendChild(el);
    const view: BubbleView = { el, inner, key: '', mode: 'glyph', priority: 0, hidden: true, placed: false, occluded: false, occludedAt: 0 };
    bubbles.set(id, view);
    return view;
  };

  /** Restilo la burbuja para glifo (círculo) o texto (cápsula multilínea) — v1.15. */
  const applyMode = (b: BubbleView, mode: 'glyph' | 'text'): void => {
    b.mode = mode;
    const span = b.inner.firstChild as HTMLElement;
    if (mode === 'text' && speechCfg) {
      b.inner.style.cssText =
        `display:flex;align-items:center;justify-content:center;` +
        `max-width:${speechCfg.maxPx}px;background:#fffdf7;border:2px solid #2b2b2b;border-radius:12px;` +
        `box-shadow:0 2px 6px rgba(0,0,0,.35);font-size:${speechCfg.fontSizePx}px;line-height:1.3;` +
        `padding:5px 9px;color:#1e1e1e;transform-origin:50% 100%;` +
        `transition:opacity ${cfg.bubble.popMs}ms ease;position:relative;font-weight:500;`;
      span.style.cssText = 'font-family:inherit;text-align:center;';
    } else {
      b.inner.style.cssText =
        `display:flex;align-items:center;justify-content:center;` +
        `width:${cfg.bubble.sizePx + 14}px;height:${cfg.bubble.sizePx + 10}px;` +
        `background:#fffdf7;border:2px solid #2b2b2b;border-radius:999px;box-shadow:0 2px 6px rgba(0,0,0,.35);` +
        `font-size:${cfg.bubble.sizePx}px;line-height:1;transform-origin:50% 100%;` +
        `transition:opacity ${cfg.bubble.popMs}ms ease;position:relative;`;
      span.style.cssText = 'transform:translateY(-1px);font-family:"Segoe UI Emoji","Noto Color Emoji",sans-serif;';
    }
    // La cola vive FUERA del cssText del inner: re-añadirla lo conservaría, pero el inner se
    // reconstruye por encima... la cola es hija del inner y su estilo no se toca aquí: intacta.
  };

  const dropBubble = (id: string): void => {
    const b = bubbles.get(id);
    if (b) {
      b.el.remove();
      bubbles.delete(id);
    }
  };

  const pop = (b: BubbleView): void => {
    b.inner.animate(
      [
        { transform: 'scale(0.4)', opacity: 0 },
        { transform: 'scale(1.12)', opacity: 1, offset: 0.7 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: Math.max(1, cfg.bubble.popMs), easing: 'ease-out' },
    );
  };

  /** Decide el emote del actor por prioridad: evento temporal → gesto → actividad → ánimo.
   *  En vista EDIFICIO (v1.17) las líneas `say` se callan (plano general sin paredes de
   *  texto) y el glifo de actividad/ánimo habla por él. */
  const decide = (id: string): EmotePick | null => {
    const now = performance.now() / 1000;
    const building = useGameStore.getState().camMode === 'edificio';
    const tr = transient.get(id);
    if (tr) {
      if (tr.until > now) return tr;
      transient.delete(id);
    }
    const r = world.residents[id];
    if (!r) return null;
    const g = actors.gestureOf(id);
    if (g) {
      const def = gesturesById.get(g);
      if (def) return { emoteId: `gesture:${def.id}`, glyph: def.glyph, priority: def.priority };
    }
    // HABLA (v1.15): si su actividad tiene líneas `say` y está en fase 'say', TEXTUAL.
    // Pierde con eventos y gestos (es ambiente) y gana al glifo de actividad (hablar manda).
    const sp = speech.get(id);
    if (sp && sp.phase === 'say' && !building) {
      const line = sp.lines[sp.idx];
      if (line) return { emoteId: `say:${sp.activityId}:${sp.idx}`, glyph: '', priority: 50, text: line };
    }
    if (r.activity) {
      const def = activitiesById.get(r.activity);
      if (def) return { emoteId: `activity:${def.id}`, glyph: def.glyph, priority: def.priority };
    }
    const m = moodOf(r, cfg.mood.needs);
    if (m !== null) return moodPick(cfg.moods, m);
    return null;
  };

  /** Reevalúa y pinta el bocadillo de un actor (solo toca el DOM si cambia la expresión).
   *  v1.18: un bocadillo sin `placed` (nunca proyectado) permanece invisible — aunque el
   *  pick exista — hasta que el pase de reposición le asigna transform real. */
  const refresh = (id: string): void => {
    const r = world.residents[id];
    const head = actors.headOf(id);
    const pick = head && r ? decide(id) : null;
    if (!pick) {
      const b = bubbles.get(id);
      if (b && !b.hidden) {
        b.hidden = true;
        b.inner.style.opacity = '0';
      }
      return;
    }
    const b = ensureBubble(id);
    const isText = pick.text !== undefined;
    const key = isText ? pick.emoteId : pick.glyph;
    b.priority = pick.priority;
    // Silenciada por el tope de la vista edificio: se actualiza el contenido en silencio
    // (sin pop ni opacity 1 — el Web Animations API taparía el opacity 0 del cap).
    const capped = cappedIds !== null && !cappedIds.has(id);
    const shelved = !b.placed; // jamás proyectado: ni un frame en (0,0)
    if (b.key !== key || (isText && b.mode !== 'text') || (!isText && b.mode !== 'glyph')) {
      const modeChanged = b.mode !== (isText ? 'text' : 'glyph');
      b.key = key;
      if (modeChanged) applyMode(b, isText ? 'text' : 'glyph');
      (b.inner.firstChild as HTMLElement).textContent = isText ? pick.text! : pick.glyph;
      b.hidden = capped || shelved;
      b.inner.style.opacity = b.hidden ? '0' : '1';
      if (!b.hidden) pop(b);
    } else if (b.hidden && !capped && !shelved) {
      b.hidden = false;
      b.inner.style.opacity = '1';
      pop(b);
    }
  };

  /** Puntos de proyección reutilizados (cero basura por frame). */
  const worldPt = new Vector3();
  const camFwd = new Vector3();
  const toPt = new Vector3();
  const projected = new Vector3();
  const identity = Matrix.IdentityReadOnly;

  // ── v1.29 — «SOLO SE VERÁN SI EN LA CÁMARA ESCOGIDA SE VE EL PERSONAJE QUE LOS LLEVA» ──
  // Oclusión por rayo cámara→cabeza con presupuesto por frame (rotación) y TTL por actor:
  // los bocadillos dejan de flotar sobre paredes cerradas, cubos de escalera y árboles.
  // Los actores NO bloquean el rayo (sus mallas nacen isPickable=false: un vecino delante
  // de otro no le roba el bocadillo) y el vidrio (alpha bajo) tampoco.
  const occlusionTtlMs = 420;
  const rayBudgetPerFrame = 3;
  /** v1.30 — REPARTO JUSTO del presupuesto: antes los 3 rayos por frame se los llevaban
   *  SIEMPRE los primeros bocadillos del mapa y los últimos nacían con «sin ocluir» recién
   *  sellada (TTL fresco) — flotaban sobre paredes cerradas aunque su portador no se viera.
   *  Ahora el cursor ROTA por la lista: cada frame le toca comprobar a otro tercio y los
   *  que se quedan sin presupuesto CONSERVAN su decisión vigente (sin re-sellar el TTL). */
  let occlCursor = 0;
  // El constructor tipado de Ray resuelve a void en esta config (typeof import): el elenco
  // recupera la firma real — el rayo vive reutilizado (cero basura por frame).
  const RayC = B().Ray as unknown as new (origin: Vector3, dir: Vector3, length?: number) => Ray;
  const occlRay = new RayC(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 1);
  const occlusionBlocked = (head: { x: number; y: number; z: number }, now: number, b: BubbleView): boolean => {
    if (now - b.occludedAt < occlusionTtlMs) return b.occluded; // decisión en vigor
    if (occlRayCount >= rayBudgetPerFrame) return b.occluded; // sin presupuesto: sin re-sellar
    b.occludedAt = now;
    const cam = scene.activeCamera;
    if (!cam) {
      b.occluded = false;
      return false;
    }
    worldPt.set(head.x, head.y, head.z);
    toPt.copyFrom(worldPt).subtractInPlace(cam.position);
    const dist = toPt.length();
    if (dist < 0.6) {
      b.occluded = false; // demasiado cerca para ocluirse (la cámara está encima)
      return false;
    }
    occlRay.origin.copyFrom(cam.position);
    occlRay.direction.copyFrom(toPt).scaleInPlace(1 / dist);
    occlRay.length = dist;
    occlRayCount += 1;
    const hit = scene.pickWithRay(occlRay, (m) => {
      if (!m.isPickable || !m.isEnabled()) return false;
      const mat = m.material as { alpha?: number } | null;
      if (mat && mat.alpha !== undefined && mat.alpha < 0.42) return false; // vidrio/veladuras
      return true;
    });
    b.occluded = !!hit?.hit && hit.distance < dist - 0.3;
    return b.occluded;
  };
  let occlRayCount = 0;

  return {
    onEvent(e: GameEvent) {
      const now = performance.now() / 1000;
      const d = e.data as Record<string, unknown>;
      for (const rule of eventRules) {
        if (rule.on !== e.type) continue;
        let ids: string[] = [];
        if (rule.who === 'resident' && typeof d.resident === 'string') ids = [d.resident];
        else if (rule.who === 'player') ids = [localActorId];
        else if (rule.who === 'blockResidents' && typeof d.block === 'string')
          ids = Object.values(world.residents)
            .filter((r) => r.location === d.block && r.present)
            .map((r) => r.id);
        for (const id of ids) {
          if (!world.residents[id]) continue;
          if (rule.cooldown && rule.cooldown > 0) {
            const key = `${id}:${rule.on}`;
            const until = cooldown.get(key) ?? 0;
            if (until > now) continue;
            cooldown.set(key, now + rule.cooldown);
          }
          const glyph = rule.altGlyph && d[rule.altGlyph.when] ? rule.altGlyph.glyph : rule.glyph;
          const cur = transient.get(id);
          if (cur && cur.until > now && cur.priority > rule.priority) continue;
          transient.set(id, { emoteId: `event:${rule.on}`, glyph, priority: rule.priority, until: now + rule.seconds });
          dirty.add(id);
        }
      }
    },

    /** Texto puntual (v1.20): charlas de cruce y futuros teatros. Prioridad alta (95):
     *  gana a glifos de gesto/actividad pero respeta eventos mayores; expira sola. */
    sayText(id: string, text: string, seconds: number): void {
      if (!world.residents[id] || seconds <= 0) return;
      const now = performance.now() / 1000;
      const cur = transient.get(id);
      if (cur && cur.until > now && cur.priority > 95) return;
      transient.set(id, { emoteId: `sayx:${id}:${Math.round(now * 1000)}`, glyph: '', priority: 95, until: now + seconds, text });
      dirty.add(id);
    },

    update(dt, actorId) {
      localActorId = actorId;
      // 1.5) CICLO DE HABLA (v1.15): crea/renueva/avanza el turno de palabra de cada actor.
      // TODO sale del contenido: líneas de archetypes.activities.say, tiempos de emotes.speech.
      if (speechCfg) {
        for (const r of Object.values(world.residents)) {
          const cur = sayLinesOf(r);
          const st = speech.get(r.id);
          if (!cur) {
            if (st) {
              speech.delete(r.id);
              dirty.add(r.id); // el glifo vuelve en cuanto refresque
            }
            continue;
          }
          if (!st || st.activityId !== cur.activityId) {
            speech.set(r.id, { activityId: cur.activityId, lines: cur.lines, idx: 0, phase: 'say', t: speechCfg.lineSeconds });
            dirty.add(r.id);
          }
        }
        for (const [id, st] of speech) {
          if (!world.residents[id] || !sayLinesOf(world.residents[id]!)) continue;
          st.t -= dt;
          if (st.t > 0) continue;
          if (st.phase === 'say') {
            st.phase = 'gap';
            st.t = speechCfg.gapSeconds;
          } else if (st.phase === 'gap') {
            st.idx += 1;
            if (st.idx >= st.lines.length) {
              st.idx = 0;
              st.phase = 'cycle';
              st.t = speechCfg.cycleGap;
            } else {
              st.phase = 'say';
              st.t = speechCfg.lineSeconds;
            }
          } else {
            st.phase = 'say';
            st.t = speechCfg.lineSeconds;
          }
          dirty.add(id);
        }
      }
      // 1) Reevaluación a cadencia (amortigua parpadeos del sim) + eventos pendientes ya.
      decisionAcc += dt;
      const decisionS = cfg.bubble.decisionMs / 1000;
      const inBuilding = useGameStore.getState().camMode === 'edificio';
      if (decisionAcc >= decisionS || dirty.size > 0) {
        decisionAcc = 0;
        const pending = dirty.size > 0 ? [...dirty] : [];
        dirty.clear();
        for (const id of Object.keys(world.residents)) refresh(id);
        for (const id of pending) refresh(id);
      }
      // TOPE DE GLIFOS EN VISTA EDIFICIO (v1.17): el plano general muestra solo los N
      // bocadillos más relevantes — y con tope 0 (v1.18) NINGUNO: ni glifos, ni texto,
      // ni avisos de evento (la información importante sube al HUD, no al plano).
      // Se recalcula CADA FRAME en esa vista para que el cambio de cámara no deje
      // escapar ni un solo bocadillo durante la cadencia de decisión.
      if (buildingMaxGlyphs !== undefined && inBuilding) {
        const alive = [...bubbles.entries()]
          .filter(([, b]) => !b.hidden || b.key !== '')
          .map(([id, b]) => ({ id, priority: b.priority }))
          .sort((a, z) => z.priority - a.priority || (a.id < z.id ? -1 : 1));
        cappedIds = new Set(alive.slice(0, buildingMaxGlyphs).map((e) => e.id));
      } else {
        cappedIds = null;
      }

      // 2) Reposición cada frame: proyección 3D → píxeles del contenedor.
      const cam = scene.activeCamera;
      if (!cam) return;
      const rect = host.getBoundingClientRect();
      const renderW = engine.getRenderWidth();
      const renderH = engine.getRenderHeight();
      cam.getDirectionToRef(Vector3.Forward(false), camFwd);
      occlRayCount = 0;
      // v1.30 — reparto justo: el punto de partida ROTA cada frame (nadie se queda sin rayo).
      const bubbleList = [...bubbles.entries()];
      const rotated = bubbleList.length > 0
        ? [...bubbleList.slice(occlCursor % bubbleList.length), ...bubbleList.slice(0, occlCursor % bubbleList.length)]
        : bubbleList;
      occlCursor = bubbleList.length > 0 ? (occlCursor + 1) % bubbleList.length : 0;
      const nowMs = performance.now();
      for (const [id, b] of rotated) {
        const head = actors.headOf(id);
        const capped = cappedIds !== null && !cappedIds.has(id);
        if (!head || capped) {
          if (!b.hidden) {
            b.hidden = true;
            b.inner.style.opacity = '0';
          }
          continue;
        }
        worldPt.set(head.x, head.y + cfg.bubble.offsetY, head.z);
        toPt.copyFrom(worldPt).subtractInPlace(cam.position);
        // Detrás de la cámara o demasiado lejos: fuera (la proyección detrás da basura).
        if (Vector3.Dot(toPt, camFwd) <= 0.01 || toPt.length() > cfg.bubble.maxDistance) {
          if (!b.hidden) {
            b.hidden = true;
            b.inner.style.opacity = '0';
          }
          continue;
        }
        Vector3.ProjectToRef(worldPt, identity, scene.getTransformMatrix(), cam.viewport.toGlobal(renderW, renderH), projected);
        // v1.29 — FRUSTUM: si la proyección cae FUERA del encuadre (otra planta, lateral del
        // pasillo…), el personaje no está en pantalla y su bocadillo tampoco debe estarlo.
        const nx = projected.x / renderW;
        const ny = projected.y / renderH;
        if (nx < -0.04 || nx > 1.04 || ny < -0.06 || ny > 1.06) {
          if (!b.hidden) {
            b.hidden = true;
            b.inner.style.opacity = '0';
          }
          continue;
        }
        // v1.29 — OCLUSIÓN: pared cerrada/cubo/árbol delante del personaje → sin bocadillo.
        if (occlusionBlocked(head, nowMs, b)) {
          if (!b.hidden) {
            b.hidden = true;
            b.inner.style.opacity = '0';
          }
          continue;
        }
        // Escala del canvas (hardware scaling) → píxeles CSS reales del contenedor.
        const x = (projected.x / renderW) * rect.width;
        const y = (projected.y / renderH) * rect.height;
        b.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -105%)`;
        if (!b.placed) {
          // Primera proyección real: a partir de aquí puede mostrarse (nunca en (0,0)).
          b.placed = true;
          if (!b.hidden) b.inner.style.opacity = '1';
        } else if (b.hidden) {
          b.hidden = false;
          b.inner.style.opacity = '1';
          pop(b);
        }
      }
    },

    dispose() {
      layer.remove();
      bubbles.clear();
      transient.clear();
      cooldown.clear();
      speech.clear();
      dirty.clear();
    },
  };
}
