'use client';

/**
 * Reproductor de cutscenes (Fase D): teatro de presentación 100% data-driven.
 * Los beats viven en /content/cutscenes.json; esta clase solo los EJECUTA:
 *  - cam   → encuadre cinematográfico (la cámara vuela con su suavizado de siempre);
 *  - walk  → actor dirigido (actors.director): staging + ruta por pozo/interiores;
 *  - line  → subtítulo con marcadores {resident} y {block};
 *  - wait  → pausa teatral;
 *  - sound → clave del catálogo procedural (sounds.json).
 * Cero lógica de juego: el mundo no cambia durante (ni por) una cutscene. Si una
 * referencia no se resuelve (actor ausente, bloque desconocido), el beat se salta:
 * el espectáculo nunca rompe la partida.
 */

import type { AbstractEngine } from '@babylonjs/core';
import type { Content, CutsceneBeat, CutsceneDef, CutsceneSpot, PlayerPosition, World } from '@/game/core/types';
import { blockLabel } from '@/game/core/types';
import { playSound } from './audio';
import type { CameraRig } from './camera';
import type { ActorsDirector } from './actors';
import { resolveTokens } from '@/game/support/texts';
import { useGameStore } from './store';

/** Contexto del evento que disparó la cutscene: alimenta $event.* y los roles de misión. */
export interface CutsceneEventCtx {
  mission: string | null;
  resident: string | null;
  block: string | null;
}

/** Escenario inyectado por el controller: lo mínimo que una cutscene puede tocar. */
export interface CutsceneStage {
  engine: AbstractEngine;
  rig: CameraRig;
  actors: ActorsDirector;
  world: World;
  /** Posición viva del jugador (para el encuadre 'player' en el momento del beat). */
  playerPos: () => PlayerPosition;
}

interface WalkState {
  id: string;
}

export class CutscenePlayer {
  private def: CutsceneDef | null = null;
  private ctx: CutsceneEventCtx = { mission: null, resident: null, block: null };
  private stage: CutsceneStage | null = null;
  private i = 0;
  private t = 0;
  private walk: WalkState | null = null;
  private involved: string[] = [];
  /** Actor al que la línea actual le puso un gesto: se suelta al entrar el siguiente beat. */
  private spoken: string | null = null;

  constructor(private readonly content: Content) {}

  get active(): boolean {
    return this.def !== null;
  }

  /** Empieza una cutscene (el controller garantiza que no hay otra en curso). */
  start(def: CutsceneDef, ctx: CutsceneEventCtx, stage: CutsceneStage): void {
    this.def = def;
    this.ctx = ctx;
    this.stage = stage;
    this.i = 0;
    this.t = 0;
    this.walk = null;
    this.involved = [];
    this.spoken = null;
    useGameStore.getState().setCutscene({ id: def.id, speaker: null, text: null });
    // V1.9 FIX "cinemática invisible con cámara de estancia": si el primer beat no es de cámara,
    // la cámara puede quedarse DENTRO de la estancia mirando la pared mientras el teatro ocurre
    // en otro sitio (mundo congelado = sensación de bloqueo). Se siembra YA un encuadre visible
    // (bloque del evento → jugador → edificio); el primer beat 'cam' lo sustituye si quiere.
    if (def.beats[0]?.type !== 'cam') {
      const seed = this.fallbackFrame();
      if (seed) stage.rig.cinematic = seed;
    }
    this.enter(0);
  }

  /** Salta todo (tecla E/Espacio/Escape o botón): suelta actores y cámara; el mundo queda igual. */
  abort(): void {
    if (this.def) this.finish();
  }

  /** Avanza los beats. dt en segundos; se llama cada frame (el sim está congelado mientras tanto). */
  update(dt: number): void {
    if (!this.def || !this.stage) return;
    const beat = this.def.beats[this.i];
    if (!beat) return this.finish();
    this.t += dt;
    const cs = this.content.rules.cutscene;
    switch (beat.type) {
      case 'cam':
        if (this.t >= (beat.hold ?? cs.hold)) this.next();
        break;
      case 'wait':
        if (this.t >= beat.seconds) this.next();
        break;
      case 'line':
        if (this.t >= (beat.seconds ?? cs.line)) {
          this.hideLine();
          this.next();
        }
        break;
      case 'walk':
        // Ruta imposible (actor no resoluble): el beat no llegó a engancharse → siguiente.
        if (!this.walk) {
          this.next();
          break;
        }
        // V1.9: refresco del travelling cada frame mientras el actor avanza (pozo/escalera incluidos).
        this.trackWalker(this.def.beats[this.i] as Extract<CutsceneBeat, { type: 'walk' }>);
        if (this.stage.actors.idle(this.walk.id) || this.t >= (beat.max ?? cs.walkMax)) this.next();
        break;
      case 'sound':
        this.next(); // el sonido ya se lanzó al entrar en el beat
        break;
    }
  }

  // ───────────────────────── Internos ─────────────────────────

  private next(): void {
    this.enter(this.i + 1);
  }

  /** Entra en el beat i (resuelve referencias, lanza lo instantáneo). Cadena acotada: pocos beats. */
  private enter(i: number): void {
    this.i = i;
    this.t = 0;
    this.walk = null;
    if (this.spoken) {
      this.stage?.actors.setGesture(this.spoken, null);
      this.spoken = null;
    }
    if (!this.def || !this.stage) return;
    const beat = this.def.beats[i];
    if (!beat) return this.finish();
    switch (beat.type) {
      case 'cam': {
        const frame = this.resolveCam(beat) ?? this.fallbackFrame();
        // V1.9: fallback garantizado — un encuadre que no se resuelve ($event.block ausente en el
        // evento, bloque desconocido…) ya NO deja la cámara huérfana en el modo anterior (p. ej.
        // 'estancia', dentro de una vivienda): el espectáculo siempre tiene plano.
        if (frame) this.stage.rig.cinematic = frame;
        this.hideLine();
        break;
      }
      case 'walk': {
        const id = this.resolveWalk(beat);
        if (!id) {
          this.next(); // sin actor resoluble: no bloquea el espectáculo
        } else {
          this.walk = { id };
          if (!this.involved.includes(id)) this.involved.push(id);
          this.hideLine();
          // V1.9 TRAVELLING: el plano sigue al actor desde el primer frame (la ruta puede recorrer
          // medio edificio; antes la cámara se quedaba clavada en el último encuadre y el paseo
          // entero ocurría FUERA de cuadro: plano vacío + mundo parado = sensación de bloqueo).
          this.trackWalker(beat);
        }
        break;
      }
      case 'line': {
        const speaker = beat.speaker ? this.template(beat.speaker) : null;
        useGameStore.getState().setCutscene({ id: this.def.id, speaker, text: this.template(beat.text) });
        // El actor que habla gesticula mientras dura la línea (v1.2): who + gesture son
        // opcionales y data-driven; sin who, la línea es solo subtítulo (como siempre).
        if (beat.who) {
          const id = this.resolveWho(beat.who);
          if (id) {
            this.spoken = id;
            this.stage.actors.setGesture(id, beat.gesture ?? 'talk', (beat.seconds ?? this.content.rules.cutscene.line) + 0.4);
          }
        }
        break;
      }
      case 'sound':
        playSound(beat.id);
        this.next();
        break;
      case 'wait':
        this.hideLine();
        break;
    }
  }

  private hideLine(): void {
    if (!this.def) return;
    const s = useGameStore.getState().cutscene;
    if (s && (s.speaker !== null || s.text !== null)) {
      useGameStore.getState().setCutscene({ id: this.def.id, speaker: null, text: null });
    }
  }

  /** Fin normal o por salto: los actores vuelven a la IA y la cámara al modo del jugador. */
  private finish(): void {
    for (const id of this.involved) this.stage?.actors.release(id);
    this.involved = [];
    if (this.spoken) {
      this.stage?.actors.setGesture(this.spoken, null);
      this.spoken = null;
    }
    if (this.stage) this.stage.rig.cinematic = null;
    this.def = null;
    this.stage = null;
    this.i = 0;
    this.t = 0;
    this.walk = null;
    useGameStore.getState().setCutscene(null);
  }

  // ── Resolución de referencias (todas indulgentes: null = beat saltado) ──

  /**
   * V1.9: encuadre de emergencia para que el espectáculo SIEMPRE tenga plano visible.
   * Prioridad data-driven: bloque del evento → jugador → edificio entero. Nunca null salvo
   * que no haya escenario (imposible en partida viva).
   */
  private fallbackFrame(): { cx: number; cy: number; cz: number; viewH: number } | null {
    if (!this.stage) return null;
    const viewH = this.content.rules.cutscene.focusViewH;
    if (this.ctx.block) {
      const b = this.stage.world.blocks[this.ctx.block];
      if (b) return this.stage.rig.blockFrame(b.cell.col, b.size.w, b.cell.floor, viewH);
    }
    return this.stage.rig.playerFrame(this.stage.playerPos(), viewH);
  }

  /** V1.9 travelling: el encuadre persigue al actor del beat walk mientras camina. */
  private trackWalker(beat: Extract<CutsceneBeat, { type: 'walk' }>): void {
    if (!this.stage || !this.walk) return;
    const node = this.stage.actors.nodeOf(this.walk.id);
    if (!node) return;
    const viewH = beat.viewH ?? this.content.rules.cutscene.walkViewH;
    this.stage.rig.cinematic = this.stage.rig.actorFrame(node.x, node.y, viewH);
  }

  private resolveCam(beat: Extract<CutsceneBeat, { type: 'cam' }>): { cx: number; cy: number; cz: number; viewH: number } | null {
    if (!this.stage) return null;
    const viewH = beat.viewH ?? this.content.rules.cutscene.focusViewH;
    if (beat.focus === 'wide') return this.stage.rig.wideFrame();
    if (beat.focus === 'player') return this.stage.rig.playerFrame(this.stage.playerPos(), viewH);
    const b = this.resolveBlock(beat.focus.block);
    return b ? this.stage.rig.blockFrame(b.cell.col, b.size.w, b.cell.floor, viewH) : null;
  }

  /** Resuelve el actor del beat, lo toma, aplica staging y le marca la ruta. Devuelve su id o null. */
  private resolveWalk(beat: Extract<CutsceneBeat, { type: 'walk' }>): string | null {
    if (!this.stage) return null;
    const id = this.resolveWho(beat.who);
    if (!id) return null;
    const r = this.stage.world.residents[id];
    if (!r || !r.present || r.location === null) return null;
    if (!this.stage.actors.take(id)) return null;
    if (beat.from) {
      const from = this.resolvePoint(beat.from);
      if (from) this.stage.actors.stageAt(id, from.x, from.floor, from.z);
    }
    const to = this.resolvePoint(beat.to);
    if (!to) return null;
    this.stage.actors.walkTo(id, to);
    return id;
  }

  /** ids literales, $event.resident o $role.<nombre> (roles de la misión disparadora). */
  private resolveWho(who: string): string | null {
    if (!this.stage) return null;
    if (who === '$event.resident') return this.ctx.resident;
    if (who.startsWith('$role.')) {
      const roleName = who.slice('$role.'.length);
      const m = this.ctx.mission ? this.stage.world.missions.find((x) => x.id === this.ctx.mission) : undefined;
      return m?.roles[roleName] ?? null;
    }
    return this.stage.world.residents[who] ? who : null;
  }

  /** $home, $entry, $event.block o id literal del bloque. */
  private resolveBlock(ref: string) {
    if (!this.stage) return null;
    const world = this.stage.world;
    const id = ref === '$home' ? world.residents[world.playerId]?.home ?? null : ref === '$entry' ? world.entry : ref === '$event.block' ? this.ctx.block : ref;
    return id ? world.blocks[id] ?? null : null;
  }

  /** Punto de escenario en coordenadas del mundo (door = pasillo delante; center = dentro). */
  private resolvePoint(spot: CutsceneSpot): { x: number; z: number; floor: number; inside?: { block: string; local: { x: number; z: number } } } | null {
    const b = this.resolveBlock(spot.block);
    if (!b) return null;
    const v = this.content.rules.view;
    const frontZ = v.roomZ - v.commonDepth / 2;
    const cx = (b.cell.col + b.size.w / 2) * v.cellW;
    if (spot.at === 'door') return { x: cx, z: v.corridorZ, floor: b.cell.floor };
    const depth = b.kind === 'dwelling' ? v.depth : v.commonDepth;
    return {
      x: cx,
      z: frontZ + depth / 2,
      floor: b.cell.floor,
      inside: b.kind === 'dwelling' ? { block: b.id, local: { x: b.size.w * v.cellW / 2, z: depth / 2 } } : undefined,
    };
  }

  /** Marcadores del catálogo: {resident} → nombre visible, {block} → etiqueta del bloque.
   *  v1.34 — además TODOS los tokens data-driven del catálogo ({viviendaDe:id}, {home},
   *  {plantas}…): los rótulos de hablante («Ex presidente · {viviendaDe:res_presidente_01}»)
   *  muestran la vivienda REAL del vecino aunque el edificio cambie de plantas o letras. */
  private template(text: string): string {
    if (!this.stage) return text;
    const rid = this.ctx.resident;
    const r = rid ? this.stage.world.residents[rid] : undefined;
    const name = r ? this.content.archetypes[r.archetype]?.name ?? r.id : '';
    const bl = this.ctx.block ? blockLabel(this.ctx.block) : '';
    const expanded = text.replaceAll('{resident}', name).replaceAll('{block}', bl);
    const home = this.stage.world.residents[this.stage.world.playerId]?.home;
    return resolveTokens(expanded, this.stage.world, this.content, { home });
  }
}
