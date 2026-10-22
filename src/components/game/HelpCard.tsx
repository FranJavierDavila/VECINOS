'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Keyboard } from 'lucide-react';

const CONTROLS: { keys: string[]; text: string }[] = [
  { keys: ['A', 'D', '←', '→'], text: 'Moverte por la planta' },
  { keys: ['W', 'S', '↑', '↓'], text: 'Escalera o ascensor (en el núcleo)' },
  { keys: ['E'], text: 'Entrar, salir y usar cosas cercanas' },
  { keys: ['1', '2', '3'], text: 'Cámara: edificio / planta / estancia' },
  { keys: ['Espacio'], text: 'Avanzar los diálogos del teléfono' },
];

/** Chuleta de controles. Requiere teclado (los controles táctiles llegan en la próxima iteración). */
export function HelpCard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Keyboard className="h-4 w-4 text-amber-500" aria-hidden="true" />
          Controles
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {CONTROLS.map((c) => (
          <div key={c.text} className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1">
              {c.keys.map((k) => (
                <kbd key={k} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {k}
                </kbd>
              ))}
            </div>
            <span className="text-right text-xs text-muted-foreground">{c.text}</span>
          </div>
        ))}
        <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
          El tiempo corre solo: 1 segundo real = 1 minuto de juego (x1). Las fiestas de Kevin empiezan a las 21:30. Tú fuiste advertido.
        </p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Nuevo: ARRASTRA muebles del catálogo al plano (clic largo en móvil), minijuegos nuevos
          (secuencias, reflejos y parejas) y los canales plagas 🐜 y humo 💨: el guiso quemado de
          Dolores sube pisos y la fiesta de Kevin baja cucarachas. Todo data-driven, sin tocar código.
        </p>
      </CardContent>
    </Card>
  );
}
