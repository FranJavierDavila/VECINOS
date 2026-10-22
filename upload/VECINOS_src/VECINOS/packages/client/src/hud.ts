import type { Content } from '@vecinos/content';

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** "blk_p1_b" → "1B"; los demás ids se devuelven tal cual. */
export function blockLabel(id: string): string {
  const m = /^blk_p(\d+)_([a-d])$/.exec(id);
  return m ? `${m[1]}${m[2]!.toUpperCase()}` : id;
}

/** Interfaz en HTML sobre el lienzo: teléfono, decisiones, objetivo, avisos y panel lateral. */
export class Hud {
  private lines: { speaker: string; text: string }[] = [];
  private line = 0;
  private phoneMission = '';
  private toastTimer = 0;

  constructor(
    private readonly content: Content,
    private readonly onAnswer: (mission: string) => void,
    private readonly onChoose: (mission: string, choice: string) => void,
  ) {
    $('phone-next').addEventListener('click', () => this.advance());
  }

  get modalOpen(): boolean {
    return !$('phone').hidden || !$('choices').hidden;
  }

  showPhone(mission: string, dialogId: string) {
    const d = this.content.dialogs[dialogId];
    if (!d) return;
    this.lines = d.lines;
    this.line = 0;
    this.phoneMission = mission;
    $('phone').hidden = false;
    this.renderLine();
  }

  private renderLine() {
    const l = this.lines[this.line]!;
    $('phone-speaker').textContent = l.speaker;
    $('phone-text').textContent = l.text;
    $('phone-next').textContent = this.line === this.lines.length - 1 ? 'Colgar' : 'Siguiente';
  }

  /** Espacio o Enter: siguiente frase del teléfono. */
  advance() {
    if ($('phone').hidden) return;
    if (this.line < this.lines.length - 1) {
      this.line += 1;
      return this.renderLine();
    }
    $('phone').hidden = true;
    this.onAnswer(this.phoneMission);
  }

  showChoices(mission: string, title: string, choices: { id: string; label: string }[]) {
    $('choices-title').textContent = title;
    $('choices-list').replaceChildren(
      ...choices.map((c) => {
        const b = document.createElement('button');
        b.textContent = c.label;
        b.addEventListener('click', () => {
          $('choices').hidden = true;
          this.onChoose(mission, c.id);
        });
        return b;
      }),
    );
    $('choices').hidden = false;
  }

  toast(text: string, ms = 3200) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (el.hidden = true), ms);
  }

  private setText(id: string, text: string | null) {
    const el = $(id);
    el.hidden = text === null;
    if (text !== null && el.textContent !== text) el.textContent = text;
  }
  objective(text: string | null) { this.setText('objective', text); }
  prompt(text: string | null) { this.setText('prompt', text); }

  status(text: string, travel: string) {
    $('status').textContent = text;
    $('travel').textContent = travel;
  }

  list(id: 'params' | 'events', items: string[], ordered = false) {
    $(id).replaceChildren(
      ...items.map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
      }),
    );
    void ordered;
  }
}
