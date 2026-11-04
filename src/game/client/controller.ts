'use client';

import type { AbstractEngine, DirectionalLight, Scene } from '@babylonjs/core';
import type { AchievementDef, Command, Content, CutsceneDef, GameEvent, Input, MinigameDef, ScenarioDef, World } from '@/game/core/types';
import type { CommandResult } from '@/game/sim';
import { blockLabel } from '@/game/core/types';
import { loadContent } from '@/game/content';
import { layoutGeometryOf, roomAt } from '@/game/interior';
import { evaluateAchievements, type AchievementSnapshot } from '@/game/support/achievements';
import { syncCampaign } from '@/game/support/campaign';
import { resolveTokens, applyStaticTokens } from '@/game/support/texts';
import { evaluateProject, projectSnapshot } from '@/game/support/project';
import { applyContentLanguage, applyContentLanguageAsync, preloadTranslations } from '@/game/support/i18n-content';
import { activeObjective, applyEffects, buildCirculation, createWorld, dispatch, drainEvents, migrateRooms, tick, travelMinutes, visibleParams } from '@/game/sim';
import { PlayerLogic } from '@/game/player-logic';
import { createEngine } from './engine';
import { createBuilding } from './building';
import { createActors } from './actors';
import { createElevators, type ElevatorsDirector } from './elevator';
import { createBubbles, type BubblesDirector } from './bubbles';
import { createEcosystem, type EcosystemDirector } from './ecosystem';
import { createBackdrop, type BackdropDirector } from './backdrop';
import { createExterior, type ExteriorDirector } from './exterior';
import { createChats, type ChatsDirector } from './chats';
import { createTraffic, type TrafficDirector } from './traffic';
import { createShadows, type ShadowsDirector } from './shadows';
import { createAmbulanceTheater, type AmbulanceTheater } from './ambulance';
import { createPedestrians, type PedestriansDirector } from './pedestrians';
import { createStreetlife, type StreetlifeDirector } from './streetlife';
import { createPaseo, type PaseoDirector } from './paseo';
import { createVoices, type VoicesDirector } from './voices';
import { createMusicDirector, type MusicDirector } from './music';
import { createResidents, greetLineOf, residentsUiSnapshot, residentName, type ResidentsDirector } from './residents';
import { createTutorial, createNullTutorial, setCurrentTutorial, type TutorialDirector } from './tutorial';
import { CameraRig, type CamMode } from './camera';
import { CutscenePlayer, type CutsceneEventCtx } from './cutscene';
import { B } from './babylon';
import { eventSound, playSound, preloadSounds } from './audio';
import { translate } from './i18n';
import { QUALITY_SCALE, loadOptions, type PerfTarget, type QualityLevel } from './options';
import { PerfDirector } from './perf';
import { startGamepadPolling } from './gamepad';
import { loadUnlocked, saveUnlocked } from './achievements-store';
import { NetSession, type SessionStatePayload } from './net';
import { VoiceChannel } from './voice';
import { setController } from './bridge';
import { selectModalOpen, selectWorldFrozen, setInfoDockTuning, setPhoneFreeMovement, useGameStore, clearMpPersist, readMpPersist, type AchievementUi, type Speed, type Tone } from './store';
import { STATIC_EXPORT } from '@/game/support/paths';

/**
 * v1.77 — export estático (GitHub Pages): sin servidor, la partida vive en localStorage
 * del navegador con la misma forma JSON que /api/save ({state}). Una sola clave: el slot
 * único 'auto' es el que existe.
 */
const SAVE_LOCAL_KEY = 'vecinos.save.static.auto';

// v1.65 — CÁMARAS 1..5 reordenadas de CERCA a LEJOS + ESPÍA (petición del vecino):
// 1 Estancia · 2 Planta · 3 Edificio · 4 Fachada · 5 Espía (otra vez 5: siguiente vecino).
const CAM_BY_KEY: Record<string, CamMode> = { Digit1: 'estancia', Digit2: 'planta', Digit3: 'edificio', Digit4: 'fachada', Digit5: 'espia' };

/** v1.64 — teclas de MOVIMIENTO: únicas que valen con la llamada de teléfono en pantalla
 *  (rules.sim.phone.freeMovement): el vecino sigue andando —y puede entrar— mientras «suena
 *  el timbre» del móvil. E/J y cámaras siguen bloqueadas: el diálogo consume el foco. */
const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

/**
 * Único dueño del mundo en el navegador: engine Babylon, PlayerLogic, bucle de render,
 * reparto de eventos hacia el store de React y órdenes de la interfaz hacia el sim.
 * El sim no sabe que existe Babylon ni React; aquí es donde se tocan.
 * Tampoco contiene datos: TODO (contenido, balance, etiquetas, greybox) viene de /content/.
 */
class GameController {
  private canvas: HTMLCanvasElement | null = null;
  private engine: AbstractEngine | null = null;
  private scene: Scene | null = null;
  private _content: Content | null = null;
  private world: World | null = null;
  private logic: PlayerLogic | null = null;
  private building: ReturnType<typeof createBuilding> | null = null;
  private actors: ReturnType<typeof createActors> | null = null;
  private elevators: ElevatorsDirector | null = null;
  private bubbles: BubblesDirector | null = null;
  private ecosystem: EcosystemDirector | null = null;
  private rig: CameraRig | null = null;
  /** v1.47 — CÁMARA PREVIA (petición del vecino): al entrar en un local/vivienda/portal se
   *  recuerda la cámara que había y al salir SE RESTAURA — salir de la sala de juntas con la
   *  cámara de planta activa ya no te cambia a otra. Si el usuario cambia de cámara DENTRO,
   *  manda su elección (no se restaura nada). */
  private camReturn: CamMode | null = null;
  /** v1.65 — CÁMARA ESPÍA: vecino seguido en el modo 'espia' (null = fuera del modo).
   *  Su posición viva viaja a rig.spyTarget cada fotograma (nodeOf) para el seguimiento. */
  private spyResidentId: string | null = null;
  /** Fondo urbano + calle (v1.20): cielo dinámico, parallax y decorado exterior. */
  private backdrop: BackdropDirector | null = null;
  private exterior: ExteriorDirector | null = null;
  /** Charlas de cruce (v1.20): vecinos que se cruzan y comentan la vida. */
  private chats: ChatsDirector | null = null;
  /** La calle vive (v1.22): tráfico, viandantes, manifestaciones y voces de proximidad. */
  private traffic: TrafficDirector | null = null;
  private shadows: ShadowsDirector | null = null;
  private ambulance: AmbulanceTheater | null = null;
  private pedestrians: PedestriansDirector | null = null;
  private streetlife: StreetlifeDirector | null = null;
  /** v1.37 — PASEO VECINAL: vecinos que salen, cruzan por el paso mirando ambos lados y
   *  van al parque de calistenia del jardín de enfrente (solo presentación). */
  private paseo: PaseoDirector | null = null;
  private voices: VoicesDirector | null = null;
  /** v1.39 — MÚSICA PROCEDURAL: banda sonora generativa por franja horaria + lluvia. */
  private music: MusicDirector | null = null;
  /** v1.39 — ONBOARDING «primer día»: tutorial guiado no bloqueante. */
  private tutorial: TutorialDirector = createNullTutorial();
  /** v1.39 — VECINOS COMO PERSONAJES: comentarios ambientales con carácter. */
  private residents: ResidentsDirector | null = null;
  /** v1.39 — nivel del proyecto del edificio ya anunciado (para celebrar subidas). */
  private projectLevelSeen = 0;
  /** v1.39 — posición previa del jugador (para el paso «muévete» del tutorial). */
  private lastMovePos: { x: number; z: number } | null = null;
  /** v1.42 — último fundido aplicado al cuerpo del jugador (evita setFade por frame). */
  private lastPlayerFade = 1;
  /** Bloom/glow de las luces (v1.28): halo realista sobre materiales emisivos (catálogo). */
  private glowLayer: { dispose(): void } | null = null;
  /** v1.40 — LINTERNA: PointLight que llevas encima cuando se va la luz (apagón).
   *  Radio corto del catálogo (view.flashlight.range): es una linterna, no un estadio. */
  private flashlight: { light: unknown; update: (pos: { x: number; y: number; z: number }) => void; dispose: () => void } | null = null;
  /** Cuenta atrás del refresco de sombras (v1.32): cazamallas nuevas cada 2 s. */
  private shadowRefreshT = 2;
  /** v1.48 — flecha del LATERAL: instante (s) hasta el que se enseña el aviso. */
  private sideHintUntil = 0;
  /** v1.48 — último toast de entrada frontal cerrada (cadencia, no spamea). */
  private lastFrontToastAt = -999;
  /** v1.48 — cuenta atrás de la próxima broma vecinal con el apagón activo. */
  private blackoutJokeT = 6;
  // ── v1.38 — PASE DE OPTIMIZACIÓN: auto-ajuste de rendimiento ──
  /** Director que mide FPS y sube/baja la escalera de optimización (solo presentación). */
  private perf: PerfDirector | null = null;
  /** Sol del catálogo: el optimizador puede desmontar/remontar su generador de sombras. */
  private sunLight: DirectionalLight | null = null;
  /** Cadencia de sombras acordada con el optimizador (1 = cada fotograma). */
  private desiredShadowEvery = 1;
  /** El optimizador pidió sombras OFF (peldaños profundos): generador desmontado. */
  private shadowsOff = false;
  /** Noche/cielo muy cerrado: mapa de profundidad congelado (el sol de la escena no gira). */
  private shadowsFrozen = false;

  private get content(): Content {
    if (!this._content) throw new Error('El catálogo de contenido todavía no se ha cargado');
    return this._content;
  }

  private keys = new Set<string>();
  /** Direcciones mantenidas por los mandos virtuales (se combinan con el teclado). */
  private touch: Input = { left: false, right: false, up: false, down: false, run: false };
  /** Overrides de minijuegos del escenario activo (QA/E2E). */
  private scenarioOverrides: NonNullable<ScenarioDef['minigameOverrides']> = {};
  private clockAcc = 0;
  private lastHudSync = 0;
  private initializing = false;
  /** Cronómetro del "paso adentro" del jugador tras abrirse la puerta de la cabina. */
  private playerBoardT = 0;
  // ── Logros tipo Steam (v1.17): perfil del navegador + cadencia de evaluación ──
  private unlockedAchievements = new Set<string>(loadUnlocked());
  private achAcc = 0;
  /** Tick de la última junta convocada desde el tablón (cooldown del catálogo). */
  private lastConvocaTick = -Infinity;

  private phoneMission = '';
  private phoneLines: { speaker: string; text: string }[] = [];
  private phoneLine = 0;
  /** Cola FIFO de llamadas pendientes: con varias misiones activándose a la vez, ninguna llamada se pisa. */
  private phoneQueue: { mission: string; dialogId: string }[] = [];

  // ── Cutscenes (Fase D): teatro data-driven sobre eventos del sim. ──
  private cutscenePlayer: CutscenePlayer | null = null;
  private cutsceneQueue: { def: CutsceneDef; ctx: CutsceneEventCtx }[] = [];

  // ── Multijugador (protocolo v1): el servidor autoritativo posee el mundo; este cliente lo refleja ──
  private net: NetSession | null = null;
  // ── v1.64 — gracia antirrebote del timbre (última puerta llamada y cuándo) ──
  private lastRing = { block: '', at: -99 };
  // ── v1.57 — poses remotas (residentId → última pose de red) y cadencia de envío propio ──
  private remotePoses = new Map<string, { x: number; z: number; floor: number; at: number }>();
  private lastPoseSentAt = 0;
  private myResidentId: string | null = null;
  private isHost = false;
  private appliedSeq = 0;
  /** v1.55 — instante en que se abrió el minijuego en curso (cronómetro del duelo). */
  private minigameStartedAt = 0;
  /** v1.56 — canal de voz del vecindario (WebRTC P2P sobre el transporte de la sesión). */
  private voice: VoiceChannel | null = null;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (this.engine || this.initializing) return;
    this.initializing = true;
    this.canvas = canvas;

    try {
      // 1) Contenido externo + validación (los errores de referencias se avisan, no abortan).
      const { content, issues } = await loadContent();
      this._content = content;
      // v1.64 — la llamada de teléfono NO congela el mundo (rules.sim.phone.freeMovement):
      // el timbre suena, el diálogo flota y el vecino sigue andando/entrando. El selector
      // selectWorldFrozen honra esta bandera (una sola verdad, también para el mando).
      setPhoneFreeMovement(content.rules.sim.phone.freeMovement);
      // v1.65 — panel de información sobre el escenario: altura máxima (fracción del
      // escenario) y alertas post-it on/off — todo del catálogo (rules.view.infoDock).
      setInfoDockTuning(content.rules.view.infoDock ?? {});
      // v1.54 — INVITACIÓN POR ENLACE (?join=CODE): quien abre un enlace de invitación
      // aterriza con el panel de multijugador YA ABIERTO y la tarjeta «Te han invitado»
      // lista para entrar con un clic (el código viaja en la URL, nunca se teclea).
      if (typeof location !== 'undefined') {
        const invite = new URLSearchParams(location.search).get('join');
        if (invite && /^[a-z0-9]{3,8}$/i.test(invite.trim())) {
          useGameStore.getState().setMpInviteCode(invite.trim().toUpperCase());
          useGameStore.getState().setMpPanelOpen(true);
        }
      }
      // v1.47 — REFERENCIA DE ARTE (?artref=1): overlay con la hoja de sprites del personaje
      // y descarga del PNG (el vecino monta el arte final sobre esta retícula).
      if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('artref')) {
        void import('./artref').then((m) => m.openArtReference(content));
      }
      this.cutscenePlayer = new CutscenePlayer(content);
      preloadSounds();
      preloadTranslations();
      useGameStore.setState({ touchHint: content.rules.touch.hint });
      if (issues.length > 0) {
        useGameStore.getState().pushToast(translate(useGameStore.getState().lang, 'ev.contentInvalid', { n: String(issues.length) }), 'bad');
      }
      // v1.39 — tutorial del primer día: director + registro para la UI.
      this.tutorial = createTutorial(content.onboarding, () => useGameStore.getState().lang);
      setCurrentTutorial(this.tutorial);
      // v1.39 — música procedural (sin catálogo, partida en silencio musical como siempre).
      if (content.music) {
        this.music = createMusicDirector(content.music);
        this.music.setEnabled(loadOptions().music);
      }

      // 2) Motor de render (WebGPU con fallback WebGL2). La calidad la elige el jugador en Opciones.
      const { engine, backend } = await createEngine(canvas);
      this.engine = engine;
      const opts = loadOptions();
      engine.setHardwareScalingLevel(QUALITY_SCALE[opts.quality]);
      // v1.38 — AUTO-AJUSTE DE RENDIMIENTO (pase de optimización): mide FPS reales y
      // degrada/recupera detalles (sombras, glow, resolución) para garantizar el objetivo
      // del menú de opciones. El controlador sigue siendo dueño del render vía ganchos.
      this.perf = new PerfDirector(engine, {
        setGlowEnabled: (v) => (v ? this.setupGlow() : this.teardownGlow()),
        setShadowEvery: (n) => this.setShadowPolicy(n),
        onLevel: (level) => useGameStore.setState({ perfLevel: level }),
      });
      this.perf.setBaseQuality(opts.quality);
      this.perf.configure(opts.perfAuto, opts.perfTarget);
      window.addEventListener('resize', this.onResize);
      // v1.40 — PANTALLA NEGRA CAZADA: si el navegador pierde el contexto gráfico
      // (WebGL "context lost" / WebGPU "device lost", típico bajo presión de memoria), el
      // lienzo se queda negro mientras los bocadillos (DOM) siguen vivos — el síntoma
      // exacto que veía el vecino. Lo detectamos por las tres vías y avisamos con un
      // overlay amable y botón de recarga en vez de un juego muerto silencioso.
      canvas.addEventListener('webglcontextlost', this.onContextLost);
      engine.onContextLostObservable?.add?.(this.onContextLost);
      const gpuDevice = (engine as unknown as { _device?: { lost?: Promise<unknown> } })._device;
      gpuDevice?.lost?.then(() => this.onContextLost());
      await this.restart();
      useGameStore.getState().markReady(backend);
      startGamepadPolling();
      // FASE N — AUTO-REJOIN tras recarga: si había una sesión de comunidad anotada en
      // localStorage, el vecino vuelve a ella sin tocar nada (el servidor re-difunde el
      // mundo completo; ver connectNet/tryAutoRejoin). Tras caída irreversible, silencio:
      // sigue su partida en solitario como si nada.
      this.tryAutoRejoin();
      // Logros (v1.17): si el jugador cambia el idioma de la interfaz, los textos ya
      // resueltos de los logros se re-pintan con el catálogo (los desbloqueos se quedan).
      // v1.39 — y el CONTENIDO narrativo también se re-traduce (overlay ES→EN).
      useGameStore.subscribe((s, prev) => {
        if (s.lang !== prev.lang) {
          void (async () => {
            if (!this._content) return;
            await applyContentLanguageAsync(this._content, s.lang);
            if (this.world) applyStaticTokens(this._content, this.world);
            this.rebuildAchievementTexts();
            this.syncProject(true);
            this.syncResidentsUi();
            this.tutorial.refresh();
            this.syncHud();
          })();
        }
      });
      engine.runRenderLoop(this.frame);
      // Gancho de depuración/pruebas E2E (no lo usa la UI).
      (window as unknown as { __vecinos?: unknown }).__vecinos = { store: useGameStore, controller: this };
    } catch (err) {
      console.error('No se pudo arrancar el juego (contenido o motor de render)', err);
      useGameStore.getState().setEngineError(true);
    }
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.canvas?.removeEventListener('webglcontextlost', this.onContextLost); // v1.40
    this.net?.disconnect();
    this.net = null;
    this.perf = null;
    this.music?.dispose();
    this.music = null;
    this.residents?.dispose();
    this.residents = null;
    this.bubbles?.dispose();
    this.bubbles = null;
    this.chats?.dispose();
    this.chats = null;
    this.voices?.dispose();
    this.voices = null;
    this.streetlife?.dispose();
    this.streetlife = null;
    this.paseo?.dispose();
    this.paseo = null;
    this.pedestrians?.dispose();
    this.pedestrians = null;
    this.traffic?.dispose();
    this.traffic = null;
    this.ecosystem?.dispose();
    this.ecosystem = null;
    this.backdrop?.dispose();
    this.backdrop = null;
    this.exterior?.dispose();
    this.exterior = null;
    this.engine?.stopRenderLoop(this.frame);
    this.scene?.dispose();
    this.engine?.dispose();
    this.engine = null;
    this.scene = null;
  }

  // ───────────────── Entrada (GameStage la conecta; los mandos virtuales se fusionan) ─────────────────

  onKeyDown(code: string): void {
    // Cutscene en curso: E/Espacio/Enter/Escape saltan el espectáculo; nada más pasa.
    if (this.cutscenePlayer?.active) {
      if (code === 'KeyE' || code === 'Space' || code === 'Enter' || code === 'Escape') this.cutsceneSkip();
      return;
    }
    // v1.39 — ESCAPE = menú de pausa de verdad (si no lo está gestionando un modal o un
    // post-it desplegado: cada cosa cierra lo suyo).
    // v1.65 — el diálogo MULTIJUGADOR y el panel del CUADERNO gestionan su propio Escape
    // (sus oyentes los cierran): si alguno está abierto, aquí no se toca nada — antes,
    // cerrar el diálogo de sesión con Escape abría además el menú de pausa detrás.
    if (code === 'Escape') {
      const st = useGameStore.getState();
      // v1.65 — prioridad de cierre con Escape: PAUSA (toggle propio), luego modales de
      // verdad, luego el diálogo MP y el panel del cuaderno (cada cosa cierra lo suyo).
      if (st.pauseMenuOpen) {
        this.togglePauseMenu(); // el menú de pausa NO tiene oyente propio: aquí se cierra
        return;
      }
      if (selectModalOpen(st) || st.mpPanelOpen || st.infoTab !== null) return;
      // Carrera con Radix: puede haber volteado el estado ANTES de este listener (y aun así
      // el diálogo seguir en el DOM hasta el re-render). Guardia por DOM como cinturón:
      // cerrar la sesión con Escape no debe abrir el menú de pausa detrás (E2E v1.65, A9).
      if (typeof document !== 'undefined') {
        if (document.querySelector('[role="dialog"]')) return;
        if (document.querySelector('[data-postit-panel]')) return;
      }
      this.togglePauseMenu();
      return;
    }
    if (this.keys.has(code)) return;
    this.keys.add(code);
    const store = useGameStore.getState();
    // v1.64 — modales de VERDAD (junta/minijuego/finale/cutscene/ascensor) o pausa: tragan
    // todo. Con SOLO la llamada en pantalla (rules.sim.phone.freeMovement) el mundo sigue:
    // las teclas de movimiento se registran y el resto (E/J/cámaras) lo gestiona el diálogo.
    if (selectWorldFrozen(store) || store.paused) return;
    if (selectModalOpen(store) && !MOVEMENT_KEYS.has(code)) return;
    if (code === 'KeyE') {
      this.interact();
      return;
    }
    if (code === 'KeyJ') {
      // Presidencia (v1.18): J junto al tablón convoca una junta con la agenda del catálogo.
      if (this.logic?.interactTarget()?.kind === 'noticeboard') this.convocaJunta();
      return;
    }
    const cam = CAM_BY_KEY[code];
    // v1.65 — tecla 5 repetida: pasar al SIGUIENTE vecino espiado (rueda de vecinos).
    if (cam === 'espia' && useGameStore.getState().camMode === 'espia') {
      this.cycleSpyTarget();
      return;
    }
    if (cam) this.setCamMode(cam);
  }

  onKeyUp(code: string): void {
    this.keys.delete(code);
  }

  setTouchInput(v: Partial<Input>): void {
    this.touch = { ...this.touch, ...v };
  }

  private readInput(): Input {
    const held = (...codes: string[]) => codes.some((c) => this.keys.has(c));
    return {
      left: held('KeyA', 'ArrowLeft') || this.touch.left,
      right: held('KeyD', 'ArrowRight') || this.touch.right,
      up: held('KeyW', 'ArrowUp') || this.touch.up,
      down: held('KeyS', 'ArrowDown') || this.touch.down,
      run: held('ShiftLeft', 'ShiftRight') || this.touch.run,
    };
  }

  // ───────────────────────── Acciones de la interfaz ─────────────────────────

  togglePause(): void {
    const store = useGameStore.getState();
    store.setPaused(!store.paused);
  }

  /**
   * v1.39 — MENÚ DE PAUSA de verdad: abrirlo congela el mundo (paused = true) y muestra el
   * overlay (Reanudar/Opciones/Guardar/Salir); cerrarlo lo reanuda. Todos los accesos
   * (Escape, botón de pausa de la barra, Start del mando) pasan por aquí.
   */
  togglePauseMenu(): void {
    const store = useGameStore.getState();
    const open = !store.pauseMenuOpen;
    store.setPauseMenuOpen(open);
    store.setPaused(open);
  }

  /** v1.39 — opción «Música» del menú de opciones (persistida; el director solo obedece). */
  applyMusic(v: boolean): void {
    this.music?.setEnabled(v);
  }

  setSpeed(speed: Speed): void {
    // En remoto el reloj lo lleva el servidor: solo el anfitrión cambia la velocidad de la sesión.
    if (this.net) {
      if (this.isHost) this.net.setSpeed(speed);
      useGameStore.getState().setSpeed(speed);
      return;
    }
    useGameStore.getState().setSpeed(speed);
  }

  /**
   * v1.65 — modo de cámara (con ESPÍA): 'espia' sigue a un vecino; con spyId se le señala
   * desde la UI, sin id se elige el más cercano al jugador. Si no hay nadie a quien espiar,
   * se cae a PLANTA con un aviso (la cámara nunca se queda sin sujeto).
   */
  setCamMode(mode: CamMode, spyId?: string): void {
    const store = useGameStore.getState();
    if (mode === 'espia') {
      const prev = this.spyResidentId;
      const id = spyId ?? this.pickSpyTarget();
      if (!id) {
        store.pushToast(translate(store.lang, 'ev.spyNone'), 'info');
        mode = 'planta';
      } else {
        this.spyResidentId = id;
        store.setSpyTargetId(id);
        if (id !== prev) store.pushToast(translate(store.lang, 'ev.spyFollow', { name: this.nameOf(id) }), 'info');
      }
    }
    if (mode !== 'espia') {
      this.spyResidentId = null;
      if (store.spyTargetId !== null) store.setSpyTargetId(null);
    }
    if (this.rig) this.rig.mode = mode;
    useGameStore.getState().setCamMode(mode);
  }

  /** v1.65 — vecino PRESENTE más cercano al jugador (candidato por defecto del espía). */
  private pickSpyTarget(): string | null {
    if (!this.world || !this.actors || !this.logic) return null;
    const p = this.logic.position();
    const cellH = this.content?.rules.view.cellH ?? 2.6;
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, r] of Object.entries(this.world.residents)) {
      if (id === this.actorId() || !r.present || r.location === null) continue;
      const node = this.actors.director?.nodeOf(id);
      if (!node) continue;
      const d = Math.abs(node.x - p.x) + Math.abs(node.z - p.z) + Math.abs(node.y - p.floor * cellH) * 2;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  /** v1.65 — siguiente vecino presente en la rueda del espía (tecla 5 repetida). */
  cycleSpyTarget(): void {
    if (!this.world) return;
    const ids = Object.entries(this.world.residents)
      .filter(([id, r]) => id !== this.actorId() && r.present && r.location !== null)
      .map(([id]) => id)
      .sort();
    if (ids.length === 0) return;
    const idx = this.spyResidentId ? ids.indexOf(this.spyResidentId) : -1;
    this.setCamMode('espia', ids[(idx + 1) % ids.length]!);
  }

  /** v1.47 — entra en un interior con cámara de ESTANCIA recordando la previa (una vez). */
  private enterInteriorCam(): void {
    const cur = useGameStore.getState().camMode;
    if (this.camReturn === null && cur !== 'estancia') this.camReturn = cur;
    this.setCamMode('estancia');
  }

  /** v1.47 — sale de un interior: devuelve la cámara previa SOLO si el usuario no cambió
   *  de cámara dentro (su elección manda). Sin previa conocida, no toca nada. */
  private exitInteriorCam(): void {
    const cur = useGameStore.getState().camMode;
    const back = this.camReturn;
    this.camReturn = null;
    if (back && cur === 'estancia') this.setCamMode(back);
  }

  /** Siguiente cámara de la rueda Estancia → Planta → Edificio → Fachada → Espía
   *  (v1.65: orden de CERCA a LEJOS + espía; teclado 1-5 y mando Y). */
  cycleCam(): void {
    const order: CamMode[] = ['estancia', 'planta', 'edificio', 'fachada', 'espia'];
    const cur = order.indexOf(useGameStore.getState().camMode);
    this.setCamMode(order[(cur + 1) % order.length]!);
  }

  /** Calidad gráfica (pulido Steam): resolución de render vía hardware scaling. Solo presentación. */
  applyQuality(q: QualityLevel): void {
    this.engine?.setHardwareScalingLevel(QUALITY_SCALE[q]);
    // v1.38 — la calidad manual es el SUELO del auto-ajuste: recalcula su escalado vigente.
    this.perf?.setBaseQuality(q);
  }

  /** v1.38 — auto-ajuste de rendimiento on/off (menú de opciones; off = calidad manual tal cual). */
  applyPerfAuto(v: boolean): void {
    this.perf?.setAuto(v);
  }

  /** v1.38 — objetivo de FPS que el auto-ajuste garantiza (30/45/60 o máximo rendimiento). */
  applyPerfTarget(t: PerfTarget): void {
    this.perf?.setTarget(t);
  }

  // ────── v1.38 — ganchos del optimizador (glow y sombras on-demand) ──────

  /** Monta la capa Glow del catálogo (idempotente; el estado lo decide el optimizador). */
  private setupGlow(): void {
    if (!this.scene || !this.building || this.glowLayer) return;
    const glowCfg = this.content.rules.view.glow;
    if (!glowCfg?.enabled) return;
    const { GlowLayer } = B();
    const gl = new GlowLayer('luz_bloom', this.scene, { blurKernelSize: glowCfg.blurKernelSize ?? 32 });
    gl.intensity = glowCfg.intensity ?? 0.7;
    // v1.29 — GLOW SUTIL EN LOS INTERIORES: las mallas interiores del building quedan
    // excluidas; apliques, farolas, pantallitas y ventanas nocturnas conservan su bloom.
    for (const mesh of this.building.glowExcluded()) gl.addExcludedMesh(mesh);
    this.glowLayer = gl;
  }

  private teardownGlow(): void {
    this.glowLayer?.dispose();
    this.glowLayer = null;
  }

  /** Política de sombras del optimizador: 'off' desmonta el generador; N espacia su pase. */
  private setShadowPolicy(n: number | 'off'): void {
    this.shadowsOff = n === 'off';
    this.desiredShadowEvery = n === 'off' ? 1 : n;
    this.applyShadowPolicy();
  }

  /** Aplica la política vigente + el congelado nocturno (regalo del pase, cero coste visual). */
  private applyShadowPolicy(): void {
    if (!this.scene) return;
    if (this.shadowsOff) {
      if (this.shadows) {
        this.shadows.dispose();
        this.shadows = null;
      }
      return;
    }
    if (!this.shadows && this.sunLight) {
      this.shadows = createShadows(this.scene, this.sunLight, this.content.rules.view.shadows);
    }
    this.shadows?.setUpdateEvery(this.shadowsFrozen ? 0 : this.desiredShadowEvery);
  }

  /** Botón "Fiesta demo": datos en rules.demo (residente, bloque y ruido) → canal de ruido en acción. */
  partyDemo(): void {
    if (!this.world) return;
    if (this.net) return; // demo de dev: solo tiene sentido con el mundo en local
    const demo = this.content.rules.demo;
    if (!this.world.residents[demo.resident]!.present) {
      applyEffects(this.world, this.content, [{ op: 'unlock', target: demo.block, resident: demo.resident, arrival: 'mudanza' }]);
    }
    tick(this.world, this.content, { noise: { [demo.block]: demo.noise } });
    useGameStore.getState().pushToast(demo.toast, 'info');
    this.pump();
  }

  skipTime(): void {
    if (!this.world) return;
    if (this.net) {
      useGameStore.getState().pushToast(this.content.rules.multiplayer.texts.remoteSaveDisabled, 'info');
      return;
    }
    for (let i = 0; i < 10; i++) tick(this.world, this.content);
    this.pump();
  }

  /** Interacción (tecla E o botón virtual ✋): usar el objeto cercano, entrar o salir. */
  interact(): void {
    // El ✋ táctil también salta la cutscene (es la única acción habilitada mientras dura).
    if (this.cutscenePlayer?.active) {
      this.cutsceneSkip();
      return;
    }
    if (!this.logic) return;
    // Ascensor (v1.9): si el prompt anuncia ascensor (sin objetivo de E delante), la E abre el
    // panel de destino. Misma condición que promptText → lo que ves es lo que la E ejecuta.
    if (!this.logic.interactTarget()) {
      const panel = this.logic.elevatorPanelTarget();
      if (panel) {
        useGameStore.getState().setElevatorPanel(panel);
        this.tutorial.tip('elevator'); // v1.39 — consejo contextual one-shot
        return;
      }
    }
    const r = this.logic.interact();
    // v1.39 — onboarding: la interacción usada alimenta los pasos del tutorial.
    if (r.type === 'used' && (r.kind === 'noticeboard' || r.kind === 'resident')) {
      this.tutorial.notify(`used:${r.kind}`);
    }
    // v1.26: el bloqueo en seco (norma de vivienda vacía / candado) AVISA con un bocadillo —
    // antes la E moría en silencio y parecía un botón roto.
    if (r.type === 'locked') {
      const s = useGameStore.getState();
      s.pushToast(translate(s.lang, r.reason === 'vacant' ? 'door.vacant' : 'door.lockedGeneric'), 'info');
    }
    // v1.64 — TIMBRE en vivienda ajena: suena (con gracia antirrebote) y CUALQUIER dueño
    // presente abre (esté donde esté); solo vacía/dueño ausente avisan sin abrir.
    if (r.type === 'doorbell') {
      const opened = this.ringDoorbell(r.block);
      if (opened && this.logic && this.world) {
        const er = this.logic.enterBlock(r.block);
        if (er.type === 'entered') this.enterInteriorCam();
        else if (er.type === 'locked') {
          const s = useGameStore.getState();
          s.pushToast(translate(s.lang, er.reason === 'vacant' ? 'door.vacant' : 'door.lockedGeneric'), 'info');
        }
      }
      this.pump();
      return;
    }
    // v1.40 — CHARLA con un vecino cruzado en el pasillo: cara a cara y su saludo del
    // catálogo de personalidades (reactions.greet), en el idioma del chrome.
    if (r.type === 'chat') {
      this.chatWith(r.residentId);
      this.pump();
      return;
    }
    // v1.48 — CUADRO DE FUSIBLES (garaje): con apagón abre el minijuego de rearme;
    // en calma, el aviso del catálogo («todo en orden... de momento»).
    if (r.type === 'fusebox') {
      const s = useGameStore.getState();
      if (this.ecosystem?.isBlackout()) {
        const def = this.content.minigames['mg_fusibles'];
        if (def) {
          this.tutorial.tip('minigame');
          const ov = this.scenarioOverrides[def.id];
          const effective = ov ? ({ ...def, config: { ...def.config, ...ov } } as MinigameDef) : def;
          s.setMinigame({ ...effective, emoji: effective.emoji ?? '💡', instruction: effective.instruction ?? null });
        }
      } else {
        s.pushToast(this.content.rules.interact.fusebox?.okLine ?? 'El cuadro está en orden.', 'info');
      }
      this.pump();
      return;
    }
    // v1.42 — CALLE: poses del banco y calistenia (el gesto/pose lo aplica el director).
    if (r.type === 'sit') {
      this.actors?.director?.seatWhenIdle(this.actorId(), { x: r.x, z: r.z, yaw: r.yaw });
      this.sayOutdoorLine('sit');
      this.pump();
      return;
    }
    if (r.type === 'stand') {
      this.actors?.director?.standUp(this.actorId());
      this.pump();
      return;
    }
    if (r.type === 'exerciseStart') {
      this.actors?.director?.setGesture(this.actorId(), this.content.rules.view.paseo?.gesture ?? 'dance', 0);
      this.sayOutdoorLine('exercise');
      this.pump();
      return;
    }
    if (r.type === 'rearEnter') {
      // Apilamiento 3D (v1.19): el swap lo ejecuta building.update por fases; aquí solo
      // encuadra la cámara dentro del bloque trasero.
      this.enterInteriorCam();
      this.pump();
      return;
    }
    if (r.type === 'rearExit') {
      this.exitInteriorCam();
      this.pump();
      return;
    }
    if (r.type === 'entered') this.enterInteriorCam();
    else if (r.type === 'exited') this.exitInteriorCam();
    else if (r.type === 'used') this.presentInteraction(r.kind);
    this.pump();
  }

  /** Panel del ascensor (v1.9): planta elegida → cierra el panel y pide cabina (la FSM manda). */
  pickElevatorFloor(to: number): void {
    useGameStore.getState().setElevatorPanel(null);
    if (!this.logic) return;
    if (!this.logic.elevatorCall(to)) {
      useGameStore.getState().pushToast(translate(useGameStore.getState().lang, 'elev.unreachable'), 'info');
      return;
    }
    this.pump();
  }

  /** Cierra el panel sin llamar (Escape o botón cancelar). */
  closeElevatorPanel(): void {
    useGameStore.getState().setElevatorPanel(null);
  }

  /** Salta la cutscene en curso (y las encadenadas que quedaban en cola). */
  cutsceneSkip(): void {
    this.cutsceneQueue = [];
    this.cutscenePlayer?.abort();
  }

  /**
   * v1.64 — FÁBRICA de la lógica del jugador (una sola fuente de opts): el actor controlado
   * es el residente de la sesión (invitado) o el clásico world.playerId. La usaba restart()
   * en línea; ahora también rebindLogic() — el invitado nace ANTES de conocer su id.
   */
  private makeLogic(actorId?: string): PlayerLogic {
    return new PlayerLogic(this.world!, this._content!, {
      actorId,
      send: (cmd) => this.sendCommand(cmd),
      // v1.50 — el prompt de charla se mide contra el ACTOR real (nodeOf): si el cuerpo no
      // está pintado ahí (otro sitio/oculto), no hay aviso «E · charlar con…» fantasma.
      actorPos: (residentId) => {
        const n = this.actors?.director.nodeOf(residentId);
        if (!n) return null;
        return { x: n.x, z: n.z, floor: Math.round(n.y / this.content.rules.view.cellH) };
      },
    });
  }

  /**
   * v1.64 — RE-VINCULACIÓN DE IDENTIDAD (bug P0 «seed compartida»): el invitado arranca su
   * mundo local ANTES de unirse, así que su PlayerLogic nació con world.playerId — el
   * residente del ANFITRIÓN. Con session:joined el servidor le da su id (res_guest_N): si
   * la lógica controla otro residente se recrea AQUÍ, con el mundo ya sincronizado o el que
   * haya (el constructor cae al jugador clásico si el invitado aún no existe y la próxima
   * session:state + reconcile lo planta donde el servidor dice). Sin esto, el invitado
   * caminaba con el cuerpo del anfitrión: su propia puerta le salía «ajena» (timbre) y no
   * podía entrar en su casa.
   */
  private rebindLogic(): void {
    if (!this.world || !this._content || !this.logic) return;
    const want = this.actorId();
    if (!want || this.logic.controlledId() === want) return;
    this.logic = this.makeLogic(want);
    this.reconcile();
    console.info(`[mp] lógica re-vinculada a ${want}`);
  }

  /**
   * v1.64 — TIMBRE QUE ABRE DE VERDAD: llamar a una puerta solo servía si el dueño estaba
   * EXACTAMENTE dentro del bloque (owner.location === blockId) — si Marta estaba en el bar
   * o bajando por el pasillo, el timbre sonaba eternamente y NADIE abría. Ahora el timbre
   * «llama» a cualquier dueño PRESENTE (esté donde esté: el knock_result lo trae caminando
   * hasta su puerta) y deja entrar; solo las viviendas SIN dueño (vacías) o con el dueño
   * ausente del vecindario siguen cerradas (norma del barrio: nadie vive ahí, nadie abre).
   *
   * v1.64 (refinamiento) — GRACIA ANTIRREBOTE (rules.sim.doorbell.reRingGraceSecs): un
   * segundo E sobre la MISMA puerta dentro de la ventana NO vuelve a sonar ni repite el
   * aviso — el timbre no pasa de sonar aunque se martille la E. La ENTRADA no se toca:
   * si hay alguien que pueda abrir, se entra igual (incluso con el sonido aún en el aire).
   *
   * v1.64 (refinamiento) — PUERTA DEL ANFITRIÓN (multijugador): el knock del sim EXCLUYE a
   * world.playerId (regla de solitario: nadie llama a su propia puerta), así que un invitado
   * llamando al timbre del anfitrión recibiría un «Nadie responde» FALSO en todas las
   * pantallas y nadie abriría. Para esa puerta la presentación es LOCAL (saludo del catálogo
   * de personajes) y el dueño recibe SU timbre en vivo por mp:ring (relay del servidor).
   */
  private ringDoorbell(blockId: string): boolean {
    if (!this.world) return false;
    const store = useGameStore.getState();
    const block = this.world.blocks[blockId];
    const ownerId = block?.ownerId ?? null;
    const owner = ownerId ? this.world.residents[ownerId] : undefined;
    const now = performance.now() / 1000;
    const fresh = !(this.lastRing.block === blockId && now - this.lastRing.at < this.content.rules.sim.doorbell.reRingGraceSecs);
    if (fresh) {
      this.lastRing = { block: blockId, at: now };
      playSound('doorbell');
    }
    if (!owner || !owner.present) {
      if (fresh) {
        // Nadie en el vecindario puede abrir: vacía (norma) o dueño ausente.
        const vacant = block?.occupancy !== 'occupied';
        store.pushToast(translate(store.lang, vacant ? 'door.vacant' : 'door.noAnswer'), 'info');
      }
      return false;
    }
    if (owner.controller?.type === 'human' && owner.id === this.world.playerId && this.net) {
      if (fresh) {
        const line = greetLineOf(this.content, owner, store.lang) ?? translate(store.lang, 'chat.fallback');
        store.pushToast(translate(store.lang, 'ev.greetSay', { name: this.nameOf(owner.id), line }), 'good');
        this.bubbles?.sayText(owner.id, line, 2.8);
        this.actors?.director.setGesture(owner.id, 'talk', 3.5);
        this.tutorial.notify('used:resident');
        this.net.ring(blockId); // el dueño oye SU timbre en vivo (el servidor lo reenvía)
      }
      return true;
    }
    this.logic?.knockAt(blockId);
    return true;
  }

  /** v1.40 — CHARLA con un vecino en circulación: os plantáis cara a cara, él suelta su
   *  saludo (bocadillo) y los dos gesticuláis la conversación. Pura presentación: el sim
   *  no cambia por charlar (las afinidades las mueven las misiones y los cruces). */
  private chatWith(residentId: string): void {
    if (!this.world || !this.logic) return;
    const store = useGameStore.getState();
    const other = this.world.residents[residentId];
    if (!other) return;
    const line = greetLineOf(this.content, other, store.lang) ?? translate(store.lang, 'chat.fallback');
    this.bubbles?.sayText(residentId, line, 2.8);
    const me = this.actors?.director.nodeOf(this.actorId());
    const them = this.actors?.director.nodeOf(residentId);
    if (me && them) {
      this.actors?.director.faceToward(residentId, me.x, me.z);
      this.actors?.director.faceToward(this.actorId(), them.x, them.z);
    }
    this.actors?.director.setGesture(residentId, 'talk', 3.4);
    this.actors?.director.setGesture(this.actorId(), 'talk', 3.4);
    this.tutorial.notify('used:resident'); // conocer gente también es esto
  }

  /**
   * Lecturas sin estado (buzón/tablón): texto del catálogo aquí; work/sleep/knock llegan como
   * eventos del sim (ui_toast / knock_result) y no se tratan en esta vía.
   */
  private presentInteraction(kind: 'laptop' | 'bed' | 'mailbox' | 'noticeboard' | 'resident'): void {
    if (!this.world) return;
    const ic = this.content.rules.interact;
    if (kind === 'mailbox') {
      const lines = ic.mailbox.lines;
      useGameStore.getState().pushToast(lines[this.world.tick % lines.length]!, 'info');
    } else if (kind === 'noticeboard') {
      const elevatorBlock = Object.values(this.world.blocks).find((b) => b.params.elevator_status !== undefined);
      const status = String(elevatorBlock?.params.elevator_status ?? 'ok');
      let text = ic.noticeboard.template
        .replace('{day}', String(this.world.clock.day))
        .replace('{funds}', String(this.world.community.funds))
        .replace('{elevator}', this.content.rules.labels.elevator[status] ?? status)
        .replace('{weather}', this.content.rules.labels.weather[this.world.weather.state] ?? this.world.weather.state);
      // Presidencia (v1.18): con el mandato activo, el tablón también convoca.
      const cfg = this.content.rules.sim.campaign;
      if (cfg && useGameStore.getState().campaign?.active) text += `\n🗳️ [J] Convocar junta de vecinos (${cfg.presidentLabel.toLowerCase()})`;
      // v1.55 — MARCADOR EN EL TABLÓN: con sesión de comunidad, la clasificación se lee
      // en la puerta (plantillas de rules.multiplayer.score.board*).
      const rows = useGameStore.getState().mpScore;
      const scoreCfg = this.content.rules.multiplayer?.score;
      if (rows && scoreCfg && rows.length > 0) {
        const lines = rows
          .map((r, i) => {
            // FASE D — la mejor marca de CUALQUIER minijuego catalogado (la más rápida de
            // todas), con su label del catálogo; antes solo se mostraba la de fusibles.
            let extra = '';
            if (scoreCfg.boardExtraBest) {
              let bestSecs = Infinity;
              let bestLabel = '';
              for (const [mgId, mgCfg] of Object.entries(scoreCfg.minigames)) {
                const secs = r.best[mgId];
                if (secs !== undefined && secs < bestSecs) {
                  bestSecs = secs;
                  bestLabel = mgCfg.label ?? mgId;
                }
              }
              if (Number.isFinite(bestSecs)) {
                extra = scoreCfg.boardExtraBest.replace('{label}', bestLabel).replace('{secs}', bestSecs.toFixed(1).replace('.', ','));
              }
            }
            return (scoreCfg.boardLine ?? '{pos}. {name} · {points} pts')
              .replace('{pos}', String(i + 1))
              .replace('{name}', r.name)
              .replace('{points}', String(r.points))
              .replace('{extra}', extra);
          })
          .join('\n');
        text += `\n\n${(scoreCfg.boardTemplate ?? '🏅 VECINO DEL MES\n{lines}').replace('{lines}', lines)}`;
      }
      useGameStore.getState().pushToast(text, 'info');
    }
  }

  /**
   * Junta extraordinaria convocada por la presidencia desde el tablón (v1.18): la agenda
   * sale del catálogo (rules.sim.campaign.presetAgenda) y la votación la resuelve el sim
   * (mismo flujo que las juntas de misión). Cooldown del catálogo; solo con mandato activo.
   */
  private convocaJunta(): void {
    const world = this.world;
    const cfg = this.content.rules.sim.campaign;
    if (!world || !cfg || world.junta) return;
    if (!useGameStore.getState().campaign?.active) {
      useGameStore.getState().pushToast(translate(useGameStore.getState().lang, 'ev.juntaPresidentOnly'), 'info');
      return;
    }
    if (world.tick - this.lastConvocaTick < cfg.convocationCooldownMinutes) {
      const left = Math.ceil(cfg.convocationCooldownMinutes - (world.tick - this.lastConvocaTick));
      useGameStore.getState().pushToast(translate(useGameStore.getState().lang, 'ev.juntaCooldown', { n: left }), 'info');
      return;
    }
    this.lastConvocaTick = world.tick;
    world.junta = { agenda: cfg.presetAgenda.map((i) => ({ ...i })), votes: {}, playerVoted: false };
    useGameStore.getState().setJunta(cfg.presetAgenda.map((i) => ({ id: i.id, title: i.title, description: i.description, cost: i.cost })));
    useGameStore.getState().pushLog(translate(useGameStore.getState().lang, 'ev.juntaConvocada'), 'info');
    this.marchJunta(); // v1.30: igual que las juntas de misión, la sala recibe a los asistentes
  }

  /**
   * v1.30 — ASISTENCIA A LA JUNTA (teatro de presentación): convocada una junta, TODOS los
   * vecinos presentes en el edificio entran en la sala de juntas y se SIENTAN en sus sillas
   * (el local se abre y se ilumina mientras dura la sesión). El sim no cambia: es el mismo
   * teatro del director de cutscenes — al cerrarse la junta, dismissJunta() los suelta.
   * También acoge fiestas: el local queda como punto de encuentro de la comunidad.
   */
  private juntaAttendees: string[] = [];
  private marchJunta(): void {
    const world = this.world;
    if (!world || !this.actors || !this.building) return;
    const hall = this.building.juntaHallInfo();
    if (!hall || hall.seats.length === 0) return;
    this.dismissJunta();
    this.building.setJuntaHall(hall.id);
    const attendees: string[] = [];
    for (const r of Object.values(world.residents)) {
      if (!r.present || r.location === null) continue;
      if (r.id === world.playerId) continue; // el jugador camina solo (es humano)
      attendees.push(r.id);
    }
    // Reparto determinista por orden de id: 1 asistente por silla libre; los que sobran
    // DE PIE dentro del local (puestos del catálogo), nunca apilados sobre una silla.
    attendees.sort((a, z) => (a < z ? -1 : 1));
    const locals = this.content.rules.view.locals;
    const standCells = locals.juntaHall.standSpots ?? [];
    attendees.forEach((id, i) => {
      const seated = i < hall.seats.length;
      const standIdx = i - hall.seats.length;
      const spot = seated ? hall.seats[i]! : hall.stands[standIdx] ?? { x: hall.seats[0]!.x, z: (locals.juntaHall.tableZ ?? 1.5) + 1.0, yaw: Math.PI / 2 };
      if (!this.actors!.director.take(id)) return;
      const ok = this.actors!.director.walkTo(id, {
        x: spot.x,
        z: spot.z,
        floor: 0,
        inside: { block: hall.id, local: { x: spot.x - (world.blocks[hall.id]!.cell.col * (this.content!.rules.view.cellW)), z: spot.z - (this.content!.rules.view.roomZ - this.content!.rules.view.commonDepth / 2) } },
      });
      if (!ok) {
        this.actors!.director.release(id);
        return;
      }
      if (seated) this.actors!.director.seatWhenIdle(id, spot); // los que sobran, de pie detrás
      else if (standCells.length > 0 && standIdx % 3 === 0) this.actors!.director.setGesture(id, 'talk', 6);
    });
    this.juntaAttendees = attendees;
    if (attendees.length > 0) {
      const seatedN = Math.min(attendees.length, hall.seats.length);
      const standingN = attendees.length - seatedN;
      useGameStore.getState().pushLog(
        standingN > 0
          ? `🗳️ Junta convocada: ${seatedN} vecinos toman asiento y ${standingN} se quedan de pie en la sala.`
          : `🗳️ Junta convocada: ${seatedN} vecinos entran en la sala y toman asiento.`,
        'info',
      );
    }
  }

  /** v1.30 — fin de la junta (o cancelación): la sala se vacía y la IA recupera a cada vecino. */
  private dismissJunta(): void {
    this.building?.setJuntaHall(null);
    for (const id of this.juntaAttendees) this.actors?.director.release(id);
    this.juntaAttendees = [];
  }

  /** Editor: desplazarse a una vivienda del jugador (queda delante de su puerta). */
  visitHome(blockId: string): void {
    if (!this.logic || !this.logic.teleportTo(blockId)) return;
    this.setCamMode('planta');
    this.pump();
  }

  // ───────────────────── Multijugador: sesión y modo remoto ─────────────────────

  /** Quien actúa por este cliente (invitado en sesión; si no, el jugador clásico). */
  private actorId(): string {
    return this.myResidentId ?? this.world?.playerId ?? '';
  }

  /** Vía única de comandos: remoto → servidor autoritativo; clásico → dispatch local.
   *  En clásico DEVUELVE el CommandResult del sim (PlayerLogic lo usa para saber si un move
   *  fue rechazado, p. ej. puerta con candado — sin esto la presentación "entraba" igual). */
  private sendCommand(cmd: Command): CommandResult | void {
    if (this.net) {
      this.net.command(cmd);
      return;
    }
    if (!this.world) return;
    const r = dispatch(this.world, this.content, cmd);
    this.pump();
    return r;
  }

  /**
   * FASE N — auto-rejoin tras RECARGA de la página: localStorage tenía { code, residentId }
   * de la última comunidad (store.setMpSession). Se intenta una sola vez y en silencio:
   * ok → session:joined + session:state re-sincronizan TODO (mundo, marcador, co-op, voz);
   * fallo (TTL, reinicio sin snapshot, partida agotada) → nota borrada y partida en
   * solitario sin un solo toast de error (nunca fue una acción del vecino).
   */
  private tryAutoRejoin(): void {
    if (this.net || !this._content) return;
    const saved = readMpPersist();
    if (!saved) return;
    useGameStore.getState().setMpStatus('connecting');
    this.connectNet();
    void this.net!.rejoin(saved.code, saved.residentId).then((res) => {
      if (res.ok) {
        useGameStore.getState().setMpStatus('connected'); // onJoined ya re-compone la sesión
        useGameStore.getState().pushToast(translate(useGameStore.getState().lang, 'ev.autoRejoined'), 'good');
        return;
      }
      console.warn(`[vecinos] auto-rejoin falló (${saved.code}): ${res.error}`); // diagnóstico FASE N
      clearMpPersist(); // la partida ya no existe: que no vuelva a intentarlo
      this.net?.disconnect();
      this.net = null;
      useGameStore.getState().setMpStatus('off');
    });
  }

  /** Crea una partida compartida (este cliente queda como anfitrión). */
  hostSession(): void {
    if (this.net || !this._content) return;
    const store = useGameStore.getState();
    store.setMpError(null);
    store.setMpStatus('connecting');
    store.setMpPanelOpen(true);
    this.connectNet();
    void this.net!.hostSession(this.activeScenarioId()).then((res) => {
      this.onHostJoinResult(res);
    });
  }

  /** Se une a una partida compartida por código. */
  joinSession(code: string): void {
    if (this.net || !this._content) return;
    const store = useGameStore.getState();
    store.setMpError(null);
    store.setMpStatus('connecting');
    store.setMpPanelOpen(true);
    this.connectNet();
    void this.net!.joinSession(code.trim().toUpperCase()).then((res) => {
      this.onHostJoinResult(res);
    });
  }

  /** Sale de la sesión y vuelve al mundo local en solitario. */
  leaveSession(): void {
    this.net?.leave();
    this.net?.disconnect();
    this.net = null;
    this.myResidentId = null;
    this.isHost = false;
    this.appliedSeq = 0;
    this.remotePoses.clear(); // v1.57 — sin sesión no hay poses que interpretar
    this.stopVoice(); // v1.56 — fuera del vecindario no hay canal de voz
    const store = useGameStore.getState();
    store.setMpStatus('off');
    store.setMpSession(null);
    store.setMpParticipants([]);
    store.setMpScore(null); // v1.55: sin sesión, sin marcador
    store.setMpCoop(null); // v1.56: sin oferta co-op
    store.setMpVoice({ active: false, muted: false, members: [] });
    store.setMpPanelOpen(false);
    store.setMpInviteCode(null); // v1.54: la invitación de la URL ya no aplica
    void this.restart();
    store.pushToast(translate(store.lang, 'ev.soloResumed'), 'info');
  }

  private connectNet(): void {
    // v1.77 — export estático (GitHub Pages): no hay servidor de juego al otro lado del
    // socket. Aviso honesto y cero reconexiones infinitas contra una URL que no existe.
    if (STATIC_EXPORT) {
      const s = useGameStore.getState();
      s.pushToast(translate(s.lang, 'ev.netUnavailable'), 'info');
      return;
    }
    this.net = new NetSession({
      onState: (s) => this.applyRemoteState(s),
      onParticipants: (p) => useGameStore.getState().setMpParticipants(p),
      onScore: (rows) => useGameStore.getState().setMpScore(rows), // v1.55 — marcador de comunidad
      onCoopState: (s) => useGameStore.getState().setMpCoop(s), // v1.56 — misión cooperativa
      onVoiceRoster: (members) => {
        // v1.56 — canal de voz: roster + (re)montaje de la malla de peers.
        useGameStore.getState().setMpVoice({ members });
        this.voice?.setRoster(members);
      },
      onVoiceSignal: (from, data) => {
        void this.voice?.handleSignal(from, data);
      },
      onVoiceState: (from, muted, speaking) => {
        const st = useGameStore.getState();
        st.setMpVoice({ members: st.mpVoice.members.map((m) => (m.id === from ? { ...m, muted, speaking } : m)) });
      },
      onPose: (from, p) => {
        // v1.57 — pose de un avatar remoto: se guarda con sello temporal (el director de
        // actores la interpreta y la caduca); la PROPIA se descarta (el servidor reenvía a todos).
        if (from === this.myResidentId) return;
        this.remotePoses.set(from, { ...p, at: performance.now() });
      },
      onRing: (from, _block) => {
        // v1.64 — TIMBRE EN VIVO: alguien llamó a MI puerta (el servidor reenvía a todos;
        // el que llamó ya lo oyó). Suena mi timbre y aviso — el vecino ve que hay visita.
        if (from === this.myResidentId) return;
        playSound('doorbell');
        const s = useGameStore.getState();
        s.pushToast(translate(s.lang, 'ev.someoneAtDoor'), 'info');
      },
      onJoined: (j) => {
        this.myResidentId = j.yourResidentId;
        this.isHost = j.isHost;
        useGameStore.getState().setMpSession({ code: j.code, isHost: j.isHost, myResidentId: j.yourResidentId });
        useGameStore.getState().setMpParticipants(j.participants);
        useGameStore.getState().setMpInviteCode(null); // v1.54: invitación consumida
        this.rebindLogic(); // v1.64 — el invitado controla SU residente, no el del anfitrión
      },
      onError: (m) => {
        // FASE N — el servidor puede expulsar por anti-cheat (authority_kick): mensaje humano.
        if (m === 'authority_kick') {
          useGameStore.getState().pushToast(translate(useGameStore.getState().lang, 'ev.authorityKick'), 'bad');
          return;
        }
        useGameStore.getState().pushToast(m, 'bad');
      },
      onStatus: (st) => {
        if (!this.net) return;
        const store = useGameStore.getState();
        if (st === 'connected') {
          if (store.mpStatus === 'connecting') return; // el ack decide
          // v1.56 — RECONEXIÓN TRANSPARENTE: el transporte volvió (pestaña en segundo plano,
          // red móvil inestable). Si teníamos sesión, re-vinculamos el MISMO residente: el
          // servidor re-difunde mundo, marcador, co-op y voz, y seguimos donde estábamos.
          // El store descompone la sesión en mpCode + mpMyResidentId (setMpSession).
          const sessCode = store.mpCode;
          if (sessCode && this.myResidentId) {
            void this.net.rejoin(sessCode, this.myResidentId).then((res) => {
              if (res.ok) {
                useGameStore.getState().setMpStatus('connected'); // de vuelta: el panel deja el error
                // El asiento de voz sobrevive en el servidor (gracia): re-afirmo con el socket nuevo.
                if (useGameStore.getState().mpVoice.active) this.net?.voiceJoin();
              } else {
                // v1.56 (auditoría H1) — rejoin imposible (sesión TTL/reinicio): limpieza
                // COMPLETA, si no el net huérfano bloquea «Crear/Unirse» y el micro queda capturado.
                // FASE N — la nota de localStorage también se borra: la partida ya no existe.
                clearMpPersist();
                this.net?.disconnect();
                this.net = null;
                this.myResidentId = null;
                this.isHost = false;
                this.appliedSeq = 0;
                this.stopVoice();
                const s2 = useGameStore.getState();
                s2.setMpStatus('error');
                s2.setMpError('La sesión de la comunidad ya no existe. Crea otra partida o únete a un vecino.');
                s2.setMpCoop(null);
                s2.setMpVoice({ active: false, muted: false, members: [] });
              }
            });
          }
          return;
        }
        if (st === 'disconnected' && store.mpStatus === 'connected') {
          // NO se limpia la sesión: el rejoin del próximo 'connect' la recupera.
          store.setMpStatus('error');
          store.setMpError('Conexión perdida con el servidor de la comunidad. Reconectando…');
        }
      },
    });
  }

  private onHostJoinResult(res: { ok: boolean; code?: string; isHost?: boolean; yourResidentId?: string; error?: string }): void {
    const store = useGameStore.getState();
    if (!res.ok) {
      store.setMpStatus('error');
      store.setMpError(res.error === 'timeout' ? 'El servidor no responde. ¿Se habrá ido a comer?' : res.error ?? 'No se pudo abrir la sesión.');
      return;
    }
    store.setMpStatus('connected');
    // onJoined ya habrá fijado myResidentId/isHost/código con session:joined.
  }

  // ── v1.56 — MISIONES COOPERATIVAS REALES (orquestación cliente; el sim no se toca) ──

  /** Reclama un rol libre de la misión co-op activa (panel Multijugador). */
  coopClaim(missionId: string, roleId: string): void {
    this.net?.coopClaim(missionId, roleId);
  }

  /** El anfitrión salta la misión co-op activa (el catálogo ofertará la siguiente). */
  coopSkip(): void {
    this.net?.coopSkip();
  }

  /**
   * Abre localmente el minijuego del catálogo que exige el rol co-op propio (sin pasar
   * por el sim: las misiones del sim siguen siendo la vía normal; esto ES la tarea
   * co-op). Misma puerta que minigame_requested: modal + overrides de escenario + cronómetro.
   */
  openCoopMinigame(id: string): void {
    if (!this.world) return;
    const def = this.content.minigames[id];
    if (!def) return;
    this.minigameStartedAt = performance.now(); // el duelo también puede sonreír al co-op
    const ov = this.scenarioOverrides[def.id];
    const effective = ov ? ({ ...def, config: { ...def.config, ...ov } } as MinigameDef) : def;
    useGameStore.getState().setMinigame({ ...effective, emoji: effective.emoji ?? '🎮', instruction: effective.instruction ?? null });
  }

  /** Si el objetivo de mi rol asignado era ESTE minijuego completado, marco progreso. */
  private coopProgressMinigame(id: string): void {
    const coop = useGameStore.getState().mpCoop;
    if (!coop?.active || !this.net || !this.myResidentId) return;
    const { mission } = coop.active;
    for (const r of coop.active.roles) {
      if (r.residentId !== this.myResidentId || r.done) continue;
      const def = mission.roles.find((d) => d.id === r.roleId);
      if (def?.objective.type === 'minigame' && def.objective.id === id) {
        this.net.coopProgress(mission.id, r.roleId);
        return;
      }
    }
  }

  /**
   * Detección de objetivos «reach» (llegar a un bloque): con cada estado del servidor
   * compruebo DÓNDE está MI residente (el mundo espejo es autoridad). Uno por tick: el
   * servidor difunde el nuevo estado y el siguiente, si toca, saldrá con él.
   */
  private coopTickLocal(): void {
    const coop = useGameStore.getState().mpCoop;
    if (!coop?.active || !this.net || !this.myResidentId || !this.world) return;
    const loc = this.world.residents[this.myResidentId]?.location ?? null;
    if (!loc) return;
    for (const r of coop.active.roles) {
      if (r.residentId !== this.myResidentId || r.done) continue;
      const def = coop.active.mission.roles.find((d) => d.id === r.roleId);
      if (def?.objective.type === 'reach' && def.objective.block === loc) {
        this.net.coopProgress(coop.active.mission.id, r.roleId);
        return;
      }
    }
  }

  // ── v1.56 — CANAL DE VOZ (WebRTC P2P; el servidor solo reenvía señalización) ──

  /** Entra/sale del canal de voz del vecindario. */
  voiceToggle(): void {
    const store = useGameStore.getState();
    if (this.voice) {
      this.stopVoice();
      this.net?.voiceLeave();
      store.setMpVoice({ active: false, muted: false, members: [] });
      store.pushToast(this.content.multiplayer?.voice.stopToast ?? '🎙️ Canal de voz cerrado.', 'info');
      return;
    }
    if (!this.net || !this.myResidentId) return;
    const myId = this.myResidentId;
    const channel = new VoiceChannel({
      myId,
      sendSignal: (to, data) => this.net?.voiceSignal(to, data),
      sendState: (muted, speaking) => this.net?.voiceState(muted, speaking),
      onMuteChanged: (muted) => useGameStore.getState().setMpVoice({ muted }),
    });
    this.voice = channel;
    void channel.start().then(() => {
      if (this.voice !== channel) return; // se cerró mientras arrancaba el micro
      this.net?.voiceJoin();
      const st = useGameStore.getState();
      st.setMpVoice({ active: true, synthetic: channel.isSynthetic(), muted: false });
      st.pushToast(
        channel.isSynthetic()
          ? this.content.multiplayer?.voice.noMicToast ?? '🎙️ Sin micrófono: modo escucha.'
          : this.content.multiplayer?.voice.startToast ?? '🎙️ Canal de voz abierto.',
        'info',
      );
    });
  }

  /** Silencia/reactiva mi micrófono. */
  voiceMuteToggle(): void {
    this.voice?.toggleMute();
  }

  private stopVoice(): void {
    this.voice?.stop();
    this.voice = null;
  }

  /** Adopta el estado del servidor (autoridad). Primera vez: reinicia la escena con ese mundo. */
  private applyRemoteState(s: SessionStatePayload): void {
    if (s.seq <= this.appliedSeq) return;
    this.appliedSeq = s.seq;
    // FASE N — ack del estado aplicado: el servidor mide el lag de desync por vecino
    // (ticks entre lo que difunde y lo que cada uno confirmó) y lo expone en /health.
    this.net?.ack(s.seq);
    if (!this.world || this.world.scenarioId !== s.world.scenarioId) {
      void this.restart(s.world).then(() => {
        if (!this.world) return;
        this.world.events = s.events.slice();
        this.handleEvents();
        this.reconcile();
        this.coopTickLocal(); // v1.56 — objetivos reach con el mundo recién llegado
        this.syncHud();
      });
      return;
    }
    // Aplica en sitio conservando la identidad del objeto (PlayerLogic/building/actors referencian el mismo World).
    Object.assign(this.world, s.world);
    this.world.events = s.events.slice();
    this.rebindLogic(); // v1.64 — el invitado ya existe en el mundo del servidor: se re-vincula aquí si faltaba
    this.handleEvents();
    this.paintBuilding();
    this.reconcile();
    this.coopTickLocal(); // v1.56 — objetivos reach con la posición autoridad
    this.syncHud();
  }

  /**
   * v1.57 — getter de pose fresca (< 4 s) para el director de actores. Caduca y limpia:
   * si el vecino remoto deja de enviar (pestaña en segundo plano, salida), su avatar vuelve
   * al ruteo del sim de siempre en vez de quedarse congelado en mitad de la calle.
   */
  private remotePoseOf(id: string): { x: number; z: number; floor: number } | null {
    const p = this.remotePoses.get(id);
    if (!p) return null;
    if (performance.now() - p.at > 4000) {
      this.remotePoses.delete(id);
      return null;
    }
    return p;
  }

  /**
   * Corrige desvíos del avatar local respecto al mundo del servidor (autoridad).
   * v1.57 — SOLO contradicciones DURAS: estar DENTRO de un bloque que el servidor no
   * reconoce (puerta rechazada, rejoin tras caída). Nada de correcciones por planta
   * fraccionaria (escaleras/ascensor en curso: `climbing`) ni por pasear por la calle
   * (mode 'outside': el sim solo conoce el portal) — corregir eso era el bug del vecino:
   * subir por las escaleras devolvía al portal de entrada.
   */
  private reconcile(): void {
    if (!this.logic || !this.world || !this.net) return;
    // v1.64 — cadena de moves en vuelo (sync con ruta legal): el espejo va por los saltos
    // del grafo y cualquier contradicción intermedia se resuelve sola al aterrizar; una
    // corrección ahora devolvería al invitado a mitad de la ruta (bug «escalera→entrada»).
    if (this.logic.routePending()) return;
    const me = this.world.residents[this.actorId()];
    if (!me) return;
    const pos = this.logic.position();
    if (pos.climbing) return; // escalera/ascensor en curso: planta fraccionaria; el aterrizaje manda
    if (pos.mode === 'outside') return; // la calle es libre: la ubicación del sim se queda en el portal
    const locBlock = me.location ? this.world.blocks[me.location] : null;
    if (!locBlock) {
      if (pos.mode === 'inside') this.logic.forceLocation(null);
      return;
    }
    // Contradicción dura: digo estar DENTRO de un bloque distinto del que dice el servidor.
    if (pos.mode === 'inside' && pos.insideBlock && pos.insideBlock !== locBlock.id) {
      this.logic.forceLocation(locBlock.id);
    }
  }

  /** Siguiente frase del teléfono; al colgar responde la llamada en el sim y saca la siguiente de la cola. */
  phoneNext(): void {
    if (this.phoneLine < this.phoneLines.length - 1) {
      this.phoneLine += 1;
      this.showPhoneLine();
      return;
    }
    const mission = this.phoneMission;
    this.phoneLines = [];
    this.phoneMission = '';
    useGameStore.getState().setPhone(null);
    this.actors?.director.setGesture(this.actorId(), null); // cuelgas: se suelta el teléfono
    if (this.world && mission) {
      this.sendCommand({ type: 'answer_call', mission });
    }
    const next = this.phoneQueue.shift();
    if (next) this.openPhone(next.mission, next.dialogId);
  }

  choose(choiceId: string): void {
    const state = useGameStore.getState();
    const mission = state.choices?.mission;
    state.setChoices(null);
    this.actors?.director.setGesture(this.actorId(), null); // decisión tomada: se deja de hablar
    if (!this.world || !mission) return;
    this.sendCommand({ type: 'choose', mission, choice: choiceId });
  }

  juntaVote(vote: 'yes' | 'no'): void {
    useGameStore.getState().setJunta(null);
    this.actors?.director.setGesture(this.actorId(), null);
    if (!this.world) return;
    this.sendCommand({ type: 'junta_vote', vote });
  }

  finaleClose(): void {
    useGameStore.getState().setFinale(null);
  }

  // ───────────────────────── Editor de interiores y minijuegos ─────────────────────────

  placeFurniture(block: string, room: string, slot: string, item: string): void {
    if (!this.world) return;
    if (this.net) {
      this.net.command({ type: 'place_furniture', block, room, slot, item });
      return;
    }
    const r = dispatch(this.world, this.content, { type: 'place_furniture', block, room, slot, item });
    if (!r.ok) this.furnitureFail(r.reason);
    this.pump();
  }

  removeFurniture(block: string, room: string, slot: string): void {
    if (!this.world) return;
    if (this.net) {
      this.net.command({ type: 'remove_furniture', block, room, slot });
      return;
    }
    const r = dispatch(this.world, this.content, { type: 'remove_furniture', block, room, slot });
    if (!r.ok) this.furnitureFail(r.reason);
    this.pump();
  }

  renovateRoom(block: string, room: string): void {
    if (!this.world) return;
    if (this.net) {
      this.net.command({ type: 'renovate_room', block, room });
      return;
    }
    const r = dispatch(this.world, this.content, { type: 'renovate_room', block, room });
    if (!r.ok) this.furnitureFail(r.reason);
    this.pump();
  }

  completeMinigame(id: string, success: boolean): void {
    if (!this.world) return;
    // v1.55 — DUELO DE COMUNIDAD: el resultado viaja PRIMERO (el servidor registra el éxito
    // y así autoriza la marca); después el cronometraje (solo puntúa mejorar el récord
    // personal; criterio del catálogo). El orden importa: mismo socket, entrega en cola.
    this.sendCommand({ type: 'complete_minigame', id, success });
    if (success && this.net && this.minigameStartedAt > 0) {
      const cfg = this.content.rules.multiplayer?.score?.minigames?.[id];
      if (cfg) this.net.minigameTime(id, (performance.now() - this.minigameStartedAt) / 1000);
    }
    this.minigameStartedAt = 0;
    // v1.56 — MISIÓN COOPERATIVA: si el objetivo de mi rol era ESTE minijuego, marco progreso.
    if (success && this.net) this.coopProgressMinigame(id);
    // v1.48 — REARME DEL CUADRO DE FUSIBLES: el minijuego restaura el param de luz del
    // pasillo (sim, effects del catálogo) y aquí se cancela el apagón del cerebro — los
    // pasillos, escaleras y locales recuperan su luz al instante. Sin arreglo, sin luz.
    if (id === 'mg_fusibles' && success) this.ecosystem?.endBlackout();
    this.pump();
  }

  private furnitureFail(reason: string | undefined): void {
    const text = this.content.rules.furniture.errors[reason ?? ''] ?? 'Gestión inmobiliaria rechazada sin explicación. Como en la junta.';
    useGameStore.getState().pushToast(text, 'bad');
  }

  async save(): Promise<void> {
    if (!this.world) return;
    const store = useGameStore.getState();
    if (this.net) {
      store.pushToast(this.content.rules.multiplayer.texts.remoteSaveDisabled, 'info');
      return;
    }
    store.setSaveState('saving');
    drainEvents(this.world); // la cola de eventos no entra en el guardado
    // v1.77 — export estático: sin /api/save → localStorage (misma forma JSON {state}).
    if (STATIC_EXPORT) {
      try {
        localStorage.setItem(SAVE_LOCAL_KEY, JSON.stringify({ state: this.world }));
        store.setSaveState('saved', new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
        store.pushToast(translate(store.lang, 'ev.saved'), 'good');
      } catch {
        store.setSaveState('error');
        store.pushToast(translate(store.lang, 'ev.saveFailed'), 'bad');
      }
      return;
    }
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: 'auto', state: this.world }),
      });
      if (!res.ok) throw new Error(String(res.status));
      store.setSaveState('saved', new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
      store.pushToast(translate(store.lang, 'ev.saved'), 'good');
    } catch {
      store.setSaveState('error');
      store.pushToast(translate(store.lang, 'ev.saveFailed'), 'bad');
    }
  }

  async load(): Promise<void> {
    const store = useGameStore.getState();
    if (this.net) {
      store.pushToast(this.content.rules.multiplayer.texts.remoteSaveDisabled, 'info');
      return;
    }
    try {
      // v1.77 — export estático: lee el mismo localStorage que escribió save().
      if (STATIC_EXPORT) {
        const raw = localStorage.getItem(SAVE_LOCAL_KEY);
        const local = raw ? (JSON.parse(raw) as { state?: unknown }) : null;
        if (!local?.state || typeof local.state !== 'object') {
          store.pushToast(translate(store.lang, 'ev.noSave'), 'info');
          return;
        }
        if (!this._content) {
          store.pushToast(translate(store.lang, 'ev.contentLoading'), 'info');
          return;
        }
        await this.restart(local.state as World);
        store.pushToast(translate(store.lang, 'ev.loaded'), 'good');
        return;
      }
      const res = await fetch('/api/save?slot=auto');
      const json = (await res.json()) as { state?: unknown };
      if (!json.state || typeof json.state !== 'object') {
        store.pushToast(translate(store.lang, 'ev.noSave'), 'info');
        return;
      }
      if (!this._content) {
        store.pushToast(translate(store.lang, 'ev.contentLoading'), 'info');
        return;
      }
      await this.restart(json.state as World);
      store.pushToast(translate(store.lang, 'ev.loaded'), 'good');
    } catch {
      store.pushToast(translate(store.lang, 'ev.loadFailed'), 'bad');
    }
  }

  // ───────────────────────── Ciclo de vida del mundo ─────────────────────────

  /** Escenario activo: parámetro ?scenario= (QA/E2E) o el que marca el catálogo. */
  private activeScenarioId(): string {
    try {
      return new URLSearchParams(window.location.search).get('scenario') ?? this.content.rules.startScenario;
    } catch {
      return this.content.rules.startScenario;
    }
  }

  /** (Re)crea el mundo y la escena. Con `state` restaura una partida guardada. */
  private async restart(state?: World): Promise<void> {
    if (!this.engine || !this.canvas || !this._content) return;
    // Ninguna cutscene sobrevive a un cambio de mundo: cola fuera y teatro desmontado.
    this.cutsceneQueue = [];
    this.cutscenePlayer?.abort();
    const { Color3, Color4, DirectionalLight, HemisphericLight, ImageProcessingConfiguration, PointLight, Scene, UniversalCamera, Vector3 } = B();
    const view = this.content.rules.view;
    useGameStore.getState().resetUi();

    this.world = state ?? createWorld(this.content, this.activeScenarioId());
    // v1.39 — IDIOMA DEL CONTENIDO: el overlay ES→EN se aplica ANTES de expandir tokens
    // estructurales, para que las traducciones también las reciban.
    await applyContentLanguageAsync(this.content, useGameStore.getState().lang);
    // v1.34 — TEXTOS 100% DATA-DRIVEN: los catálogos narrativos admiten tokens estructurales
    // ({plantas}, {viviendas}, {blk:id}) que se expanden UNA vez con el mundo real — un
    // título de misión dice la vivienda que existe, un cartel dice las plantas que hay.
    applyStaticTokens(this.content, this.world);
    this.scenarioOverrides = this.content.scenarios[this.world.scenarioId ?? '']?.minigameOverrides ?? {};
    // Guardados antiguos sin `entry`: la entrada es la zona común de planta baja.
    if (!this.world.entry) {
      this.world.entry = Object.values(this.world.blocks).find((b) => b.cell.floor === 0 && b.kind !== 'dwelling')?.id ?? Object.keys(this.world.blocks)[0]!;
    }
    // Migración de estancias de guardados v0.1: params y ranuras de muebles según catálogo.
    for (const b of Object.values(this.world.blocks)) migrateRooms(this.content, b.rooms);
    this.logic = this.makeLogic(this.myResidentId ?? undefined);

    this.scene?.dispose();
    this.scene = new Scene(this.engine);
    // v1.42 — ASA DE QA (?qaengine=1): en headless el NullEngine no pinta píxeles, así que
    // la verificación visual se hace GEOMÉTRICA: el QA lee mallas/transforms/estado del
    // mundo desde la consola. Solo existe con el parámetro qaengine; cero impacto en juego.
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('qaengine')) {
      (window as unknown as { __vecinosQa?: unknown }).__vecinosQa = {
        getScene: () => this.scene,
        getWorld: () => this.world,
        getContent: () => this._content,
        // v1.45 — QA de puertas: conducir al jugador (teleport + input táctil) desde el QA.
        getLogic: () => this.logic,
        // v1.52 — QA del apagón/cerebro: el director del ecosistema (late binding: se crea
        // después del arranque; el getter perezoso siempre da el vivo).
        getEcosystem: () => this.ecosystem,
        // v1.52 — QA de flujos completos (timbre/fusibles/flecha): el controlador entero.
        getController: () => this,
        // v1.56 — QA del canal de voz: estados de conexión de la malla de peers.
        getVoicePeers: () => this.voice?.peerStates() ?? {},
        getVoiceState: () => ({ active: this.voice !== null, synthetic: this.voice?.isSynthetic() ?? false, muted: this.voice?.isMuted() ?? false }),
        // v1.66 — QA del banner de máxima prioridad: disparar avisos y leer la cola desde la consola.
        getStore: () => useGameStore,
        setTouch: (v: { up?: boolean; down?: boolean; left?: boolean; right?: boolean }) => this.setTouchInput(v),
        // v1.46 — QA de locomoción determinista: despeja modales y CONGELA el bucle
        // (paused) para conducir logic.update(dt, input) a mano desde la consola sin
        // interferencias del frame loop.
        qaHold: () => {
          useGameStore.setState({ paused: true, pauseMenuOpen: false, cutscene: null, phone: null, choices: null, junta: null, minigame: null, finale: null, elevatorPanel: null });
        },
        qaResume: () => {
          useGameStore.setState({ paused: false, pauseMenuOpen: false, cutscene: null, phone: null, choices: null, junta: null, minigame: null, finale: null, elevatorPanel: null });
        },
      };
    }
    this.flashlight = null; // v1.40 — la linterna nueva nace con la escena nueva
    this.scene.clearColor = new Color4(view.sky.r, view.sky.g, view.sky.b, 1);
    // Pase de calidad FPS (v1.22): el puntero no necesita picking por movimiento (la
    // interacción va por zonas/teclado) y los materiales congelables del decorado lo
    // hacen en exterior.ts. Cero impacto visual, menos trabajo por frame.
    this.scene.skipPointerMovePicking = true;
    // v1.71 — PASE GLOBAL DE IMAGEN (Fase V): tone mapping fílmico + exposición/contraste
    // del catálogo (rules.view.imageProcessing). scene.imageProcessingConfiguration es la
    // UNA verdad: todos los StandardMaterial la ejecutan al final de su fragment (emisivos
    // incluidos) y el GlowLayer compone encima. En NullEngine la config es inerte: cero
    // impacto en el QA geométrico. undefined en el catálogo = pase apagado (clásico).
    const ip = view.imageProcessing;
    if (ip) {
      const cfg = this.scene.imageProcessingConfiguration;
      if (ip.toneMapping === 'none') {
        cfg.toneMappingEnabled = false;
      } else {
        cfg.toneMappingEnabled = true;
        cfg.toneMappingType = ip.toneMapping === 'aces' ? ImageProcessingConfiguration.TONEMAPPING_ACES : ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
      }
      cfg.exposure = ip.exposure;
      cfg.contrast = ip.contrast;
    }
    const hemi = new HemisphericLight('ambient', new Vector3(...view.ambient.dir), this.scene);
    hemi.intensity = view.ambient.intensity;
    // v1.29 — LUZ DE REBOTEO (catálogo): el groundColor de la hemisférica levanta las caras
    // que miran ABAJO (techos de los interiores, forjados) — antes negro puro, ahora un
    // gris cálido que se lee como techo en sombra. Data-driven (view.ambient.ground).
    if (view.ambient.ground) hemi.groundColor = Color3.FromHexString(view.ambient.ground);
    // v1.40 — LINTERNA (apagón): PointLight cálida que sigue al jugador; APAGADA por
    // defecto y encendida solo mientras dura el apagón del ecosistema. Su radio corto
    // (catálogo) hace el resto: solo vé lo que tienes delante en tu planta.
    {
      const fl = view.flashlight;
      if (fl) {
        const light = new PointLight('linterna', new Vector3(0, fl.height, 0), this.scene);
        light.diffuse = Color3.FromHexString(fl.color);
        light.specular = Color3.FromHexString(fl.color).scale(0.35);
        light.intensity = 0;
        light.range = fl.range;
        this.flashlight = {
          light,
          update: (pos) => {
            light.position.set(pos.x, pos.y + fl.height, pos.z);
            const on = this.ecosystem?.isBlackout() === true;
            light.intensity = on ? fl.intensity : 0;
          },
          dispose: () => light.dispose(),
        };
      }
    }
    const dirLight = new DirectionalLight('sun', new Vector3(...view.sun.dir), this.scene);
    dirLight.intensity = view.sun.intensity;
    this.sunLight = dirLight;
    // v1.32 — SOMBRAS DE VERDAD (catálogo): un ShadowGenerator sobre el sol; quién proyecta
    // y quién recibe lo deciden los patrones de nombre del rules.json. Los rigs glTF que
    // llegan tarde y los vehículos nuevos los caza el refresco periódico del pase.
    // v1.38 — la creación pasa por la política del optimizador (cadencia/ausencia vigentes).
    this.shadows?.dispose();
    this.shadows = null;
    this.applyShadowPolicy();

    this.building = createBuilding(this.scene, this.world, this.content);
    // v1.21: los rects de obstáculos del interior del trastero (estanterías/trastos que pinta
    // building) alimentan la colisión del movimiento libre dentro de la celda — UNA verdad.
    this.logic.setCellObstacles(this.building.cellObstacles());
    // v1.37 — los SÓLIDOS de los locales (lavadoras de la lavandería) y la posición del
    // ATRIL del tablón salen del mismo building que los pinta: una sola verdad.
    this.logic.setBlockObstacles(this.building.walkObstacles());
    this.logic.setNoticeboardSpot(this.building.noticeboardSpot());
    // v1.47 — sólidos del pasillo de planta 0 (el atril del tablón no se atraviesa).
    this.logic.setCorridorObstacles(this.building.corridorObstacles());
    // v1.48 — el CUADRO DE FUSIBLES del garaje sale del mismo building que lo pinta.
    this.logic.setFuseBoxSpot(this.building.fuseBoxSpot());
    this.elevators = createElevators(this.scene, this.world, this.content);
    this.actors = createActors(this.scene, this.world, this.content, this.elevators);
    // v1.37 — los vecinos tampoco atraviesan las lavadoras: los tramos de su locomoción se
    // resuelven contra los mismos rects que el jugador.
    this.actors.director?.setObstacles(this.building.walkObstacles().flatMap((o) => o.rects));
    // Fondo urbano (v1.20): cielo dinámico por hora + fachadas parallax; la luz del catálogo
    // evoluciona con el sol (el edificio vive la misma hora que el cielo).
    this.backdrop?.dispose();
    this.backdrop = createBackdrop(this.scene, this.world, this.content, { hemi, dir: dirLight });
    // V1.28 — BLOOM/GLOW (catálogo): los emisivos ganan halo suave. v1.38: la capa la MONTA
    // el optimizador de rendimiento (setupGlow, al final del arranque) según el nivel
    // vigente; aquí solo garantizamos que la escena nueva no herede capas huérfanas.
    this.teardownGlow();
    // Calle (v1.20): aceras, carretera y jardines con sus props; las farolas leen la luz
    // de día del fondo para encenderse al anochecer.
    this.exterior?.dispose();
    this.exterior = createExterior(this.scene, this.world, this.content, this.backdrop);
    // v1.59 — el MOBILIARIO URBANO no se atraviesa: exterior registra sus rects (farolas,
    // bancos, papeleras, parque) y la lógica del paseo los usa de sólidos. El atril del
    // tablón ya llevaba el suyo (v1.47, corridorSolids).
    this.logic.setOutdoorObstacles(this.exterior.obstacles());
    // La calle vive (v1.22): tráfico y viandantes — solo presentación, solo vista "edificio".
    // (Las manifestaciones se crean más abajo, tras los bocadillos, para poder comentarlas.)
    // v1.31: los vehículos leen la luz de día del cielo para encender y apagar los faros.
    this.traffic?.dispose();
    this.traffic = createTraffic(this.scene, this.world, this.content, () => this.backdrop?.daylight ?? 1, (x, kind) => {
      // v1.41 — CORTESÍA AL VOLANTE: cuando un coche frena en seco o no puede frenar en el
      // paso, el peatón (paseo vecinal) es el protagonista del cómic: susto o accidente cómico.
      this.paseo?.onTrafficIncident(x, kind);
    });
    // v1.32 — TEATRO DE EMERGENCIAS: la ambulancia (rig del catálogo) que recoge heridos
    // de las peleas de acera. Se crea ANTES que los viandantes (ellos la llaman).
    this.ambulance?.dispose();
    this.ambulance = createAmbulanceTheater(this.scene, this.content, this.traffic);
    this.pedestrians?.dispose();
    this.pedestrians = createPedestrians(this.scene, this.world, this.content, this.ambulance);
    // Ecosistema del edificio (v1.14): cerebro data-driven + teatro de extras. Se recrea con
    // cada mundo (referencia al World vivo) y sigue la posición del jugador para las luces.
    this.ecosystem?.dispose();
    this.ecosystem = createEcosystem(this.scene, this.world, this.content, () => this.logic!.position());
    // Sonda de QA (SOLO dev): escena y controlador accesibles para el E2E automatizado.
    // En producción no se expone nada (la partida queda encapsulada igual que siempre).
    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { __vecinosQA?: { scene: unknown; controller: unknown; elevators: unknown; ecosystem: unknown; toast: (t: string, tone?: 'info' | 'good' | 'bad') => void } }).__vecinosQA = {
        scene: this.scene,
        controller: this,
        elevators: this.elevators,
        ecosystem: this.ecosystem,
        toast: (t, tone) => useGameStore.getState().pushToast(t, tone), // v1.29: QA de los post-its
      };
    }
    // Sonda E2E de la calle y las charlas (v1.20, SOLO dev): acceso indirecto a los directores.
    (window as unknown as { __vecinos20?: unknown }).__vecinos20 = {
      chats: () => this.chats,
      exterior: () => this.exterior,
      backdrop: () => this.backdrop,
    };
    // Sonda E2E de la calle viva (v1.22, SOLO dev).
    (window as unknown as { __vecinos22?: unknown }).__vecinos22 = {
      traffic: () => this.traffic,
      pedestrians: () => this.pedestrians,
      streetlife: () => this.streetlife,
      voices: () => this.voices,
      paseo: () => this.paseo,
    };
    // Bocadillos de expresión (v1.10): capa DOM sobre el canvas, recreada con el mundo
    // (referencia al World vivo). Sin emotes.json en el catálogo, director nulo sin capa.
    this.bubbles?.dispose();
    const stage = this.canvas?.parentElement;
    this.bubbles = stage && this.actors ? createBubbles(stage, this.scene, this.engine, this.world, this.content, this.actors.director) : null;
    // Charlas de cruce (v1.20): después de actores y bocadillos — son sus dos clientes.
    this.chats?.dispose();
    this.chats = createChats(this.world, this.content, this.actors!.director, this.bubbles);
    // Voces de proximidad (v1.22): después de actores y bocadillos — son sus clientes.
    this.voices?.dispose();
    this.voices = createVoices(this.world, this.content, this.actors!.director, this.bubbles);
    // streetlife necesita los bocadillos para los comentarios: reconstrúyelo con ellos.
    this.streetlife?.dispose();
    this.streetlife = createStreetlife(this.scene, this.world, this.content, this.actors?.director ?? null, this.bubbles);
    // v1.37 — PASEO VECINAL: después de actores/bocadillos/tráfico (son sus tres clientes).
    // Algunos vecinos salen a la calle, cruzan por el paso de peatones mirando a ambos lados
    // y van al parque de calistenia del jardín de enfrente.
    this.paseo?.dispose();
    this.paseo = createPaseo(this.world, this.content, this.actors?.director ?? null, this.bubbles, this.traffic, () => {
      const cm = useGameStore.getState().camMode;
      return cm === 'edificio' || cm === 'fachada' || cm === 'planta';
    }, () => this.exterior?.benches() ?? []);
    // v1.42 — spots exteriores del JUGADOR: bancos del decorado (sentarse a contemplar el
    // edificio) y el punto de calistenia del jardín de enfrente (catálogo view.outside).
    this.logic?.setOutdoorSpots(
      this.exterior?.benches() ?? [],
      view.outside ? { x: view.outside.exercise.x, z: view.outside.exercise.z } : null,
    );
    // v1.39 — VECINOS COMO PERSONAJES: reacciones ambientales con carácter (bocadillos).
    this.residents?.dispose();
    this.residents = this.actors ? createResidents(this.world, this.content, this.actors.director, this.bubbles) : null;
    const blocks = Object.values(this.world.blocks);
    // El cubo de escalera (v1.4) sobresale spanW−1 celdas por la derecha del edificio:
    // el encuadre lo incluye para que la torre no se corte en cámara.
    const hasStairs = blocks.some((b) => this.content.blocks[b.defId]?.features?.stairs === true);
    const cols = Math.max(...blocks.map((b) => b.cell.col + b.size.w)) + (hasStairs ? this.content.rules.view.stairs.spanW - 1 : 0);
    this.rig = new CameraRig(
      new UniversalCamera('cam', new Vector3(0, 0, -30), this.scene),
      this.engine,
      cols,
      Math.max(...blocks.map((b) => b.cell.floor)) + 1,
      view.cellW,
      view.cellH,
    );
    // v1.36 — alejamiento de la cámara Estancia desde el catálogo (rules.view.camera):
    // factores de encuadre + margen de borde para el extremo del pasillo de planta 0.
    const camTuning = view.camera;
    if (camTuning) {
      this.rig.tuning = {
        estFloorH: camTuning.estanciaFloorH,
        estWidthW: camTuning.estanciaWidthW,
        estMargin: camTuning.estanciaEdgeMargin,
        fachadaFactor: camTuning.fachadaViewHFactor ?? 1.32,
        spyFactor: camTuning.spyViewHFactor ?? 1,
      };
    }
    // v1.20: plano frontal y calado del bloque principal — la cámara encuadra los bloques
    // traseros (apilamiento 3D) a la misma distancia que una estancia exterior.
    this.rig.metric = { frontZ: view.roomZ - view.commonDepth / 2, depth: view.depth };
    // Re-sincronización de vista (v0.6-b): la cámara sigue la posición del mundo (restaurado o
    // nuevo), no la preferencia anterior. Dentro de una vivienda → estancia; en pasillo, la
    // preferencia salvo que fuera 'estancia' (ahí estás en el pasillo, no en una estancia).
    const pos = this.logic.position();
    const store = useGameStore.getState();
    const wanted: CamMode = pos.mode === 'inside' ? 'estancia' : store.camMode === 'estancia' || store.camMode === 'espia' ? 'planta' : store.camMode;
    this.rig.mode = wanted;
    store.setCamMode(wanted);
    this.spyResidentId = null; // v1.65 — el (re)cargo de mundo limpia al espiado
    if (store.spyTargetId !== null) store.setSpyTargetId(null);
    this.camReturn = null; // v1.47 — el (re)cargo de mundo limpia la cámara previa recordada

    this.clockAcc = 0;
    this.keys.clear();
    this.phoneLines = [];
    this.phoneMission = '';
    this.phoneQueue = [];
    this.lastHudSync = 0;

    // Re-llamada (Fase F): si la partida montada tenía pasos de teléfono pendientes, vuelven a
    // sonar. La cola de openPhone ordena el resto sin que ninguna llamada se pierda.
    if (this.world) {
      for (const m of this.world.missions) {
        if (m.state !== 'active') continue;
        const step = this.content.missions[m.id]?.steps[m.step];
        if (step?.type === 'phone_call') this.openPhone(m.id, step.dialog);
      }
    }

    this.pump();
    // Logros (v1.17): primera foto del catálogo para el panel (y desbloqueos de la partida restaurada).
    this.syncAchievements();
    // Campaña (v1.18): primer estado del mandato (sobrevive a Cargar vía localStorage).
    syncCampaign(this.world!, this.content);
    // v1.39 — proyecto del edificio: foto inicial (sin celebrar niveles ya alcanzados al cargar).
    this.projectLevelSeen = this.content.project ? evaluateProject(this.content.project, projectSnapshot(this.world!, this.actorId())).level : 0;
    this.syncProject(true);
    this.syncResidentsUi();
    this.tutorial.refresh();
    // v1.38 — el optimizador se reata a la escena nueva y re-aplica su nivel vigente
    // (monta el glow si toca, re-espacia sombras, re-escala): un solo punto de verdad.
    this.perf?.bind();
  }

  private onResize = (): void => {
    // v1.40 — resize con tamaño cero (rotación móvil, pestaña oculta): evita un buffer de
    // dibujo de 0×0 que deja el lienzo negro hasta el próximo resize de verdad.
    if (!this.canvas || this.canvas.clientWidth === 0 || this.canvas.clientHeight === 0) return;
    this.engine?.resize();
  };

  /** v1.40 — contexto gráfico perdido: overlay de recarga (solo marca; idempotente). */
  private onContextLost = (): void => {
    if (useGameStore.getState().engineLost) return;
    console.warn('VECINOS: contexto gráfico perdido (el navegador recuperará o toca recargar)');
    useGameStore.getState().setEngineLost();
  };

  // ───────────────────────── Bucle de render ─────────────────────────

  private frame = (): void => {
    if (!this.engine || !this.scene || !this.world || !this.logic || !this.building || !this.actors || !this.rig || !this.elevators) return;
    const dt = Math.min(0.1, this.engine.getDeltaTime() / 1000);
    // v1.38 — el optimizador muestrea los FPS reales (ventanas internas de 1.2 s con
    // histéresis): barato — un sumo y un if por fotograma.
    this.perf?.sample();
    const store = useGameStore.getState();
    const frozen = selectWorldFrozen(store) || store.paused;

    let ticked = false;
    if (!frozen) {
      this.logic.update(dt, this.readInput());
      // v1.40 — acciones automáticas (entrar/salir de TU vivienda sin E): la cámara sigue.
      // v1.42 — la calle: portal sin E, banco y calistenia también llegan por aquí.
      for (const ar of this.logic.drainAuto()) {
        if (ar.type === 'entered') this.enterInteriorCam();
        else if (ar.type === 'exited') this.exitInteriorCam();
        else if (ar.type === 'portalOut') {
          this.exitInteriorCam();
          this.sayOutdoorLine('out');
        } else if (ar.type === 'portalIn') {
          this.enterInteriorCam();
          this.sayOutdoorLine('into');
        } else if (ar.type === 'stand') {
          this.actors?.director?.standUp(this.actorId());
          this.actors?.director?.setGesture(this.actorId(), null);
        } else if (ar.type === 'exerciseEnd') {
          this.actors?.director?.setGesture(this.actorId(), null);
        } else if (ar.type === 'frontBlocked') {
          // v1.48 — ENTRADA FRONTAL CERRADA del portal: flecha animada hacia la esquina
          // (HUD) + toast con cadencia. La entrada de verdad es la LATERAL.
          const se = this.content.rules.view.sideEntry;
          const nowS = performance.now() / 1000;
          useGameStore.getState().setSideHint(se?.hint ?? '→ Gira la esquina: se entra por el lateral');
          this.sideHintUntil = nowS + (se?.hintSecs ?? 2.8);
          if (nowS - this.lastFrontToastAt > 20) {
            this.lastFrontToastAt = nowS;
            const s = useGameStore.getState();
            s.pushToast(se?.toast ?? '🚪 La entrada frontal no es de acceso.', 'info');
            playSound('door_locked');
          }
        }
      }
      // Ascensor (v1.5): el director mueve cabinas y puertas; el jugador llama con W/S en el
      // núcleo y su escalada EXTERNA la gobierna la cabina (espera → embarco → viaje → salida).
      this.elevators.update(dt);
      const climb = this.logic.climbInfo();
      if (climb) {
        if (!this.logic.externalRequested) {
          const zone = this.logic.zone();
          this.elevators.requestRide(this.actorId(), zone.cell.col, climb.from, climb.to);
          this.logic.externalRequested = true;
        }
        const st = this.elevators.status(this.actorId());
        if (!st) {
          this.logic.finishClimbAtNearest(); // fuera de servicio: aterriza en la planta más cercana (sin teletransporte)
          this.logic.externalRequested = false;
          this.playerBoardT = 0;
        } else {
          this.logic.setClimbProgress(st.phase === 'riding' ? st.progress : 0);
          const inside = st.phase === 'boarding' || st.phase === 'riding';
          this.logic.setClimbZ(inside ? this.content.rules.view.roomZ - this.content.rules.view.commonDepth / 2 + this.content.rules.view.elevator.rideZ : null);
          // El jugador "da un paso" dentro de la cabina un instante tras abrirse la puerta
          // (el zOverride ya lo acerca); avisar al director para que cierre y viaje.
          if (st.phase === 'boarding') {
            this.playerBoardT += dt;
            if (this.playerBoardT > 1.0) this.elevators.notifyBoarded(this.actorId());
          } else {
            this.playerBoardT = 0;
          }
          if (st.phase === 'exiting') {
            this.logic.finishClimb();
            this.logic.externalRequested = false;
          }
        }
      } else if (this.logic.externalRequested) {
        this.logic.externalRequested = false;
      }
      // En remoto el servidor es la autoridad del reloj: nada de ticks locales.
      if (!this.net) {
        this.clockAcc += dt * store.speed;
        let guard = 0;
        while (this.clockAcc >= 1 && guard < 60) {
          tick(this.world, this.content);
          this.clockAcc -= 1;
          ticked = true;
          guard += 1;
        }
      }
    }

    if (this.world.events.length > 0) this.handleEvents();
    if (ticked) this.paintBuilding();

    const now = performance.now();
    if (now - this.lastHudSync > 200) {
      this.lastHudSync = now;
      useGameStore.getState().setFps(Math.round(this.engine.getFps()));
      this.syncHud();
    }

    // Logros (v1.17): evaluación perezosa a cadencia (~cada 2 s de tiempo real).
    // El evaluador es puro y solo lee el mundo, así que da igual si hay modal o pausa.
    this.achAcc += dt;
    if (this.achAcc >= 2) {
      this.achAcc = 0;
      this.syncAchievements();
      // Campaña (v1.18): el día de mandato avanza con el reloj — misma cadencia.
      syncCampaign(this.world!, this.content);
      // v1.39 — proyecto del edificio: progreso y celebración de niveles (misma cadencia).
      this.syncProject(false);
      // v1.39 — vecinos como personajes: foto del vecindario para la pestaña «Vecinos».
      this.syncResidentsUi();
    }

    // v1.39 — MÚSICA PROCEDURAL: el contexto lo manda la hora del sim, la capa de lluvia
    // el clima y el ducking la pausa/los modales. Los modales no paran el ambiente (como el cielo).
    const frozenMusic = selectWorldFrozen(store) || store.paused;
    this.music?.update(this.world.clock.minute, this.world.weather.state, frozenMusic);
    // v1.39 — tutorial «muévete»: distancia real caminada por el jugador.
    if (!frozen && !this.logic.position().climbing) {
      const p = this.logic.position();
      if (this.lastMovePos) {
        const d = Math.hypot(p.x - this.lastMovePos.x, p.z - this.lastMovePos.z);
        if (d > 0.001 && d < 1) this.tutorial.moved(d);
      }
      this.lastMovePos = { x: p.x, z: p.z };
    }
    // v1.39 — vecinos como personajes: comentarios ambientales (como las voces, sin red).
    if (!this.net) this.residents?.update(dt);

    const pos = this.logic.position();
    // v1.57 — MI pose a la sala (10 Hz): los demás me ven andar de verdad. La z efectiva es
    // la del recorrido en el cubo de escalera (pathZ) cuando toca, igual que el actor local.
    const nowMs = performance.now();
    if (this.net && nowMs - this.lastPoseSentAt > 100) {
      this.lastPoseSentAt = nowMs;
      this.net.pose({
        x: Math.round(pos.x * 100) / 100,
        z: Math.round((pos.pathZ ?? pos.z) * 100) / 100,
        floor: Math.round(pos.floor * 100) / 100,
      });
    }
    this.actors.update(dt, pos, this.actorId(), this.net ? (id) => this.remotePoseOf(id) : undefined);
    // v1.42 — fundido del cuerpo al cruzar el portal (teatro; solo cuando cambia).
    if (pos.fade !== this.lastPlayerFade) {
      this.lastPlayerFade = pos.fade;
      this.actors.director?.setFade(this.actorId(), pos.fade);
    }
    // v1.32 — SOMBRAS: refresco perezoso de participantes (rigs glTF tardíos, pool de
    // tráfico, celadores…): escaneo barato cada 2 s contra un Set de vistas.
    this.shadowRefreshT -= dt;
    if (this.shadows && this.shadowRefreshT <= 0) {
      this.shadowRefreshT = 2;
      this.shadows.refresh();
      // v1.38 — REGALO SIEMPRE ACTIVO del pase de optimización: con el sol apagado
      // (noche o cielo muy cerrado) las sombras ni se ven, y como el sol de la escena
      // NO gira, el mapa de profundidad congelado es idéntico píxel a píxel — nos
      // ahorramos un pase entero de la escena por fotograma durante toda la noche.
      const frozen = (this.backdrop?.daylight ?? 1) < 0.08;
      if (frozen !== this.shadowsFrozen) {
        this.shadowsFrozen = frozen;
        this.applyShadowPolicy();
      }
    }
    // Fondo urbano (v1.20): el cielo, el sol y las nubes siguen la hora del sim; las farolas
    // de la calle leen la luz de día resultante. Los modales no paran el ambiente (solo el reloj).
    // v1.48 — TORMENTA: los rayos solo se dibujan en cámaras exteriores (edificio/fachada);
    // el fogonazo y el trueno valen en toda la escena.
    this.backdrop?.update(dt, { bolts: store.camMode === 'edificio' || store.camMode === 'fachada' });
    this.exterior?.update(dt);
    // v1.48 — la flecha del lateral se va sola al acabar su aviso.
    if (store.sideHint !== null && performance.now() / 1000 >= this.sideHintUntil) store.setSideHint(null);
    // v1.21/v1.22: el MOBILIARIO de la calle, los vehículos, los viandantes y las
    // manifestaciones viven en las vistas "edificio" y "planta" (v1.23: la planta baja
    // ve pasar la acera en el encuadre — no perderse la vidilla de la calle); en
    // estancia se apagan (menos carga, y no estorban la vista de la estancia).
    // v1.41 — la FACHADA (tecla 0) también es vista de calle: el decorado exterior (coches,
    // viandantes, paseo, taxi) vive y se ve tras la fachada acristalada del bloque.
    // v1.49 — DATA-DRIVEN (rules.view.streetLife.cameras): el vecino pidió ver la calle
    // (bancos, parque de calistenia, coches, viandantes) DESDE LA CÁMARA DE ESTANCIA —
    // el catálogo manda; sin regla, el comportamiento de siempre.
    const streetCameras = this.content.rules.view.streetLife?.cameras ?? ['edificio', 'fachada', 'planta', 'espia'];
    const streetView = streetCameras.includes(store.camMode);
    // v1.41 — la vista FACHADA cierra el edificio entero (cortina acristalada en building).
    this.building?.setFachadaView(store.camMode === 'fachada');
    this.exterior?.setPropsVisible(streetView);
    this.traffic?.setVisible(streetView);
    this.ambulance?.setVisible(streetView);
    this.pedestrians?.setVisible(streetView);
    this.streetlife?.setVisible(streetView);
    if (streetView) {
      this.traffic?.update(dt);
      this.ambulance?.update(dt);
      this.pedestrians?.update(dt);
      this.streetlife?.update(dt);
      this.paseo?.update(dt);
      // v1.42 — el JUGADOR también es peatón: si pisa la calzada (solo hay paso legal en
      // el paso de cebra), los coches frenan por él igual que por cualquier vecino.
      const laneZs = this.content.rules.view.traffic.lanes.map((l) => l.z);
      const roadZ0 = laneZs.length > 0 ? Math.min(...laneZs) - 1.5 : -11.6;
      const roadZ1 = laneZs.length > 0 ? Math.max(...laneZs) + 1.5 : -7;
      this.traffic?.setExtraCrossers(pos.mode === 'outside' && pos.z < roadZ1 && pos.z > roadZ0 ? [{ x: pos.x, z: pos.z }] : []);
    }
    // Charlas de cruce (v1.20): en multijugador quedan en pausa (mismo criterio que el ecosistema).
    if (!this.net) this.chats?.update(dt);
    // Voces de proximidad (v1.22): se oyen en cualquier vista (pasillos incluidos).
    if (!this.net) this.voices?.update(dt);
    // v1.48 — BROMAS CON APAGÓN: los vecinos cerca del jugador comentan la falta de luz
    // (impago, velas, presidente distraído…) con bocadillo y gesto de charla. Cadencia y
    // radio del catálogo (rules.view.blackoutJokes).
    this.blackoutJokeT -= dt;
    if (!this.net && !frozen && this.blackoutJokeT <= 0 && this.ecosystem?.isBlackout()) {
      const bj = this.content.rules.view.blackoutJokes;
      if (bj && bj.lines.length > 0 && this.world && this.actors) {
        const [mn, mx] = bj.everySecs;
        this.blackoutJokeT = mn + Math.random() * Math.max(0.001, mx - mn);
        const posJ = this.logic.position();
        const floorY = posJ.floor * (this.content.rules.view.cellH ?? 2.6);
        const cand: string[] = [];
        for (const r of Object.values(this.world.residents)) {
          if (!r.present || r.location === null) continue;
          const p = this.actors.director?.nodeOf(r.id);
          if (!p || Math.abs(p.y - floorY) > 1.2) continue;
          if (Math.hypot(p.x - posJ.x, p.z - posJ.z) < bj.radius) cand.push(r.id);
        }
        const who = cand.length > 0 ? cand[Math.floor(Math.random() * cand.length)]! : null;
        if (who) {
          this.bubbles?.sayText(who, bj.lines[this.world.tick % bj.lines.length]!, 4.2);
          this.actors.director?.setGesture(who, 'talk', 3.2);
        }
      } else {
        this.blackoutJokeT = 10;
      }
    }
    // Cutscene (Fase D): sus beats mueven cámara/actores DESPUÉS de los eventos y ANTES del render.
    this.cutscenePlayer?.update(dt);
    // Bocadillos (v1.10): después de actores y cámara — proyectan la posición FINAL del frame.
    this.bubbles?.update(dt, this.actorId());
    // Ecosistema (v1.14): cerebro a cadencia + extras + luces + deterioro. En multijugador
    // queda en pausa (el servidor es la autoridad; mismo criterio que partyDemo).
    if (!this.net) this.ecosystem?.update(dt);
    // Si la cutscene acaba y queda cola, encadena la siguiente aquí: no dependemos de que el sim
    // genere otro evento para descolgar la siguiente (durante el teatro el sim está congelado).
    if (this.cutsceneQueue.length > 0 && !this.cutscenePlayer?.active) this.pumpCutscene();
    // LOD por distancia: solo con cámaras cercanas (planta/estancia); el plano general (edificio) muestra todo.
    // Privacidad (v1.17): el tercer argumento es el bloque donde está el jugador — las fachadas
    // de las viviendas reaccionan al instante cuando entra o sale.
    // v1.19: el cuarto argumento alimenta carteles guía de trasteros y el apilamiento 3D.
    this.syncRear(pos);
    // v1.24: posiciones de todos los vecinos en escena — abren las puertas de escalera al
    // acercarse y encienden su iluminación compartida de noche al moverse por los cubos.
    // v1.44 — el JUGADOR FUERA (mode 'outside') NO abre puertas: pasear delante del garaje,
    // la sala o las escaleras (o del propio portal desde la acera) no abre nada ni dispara
    // avisos — solo cuenta quien está DENTRO del edificio (vecinos, extras, visitantes).
    const movers: { x: number; y: number; z: number; outside?: boolean }[] = [
      { x: pos.x, y: pos.floor * (this.content?.rules.view.cellH ?? 2.6), z: pos.z, outside: pos.mode === 'outside' },
    ];
    if (this.world && this.actors) {
      for (const r of Object.values(this.world.residents)) {
        if (!r.present || r.location === null) continue;
        const p = this.actors.director?.nodeOf(r.id);
        if (p) movers.push(p);
      }
    }
    // v1.26: los EXTRAS del ecosistema (repartidor a puerta…) también abren las puertas de
    // escalera y encienden la luz compartida del cubo — nadie más llega a puertas cerradas.
    if (this.ecosystem) movers.push(...this.ecosystem.extraPositions());
    // v1.30 — los VIANDANTES también cuentan: el portal abre sus correderas cuando un
    // visitante se acerca a entrar (y el cubo de escalera los ve pasar, como siempre).
    for (const p of this.pedestrians?.positions() ?? []) movers.push({ x: p.x, y: 0, z: p.z });
    // v1.65 — CÁMARA ESPÍA: el foco de edificio/LOD y la cámara siguen al vecino espiado
    // (posición viva de su nodo; null en cualquier otro modo → foco del jugador de siempre).
    const spyNode = store.camMode === 'espia' && this.spyResidentId ? this.actors.director?.nodeOf(this.spyResidentId) ?? null : null;
    this.rig.spyTarget = spyNode;
    const camFocus = spyNode
      ? { x: spyNode.x, floor: Math.round(spyNode.y / (this.content.rules.view.cellH ?? 2.6)) }
      : { x: pos.x, floor: pos.floor };
    this.building.update(
      dt,
      store.camMode === 'edificio' || store.camMode === 'fachada' ? undefined : camFocus,
      pos.insideBlock,
      { x: pos.x, z: pos.z, insideBlock: pos.insideBlock },
      // v1.21: luz de día del fondo → luces nocturnas de interiores (encendidas solo con
      // gente despierta dentro) y pasillos a oscuras de noche salvo presencia + instalación OK.
      // v1.24: movers → puertas de escalera + su luz compartida nocturna.
      // v1.45: intent → las puertas de planta 0 y las correderas del portal SOLO se abren
      // con el empujón del jugador (intención de cruce); pasar de largo no abre nada.
      { daylight: this.backdrop ? this.backdrop.daylight : 1, movers, intent: this.logic.crossingIntent(), playerMode: pos.mode, blackout: this.ecosystem?.isBlackout() ?? false },
    );
    // v1.40 — la LINTERNA viaja con el jugador (posición pies del HUD de posición).
    this.flashlight?.update({ x: pos.x, y: (pos.floor ?? 0) * this.content.rules.view.cellH, z: pos.z });
    this.rig.update(dt, pos);
    this.scene.render();
  };

  /**
   * Apilamiento 3D (v1.19): cada frame decide la fase del bloque trasero activo (y apaga el
   * resto). Trastero propio: E manda ('inside' mientras rearCell). Cuarto trasero de la
   * vivienda: asoma al acercarte a la puerta del fondo ('peek') y se activa al cruzar ('inside').
   */
  private syncRear(pos: ReturnType<PlayerLogic['position']>): void {
    if (!this.building || !this.world || !this.logic) return;
    let activeId: string | null = null;
    let phase: 'idle' | 'peek' | 'inside' = 'idle';
    if (this.logic.rearCell) {
      activeId = this.logic.rearCell.block;
      phase = 'inside';
    } else if (pos.mode === 'inside' && pos.insideBlock) {
      const b = this.world.blocks[pos.insideBlock];
      if (b && b.kind === 'dwelling') {
        const geo = layoutGeometryOf(this.content, b);
        const depth = this.content.rules.view.depth;
        // v1.53 — VARIAS salas traseras: cualquier estancia más profunda que el bloque
        // principal activa el apilamiento (el nodo trasero las contiene TODAS).
        const rearRooms = (geo?.rooms ?? []).filter((r) => r.rect.z + r.rect.d > depth + 0.01);
        if (geo && rearRooms.length > 0) {
          const localX = pos.x - b.cell.col * this.content.rules.view.cellW;
          const room = roomAt(geo, localX, pos.z);
          const rearDoors = geo.doorways.filter((d) => d.axis === 'x' && rearRooms.some((r) => r.key === d.b));
          const inRear = rearRooms.some((r) => r.key === room.key);
          const near =
            pos.z > depth - this.content.rules.view.rearBlock.peekDistance &&
            rearDoors.some((d) => Math.abs(localX - d.at) < d.width / 2 + 0.3);
          if (inRear) {
            activeId = b.id;
            phase = 'inside';
          } else if (near) {
            activeId = b.id;
            phase = 'peek';
          }
        }
      }
    }
    for (const b of Object.values(this.world.blocks)) {
      if (!this.building.hasRear(b.id)) continue;
      this.building.setRearPhase(b.id, b.id === activeId ? phase : 'idle');
    }
  }

  /** Bomba de sincronización: reparte eventos pendientes y refresca el HUD. */
  private pump(): void {
    if (!this.world) return;
    this.handleEvents();
    this.paintBuilding();
    this.syncHud();
  }

  private paintBuilding(): void {
    this.building?.paint();
    // v1.35 — el nivel de grafiti de la cabina (param del núcleo) pinta el mural del
    // artista y salpica los muros del cubo/vestíbulo (el building lo hace en su paint()).
    const nuc = this.world ? Object.values(this.world.blocks).find((b) => this.content.blocks[b.defId]?.features?.elevator) : null;
    const level = typeof nuc?.params.cabin_graffiti === 'number' ? nuc.params.cabin_graffiti : 0;
    this.elevators?.setGraffiti(level);
  }

  // ───────────────────────── Eventos del sim → interfaz ─────────────────────────

  private nameOf(residentId: unknown): string {
    const r = this.world?.residents[String(residentId)];
    if (!r) return String(residentId);
    // v1.39 — vecinos como personajes: nombre propio del catálogo de personalidades.
    return residentName(this.content, r.id, r.archetype);
  }

  private titleOf(missionId: unknown): string {
    return this.content.missions[String(missionId)]?.title ?? String(missionId);
  }

  /** Etiqueta visible de una actividad (vive en el arquetipo, no en el código). */
  private activityLabel(residentId: unknown, activity: string): string {
    const r = this.world?.residents[String(residentId)];
    return r ? this.content.archetypes[r.archetype]?.activities[activity]?.label ?? activity : activity;
  }

  private handleEvents(): void {
    if (!this.world) return;
    const store = useGameStore.getState();
    for (const e of drainEvents(this.world)) {
      const d = e.data as Record<string, unknown>;
      eventSound(e.type, typeof d.type === 'string' ? d.type : undefined);
      switch (e.type) {
        case 'step_started':
          if (d.type === 'phone_call') this.openPhone(String(d.mission), String(d.dialog));
          break;
        case 'choice_required': {
          const choices = (d.choices as { id: string; label: string; hint?: string | null }[] | undefined) ?? [];
          store.setChoices({ mission: String(d.mission), title: String(d.title), choices: choices.map((c) => ({ id: c.id, label: c.label, hint: c.hint ?? null })) });
          store.pushLog(translate(store.lang, 'ev.juntaPending', { t: String(d.title) }), 'info');
          store.bumpInfoAlert('misiones'); // v1.65 — alerta post-it: decisión pendiente
          // v1.66 — BANNER de máxima prioridad: la decisión no puede pasar desapercibida.
          store.pushPriorityBanner({ kind: 'decision', title: translate(store.lang, 'banner.decision'), text: String(d.title), tab: 'misiones' });
          this.actors?.director.setGesture(this.actorId(), 'talk'); // el jugador razona en voz alta
          break;
        }
        case 'door_locked': {
          this.building?.shake(String(d.block));
          const price = typeof d.price === 'number' ? d.price : null;
          store.pushToast(
            `${blockLabel(String(d.block))}: ${translate(store.lang, 'ev.doorLocked')}${
              d.reason === 'for_sale' && price !== null ? ` ${translate(store.lang, 'ev.forSale', { n: price })}` : ''
            }`,
            'info',
          );
          break;
        }
        case 'neighbor_arrived':
          store.pushToast(translate(store.lang, 'ev.neighborArrived', { block: blockLabel(String(d.block)), name: this.nameOf(d.resident) }), 'good');
          store.pushLog(translate(store.lang, 'ev.neighborArrivedLog', { name: this.nameOf(d.resident), block: blockLabel(String(d.block)) }), 'info');
          store.bumpInfoAlert('vecinos'); // v1.65 — alerta post-it: nuevo vecino
          break;
        case 'mission_activated':
          store.pushLog(translate(store.lang, 'ev.missionNew', { m: String(d.title) }), 'info');
          store.bumpInfoAlert('misiones'); // v1.65 — alerta post-it: nueva misión
          // v1.66 — MÁXIMA PRIORIDAD: el objetivo nuevo cruza la pantalla en un post-it gordo.
          store.pushPriorityBanner({ kind: 'mission_new', title: translate(store.lang, 'banner.missionNew'), text: String(d.title), tab: 'misiones' });
          break;
        case 'mission_completed':
          // v1.30 — post-it de CELEBRACIÓN: se pliega como origami y suelta estrellitas que
          // caen al suelo (ToastStack) — sobre la fanfarria, como pidió el vecino.
          store.pushToast(translate(store.lang, 'ev.missionDone', { m: this.titleOf(d.mission) }), 'good', { celebrate: true });
          store.pushLog(translate(store.lang, 'ev.missionDoneLog', { m: this.titleOf(d.mission) }), 'good');
          store.bumpInfoAlert('misiones'); // v1.65 — alerta post-it: misión conseguida
          // v1.66 — MÁXIMA PRIORIDAD: banner gigante de celebración sobre el escenario.
          store.pushPriorityBanner({ kind: 'mission_done', title: translate(store.lang, 'banner.missionDone'), text: this.titleOf(d.mission), tab: 'misiones' });
          this.syncAchievements(); // una misión caída puede cerrar varios logros a la vez
          syncCampaign(this.world!, this.content); // la misión del cargo activa el chip de presidencia
          this.tutorial.notify('mission_completed'); // v1.39 — paso «completa una tarea»
          this.residents?.onMissionDone(); // v1.39 — los vecinos comentan la buena noticia
          break;
        case 'mission_failed':
          store.pushToast(translate(store.lang, 'ev.missionFailed', { m: this.titleOf(d.mission) }), 'bad');
          store.pushLog(translate(store.lang, 'ev.missionFailedLog', { m: this.titleOf(d.mission) }), 'bad');
          store.bumpInfoAlert('misiones'); // v1.65 — alerta post-it: misión fallida
          // v1.66 — MÁXIMA PRIORIDAD: banner gigante también para el revés.
          store.pushPriorityBanner({ kind: 'mission_failed', title: translate(store.lang, 'banner.missionFailed'), text: this.titleOf(d.mission), tab: 'misiones' });
          break;
        case 'block_unlocked':
          store.pushToast(translate(store.lang, 'ev.blockUnlocked', { block: blockLabel(String(d.block)) }), 'good');
          store.bumpInfoAlert('edificio'); // v1.65 — alerta post-it: estado del edificio
          break;
        case 'block_bought':
          store.pushLog(translate(store.lang, 'ev.blockBought', { block: blockLabel(String(d.block)), price: String(d.price) }), 'good');
          store.bumpInfoAlert('edificio'); // v1.65 — alerta post-it: estado del edificio
          break;
        case 'block_for_sale':
          store.pushLog(translate(store.lang, 'ev.forSaleSign', { block: blockLabel(String(d.block)), price: String(d.price) }), 'info');
          store.bumpInfoAlert('edificio'); // v1.65 — alerta post-it: estado del edificio
          break;
        case 'knock_result': {
          // v1.40 — el timbre lo atiende la PERSONALIDAD: saludo del catálogo de personajes
          // (reactions.greet, en el idioma del chrome); fallback a la línea del sim.
          const rid = typeof d.resident === 'string' ? d.resident : null;
          const other = rid ? this.world?.residents[rid] : undefined;
          const greet = other ? greetLineOf(this.content, other, store.lang) : null;
          if (d.asleep) {
            store.pushToast(translate(store.lang, 'ev.asleepSay', { name: String(d.name), line: String(d.line) }), 'info');
          } else {
            const line = greet ?? String(d.line);
            store.pushToast(translate(store.lang, 'ev.greetSay', { name: String(d.name), line }), 'good');
            if (rid) this.bubbles?.sayText(rid, line, 2.8);
            // v1.40 — abre de VERDAD: el vecino camina hasta el interior de su puerta.
            // v1.69 (higiene) — SOLO NPC: a los HUMANOS no se los marionetiza. Antes, el
            // knock_result del timbre de TU puerta te SACABA de donde estuvieras (¡también
            // de la vivienda del vecino que estabas visitando!) y en remoto peleaba con la
            // interpolación de poses del avatar ajeno (T4c/T4d de qa-v164-multi). El
            // «el knock lo trae caminando» de v1.64 era para dueños IA (Marta va del bar
            // a su puerta); el humano atiende (o no) con sus propios pies.
            if (rid && other?.home && this.world && other.controller?.type !== 'human') {
              const b = this.world.blocks[other.home];
              if (b) {
                const v = this.content.rules.view;
                const frontZ = v.roomZ - v.commonDepth / 2;
                this.actors?.director.walkTo(rid, {
                  x: (b.cell.col + b.size.w / 2) * v.cellW,
                  z: frontZ + 0.45,
                  floor: b.cell.floor,
                  inside: { block: b.id, local: { x: (b.size.w * v.cellW) / 2, z: 0.45 } },
                });
              }
            }
          }
          if (rid && other?.controller?.type !== 'human') this.actors?.director.setGesture(rid, 'talk', 3.5);
          this.tutorial.notify('used:resident'); // v1.39 — paso «conoce a un vecino»
          break;
        }
        case 'noise_complaint': // texto data-driven: lo pinta el uiLog del catálogo (case mantenido por compatibilidad de eventos antiguos)
          if (d.uiLog === true) break;
          store.pushLog(translate(store.lang, 'ev.noiseOver', { block: blockLabel(String(d.block)) }), 'bad');
          break;
        case 'leak_detected':
          if (d.uiLog === true) break;
          store.pushLog(translate(store.lang, 'ev.leak', { block: blockLabel(String(d.block)) }), 'bad');
          break;
        case 'furniture_placed':
          store.pushLog(translate(store.lang, 'ev.furniturePlaced', { e: String(d.emoji ?? '📦'), name: String(d.name), block: blockLabel(String(d.block)), room: String(d.room) }), 'info');
          break;
        case 'furniture_removed':
          store.pushLog(translate(store.lang, 'ev.furnitureRemoved', { e: String(d.emoji ?? '📦'), name: String(d.name), block: blockLabel(String(d.block)), n: String(d.refund) }), 'info');
          break;
        case 'room_renovated':
          store.pushLog(translate(store.lang, 'ev.roomRenovated', { block: blockLabel(String(d.block)) }), 'good');
          break;
        case 'weather_changed':
          store.pushLog(translate(store.lang, 'ev.weatherChange', { state: this.content.rules.labels.weather[String(d.state)] ?? String(d.state) }), 'info');
          break;
        case 'rent_collected':
          store.pushToast(translate(store.lang, 'ev.rentCollected', { n: String(d.amount), block: blockLabel(String(d.block)) }), 'good');
          break;
        case 'work_done':
          store.pushLog(translate(store.lang, 'ev.workDone', { n: String(d.amount) }), 'info');
          break;
        case 'activity_started':
          if (d.activity !== 'idle') store.pushLog(translate(store.lang, 'ev.activity', { n: this.nameOf(d.resident), a: this.activityLabel(d.resident, String(d.activity)) }), 'info');
          break;
        case 'junta_requested': {
          const agenda = (d.agenda as { id: string; title: string; description: string; cost: number }[] | undefined) ?? [];
          store.setJunta(agenda.map((i) => ({ id: i.id, title: i.title, description: i.description, cost: i.cost })));
          this.actors?.director.setGesture(this.actorId(), 'talk'); // defensa del orden del día
          this.marchJunta(); // v1.30: los presentes entran en la sala de juntas y se sientan
          this.tutorial.tip('junta'); // v1.39 — consejo contextual one-shot
          break;
        }
        case 'junta_result':
          store.pushToast(
            d.approved ? `Aprobado: ${String(d.title)} (${String(d.yes)} sí / ${String(d.no)} no)` : `Rechazado: ${String(d.title)} (${String(d.yes)} sí / ${String(d.no)} no)`,
            d.approved ? ('good' as Tone) : ('bad' as Tone),
          );
          break;
        case 'junta_vote_registered':
          store.pushLog(translate(store.lang, 'ev.voteCast', { name: this.nameOf(d.resident), n: String(d.pendingHumans) }), 'info');
          break;
        case 'junta_closed':
          store.setJunta(null);
          this.dismissJunta(); // v1.30: la sala se vacía, la IA retoma a los vecinos
          break;
        case 'stairs_grumble':
          // Malestar vecinal (v1.5): texto del catálogo con el nombre del vecino que sube a pie.
          store.pushLog(String(this.content.rules.sim.elevator.grumbleText).replace('{name}', this.nameOf(d.resident)), 'info');
          break;
        case 'minigame_requested': {
          const def = this.content.minigames[String(d.minigame)];
          if (!def) break;
          this.tutorial.tip('minigame'); // v1.39 — consejo contextual one-shot
          this.minigameStartedAt = performance.now(); // v1.55 — cronómetro del duelo de comunidad
          // Overrides numéricos del escenario activo (QA/E2E): solo config, nunca efectos ni textos.
          const ov = this.scenarioOverrides[def.id];
          const effective = ov ? ({ ...def, config: { ...def.config, ...ov } } as MinigameDef) : def;
          store.setMinigame({ ...effective, emoji: effective.emoji ?? '🎮', instruction: effective.instruction ?? null });
          break;
        }
        case 'minigame_finished': {
          const name = this.content.minigames[String(d.minigame)]?.name ?? String(d.minigame);
          store.pushLog(translate(store.lang, d.success ? 'ev.minigameWin' : 'ev.minigameLose', { m: name }), d.success ? 'good' : 'bad');
          break;
        }
        case 'ui_toast':
          // v1.33: los avisos del catálogo (ecosistema incluido) admiten tokens
          // data-driven si el evento trae vecinos {a}/{b}; sin contexto, texto tal cual.
          // v1.34: {home} (la vivienda del jugador) y el resto del catálogo de tokens.
          store.pushToast(
            resolveTokens(String(d.text), this.world, this.content, {
              a: typeof d.a === 'string' ? d.a : undefined,
              b: typeof d.b === 'string' ? d.b : undefined,
              home: this.world.residents[this.world.playerId]?.home,
            }),
            (d.tone as Tone | undefined) ?? 'info',
          );
          break;
        case 'finale':
          store.setFinale(String(d.text));
          break;
        case 'funds_changed': {
          const amount = typeof d.amount === 'number' ? d.amount : 0;
          if ((d.to === 'player' || d.to === 'community') && amount !== 0) {
            store.pushLog(amount > 0 ? `+${amount} € (fondos)` : `${amount} € (fondos)`, amount > 0 ? 'good' : 'bad');
          }
          break;
        }
        default: {
          // Umbral de canal con texto del catálogo (odors, wifi y futuros canales): totalmente data-driven.
          if (d.uiLog === true && typeof d.message === 'string') {
            store.pushLog(String(d.message).replace('{block}', blockLabel(String(d.block))), (d.tone as Tone | undefined) ?? 'info');
          }
          // v1.65 — param_changed del ASCENSOR = estado del edificio visible: alerta post-it.
          if (d.param === 'elevator_status') store.bumpInfoAlert('edificio');
          break; // resident_moved, activity_ended... demasiado ruido para el registro
        }
      }
      // Cutscenes (Fase D): después del reparto, ¿alguna quiere este evento como disparador?
      this.maybeCutscene(e);
      // Bocadillos (v1.10): reacciones expresivas al evento según emotes.json del catálogo.
      this.bubbles?.onEvent(e);
    }
    this.pumpCutscene();
  }

  // ───────────────────────── Cutscenes (Fase D) ─────────────────────────

  /** Si el evento encaja con el trigger de alguna cutscene del catálogo, se encola (máx. 3). */
  private maybeCutscene(e: GameEvent): void {
    const defs = Object.values(this.content.cutscenes);
    if (defs.length === 0) return;
    const d = e.data as Record<string, unknown>;
    const hit = defs.find((c) => {
      const t = c.trigger;
      if (t.on !== e.type) return false;
      if (t.mission !== undefined && t.mission !== String(d.mission ?? '')) return false;
      if (t.step !== undefined && t.step !== String(d.step ?? '')) return false;
      return true;
    });
    if (!hit) return;
    if (this.cutsceneQueue.length >= 3) return; // nunca más de 3 esperando: el teatro no atravaca la partida
    this.cutsceneQueue.push({
      def: hit,
      ctx: {
        mission: typeof d.mission === 'string' ? d.mission : null,
        resident: typeof d.resident === 'string' ? d.resident : null,
        block: typeof d.block === 'string' ? d.block : null,
      },
    });
  }

  /** Lanza la siguiente cutscene en cola si no hay nada en pantalla (también un modal la pospone). */
  private pumpCutscene(): void {
    if (!this.cutscenePlayer || !this.world || !this.rig || !this.actors || !this.engine || !this.logic) return;
    if (this.cutscenePlayer.active || this.cutsceneQueue.length === 0) return;
    if (selectModalOpen(useGameStore.getState())) return; // no se roba la pantalla a un modal
    const next = this.cutsceneQueue.shift()!;
    this.cutscenePlayer.start(next.def, next.ctx, {
      engine: this.engine,
      rig: this.rig,
      actors: this.actors.director,
      world: this.world,
      playerPos: () => this.logic!.position(),
    });
  }

  // ───────────────────────── Teléfono ─────────────────────────

  private openPhone(mission: string, dialogId: string): void {
    const dlg = this.content.dialogs[dialogId];
    if (!dlg || dlg.lines.length === 0) return;
    this.tutorial.tip('phone'); // v1.39 — consejo contextual one-shot (idempotente)
    // Si ya hay una llamada en pantalla, la nueva espera en cola (dedupe por misión).
    if (this.phoneMission) {
      if (this.phoneMission !== mission && !this.phoneQueue.some((q) => q.mission === mission)) {
        this.phoneQueue.push({ mission, dialogId });
      }
      return;
    }
    this.phoneMission = mission;
    this.phoneLines = dlg.lines;
    this.phoneLine = 0;
    this.actors?.director.setGesture(this.actorId(), 'phone'); // el jugador atiende con el móvil a la oreja
    this.showPhoneLine();
  }

  private showPhoneLine(): void {
    const line = this.phoneLines[this.phoneLine];
    if (!line) return;
    useGameStore.getState().setPhone({ mission: this.phoneMission, speaker: line.speaker, text: line.text, isLast: this.phoneLine === this.phoneLines.length - 1 });
  }

  // ───────────────────────── HUD ─────────────────────────

  /** Nombre visible de un bloque: label del catálogo (data-driven) o etiqueta de vivienda (1B). */
  private blockName(id: string): string {
    const b = this.world?.blocks[id];
    const defLabel = b ? this.content.blocks[b.defId]?.label : undefined;
    return defLabel ?? blockLabel(id);
  }

  private objectiveUi(): { title: string; text: string } | null {
    if (!this.world) return null;
    const lang = useGameStore.getState().lang;
    const o = activeObjective(this.world, this.content);
    if (!o) return null;
    if (o.state === 'awaiting_choice') return { title: o.title, text: translate(lang, 'obj.awaiting') };
    const s = o.step!;
    const left = o.untilTick !== null ? translate(lang, 'obj.remaining', { n: Math.max(0, o.untilTick - this.world.tick) }) : '';
    switch (s.type) {
      case 'phone_call':
        return { title: o.title, text: translate(lang, 'obj.phone') };
      case 'reach':
        return { title: o.title, text: translate(lang, 'obj.reach', { b: this.blockName(s.block ?? '') }) };
      case 'enter':
        return { title: o.title, text: translate(lang, 'obj.enter') };
      case 'catch_in_act':
        return { title: o.title, text: `${translate(lang, 'obj.catch')}${left}.` };
      default:
        return { title: o.title, text: o.title };
    }
  }

  /** v1.42 — línea cómica del jugador al aire libre (catálogo view.outside.says): bocadillo
   *  sobre su cabeza, mismo canal que las charlas de cruce. Sin catálogo, silencio. */
  private sayOutdoorLine(kind: 'out' | 'into' | 'sit' | 'exercise'): void {
    const arr = this.content.rules.view.outside?.says[kind];
    if (!arr || arr.length === 0 || !this.bubbles) return;
    const line = arr[Math.floor(Math.random() * arr.length)]!;
    this.bubbles.sayText(this.actorId(), line, 3.6);
  }

  private promptText(): string | null {
    const logic = this.logic;
    const world = this.world;
    if (!logic || !world) return null;
    if (logic.position().climbing) return null;
    // El prompt es SIEMPRE el objetivo real de la tecla E (misma fuente, cero divergencias).
    const t = logic.interactTarget();
    if (t) {
      const ic = this.content.rules.interact;
      switch (t.kind) {
        case 'door': {
          const door = world.blocks[t.blockId]!;
          if (logic.position().mode === 'inside') {
            // v1.40 — en TU vivienda, en el marco de la puerta la salida es automática:
            // el prompt se calla justo cuando va a saltar (lo que ves es lo que pasa).
            // v1.49 — walkIn.visitorExit: en vivienda ajena la salida también es natural
            // (atraviesa la puerta) — nearOwnDoor lo cubre y la E queda de respaldo.
            if (logic.nearOwnDoor()) return null;
            return ic.exit;
          }
          // v1.40 — TU puerta ya no pide E: entras al plantarte (como el núcleo).
          if (door.kind === 'dwelling' && door.ownerId === this.actorId()) return null;
          // v1.40 — vivienda ajena ocupada: la E es el TIMBRE de su vecino.
          if (door.kind === 'dwelling' && door.access !== 'locked' && door.occupancy === 'occupied' && door.ownerId && world.residents[door.ownerId]) {
            return (ic.doorbell ?? ic.greet).replace('{name}', this.nameOf(door.ownerId));
          }
          return door.access === 'locked'
            ? ic.doorLocked.replace('{block}', this.blockName(door.id))
            : ic.doorEnter.replace('{block}', this.blockName(door.id));
        }
        case 'resident':
          // v1.40 — cruzarte con un vecino = charla (ya no es llamar a su puerta).
          return (ic.chat ?? ic.greet).replace('{name}', this.nameOf(t.residentId));
        case 'mailbox':
          return ic.mailbox.prompt;
        case 'noticeboard':
          return ic.noticeboard.prompt;
        // v1.48 — cuadro de fusibles del garaje.
        case 'fusebox':
          return ic.fusebox?.prompt ?? 'E · revisar el cuadro de fusibles';
        case 'laptop':
          return ic.laptop;
        case 'bed':
          return ic.bed;
        case 'storageCell':
          return ic.storageEnter;
        case 'rearExit':
          return ic.rearExit;
        // v1.42 — calle: banco (sentarse/levantarse) y calistenia.
        case 'bench':
          return logic.isSitting() ? (ic.standUp ?? '') : (ic.bench ?? '');
        case 'exercise':
          return ic.exercise ?? '';
      }
    }
    const zone = logic.zone();
    const feat = this.content.blocks[zone.defId]!.features;
    if (feat?.stairs || feat?.elevator) {
      const ic = this.content.rules.interact;
      // Lo que dice el prompt es lo que W/S hace aquí: ascensor operativo manda; si no hay
      // ascensor utilizable pero sí escalera, escalera; núcleo averiado sin escalera = aviso.
      if (feat.elevator && world.blocks[zone.id]!.params.elevator_status === 'ok') return ic.elevator;
      if (feat.stairs) return ic.stairs;
      return ic.elevatorBroken;
    }
    return null;
  }

  /** Viviendas del jugador para el editor de interiores (foto serializable, posiciones ya en %). */
  private homesUi() {
    const world = this.world!;
    const cellH = this.content.rules.view.cellH;
    const mine = this.actorId();
    return Object.values(world.blocks)
      .filter((b) => b.kind === 'dwelling' && b.ownerId === mine)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((b) => ({
        id: b.id,
        label: blockLabel(b.id),
        rooms: b.rooms.map((room) => {
          const rdef = this.content.rooms[room.defId];
          const slots = (rdef?.furnitureSlots ?? []).map((s) => {
            const itemId = room.furniture[s.id] ?? '';
            const fdef = itemId ? this.content.furniture[itemId] : undefined;
            return {
              id: s.id,
              kind: s.kind,
              left: Math.min(92, Math.max(2, (s.pos[0] / Math.max(0.001, rdef?.size.w ?? 1)) * 100)),
              bottom: Math.min(76, Math.max(0, (s.pos[1] / Math.max(0.001, cellH)) * 100)),
              item: fdef ? { id: fdef.id, name: fdef.name, emoji: fdef.emoji ?? '📦', color: fdef.view.color } : null,
            };
          });
          return { key: room.key, label: rdef?.label ?? room.key, access: room.access, slots };
        }),
      }));
  }

  private syncHud(): void {
    const world = this.world;
    if (!world) return;
    const player = world.residents[this.actorId()] ?? world.residents[world.playerId];
    if (!player) return;
    const home = player.home;
    const params = visibleParams(world, this.content, home).map((p) => ({ name: p.name, label: p.def.label ?? p.name, value: String(p.value) }));
    const missions = world.missions.map((m) => {
      const def = this.content.missions[m.id]!;
      const step = m.state === 'active' ? def.steps[m.step] : undefined;
      return {
        id: m.id,
        title: def.title,
        state: m.state,
        hint: step?.hint ?? null,
        remaining: m.until !== null ? translate(useGameStore.getState().lang, 'hud.remaining', { n: Math.max(0, m.until - world.tick) }) : null,
      };
    });
    const travel = travelMinutes(buildCirculation(world, this.content), world.entry, home);
    const elevatorBlock = Object.values(world.blocks).find((b) => b.params.elevator_status !== undefined);
    useGameStore.getState().syncHud({
      clock: { ...world.clock },
      weather: world.weather.state,
      funds: world.community.funds,
      wallet: player.wallet,
      reputation: player.reputation,
      elevator: String(elevatorBlock?.params.elevator_status ?? 'ok'),
      homeLabel: blockLabel(home),
      travelText: Number.isFinite(travel) ? translate(useGameStore.getState().lang, 'hud.travel', { n: travel }) : null,
      objective: this.objectiveUi(),
      prompt: this.promptText(),
      params,
      missions,
      homes: this.homesUi(),
      furnitureConfig: { refundRatio: this.content.rules.furniture.refundRatio, roomUnlockPrice: this.content.rules.furniture.roomUnlock.price },
    });
  }

  // ───────────────────── Logros tipo Steam (v1.17) ─────────────────────

  /** Logro del catálogo → forma de UI con textos resueltos al idioma actual del store. */
  private achievementUi(def: AchievementDef, unlocked: boolean, newly = false): AchievementUi {
    const lang = useGameStore.getState().lang;
    return {
      id: def.id,
      icon: def.icon,
      name: def.name[lang] ?? def.name.es,
      desc: def.desc[lang] ?? def.desc.es,
      hidden: def.hidden === true,
      unlocked,
      newly,
    };
  }

  /** Re-pinta la lista de logros (mismos desbloqueos) con los textos del idioma actual. */
  private rebuildAchievementTexts(): void {
    const catalog = this._content?.achievements;
    if (!catalog) return;
    const prev = useGameStore.getState().achievements;
    useGameStore.getState().setAchievements(
      catalog.achievements.map((def) => {
        const old = prev.find((a) => a.id === def.id);
        return this.achievementUi(def, this.unlockedAchievements.has(def.id), old?.newly === true);
      }),
    );
  }

  /**
   * Evalúa el catálogo de logros contra el estado actual del mundo. Solo LEE el sim: el
   * evaluador es puro (src/game/support/achievements.ts) y aquí se persisten los
   * desbloqueos en el perfil (localStorage), se anuncian en el registro y se encola el
   * popup estilo Steam (uno en pantalla; el resto queda `newly` para AchievementPopup).
   * Sin catálogo (achievements.json ausente) no hay logros y no se toca nada.
   */
  private syncAchievements(): void {
    const catalog = this._content?.achievements;
    const world = this.world;
    if (!catalog || !world) return;
    const player = world.residents[this.actorId()] ?? world.residents[world.playerId];
    if (!player) return;
    const store = useGameStore.getState();

    // Snapshot con las mismas fuentes que el HUD (día del reloj, funds, ascensor del núcleo…).
    const elevatorBlock = Object.values(world.blocks).find((b) => b.params.elevator_status !== undefined);
    let bestAffinity = 0;
    for (const rel of player.relations) bestAffinity = Math.max(bestAffinity, rel.affinity);
    const snap: AchievementSnapshot = {
      day: world.clock.day,
      tick: world.tick,
      wallet: player.wallet,
      funds: world.community.funds,
      reputation: player.reputation,
      elevatorStatus: String(elevatorBlock?.params.elevator_status ?? 'ok'),
      missionsDone: world.missions.filter((m) => m.state === 'done').map((m) => m.id),
      bestAffinity,
    };

    const fresh = evaluateAchievements(catalog, snap, this.unlockedAchievements);
    if (fresh.length === 0 && store.achievements.length > 0) return; // nada nuevo y lista ya pintada

    if (fresh.length > 0) {
      for (const id of fresh) this.unlockedAchievements.add(id);
      saveUnlocked([...this.unlockedAchievements]);
      store.bumpInfoAlert('logros', fresh.length); // v1.65 — alerta post-it: logro(s) nuevo(s)
      // v1.66 — MÁXIMA PRIORIDAD: cada logro nuevo pasa por el banner gigante (cola FIFO).
      const langB = store.lang;
      for (const id of fresh) {
        const defB = catalog.achievements.find((a) => a.id === id);
        if (defB) {
          store.pushPriorityBanner({
            kind: 'achievement',
            title: translate(langB, 'banner.achievement'),
            text: defB.name[langB] ?? defB.name.es,
            tab: 'logros',
          });
        }
      }
    }
    store.setAchievements(
      catalog.achievements.map((def) => this.achievementUi(def, this.unlockedAchievements.has(def.id), fresh.includes(def.id))),
    );

    const lang = useGameStore.getState().lang;
    for (const id of fresh) {
      const def = catalog.achievements.find((a) => a.id === id);
      if (def) store.pushLog(`🏆 Logro desbloqueado: ${def.name[lang] ?? def.name.es}`, 'good');
    }
    if (fresh.length > 0 && useGameStore.getState().achievementPopup === null) {
      const first = catalog.achievements.find((a) => a.id === fresh[0]);
      if (first) useGameStore.getState().setAchievementPopup(this.achievementUi(first, true));
    }
  }

  // ───────────────────── v1.39 — Proyecto del edificio y vecinos-personaje ─────────────────────

  /**
   * Proyecto comunitario «mejorar el edificio»: evaluación SOLO LECTURA a la misma
   * cadencia que los logros. Al subir de nivel: fanfarria + post-it de celebración +
   * registro. `quiet` = primera foto tras (re)crear el mundo (no celebra nada).
   */
  private syncProject(quiet: boolean): void {
    const catalog = this._content?.project;
    const world = this.world;
    if (!catalog || !world) return;
    const store = useGameStore.getState();
    const snap = projectSnapshot(world, this.actorId());
    const state = evaluateProject(catalog, snap);
    const lang = store.lang;
    const current = state.current;
    const levelTitle = current ? current.title[lang] ?? current.title.es : catalog.levels[catalog.levels.length - 1]!.title[lang] ?? '';
    store.setProject({
      icon: catalog.icon,
      title: catalog.title[lang] ?? catalog.title.es,
      level: state.level,
      totalLevels: catalog.levels.length,
      levelTitle,
      goals: state.goals.map((g) => ({
        label: translate(lang, g.key === 'missions' ? 'project.goal.missions' : g.key === 'funds' ? 'project.goal.funds' : 'project.goal.reputation'),
        have: g.have,
        need: g.need,
        done: g.done,
      })),
      progress: state.progress,
      reward: current ? null : (() => {
        const last = catalog.levels[catalog.levels.length - 1]!;
        return last.reward[lang] ?? last.reward.es;
      })(),
      completed: state.completed,
    });
    if (!quiet && state.level > this.projectLevelSeen) {
      const lv = catalog.levels[state.level - 1];
      if (lv) {
        store.pushToast(`🏗️ ${lv.title[lang] ?? lv.title.es}: ${lv.reward[lang] ?? lv.reward.es}`, 'good', { celebrate: true });
        store.pushLog(`🏗️ Proyecto del edificio: ${lv.title[lang] ?? lv.title.es}`, 'good');
        store.bumpInfoAlert('edificio'); // v1.65 — alerta post-it: el edificio mejora de nivel
      }
    }
    this.projectLevelSeen = Math.max(this.projectLevelSeen, state.level);
  }

  /** Foto de los vecinos (nombre, gustos, afinidad…) para la pestaña «Vecinos» del dock. */
  private syncResidentsUi(): void {
    const world = this.world;
    const content = this._content;
    if (!world || !content) return;
    useGameStore.getState().setResidentsUi(residentsUiSnapshot(world, content, this.actorId(), useGameStore.getState().lang));
  }
}

// ───────────────────────── Singleton ─────────────────────────

let instance: GameController | null = null;

/** Crea (o reutiliza) el controlador y lo arranca sobre el canvas dado. */
export function createGameController(canvas: HTMLCanvasElement): GameController {
  if (!instance) {
    instance = new GameController();
    setController(instance); // la UI lo usa desde ya; sus acciones toleran mundo nulo
    void instance.init(canvas);
    // Gancho de depuración/E2E (solo lectura + teleport QoL de pruebas).
    const dbg = instance as unknown as { logic?: PlayerLogic; world?: World } | null;
    (globalThis as Record<string, unknown>).__vecinosDebug = () => ({
      player: dbg?.logic
        ? {
            x: +dbg.logic.x.toFixed(2),
            z: +dbg.logic.z.toFixed(2),
            floor: dbg.logic.floor,
            mode: dbg.logic.mode,
            insideBlock: dbg.logic.insideBlock,
            climbing: !!dbg.logic.position().climbing,
          }
        : null,
      clock: dbg?.world ? { ...dbg.world.clock } : null,
      camMode: useGameStore.getState().camMode,
      /** v1.65 — estado de la cámara espía (vecino seguido + objetivo vivo para E2E). */
      spy: {
        id: useGameStore.getState().spyTargetId,
        target: (instance as unknown as { rig?: { spyTarget: { x: number; y: number; z: number } | null } }).rig?.spyTarget ?? null,
      },
      paused: useGameStore.getState().paused,
      simLocation: dbg?.world?.residents[dbg.world.playerId]?.location ?? null,
      missions: dbg?.world?.missions.map((m) => `${m.id}:${m.state}${m.state === 'active' ? `#${m.step}` : ''}`) ?? [],
      /** QoL de pruebas E2E: colocar al jugador ante la puerta de un bloque (recorrido legal del grafo). */
      tp: (blockId: string) => !!dbg?.logic?.teleportTo(blockId),
      /** QoL de pruebas E2E: comando del sim directo (diagnóstico de pasos). */
      cmd: (c: unknown) => {
        const w = dbg?.world;
        const ct = (dbg as unknown as { _content?: Content } | null)?._content;
        return w && ct ? JSON.stringify(dispatch(w, ct, c as Command)) : 'no-world';
      },
      /** QoL de pruebas E2E (pestaña en segundo plano: rAF suspendido): avanza n ticks del sim. */
      tickN: (n: number) => {
        const w = dbg?.world;
        const ct = (dbg as unknown as { _content?: Content } | null)?._content;
        if (!w || !ct) return 'no-world';
        for (let i = 0; i < n; i++) tick(w, ct);
        (dbg as unknown as { handleEvents?: () => void }).handleEvents?.();
        return JSON.stringify({ ...w.clock });
      },
      /** QoL de pruebas E2E: coloca la X del jugador (presentación) para apuntar interacciones fijas. */
      setX: (x: number) => {
        const lg = dbg?.logic;
        if (!lg) return 'no-logic';
        lg.x = x;
        return JSON.stringify({ x: lg.x });
      },
    });
  }
  return instance;
}

export function getGameController(): GameController | null {
  return instance;
}
