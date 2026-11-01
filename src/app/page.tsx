'use client';

import GameStage from '@/components/game/GameStage';
import { PostItControls } from '@/components/game/PostItControls';
import { HudBar } from '@/components/game/HudBar';
import { InfoOverlay } from '@/components/game/InfoDock';
import { PriorityBanner } from '@/components/game/PriorityBanner';
import { AchievementPopup } from '@/components/game/AchievementPopup';
import { PwaRegister } from '@/components/game/PwaRegister';
import { useT } from '@/game/client/i18n';

/**
 * V1.65 — PANTALLA DE JUEGO LIMPIA (petición del vecino).
 * La barra superior queda en UNA línea (MENÚ · Cámara · Misiones · Edificio ·
 * Vecinos · Logros) y TODO el detalle se consulta en paneles que se despliegan
 * POR ENCIMA del escenario (InfoOverlay, anclado al wrapper relative del
 * GameStage) — nada de bloques bajo el HUD ni scroll de página: el objetivo y
 * el proyecto del edificio viven dentro del panel de Misiones/Edificio.
 */
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

        {/* El panel de información se despliega POR ENCIMA del escenario (≤ media ventana
            de juego, con scroll propio; pinchando fuera se vuelve a ver solo el juego).
            v1.66 — el banner de MÁXIMA PRIORIDAD (misión/logro/decisión) cuelga sobre
            el escenario para que el jugador JAMÁS se despiste de sus objetivos. */}
        <div className="relative">
          <GameStage />
          <InfoOverlay />
          <PriorityBanner />
        </div>

        <HudBar />
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
