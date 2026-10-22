'use client';

import { useEffect, useMemo, useState } from 'react';
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

// ───────────────────────── Piezas internas ─────────────────────────

interface SlotChipProps {
  slot: SlotUi;
  selected: boolean;
  onSelect: () => void;
}

/** Ranura sobre el plano de la estancia: vacía (punteada con "+") u ocupada (chip con emoji y nombre). */
function SlotChip({ slot, selected, onSelect }: SlotChipProps) {
  const position = { left: `${slot.left}%`, bottom: `${slot.bottom}%` } as const;

  if (!slot.item) {
    return (
      <button
        type="button"
        onClick={onSelect}
        style={position}
        aria-label={`Ranura vacía de tipo ${slot.kind}. Ábrela para elegir mueble`}
        className={cn(
          'absolute flex size-9 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full border-2 border-dashed transition-colors',
          'border-muted-foreground/40 text-muted-foreground hover:border-amber-500 hover:text-amber-600',
          'focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:outline-none',
          selected && 'border-amber-500 text-amber-600 ring-2 ring-amber-500 ring-offset-2 ring-offset-background',
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
      aria-label={`${slot.item.name}. Pulsa para ver opciones de retirada`}
      className={cn(
        'absolute flex max-w-32 -translate-x-1/2 translate-y-1/2 items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium text-white shadow-sm transition-transform hover:scale-[1.03]',
        'focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:outline-none',
        selected && 'ring-2 ring-amber-500 ring-offset-2 ring-offset-background',
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
}

/** Tarjeta del catálogo: emoji, nombre, precio, descripción, emisiones/parámetros y botón "Colocar". */
function CatalogItemCard({ item, channels, affordable, onPlace }: CatalogItemCardProps) {
  const emits = Object.entries(item.emits ?? {});
  const hasEffects = emits.length > 0 || (item.params?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border p-2.5">
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

  /** Muebles compatibles con la ranura vacía abierta, ordenados por precio. */
  const compatible: FurnitureDef[] = useMemo(() => {
    if (!catalog || !activeSlot || activeSlot.item) return [];
    return Object.values(catalog.furniture)
      .filter((f) => f.slots.includes(activeSlot.kind))
      .sort((a, b) => a.price - b.price);
  }, [catalog, activeSlot]);

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
                      {/* Plano de la estancia con las ranuras posicionadas */}
                      <div className="relative h-40 w-full overflow-hidden rounded-lg border bg-muted/50 sm:h-48">
                        {r.slots.length === 0 ? (
                          <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
                            Esta estancia no tiene ranuras. Minimalismo forzado.
                          </p>
                        ) : (
                          r.slots.map((slot) => (
                            <SlotChip
                              key={slot.id}
                              slot={slot}
                              selected={activeSlot?.id === slot.id}
                              onSelect={() => handleSlotSelect(r.key, slot)}
                            />
                          ))
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

                      {/* Ranura vacía seleccionada: catálogo filtrado por tipo de ranura */}
                      {activeSlot && !activeSlot.item && (
                        <div className="flex flex-col gap-2">
                          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                            Catálogo · ranura «{activeSlot.kind}»
                          </p>
                          <ScrollArea className="max-h-72">
                            {compatible.length === 0 ? (
                              <p className="px-1 py-3 text-sm text-muted-foreground">
                                Nada del catálogo encaja aquí. Ni el mueble de la suegra.
                              </p>
                            ) : (
                              <div className="grid grid-cols-1 gap-2 pr-2 sm:grid-cols-2">
                                {compatible.map((item) => (
                                  <CatalogItemCard
                                    key={item.id}
                                    item={item}
                                    channels={catalog.channels}
                                    affordable={wallet >= item.price}
                                    onPlace={() => handlePlace(item)}
                                  />
                                ))}
                              </div>
                            )}
                            <ScrollBar className="w-1.5 [&_[data-slot=scroll-area-thumb]]:bg-amber-500/40" />
                          </ScrollArea>
                        </div>
                      )}
                    </>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
