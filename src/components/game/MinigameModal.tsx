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
import { loadContent } from '@/game/content';
import { playSound } from '@/game/client/audio';
import { getController } from '@/game/client/bridge';
import { useGameStore } from '@/game/client/store';
import type { MinigameState } from '@/game/client/store';
import type {
  MinigameMemoryPairsConfig,
  MinigameReflexTargetsConfig,
  MinigameTapSequenceConfig,
  MinigameTimingBarConfig,
  MinigameType,
} from '@/game/core/types';
import { cn } from '@/lib/utils';

// ───────────────────────── Textos del catálogo (rules.minigames) ─────────────────────────
// CERO frases escritas en código: todo humor vive en public/content/rules.json.

interface MinigameTexts {
  winLine: string;
  loseLine: string;
  hitLine: string;
  failLines: string[];
  introByType: Partial<Record<MinigameType, string>>;
}

/** Valores neutros mientras loadContent() resuelve: los runners ya funcionan con ellos. */
const EMPTY_TEXTS: MinigameTexts = { winLine: '', loseLine: '', hitLine: '', failLines: [], introByType: {} };

/** Línea al azar del catálogo (vacía si el catálogo no llegó a cargar). */
function pickLine(lines: string[]): string {
  return lines.length > 0 ? (lines[Math.floor(Math.random() * lines.length)] ?? '') : '';
}

/** Fracción (0..1) a porcentaje acotado a 0..100. */
function clampPct(fraction: number): number {
  return Math.min(100, Math.max(0, fraction * 100));
}

// ───────────────────────── Piezas comunes de interfaz ─────────────────────────

function RunnerHeader({ emoji, name, progress, description }: { emoji: string; name: string; progress: string; description: string }) {
  return (
    <DialogHeader className="items-center sm:items-center">
      <div
        className="mb-1 flex size-12 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/15 text-2xl"
        aria-hidden
      >
        {emoji}
      </div>
      <DialogTitle className="flex items-center justify-center gap-2">
        {name}
        <Badge
          variant="outline"
          className="border-amber-500/30 bg-amber-500/15 font-mono text-amber-600 dark:text-amber-400"
        >
          {progress}
        </Badge>
      </DialogTitle>
      <DialogDescription className="text-center sm:text-center">{description}</DialogDescription>
    </DialogHeader>
  );
}

/** Línea de ayuda bajo la descripción: def.instruction del catálogo o introByType. */
function InstructionLine({ text }: { text: string }) {
  return (
    <p className="min-h-4 text-center text-xs text-muted-foreground sm:text-center" aria-live="polite">
      {text}
    </p>
  );
}

function ProgressDots({ total, done, label }: { total: number; done: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            'size-2.5 rounded-full border',
            i < done ? 'border-amber-600 bg-amber-500' : 'border-muted-foreground/40 bg-transparent',
          )}
        />
      ))}
    </div>
  );
}

function LivesHearts({ lives, maxLives }: { lives: number; maxLives: number }) {
  return (
    <div className="flex items-center gap-1" role="img" aria-label={`Intentos restantes: ${lives}`}>
      {Array.from({ length: maxLives }, (_, i) => (
        <Heart
          key={i}
          className={cn('size-4', i < lives ? 'fill-rose-500 text-rose-500' : 'text-muted-foreground/30')}
          aria-hidden
        />
      ))}
    </div>
  );
}

function StatusLine({ msg }: { msg: string }) {
  return (
    <p className="min-h-5 text-center text-xs text-muted-foreground" aria-live="polite">
      {msg}
    </p>
  );
}

// ───────────────────────── Contrato de finalización (común a los 4 runners) ─────────────────────────

/**
 * finish(success) con doneRef: si onFinish existe → se delega y NO se cierra ni completa
 * (GameStage lo hará); si no → captura el id del store ANTES de cerrar:
 * setMinigame(null) + getController()?.completeMinigame(id, success).
 */
function useMinigameFinish(onFinish?: (success: boolean) => void) {
  const doneRef = useRef(false);
  const finish = useCallback(
    (success: boolean) => {
      if (doneRef.current) return;
      doneRef.current = true;
      playSound(success ? 'jingle_win' : 'jingle_lose');
      if (onFinish) {
        onFinish(success);
        return;
      }
      const id = useGameStore.getState().minigame?.id ?? null;
      useGameStore.getState().setMinigame(null);
      if (id) getController()?.completeMinigame(id, success);
    },
    [onFinish],
  );
  return { doneRef, finish };
}

// ───────────────────────── Modal (bloqueante, como PhoneModal/JuntaModal) ─────────────────────────

export function MinigameModal({ onFinish }: { onFinish?: (success: boolean) => void }) {
  const minigame = useGameStore((s) => s.minigame);
  const [texts, setTexts] = useState<MinigameTexts>(EMPTY_TEXTS);

  // El catálogo se carga UNA vez (loadContent cachea la promesa); sin setState síncrono en el efecto.
  useEffect(() => {
    let cancelled = false;
    loadContent()
      .then(({ content }) => {
        if (cancelled) return;
        setTexts(content.rules.minigames);
      })
      .catch(() => {
        // Sin catálogo los runners siguen funcionando con textos vacíos.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        <MinigameRunner key={minigame.id} minigame={minigame} texts={texts} onFinish={onFinish} />
      </DialogContent>
    </Dialog>
  );
}

interface MinigameRunnerProps {
  minigame: MinigameState;
  texts: MinigameTexts;
  onFinish?: (success: boolean) => void;
}

/** Elige el runner por tipo; cada uno recibe su config ya estrechada por el discriminante. */
function MinigameRunner({ minigame, texts, onFinish }: MinigameRunnerProps) {
  const instruction = minigame.instruction ?? texts.introByType[minigame.type] ?? '';

  switch (minigame.type) {
    case 'timing_bar':
      return (
        <TimingBarRunner
          name={minigame.name}
          description={minigame.description}
          emoji={minigame.emoji}
          config={minigame.config}
          instruction={instruction}
          texts={texts}
          onFinish={onFinish}
        />
      );
    case 'tap_sequence':
      return (
        <TapSequenceRunner
          name={minigame.name}
          description={minigame.description}
          emoji={minigame.emoji}
          config={minigame.config}
          instruction={instruction}
          texts={texts}
          onFinish={onFinish}
        />
      );
    case 'reflex_targets':
      return (
        <ReflexTargetsRunner
          name={minigame.name}
          description={minigame.description}
          emoji={minigame.emoji}
          config={minigame.config}
          instruction={instruction}
          texts={texts}
          onFinish={onFinish}
        />
      );
    case 'memory_pairs':
      return (
        <MemoryPairsRunner
          name={minigame.name}
          description={minigame.description}
          emoji={minigame.emoji}
          config={minigame.config}
          instruction={instruction}
          texts={texts}
          onFinish={onFinish}
        />
      );
  }
}

// ───────────────────────── A) timing_bar — barra de precisión ─────────────────────────

interface TimingBarRunnerProps {
  name: string;
  description: string;
  emoji: string;
  config: MinigameTimingBarConfig;
  instruction: string;
  texts: MinigameTexts;
  onFinish?: (success: boolean) => void;
}

/** Cursor ping-pong con rAF, zonas verdes y botón "¡AHORA!" (barra, teclado o botón). */
function TimingBarRunner({ name, description, emoji, config, instruction, texts, onFinish }: TimingBarRunnerProps) {
  const { rounds, cursorSpeed, zoneWidth, zones, accelPerRound, lives: maxLives } = config;

  const [cursor, setCursor] = useState(0);
  const [hits, setHits] = useState(0);
  const [lives, setLives] = useState(maxLives);
  const [msg, setMsg] = useState('');

  // Física y progreso en refs: el bucle rAF los lee sin reconectar el efecto en cada intento.
  const cursorRef = useRef(0);
  const dirRef = useRef(1);
  const hitsRef = useRef(0);
  const livesRef = useRef(maxLives);
  const { doneRef, finish } = useMinigameFinish(onFinish);

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
        setMsg(texts.winLine);
        finish(true);
      } else {
        playSound('mg_hit'); setMsg(texts.hitLine);
      }
    } else {
      livesRef.current -= 1;
      setLives(livesRef.current);
      if (livesRef.current <= 0) {
        setMsg(texts.loseLine);
        finish(false);
      } else {
        playSound('mg_miss'); setMsg(pickLine(texts.failLines));
      }
    }
  }, [rounds, zoneWidth, zones, texts, doneRef, finish]);

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
      <RunnerHeader emoji={emoji} name={name} progress={`${hits}/${rounds}`} description={description} />
      <InstructionLine text={instruction} />

      {/* Marcador: puntos de acierto + vidas */}
      <div className="flex items-center justify-between gap-3">
        <ProgressDots total={rounds} done={hits} label={`Aciertos: ${hits} de ${rounds}`} />
        <LivesHearts lives={lives} maxLives={maxLives} />
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
      <StatusLine msg={msg} />

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

// ───────────────────────── B) tap_sequence — "Simón dice" con pads del catálogo ─────────────────────────

interface TapSequenceRunnerProps {
  name: string;
  description: string;
  emoji: string;
  config: MinigameTapSequenceConfig;
  instruction: string;
  texts: MinigameTexts;
  onFinish?: (success: boolean) => void;
}

/** Reproduce una secuencia (fase showing) y espera la repetición (fase input) con timeout. */
function TapSequenceRunner({ name, description, emoji, config, instruction, texts, onFinish }: TapSequenceRunnerProps) {
  const { rounds, pads, sequenceStart, sequenceGrow, showMs, gapMs, inputTimeoutMs, lives: maxLives } = config;

  const makeSequence = useCallback(
    (r: number): number[] => {
      const length = sequenceStart + r * sequenceGrow;
      return Array.from({ length }, () => Math.floor(Math.random() * pads.length));
    },
    [sequenceStart, sequenceGrow, pads.length],
  );

  const [round, setRound] = useState(0);
  const [sequence, setSequence] = useState<number[]>(() => makeSequence(0));
  const [phase, setPhase] = useState<'showing' | 'input'>('showing');
  const [progress, setProgress] = useState(0);
  const [flashed, setFlashed] = useState<number | null>(null);
  const [lives, setLives] = useState(maxLives);
  const [msg, setMsg] = useState('');

  const livesRef = useRef(maxLives);
  const timeoutsRef = useRef<number[]>([]);
  const { doneRef, finish } = useMinigameFinish(onFinish);

  const clearTimers = useCallback(() => {
    for (const id of timeoutsRef.current) window.clearTimeout(id);
    timeoutsRef.current = [];
  }, []);

  /** Fallo de intento (pad equivocado o tiempo agotado): vida-1 y se vuelve a mostrar la MISMA secuencia. */
  const handleFail = useCallback(() => {
    if (doneRef.current) return;
    livesRef.current -= 1;
    setLives(livesRef.current);
    if (livesRef.current <= 0) {
      setMsg(texts.loseLine);
      finish(false);
      return;
    }
    playSound('mg_miss'); setMsg(pickLine(texts.failLines));
    setProgress(0);
    setPhase('showing');
  }, [texts, doneRef, finish]);

  // Reproducción de la secuencia: cadena de timeouts con refs y flag cancelled;
  // los setState solo ocurren dentro de callbacks temporales (nunca síncronos en el efecto).
  useEffect(() => {
    if (phase !== 'showing') return;
    let cancelled = false;
    const ids: number[] = [];
    let t = 0;
    sequence.forEach((pad) => {
      ids.push(
        window.setTimeout(() => {
          if (!cancelled && !doneRef.current) setFlashed(pad);
        }, t),
      );
      t += showMs;
      ids.push(
        window.setTimeout(() => {
          if (!cancelled && !doneRef.current) setFlashed(null);
        }, t),
      );
      t += gapMs;
    });
    ids.push(
      window.setTimeout(() => {
        if (!cancelled && !doneRef.current) {
          setFlashed(null);
          setProgress(0);
          setPhase('input');
        }
      }, t),
    );
    timeoutsRef.current = ids;
    return () => {
      cancelled = true;
      for (const id of ids) window.clearTimeout(id);
    };
  }, [phase, sequence, showMs, gapMs, doneRef]);

  // Límite de la fase input: si no se completa a tiempo cuenta como fallo.
  // Cada pad correcto cambia `progress`, lo que reprograma el temporizador (reset por pulsación).
  useEffect(() => {
    if (phase !== 'input') return;
    const id = window.setTimeout(() => {
      if (!doneRef.current) handleFail();
    }, inputTimeoutMs);
    return () => {
      window.clearTimeout(id);
    };
  }, [phase, progress, inputTimeoutMs, handleFail, doneRef]);

  // Limpieza total al desmontar.
  useEffect(
    () => () => {
      clearTimers();
    },
    [clearTimers],
  );

  const pressPad = useCallback(
    (index: number) => {
      if (doneRef.current || phase !== 'input') return;
      if (index !== sequence[progress]) {
        handleFail();
        return;
      }
      const nextProgress = progress + 1;
      if (nextProgress < sequence.length) {
        setProgress(nextProgress);
        return;
      }
      // Secuencia completa.
      if (round + 1 >= rounds) {
        setMsg(texts.winLine);
        finish(true);
        return;
      }
      playSound('mg_hit'); setMsg(texts.hitLine);
      setRound(round + 1);
      setSequence(makeSequence(round + 1));
      setProgress(0);
      setPhase('showing');
    },
    [phase, sequence, progress, round, rounds, texts, doneRef, handleFail, finish, makeSequence],
  );

  // Teclado: Digit1..DigitN pulsan el pad N-1 durante la fase input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const match = /^Digit([1-9])$/.exec(e.code);
      if (!match) return;
      const index = Number(match[1]) - 1;
      if (index >= pads.length) return;
      e.preventDefault();
      pressPad(index);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pressPad, pads.length]);

  const padsGridClass =
    pads.length === 2
      ? 'grid-cols-2'
      : pads.length === 3
        ? 'grid-cols-3'
        : pads.length === 4
          ? 'grid-cols-2 sm:grid-cols-4'
          : 'grid-cols-3';

  return (
    <>
      <RunnerHeader emoji={emoji} name={name} progress={`${round + 1}/${rounds}`} description={description} />
      <InstructionLine text={instruction} />

      {/* Marcador: rondas completadas + vidas */}
      <div className="flex items-center justify-between gap-3">
        <ProgressDots total={rounds} done={round} label={`Rondas completadas: ${round} de ${rounds}`} />
        <LivesHearts lives={lives} maxLives={maxLives} />
      </div>

      {/* Pads del catálogo: encendidos solo en la fase input */}
      <div className={cn('mx-auto grid w-full max-w-xs gap-2', padsGridClass)} role="group" aria-label={`Pads: ${pads.length}`}>
        {pads.map((pad, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Pad ${i + 1} de ${pads.length}`}
            aria-disabled={phase !== 'input'}
            onClick={() => pressPad(i)}
            className={cn(
              'flex size-16 items-center justify-center rounded-2xl bg-muted text-2xl transition-colors select-none touch-none sm:size-20',
              phase === 'input' && 'cursor-pointer hover:bg-muted/70',
              phase !== 'input' && 'cursor-not-allowed opacity-60',
              flashed === i && 'scale-[1.05] bg-amber-400 text-neutral-900 shadow-lg',
            )}
          >
            {pad}
          </button>
        ))}
      </div>

      <p className="text-center text-sm font-medium" aria-live="polite">
        Ronda: {round + 1}/{rounds} · Intentos restantes: {lives}
      </p>
      <StatusLine msg={msg} />
    </>
  );
}

// ───────────────────────── C) reflex_targets — aplasta objetivos (con señuelos) ─────────────────────────

interface ReflexTarget {
  id: number;
  /** Posición en % del tablero (x: 5..95, y: 8..92). */
  x: number;
  y: number;
  decoy: boolean;
  bornAt: number;
}

interface ReflexTargetsRunnerProps {
  name: string;
  description: string;
  emoji: string;
  config: MinigameReflexTargetsConfig;
  instruction: string;
  texts: MinigameTexts;
  onFinish?: (success: boolean) => void;
}

/** Objetivos que aparecen por intervalo y escapan por vida; un rAF barre los caducados. */
function ReflexTargetsRunner({ name, description, emoji, config, instruction, texts, onFinish }: ReflexTargetsRunnerProps) {
  const {
    targets: targetGoal,
    spawnIntervalMs,
    targetLifeMs,
    radiusPct,
    missesAllowed,
    lives: maxLives,
    emoji: targetEmoji,
    decoyEmoji,
    decoyChance,
  } = config;

  const [targets, setTargets] = useState<ReflexTarget[]>([]);
  const [hits, setHits] = useState(0);
  const [escaped, setEscaped] = useState(0);
  const [lives, setLives] = useState(maxLives);
  const [now, setNow] = useState(0);
  const [msg, setMsg] = useState('');

  // Refs espejo: el intervalo y el rAF trabajan sobre targetsRef sin reconectar efectos.
  const targetsRef = useRef<ReflexTarget[]>([]);
  const nextIdRef = useRef(0);
  const hitsRef = useRef(0);
  const escapedRef = useRef(0);
  const livesRef = useRef(maxLives);
  const { doneRef, finish } = useMinigameFinish(onFinish);

  /** Única puerta de escritura del tablero: sincroniza ref y estado. */
  const commit = useCallback((next: ReflexTarget[]) => {
    targetsRef.current = next;
    setTargets(next);
  }, []);

  // Aparición de objetivos (con señuelo según decoyChance del catálogo).
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (doneRef.current) return;
      const decoy = decoyEmoji !== undefined && decoyChance !== undefined && decoyChance > Math.random();
      const target: ReflexTarget = {
        id: nextIdRef.current++,
        x: 5 + Math.random() * 90,
        y: 8 + Math.random() * 84,
        decoy,
        bornAt: performance.now(),
      };
      commit([...targetsRef.current, target]);
    }, spawnIntervalMs);
    return () => window.clearInterval(interval);
  }, [spawnIntervalMs, decoyEmoji, decoyChance, commit, doneRef]);

  // Barrido con UN rAF: elimina los que exceden targetLifeMs, cuenta escapados y
  // refresca `now` para la animación de caducidad. setState solo en el callback del rAF.
  useEffect(() => {
    let raf = 0;
    const step = (frame: number) => {
      const current = targetsRef.current;
      if (current.length > 0) {
        const expired = current.filter((t) => frame - t.bornAt >= targetLifeMs);
        if (expired.length > 0) {
          const escapedNow = expired.filter((t) => !t.decoy).length;
          if (escapedNow > 0) {
            escapedRef.current += escapedNow;
            setEscaped(escapedRef.current);
            if (escapedRef.current > missesAllowed) finish(false);
          }
          commit(current.filter((t) => frame - t.bornAt < targetLifeMs));
        }
        setNow(frame);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [targetLifeMs, missesAllowed, commit, finish, doneRef]);

  /** Golpe sobre un objetivo: señuelo = vida-1; objetivo = progreso. El target desaparece. */
  const hitTarget = useCallback(
    (id: number) => {
      if (doneRef.current) return;
      const target = targetsRef.current.find((t) => t.id === id);
      if (!target) return;
      commit(targetsRef.current.filter((t) => t.id !== id));

      if (target.decoy) {
        livesRef.current -= 1;
        setLives(livesRef.current);
        if (livesRef.current <= 0) {
          setMsg(texts.loseLine);
          finish(false);
        } else {
          playSound('mg_miss'); setMsg(pickLine(texts.failLines));
        }
        return;
      }

      hitsRef.current += 1;
      setHits(hitsRef.current);
      if (hitsRef.current >= targetGoal) {
        setMsg(texts.winLine);
        finish(true);
      } else {
        playSound('mg_hit'); setMsg(texts.hitLine);
      }
    },
    [targetGoal, texts, commit, finish, doneRef],
  );

  return (
    <>
      <RunnerHeader emoji={emoji} name={name} progress={`${hits}/${targetGoal}`} description={description} />
      <InstructionLine text={instruction} />

      {/* Marcador: objetivos + vidas */}
      <div className="flex items-center justify-between gap-3">
        <ProgressDots total={targetGoal} done={hits} label={`Objetivos: ${hits} de ${targetGoal}`} />
        <LivesHearts lives={lives} maxLives={maxLives} />
      </div>

      {/* Tablero: los objetivos se centran en su coordenada; el clic fuera no penaliza */}
      <div
        aria-label="Tablero de reflejos: toca los objetivos y evita los señuelos"
        className="relative h-56 w-full cursor-pointer touch-none overflow-hidden rounded-lg border bg-muted/50 select-none"
      >
        {targets.map((t) => {
          const expiring = now - t.bornAt >= targetLifeMs * 0.75;
          return (
            <button
              key={t.id}
              type="button"
              aria-label={t.decoy ? 'Señuelo: no tocar' : 'Objetivo: tocar'}
              className={cn(
                'absolute flex aspect-square -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/85 text-xl shadow',
                expiring ? 'animate-pulse' : 'animate-in zoom-in-50 duration-150',
              )}
              style={{ left: `${t.x}%`, top: `${t.y}%`, width: `${radiusPct * 2}%` }}
              onPointerDown={(e) => {
                e.stopPropagation();
                hitTarget(t.id);
              }}
            >
              {t.decoy ? (decoyEmoji ?? targetEmoji) : targetEmoji}
            </button>
          );
        })}
      </div>

      <p className="text-center text-sm font-medium" aria-live="polite">
        Objetivos: {hits}/{targetGoal} · Intentos restantes: {lives}
      </p>
      <p className="text-center text-xs text-muted-foreground">Escapados: {escaped}/{missesAllowed}</p>
      <StatusLine msg={msg} />
    </>
  );
}

// ───────────────────────── D) memory_pairs — empareja fichas del catálogo ─────────────────────────

interface MemoryCard {
  id: string;
  emoji: string;
  matched: boolean;
}

/** Mazo = dos copias de los items del catálogo, barajadas con Fisher-Yates (una vez, al montar). */
function buildDeck(items: string[]): MemoryCard[] {
  const deck = [...items, ...items];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck.map((emoji, i) => ({ id: `ficha-${i}`, emoji, matched: false }));
}

interface MemoryPairsRunnerProps {
  name: string;
  description: string;
  emoji: string;
  config: MinigameMemoryPairsConfig;
  instruction: string;
  texts: MinigameTexts;
  onFinish?: (success: boolean) => void;
}

/** Voltea fichas de dos en dos: pareja buena se queda; fallo cuesta vida tras 700 ms. */
function MemoryPairsRunner({ name, description, emoji, config, instruction, texts, onFinish }: MemoryPairsRunnerProps) {
  const { items, lives: maxLives } = config;

  const [cards, setCards] = useState<MemoryCard[]>(() => buildDeck(items));
  const [flipped, setFlipped] = useState<string[]>([]);
  const [lives, setLives] = useState(maxLives);
  const [msg, setMsg] = useState('');

  const livesRef = useRef(maxLives);
  const lockRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const { doneRef, finish } = useMinigameFinish(onFinish);

  // Limpieza del timeout de fallo al desmontar.
  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  const flipCard = useCallback(
    (card: MemoryCard) => {
      if (doneRef.current || lockRef.current) return;
      if (card.matched || flipped.includes(card.id) || flipped.length >= 2) return;

      const nextFlipped = [...flipped, card.id];
      setFlipped(nextFlipped);
      if (nextFlipped.length < 2) return;

      const firstId = nextFlipped[0];
      const secondId = nextFlipped[1];
      const first = cards.find((c) => c.id === firstId);
      const second = cards.find((c) => c.id === secondId);
      if (!first || !second) return;

      if (first.emoji === second.emoji) {
        const nextCards = cards.map((c) => (c.id === firstId || c.id === secondId ? { ...c, matched: true } : c));
        setCards(nextCards);
        setFlipped([]);
        if (nextCards.every((c) => c.matched)) {
          setMsg(texts.winLine);
          finish(true);
        } else {
          playSound('mg_hit'); setMsg(texts.hitLine);
        }
        return;
      }

      // Pareja fallida: bloquea el tablero, desvoltea y cobra vida a los 700 ms.
      lockRef.current = true;
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        setFlipped([]);
        livesRef.current -= 1;
        setLives(livesRef.current);
        lockRef.current = false;
        if (livesRef.current <= 0) {
          setMsg(texts.loseLine);
          finish(false);
        } else {
          playSound('mg_miss'); setMsg(pickLine(texts.failLines));
        }
      }, 700);
    },
    [cards, flipped, texts, doneRef, finish],
  );

  const totalPairs = items.length;
  const matchedPairs = cards.filter((c) => c.matched).length / 2;

  return (
    <>
      <RunnerHeader emoji={emoji} name={name} progress={`${matchedPairs}/${totalPairs}`} description={description} />
      <InstructionLine text={instruction} />

      {/* Marcador: parejas + vidas */}
      <div className="flex items-center justify-between gap-3">
        <ProgressDots total={totalPairs} done={matchedPairs} label={`Parejas encontradas: ${matchedPairs} de ${totalPairs}`} />
        <LivesHearts lives={lives} maxLives={maxLives} />
      </div>

      {/* Fichas: boca abajo con "?", boca arriba con el emoji del catálogo */}
      <div className="mx-auto grid w-full max-w-xs grid-cols-4 gap-2" role="group" aria-label="Fichas del juego de parejas">
        {cards.map((card) => {
          const faceUp = card.matched || flipped.includes(card.id);
          return (
            <button
              key={card.id}
              type="button"
              aria-label={
                card.matched
                  ? `Pareja encontrada: ${card.emoji}`
                  : faceUp
                    ? `Ficha: ${card.emoji}`
                    : 'Ficha boca abajo'
              }
              aria-disabled={faceUp ? true : undefined}
              onClick={() => flipCard(card)}
              className={cn(
                'flex aspect-square items-center justify-center rounded-lg border text-2xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
                faceUp ? 'bg-background' : 'border-amber-500/40 bg-amber-500/15 hover:border-amber-500',
                card.matched && 'opacity-60 ring-1 ring-emerald-500/50',
              )}
            >
              {faceUp ? (
                card.emoji
              ) : (
                <span className="text-lg font-bold text-amber-600/70">?</span>
              )}
            </button>
          );
        })}
      </div>

      <p className="text-center text-sm font-medium" aria-live="polite">
        Parejas: {matchedPairs}/{totalPairs} · Intentos restantes: {lives}
      </p>
      <StatusLine msg={msg} />
    </>
  );
}
