'use client';

/**
 * V1.23 — ECONOMÍA SIEMPRE VISIBLE (overlay sobre el lienzo).
 * Dos monederos fijos en la esquina superior derecha del encuadre: las ARCAS DEL
 * EDIFICIO (comunidad) y la HUCHA del jugador. Al cambiar cualquier cantidad:
 *   · GANANCIA → moneditas vuelan desde su origen (ventanas del edificio para las
 *     arcas, la calle/el jugador para la hucha) hasta el monedero, con sonido de
 *     caja registradora y resalte dorado del importe.
 *   · PÉRDIDA → el monedero tiembla en rojo con una rajita de "hucha rota" y un
 *     −N € que se esfuma.
 * Todo local a la presentación: el sim ni se entera (los valores llegan por syncHud).
 */

import { useEffect, useRef } from 'react';

import { useGameStore } from '@/game/client/store';
import { playSound } from '@/game/client/audio';
import { useT } from '@/game/client/i18n';

/** Monedita SVG (disco dorado con borde y €). */
const COIN_SVG = `
<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="12" cy="12" r="9.5" fill="#fbbf24" stroke="#b45309" stroke-width="2"/>
  <circle cx="12" cy="12" r="6.2" fill="none" stroke="#fde68a" stroke-width="1.4"/>
  <text x="12" y="16.2" text-anchor="middle" font-size="10.5" font-weight="800" fill="#92400e" font-family="system-ui">€</text>
</svg>`;

type Kind = 'funds' | 'wallet';

interface ChipRefs {
  funds: HTMLSpanElement | null;
  wallet: HTMLSpanElement | null;
}

export function MoneyOverlay() {
  const t = useT();
  const funds = useGameStore((s) => s.funds);
  const wallet = useGameStore((s) => s.wallet);
  const boxRef = useRef<HTMLDivElement>(null);
  const chips = useRef<ChipRefs>({ funds: null, wallet: null });
  const prev = useRef<{ funds: number; wallet: number } | null>(null);
  const broken = useRef<Kind | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = { funds, wallet };
    if (!before) return;
    const box = boxRef.current;
    if (!box) return;
    const dF = funds - before.funds;
    const dW = wallet - before.wallet;
    const boxR = box.getBoundingClientRect();

    const burst = (kind: Kind, delta: number) => {
      const chip = chips.current[kind];
      if (!chip) return;
      const gain = delta > 0;
      const chipR = chip.getBoundingClientRect();
      const tx = chipR.left - boxR.left + chipR.width * 0.5;
      const ty = chipR.top - boxR.top + chipR.height * 0.5;
      const n = Math.min(9, Math.max(3, Math.round(Math.abs(delta) / 30) + 3));
      // Origen: las arcas cobran desde las ventanas del edificio (mitad izquierda del
      // encuadre); la hucha cobra desde abajo (el jugador y la calle).
      for (let i = 0; i < n; i++) {
        const ox = kind === 'funds' ? boxR.width * (0.08 + Math.random() * 0.34) : boxR.width * (0.32 + Math.random() * 0.36);
        const oy = kind === 'funds' ? boxR.height * (0.22 + Math.random() * 0.4) : boxR.height * (0.55 + Math.random() * 0.3);
        const el = document.createElement('div');
        el.className = 'coin-fly';
        el.innerHTML = COIN_SVG;
        box.appendChild(el);
        const delay = i * 85 + Math.random() * 140;
        const dur = 680 + Math.random() * 380;
        const lift = Math.min(oy, ty) - 34 - Math.random() * 30;
        el.animate(
          [
            { transform: `translate(${ox}px, ${oy}px) scale(0.55)`, opacity: 0 },
            { transform: `translate(${ox}px, ${oy}px) scale(0.7)`, opacity: 1, offset: 0.09 },
            { transform: `translate(${(ox + tx) / 2}px, ${lift}px) scale(0.95)`, offset: 0.58 },
            { transform: `translate(${tx}px, ${ty}px) scale(1)`, opacity: 1 },
          ],
          { duration: dur, delay, easing: 'ease-in-out', fill: 'both' },
        ).onfinish = () => el.remove();
      }
      // Resalte / hucha rota + etiqueta flotante del importe, tras llegar la primera moneda.
      const arrive = n * 85 + 560;
      window.setTimeout(() => {
        chip.classList.remove('money-chip-gain', 'money-chip-loss');
        void chip.offsetWidth; // reinicia la animación CSS
        chip.classList.add(gain ? 'money-chip-gain' : 'money-chip-loss');
        const d = document.createElement('span');
        d.className = 'money-delta';
        d.style.color = gain ? '#86efac' : '#fca5a5';
        d.textContent = `${gain ? '+' : '−'}${Math.abs(delta)} €`;
        chip.appendChild(d);
        window.setTimeout(() => d.remove(), 1200);
        if (!gain) {
          // Rajita de hucha rota sobre el monedero, un instante.
          const crack = document.createElement('span');
          crack.className = 'absolute -right-1 -top-2 z-10';
          crack.innerHTML =
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2.5l-3.5 6 4.2 1.6-3.9 6.2 4.6 1.7-2.5 4"/></svg>';
          chip.appendChild(crack);
          window.setTimeout(() => crack.remove(), 1000);
        }
        playSound(gain ? 'hucha_in' : 'hucha_out');
      }, arrive);
    };

    if (dF !== 0) burst('funds', dF);
    if (dW !== 0) burst('wallet', dW);
  }, [funds, wallet]);

  // Limpieza del marcador de hucha rota (solo informativo para el aria-live).
  useEffect(() => {
    return () => {
      broken.current = null;
    };
  }, []);

  return (
    <div ref={boxRef} className="pointer-events-none absolute right-2 top-2 z-20 flex flex-col items-end gap-1.5">
      <span
        ref={(el) => {
          chips.current.funds = el;
        }}
        className="money-chip relative"
        role="status"
        aria-label={t('money.fundsAria', { n: funds })}
      >
        {t('money.funds', { n: funds })}
      </span>
      <span
        ref={(el) => {
          chips.current.wallet = el;
        }}
        className="money-chip relative"
        role="status"
        aria-label={t('money.walletAria', { n: wallet })}
      >
        {t('money.wallet', { n: wallet })}
      </span>
    </div>
  );
}
