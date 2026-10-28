'use client';

/**
 * V1.23 — MANDOS COMO POST-ITS DIBUJADOS A BOLÍGRAFO.
 * La barra de mandos se reorganiza en post-its adhesivos con un icono "a bolígrafo"
 * (tinta azul) de aquello que contienen: al pulsar, el post-it crece en un panel de
 * papel más grande con las opciones como garabatos pulsables.
 *   · TIEMPO: pausa, 1x/3x/10x y +10 min (absorbe el botón suelto de +10).
 *   · Opciones (engranaje): absorbe Sonido, Táctil, calidad de render, contador FPS
 *     e idioma — el modal de opciones desaparece en favor de este post-it.
 *     v1.38 — PASE DE OPTIMIZACIÓN: añade el AUTO-AJUSTE DE RENDIMIENTO (interruptor)
 *     y su OBJETIVO DE FPS (Máximo/60/45/30), con línea de estado en vivo (FPS medidos
 *     y peldaño del optimizador) — «asegurar al menos 30 FPS o más, cuanto más mejor».
 *   · Partida: guardar / cargar.
 *   · Ayuda (¿?), Jugadores (multijugador).
 * Las CÁMARAS quedan desplegadas en línea (se usan continuamente) con la misma
 * estética de tinta. "Fiesta demo" se retira: las fiestas las organizan los vecinos.
 * Los iconitos de día/hora y meteorología viven al final de la barra.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CloudLightning,
  CloudRain,
  CloudSun,
  Sun,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MultiplayerPanel } from '@/components/game/MultiplayerPanel';
import { HelpCard } from '@/components/game/HelpCard';
import { useGameStore } from '@/game/client/store';
import type { CamMode, Speed } from '@/game/client/store';
import { getController } from '@/game/client/bridge';
import { getVolume, setMuted, setVolume } from '@/game/client/audio';
import { loadOptions, saveOptionsPartial, type QualityLevel, type Lang, type PerfTarget } from '@/game/client/options';
import { PERF_LADDER_SIZE } from '@/game/client/perf';
import { useT, LANGUAGES } from '@/game/client/i18n';
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

/** Altavoz con ondas (sonido dentro de opciones). */
function InkSpeaker({ muted, className }: InkProps & { muted?: boolean }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 9.6l4.2-.3 4.6-3.8c.3 4.4.3 8.7 0 13.1L8.3 14.7 4 14.4c-.3-1.6-.3-3.2 0-4.8z" />
      {muted ? (
        <path d="M16 9.4l5 5.2m0-5.2l-5 5.2" />
      ) : (
        <>
          <path d="M15.8 9.2c1.5 1.6 1.5 4 0 5.6" />
          <path d="M18.4 7c2.7 2.9 2.7 7.1 0 10" />
        </>
      )}
    </svg>
  );
}

/** Mano abierta (mandos táctiles dentro de opciones). */
function InkHand({ className }: InkProps) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M8 12.5V5.8c0-1.9 2.9-1.9 2.9 0V11m0-6.2c0-1.8 2.8-1.8 2.8 0V11m0-5.1c0-1.7 2.7-1.7 2.7 0v6.8m0-3.9c1.8-.4 2.7.6 2.5 2.4-.3 2.8-.9 5-2 6.9-1 1.7-2.6 2.5-4.9 2.5-2.1 0-3.6-.6-4.7-2.1L4.6 15c-1.1-1.6.9-3.4 2.4-2.1l1 1" />
    </svg>
  );
}

/** Pausa (dos barras temblorosas). */
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

/** Moneda con símbolo de euro (economía). */
function InkCoin({ className }: InkProps) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12.1 3.3c4.7-.2 8.4 3.6 8.3 8.4-.1 4.8-3.7 8.9-8.5 8.9-4.6 0-8.4-3.8-8.3-8.6.1-4.6 3.9-8.5 8.5-8.7z" />
      <path d="M14.8 8.6c-1.6-1.1-3.7-.7-4.6.9-.9 1.5-.9 3.5 0 5 1 1.6 3 2 4.6.9M7.8 10.7l4.4-.1m-4.4 2.8l4.4-.1" />
    </svg>
  );
}

/** Velocímetro garabateado (v1.38: rendimiento/auto-ajuste). */
function InkGauge({ className }: InkProps) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4.3 17.6a8.3 8.3 0 1 1 15.4 0" />
      <path d="M12 15.8l4.4-5.6" />
      <circle cx="12" cy="16.4" r="1.5" />
      <path d="M5.2 17.4h1.6m10.4 0h1.6" />
    </svg>
  );
}

/** Rajita de hucha rota (efecto de pérdida). */
function InkCrack({ className }: InkProps) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M13 2.5l-3.5 6 4.2 1.6-3.9 6.2 4.6 1.7-2.5 4" />
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
        aria-label={label}
        title={label}
        onClick={() => onToggle(id)}
      >
        {icon}
        <span className="text-[10px] font-bold leading-none">{label}</span>
      </button>
      {open && (
        <div
          role="group"
          aria-label={label}
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

/**
 * v1.38 — Línea de estado del rendimiento en el post-it de opciones: FPS medidos y
 * peldaño del optimizador. Vive en un componente aparte para que el contador (que se
 * actualiza cada ~200 ms) no re-renderice la barra entera de post-its.
 */
function PerfStatus() {
  const t = useT();
  const ready = useGameStore((s) => s.ready);
  const fps = useGameStore((s) => s.fps);
  const perfAuto = useGameStore((s) => s.perfAuto);
  const perfLevel = useGameStore((s) => s.perfLevel);
  if (!ready) return null;
  return (
    <p className="mt-2.5 border-t border-dashed pt-1.5 text-[10px] opacity-70" role="status" aria-live="off">
      {perfAuto
        ? t('opt.perf.status', { n: fps, s: t(`opt.perf.level.${Math.min(perfLevel, PERF_LADDER_SIZE - 1)}`) })
        : t('opt.perf.statusManual')}
    </p>
  );
}

// ── Cámara desplegada en línea (acceso rápido, estética a bolígrafo) ──

const CAMS: ReadonlyArray<{ value: CamMode }> = [
  { value: 'edificio' },
  { value: 'planta' },
  { value: 'estancia' },
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
  const clock = useGameStore((s) => s.clock);
  const weather = useGameStore((s) => s.weather);
  const saveState = useGameStore((s) => s.saveState);
  const savedAt = useGameStore((s) => s.savedAt);
  const touchVisible = useGameStore((s) => s.touchVisible);
  const setTouchControls = useGameStore((s) => s.setTouchControls);
  const muted = useGameStore((s) => s.soundMuted);
  const setSoundMuted = useGameStore((s) => s.setSoundMuted);
  const fpsVisible = useGameStore((s) => s.fpsVisible);
  const setFpsVisible = useGameStore((s) => s.setFpsVisible);
  const lang = useGameStore((s) => s.lang);
  const setLang = useGameStore((s) => s.setLang);
  // v1.38 — pase de optimización: preferencias espejo + conmutación en vivo vía controlador.
  const perfAuto = useGameStore((s) => s.perfAuto);
  const perfTarget = useGameStore((s) => s.perfTarget);
  const setPerfAuto = useGameStore((s) => s.setPerfAuto);
  const setPerfTarget = useGameStore((s) => s.setPerfTarget);
  const backend = useGameStore((s) => s.backend);

  const [vol, setVol] = useState(() => Math.round(getVolume() * 100));
  const [quality, setQuality] = useState<QualityLevel>(() => loadOptions().quality);

  const hh = String(Math.floor(clock.minute / 60)).padStart(2, '0');
  const mm = String(clock.minute % 60).padStart(2, '0');
  const w = WEATHER_UI[weather] ?? WEATHER_UI.sunny!;
  const WeatherIcon = w.icon;

  return (
    <div ref={barRef} className="postit-bar relative rounded-xl px-3 py-2">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        {/* ── POST-IT: TIEMPO DE JUEGO (pausa + velocidades + +10 min) ── */}
        <PostIt
          id="tiempo"
          openId={openId}
          onToggle={toggle}
          icon={<InkClock />}
          label={t('postit.time')}
          paper="yellow"
          tilt={-2}
          panelWidth={276}
        >
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold">
            <InkClock className="size-4" />
            {t('postit.time')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <DoodleButton
              onClick={() => getController()?.togglePause()}
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
        </PostIt>

        {/* ── CÁMARAS DESPLEGADAS (uso continuo, fuera del post-it) ── */}
        <div
          role="group"
          aria-label={t('ctrl.camGroup')}
          className="mt-2.5 inline-flex items-center gap-1"
        >
          <span className="ink mr-0.5 hidden text-[11px] font-bold opacity-70 sm:inline">{t('postit.cameras')}</span>
          {CAMS.map((c, i) => (
            <button
              key={c.value}
              type="button"
              className={cn('cam-btn', i % 2 === 0 ? 'sketchy' : 'sketchy-alt')}
              onClick={() => getController()?.setCamMode(c.value)}
              disabled={!ready}
              aria-pressed={camMode === c.value}
              aria-label={t('ctrl.camAria', { c: t(`ctrl.cam.${c.value}`) })}
            >
              {t(`ctrl.cam.${c.value}`)}
            </button>
          ))}
        </div>

        {/* ── POST-IT: OPCIONES (engranaje; absorbe sonido/táctil/calidad/fps/idioma) ── */}
        <PostIt
          id="opciones"
          openId={openId}
          onToggle={toggle}
          icon={<InkGear />}
          label={t('postit.options')}
          paper="pink"
          tilt={1.6}
          panelWidth={330}
        >
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold">
            <InkGear className="size-4" />
            {t('postit.options')}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Sonido */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const v = !muted;
                    setSoundMuted(v);
                    setMuted(v);
                  }}
                  className="ink flex items-center gap-1.5 text-xs font-semibold"
                  aria-pressed={muted}
                  aria-label={muted ? t('ctrl.soundAriaOn') : t('ctrl.soundAriaOff')}
                >
                  <InkSpeaker muted={muted} />
                  {muted ? t('ctrl.soundOff') : t('ctrl.soundOn')}
                </button>
                <span className="text-xs tabular-nums opacity-70">{vol}%</span>
              </div>
              <Slider
                value={[vol]}
                min={0}
                max={100}
                step={5}
                onValueChange={(v) => {
                  const pct = v[0] ?? Math.round(getVolume() * 100);
                  setVol(pct);
                  setVolume(pct / 100);
                }}
                disabled={muted}
                aria-label={t('opt.volumeAria')}
              />
              <div className="flex items-center justify-between rounded-md border border-dashed px-2 py-1.5">
                <Label htmlFor="pt-tactil" className="ink flex cursor-pointer items-center gap-1.5 text-xs font-semibold">
                  <InkHand />
                  {t('ctrl.touch')}
                </Label>
                <Switch
                  id="pt-tactil"
                  checked={touchVisible}
                  onCheckedChange={(v) => {
                    setTouchControls(v);
                    if (v) {
                      const hint = useGameStore.getState().touchHint;
                      if (hint) useGameStore.getState().pushToast(hint, 'info');
                    }
                  }}
                  aria-label={touchVisible ? t('ctrl.touchHide') : t('ctrl.touchShow')}
                />
              </div>
            </div>
            {/* Gráficos e idioma */}
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-md border border-dashed px-2 py-1.5">
                <Label htmlFor="pt-fps" className="ink cursor-pointer text-xs font-semibold">
                  {t('opt.fps')}
                </Label>
                <Switch
                  id="pt-fps"
                  checked={fpsVisible}
                  onCheckedChange={(v) => {
                    setFpsVisible(v);
                    saveOptionsPartial({ fpsVisible: v });
                  }}
                  aria-label={t('opt.fpsAria')}
                />
              </div>
              <div className="space-y-1">
                <p className="ink text-[11px] font-semibold opacity-80">{t('opt.quality')}</p>
                <Select
                  value={quality}
                  onValueChange={(q) => {
                    const next = q as QualityLevel;
                    setQuality(next);
                    saveOptionsPartial({ quality: next });
                    getController()?.applyQuality(next);
                  }}
                >
                  <SelectTrigger className="h-7 text-xs" aria-label={t('opt.quality')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['alta', 'normal', 'eco'] as QualityLevel[]).map((q) => (
                      <SelectItem key={q} value={q}>
                        {t(`opt.quality.${q}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* v1.38 — AUTO-AJUSTE DE RENDIMIENTO + OBJETIVO DE FPS (pase de optimización) */}
              <div className="flex items-center justify-between rounded-md border border-dashed px-2 py-1.5">
                <Label
                  htmlFor="pt-perf"
                  className="ink flex cursor-pointer items-center gap-1.5 text-xs font-semibold"
                  title={t('opt.perfAutoHelp')}
                >
                  <InkGauge />
                  {t('opt.perfAuto')}
                </Label>
                <Switch
                  id="pt-perf"
                  checked={perfAuto}
                  onCheckedChange={(v) => {
                    setPerfAuto(v);
                    saveOptionsPartial({ perfAuto: v });
                    getController()?.applyPerfAuto(v);
                  }}
                  aria-label={t('opt.perfAutoAria')}
                />
              </div>
              <div className="space-y-1">
                <p className="ink text-[11px] font-semibold opacity-80">{t('opt.perfTarget')}</p>
                <Select
                  value={String(perfTarget)}
                  disabled={!perfAuto}
                  onValueChange={(v) => {
                    const next = (v === 'max' ? 'max' : Number(v)) as PerfTarget;
                    setPerfTarget(next);
                    saveOptionsPartial({ perfTarget: next });
                    getController()?.applyPerfTarget(next);
                  }}
                >
                  <SelectTrigger className="h-7 text-xs" aria-label={t('opt.perfTargetAria')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['max', 60, 45, 30] as const).map((v) => (
                      <SelectItem key={String(v)} value={String(v)}>
                        {t(`opt.perf.${v}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="ink text-[11px] font-semibold opacity-80">{t('opt.language')}</p>
                <Select
                  value={lang}
                  onValueChange={(l) => {
                    setLang(l as Lang);
                    saveOptionsPartial({ lang: l as Lang });
                  }}
                >
                  <SelectTrigger className="h-7 text-xs" aria-label={t('opt.languageAria')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          {backend && (
            <p className="mt-2.5 border-t border-dashed pt-1.5 text-[10px] opacity-70">{t('opt.backend', { b: backend })}</p>
          )}
          {/* v1.38 — FPS medidos + peldaño del optimizador, en vivo */}
          <PerfStatus />
        </PostIt>

        {/* ── POST-IT: PARTIDA (guardar / cargar) ── */}
        <PostIt
          id="partida"
          openId={openId}
          onToggle={toggle}
          icon={<InkSave />}
          label={t('postit.game')}
          paper="green"
          tilt={-1.4}
          panelWidth={230}
        >
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold">
            <InkSave className="size-4" />
            {t('postit.game')}
          </p>
          <div className="flex flex-col items-start gap-1.5">
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
        </PostIt>

        {/* ── POST-IT: AYUDA (¿?) ── */}
        <PostIt
          id="ayuda"
          openId={openId}
          onToggle={toggle}
          icon={<InkQuestion />}
          label={t('postit.help')}
          paper="blue"
          tilt={2}
          panelWidth={380}
          panelSide="right"
        >
          <HelpCard flat />
        </PostIt>

        {/* ── POST-IT: JUGADORES (multijugador) ── */}
        <PostIt
          id="jugadores"
          openId={openId}
          onToggle={toggle}
          icon={<InkPeople />}
          label={t('postit.players')}
          paper="orange"
          tilt={-1.8}
          panelWidth={220}
          panelSide="right"
        >
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold">
            <InkPeople className="size-4" />
            {t('postit.players')}
          </p>
          <DoodleButton
            onClick={() => {
              useGameStore.getState().setMpPanelOpen(true);
              setOpenId(null);
            }}
            ariaLabel={t('ctrl.multiAria')}
          >
            {t('postit.openPanel')}
          </DoodleButton>
        </PostIt>

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

      {/* Panel de multijugador (diálogo; vive aquí para que lo abran los post-its) */}
      <MultiplayerPanel />
    </div>
  );
}
