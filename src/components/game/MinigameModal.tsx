'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getController } from '@/game/client/bridge';
import { useGameStore } from '@/game/client/store';
import type { MinigameState } from '@/game/client/store';
import { cn } from '@/lib/utils';

// ───────────────────────── Textos del minijuego (humor de vecinos) ─────────────────────────

const INTRO_LINE = 'Pulsa ¡AHORA! cuando el cursor pise la zona verde.';
const HIT_LINE = '¡Otra ronda!';
const WIN_LINE = '¡Dominado! Hasta el presidente aplaude.';
const LOSE_LINE = 'Sin intentos. El cursor gana esta vez... por ahora.';

const FAIL_LINES = [
  'Casi. Como el wifi del portal.',
  'El cursor no negocia, vecino.',
  'Eso pasó de largo, como la paella del tercero.',
  'La barra no perdona. La barra es la barra.',
  'Has pulsado con el corazón, no con el ojo.',
  'Casi clavada. "Casi" no paga la reforma.',
];

/** Fracción (0..1) a porcentaje acotado a 0..100. */
function clampPct(fraction: number): number {
  return Math.min(100, Math.max(0, fraction * 100));
}

// ───────────────────────── Modal (bloqueante, como PhoneModal/JuntaModal) ─────────────────────────

export function MinigameModal({ onFinish }: { onFinish?: (success: boolean) => void }) {
  const minigame = useGameStore((s) => s.minigame);

  if (!minigame) return null;

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-md"
      >
        {/* La key monta una partida nueva con estado fresco en cada minigame_requested. */}
        <MinigameRunner key={minigame.id} minigame={minigame} onFinish={onFinish} />
      </DialogContent>
    </Dialog>
  );
}

interface MinigameRunnerProps {
  minigame: MinigameState;
  onFinish?: (success: boolean) => void;
}

/** Una partida concreta: cursor ping-pong con rAF, intentos, aciertos y vidas. */
function MinigameRunner({ minigame, onFinish }: MinigameRunnerProps) {
  const { rounds, cursorSpeed, zoneWidth, zones, accelPerRound, lives: maxLives } = minigame.config;

  const [cursor, setCursor] = useState(0);
  const [hits, setHits] = useState(0);
  const [lives, setLives] = useState(maxLives);
  const [msg, setMsg] = useState(INTRO_LINE);

  // Física y progreso en refs: el bucle rAF los lee sin reconectar el efecto en cada intento.
  const cursorRef = useRef(0);
  const dirRef = useRef(1);
  const hitsRef = useRef(0);
  const livesRef = useRef(maxLives);
  /** Bloquea intentos tras terminar (por si un onFinish externo tarda en cerrar el modal). */
  const doneRef = useRef(false);

  const finish = useCallback(
    (success: boolean) => {
      if (doneRef.current) return;
      doneRef.current = true;
      if (onFinish) {
        // GameStage decide: cierra el modal (setMinigame(null)) y completa el minijuego.
        onFinish(success);
        return;
      }
      const id = useGameStore.getState().minigame?.id ?? null;
      useGameStore.getState().setMinigame(null);
      if (id) getController()?.completeMinigame(id, success);
    },
    [onFinish],
  );

  const attempt = useCallback(() => {
    if (doneRef.current) return;

    const pos = cursorRef.current;
    const nearest = zones.reduce<number>(
      (best, z) => (Math.abs(z - pos) < Math.abs(best - pos) ? z : best),
      Number.POSITIVE_INFINITY,
    );
    const hit = nearest !== Number.POSITIVE_INFINITY && Math.abs(pos - nearest) <= zoneWidth / 2;

    if (hit) {
      hitsRef.current += 1;
      setHits(hitsRef.current);
      if (hitsRef.current >= rounds) {
        setMsg(WIN_LINE);
        finish(true);
      } else {
        setMsg(HIT_LINE);
      }
    } else {
      livesRef.current -= 1;
      setLives(livesRef.current);
      if (livesRef.current <= 0) {
        setMsg(LOSE_LINE);
        finish(false);
      } else {
        const line = FAIL_LINES[Math.floor(Math.random() * FAIL_LINES.length)];
        setMsg(line ?? INTRO_LINE);
      }
    }
  }, [rounds, zoneWidth, zones, finish]);

  // Ping-pong del cursor: cursorSpeed * (1 + aciertos * accelPerRound) pasadas por segundo.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const speed = cursorSpeed * (1 + hitsRef.current * accelPerRound);
      let next = cursorRef.current + dirRef.current * speed * dt;
      if (next >= 1) {
        next = 2 - next;
        dirRef.current = -1;
      } else if (next <= 0) {
        next = -next;
        dirRef.current = 1;
      }
      cursorRef.current = next;
      setCursor(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [cursorSpeed, accelPerRound]);

  // Espacio / Enter también intentan (listener global mientras la partida esté en marcha).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        attempt();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [attempt]);

  return (
    <>
      <DialogHeader className="items-center sm:items-center">
        <div
          className="mb-1 flex size-12 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/15 text-2xl"
          aria-hidden
        >
          {minigame.emoji}
        </div>
        <DialogTitle className="flex items-center justify-center gap-2">
          {minigame.name}
          <Badge
            variant="outline"
            className="border-amber-500/30 bg-amber-500/15 font-mono text-amber-600 dark:text-amber-400"
          >
            {hits}/{rounds}
          </Badge>
        </DialogTitle>
        <DialogDescription className="text-center sm:text-center">
          {minigame.description}
        </DialogDescription>
      </DialogHeader>

      {/* Marcador: puntos de acierto + vidas */}
      <div className="flex items-center justify-between gap-3">
        <div
          className="flex items-center gap-1.5"
          role="img"
          aria-label={`Aciertos: ${hits} de ${rounds}`}
        >
          {Array.from({ length: rounds }, (_, i) => (
            <span
              key={i}
              className={cn(
                'size-2.5 rounded-full border',
                i < hits
                  ? 'border-amber-600 bg-amber-500'
                  : 'border-muted-foreground/40 bg-transparent',
              )}
            />
          ))}
        </div>
        <div
          className="flex items-center gap-1"
          role="img"
          aria-label={`Intentos restantes: ${lives}`}
        >
          {Array.from({ length: maxLives }, (_, i) => (
            <Heart
              key={i}
              className={cn(
                'size-4',
                i < lives ? 'fill-rose-500 text-rose-500' : 'text-muted-foreground/30',
              )}
              aria-hidden
            />
          ))}
        </div>
      </div>

      {/* Barra de precisión: zonas verdes + cursor ámbar (clic/tap en la barra también cuenta) */}
      <div
        role="button"
        tabIndex={-1}
        aria-label="Barra de precisión: pulsa cuando el cursor esté dentro de la zona verde"
        className="relative h-10 w-full cursor-pointer touch-none overflow-hidden rounded-full bg-muted select-none"
        onPointerDown={(e) => {
          e.preventDefault();
          attempt();
        }}
      >
        {zones.map((z, i) => (
          <div
            key={i}
            className="absolute inset-y-0 border border-emerald-600 bg-emerald-500/40"
            style={{
              left: `${clampPct(z - zoneWidth / 2)}%`,
              width: `${clampPct(zoneWidth)}%`,
            }}
          />
        ))}
        <div
          className="absolute inset-y-0 w-[3px] -translate-x-1/2 bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)] transition-none"
          style={{ left: `${cursor * 100}%` }}
        />
      </div>

      <p className="text-center text-sm font-medium" aria-live="polite">
        Aciertos: {hits}/{rounds} · Intentos restantes: {lives}
      </p>
      <p className="min-h-5 text-center text-xs text-muted-foreground" aria-live="polite">
        {msg}
      </p>

      <Button
        onClick={attempt}
        className="h-12 w-full bg-amber-600 text-lg text-white hover:bg-amber-700"
        aria-label="Intentar ahora"
      >
        ¡AHORA!
      </Button>
    </>
  );
}
