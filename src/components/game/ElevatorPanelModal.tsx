'use client';

import { useGameStore } from '@/game/client/store';
import { getController } from '@/game/client/bridge';
import { useT } from '@/game/client/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowUpDown } from 'lucide-react';

/**
 * Panel de destino del ascensor (v1.9): el jugador, delante de un núcleo operativo, elige
 * planta como en un ascensor de verdad. Solo presentación: las paradas las calcula
 * PlayerLogic (mismo pozo, plantas operativas), y la llamada sale por pickElevatorFloor →
 * la FSM del ascensor (capacidad, puertas, espera) hace el resto. Cero números aquí.
 */
export function ElevatorPanelModal() {
  const panel = useGameStore((s) => s.elevatorPanel);
  const t = useT();
  if (!panel) return null;

  const pick = (to: number) => getController()?.pickElevatorFloor(to);
  const close = () => getController()?.closeElevatorPanel();
  // De arriba a abajo, como el panel de un ascensor.
  const floors = [...panel.floors].sort((a, b) => b - a);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent aria-describedby={undefined} className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpDown className="size-5 shrink-0 text-amber-500" aria-hidden />
            {t('elev.title')}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t('elev.subtitle')}</p>
        <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1" role="listbox" aria-label={t('elev.title')}>
          {floors.map((f) => {
            const here = f === panel.current;
            return (
              <Button
                key={f}
                variant="outline"
                disabled={here}
                className="h-11 justify-center tabular-nums hover:border-amber-500/40 hover:bg-amber-500/10"
                onClick={() => pick(f)}
                aria-label={t('elev.floorAria', { n: f })}
                role="option"
                aria-selected={false}
              >
                <span className="flex items-baseline gap-1.5">
                  <span className="font-semibold">{t('elev.floor', { n: f })}</span>
                  {here && <span className="text-[10px] font-normal text-amber-600 dark:text-amber-400">({t('elev.here')})</span>}
                </span>
              </Button>
            );
          })}
        </div>
        <Button variant="ghost" className="w-full" onClick={close}>
          {t('elev.cancel')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
