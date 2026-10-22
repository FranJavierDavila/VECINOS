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

const WEATHER_UI: Record<Weather, { icon: LucideIcon; label: string; className: string }> = {
  sunny: { icon: Sun, label: 'Soleado', className: 'text-amber-500' },
  cloudy: { icon: CloudSun, label: 'Nublado', className: 'text-muted-foreground' },
  rain: { icon: CloudRain, label: 'Lluvia', className: 'text-sky-600 dark:text-sky-400' },
  storm: { icon: CloudLightning, label: 'Tormenta', className: 'text-amber-600 dark:text-amber-400' },
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

  return (
    <Card className="gap-2 py-3">
      <CardContent className="flex flex-wrap items-center gap-2 px-3">
        <Chip icon={Clock} label="Reloj del edificio">
          Día {clock.day} · {hh}:{mm}
        </Chip>

        <Chip icon={WeatherIcon} iconClassName={w.className} label={`Clima: ${w.label}`}>
          {w.label}
        </Chip>

        <Chip icon={Landmark} label="Fondos de la comunidad">
          {funds} €
        </Chip>

        <Chip icon={Wallet} label="Tu cartera">
          {wallet} €
        </Chip>

        <Chip icon={Star} iconClassName="text-amber-500" label="Reputación en el vecindario">
          {reputation}
        </Chip>

        {elevator === 'ok' ? (
          <Badge
            variant="secondary"
            className="border border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          >
            Ascensor operativo
          </Badge>
        ) : (
          <Badge variant="destructive">Ascensor fuera de servicio</Badge>
        )}

        <Chip icon={Home} label="Tu piso">
          {homeLabel}
        </Chip>

        {travelText !== null && travelText !== '' && (
          <span className="text-xs text-muted-foreground italic">{travelText}</span>
        )}
      </CardContent>
    </Card>
  );
}
