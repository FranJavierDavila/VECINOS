'use client';

import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Loader2, Lock, Plus, Sofa, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getController } from '@/game/client/bridge';
import { useGameStore } from '@/game/client/store';
import type { HomeRoomUi, HomeUi, PlacedItemUi, SlotUi } from '@/game/client/store';
import { loadContent } from '@/game/content';
import type { FurnitureDef } from '@/game/core/types';
import { cn } from '@/lib/utils';

// ───────────────────────── Catálogo (carga única, cliente) ─────────────────────────

/** Emoji y etiqueta de un canal de influencia, para pintar emisiones de los muebles. */
interface ChannelInfo {
  label?: string;
  emoji?: string;
}

/** Parte del catálogo que necesita el editor: muebles + info de canales. */
interface CatalogData {
  furniture: Record<string, FurnitureDef>;
  channels: Record<string, ChannelInfo>;
}

/**
 * Porción del estado que consume este panel. `wallet` (siempre presente en el store) ancla el
 * tipo; `homes` y `furnitureConfig` llegan vía syncHud (HudSnapshot), así que mientras esa pieza
 * del store aterriza en paralelo, los opcionales caen a valores por defecto sin romper la build.
 */
interface EditorStateSlice {
  wallet: number;
  homes?: HomeUi[];
  furnitureConfig?: { refundRatio: number; roomUnlockPrice: number };
}

const DEFAULT_FURNITURE_CONFIG: { refundRatio: number; roomUnlockPrice: number } = {
  refundRatio: 0.5,
  roomUnlockPrice: 250,
};

const selectHomes = (s: EditorStateSlice): HomeUi[] => s.homes ?? [];
const selectFurnitureConfig = (s: EditorStateSlice) => s.furnitureConfig ?? DEFAULT_FURNITURE_CONFIG;

/** Convierte un color hex (#rgb / #rrggbb) en rgba con la opacidad dada. Si no es hex, lo devuelve tal cual. */
function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;
  let hex = match[1]!;
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const value = Number.parseInt(hex, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ───────────────────────── Drag & drop (pointer events, sin HTML5 dragstart) ─────────────────────────

/** Umbral (px) a partir del cual un arrastre con ratón/pen se convierte en drag activo. */
const DRAG_THRESHOLD_MOUSE_PX = 6;
/** Movimiento máximo (px) en táctil antes del long-press: si se supera, era un scroll y se cancela. */
const TOUCH_CANCEL_PX = 8;
/** Duración (ms) del long-press que inicia el drag en táctil (así el scroll del catálogo sigue funcionando). */
const LONG_PRESS_MS = 260;

/** Evita el scroll del navegador mientras un drag táctil está activo (listener NO pasivo en document). */
function preventTouchScroll(event: TouchEvent): void {
  event.preventDefault();
}

/** Veredicto de una ranura frente al item arrastrado: compatible ('ok'), incompatible ('no') o sin drag. */
type DropHint = 'ok' | 'no' | null;

/** Ranura bajo el puntero durante un drag (leída de los data-slot-* del plano). */
interface HoveredSlot {
  roomKey: string;
  slotId: string;
  kind: string;
}

/** Estado de drag visible para el render (el fantasma). */
interface DragState {
  item: FurnitureDef;
  x: number;
  y: number;
}

/**
 * Sesión de drag potencial/activo; vive en refs, fuera del ciclo de render. Empieza "potencial"
 * en el pointerdown y pasa a activa al superar el umbral (ratón/pen) o al long-press (táctil).
 * Solo primitivos (ids y coordenadas) e INMUTABLE: cada cambio (posición, active) reemplaza el
 * objeto con un spread; el id del timer del long-press vive en su propia ref.
 */
interface DragSession {
  itemId: string;
  homeId: string;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
}

// ───────────────────────── Piezas internas ─────────────────────────

interface SlotChipProps {
  slot: SlotUi;
  roomKey: string;
  selected: boolean;
  /** Pista mientras se arrastra un item: compatible y vacía ('ok'), incompatible ('no'). */
  dropHint?: DropHint;
  /** Veredicto de ESTA ranura estando bajo el puntero durante un drag. */
  hoverHint?: DropHint;
  onSelect: () => void;
}

/** Ranura sobre el plano de la estancia: vacía (punteada con "+") u ocupada (chip con emoji y nombre). */
function SlotChip({ slot, roomKey, selected, dropHint, hoverHint, onSelect }: SlotChipProps) {
  const position = { left: `${slot.left}%`, bottom: `${slot.bottom}%` } as const;

  if (!slot.item) {
    return (
      <button
        type="button"
        onClick={onSelect}
        style={position}
        data-slot-room={roomKey}
        data-slot-id={slot.id}
        data-slot-kind={slot.kind}
        aria-label={`Ranura vacía de tipo ${slot.kind}. Ábrela para elegir mueble`}
        className={cn(
          'absolute flex size-9 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full border-2 border-dashed transition-[color,background-color,border-color,scale]',
          'border-muted-foreground/40 text-muted-foreground hover:border-amber-500 hover:text-amber-600',
          'focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:outline-none',
          selected && 'border-amber-500 text-amber-600 ring-2 ring-amber-500 ring-offset-2 ring-offset-background',
          dropHint === 'ok' && 'border-emerald-500/60 bg-emerald-500/10 ring-2 ring-emerald-500/70 ring-offset-2 ring-offset-background',
          dropHint === 'no' && 'border-rose-500/50 ring-2 ring-rose-500/50 ring-offset-2 ring-offset-background',
          hoverHint === 'ok' && 'border-emerald-500 scale-[1.08] ring-2 ring-emerald-500',
          hoverHint === 'no' && 'ring-2 ring-rose-500/80',
        )}
      >
        <Plus className="size-4" aria-hidden />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        ...position,
        backgroundColor: withAlpha(slot.item.color, 0.85),
        borderColor: 'rgba(255, 255, 255, 0.35)',
      }}
      data-slot-room={roomKey}
      data-slot-id={slot.id}
      data-slot-kind={slot.kind}
      aria-label={`${slot.item.name}. Pulsa para ver opciones de retirada`}
      className={cn(
        'absolute flex max-w-32 -translate-x-1/2 translate-y-1/2 items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium text-white shadow-sm transition-transform hover:scale-[1.03]',
        'focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:outline-none',
        selected && 'ring-2 ring-amber-500 ring-offset-2 ring-offset-background',
        dropHint === 'no' && 'ring-2 ring-rose-500/50 ring-offset-2 ring-offset-background',
        hoverHint === 'no' && 'ring-2 ring-rose-500/80',
      )}
    >
      <span aria-hidden>{slot.item.emoji}</span>
      <span className="truncate">{slot.item.name}</span>
    </button>
  );
}

interface CatalogItemCardProps {
  item: FurnitureDef;
  channels: Record<string, ChannelInfo>;
  affordable: boolean;
  onPlace: () => void;
  /** Origen del drag: pointerdown sobre la tarjeta (el botón "Colocar" lo detiene con stopPropagation). */
  onDragStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Evita el menú contextual del long-press móvil mientras hay una sesión de drag. */
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

/** Tarjeta del catálogo: emoji, nombre, precio, descripción, emisiones/parámetros, botón "Colocar" y drag. */
function CatalogItemCard({
  item,
  channels,
  affordable,
  onPlace,
  onDragStart,
  onContextMenu,
}: CatalogItemCardProps) {
  const emits = Object.entries(item.emits ?? {});
  const hasEffects = emits.length > 0 || (item.params?.length ?? 0) > 0;

  return (
    <div
      role="group"
      aria-label={`${item.name}. ${item.price} euros. Arrástralo a una ranura del plano o pulsa Colocar`}
      onPointerDown={onDragStart}
      onContextMenu={onContextMenu}
      className="flex cursor-grab flex-col gap-1.5 rounded-md border p-2.5"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-sm leading-tight font-medium">
          {item.emoji && <span aria-hidden>{item.emoji}</span>}
          <span className="truncate" title={item.name}>
            {item.name}
          </span>
        </p>
        <Badge variant="secondary" className="shrink-0 font-mono text-xs">
          {item.price} €
        </Badge>
      </div>

      <p className="text-xs leading-snug text-muted-foreground">{item.description}</p>

      {hasEffects && (
        <div className="flex flex-wrap gap-1">
          {emits.map(([channel, value]) => {
            const info = channels[channel];
            return (
              <Badge
                key={channel}
                variant="outline"
                title={info?.label ?? channel}
                className={cn(
                  value > 0
                    ? 'border-orange-500/30 bg-orange-500/15 text-orange-600 dark:text-orange-400'
                    : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                )}
              >
                {info?.emoji ?? channel} {value > 0 ? '+' : ''}
                {value}
              </Badge>
            );
          })}
          {(item.params ?? []).map((p) => (
            <Badge
              key={p.param}
              variant="outline"
              className="border-border bg-muted text-muted-foreground"
            >
              {p.param} {p.delta > 0 ? '+' : ''}
              {p.delta}
            </Badge>
          ))}
        </div>
      )}

      <Button
        size="sm"
        disabled={!affordable}
        title={affordable ? `Colocar por ${item.price} €` : 'Sin fondos'}
        onClick={onPlace}
        onPointerDown={(event) => event.stopPropagation()}
        aria-label={`Colocar ${item.name} (${item.price} euros)`}
        className="mt-auto w-full bg-amber-600 text-white hover:bg-amber-700"
      >
        Colocar
      </Button>
    </div>
  );
}

interface LockedRoomBodyProps {
  roomLabel: string;
  price: number;
  affordable: boolean;
  onRenovate: () => void;
}

/** Estancia cerrada: en lugar de ranuras, el CTA de reforma. */
function LockedRoomBody({ roomLabel, price, affordable, onRenovate }: LockedRoomBodyProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center">
      <Lock className="size-5 text-muted-foreground" aria-hidden />
      <p className="max-w-xs text-sm text-muted-foreground">
        {roomLabel} sigue cerrada con llave y con las cajas del anterior inquilino. Un reformista la
        abrirá por un precio razonable... para él.
      </p>
      <Button
        size="sm"
        disabled={!affordable}
        title={affordable ? undefined : 'Sin fondos'}
        onClick={onRenovate}
        aria-label={`Reformar ${roomLabel} por ${price} euros`}
        className="bg-amber-600 text-white hover:bg-amber-700"
      >
        Reformar ({price} €)
      </Button>
    </div>
  );
}

// ───────────────────────── Panel "Mi piso" ─────────────────────────

export function InteriorEditorPanel() {
  const homes = useGameStore(selectHomes);
  const wallet = useGameStore((s) => s.wallet);
  const furnitureConfig = useGameStore(selectFurnitureConfig);

  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [homeId, setHomeId] = useState<string | null>(null);
  const [roomKey, setRoomKey] = useState<string | null>(null);
  /** Ranura abierta (vacía → catálogo; ocupada → fila de retirada). */
  const [selected, setSelected] = useState<{ roomKey: string; slotId: string } | null>(null);

  // Estado de drag & drop: lo visible para render (fantasma + ranura bajo el puntero) y la sesión en refs.
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hovered, setHovered] = useState<HoveredSlot | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const hoveredRef = useRef<HoveredSlot | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  /** Id del temporizador de long-press (separa de la sesión para no mutarla). */
  const longPressTimerRef = useRef<number | null>(null);
  /** Quita los listeners de ventana añadidos al empezar la sesión (misma identidad de funciones). */
  const detachWindowListenersRef = useRef<(() => void) | null>(null);

  // El catálogo se cachea como promesa en loadContent(); una sola llamada por montaje.
  useEffect(() => {
    let cancelled = false;
    loadContent()
      .then(({ content }) => {
        if (cancelled) return;
        const channels: Record<string, ChannelInfo> = {};
        for (const influence of Object.values(content.influences)) {
          channels[influence.channel] = { label: influence.label, emoji: influence.emoji };
        }
        setCatalog({ furniture: content.furniture, channels });
      })
      .catch(() => {
        if (!cancelled) setCatalogError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Selecciones estables entre refrescos del HUD: si el id guardado ya no existe, se cae a la primera.
  const home: HomeUi | null = homes.find((h) => h.id === homeId) ?? homes[0] ?? null;
  const room: HomeRoomUi | null =
    home?.rooms.find((r) => r.key === roomKey) ?? home?.rooms[0] ?? null;
  const activeSlot: SlotUi | null =
    selected && room && selected.roomKey === room.key
      ? (room.slots.find((s) => s.id === selected.slotId) ?? null)
      : null;

  /**
   * Catálogo visible: filtrado por la ranura vacía seleccionada (si la hay) o completo para arrastrar
   * libremente al plano. Sin useMemo a propósito: el React Compiler no puede preservar esa
   * memoización manual junto al motor de drag imperativo (refs + listeners de ventana) y
   * `preserve-manual-memoization` lo marca como error; el cálculo es trivial (una veintena de items).
   */
  const catalogItems: FurnitureDef[] = catalog
    ? Object.values(catalog.furniture)
        .filter((f) => (activeSlot && !activeSlot.item ? f.slots.includes(activeSlot.kind) : true))
        .sort((a, b) => a.price - b.price)
    : [];

  const refundOf = (item: PlacedItemUi): number => {
    const price = catalog?.furniture[item.id]?.price ?? 0;
    return Math.round(price * furnitureConfig.refundRatio);
  };

  const handleSlotSelect = (roomKeyValue: string, slot: SlotUi) => {
    setSelected((prev) =>
      prev && prev.roomKey === roomKeyValue && prev.slotId === slot.id
        ? null
        : { roomKey: roomKeyValue, slotId: slot.id },
    );
  };

  const handlePlace = (item: FurnitureDef) => {
    if (!home || !room || !activeSlot) return;
    getController()?.placeFurniture(home.id, room.key, activeSlot.id, item.id);
    setSelected(null);
  };

  const handleRemove = () => {
    if (!home || !room || !activeSlot) return;
    getController()?.removeFurniture(home.id, room.key, activeSlot.id);
    setSelected(null);
  };

  const handleRenovate = (key: string) => {
    if (!home) return;
    getController()?.renovateRoom(home.id, key);
  };

  // ── Drag & drop: sesión en refs + listeners de ventana imperativos (sin estados en efectos) ──

  const activateDrag = () => {
    const session = dragRef.current;
    if (!session || session.active) return;
    const item = catalog?.furniture[session.itemId];
    if (!item) return;
    dragRef.current = { ...session, active: true };
    setDrag({ item, x: session.x, y: session.y });
    if (session.pointerType === 'touch') {
      // Congela el scroll del navegador durante el arrastre táctil (listener no pasivo).
      document.addEventListener('touchmove', preventTouchScroll, { passive: false });
    }
  };

  /** Ranura bajo el puntero vía elementFromPoint; solo re-renderiza al cruzar entre ranuras. */
  const updateHoveredSlot = (x: number, y: number) => {
    const target = document.elementFromPoint(x, y);
    const slotEl = target?.closest('[data-slot-id]') ?? null;
    const next: HoveredSlot | null = slotEl
      ? {
          roomKey: slotEl.getAttribute('data-slot-room') ?? '',
          slotId: slotEl.getAttribute('data-slot-id') ?? '',
          kind: slotEl.getAttribute('data-slot-kind') ?? '',
        }
      : null;
    const prev = hoveredRef.current;
    if (prev?.roomKey === next?.roomKey && prev?.slotId === next?.slotId) return;
    hoveredRef.current = next;
    setHovered(next);
  };

  /** Suelta listeners, temporizador, clases de body y estado de drag. Silencioso si no había sesión. */
  const endDrag = () => {
    detachWindowListenersRef.current?.();
    detachWindowListenersRef.current = null;
    document.removeEventListener('touchmove', preventTouchScroll);
    document.body.classList.remove('select-none');
    if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    dragRef.current = null;
    hoveredRef.current = null;
    setDrag(null);
    setHovered(null);
  };

  const handleDragPointerMove = (event: PointerEvent) => {
    const session = dragRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    // Sesión inmutable: la posición se actualiza reemplazando el objeto, nunca mutándolo.
    dragRef.current = { ...session, x: event.clientX, y: event.clientY };

    if (!session.active) {
      const dist = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (session.pointerType === 'touch') {
        // Movimiento apreciable antes del long-press: era un scroll, se cancela el drag.
        if (dist > TOUCH_CANCEL_PX) endDrag();
        return;
      }
      if (dist > DRAG_THRESHOLD_MOUSE_PX) activateDrag();
      return;
    }

    // Drag activo: el fantasma sigue al puntero (imperativo, sin re-render por frame).
    const ghost = ghostRef.current;
    if (ghost) {
      ghost.style.left = `${event.clientX}px`;
      ghost.style.top = `${event.clientY}px`;
    }
    updateHoveredSlot(event.clientX, event.clientY);
  };

  const handleDragPointerUp = (event: PointerEvent) => {
    const session = dragRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    if (session.active) {
      const target = hoveredRef.current;
      // El sim valida (ranura equivocada, ocupada, sin fondos...) y muestra sus toasts;
      // el cliente no duplica reglas. Sin ranura bajo el puntero: cancela en silencio.
      if (target) {
        getController()?.placeFurniture(session.homeId, target.roomKey, target.slotId, session.itemId);
      }
    }
    endDrag();
  };

  const handleDragPointerCancel = (event: PointerEvent) => {
    const session = dragRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    endDrag();
  };

  const startPotentialDrag = (event: ReactPointerEvent<HTMLDivElement>, item: FurnitureDef) => {
    if (dragRef.current) return; // ya hay una sesión en curso
    if (!event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const session: DragSession = {
      itemId: item.id,
      homeId: home?.id ?? '',
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    dragRef.current = session;
    // Evita selección de texto/magnifier desde el primer frame del gesto (se quita al terminar).
    document.body.classList.add('select-none');

    window.addEventListener('pointermove', handleDragPointerMove);
    window.addEventListener('pointerup', handleDragPointerUp);
    window.addEventListener('pointercancel', handleDragPointerCancel);
    detachWindowListenersRef.current = () => {
      window.removeEventListener('pointermove', handleDragPointerMove);
      window.removeEventListener('pointerup', handleDragPointerUp);
      window.removeEventListener('pointercancel', handleDragPointerCancel);
    };

    if (event.pointerType === 'touch') {
      longPressTimerRef.current = window.setTimeout(() => {
        const current = dragRef.current;
        if (!current || current.pointerId !== session.pointerId) return;
        longPressTimerRef.current = null;
        activateDrag();
      }, LONG_PRESS_MS);
    }
  };

  const handleCardContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    // El long-press en móvil no debe abrir el menú contextual a mitad de drag.
    if (dragRef.current) event.preventDefault();
  };

  // Desmontaje a mitad de drag: descolgar todo sin tocar estados (los setState serían no-op).
  useEffect(() => {
    return () => {
      detachWindowListenersRef.current?.();
      detachWindowListenersRef.current = null;
      document.removeEventListener('touchmove', preventTouchScroll);
      document.body.classList.remove('select-none');
      if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current);
      dragRef.current = null;
      hoveredRef.current = null;
    };
  }, []);

  if (homes.length === 0) {
    return (
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sofa className="size-4 text-amber-500" aria-hidden />
            Mi piso
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <p className="text-sm text-muted-foreground">
            Aún no tienes piso. El portal, de momento, es tuyo.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sofa className="size-4 text-amber-500" aria-hidden />
            Mi piso
          </CardTitle>
          <CardDescription>Amuebla, desamuebla y reforma. Como el BGAs, pero con candado.</CardDescription>
          <CardAction>
            <Badge
              variant="outline"
              title="Tu cartera"
              className="border-amber-500/30 bg-amber-500/15 font-mono text-amber-600 dark:text-amber-400"
            >
              {wallet} €
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="px-4">
          {catalogError && (
            <p className="text-sm text-muted-foreground">
              El catálogo de muebles no ha bajado al portal. Prueba de nuevo en un rato.
            </p>
          )}

          {!catalog && !catalogError && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Subiendo el catálogo del barrio...
            </p>
          )}

          {catalog && home && (
            <div className="flex flex-col gap-3">
              {homes.length > 1 && (
                <Select
                  value={home.id}
                  onValueChange={(id) => {
                    setHomeId(id);
                    setRoomKey(null);
                    setSelected(null);
                  }}
                >
                  <SelectTrigger className="w-full sm:w-56" aria-label="Elegir vivienda">
                    <SelectValue placeholder="Elige vivienda" />
                  </SelectTrigger>
                  <SelectContent>
                    {homes.map((h) => (
                      <SelectItem key={h.id} value={h.id}>
                        {h.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Tabs
                value={room?.key ?? ''}
                onValueChange={(key) => {
                  setRoomKey(key);
                  setSelected(null);
                }}
              >
                <TabsList className="h-auto w-full flex-wrap justify-start">
                  {home.rooms.map((r) => (
                    <TabsTrigger
                      key={r.key}
                      value={r.key}
                      aria-label={r.access === 'locked' ? `${r.label} (cerrada)` : r.label}
                    >
                      {r.label}
                      {r.access === 'locked' && <Lock className="size-3" aria-hidden />}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {home.rooms.map((r) => (
                  <TabsContent key={r.key} value={r.key} className="flex flex-col gap-3">
                    {r.access === 'locked' ? (
                      <LockedRoomBody
                        roomLabel={r.label}
                        price={furnitureConfig.roomUnlockPrice}
                        affordable={wallet >= furnitureConfig.roomUnlockPrice}
                        onRenovate={() => handleRenovate(r.key)}
                      />
                    ) : (
                      <>
                        {/* Plano de la estancia con las ranuras posicionadas (objetivos del drag) */}
                        <div className="relative h-40 w-full overflow-hidden rounded-lg border bg-muted/50 sm:h-48">
                          {r.slots.length === 0 ? (
                            <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
                              Esta estancia no tiene ranuras. Minimalismo forzado.
                            </p>
                          ) : (
                            r.slots.map((slot) => {
                              const compatibleWithDrag =
                                drag !== null && drag.item.slots.includes(slot.kind);
                              const isEmpty = slot.item === null;
                              const isHoveredTarget =
                                hovered !== null &&
                                hovered.roomKey === r.key &&
                                hovered.slotId === slot.id;

                              let dropHint: DropHint = null;
                              if (drag !== null) {
                                if (compatibleWithDrag && isEmpty) dropHint = 'ok';
                                else if (!compatibleWithDrag) dropHint = 'no';
                              }
                              const hoverHint: DropHint =
                                drag !== null && isHoveredTarget
                                  ? compatibleWithDrag && isEmpty
                                    ? 'ok'
                                    : 'no'
                                  : null;

                              return (
                                <SlotChip
                                  key={slot.id}
                                  slot={slot}
                                  roomKey={r.key}
                                  selected={activeSlot?.id === slot.id}
                                  dropHint={dropHint}
                                  hoverHint={hoverHint}
                                  onSelect={() => handleSlotSelect(r.key, slot)}
                                />
                              );
                            })
                          )}
                        </div>

                        {/* Ranura ocupada: retirada con reembolso */}
                        {activeSlot?.item && (
                          <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
                            <p className="min-w-0 truncate text-sm">
                              <span aria-hidden>{activeSlot.item.emoji}</span> {activeSlot.item.name}
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleRemove}
                              aria-label={`Quitar ${activeSlot.item.name} y recuperar ${refundOf(activeSlot.item)} euros`}
                              className="shrink-0 border-rose-500/40 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
                            >
                              <Trash2 className="size-4" aria-hidden />
                              Quitar (+{refundOf(activeSlot.item)} €)
                            </Button>
                          </div>
                        )}

                        {/* Catálogo: filtrado por la ranura seleccionada o completo para arrastrar */}
                        <div className="flex flex-col gap-2">
                          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                            {activeSlot && !activeSlot.item
                              ? `Catálogo · ranura «${activeSlot.kind}»`
                              : 'Catálogo · arrastra al plano (o pulsa una ranura vacía)'}
                          </p>
                          <ScrollArea className="max-h-72 [&>[data-slot=scroll-area-viewport]]:max-h-[inherit]">
                            {catalogItems.length === 0 ? (
                              <p className="px-1 py-3 text-sm text-muted-foreground">
                                Nada del catálogo encaja aquí. Ni el mueble de la suegra.
                              </p>
                            ) : (
                              <div className="grid grid-cols-1 gap-2 pr-2 sm:grid-cols-2">
                                {catalogItems.map((item) => (
                                  <CatalogItemCard
                                    key={item.id}
                                    item={item}
                                    channels={catalog.channels}
                                    affordable={wallet >= item.price}
                                    onPlace={() => handlePlace(item)}
                                    onDragStart={(event) => startPotentialDrag(event, item)}
                                    onContextMenu={handleCardContextMenu}
                                  />
                                ))}
                              </div>
                            )}
                            <ScrollBar className="w-1.5 [&_[data-slot=scroll-area-thumb]]:bg-amber-500/40" />
                          </ScrollArea>
                        </div>
                      </>
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fantasma del drag: fijo, sin eventos de puntero y oculto para lectores de pantalla */}
      {drag && (
        <div
          ref={ghostRef}
          aria-hidden
          style={{ left: drag.x, top: drag.y }}
          className="pointer-events-none fixed z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
        >
          <div
            className="flex max-w-40 rotate-2 scale-105 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white shadow-xl ring-2 ring-amber-500"
            style={{ backgroundColor: withAlpha(drag.item.view.color, 0.9) }}
          >
            {drag.item.emoji && <span aria-hidden>{drag.item.emoji}</span>}
            <span className="truncate">{drag.item.name}</span>
          </div>
          <span className="rounded-full bg-neutral-900/80 px-2 py-0.5 text-[10px] text-amber-200">
            {drag.item.price} €
          </span>
        </div>
      )}
    </>
  );
}
