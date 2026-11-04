'use client';

/**
 * SELECTOR DE TEMAS DE CHARLA (v1.79) — modal pequeño sobre el vecino con el que acabas de
 * cruzarte (la E de charlar). Cada botón es un tema del catálogo social (social.json); al
 * elegirlo se manda el comando `talk` por la vía única y el sim resuelve la confianza del
 * vecino hacia ti (talk_result → bocadillo + post-it). Congela el mundo como la junta
 * (selectModalOpen/selectWorldFrozen incluyen store.talk).
 */

import { CloudSun, Dog, Flame, Hammer, MessageCircle, PartyPopper, Shield, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useT } from '@/game/client/i18n';
import { useGameStore, type TalkTopicUi } from '@/game/client/store';

/** Icono lucide por nombre del catálogo (con fallback de charla genérica). */
const ICONS: Record<string, LucideIcon> = {
  'cloud-sun': CloudSun,
  hammer: Hammer,
  dog: Dog,
  shield: Shield,
  'party-popper': PartyPopper,
  flame: Flame,
};

function TopicIcon({ name }: { name: string }) {
  const Icon = ICONS[name] ?? MessageCircle;
  return <Icon className="size-5 shrink-0 text-amber-600" aria-hidden />;
}

interface TalkModalProps {
  onSelect: (topicId: string) => void;
}

export function TalkModal({ onSelect }: TalkModalProps) {
  const t = useT();
  const talk = useGameStore((s) => s.talk);

  if (!talk) return null;

  const pick = (topic: TalkTopicUi) => () => onSelect(topic.id);

  return (
    <Dialog open={!!talk} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={true}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-sm"
        aria-label={t('talk.title')}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="size-5 shrink-0 text-amber-500" aria-hidden />
            {talk.name}
          </DialogTitle>
          <DialogDescription>{t('talk.title')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('talk.title')}>
          {talk.topics.map((topic) => (
            <Button
              key={topic.id}
              onClick={pick(topic)}
              variant="outline"
              className="h-auto min-h-11 justify-start gap-2 px-3 py-2 text-left text-xs font-medium"
              aria-label={topic.label}
            >
              <TopicIcon name={topic.icon} />
              <span className="leading-tight">{topic.label}</span>
            </Button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">{t('talk.hint')}</p>
      </DialogContent>
    </Dialog>
  );
}
