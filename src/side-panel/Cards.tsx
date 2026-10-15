// Cards. Titles and fixed lines are the extension's own strings; page and agent text is shown as plain text with
// control, zero-width and bidirectional characters removed. A card never takes focus when it appears, and its keys work
// only while it has focus.
import { useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { OpenPrompt } from '@src/ui/protocol';
import { t } from '@src/ui/i18n';
import type { MessageKey } from '@src/ui/i18n';
import { requestOptionalPermissions, useGrantedPermissions } from '@src/ui/optional-permissions';

/** Page or model text for a card: one line of plain text with invisible and control characters removed. */
export function plain(text: unknown): string {
  return (
    String(text ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function showTab(tabId?: number): void {
  if (tabId !== undefined) void chrome.tabs.update(tabId, { active: true });
}

function Frame({
  title,
  tone,
  children,
  onKeyDown,
}: {
  title: string;
  tone: 'write' | 'yours' | 'agent';
  children: ReactNode;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  const border =
    tone === 'yours'
      ? 'border-amber-400 dark:border-amber-600'
      : tone === 'write'
        ? 'border-nb-accent'
        : 'border-nb-border';
  const bar = tone === 'yours' ? 'bg-amber-400 dark:bg-amber-600' : tone === 'write' ? 'bg-nb-accent' : 'bg-nb-sky';
  return (
    // The card answers keys only while it has focus, so it can be focused.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      aria-label={title}
      onKeyDown={onKeyDown}
      className={`flex flex-col gap-2 rounded-2xl border-2 ${border} bg-nb-bg p-3.5 text-sm shadow-pop focus:outline-none focus:ring-2 focus:ring-nb-accent/40`}>
      <div className="flex items-center gap-2">
        <span aria-hidden className={`h-4 w-1 shrink-0 rounded-full ${bar}`} />
        <h2 className="font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Line({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <p className={muted ? 'text-xs text-nb-muted' : ''}>{children}</p>;
}

function Buttons({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 pt-1">{children}</div>;
}

const btn = 'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors';
const primary = `${btn} bg-nb-accent text-white shadow-sm hover:bg-nb-accent-strong`;
const secondary = `${btn} border border-nb-border bg-nb-bg hover:bg-nb-surface`;
const link = `${btn} text-nb-link underline`;

const WRITE_TITLES: Record<string, MessageKey> = {
  submit: 'card.write.title.submit',
  delete: 'card.write.title.delete',
  upload: 'card.write.title.upload',
};

function WriteCard({ prompt, answer }: { prompt: OpenPrompt; answer: (a: unknown) => void }) {
  const d = prompt.data;
  const site = plain(d.site);
  const canRemember = !!d.canRemember;
  return (
    <Frame
      title={t(WRITE_TITLES[String(d.category)] ?? 'card.write.title.other')}
      tone="write"
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canRemember) answer('approve-remember');
        else if (e.key === 'Enter') answer('approve');
        else if (e.key === 'Escape') {
          e.stopPropagation();
          answer('decline');
        }
      }}>
      <Line>
        {plain(d.action)} {plain(d.target)}
      </Line>
      <Line>{t('card.onSite', { site: site || t('card.noSite') })}</Line>
      {d.frameHost ? <Line muted>{t('card.frameHost', { host: plain(d.frameHost) })}</Line> : null}
      {d.destinationHost ? <Line muted>{t('card.destinationHost', { host: plain(d.destinationHost) })}</Line> : null}
      {d.intent ? <Line muted>{t('card.agentPurpose', { purpose: plain(d.intent) })}</Line> : null}
      <Line muted>{t('card.reason', { reason: plain(d.reason) })}</Line>
      {!canRemember && site ? <Line muted>{t('card.siteAsks')}</Line> : null}
      <Buttons>
        <button type="button" className={primary} onClick={() => answer('approve')}>
          {t('card.allowOnce')}
        </button>
        {canRemember ? (
          <button type="button" className={secondary} onClick={() => answer('approve-remember')}>
            {t('card.alwaysAllow')}
          </button>
        ) : null}
        <button type="button" className={secondary} onClick={() => answer('decline')}>
          {t('card.decline')}
        </button>
        <button type="button" className={link} onClick={() => showTab(prompt.tabId)}>
          {t('card.showTab')}
        </button>
      </Buttons>
    </Frame>
  );
}

const STEP_LINES: Record<string, MessageKey> = {
  pay: 'card.handover.pay',
  grant: 'card.handover.grant',
  secret: 'card.handover.secret',
  prompt: 'card.handover.prompt',
};
const STEP_KINDS: Record<string, MessageKey> = {
  pay: 'card.kind.pay',
  grant: 'card.kind.grant',
  secret: 'card.kind.secret',
  prompt: 'card.kind.prompt',
};

function HandoverCard({ prompt, answer }: { prompt: OpenPrompt; answer: (a: unknown) => void }) {
  const d = prompt.data;
  const site = plain(d.site) || t('card.noSite');
  const reason = String(d.reason);
  return (
    <Frame title={`${t('card.handover.title')} · ${t(STEP_KINDS[reason] ?? 'card.kind.pay')}`} tone="yours">
      <Line>{t(STEP_LINES[reason] ?? 'card.handover.pay', { site })}</Line>
      <Line muted>{t('card.handover.then')}</Line>
      {d.restarted ? <Line muted>{t('card.handover.restarted')}</Line> : null}
      {reason === 'prompt' && d.hasBrowserHandler === false ? <Line muted>{t('card.handover.noDialog')}</Line> : null}
      {d.notice === 'dialog-waiting' ? <Line>{t('card.handover.dialogWaiting')}</Line> : null}
      <Line muted>{t('card.checkAddress')}</Line>
      <Buttons>
        <button type="button" className={primary} onClick={() => answer('given-back')}>
          {t('card.done')}
        </button>
        <button type="button" className={secondary} onClick={() => answer('cancelled')}>
          {t('common.cancel')}
        </button>
        <button type="button" className={link} onClick={() => showTab(prompt.tabId)}>
          {t('card.showTab')}
        </button>
      </Buttons>
    </Frame>
  );
}

function TakeoverCard({ prompt, answer }: { prompt: OpenPrompt; answer: (a: unknown) => void }) {
  const d = prompt.data;
  return (
    <Frame title={t('card.takeover.title')} tone="agent">
      <Line>{plain(d.message)}</Line>
      <Line>{t('card.onSite', { site: plain(d.site) || t('card.noSite') })}</Line>
      <Line muted>{t('card.takeover.secrets')}</Line>
      <Buttons>
        <button type="button" className={primary} onClick={() => answer({ outcome: 'continue' })}>
          {t('card.done')}
        </button>
        <button type="button" className={secondary} onClick={() => answer({ outcome: 'cancel' })}>
          {t('common.cancel')}
        </button>
        <button type="button" className={link} onClick={() => showTab(prompt.tabId)}>
          {t('card.showTab')}
        </button>
      </Buttons>
    </Frame>
  );
}

function InputCard({ prompt, answer }: { prompt: OpenPrompt; answer: (a: unknown) => void }) {
  const d = prompt.data;
  const [value, setValue] = useState('');
  /** An answer that looks like a card number is held once, with the composer's warning. */
  const [held, setHeld] = useState<string | null>(null);
  const site = plain(d.site);
  return (
    <Frame title={t('card.input.title')} tone="agent">
      <blockquote className="border-l-2 border-nb-sky pl-2">{plain(d.message)}</blockquote>
      <Line muted>{t('card.onSite', { site: site || t('card.noSite') })}</Line>
      <Line muted>{t('card.input.noSecrets')}</Line>
      {held !== null && held === value ? (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">
          {t('composer.cardWarning')} {t('card.input.sendAgain')}
        </p>
      ) : null}
      <form
        className="flex gap-2"
        onSubmit={e => {
          e.preventDefault();
          if (held !== value && containsCardNumber(value)) {
            setHeld(value);
            return;
          }
          answer({ outcome: 'continue', data: value });
        }}>
        <input
          aria-label={t('card.input.answer')}
          value={value}
          onChange={e => setValue(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-nb-border bg-nb-bg px-2 py-1 text-sm focus:border-nb-accent focus:outline-none focus:ring-2 focus:ring-nb-accent/25"
        />
        <button type="submit" className={primary}>
          {t('composer.send')}
        </button>
        <button type="button" className={secondary} onClick={() => answer({ outcome: 'cancel' })}>
          {t('card.input.skip')}
        </button>
      </form>
    </Frame>
  );
}

function ConfirmCard({ prompt, answer }: { prompt: OpenPrompt; answer: (a: unknown) => void }) {
  return (
    <Frame title={t('card.confirm.moveTab')} tone="agent">
      <Line muted>{plain(prompt.data.title)}</Line>
      <Buttons>
        <button type="button" className={primary} onClick={() => answer('yes')}>
          {t('card.yes')}
        </button>
        <button type="button" className={secondary} onClick={() => answer('no')}>
          {t('card.no')}
        </button>
      </Buttons>
    </Frame>
  );
}

/** Saving a file needs these, and Open and Show in folder on the saved file need the second. */
const SAVE_PERMISSIONS = ['downloads', 'downloads.open'] as const;

/**
 * The Save file card: the file the agent wants to save, in Ask mode, and in Auto mode until saving is allowed. When
 * Chrome's permission to save is missing, Save and Save as ask for it first, straight from the click, and answer only
 * when it is allowed.
 */
function SaveFileCard({ prompt, answer }: { prompt: OpenPrompt; answer: (a: unknown) => void }) {
  const d = prompt.data;
  const granted = useGrantedPermissions();
  const allowed = !!granted && SAVE_PERMISSIONS.every(p => granted[p]);
  const [refused, setRefused] = useState(false);
  const save = (choice: 'save' | 'save-as') => {
    if (allowed) return answer(choice);
    // No await before the request: Chrome takes it only while the click lasts.
    void requestOptionalPermissions(SAVE_PERMISSIONS).then(ok => (ok ? answer(choice) : setRefused(true)));
  };
  return (
    <Frame title={t('card.save.title')} tone="write">
      <Line>
        {plain(d.filename)} · {plain(d.mimeType)} · {Number(d.bytes).toLocaleString()} B
      </Line>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-nb-surface p-2 font-mono text-[11px]">
        {String(d.preview ?? '')}
      </pre>
      <Line muted>{t('card.save.where')}</Line>
      {refused && !allowed ? (
        <Line>{t('card.save.refused')}</Line>
      ) : granted && !allowed ? (
        <Line muted>{t('card.save.askFirst')}</Line>
      ) : null}
      <Buttons>
        <button type="button" className={primary} onClick={() => save('save')}>
          {t('card.save.save')}
        </button>
        <button type="button" className={secondary} onClick={() => save('save-as')}>
          {t('card.save.saveAs')}
        </button>
        <button type="button" className={secondary} onClick={() => answer('discard')}>
          {t('card.save.discard')}
        </button>
      </Buttons>
    </Frame>
  );
}

export function Cards({ prompts, answer }: { prompts: OpenPrompt[]; answer: (id: string, a: unknown) => void }) {
  if (!prompts.length) return null;
  return (
    <div className="flex flex-col gap-2 px-2 pb-2">
      {prompts.map(p => {
        const reply = (a: unknown) => answer(p.id, a);
        switch (p.kind) {
          case 'write-card':
            return <WriteCard key={p.id} prompt={p} answer={reply} />;
          case 'handover':
            return <HandoverCard key={p.id} prompt={p} answer={reply} />;
          case 'ask-takeover':
            return <TakeoverCard key={p.id} prompt={p} answer={reply} />;
          case 'ask-input':
            return <InputCard key={p.id} prompt={p} answer={reply} />;
          case 'confirm':
            return <ConfirmCard key={p.id} prompt={p} answer={reply} />;
          case 'save-file':
            return <SaveFileCard key={p.id} prompt={p} answer={reply} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

/** A card number, by its digits and the Luhn check (the composer warns before sending one). */
export function containsCardNumber(text: string): boolean {
  for (const match of text.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}
