'use client';

/**
 * PANEL DE OPCIONES (v1.39) — antes vivía dentro del post-it «Opciones» de la barra;
 * ahora es un componente compartido: el post-it lo usa plegado y el MENÚ DE PAUSA lo
 * usa desplegado a pantalla completa. Contiene: sonido, táctil, FPS, calidad de render,
 * auto-ajuste de rendimiento (v1.38), idioma y —nuevo v1.39— MÚSICA y ACCESIBILIDAD
 * (tamaño de texto, modo daltónico y reducir animaciones). Todo se aplica al momento y
 * persiste en localStorage (options.ts). Nunca toca el sim.
 */

import { useState } from 'react';

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
import { useGameStore } from '@/game/client/store';
import { getController } from '@/game/client/bridge';
import { getVolume, setMuted, setVolume } from '@/game/client/audio';
import { loadOptions, saveOptionsPartial, type ColorblindMode, type Lang, type PerfTarget, type QualityLevel, type TextScale } from '@/game/client/options';
import { PERF_LADDER_SIZE } from '@/game/client/perf';
import { useT, LANGUAGES } from '@/game/client/i18n';
import { cn } from '@/lib/utils';

const INK = '#274b8f';

/** Engranaje a mano (cabecera del panel). */
export function InkGear({ className }: { className?: string }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 2.8l1 2.5 2.6-.8 1 2.3 2.6.2-.4 2.6 2.2 1.5-1.7 2 1.1 2.4-2.5.9.2 2.6-2.6-.3-1.3 2.3-2.2-1.4-2.2 1.5-1.4-2.2-2.6.4.1-2.7-2.4-1 1.6-2.1-1.3-2.3 2.5-.8v-2.6l2.6.4z" />
    </svg>
  );
}

/** Altavoz con ondas (sonido). */
function InkSpeaker({ muted, className }: { muted?: boolean; className?: string }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 9.6l4.2-.3 4.6-3.8c.3 4.4.3 8.7 0 13.1L8.3 14.7 4 14.4c-.3-1.6-.3-3.2 0-4.8z" />
      {muted ? <path d="M16 9.4l5 5.2m0-5.2l-5 5.2" /> : <path d="M15.8 9.2c1.5 1.6 1.5 4 0 5.6" />}
    </svg>
  );
}

/** Mano abierta (mandos táctiles). */
function InkHand({ className }: { className?: string }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M8 12.5V5.8c0-1.9 2.9-1.9 2.9 0V11m0-6.2c0-1.8 2.8-1.8 2.8 0V11m0-5.1c0-1.7 2.7-1.7 2.7 0v6.8m0-3.9c1.8-.4 2.7.6 2.5 2.4-.3 2.8-.9 5-2 6.9-1 1.7-2.6 2.5-4.9 2.5-2.1 0-3.6-.6-4.7-2.1L4.6 15c-1.1-1.6.9-3.4 2.4-2.1l1 1" />
    </svg>
  );
}

/** Nota musical garabateada (música). */
function InkMusic({ className }: { className?: string }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9.4 18.2V5.6l8.4-1.8v11.6" />
      <circle cx="7" cy="18.4" r="2.4" />
      <circle cx="15.4" cy="15.6" r="2.4" />
    </svg>
  );
}

/** Ojo a mano (accesibilidad). */
function InkEye({ className }: { className?: string }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M2.8 12.2C5 7.9 8.3 5.9 12 5.9s7 2 9.2 6.3c-2.2 4.2-5.5 6.2-9.2 6.2s-7-2-9.2-6.2z" />
      <circle cx="12" cy="12.2" r="2.7" />
    </svg>
  );
}

/**
 * v1.38 — Línea de estado del rendimiento: FPS medidos y peldaño del optimizador.
 * Componente aparte para que el contador (actualiza cada ~200 ms) no re-renderice el panel.
 */
export function PerfStatus() {
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

export function OptionsPanel({ className }: { className?: string }) {
  const t = useT();
  const ready = useGameStore((s) => s.ready);
  const touchVisible = useGameStore((s) => s.touchVisible);
  const setTouchControls = useGameStore((s) => s.setTouchControls);
  const muted = useGameStore((s) => s.soundMuted);
  const setSoundMuted = useGameStore((s) => s.setSoundMuted);
  const fpsVisible = useGameStore((s) => s.fpsVisible);
  const setFpsVisible = useGameStore((s) => s.setFpsVisible);
  const lang = useGameStore((s) => s.lang);
  const setLang = useGameStore((s) => s.setLang);
  const perfAuto = useGameStore((s) => s.perfAuto);
  const perfTarget = useGameStore((s) => s.perfTarget);
  const setPerfAuto = useGameStore((s) => s.setPerfAuto);
  const setPerfTarget = useGameStore((s) => s.setPerfTarget);
  // v1.39 — música + accesibilidad
  const music = useGameStore((s) => s.music);
  const setMusic = useGameStore((s) => s.setMusic);
  const textScale = useGameStore((s) => s.textScale);
  const setTextScale = useGameStore((s) => s.setTextScale);
  const colorblind = useGameStore((s) => s.colorblind);
  const setColorblind = useGameStore((s) => s.setColorblind);
  const reduceMotion = useGameStore((s) => s.reduceMotion);
  const setReduceMotion = useGameStore((s) => s.setReduceMotion);
  const backend = useGameStore((s) => s.backend);

  const [vol, setVol] = useState(() => Math.round(getVolume() * 100));
  const [quality, setQuality] = useState<QualityLevel>(() => loadOptions().quality);

  return (
    <div className={cn('grid gap-3 sm:grid-cols-2', className)}>
      {/* Sonido + táctil + música */}
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
        {/* v1.39 — música ambiental procedural */}
        <div className="flex items-center justify-between rounded-md border border-dashed px-2 py-1.5">
          <Label htmlFor="opt-musica" className="ink flex cursor-pointer items-center gap-1.5 text-xs font-semibold">
            <InkMusic />
            {t('opt.music')}
          </Label>
          <Switch
            id="opt-musica"
            checked={music}
            onCheckedChange={(v) => {
              setMusic(v);
              saveOptionsPartial({ music: v });
              getController()?.applyMusic(v);
            }}
            aria-label={t('opt.musicAria')}
          />
        </div>
        <div className="flex items-center justify-between rounded-md border border-dashed px-2 py-1.5">
          <Label htmlFor="opt-tactil" className="ink flex cursor-pointer items-center gap-1.5 text-xs font-semibold">
            <InkHand />
            {t('ctrl.touch')}
          </Label>
          <Switch
            id="opt-tactil"
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
          <Label htmlFor="opt-fps" className="ink cursor-pointer text-xs font-semibold">
            {t('opt.fps')}
          </Label>
          <Switch
            id="opt-fps"
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
        {/* v1.38 — AUTO-AJUSTE DE RENDIMIENTO + OBJETIVO DE FPS */}
        <div className="flex items-center justify-between rounded-md border border-dashed px-2 py-1.5">
          <Label
            htmlFor="opt-perf"
            className="ink flex cursor-pointer items-center gap-1.5 text-xs font-semibold"
            title={t('opt.perfAutoHelp')}
          >
            <span className="inline-block h-[18px] w-[18px] rounded-full border border-dashed text-center text-[9px] leading-[16px]" aria-hidden>
              ⏱
            </span>
            {t('opt.perfAuto')}
          </Label>
          <Switch
            id="opt-perf"
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

      {/* v1.39 — ACCESIBILIDAD: tamaño de texto, daltónico, reducir animaciones */}
      <div className="space-y-2 sm:col-span-2">
        <p className="ink flex items-center gap-1.5 text-[11px] font-semibold opacity-80">
          <InkEye />
          {t('opt.accessibility')}
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <p className="ink text-[10px] opacity-70">{t('opt.textScale')}</p>
            <Select
              value={textScale}
              onValueChange={(v) => {
                const next = v as TextScale;
                setTextScale(next);
                saveOptionsPartial({ textScale: next });
              }}
            >
              <SelectTrigger className="h-7 text-xs" aria-label={t('opt.textScaleAria')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['small', 'normal', 'large', 'huge'] as TextScale[]).map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`opt.textScale.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="ink text-[10px] opacity-70">{t('opt.colorblind')}</p>
            <Select
              value={colorblind}
              onValueChange={(v) => {
                const next = v as ColorblindMode;
                setColorblind(next);
                saveOptionsPartial({ colorblind: next });
              }}
            >
              <SelectTrigger className="h-7 text-xs" aria-label={t('opt.colorblindAria')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['off', 'protanopia', 'deuteranopia', 'tritanopia'] as ColorblindMode[]).map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(`opt.colorblind.${v}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border border-dashed px-2 py-1.5">
            <Label htmlFor="opt-motion" className="ink cursor-pointer text-xs font-semibold">
              {t('opt.reduceMotion')}
            </Label>
            <Switch
              id="opt-motion"
              checked={reduceMotion}
              onCheckedChange={(v) => {
                setReduceMotion(v);
                saveOptionsPartial({ reduceMotion: v });
              }}
              aria-label={t('opt.reduceMotionAria')}
            />
          </div>
        </div>
      </div>

      {ready && backend && (
        <p className="border-t border-dashed pt-1.5 text-[10px] opacity-70 sm:col-span-2">{t('opt.backend', { b: backend })}</p>
      )}
      <div className="sm:col-span-2">
        <PerfStatus />
      </div>
    </div>
  );
}
