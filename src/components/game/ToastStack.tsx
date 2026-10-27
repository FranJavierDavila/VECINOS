'use client';

/**
 * AVISOS COMO POST-ITS (v1.29, petición del vecino): «que duren un poco más de tiempo en
 * pantalla y que aparezcan como Post its». Los toasts dejan de ser tarjetas de sistema y
 * pasan a ser papelitos adhesivos del mismo dialecto que los mandos (PostItControls):
 * papel de color según el tono, tinta a bolígrafo, cinta adhesiva arriba, ligera rotación y
 * la esquinita doblada. Duración 7.5 s (store.pushToast); clic para cerrarlos antes.
 *
 * v1.30 — CELEBRACIÓN ORIGAMI (petición del vecino): «cuando una misión es completada el
 * post it del aviso se pliega como un origami y aparece sobre la fanfarria como estrellitas
 * que caen al suelo hasta desaparecer». El post-it de misión completada (tone good +
 * celebrate) vive 12 s: en el segundo 8.5 el papel SE PLEGA en acordeón (3 dobleces con
 * perspectiva, como un abanico que se cierra) y al terminar el plegado nacen estrellitas
 * doradas desde su posición que CAEN con gravedad hasta el borde inferior de la pantalla,
 * girando y apagándose (Web Animations API: cero dependencias, cero re-render).
 */

import { useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useGameStore } from '@/game/client/store';
import type { Tone } from '@/game/client/store';

const TONE_UI: Record<Tone, { icon: LucideIcon; paper: string; pin: string; ink: string; tilt: number }> = {
  info: {
    icon: Info,
    paper: '#fef9a7', // post-it amarillo clásico
    pin: '#e8d75a',
    ink: '#3b3129',
    tilt: -1.4,
  },
  good: {
    icon: CheckCircle2,
    paper: '#d4f0c0', // verde: buena noticia
    pin: '#b5dd9c',
    ink: '#2c4327',
    tilt: 1.2,
  },
  bad: {
    icon: AlertTriangle,
    paper: '#fdd9e0', // rosa: aviso de problema
    pin: '#f4b8c6',
    ink: '#57252f',
    tilt: -1.8,
  },
};

/** Ciclo de vida del post-it de celebración (ms): plegado al final y estrellitas al suelo. */
const CELEBRATE_LIFE = 12000; // debe coincidir con store.pushToast(celebrate)
const FOLD_AT = 8500;
const FOLD_MS = 1300;
const STARS_MS = 3200;

interface ToastStackProps {
  onDismiss: (id: number) => void;
}

export function ToastStack({ onDismiss }: ToastStackProps) {
  const toasts = useGameStore((s) => s.toasts);
  /** Refs por toast (celebrate): el plegado y las estrellas los dispara el tiempo, no el render. */
  const paperRefs = useRef(new Map<number, HTMLDivElement | null>());
  const firedFolds = useRef(new Set<number>());
  const firedStars = useRef(new Set<number>());

  useEffect(() => {
    const alive = new Set(toasts.map((t) => t.id));
    for (const key of [...firedFolds.current]) if (!alive.has(key)) firedFolds.current.delete(key);
    for (const key of [...firedStars.current]) if (!alive.has(key)) firedStars.current.delete(key);
    paperRefs.current.forEach((_, key) => {
      if (!alive.has(key)) paperRefs.current.delete(key);
    });
  }, [toasts]);

  useEffect(() => {
    // Un solo temporizador por frame-batch: comprueba cada 250 ms qué post-its tocan plegarse.
    const timer = window.setInterval(() => {
      const now = performance.now();
      for (const t of useGameStore.getState().toasts) {
        if (!t.celebrate || t.bornAt === undefined) continue;
        const age = now - t.bornAt;
        // ── PLEGADO ORIGAMI: acordeón con perspectiva (3 dobleces que se cierran). ──
        if (age >= FOLD_AT && !firedFolds.current.has(t.id)) {
          firedFolds.current.add(t.id);
          const paper = paperRefs.current.get(t.id);
          if (paper) {
            paper.animate(
              [
                { transform: 'perspective(700px) rotateX(0deg)', offset: 0 },
                { transform: 'perspective(700px) rotateX(58deg) scaleY(0.92)', offset: 0.3 },
                { transform: 'perspective(700px) rotateX(-38deg) scaleY(0.78)', offset: 0.55 },
                { transform: 'perspective(700px) rotateX(24deg) scaleY(0.5)', offset: 0.78 },
                { transform: 'perspective(700px) rotateX(0deg) scaleY(0.06)', offset: 1 },
              ],
              { duration: FOLD_MS, easing: 'cubic-bezier(.55,.06,.68,.19)', fill: 'forwards' },
            );
          }
        }
        // ── ESTRELLITAS: nacen sobre el post-it ya plegado y CAEN hasta el suelo. ──
        if (age >= FOLD_AT + FOLD_MS * 0.55 && !firedStars.current.has(t.id)) {
          firedStars.current.add(t.id);
          const paper = paperRefs.current.get(t.id);
          if (paper) {
            const host = paper.closest('[data-vecinos-toast]') as HTMLElement | null;
            const box = (host ?? paper).getBoundingClientRect();
            const vh = window.innerHeight;
            const fall = Math.max(120, vh - box.bottom + 8);
            const glyphs = ['✦', '★', '✧', '⭐', '✨'];
            const colors = ['#ffd166', '#ffe29a', '#f4a259', '#ffd166', '#fff3c2'];
            const COUNT = 16;
            for (let i = 0; i < COUNT; i++) {
              const star = document.createElement('span');
              star.setAttribute('aria-hidden', 'true');
              star.textContent = glyphs[i % glyphs.length]!;
              star.style.cssText =
                `position:fixed;left:${box.left + box.width * (0.15 + Math.random() * 0.7)}px;top:${box.top + box.height * 0.35}px;` +
                `font-size:${10 + Math.random() * 12}px;color:${colors[i % colors.length]!};` +
                `text-shadow:0 0 6px rgba(255,209,102,.75);z-index:60;pointer-events:none;`;
              document.body.appendChild(star);
              const drift = (Math.random() - 0.5) * 90;
              const spin = (Math.random() - 0.5) * 540;
              const dur = STARS_MS * (0.75 + Math.random() * 0.5);
              star.animate(
                [
                  { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 0 },
                  { transform: `translate(${drift * 0.3}px,-14px) rotate(${spin * 0.2}deg) scale(1.15)`, opacity: 1, offset: 0.12 },
                  { transform: `translate(${drift}px,${fall * 0.55}px) rotate(${spin * 0.6}deg) scale(0.95)`, opacity: 0.9, offset: 0.55 },
                  { transform: `translate(${drift * 1.35}px,${fall}px) rotate(${spin}deg) scale(0.6)`, opacity: 0 },
                ],
                { duration: dur, easing: 'cubic-bezier(.3,.4,.6,1)', fill: 'forwards' },
              ).onfinish = () => star.remove();
            }
          }
        }
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute right-3 top-3 z-30 flex w-[24rem] max-w-[calc(100%-6rem)] flex-col items-end gap-3"
      role="status"
      aria-live="polite"
    >
      <p className="sr-only">Avisos de la comunidad</p>
      {toasts.map((t, i) => {
        const tone = TONE_UI[t.tone];
        const Icon = tone.icon;
        // Rotación determinista por posición (los post-its pegados a mano nunca están rectos).
        const tilt = tone.tilt + ((i % 3) - 1) * 0.9;
        return (
          <div
            key={t.id}
            data-vecinos-toast="postit"
            role="button"
            tabIndex={0}
            aria-label={`Cerrar aviso: ${t.text}`}
            onClick={() => onDismiss(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onDismiss(t.id);
              }
            }}
            className="pointer-events-auto relative w-full cursor-pointer select-none transition-transform duration-150 hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ transform: `rotate(${tilt}deg)`, perspective: '700px' }}
          >
            {/* Cinta adhesiva translúcida (la que pega el papelito al cristal) */}
            <span
              aria-hidden
              className="absolute -top-2.5 left-1/2 h-5 w-20 -translate-x-1/2 -rotate-3 rounded-[2px]"
              style={{ background: 'rgba(255,255,255,0.5)', boxShadow: '0 1px 2px rgba(0,0,0,0.12)' }}
            />
            <div
              ref={(el) => {
                paperRefs.current.set(t.id, el);
              }}
              className="sketchy relative px-4 py-3 shadow-[0_6px_14px_rgba(0,0,0,0.22)]"
              style={{
                background: `linear-gradient(180deg, ${tone.paper} 0%, ${tone.paper} 78%, ${tone.pin} 100%)`,
                color: tone.ink,
                transformOrigin: '50% 0%',
              }}
            >
              {/* Esquina doblada (papel pegado a mano) */}
              <span
                aria-hidden
                className="absolute bottom-0 right-0 size-0 border-b-[16px] border-l-[16px]"
                style={{ borderBottomColor: tone.pin, borderLeftColor: 'transparent' }}
              />
              <div className="flex items-start gap-2 pr-1">
                <Icon className="mt-0.5 size-4 shrink-0" style={{ color: tone.ink }} aria-hidden />
                <p className="text-sm leading-snug font-medium" style={{ color: tone.ink }}>
                  {t.text}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
