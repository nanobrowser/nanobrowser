// The composer: a growing input where Enter sends and Shift+Enter adds a line (IME composition handled), ↑ recalls
// earlier prompts, the mode menu and the model picker beside it, and Send (an arrow) turning into Stop while a run is
// active.
import { useEffect, useRef, useState } from 'react';
import type { ModelRef, PermissionMode } from '@src/store/types';
import type { AttachmentRef } from '@src/ui/protocol';
import { Recorder, toWav } from '@src/ui/voice';
import { t } from '@src/ui/i18n';
import type { MessageKey } from '@src/ui/i18n';
import type { SavedShortcut } from '@src/store/shortcuts';
import { TabPicker } from './TabBar';
import { NoticeCard } from './NoticeCard';
import { ModeMenu } from '@src/ui/mode-menu';
import { ModelMenu } from './ModelMenu';
import type { ModelChoice } from './ModelMenu';
import type { ReasoningEffort } from '@src/llm/catalogue';
import { CloseIcon, FileIcon, MicIcon, PlusIcon, SendIcon, SpinnerIcon, StarIcon, StopIcon } from '@src/ui/icons';

type VoicePhase = 'idle' | 'starting' | 'recording' | 'transcribing';

export type { ModelChoice };

/** A file attached in the composer, already written to the blob store. */
export interface PendingFile {
  ref: AttachmentRef;
  /** An object URL for an image's thumbnail. */
  preview?: string;
}

function size(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The chips of the files to send, each with a preview and a remove button. */
export function AttachmentChips({ files, onRemove }: { files: PendingFile[]; onRemove?: (id: string) => void }) {
  if (!files.length) return null;
  return (
    <ul className="flex flex-wrap gap-1" aria-label={t('composer.attachments')} data-role="chips">
      {files.map(f => (
        <li
          key={f.ref.id}
          className="flex max-w-56 items-center gap-1.5 rounded-lg border border-nb-border bg-nb-bg px-1.5 py-1 text-xs shadow-sm">
          {f.preview ? (
            <img src={f.preview} alt="" className="size-6 rounded object-cover" />
          ) : (
            <FileIcon size={14} className="text-nb-link" />
          )}
          <span className="truncate">{f.ref.name}</span>
          <span className="whitespace-nowrap text-nb-muted">{size(f.ref.size)}</span>
          {onRemove ? (
            <button
              type="button"
              aria-label={t('composer.removeAttachment', { name: f.ref.name })}
              className="rounded p-0.5 text-nb-muted hover:bg-nb-surface hover:text-nb-fg"
              onClick={() => onRemove(f.ref.id)}>
              <CloseIcon size={12} />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export type LauncherItem =
  { kind: 'shortcut'; shortcut: SavedShortcut } | { kind: 'command'; command: 'new' | 'compact' };

/** What `/query` offers: pinned shortcuts, the others, then `/new` and `/compact`. */
export function launcherItems(query: string, shortcuts: SavedShortcut[]): LauncherItem[] {
  const q = query.toLowerCase();
  const match = (name: string, description = '') => name.includes(q) || description.toLowerCase().includes(q);
  const found = [
    ...shortcuts.filter(s => s.pinned && match(s.name, s.description)),
    ...shortcuts.filter(s => !s.pinned && match(s.name, s.description)),
  ];
  const commands = (['new', 'compact'] as const).filter(c => c.startsWith(q));
  return [
    ...found.map((shortcut): LauncherItem => ({ kind: 'shortcut', shortcut })),
    ...commands.map((command): LauncherItem => ({ kind: 'command', command })),
  ];
}

/** The `/` launcher: a listbox above the input, driven from the input's keys. */
function Launcher({
  items,
  selected,
  onPick,
}: {
  items: LauncherItem[];
  selected: number;
  onPick: (item: LauncherItem) => void;
}) {
  return (
    <ul
      id="nb-launcher"
      role="listbox"
      aria-label={t('launcher.label')}
      className="flex max-h-60 flex-col overflow-y-auto rounded-xl border border-nb-border bg-nb-bg p-1 text-xs shadow-pop">
      {items.length === 0 ? <li className="px-3 py-1.5 text-nb-muted">{t('launcher.none')}</li> : null}
      {items.map((item, i) => (
        // The input keeps focus and handles the keys (aria-activedescendant); a click picks too.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events
        <li
          key={item.kind === 'shortcut' ? item.shortcut.id : item.command}
          id={`nb-launcher-${i}`}
          role="option"
          aria-selected={i === selected}
          className={`flex cursor-pointer items-baseline gap-2 rounded-lg px-3 py-1.5 ${i === selected ? 'bg-nb-surface' : ''}`}
          onMouseDown={e => e.preventDefault()}
          onClick={() => onPick(item)}>
          {item.kind === 'shortcut' ? (
            <>
              <span className="font-mono font-medium text-nb-link">/{item.shortcut.name}</span>
              {item.shortcut.pinned ? <StarIcon filled size={12} className="self-center text-amber-500" /> : null}
              <span className="truncate text-nb-muted">{item.shortcut.description || item.shortcut.text}</span>
            </>
          ) : (
            <>
              <span className="font-mono font-medium text-nb-link">/{item.command}</span>
              <span className="truncate text-nb-muted">
                {item.command === 'new' ? t('launcher.new') : t('launcher.compact')}
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** The input's tallest size: half the panel's height, at most 400 px. */
const MAX_INPUT_HEIGHT = () => Math.min(400, Math.round(window.innerHeight / 2));

export function sameModel(a: ModelRef | null | undefined, b: ModelRef | null | undefined): boolean {
  return !!a && !!b && a.providerId === b.providerId && a.model === b.model;
}

/**
 * The model the picker shows: the first of `wanted` (the conversation's or the chosen one, then the default model)
 * that is still configured, else the first configured model. Null only when no model is configured.
 */
export function pickModel(models: ModelChoice[], ...wanted: Array<ModelRef | null | undefined>): ModelRef | null {
  for (const ref of wanted) {
    const found = models.find(m => sameModel(m.ref, ref));
    if (found) return found.ref;
  }
  return models[0]?.ref ?? null;
}

export function Composer({
  active,
  mode,
  model,
  models,
  reasoning = 'none',
  onReasoning,
  history,
  draft,
  onDraftUsed,
  onSend,
  onStop,
  onMode,
  onModel,
  notice,
  onShareTab,
  sharedTabs = [],
  files = [],
  onAttach,
  onScreenshot,
  onRemoveFile,
  transcribe,
  onOpenSettings,
  quotes = [],
  onRemoveQuote,
  shortcuts = [],
  onLaunch,
  noModel = false,
}: {
  active: boolean;
  mode: PermissionMode;
  model: ModelRef | null;
  models: ModelChoice[];
  /** The conversation's reasoning effort, shown in the model picker. */
  reasoning?: ReasoningEffort;
  onReasoning?: (reasoning: ReasoningEffort) => void;
  /** The user's earlier prompts, oldest first, for ↑. */
  history: string[];
  /** Text to put back into the input (queued messages returned on Stop). */
  draft?: string;
  onDraftUsed?: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onMode: (mode: PermissionMode) => void;
  onModel: (model: ModelRef) => void;
  notice?: React.ReactNode;
  /** A tab picked with @. */
  onShareTab?: (tab: { tabId: number; title: string }) => void;
  sharedTabs?: number[];
  /** Files attached to the next message: from +, drop or paste. */
  files?: PendingFile[];
  onAttach?: (files: File[]) => void;
  /** "Screenshot of this tab" in the + menu. */
  onScreenshot?: () => void;
  onRemoveFile?: (id: string) => void;
  /**
   * Voice input: turns a recording into text with the voice model chosen in Settings, or null when none is chosen.
   * Without it, no microphone button.
   */
  transcribe?: ((audio: Uint8Array) => Promise<string>) | null;
  /** Opens Settings at Providers (where the voice model is chosen) or Permissions (the microphone). */
  onOpenSettings?: (section: 'providers' | 'permissions') => void;
  /** Selections to send with the next message, as quote chips. */
  quotes?: Array<{ text: string; url: string; title: string }>;
  onRemoveQuote?: (index: number) => void;
  /** The user's shortcuts, for the `/` launcher. */
  shortcuts?: SavedShortcut[];
  /** A shortcut or a command picked in the launcher. */
  onLaunch?: (item: LauncherItem) => void;
  /** No model is set up: nothing can be typed, attached or recorded until one is. */
  noModel?: boolean;
}) {
  const [text, setText] = useState('');
  const [selected, setSelected] = useState(0);
  const [launcherClosed, setLauncherClosed] = useState(false);
  const [recall, setRecall] = useState<number | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const [voice, setVoice] = useState<VoicePhase>('idle');
  const [voiceNotice, setVoiceNotice] = useState<{
    title: MessageKey;
    text: string;
    settings?: 'providers' | 'permissions';
  } | null>(null);
  const [seconds, setSeconds] = useState(0);
  // The phase is also kept in a ref, so a second press before the microphone opens is seen at once.
  const phase = useRef<VoicePhase>('idle');
  const setPhase = (next: VoicePhase) => {
    phase.current = next;
    setVoice(next);
  };
  const recorder = useRef<Recorder | null>(null);
  const alive = useRef(true);
  /** The microphone page while it is open, with what to do when it closes. */
  const permissionPage = useRef<{ onClosed?: (tabId: number) => void } | null>(null);
  const needsModel = () =>
    setVoiceNotice({
      title: 'composer.voiceNeedsModelTitle',
      text: t('composer.voiceNeedsModel'),
      settings: 'providers',
    });

  useEffect(() => {
    if (voice !== 'recording') return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, [voice]);

  // A recording, and the wait for the microphone page, end with the panel.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      recorder.current?.cancel();
      recorder.current = null;
      const onClosed = permissionPage.current?.onClosed;
      if (onClosed) chrome.tabs.onRemoved.removeListener(onClosed);
    };
  }, []);

  /**
   * Stops the recording and sends it to the voice model chosen now; if none is chosen any more, the recording is
   * dropped. What was said goes into the input, after what is there, for the user to check and send.
   */
  const finishRecording = async (): Promise<void> => {
    const current = recorder.current;
    if (!current || phase.current !== 'recording') return;
    recorder.current = null;
    setPhase('transcribing');
    try {
      const audio = await toWav(await current.stop());
      const send = latest.current.transcribe;
      if (!send) return needsModel();
      const said = await send(audio);
      if (said) setText(before => (before.trim() ? `${before.replace(/\s+$/, '')} ${said}` : said));
      else setVoiceNotice({ title: 'composer.voiceNothingTitle', text: t('composer.voiceNothing') });
    } catch (error) {
      setVoiceNotice({
        title: 'composer.voiceErrorTitle',
        text: t('composer.voiceError', { error: (error as Error).message || String(error) }),
      });
    } finally {
      setPhase('idle');
      input.current?.focus();
    }
  };

  /**
   * Starts a recording when nothing else is going on. The first time, the microphone page asks for access, and a
   * recording starts when it closes with access given.
   */
  const startRecording = async (retried: boolean): Promise<void> => {
    if (phase.current !== 'idle') return;
    if (!latest.current.transcribe) return needsModel();
    setVoiceNotice(null);
    setPhase('starting');
    const result = await Recorder.start(() => void latest.current.finish());
    if (!alive.current) {
      if (result instanceof Recorder) result.cancel();
      return;
    }
    if (result instanceof Recorder) {
      recorder.current = result;
      setPhase('recording');
      return;
    }
    setPhase('idle');
    if (result === 'not-allowed' && !retried) return openPermissionPage();
    if (result === 'no-microphone')
      setVoiceNotice({ title: 'composer.voiceNoMicTitle', text: t('composer.voiceNoMic') });
    else if (result === 'not-allowed')
      setVoiceNotice({
        title: 'composer.voiceBlockedTitle',
        text: t('composer.voiceBlocked'),
        settings: 'permissions',
      });
    else setVoiceNotice({ title: 'composer.voiceCannotRecordTitle', text: t('composer.voiceCannotRecord') });
  };

  const openPermissionPage = async (): Promise<void> => {
    if (permissionPage.current) return;
    const waiting: { onClosed?: (tabId: number) => void } = {};
    permissionPage.current = waiting;
    try {
      const page = await chrome.tabs.create({ url: chrome.runtime.getURL('/permission.html') });
      if (!alive.current) return;
      waiting.onClosed = tabId => {
        if (tabId !== page.id) return;
        chrome.tabs.onRemoved.removeListener(waiting.onClosed!);
        permissionPage.current = null;
        void navigator.permissions
          .query({ name: 'microphone' as PermissionName })
          .then(p => {
            if (p.state === 'granted' && alive.current) void latest.current.start(true);
          })
          .catch(() => undefined);
      };
      chrome.tabs.onRemoved.addListener(waiting.onClosed);
    } catch {
      permissionPage.current = null;
    }
  };

  /** Voice input: press to record, press again to stop. */
  const pressMic = () => void (phase.current === 'recording' ? finishRecording() : startRecording(false));

  // Callbacks that outlive this render (a recording that ends by itself, the microphone page closing) use what is
  // current then.
  const latest = useRef({ transcribe, finish: finishRecording, start: startRecording });
  latest.current = { transcribe, finish: finishRecording, start: startRecording };
  // Files go with a new message; a queued message carries text only.
  const canAttach = !!onAttach && !active && !noModel;

  useEffect(() => {
    if (draft) {
      setText(current => (current ? `${draft}\n${current}` : draft));
      onDraftUsed?.();
    }
  }, [draft, onDraftUsed]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    // Empty, the input keeps its minimum height (four lines), so it is the same size when the panel opens and after a
    // message is sent; the placeholder is not measured. It grows with the text up to half the panel's height, at most
    // 400 px.
    el.style.height = '';
    if (text) el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT())}px`;
  }, [text]);

  const send = () => {
    const value = text.trim();
    if ((!value && !((files.length || quotes.length) && !active)) || !model) return;
    onSend(value);
    setText('');
    setRecall(null);
  };

  const at = onShareTab ? /(?:^|\s)@([^\s@]*)$/.exec(text) : null;
  const slash = onLaunch && !launcherClosed ? /^\/([a-z0-9-]*)$/i.exec(text) : null;
  const items = slash ? launcherItems(slash[1], shortcuts) : [];
  const pick = (item: LauncherItem) => {
    setText('');
    setSelected(0);
    onLaunch?.(item);
  };
  return (
    <div
      className="flex flex-col gap-2 px-3 pb-3 pt-1"
      onDragOver={e => {
        if (canAttach && e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={e => {
        if (!canAttach || !e.dataTransfer.files.length) return;
        e.preventDefault();
        onAttach?.([...e.dataTransfer.files]);
      }}>
      {notice}
      {voiceNotice ? (
        <NoticeCard
          alert
          title={t(voiceNotice.title)}
          onClose={() => setVoiceNotice(null)}
          action={
            voiceNotice.settings && onOpenSettings
              ? {
                  label: t('composer.voiceOpenSettings'),
                  run: () => {
                    setVoiceNotice(null);
                    onOpenSettings(voiceNotice.settings!);
                  },
                }
              : undefined
          }>
          {voiceNotice.text}
        </NoticeCard>
      ) : null}
      {quotes.length ? (
        <ul className="flex flex-col gap-1" aria-label={t('composer.quotes')}>
          {quotes.map((q, i) => (
            <li
              key={`${q.url}|${i}`}
              className="flex items-start gap-1 rounded-lg border-l-2 border-nb-sky bg-nb-bg px-2 py-1 text-xs shadow-sm">
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 italic">“{q.text}”</span>
                <span className="block truncate text-nb-muted">{q.title || q.url}</span>
              </span>
              <button
                type="button"
                aria-label={t('composer.removeQuote')}
                className="rounded p-0.5 text-nb-muted hover:bg-nb-surface hover:text-nb-fg"
                onClick={() => onRemoveQuote?.(i)}>
                <CloseIcon size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <AttachmentChips files={files} onRemove={onRemoveFile} />
      {at ? (
        <TabPicker
          query={at[1]}
          exclude={sharedTabs}
          onPick={tab => {
            setText(current => current.replace(/@[^\s@]*$/, '').trimEnd());
            onShareTab?.(tab);
          }}
        />
      ) : null}
      {slash ? <Launcher items={items} selected={Math.min(selected, items.length - 1)} onPick={pick} /> : null}
      <div className="relative flex flex-col rounded-2xl border border-nb-border bg-nb-bg shadow-soft transition-colors focus-within:border-nb-accent/60 focus-within:ring-2 focus-within:ring-nb-accent/20">
        <textarea
          ref={input}
          id="nb-composer-input"
          rows={1}
          value={text}
          role={slash ? 'combobox' : undefined}
          aria-expanded={slash ? true : undefined}
          aria-controls={slash ? 'nb-launcher' : undefined}
          aria-activedescendant={
            slash && items.length ? `nb-launcher-${Math.min(selected, items.length - 1)}` : undefined
          }
          aria-label={t('composer.placeholder')}
          placeholder={t('composer.placeholder')}
          disabled={noModel}
          className="max-h-[min(50vh,400px)] min-h-24 w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[15px] placeholder:text-nb-muted focus:outline-none disabled:cursor-not-allowed"
          onChange={e => {
            setText(e.target.value);
            setRecall(null);
            setSelected(0);
            if (!e.target.value.startsWith('/')) setLauncherClosed(false);
          }}
          onPaste={e => {
            // A pasted image or file becomes an attachment; pasted text stays text.
            if (!canAttach || !e.clipboardData.files.length) return;
            e.preventDefault();
            onAttach?.([...e.clipboardData.files]);
          }}
          onKeyDown={e => {
            const composing = e.nativeEvent.isComposing || e.keyCode === 229;
            if (slash && items.length && !composing) {
              const current = Math.min(selected, items.length - 1);
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setSelected((current + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
                return;
              }
              if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                e.preventDefault();
                pick(items[current]);
                return;
              }
            }
            if (slash && e.key === 'Escape') {
              // Esc closes the launcher; it does not stop a run.
              e.preventDefault();
              e.stopPropagation();
              setLauncherClosed(true);
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey && !composing) {
              e.preventDefault();
              // While the agent works, Enter queues the message.
              send();
              return;
            }
            if (e.key === 'ArrowUp' && history.length && (text === '' || recall !== null)) {
              e.preventDefault();
              const next = recall === null ? history.length - 1 : Math.max(0, recall - 1);
              setRecall(next);
              setText(history[next]);
            }
          }}
        />
        <div className="flex items-center gap-1.5 px-2 pb-2 max-[279px]:gap-1">
          {onAttach ? (
            <>
              <div className="relative shrink-0">
                <button
                  type="button"
                  aria-label={t('composer.add')}
                  aria-haspopup="menu"
                  aria-expanded={menu}
                  disabled={!canAttach}
                  className="flex size-7 items-center justify-center rounded-lg text-nb-muted transition-colors hover:bg-nb-surface hover:text-nb-fg disabled:opacity-40 disabled:hover:bg-transparent"
                  onClick={() => setMenu(open => !open)}>
                  <PlusIcon size={18} />
                </button>
                {menu ? (
                  <div
                    role="menu"
                    tabIndex={-1}
                    onKeyDown={e => {
                      if (e.key !== 'Escape') return;
                      e.stopPropagation();
                      setMenu(false);
                    }}
                    className="absolute bottom-9 left-0 z-10 flex w-52 flex-col rounded-xl border border-nb-border bg-nb-bg p-1 text-xs shadow-pop">
                    <button
                      type="button"
                      role="menuitem"
                      className="rounded-lg px-3 py-1.5 text-left hover:bg-nb-surface focus-visible:bg-nb-surface focus-visible:outline-none"
                      onClick={() => {
                        setMenu(false);
                        picker.current?.click();
                      }}>
                      {t('composer.attach')}
                    </button>
                    {onScreenshot ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="rounded-lg px-3 py-1.5 text-left hover:bg-nb-surface focus-visible:bg-nb-surface focus-visible:outline-none"
                        onClick={() => {
                          setMenu(false);
                          onScreenshot();
                        }}>
                        {t('composer.screenshot')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                aria-hidden
                onChange={e => {
                  if (e.target.files?.length) onAttach([...e.target.files]);
                  e.target.value = '';
                }}
              />
            </>
          ) : null}
          <ModeMenu
            mode={mode}
            onMode={onMode}
            title={t('composer.modeShortcut', { keys: /Mac/i.test(navigator.userAgent) ? '⌘⇧P' : 'Ctrl+Shift+P' })}
          />
          <ModelMenu
            models={models}
            model={model}
            reasoning={reasoning}
            running={active}
            onModel={onModel}
            onReasoning={next => onReasoning?.(next)}
          />
          <span className="flex-1" />
          {transcribe !== undefined ? (
            <>
              {voice === 'recording' ? (
                <span className="shrink-0 text-xs tabular-nums text-red-600 dark:text-red-300" aria-hidden="true">
                  {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
                </span>
              ) : null}
              <button
                type="button"
                aria-label={t(
                  voice === 'recording'
                    ? 'composer.voiceStop'
                    : voice === 'transcribing'
                      ? 'composer.voiceTranscribing'
                      : 'composer.voice',
                )}
                aria-pressed={voice === 'recording'}
                aria-busy={voice === 'transcribing'}
                title={t(
                  voice === 'recording'
                    ? 'composer.voiceStop'
                    : voice === 'transcribing'
                      ? 'composer.voiceTranscribing'
                      : 'composer.voice',
                )}
                disabled={noModel}
                className={`flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40 disabled:hover:bg-transparent ${voice === 'recording' ? 'animate-pulse bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300' : 'text-nb-muted hover:bg-nb-surface hover:text-nb-fg'}`}
                onClick={pressMic}>
                {voice === 'transcribing' ? (
                  <SpinnerIcon size={15} className="text-nb-link motion-safe:animate-spin" />
                ) : (
                  <MicIcon size={17} />
                )}
              </button>
            </>
          ) : null}
          {active ? (
            <button
              type="button"
              className="flex shrink-0 items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-red-700"
              onClick={onStop}>
              <StopIcon size={13} />
              <span className="max-[279px]:sr-only">{t('composer.stop')}</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={(!text.trim() && !files.length && !quotes.length) || !model}
              aria-label={t('composer.send')}
              title={t('composer.send')}
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-nb-accent text-white shadow-sm transition-colors hover:bg-nb-accent-strong disabled:opacity-40 disabled:shadow-none disabled:hover:bg-nb-accent"
              onClick={send}>
              <SendIcon size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
