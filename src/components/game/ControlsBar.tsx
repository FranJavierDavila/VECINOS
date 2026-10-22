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
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useGameStore } from '@/game/client/store';
import type { CamMode, Speed } from '@/game/client/store';
import { cn } from '@/lib/utils';

interface ControlsBarProps {
  onTogglePause: () => void;
  onSetSpeed: (s: Speed) => void;
  onSetCam: (m: CamMode) => void;
  onParty: () => void;
  onSkipTime: () => void;
  onSave: () => void;
  onLoad: () => void;
}

const SPEEDS: ReadonlyArray<{ value: Speed; label: string }> = [
  { value: 1, label: '1x' },
  { value: 3, label: '3x' },
  { value: 10, label: '10x' },
];

const CAMS: ReadonlyArray<{ value: CamMode; label: string; icon: LucideIcon }> = [
  { value: 'edificio', label: 'Edificio', icon: Building2 },
  { value: 'planta', label: 'Planta', icon: Layers },
  { value: 'estancia', label: 'Estancia', icon: Lamp },
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
  const ready = useGameStore((s) => s.ready);
  const paused = useGameStore((s) => s.paused);
  const speed = useGameStore((s) => s.speed);
  const camMode = useGameStore((s) => s.camMode);
  const saveState = useGameStore((s) => s.saveState);
  const savedAt = useGameStore((s) => s.savedAt);

  return (
    <Card className="gap-2 py-3">
      <CardContent className="flex flex-wrap items-center gap-2 px-3">
        {/* Pausa / Reanudar */}
        <Button
          size="sm"
          variant="outline"
          onClick={onTogglePause}
          disabled={!ready}
          aria-label={paused ? 'Reanudar la simulación' : 'Pausar la simulación'}
        >
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          {paused ? 'Reanudar' : 'Pausa'}
        </Button>

        {/* Velocidad */}
        <div
          role="group"
          aria-label="Velocidad de simulación"
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
              aria-label={`Velocidad ${s.label}`}
            >
              {s.label}
            </Button>
          ))}
        </div>

        {/* Cámara */}
        <div
          role="group"
          aria-label="Modo de cámara"
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
                aria-label={`Cámara: ${c.label}`}
              >
                <Icon className="size-3.5" aria-hidden />
                {c.label}
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
          title="Activa la fiesta del 2B para ver el ruido"
          aria-label="Fiesta demo del 2B"
        >
          <PartyPopper aria-hidden />
          Fiesta demo
        </Button>

        {/* Saltar tiempo */}
        <Button
          size="sm"
          variant="outline"
          onClick={onSkipTime}
          disabled={!ready}
          aria-label="Avanzar 10 minutos"
        >
          <FastForward aria-hidden />
          +10 min
        </Button>

        {/* Guardar */}
        <Button
          size="sm"
          variant="outline"
          onClick={onSave}
          disabled={!ready || saveState === 'saving'}
          title={
            saveState === 'saved' && savedAt
              ? `Partida guardada a las ${savedAt}`
              : saveState === 'saving'
                ? 'Guardando...'
                : 'Guardar partida'
          }
          aria-label="Guardar partida"
        >
          {saveState === 'saving' ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : saveState === 'saved' ? (
            <Check className="text-emerald-500" aria-hidden />
          ) : (
            <Save aria-hidden />
          )}
          Guardar
        </Button>

        {/* Cargar */}
        <Button
          size="sm"
          variant="outline"
          onClick={onLoad}
          disabled={!ready}
          aria-label="Cargar partida"
        >
          <FolderOpen aria-hidden />
          Cargar
        </Button>
      </CardContent>
    </Card>
  );
}
