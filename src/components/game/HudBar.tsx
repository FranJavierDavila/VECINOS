'use client';

import {
  CloudLightning,
  CloudRain,
  CloudSun,
  Clock,
  Home,
  Landmark,
  Star,
  Sun,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useGameStore } from '@/game/client/store';
import type { Weather } from '@/game/core/types';
import { cn } from '@/lib/utils';
import { useT } from '@/game/client/i18n';

const WEATHER_UI: Record<Weather, { icon: LucideIcon; key: string; className: string }> = {
  sunny: { icon: Sun, key: 'weather.sunny', className: 'text-amber-500' },
  cloudy: { icon: CloudSun, key: 'weather.cloudy', className: 'text-muted-foreground' },
  rain: { icon: CloudRain, key: 'weather.rain', className: 'text-sky-600 dark:text-sky-400' },
  storm: { icon: CloudLightning, key: 'weather.storm', className: 'text-amber-600 dark:text-amber-400' },
};

function Chip({
  icon: Icon,
  iconClassName,
  children,
  label,
}: {
  icon: LucideIcon;
  iconClassName?: string;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs whitespace-nowrap"
      aria-label={label}
    >
      <Icon className={cn('size-3.5 shrink-0', iconClassName)} aria-hidden />
      {children}
    </span>
  );
}

export function HudBar() {
  const t = useT();
  const clock = useGameStore((s) => s.clock);
  const weather = useGameStore((s) => s.weather);
  const funds = useGameStore((s) => s.funds);
  const wallet = useGameStore((s) => s.wallet);
  const reputation = useGameStore((s) => s.reputation);
  const elevator = useGameStore((s) => s.elevator);
  const homeLabel = useGameStore((s) => s.homeLabel);
  const travelText = useGameStore((s) => s.travelText);

  const hh = String(Math.floor(clock.minute / 60)).padStart(2, '0');
  const mm = String(clock.minute % 60).padStart(2, '0');
  const w = WEATHER_UI[weather];
  const WeatherIcon = w.icon;
  const weatherLabel = t(w.key);

  return (
    <Card className="gap-2 py-3">
      <CardContent className="flex flex-wrap items-center gap-2 px-3">
        <Chip icon={Clock} label={t('hud.clockAria')}>
          {t('hud.day', { d: clock.day })} · {hh}:{mm}
        </Chip>

        <Chip icon={WeatherIcon} iconClassName={w.className} label={t('hud.weatherAria', { w: weatherLabel })}>
          {weatherLabel}
        </Chip>

        <Chip icon={Landmark} label={t('hud.fundsAria')}>
          {funds} €
        </Chip>

        <Chip icon={Wallet} label={t('hud.walletAria')}>
          {wallet} €
        </Chip>

        <Chip icon={Star} iconClassName="text-amber-500" label={t('hud.repAria')}>
          {reputation}
        </Chip>

        {elevator === 'ok' ? (
          <Badge
            variant="secondary"
            className="border border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          >
            {t('hud.elevOk')}
          </Badge>
        ) : (
          <Badge variant="destructive">{t('hud.elevBroken')}</Badge>
        )}

        <Chip icon={Home} label={t('hud.homeAria')}>
          {homeLabel}
        </Chip>

        {travelText !== null && travelText !== '' && (
          <span className="text-xs text-muted-foreground italic">{travelText}</span>
        )}
      </CardContent>
    </Card>
  );
}
