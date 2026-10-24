'use client';

/**
 * Menú de Opciones (pulido Steam): sonido (volumen maestro + silencio), gráficos
 * (calidad de render y contador de FPS) e información del backend. Todo se aplica
 * en vivo y persiste en localStorage; el sim nunca se entera.
 */

import { useState } from 'react';
import { Monitor, Music2, Gauge, Gamepad2 } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useGameStore } from '@/game/client/store';
import { getController } from '@/game/client/bridge';
import { getVolume, setMuted, setVolume } from '@/game/client/audio';
import { saveOptionsPartial, type QualityLevel } from '@/game/client/options';

const QUALITY_LABEL: Record<QualityLevel, string> = {
  alta: 'Alta — resolución nativa',
  normal: 'Normal — equilibrada',
  eco: 'Eco — máxima fluidez',
};

export function OptionsModal() {
  const open = useGameStore((s) => s.optionsOpen);
  const setOpen = useGameStore((s) => s.setOptionsOpen);
  const muted = useGameStore((s) => s.soundMuted);
  const setSoundMuted = useGameStore((s) => s.setSoundMuted);
  const fpsVisible = useGameStore((s) => s.fpsVisible);
  const setFpsVisible = useGameStore((s) => s.setFpsVisible);
  const backend = useGameStore((s) => s.backend);

  const [vol, setVol] = useState(() => Math.round(getVolume() * 100));

  const onVolume = (v: number[]) => {
    const pct = v[0] ?? Math.round(getVolume() * 100);
    setVol(pct);
    setVolume(pct / 100);
  };

  const onMuted = (v: boolean) => {
    setSoundMuted(v);
    setMuted(v);
  };

  const onQuality = (q: string) => {
    const quality = q as QualityLevel;
    saveOptionsPartial({ quality });
    getController()?.applyQuality(quality);
  };

  const onFps = (v: boolean) => {
    setFpsVisible(v);
    saveOptionsPartial({ fpsVisible: v });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gauge className="size-4 text-amber-500" aria-hidden />
            Opciones
          </DialogTitle>
          <DialogDescription>Se aplican al momento y quedan guardadas para tus próximas visitas.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 sm:grid-cols-2">
          {/* ── Sonido ── */}
          <section className="space-y-4" aria-label="Opciones de sonido">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Music2 className="size-3.5" aria-hidden />
              Sonido
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="opt-volumen">Volumen maestro</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{vol}%</span>
              </div>
              <Slider
                id="opt-volumen"
                value={[vol]}
                min={0}
                max={100}
                step={5}
                onValueChange={onVolume}
                disabled={muted}
                aria-label="Volumen maestro del juego"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
              <Label htmlFor="opt-silencio" className="cursor-pointer">
                Silenciar todo
              </Label>
              <Switch id="opt-silencio" checked={muted} onCheckedChange={onMuted} aria-label="Silenciar el juego" />
            </div>
          </section>

          {/* ── Gráficos ── */}
          <section className="space-y-4" aria-label="Opciones de gráficos">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Monitor className="size-3.5" aria-hidden />
              Gráficos
            </h3>
            <div className="space-y-2">
              <Label htmlFor="opt-calidad">Calidad de render</Label>
              <Select onValueChange={onQuality}>
                <SelectTrigger id="opt-calidad" aria-label="Calidad de render">
                  <SelectValue placeholder="Normal — equilibrada" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(QUALITY_LABEL) as QualityLevel[]).map((q) => (
                    <SelectItem key={q} value={q}>
                      {QUALITY_LABEL[q]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Baja la resolución interna a cambio de fluidez.</p>
            </div>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
              <Label htmlFor="opt-fps" className="cursor-pointer">
                Contador de FPS
              </Label>
              <Switch id="opt-fps" checked={fpsVisible} onCheckedChange={onFps} aria-label="Mostrar contador de FPS" />
            </div>
          </section>
        </div>

        <p className="flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
          <Gamepad2 className="size-3.5" aria-hidden />
          Mando: stick/cruceta mueve · A interactúa · Y cambia cámara · Start pausa
          {backend ? ` · Render: ${backend}` : ''}
        </p>
      </DialogContent>
    </Dialog>
  );
}
