'use client';

import {
  Building2,
  Check,
  FastForward,
  FolderOpen,
  Lamp,
  Layers,
  Loader2,
  PartyPopper,
  Pause,
  Play,
  Save,
  Hand,
  Settings,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useGameStore } from '@/game/client/store';
import type { CamMode, Speed } from '@/game/client/store';
import { MultiplayerPanel } from '@/components/game/MultiplayerPanel';
import { cn } from '@/lib/utils';
import { isMuted, setMuted } from '@/game/client/audio';
import { useT } from '@/game/client/i18n';

interface ControlsBarProps {
  onTogglePause: () => void;
  onSetSpeed: (s: Speed) => void;
  onSetCam: (m: CamMode) => void;
  onParty: () => void;
  onSkipTime: () => void;
  onSave: () => void;
  onLoad: () => void;
}

const SPEEDS: ReadonlyArray<{ value: Speed }> = [
  { value: 1 },
  { value: 3 },
  { value: 10 },
];

const CAMS: ReadonlyArray<{ value: CamMode; icon: LucideIcon }> = [
  { value: 'edificio', icon: Building2 },
  { value: 'planta', icon: Layers },
  { value: 'estancia', icon: Lamp },
];

export function ControlsBar({
  onTogglePause,
  onSetSpeed,
  onSetCam,
  onParty,
  onSkipTime,
  onSave,
  onLoad,
}: ControlsBarProps) {
  const t = useT();
  const ready = useGameStore((s) => s.ready);
  const paused = useGameStore((s) => s.paused);
  const speed = useGameStore((s) => s.speed);
  const camMode = useGameStore((s) => s.camMode);
  const saveState = useGameStore((s) => s.saveState);
  const savedAt = useGameStore((s) => s.savedAt);
  const touchVisible = useGameStore((s) => s.touchVisible);
  const setTouchControls = useGameStore((s) => s.setTouchControls);
  const muted = useGameStore((s) => s.soundMuted);
  const setSoundMuted = useGameStore((s) => s.setSoundMuted);

  return (
    <Card className="gap-2 py-3">
      <CardContent className="flex flex-wrap items-center gap-2 px-3">
        {/* Pausa / Reanudar */}
        <Button
          size="sm"
          variant="outline"
          onClick={onTogglePause}
          disabled={!ready}
          aria-label={paused ? t('ctrl.pauseAria') : t('ctrl.pauseAriaOn')}
        >
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          {paused ? t('ctrl.resume') : t('ctrl.pause')}
        </Button>

        {/* Velocidad */}
        <div
          role="group"
          aria-label={t('ctrl.speedGroup')}
          className="inline-flex items-center gap-0.5 rounded-md border bg-muted/40 p-0.5"
        >
          {SPEEDS.map((s) => (
            <Button
              key={s.value}
              size="sm"
              variant="ghost"
              className={cn(
                'h-7 px-2.5',
                speed === s.value && 'bg-amber-500/20 font-semibold text-amber-700 dark:text-amber-400',
              )}
              onClick={() => onSetSpeed(s.value)}
              disabled={!ready}
              aria-pressed={speed === s.value}
              aria-label={t('ctrl.speedAria', { s: `${s.value}x` })}
            >
              {s.value}x
            </Button>
          ))}
        </div>

        {/* Cámara */}
        <div
          role="group"
          aria-label={t('ctrl.camGroup')}
          className="inline-flex items-center gap-0.5 rounded-md border bg-muted/40 p-0.5"
        >
          {CAMS.map((c) => {
            const Icon = c.icon;
            const active = camMode === c.value;
            return (
              <Button
                key={c.value}
                size="sm"
                variant="ghost"
                className={cn(
                  'h-7 px-2.5',
                  active && 'bg-amber-500/20 font-semibold text-amber-700 dark:text-amber-400',
                )}
                onClick={() => onSetCam(c.value)}
                disabled={!ready}
                aria-pressed={active}
                aria-label={t('ctrl.camAria', { c: t(`ctrl.cam.${c.value}`) })}
              >
                <Icon className="size-3.5" aria-hidden />
                {t(`ctrl.cam.${c.value}`)}
              </Button>
            );
          })}
        </div>

        {/* Fiesta demo */}
        <Button
          size="sm"
          variant="secondary"
          onClick={onParty}
          disabled={!ready}
          title={t('ctrl.partyTitle')}
          aria-label={t('ctrl.partyAria')}
        >
          <PartyPopper aria-hidden />
          {t('ctrl.party')}
        </Button>

        {/* Saltar tiempo */}
        <Button
          size="sm"
          variant="outline"
          onClick={onSkipTime}
          disabled={!ready}
          aria-label={t('ctrl.skipAria')}
        >
          <FastForward aria-hidden />
          {t('ctrl.skip')}
        </Button>

        {/* Guardar */}
        <Button
          size="sm"
          variant="outline"
          onClick={onSave}
          disabled={!ready || saveState === 'saving'}
          title={
            saveState === 'saved' && savedAt
              ? t('ctrl.saveTitleSaved', { t: savedAt })
              : saveState === 'saving'
                ? t('ctrl.saveTitleSaving')
                : t('ctrl.saveTitle')
          }
          aria-label={t('ctrl.saveAria')}
        >
          {saveState === 'saving' ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : saveState === 'saved' ? (
            <Check className="text-emerald-500" aria-hidden />
          ) : (
            <Save aria-hidden />
          )}
          {t('ctrl.save')}
        </Button>

        {/* Cargar */}
        <Button
          size="sm"
          variant="outline"
          onClick={onLoad}
          disabled={!ready}
          aria-label={t('ctrl.loadAria')}
        >
          <FolderOpen aria-hidden />
          {t('ctrl.load')}
        </Button>

        {/* Mandos táctiles */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setTouchControls(!touchVisible);
            if (!touchVisible) {
              const hint = useGameStore.getState().touchHint;
              if (hint) useGameStore.getState().pushToast(hint, 'info');
            }
          }}
          disabled={!ready}
          aria-pressed={touchVisible}
          aria-label={touchVisible ? t('ctrl.touchHide') : t('ctrl.touchShow')}
        >
          <Hand aria-hidden />
          {t('ctrl.touch')}
        </Button>

        {/* Sonido */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const v = !muted;
            setSoundMuted(v);
            setMuted(v);
          }}
          aria-pressed={muted}
          aria-label={muted ? t('ctrl.soundAriaOn') : t('ctrl.soundAriaOff')}
        >
          {muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
          {muted ? t('ctrl.soundOff') : t('ctrl.soundOn')}
        </Button>

        {/* Opciones */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => useGameStore.getState().setOptionsOpen(true)}
          aria-label={t('ctrl.optionsAria')}
        >
          <Settings aria-hidden />
          {t('ctrl.options')}
        </Button>

        {/* Multijugador */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => useGameStore.getState().setMpPanelOpen(true)}
          aria-label={t('ctrl.multiAria')}
        >
          <Users aria-hidden />
          {t('ctrl.multiplayer')}
        </Button>
      </CardContent>
      <MultiplayerPanel />
    </Card>
  );
}
