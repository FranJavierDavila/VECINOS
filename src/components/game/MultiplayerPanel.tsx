'use client';

import { useState } from 'react';
import { Copy, Crown, LogOut, Mail, RefreshCw, Users, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { blockLabel } from '@/game/core/types';
import { getController } from '@/game/client/bridge';
import { useGameStore } from '@/game/client/store';

/**
 * Panel de multijugador: crear sesión compartida o unirse por código.
 * SOLO habla con el puente (getController) y con el store: nunca importa el controller
 * directamente (arrastraría Babylon.js al bundle de React).
 */
export function MultiplayerPanel() {
  const open = useGameStore((s) => s.mpPanelOpen);
  const setOpen = useGameStore((s) => s.setMpPanelOpen);
  const status = useGameStore((s) => s.mpStatus);
  const code = useGameStore((s) => s.mpCode);
  const isHost = useGameStore((s) => s.mpIsHost);
  const myResidentId = useGameStore((s) => s.mpMyResidentId);
  const participants = useGameStore((s) => s.mpParticipants);
  const error = useGameStore((s) => s.mpError);
  const ready = useGameStore((s) => s.ready);
  // v1.54 — invitación que llegó por ENLACE (?join=CODE): la sirve el controller al cargar.
  const inviteCode = useGameStore((s) => s.mpInviteCode);
  const [codeInput, setCodeInput] = useState('');

  const ctrl = () => getController();

  const handleHost = () => ctrl()?.hostSession();
  const handleJoin = () => {
    if (codeInput.trim().length < 3) return;
    ctrl()?.joinSession(codeInput);
  };

  /** v1.54 — enlace de invitación de la sesión en curso (host o invitado pueden reenviarlo). */
  const shareUrl =
    code && typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?join=${code}`
      : null;
  const copyLink = (): void => {
    if (!shareUrl) return;
    void navigator.clipboard
      ?.writeText(shareUrl)
      .then(() => useGameStore.getState().pushToast('Enlace de invitación copiado. Envíaselo a tu vecino.', 'info'))
      .catch(() => useGameStore.getState().pushToast(shareUrl, 'info'));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" aria-describedby="mp-desc">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" aria-hidden />
            Multijugador
          </DialogTitle>
          <DialogDescription id="mp-desc">
            Una comunidad, un edificio: crea una partida compartida o únete con el código del tablón.
          </DialogDescription>
        </DialogHeader>

        {status === 'off' && (
          <div className="flex flex-col gap-4">
            {inviteCode && (
              <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Mail className="size-4 shrink-0" aria-hidden />
                  Te han invitado a la partida
                  <Badge variant="secondary" className="font-mono tracking-widest">
                    {inviteCode}
                  </Badge>
                </p>
                <Button
                  onClick={() => {
                    setCodeInput(inviteCode);
                    ctrl()?.joinSession(inviteCode);
                  }}
                  disabled={!ready}
                  className="w-full"
                >
                  <UserPlus aria-hidden />
                  Unirse a la partida
                </Button>
                {!ready && <p className="text-xs text-muted-foreground">Espera a que el edificio cargue.</p>}
              </div>
            )}
            <Button onClick={handleHost} disabled={!ready} className="w-full">
              <UserPlus aria-hidden />
              Crear partida compartida
            </Button>
            <div className="flex items-center gap-2">
              <Input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="CÓDIGO"
                maxLength={4}
                className="font-mono tracking-widest uppercase"
                aria-label="Código de la sesión"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleJoin();
                }}
              />
              <Button variant="outline" onClick={handleJoin} disabled={!ready || codeInput.trim().length < 4}>
                Unirse
              </Button>
            </div>
            {!ready && <p className="text-xs text-muted-foreground">Espera a que el edificio cargue.</p>}
          </div>
        )}

        {status === 'connecting' && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <RefreshCw className="size-4 animate-spin" aria-hidden />
            Conectando con la comunidad...
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-destructive">{error ?? 'No se pudo abrir la sesión.'}</p>
            <Button
              variant="outline"
              onClick={() => useGameStore.getState().setMpStatus('off')}
              className="w-full"
            >
              Volver a intentarlo
            </Button>
          </div>
        )}

        {status === 'connected' && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Código de sesión</span>
                <Badge
                  variant="secondary"
                  className="cursor-pointer font-mono text-base tracking-widest"
                  title="Copiar código"
                  onClick={() => {
                    if (code) void navigator.clipboard?.writeText(code);
                    useGameStore.getState().pushToast('Código copiado al portapapeles.', 'info');
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && code) void navigator.clipboard?.writeText(code);
                  }}
                >
                  {code ?? '—'}
                </Badge>
              </div>
              <Badge variant={isHost ? 'default' : 'outline'}>{isHost ? 'Anfitrión' : 'Invitado'}</Badge>
            </div>

            {myResidentId && (
              <p className="text-xs text-muted-foreground">
                Juegas como:{' '}
                <span className="font-medium text-foreground">
                  {participants.find((p) => p.id === myResidentId)?.name ?? myResidentId}
                </span>
              </p>
            )}

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                En la comunidad ({participants.length})
              </p>
              <ScrollArea className="max-h-40">
                <ul className="flex flex-col gap-1 pr-3">
                  {participants.map((p) => (
                    <li key={p.id} className="flex items-center justify-between rounded-md border px-2 py-1.5 text-sm">
                      <span className="flex items-center gap-1.5">
                        {p.id === myResidentId && isHost && <Crown className="size-3.5 text-amber-500" aria-hidden />}
                        {p.name}
                        {p.id === myResidentId && <span className="text-xs text-muted-foreground">(tú)</span>}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{blockLabel(p.home)}</span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Enlace de invitación</p>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={shareUrl ?? ''}
                  className="h-8 font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Enlace de invitación"
                />
                <Button variant="outline" size="icon" onClick={copyLink} aria-label="Copiar enlace de invitación" disabled={!shareUrl}>
                  <Copy aria-hidden />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Envíalo por WhatsApp, Discord o email: se abre el juego y entra con un clic (sin teclear el código).
              </p>
            </div>

            <Button variant="destructive" onClick={() => ctrl()?.leaveSession()} className="w-full">
              <LogOut aria-hidden />
              Salir de la sesión
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
