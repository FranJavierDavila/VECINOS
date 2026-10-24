'use client';

/**
 * Menú de Opciones (pulido Steam): sonido (volumen maestro + silencio), gráficos
 * (calidad de render y contador de FPS), idioma de la interfaz (ES/EN) e información
 * del backend. Todo se aplica en vivo y persiste en localStorage; el sim nunca se entera.
 */

import { useState } from 'react';
import { Monitor, Music2, Gauge, Gamepad2, Languages } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useGameStore } from '@/game/client/store';
import { getController } from '@/game/client/bridge';
import { getVolume, setMuted, setVolume } from '@/game/client/audio';
import { saveOptionsPartial, type QualityLevel, type Lang } from '@/game/client/options';
import { useT, LANGUAGES } from '@/game/client/i18n';

export function OptionsModal() {
  const t = useT();
  const open = useGameStore((s) => s.optionsOpen);
  const setOpen = useGameStore((s) => s.setOptionsOpen);
  const muted = useGameStore((s) => s.soundMuted);
  const setSoundMuted = useGameStore((s) => s.setSoundMuted);
  const fpsVisible = useGameStore((s) => s.fpsVisible);
  const setFpsVisible = useGameStore((s) => s.setFpsVisible);
  const lang = useGameStore((s) => s.lang);
  const setLang = useGameStore((s) => s.setLang);
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

  const onLang = (l: string) => {
    const next = l as Lang;
    setLang(next);
    saveOptionsPartial({ lang: next });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gauge className="size-4 text-amber-500" aria-hidden />
            {t('opt.title')}
          </DialogTitle>
          <DialogDescription>{t('opt.desc')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 sm:grid-cols-2">
          {/* ── Sonido ── */}
          <section className="space-y-4" aria-label={t('opt.sound')}>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Music2 className="size-3.5" aria-hidden />
              {t('opt.sound')}
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="opt-volumen">{t('opt.volume')}</Label>
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
                aria-label={t('opt.volumeAria')}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
              <Label htmlFor="opt-silencio" className="cursor-pointer">
                {t('opt.mute')}
              </Label>
              <Switch id="opt-silencio" checked={muted} onCheckedChange={onMuted} aria-label={t('opt.muteAria')} />
            </div>
          </section>

          {/* ── Gráficos ── */}
          <section className="space-y-4" aria-label={t('opt.graphics')}>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Monitor className="size-3.5" aria-hidden />
              {t('opt.graphics')}
            </h3>
            <div className="space-y-2">
              <Label htmlFor="opt-calidad">{t('opt.quality')}</Label>
              <Select onValueChange={onQuality}>
                <SelectTrigger id="opt-calidad" aria-label={t('opt.quality')}>
                  <SelectValue placeholder={t('opt.quality.normal')} />
                </SelectTrigger>
                <SelectContent>
                  {(['alta', 'normal', 'eco'] as QualityLevel[]).map((q) => (
                    <SelectItem key={q} value={q}>
                      {t(`opt.quality.${q}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t('opt.qualityHelp')}</p>
            </div>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
              <Label htmlFor="opt-fps" className="cursor-pointer">
                {t('opt.fps')}
              </Label>
              <Switch id="opt-fps" checked={fpsVisible} onCheckedChange={onFps} aria-label={t('opt.fpsAria')} />
            </div>
          </section>
        </div>

        {/* ── Idioma (localización del chrome) ── */}
        <section className="space-y-2" aria-label={t('opt.language')}>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <Languages className="size-3.5" aria-hidden />
            <h3>{t('opt.language')}</h3>
          </div>
          <div className="flex items-center gap-3">
            <Select value={lang} onValueChange={onLang}>
              <SelectTrigger id="opt-idioma" className="w-52" aria-label={t('opt.languageAria')}>
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
            <p className="text-xs text-muted-foreground">{t('opt.languageHelp')}</p>
          </div>
        </section>

        <p className="flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
          <Gamepad2 className="size-3.5" aria-hidden />
          {t('opt.gamepadLine')}
          {backend ? ` · ${t('opt.backend', { b: backend })}` : ''}
        </p>
      </DialogContent>
    </Dialog>
  );
}
