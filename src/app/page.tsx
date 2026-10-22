'use client';

import GameStage from '@/components/game/GameStage';
import { ControlsBar } from '@/components/game/ControlsBar';
import { HudBar } from '@/components/game/HudBar';
import { ObjectiveCard } from '@/components/game/ObjectiveCard';
import { MissionsPanel } from '@/components/game/MissionsPanel';
import { ParamsPanel } from '@/components/game/ParamsPanel';
import { EventLog } from '@/components/game/EventLog';
import { HelpCard } from '@/components/game/HelpCard';
import { InteriorEditorPanel } from '@/components/game/InteriorEditorPanel';
import { getController } from '@/game/client/bridge';

/** Vertical slice 0.3 de VECINOS: drag & drop en el editor, catálogo de minijuegos y canales plagas/humo. */
export default function Home() {
  const g = () => getController();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
          <h1 className="text-xl font-extrabold tracking-tight">VECINOS</h1>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-600">vertical slice 0.3</span>
          <p className="text-sm text-muted-foreground">Mudanzas, ruido, olores, wifi, plagas, humo y derramas: el simulador de vecindario.</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4">
        <ControlsBar
          onTogglePause={() => g()?.togglePause()}
          onSetSpeed={(s) => g()?.setSpeed(s)}
          onSetCam={(m) => g()?.setCamMode(m)}
          onParty={() => g()?.partyDemo()}
          onSkipTime={() => g()?.skipTime()}
          onSave={() => void g()?.save()}
          onLoad={() => void g()?.load()}
        />

        <GameStage />

        <HudBar />

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <ObjectiveCard />
          <MissionsPanel />
          <ParamsPanel />
          <InteriorEditorPanel />
          <EventLog />
          <HelpCard />
        </div>
      </main>

      <footer className="mt-auto border-t bg-muted/40 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto max-w-7xl px-4 text-xs text-muted-foreground">
          VECINOS · prototipo jugable — sim determinista (1 tick = 1 minuto) + render Babylon.js (WebGPU/WebGL2) + editor con drag & drop + catálogo de minijuegos + guardado en SQLite. Construyéndolo por hitos, juntos.
        </div>
      </footer>
    </div>
  );
}
