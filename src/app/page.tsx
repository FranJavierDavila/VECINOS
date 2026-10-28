'use client';

import GameStage from '@/components/game/GameStage';
import { PostItControls } from '@/components/game/PostItControls';
import { HudBar } from '@/components/game/HudBar';
import { MissionTracker } from '@/components/game/MissionTracker';
import { ProjectCard } from '@/components/game/ProjectCard';
import { InfoDock } from '@/components/game/InfoDock';
import { AchievementPopup } from '@/components/game/AchievementPopup';
import { PwaRegister } from '@/components/game/PwaRegister';
import { getController } from '@/game/client/bridge';
import { useT } from '@/game/client/i18n';

/** VECINOS v1.23: mandos como post-its dibujados a bolígrafo + economía siempre visible. */
export default function Home() {
  const t = useT();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PwaRegister />
      <header className="border-b">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
          <h1 className="text-xl font-extrabold tracking-tight">VECINOS</h1>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600">{t('header.version')}</span>
          <p className="text-sm text-muted-foreground">{t('header.subtitle')}</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4">
        <div className="mb-2">
          <PostItControls />
        </div>

        <GameStage />

        <HudBar />

        <div className="mt-4 flex flex-col gap-2">
          {/* v1.39 — meta de largo plazo: el proyecto del edificio, siempre visible */}
          <ProjectCard />
          <MissionTracker />
          <InfoDock />
        </div>
      </main>

      <AchievementPopup />

      <footer className="mt-auto border-t bg-muted/40 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto max-w-7xl px-4 text-xs text-muted-foreground">
          {t('footer.text')}
        </div>
      </footer>
    </div>
  );
}
