import type { Color3, DynamicTexture, Mesh, Scene, StandardMaterial, TransformNode } from '@babylonjs/core';
import type { Content, World } from '@/game/core/types';
import { hash01 } from '@/game/interior';
import { B } from './babylon';
import { playSoundAt } from './audio';
import { createPedFactory, type PedRig } from './pedestrians';
import type { ActorsDirector } from './actors';
import type { BubblesDirector } from './bubbles';

/**
 * LA CALLE VIVE (v1.22) — manifestaciones ocasionales con humor vecinal: antidesahucios,
 * reivindicaciones curiosas de trabajadores… 12-17 figuritas marchando despacio, la mitad
 * con carteles pintados (DynamicTexture con los lemas del catálogo) y el portavoz con
 * megáfono que lanza el grito. Los vecinos que las ven las COMENTAN en bocadillos según
 * su ánimo (street.json → reactions).
 *
 * Solo presentación: el sim jamás lee este catálogo; y solo se ve en la vista "edificio".
 */

interface Marcher {
  rig: PedRig;
  placard: TransformNode | null;
  /** Desfase propio dentro de la columna (metros, con jitter irregular v1.24). */
  slot: number;
  /** Desvío lateral propio dentro de la acera (v1.24: multitud irregular, sin fila exacta). */
  zOff: number;
  phase: number;
}

interface March {
  laneIndex: number;
  topicIndex: number;
  marchers: Marcher[];
  /** Cabeza de columna en metros (avanza con la marcha). */
  headX: number;
  dir: 1 | -1;
  speed: number;
  chantT: number;
  pending: { at: number; who: string; text: string }[];
  t: number;
}

export interface StreetlifeDirector {
  update(dt: number): void;
  setVisible(visible: boolean): void;
  /** Manifestaciones en marcha (QA/E2E). */
  activeCount(): number;
  /** Comentarios de vecinos pendientes por soltar (QA/E2E). */
  pendingComments(): number;
  /** Fuerza una manifestación YA (QA/E2E: no esperar la cadencia). */
  spawnNow(): boolean;
  dispose(): void;
}

export function createStreetlife(
  scene: Scene,
  world: World,
  content: Content,
  actors: ActorsDirector | null,
  bubbles: BubblesDirector | null,
): StreetlifeDirector {
  const { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, TransformNode } = B();
  const cfg = content.street;
  if (!cfg || !cfg.manifestation.enabled) {
    return { update() {}, setVisible() {}, activeCount: () => 0, pendingComments: () => 0, spawnNow: () => false, dispose() {} };
  }
  const man = cfg.manifestation;
  const root = new TransformNode('vida_calle', scene);
  let visible = true;
  const factory = createPedFactory(scene);
  const marches = new Set<March>();
  let nextMarch = man.firstMin + hash01('marcha_primera', world.tick) * Math.max(0.1, man.firstMax - man.firstMin);
  let roll = 0;
  const resCooldown = new Map<string, number>();

  // ── Materiales compartidos de la marcha. ──
  const stickMat = new StandardMaterial('marcha_palo', scene);
  stickMat.diffuseColor = Color3.FromHexString('#8a5a33');
  stickMat.specularColor = new Color3(0, 0, 0);
  const megaMat = new StandardMaterial('marcha_megafono', scene);
  megaMat.diffuseColor = Color3.FromHexString(man.megaphoneColor);
  megaMat.specularColor = new Color3(0, 0, 0);
  megaMat.emissiveColor = Color3.FromHexString(man.megaphoneColor).scale(0.12);

  /** Carteles: textura con lema (cacheada por texto — las marchas repiten lemas). */
  const placardTex = new Map<string, DynamicTexture>();
  const texOf = (text: string): DynamicTexture => {
    let tex = placardTex.get(text);
    if (tex) return tex;
    tex = new DynamicTexture(`cartel_${placardTex.size}`, { width: 512, height: 320 }, scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = man.placard.bg;
    ctx.fillRect(0, 0, 512, 320);
    ctx.strokeStyle = man.placard.accent;
    ctx.lineWidth = 18;
    ctx.strokeRect(9, 9, 494, 302);
    // El lema partido en líneas que quepan (máx. 3 líneas, mayúsculas de protesta).
    const words = text.toUpperCase().split(' ');
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const probe = line ? `${line} ${w}` : w;
      if (probe.length > 12 && line) {
        lines.push(line);
        line = w;
      } else line = probe;
    }
    if (line) lines.push(line);
    const shown = lines.slice(0, 3);
    const fs = Math.min(man.placard.fontSizePx, Math.floor(240 / Math.max(1, shown.length)));
    ctx.fillStyle = man.placard.ink;
    ctx.font = `bold ${fs}px 'Segoe UI', system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    shown.forEach((ln, i) => ctx.fillText(ln, 256, 160 + (i - (shown.length - 1) / 2) * (fs + 12)));
    // update(true): el patrón verificado del código base (los carteles de vivienda) — con
    // `false` el texto sale volteado verticalmente (invertY del upload de texturas).
    tex.update(true);
    placardTex.set(text, tex);
    return tex;
  };

  const spawnMarch = (): void => {
    const people = man.minPeople + Math.floor(hash01('marcha_gente', roll) * (man.maxPeople - man.minPeople + 1));
    const laneIndex = Math.floor(hash01('marcha_carril', roll) * man.lanes.length) % man.lanes.length;
    const lane = man.lanes[laneIndex]!;
    const topicIndex = Math.floor(hash01('marcha_tema', roll) * cfg.topics.length) % cfg.topics.length;
    const topic = cfg.topics[topicIndex]!;
    const dir: 1 | -1 = lane.x1 > lane.x0 ? 1 : -1;
    const headX = dir > 0 ? lane.x0 - people * man.spacing : lane.x0 + people * man.spacing;
    const marchers: Marcher[] = [];
    for (let i = 0; i < people; i++) {
      const hex = man.colors[Math.floor(hash01('marcha_color', roll + i) * man.colors.length) % man.colors.length]!;
      const rig = factory.make(hex, i === 0 ? man.megaphoneColor : hash01('marcha_gorro', roll + i) < 0.3 ? '#3b3129' : null);
      rig.root.parent = root;
      // v1.26: la figurita MIRA hacia donde marcha (piernas en el eje del paso, no cruzadas).
      rig.root.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      let placard: TransformNode | null = null;
      if (i > 0 && i % man.placard.carryEvery === 0) {
        // Cartel: palo + panel con lema (rotado para que la cámara lo lea de frente).
        // v1.24: en ALTO (liftY del catálogo por encima de las cabezas) y con los BRAZOS
        // ESTIRADOS hacia arriba agarrando el palo — el lema se lee desde la cámara.
        placard = new TransformNode('cartel', scene);
        placard.parent = rig.root;
        // v1.26: el cuerpo gira a la dirección de marcha — el cartel CONTRARROTA para que
        // la cámara siga leyendo el lema de frente.
        placard.rotation.y = -rig.root.rotation.y;
        const stick = MeshBuilder.CreateBox('cartel_palo', { width: 0.05, height: man.placard.stickH, depth: 0.05 }, scene);
        stick.position.y = man.placard.liftY - man.placard.stickH / 2;
        stick.material = stickMat;
        stick.parent = placard;
        const panel = MeshBuilder.CreatePlane('cartel_panel', { width: man.placard.w, height: man.placard.h, sideOrientation: Mesh.DOUBLESIDE }, scene);
        const text = topic.placards[Math.floor(i / man.placard.carryEvery - 1) % topic.placards.length]!;
        const mat = new StandardMaterial(`cartel_mat_${i}`, scene);
        mat.diffuseTexture = texOf(text);
        mat.emissiveTexture = texOf(text);
        mat.specularColor = new Color3(0, 0, 0);
        mat.disableLighting = true;
        mat.backFaceCulling = false;
        panel.material = mat;
        panel.position.y = man.placard.liftY;
        panel.parent = placard;
        rig.carrying = true;
      }
      if (i === 0) {
        // Portavoz: megáfono cónico apuntando al frente de la marcha (brazos en alto).
        const mega = MeshBuilder.CreateCylinder('megafono', { diameterTop: 0.05, diameterBottom: 0.19, height: 0.34, tessellation: 10 }, scene);
        mega.rotation.z = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
        mega.position.set(dir * 0.26, 1.62, 0.14);
        mega.material = megaMat;
        mega.parent = rig.root;
        rig.carrying = true;
      }
      // v1.24: MULTITUD IRREGULAR — desfase longitudinal con jitter y banda lateral propia;
      // la columna deja de ser una fila exacta (dos manos de gente que avanza a la par).
      const slot = i * man.spacing + (hash01('marcha_jit', roll + i) - 0.5) * man.slotJitter;
      const zOff = (hash01('marcha_z', roll + i) - 0.5) * man.spreadZ;
      marchers.push({ rig, placard, slot, zOff, phase: hash01('marcha_fase', roll + i) * 6 });
    }
    // Comentarios de vecinos: agendados con retardo (ven la marcha y la comentan según ánimo).
    const pending: { at: number; who: string; text: string }[] = [];
    if (actors && bubbles) {
      const now = 0;
      const candidates = Object.values(world.residents).filter((r) => {
        if (!r.present || !r.location || r.id === world.playerId) return false;
        if (actors.isRiding(r.id) || actors.isDirected(r.id) || actors.gestureOf(r.id)) return false;
        return actors.nodeOf(r.id) !== null;
      });
      const maxComments = Math.min(man.maxComments, candidates.length);
      for (let k = 0; k < maxComments; k++) {
        const who = candidates.splice(Math.floor(hash01('marcha_comenta', roll + k) * candidates.length), 1)[0];
        if (!who) break;
        if ((resCooldown.get(who.id) ?? 0) > 0) continue;
        resCooldown.set(who.id, 300);
        const bucket = bucketOf(who.id);
        const lines = cfg.reactions[bucket];
        const text = lines[Math.floor(hash01('marcha_linea', roll + k) * lines.length) % lines.length]!;
        pending.push({ at: now + man.commentDelayMin + hash01('marcha_retraso', roll + k) * (man.commentDelayMax - man.commentDelayMin), who: who.id, text });
      }
    }
    marches.add({ laneIndex, topicIndex, marchers, headX, dir, speed: man.speed, chantT: 1.2, pending, t: man.minDuration + hash01('marcha_dura', roll) * (man.maxDuration - man.minDuration) });
    playSoundAt('voz_megafono', 0.55);
  };

  /** Ánimo del vecino (misma media ponderada que las charlas de cruce) o tiro a ciegas. */
  const bucketOf = (id: string): 'good' | 'ok' | 'bad' => {
    const cm = content.crossings?.mood;
    const r = world.residents[id];
    if (!cm || !r) return (['good', 'ok', 'bad'] as const)[Math.floor(hash01('animo_calle', world.tick + id.length) * 3)]!;
    let sum = 0;
    let total = 0;
    for (const [k, w] of Object.entries(cm.needs)) {
      const value = r.needs[k];
      if (typeof value === 'number') {
        sum += value * w;
        total += w;
      }
    }
    const m = total > 0 ? sum / total : 50;
    return m >= cm.goodMin ? 'good' : m >= cm.okMin ? 'ok' : 'bad';
  };

  return {
    update(dt: number) {
      for (const cd of resCooldown.keys()) {
        const v = (resCooldown.get(cd) ?? 0) - dt;
        if (v <= 0) resCooldown.delete(cd);
        else resCooldown.set(cd, v);
      }
      nextMarch -= dt;
      if (nextMarch <= 0 && visible) {
        nextMarch = man.everyMin + hash01('marcha_t', world.tick + roll) * (man.everyMax - man.everyMin);
        if (marches.size < 1) spawnMarch();
      }
      for (const m of [...marches]) {
        const lane = man.lanes[m.laneIndex]!;
        const endX = lane.x1;
        // Cabeza de columna: avanza mientras dure; al agotarse, la columna sigue hasta salir.
        const marching = m.t > 0;
        if (marching) m.t -= dt;
        m.headX += m.dir * m.speed * dt;
        for (const marcher of m.marchers) {
          const x = m.headX - m.dir * marcher.slot;
          marcher.phase += dt * m.speed * 4.6;
          marcher.rig.phase = marcher.phase;
          factory.pose(marcher.rig, 1);
          marcher.rig.root.position.x = x;
          marcher.rig.root.position.z = lane.z + marcher.zOff;
          if (marcher.placard) marcher.placard.rotation.z = Math.sin(marcher.phase * 0.5) * 0.06;
        }
        // Grito del portavoz (megáfono) mientras la marcha avanza.
        if (marching) {
          m.chantT -= dt;
          if (m.chantT <= 0) {
            m.chantT = man.chantEveryMin + hash01('marcha_grito', roll++) * (man.chantEveryMax - man.chantEveryMin);
            playSoundAt('voz_megafono', 0.5);
          }
        }
        // Comentarios pendientes de vecinos (cuando les toca, bocadillo).
        for (const p of [...m.pending]) {
          p.at -= dt;
          if (p.at <= 0) {
            m.pending.splice(m.pending.indexOf(p), 1);
            if (world.residents[p.who] && actors && bubbles && !actors.isRiding(p.who) && !actors.isDirected(p.who)) {
              bubbles.sayText(p.who, p.text, 4.5);
              actors.setGesture(p.who, 'talk', 3);
            }
          }
        }
        // La cola ha salido del carril → fin de la marcha y limpieza.
        const tailX = m.headX - m.dir * (m.marchers.length - 1) * man.spacing;
        if ((m.dir > 0 && tailX > endX) || (m.dir < 0 && tailX < endX)) {
          for (const marcher of m.marchers) {
            marcher.rig.root.dispose(false, true);
          }
          marches.delete(m);
        }
      }
    },
    setVisible(v: boolean) {
      if (visible === v) return;
      visible = v;
      root.setEnabled(v);
    },
    activeCount: () => marches.size,
    pendingComments: () => [...marches].reduce((s, m) => s + m.pending.length, 0),
    spawnNow: () => {
      if (marches.size >= 1) return false;
      spawnMarch();
      return true;
    },
    dispose() {
      for (const m of marches) for (const marcher of m.marchers) marcher.rig.root.dispose(false, true);
      marches.clear();
      root.dispose(false, false);
      for (const t of placardTex.values()) t.dispose();
      placardTex.clear();
      stickMat.dispose();
      megaMat.dispose();
      factory.dispose();
    },
  };
}
