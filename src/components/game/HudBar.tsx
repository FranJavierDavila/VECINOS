'use client';

/**
 * HUD bajo el lienzo (v1.23): campaña, reputación, estado del ascensor, vivienda y
 * desplazamiento. El reloj/meteorología viven en la barra de post-its y el DINERO en el
 * overlay del lienzo (MoneyOverlay) — duplicarlos aquí confundiría.
 */

import {
  Drama,
  Home,
  Star,
  Trophy,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useGameStore } from '@/game/client/store';
import { cn } from '@/lib/utils';
import { useT } from '@/game/client/i18n';

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
  const reputation = useGameStore((s) => s.reputation);
  const elevator = useGameStore((s) => s.elevator);
  const homeLabel = useGameStore((s) => s.homeLabel);
  const travelText = useGameStore((s) => s.travelText);
  const campaign = useGameStore((s) => s.campaign);
  // v1.55 — chip «Vecino del mes»: solo con sesión de comunidad y marcador recibido.
  const mpScore = useGameStore((s) => s.mpScore);
  const myResidentId = useGameStore((s) => s.mpMyResidentId);
  const topRow = mpScore?.find((r) => r.top) ?? null;
  const myRow = myResidentId ? mpScore?.find((r) => r.residentId === myResidentId) : undefined;

  return (
    <Card className="gap-2 py-3">
      <CardContent className="flex flex-wrap items-center gap-2 px-3">
        {campaign?.active && (
          <Chip icon={Drama} iconClassName="text-amber-500" label={t('hud.campaignAria')}>
            {campaign.over
              ? t('hud.campaignOver', { label: campaign.label, d: Math.min(campaign.dayOfTerm, campaign.termDays), n: campaign.termDays })
              : t('hud.campaign', { label: campaign.label, d: campaign.dayOfTerm, n: campaign.termDays })}
          </Chip>
        )}

        {topRow && (
          <Chip icon={Trophy} iconClassName="text-amber-500" label={t('hud.mpScoreAria')}>
            {t('hud.mpScore', { name: topRow.name, top: topRow.points, mine: myRow?.points ?? 0 })}
          </Chip>
        )}

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
