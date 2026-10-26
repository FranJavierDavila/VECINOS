'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGameStore } from '@/game/client/store';
import { useT } from '@/game/client/i18n';
import { AchievementsPanel } from './AchievementsPanel';
import { EventLog } from './EventLog';
import { HelpCard } from './HelpCard';
import { InteriorEditorPanel } from './InteriorEditorPanel';
import { MissionsPanel } from './MissionsPanel';
import { ObjectiveCard } from './ObjectiveCard';
import { ParamsPanel } from './ParamsPanel';

/**
 * Dock de información (v1.17): toda la partida organizada en pestañas para que tanta
 * información no abrume — Misiones | Edificio | Mi casa | Logros | Ayuda — con badges
 * de recuento (misiones activas y logros X/Y). En móvil la lista de pestañas hace
 * scroll horizontal; las listas largas siguen teniendo su max-h con overflow propio.
 */
export function InfoDock() {
  const t = useT();
  const [tab, setTab] = useState('misiones');
  const missions = useGameStore((s) => s.missions);
  const achievements = useGameStore((s) => s.achievements);

  const activeMissions = missions.filter((m) => m.state === 'active' || m.state === 'awaiting_choice').length;
  const unlockedAch = achievements.filter((a) => a.unlocked).length;

  const countBadge = (label: string) => (
    <Badge
      variant="outline"
      className="border-amber-500/30 bg-amber-500/15 px-1.5 text-[10px] text-amber-600 dark:text-amber-400"
    >
      {label}
    </Badge>
  );

  return (
    <Card className="gap-2 py-4">
      <CardContent className="px-4">
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <div className="w-full overflow-x-auto">
            <TabsList className="h-auto w-max gap-1 py-1">
              <TabsTrigger value="misiones" className="flex-none whitespace-nowrap">
                {t('dock.tab.missions')}
                {activeMissions > 0 && countBadge(String(activeMissions))}
              </TabsTrigger>
              <TabsTrigger value="edificio" className="flex-none whitespace-nowrap">
                {t('dock.tab.building')}
              </TabsTrigger>
              <TabsTrigger value="casa" className="flex-none whitespace-nowrap">
                {t('dock.tab.home')}
              </TabsTrigger>
              <TabsTrigger value="logros" className="flex-none whitespace-nowrap">
                {t('dock.tab.achievements')}
                {achievements.length > 0 && countBadge(`${unlockedAch}/${achievements.length}`)}
              </TabsTrigger>
              <TabsTrigger value="ayuda" className="flex-none whitespace-nowrap">
                {t('dock.tab.help')}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="misiones" className="flex flex-col gap-4">
            <ObjectiveCard />
            <MissionsPanel />
          </TabsContent>
          <TabsContent value="edificio" className="flex flex-col gap-4">
            <ParamsPanel />
            <EventLog />
          </TabsContent>
          <TabsContent value="casa">
            <InteriorEditorPanel />
          </TabsContent>
          <TabsContent value="logros">
            <AchievementsPanel />
          </TabsContent>
          <TabsContent value="ayuda">
            <HelpCard />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
