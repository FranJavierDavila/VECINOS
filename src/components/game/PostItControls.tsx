'use client';

/**
 * V1.65 — UNA LÍNEA SUPERIOR, PANTALLA DE JUEGO LIMPIA (rediseño del HUD).
 *
 * Petición del vecino: «que prácticamente solo veamos la pantalla de juego» —
 * los cinco post-its de mandos (Tiempo, Opciones, Partida, Ayuda, Jugadores)
 * se pliegan en UN SOLO post-it MENÚ que los despliega EN ACORDEÓN, y las
 * cámaras en línea dejan su sitio a un POST-IT CÁMARA (icono + cámara vigente,
 * tooltip con las teclas, y selector del vecino al que espiar). Junto a ellos,
 * los cuatro botones-postit del cuaderno (Misiones · Edificio · Vecinos ·
 * Logros) abren su panel POR ENCIMA del escenario (ver InfoDock).
 *
 *   [MENÚ] [Cámara] [Misiones] [Edificio] [Vecinos] [Logros]   …día/hora · tiempo
 *
 * El clic fuera y Escape siguen cerrando el post-it abierto (v1.38), y el
 * controlador respeta los post-its abiertos para no disparar su menú de pausa.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CloudLightning,
  CloudRain,
  CloudSun,
  Sun,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { MultiplayerPanel } from '@/components/game/MultiplayerPanel';
import { HelpCard } from '@/components/game/HelpCard';
import { OptionsPanel } from '@/components/game/OptionsPanel';
import { InfoTabButtons } from '@/components/game/InfoDock';
import { useGameStore } from '@/game/client/store';
import type { CamMode, Speed } from '@/game/client/store';
import { getController } from '@/game/client/bridge';
import { useT } from '@/game/client/i18n';
import { cn } from '@/lib/utils';

// ── Tinta a bolígrafo: iconos SVG garabateados a mano (trazo azul, remates redondos) ──

const INK = '#274b8f';

interface InkProps {
  className?: string;
}

const svgProps = (className?: string) => ({
  width: 30,
  height: 30,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: INK,
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true,
});

/** Reloj garabateado con flechita de avance (el tiempo de juego). */
function InkClock({ className }: InkProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M12.2 3.4c4.8-.3 8.3 3.4 8.2 8.2-.1 4.9-3.8 8.9-8.6 8.9-4.7 0-8.3-3.8-8.2-8.6.1-4.6 3.9-8.2 8.6-8.5z" />
      <path d="M12 7.3v5l3.4 2.1" />
      <path d="M18.6 2.6l2.3 1.1-.7 2.4" />
    </svg>
  );
}

/** Engranaje a mano (opciones). */
function InkGear({ className }: InkProps) {
  return (
    <svg {...svgProps(className)}>
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 2.8l1 2.5 2.6-.8 1 2.3 2.6.2-.4 2.6 2.2 1.5-1.7 2 1.1 2.4-2.5.9.2 2.6-2.6-.3-1.3 2.3-2.2-1.4-2.2 1.5-1.4-2.2-2.6.4.1-2.7-2.4-1 1.6-2.1-1.3-2.3 2.5-.8v-2.6l2.6.4z" />
    </svg>
  );
}

/** Caja de partida: disquete garabateado. */
function InkSave({ className }: InkProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M4.3 4.5c4.9-.5 10.6-.4 15.2 0 .6 4.9.5 10.3 0 15-5 .5-10.4.5-15.2 0-.5-5-.6-10.2 0-15z" />
      <path d="M8 4.8v4.4l7.6.1V4.9" />
      <path d="M7.9 19.2v-5.4l8.2-.1v5.5" />
    </svg>
  );
}

/** Signo de interrogación trazo a mano (ayuda). */
function InkQuestion({ className }: InkProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M8.1 8.8c.3-2.6 2-4 4.1-3.9 2.2.1 3.7 1.6 3.6 3.6-.1 2.9-3.6 3-3.7 5.9" />
      <path d="M12.1 18.6l.1 1.4" />
    </svg>
  );
}

/** Dos vecinos charlando (multijugador). */
function InkPeople({ className }: InkProps) {
  return (
    <svg {...svgProps(className)}>
      <circle cx="8.6" cy="8" r="3" />
      <path d="M3.4 19c.4-4 2.6-6 5.2-6 2.6 0 4.8 2 5.2 6" />
      <circle cx="16.4" cy="9.2" r="2.4" />
      <path d="M15.4 12.6c2.8-.4 4.9 1.6 5.3 5.2" />
    </svg>
  );
}

/** v1.65 — HAMBURGUESA garabateada (el post-it MENÚ que pliega los mandos). */
function InkMenu({ className }: InkProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M4.4 6.7c5-.4 10.2-.4 15.2-.1" />
      <path d="M4.2 12c5-.3 10.3-.3 15.5 0" />
      <path d="M4.5 17.3c5-.3 10.1-.3 15 0" />
    </svg>
  );
}

/** v1.65 — CÁMARA garabateada (post-it de cámaras con el modo vigente). */
function InkCamera({ className }: InkProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M4.2 8.2c3.6-.4 7.4-.4 11 0 .5 0 .9.4.9.9v7.4c0 .5-.4.9-.9.9-3.6.4-7.4.4-11 0-.5 0-.9-.4-.9-.9V9.1c0-.5.4-.9.9-.9z" />
      <path d="M16.3 11.2l3.7-2.1v6.6l-3.7-2.1" />
      <circle cx="9" cy="13" r="2.2" />
    </svg>
  );
}

/** Altavoz con ondas (sonido dentro de opciones) — vive en OptionsPanel desde v1.39. */

// ── Pausa (dos barras temblorosas) ──
function InkPause({ className }: InkProps) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9 5.4c-.4 4.4-.4 8.8 0 13.2M15.4 5.2c.4 4.5.4 9 0 13.5" />
    </svg>
  );
}

/** Play (triángulo garabateado). */
function InkPlay({ className }: InkProps) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M8 5.6c3.4 1.8 6.6 3.9 9.5 6.4-2.9 2.4-6.1 4.5-9.6 6.2-.5-4.2-.5-8.4.1-12.6z" />
    </svg>
  );
}

/** Avance rápido (dos triángulos). */
function InkSkip({ className }: InkProps) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4.6 6.4c2.4 1.4 4.5 3 6.4 5-1.9 1.9-4 3.6-6.5 5-.4-3.3-.4-6.7.1-10z" />
      <path d="M13.2 6.2c2.4 1.4 4.6 3 6.5 5-2 2-4.1 3.7-6.6 5.1-.4-3.4-.4-6.8.1-10.1z" />
    </svg>
  );
}

// ── Post-it base ──

type PaperColor = 'yellow' | 'pink' | 'green' | 'blue' | 'orange';

const PAPER: Record<PaperColor, string> = {
  yellow: '#fef9a7',
  pink: '#fdd9e0',
  green: '#d4f0c0',
  blue: '#cfe6f7',
  orange: '#ffd9a8',
};

function PostIt({
  id,
  openId,
  onToggle,
  icon,
  label,
  paper = 'yellow',
  tilt = 0,
  panelSide = 'left',
  panelWidth,
  ariaLabel,
  tooltip,
  children,
}: {
  id: string;
  openId: string | null;
  onToggle: (id: string) => void;
  icon: React.ReactNode;
  label: string;
  paper?: PaperColor;
  tilt?: number;
  panelSide?: 'left' | 'right';
  panelWidth?: number;
  /** v1.65 — aria-label y tooltip del botón (por defecto, la etiqueta). */
  ariaLabel?: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  const open = openId === id;
  return (
    <div className="relative">
      <button
        type="button"
        className="postit sketchy"
        style={{ background: PAPER[paper], transform: open ? `scale(1.06) rotate(0deg)` : `rotate(${tilt}deg)` }}
        aria-expanded={open}
        aria-label={ariaLabel ?? label}
        title={tooltip ?? label}
        onClick={() => onToggle(id)}
      >
        {icon}
        <span className="text-[10px] font-bold leading-none">{label}</span>
      </button>
      {open && (
        <div
          role="group"
          aria-label={ariaLabel ?? label}
          data-postit-panel="1"
          className={cn('postit-panel sketchy', panelSide === 'right' && 'postit-panel-right')}
          style={{ background: PAPER[paper], width: panelWidth }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Garabato pulsable dentro de un post-it desplegado. */
function DoodleButton({
  onClick,
  active,
  disabled,
  children,
  ariaLabel,
  ariaPressed,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  ariaLabel?: string;
  ariaPressed?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="postit-btn sketchy-thin"
      onClick={onClick}
      disabled={disabled}
      data-active={active || undefined}
      aria-pressed={ariaPressed}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </button>
  );
}

// ── v1.65 — Cámaras: orden de CERCA a LEJOS + ESPÍA (teclas 1..5, sincronizadas con
// CAM_BY_KEY del controlador; el número se muestra en el post-it y en la ayuda). ──

const CAMS: ReadonlyArray<{ value: CamMode; keyLabel: string }> = [
  { value: 'estancia', keyLabel: '1' },
  { value: 'planta', keyLabel: '2' },
  { value: 'edificio', keyLabel: '3' },
  { value: 'fachada', keyLabel: '4' },
  { value: 'espia', keyLabel: '5' },
];

const WEATHER_UI: Record<string, { icon: LucideIcon; className: string }> = {
  sunny: { icon: Sun, className: 'text-amber-500' },
  cloudy: { icon: CloudSun, className: 'text-muted-foreground' },
  rain: { icon: CloudRain, className: 'text-sky-600 dark:text-sky-400' },
  storm: { icon: CloudLightning, className: 'text-amber-600 dark:text-amber-400' },
};

// ── Barra completa ──

export function PostItControls() {
  const t = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const toggle = useCallback((id: string) => setOpenId((cur) => (cur === id ? null : id)), []);

  // Clic fuera o Escape cierra el post-it abierto.
  // v1.38 — CORRECCIÓN: los popups de Radix (Select de calidad/objetivo/idioma, diálogos,
  // menús) viven en un PORTAL fuera de la barra — su pointerdown no es «clic fuera»:
  // si lo contáramos, el panel se desmontaría ANTES de confirmar el valor elegido
  // (cazado en E2E: elegir «60 FPS» no se comprometía nunca).
  useEffect(() => {
    if (!openId) return;
    const onDown = (ev: PointerEvent) => {
      const target = ev.target as Node | null;
      if (barRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-radix-popper-content-wrapper], [role="dialog"], [role="listbox"], [role="menu"]')) return;
      setOpenId(null);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpenId(null);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [openId]);

  const ready = useGameStore((s) => s.ready);
  const paused = useGameStore((s) => s.paused);
  const speed = useGameStore((s) => s.speed);
  const camMode = useGameStore((s) => s.camMode);
  const spyTargetId = useGameStore((s) => s.spyTargetId);
  const residentsUi = useGameStore((s) => s.residentsUi);
  const clock = useGameStore((s) => s.clock);
  const weather = useGameStore((s) => s.weather);
  const saveState = useGameStore((s) => s.saveState);
  const savedAt = useGameStore((s) => s.savedAt);

  // ── Acordeón del MENÚ (una sección abierta; null = todo plegado) ──
  const [acc, setAcc] = useState<string | null>(null);
  const toggleAcc = useCallback((id: string) => setAcc((cur) => (cur === id ? null : id)), []);

  const hh = String(Math.floor(clock.minute / 60)).padStart(2, '0');
  const mm = String(clock.minute % 60).padStart(2, '0');
  const w = WEATHER_UI[weather] ?? WEATHER_UI.sunny!;
  const WeatherIcon = w.icon;

  const spyNeighbors = residentsUi.filter((r) => r.present);

  return (
    <div ref={barRef} className="postit-bar relative rounded-xl px-3 py-2">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-2">
        {/* ── POST-IT: MENÚ (acordeón Tiempo · Opciones · Partida · Ayuda · Multijugador) ── */}
        <PostIt
          id="menu"
          openId={openId}
          onToggle={toggle}
          icon={<InkMenu />}
          label={t('postit.menu')}
          ariaLabel={t('postit.menuAria')}
          paper="yellow"
          tilt={-2}
          panelWidth={460}
        >
          <div className="flex flex-col gap-1.5">
            {/* TIEMPO: pausa + velocidades + +10 min */}
            <section className="sketchy-thin overflow-hidden bg-white/40" data-acc="tiempo">
              <button
                type="button"
                className="ink flex w-full items-center gap-2 px-2.5 py-1.5 text-xs font-bold"
                aria-expanded={acc === 'tiempo'}
                onClick={() => toggleAcc('tiempo')}
              >
                <InkClock className="size-4" />
                {t('postit.time')}
                <span className="ml-auto text-[10px]" aria-hidden>{acc === 'tiempo' ? '▾' : '▸'}</span>
              </button>
              <div className="acc-body" data-open={acc === 'tiempo'}>
                <div className="min-h-0">
                <div className="px-2.5 pb-2">
                  <div className="flex flex-wrap gap-1.5">
                    <DoodleButton
                      onClick={() => getController()?.togglePauseMenu()}
                      disabled={!ready}
                      ariaLabel={paused ? t('ctrl.pauseAria') : t('ctrl.pauseAriaOn')}
                      active={paused}
                    >
                      {paused ? <InkPlay /> : <InkPause />}
                      {paused ? t('ctrl.resume') : t('ctrl.pause')}
                    </DoodleButton>
                    {([1, 3, 10] as Speed[]).map((s) => (
                      <DoodleButton
                        key={s}
                        onClick={() => getController()?.setSpeed(s)}
                        disabled={!ready}
                        active={speed === s}
                        ariaLabel={t('ctrl.speedAria', { s: `${s}x` })}
                        ariaPressed={speed === s}
                      >
                        {s}x
                      </DoodleButton>
                    ))}
                    <DoodleButton onClick={() => getController()?.skipTime()} disabled={!ready} ariaLabel={t('ctrl.skipAria')}>
                      <InkSkip />
                      {t('ctrl.skip')}
                    </DoodleButton>
                  </div>
                </div>
                </div>
              </div>
            </section>

            {/* OPCIONES: el panel completo vive en OptionsPanel (compartido con la pausa) */}
            <section className="sketchy-thin overflow-hidden bg-white/40" data-acc="opciones">
              <button
                type="button"
                className="ink flex w-full items-center gap-2 px-2.5 py-1.5 text-xs font-bold"
                aria-expanded={acc === 'opciones'}
                onClick={() => toggleAcc('opciones')}
              >
                <InkGear className="size-4" />
                {t('postit.options')}
                <span className="ml-auto text-[10px]" aria-hidden>{acc === 'opciones' ? '▾' : '▸'}</span>
              </button>
              <div className="acc-body" data-open={acc === 'opciones'}>
                <div className="min-h-0">
                <div className="px-2.5 pb-2">
                  <OptionsPanel />
                </div>
                </div>
              </div>
            </section>

            {/* PARTIDA: guardar / cargar */}
            <section className="sketchy-thin overflow-hidden bg-white/40" data-acc="partida">
              <button
                type="button"
                className="ink flex w-full items-center gap-2 px-2.5 py-1.5 text-xs font-bold"
                aria-expanded={acc === 'partida'}
                onClick={() => toggleAcc('partida')}
              >
                <InkSave className="size-4" />
                {t('postit.game')}
                <span className="ml-auto text-[10px]" aria-hidden>{acc === 'partida' ? '▾' : '▸'}</span>
              </button>
              <div className="acc-body" data-open={acc === 'partida'}>
                <div className="min-h-0">
                <div className="flex flex-col items-start gap-1.5 px-2.5 pb-2">
                  <DoodleButton
                    onClick={() => void getController()?.save()}
                    disabled={!ready || saveState === 'saving'}
                    ariaLabel={t('ctrl.saveAria')}
                    title={
                      saveState === 'saved' && savedAt
                        ? t('ctrl.saveTitleSaved', { t: savedAt })
                        : saveState === 'saving'
                          ? t('ctrl.saveTitleSaving')
                          : t('ctrl.saveTitle')
                    }
                  >
                    {saveState === 'saved' ? '✓' : '→'} {t('ctrl.save')}
                  </DoodleButton>
                  <DoodleButton onClick={() => void getController()?.load()} disabled={!ready} ariaLabel={t('ctrl.loadAria')}>
                    ← {t('ctrl.load')}
                  </DoodleButton>
                </div>
                </div>
              </div>
            </section>

            {/* AYUDA: chuleta de controles */}
            <section className="sketchy-thin overflow-hidden bg-white/40" data-acc="ayuda">
              <button
                type="button"
                className="ink flex w-full items-center gap-2 px-2.5 py-1.5 text-xs font-bold"
                aria-expanded={acc === 'ayuda'}
                onClick={() => toggleAcc('ayuda')}
              >
                <InkQuestion className="size-4" />
                {t('postit.help')}
                <span className="ml-auto text-[10px]" aria-hidden>{acc === 'ayuda' ? '▾' : '▸'}</span>
              </button>
              <div className="acc-body" data-open={acc === 'ayuda'}>
                <div className="min-h-0">
                <div className="px-2.5 pb-2">
                  <HelpCard flat />
                </div>
                </div>
              </div>
            </section>

            {/* MULTIJUGADOR: abre el panel de sesión (diálogo) */}
            <section className="sketchy-thin overflow-hidden bg-white/40" data-acc="jugadores">
              <button
                type="button"
                className="ink flex w-full items-center gap-2 px-2.5 py-1.5 text-xs font-bold"
                aria-expanded={acc === 'jugadores'}
                onClick={() => toggleAcc('jugadores')}
              >
                <InkPeople className="size-4" />
                {t('postit.players')}
                <span className="ml-auto text-[10px]" aria-hidden>{acc === 'jugadores' ? '▾' : '▸'}</span>
              </button>
              <div className="acc-body" data-open={acc === 'jugadores'}>
                <div className="min-h-0">
                <div className="px-2.5 pb-2">
                  <DoodleButton
                    onClick={() => {
                      useGameStore.getState().setMpPanelOpen(true);
                      setOpenId(null);
                    }}
                    ariaLabel={t('ctrl.multiAria')}
                  >
                    {t('postit.openPanel')}
                  </DoodleButton>
                </div>
                </div>
              </div>
            </section>
          </div>
        </PostIt>

        {/* ── POST-IT: CÁMARA (icono + modo vigente; tooltip con las teclas 1-5;
            dentro, selector del vecino al que espiar) ── */}
        <PostIt
          id="camara"
          openId={openId}
          onToggle={toggle}
          icon={<InkCamera />}
          label={t(`ctrl.cam.${camMode}`)}
          ariaLabel={`${t('ctrl.camGroup')}: ${t(`ctrl.cam.${camMode}`)}`}
          tooltip={t('ctrl.camTooltip')}
          paper="blue"
          tilt={1.5}
          panelWidth={280}
        >
          <p className="ink mb-2 flex items-center gap-1.5 text-xs font-bold">
            <InkCamera className="size-4" />
            {t('ctrl.camGroup')}
          </p>
          <div className="flex flex-col items-stretch gap-1" role="group" aria-label={t('ctrl.camGroup')}>
            {CAMS.map((c) => (
              <button
                key={c.value}
                type="button"
                className="cam-btn sketchy-thin w-full !justify-start"
                onClick={() => getController()?.setCamMode(c.value)}
                disabled={!ready}
                aria-pressed={camMode === c.value}
                aria-label={t('ctrl.camAria', { c: t(`ctrl.cam.${c.value}`) })}
              >
                <kbd className="rounded border border-current/30 px-1 font-mono text-[10px] leading-4 opacity-80" aria-hidden>
                  {c.keyLabel}
                </kbd>
                {t(`ctrl.cam.${c.value}`)}
              </button>
            ))}
          </div>
          {/* v1.65 — ESPÍA: elegir a qué vecino seguir (cámara tipo Planta sobre él). */}
          <p className="ink mt-2 mb-1 flex items-center gap-1.5 text-xs font-bold">
            <span aria-hidden>🕵️</span>
            {t('ctrl.camSpyPick')}
          </p>
          {spyNeighbors.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t('ev.spyNone')}</p>
          ) : (
            <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto pr-1" role="listbox" aria-label={t('ctrl.camSpyPick')}>
              {spyNeighbors.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={spyTargetId === r.id}
                  className="postit-btn sketchy-thin !py-0.5 !text-[11px]"
                  data-active={spyTargetId === r.id || undefined}
                  data-spy-id={r.id}
                  title={t('ctrl.camSpyHere', { name: r.name })}
                  onClick={() => getController()?.setCamMode('espia', r.id)}
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
        </PostIt>

        {/* ── CUADERNO: Misiones · Edificio · Vecinos · Logros (panel sobre el escenario) ── */}
        <InfoTabButtons />

        {/* ── Iconitos de arriba: día/hora + meteorología ── */}
        <div className="ml-auto mt-2 flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs font-semibold whitespace-nowrap"
            aria-label={t('hud.clockAria')}
          >
            <InkClock className="size-4" />
            {t('hud.day', { d: clock.day })} · {hh}:{mm}
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs whitespace-nowrap"
            aria-label={t('hud.weatherAria', { w: t(`weather.${weather}`) })}
          >
            <WeatherIcon className={cn('size-3.5', w.className)} aria-hidden />
            {t(`weather.${weather}`)}
          </span>
        </div>
      </div>

      {/* Panel de multijugador (diálogo; vive aquí para que lo abra el MENÚ) */}
      <MultiplayerPanel />
    </div>
  );
}
