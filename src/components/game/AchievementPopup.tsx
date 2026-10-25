'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { useGameStore } from '@/game/client/store';
import { useT } from '@/game/client/i18n';
import { cn } from '@/lib/utils';

/** Segundos que cada popup permanece en pantalla antes de salir por la derecha. */
const SHOW_MS = 4500;
/** Duración de la animación de salida (tw-animate-css). */
const EXIT_MS = 400;

/**
 * Popup de logro estilo Steam (v1.17): fijo abajo-derecha, NO modal (no congela el mundo),
 * UNO a la vez. La cola la gestiona el componente exterior: los desbloqueos marcados `newly`
 * por el controlador entran en una cola interna y se muestran secuencialmente (~4,5 s cada
 * uno). Clic (o Enter/Espacio) para descartar.
 */

interface PopupCardProps {
  id: string;
  icon: string;
  name: string;
  desc: string;
  onDone: () => void;
}

/** Tarjeta de UN popup: montada con key={id}, así su estado de salida nace fresco cada vez
 *  (jamás hay que "resetear" `exiting` a mano — eso-era el popup congelado de v1.17-rc). */
function PopupCard({ id, icon, name, desc, onDone }: PopupCardProps) {
  const t = useT();
  const [exiting, setExiting] = useState(false);

  // Auto-cierre: SHOW_MS visible + EXIT_MS de animación de salida. Los timers viven SOLO
  // ligados a este montaje (key por id): ningún cleanup externo puede cancelar el cierre.
  useEffect(() => {
    const hide = setTimeout(() => setExiting(true), SHOW_MS);
    const close = setTimeout(onDone, SHOW_MS + EXIT_MS);
    return () => {
      clearTimeout(hide);
      clearTimeout(close);
    };
  }, [onDone]);

  const dismiss = () => {
    if (exiting) return;
    setExiting(true);
    setTimeout(onDone, EXIT_MS);
  };

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={t('ach.popupTitle')}
      onClick={dismiss}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') dismiss();
      }}
      className={cn(
        'fixed right-4 bottom-4 z-50 w-[min(92vw,22rem)] cursor-pointer gap-0 border-amber-500/40 bg-background/95 py-3 shadow-lg backdrop-blur',
        exiting ? 'animate-out fade-out slide-out-to-right-5' : 'animate-in fade-in slide-in-from-right-5',
      )}
    >
      <CardContent className="flex flex-col gap-2 px-3">
        <p className="flex items-center gap-1.5 border-b border-amber-500/30 pb-1.5 text-xs font-bold tracking-wide text-amber-600 uppercase dark:text-amber-400">
          <span aria-hidden>🏆</span>
          {t('ach.popupTitle')}
        </p>
        <div className="flex items-start gap-3">
          <span className="text-3xl leading-none" aria-hidden>
            {icon}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{name}</p>
            <p className="text-xs text-muted-foreground">{desc}</p>
          </div>
        </div>
      </CardContent>
      <span data-vecinos-achieve-id={id} className="sr-only">
        {id}
      </span>
    </Card>
  );
}

export function AchievementPopup() {
  const popup = useGameStore((s) => s.achievementPopup);
  const achievements = useGameStore((s) => s.achievements);
  const setAchievementPopup = useGameStore((s) => s.setAchievementPopup);
  const clearAchievementNewly = useGameStore((s) => s.clearAchievementNewly);
  const queueRef = useRef<string[]>([]);
  const shownRef = useRef<Set<string>>(new Set());
  // Estable: si cambiara en cada render, los timers del PopupCard se reiniciarían (deps).
  const closePopup = useCallback(() => setAchievementPopup(null), [setAchievementPopup]);

  // Cola: alimenta con los `newly` (una sola vez por id) y descola cuando no hay popup en pantalla.
  useEffect(() => {
    if (popup) {
      shownRef.current.add(popup.id);
      queueRef.current = queueRef.current.filter((id) => id !== popup.id);
      // ?. defensivo: en un HMR mixto el store viejo puede no traer la acción todavía.
      clearAchievementNewly?.(popup.id); // tanto si vino de la cola como directo del controlador
      return;
    }
    for (const a of achievements) {
      if (a.unlocked && a.newly && !shownRef.current.has(a.id) && !queueRef.current.includes(a.id)) {
        shownRef.current.add(a.id);
        queueRef.current.push(a.id);
      }
    }
    if (queueRef.current.length > 0) {
      const id = queueRef.current.shift();
      const next = id !== undefined ? achievements.find((a) => a.id === id) : undefined;
      if (next) {
        // Verdad de estado: anunciado = deja de ser `newly` en la lista (además de shownRef,
        // que solo vive mientras el componente está montado — HMR/StrictMode lo reinician).
        clearAchievementNewly?.(next.id);
        setAchievementPopup({ ...next, newly: false });
      }
    }
  }, [achievements, popup, setAchievementPopup, clearAchievementNewly]);

  if (!popup) return null;
  return <PopupCard key={popup.id} id={popup.id} icon={popup.icon} name={popup.name} desc={popup.desc} onDone={closePopup} />;
}
