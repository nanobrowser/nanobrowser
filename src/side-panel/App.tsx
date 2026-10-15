// The side panel. A view: it draws the worker's events and sends commands; it holds no state a run depends on, and it
// never reads the conversation stores.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { capabilityOf, DEFAULT_SETTINGS, keysStorage, providersStorage, settingsStorage } from '@src/store/settings';
import type { ProviderConfig } from '@src/store/settings';
import type { LivePair, ModelRef, PermissionMode } from '@src/store/types';
import { makePair } from '@src/llm/profiles';
import type { ReasoningEffort } from '@src/llm/catalogue';
import { useStorage } from '@src/ui/hooks';
import { setLanguage, t, useLanguage } from '@src/ui/i18n';
import { applyTheme } from '@src/ui/theme';
import { PanelClient, panelTabId } from './client';
import { Composer, pickModel, sameModel } from './Composer';
import type { LauncherItem, ModelChoice, PendingFile } from './Composer';
import { attachmentKind, MAX_FILE } from '@src/store/attachments';
import { voiceLanguage, voiceSetup } from '@src/ui/voice';
import { transcribeAudio } from '@src/llm/transcribe';
import { newId, putBlob } from '@src/store/conversations';
import { INITIAL, isActive, reduce } from './state';
import { Transcript } from './Transcript';
import { HistoryDrawer } from './History';
import { Cards, containsCardNumber } from './Cards';
import { NoticeCard } from './NoticeCard';
import { WhatsNewCard, useWhatsNew } from './WhatsNewCard';
import { RatingCard, ratingMovedOn, useRatingCard } from './RatingCard';
import { TabBar } from './TabBar';
import { QueueList, RunBar } from './RunControls';
import type { MessageKey } from '@src/ui/i18n';
import type { PanelCommand } from '@src/ui/protocol';
import en from '@src/ui/locales/en.json';
import { installTestHook } from './test-hook';
import type { SavedShortcut } from '@src/store/shortcuts';
import { useShortcuts } from '@src/ui/shortcuts';
import { AutoNotice } from '@src/ui/auto-notice';
import { HistoryIcon, LogoMark, NewChatIcon, SettingsIcon } from '@src/ui/icons';
import { websiteUrl } from '@src/ui/links';

const NO_PROVIDERS: ProviderConfig[] = [];
const NO_KEYS: Record<string, string> = {};

/** The starters a new conversation offers when no shortcut is pinned: a short label and the text it sends. */
const STARTERS = [
  { label: 'panel.starter.star', text: 'panel.starter.starText' },
  { label: 'panel.starter.summarize', text: 'panel.starter.summarizeText' },
  { label: 'panel.starter.news', text: 'panel.starter.newsText' },
] as const;

/**
 * Brings a conversation's own tab to the front with its panel open. `sidePanel.open` needs the user's gesture, so it is
 * called before any await; the conversation's panel is already enabled on its tabs.
 */
function showTab(tabId: number): void {
  chrome.sidePanel.open({ tabId }).catch(() => undefined);
  void chrome.tabs
    .update(tabId, { active: true })
    .then(tab => (tab ? chrome.windows.update(tab.windowId, { focused: true }) : undefined))
    .catch(() => undefined);
}

/** Saves text as a file from the panel, through an anchor's download. */
function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  useLanguage();
  const settings = useStorage(settingsStorage, DEFAULT_SETTINGS);
  const providers = useStorage(providersStorage, NO_PROVIDERS);
  // The no-model card waits for the providers to be read, so it does not flash while the panel opens.
  const providersRead = useSyncExternalStore(providersStorage.subscribe, () => providersStorage.getSnapshot() !== null);
  const apiKeys = useStorage(keysStorage, NO_KEYS);
  const whatsNew = useWhatsNew();
  // Voice input: the panel sends the recording to the chosen voice model's provider, with its key.
  const voice = voiceSetup(settings, providers, apiKeys);
  const transcribe = voice
    ? (audio: Uint8Array) => {
        client?.send({ type: 'voice-used' });
        return transcribeAudio(voice, audio, { language: voiceLanguage(settings.dictationLanguage) });
      }
    : null;
  const [client, setClient] = useState<PanelClient | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [state, dispatch] = useReducer(reduce, INITIAL);
  // Mode, model and effort chosen before the first message of a new conversation.
  const [draftMode, setDraftMode] = useState<PermissionMode | null>(null);
  const [draftPair, setDraftPair] = useState<LivePair | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const shortcuts = useShortcuts();
  const [autoNotice, setAutoNotice] = useState(false);
  /** A message held back because it looks like a card number. */
  const [held, setHeld] = useState<string | null>(null);
  /** Tabs picked with @ before the conversation exists; shared with the first message. */
  const [pendingTabs, setPendingTabs] = useState<Array<{ tabId: number; title: string }>>([]);
  const [confirmNewChat, setConfirmNewChat] = useState(false);
  /** Text to put back into the composer: queued messages returned on Stop, or one taken back to edit. */
  const [draft, setDraft] = useState('');
  /** Files attached to the next message, already in the blob store. */
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  // Selections arrive from the context menu as quote chips for the next message.
  const [quotes, setQuotes] = useState<Array<{ text: string; url: string; title: string }>>([]);
  const quotesTaken = useRef(0);
  useEffect(() => {
    const fresh = state.selections.slice(quotesTaken.current);
    quotesTaken.current = state.selections.length;
    if (fresh.length) setQuotes(current => [...current, ...fresh]);
  }, [state.selections]);
  // A screenshot of the tab arrives from the worker as a file for the next message.
  const taken = useRef(0);
  useEffect(() => {
    const fresh = state.attached.slice(taken.current);
    taken.current = state.attached.length;
    if (fresh.length) setFiles(current => [...current, ...fresh]);
  }, [state.attached]);
  const clearFiles = () => {
    for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview);
    setFiles([]);
    setAttachError(null);
  };
  /**
   * The panel writes an attached file to the blob store itself, since a port carries JSON, and sends its id; the
   * worker checks it again and moves it to the conversation when the message is sent.
   */
  const attach = async (list: File[]) => {
    setAttachError(null);
    for (const file of list) {
      const kind = attachmentKind(file.name, file.type);
      if ('refused' in kind) {
        setAttachError(t(`attach.refused.${kind.reason}`, { name: file.name }));
        continue;
      }
      if (file.size > MAX_FILE) {
        setAttachError(t('composer.attachTooLarge', { name: file.name }));
        continue;
      }
      const ref = { id: newId(), name: file.name || 'pasted-image.png', mimeType: file.type, size: file.size };
      try {
        await putBlob({ ...ref, conversationId: '', data: file, createdAt: new Date().toISOString() });
      } catch {
        setAttachError(t('composer.attachFailed', { name: file.name }));
        continue;
      }
      setFiles(current => [
        ...current,
        { ref, ...(kind.kind === 'image' ? { preview: URL.createObjectURL(file) } : {}) },
      ]);
    }
  };
  useEffect(() => {
    if (state.returned.length) setDraft(state.returned.map(q => q.text).join('\n'));
  }, [state.returned]);
  const queryHistory = useCallback((query: string) => client?.send({ type: 'history', query }), [client]);

  useEffect(() => void setLanguage(settings.uiLanguage), [settings.uiLanguage]);
  useEffect(() => applyTheme(settings.theme), [settings.theme]);

  useEffect(() => {
    let created: PanelClient | null = null;
    panelTabId()
      .then(tabId => {
        installTestHook(tabId);
        created = new PanelClient(tabId);
        created.onEvent(event => {
          // An export arrives as Markdown for this panel, and is saved as a file.
          if (event.type === 'export') downloadText(event.filename, event.markdown);
          dispatch(event);
        });
        created.subscribe();
        setClient(created);
      })
      .catch(error => setFailure(String(error)));
    return () => created?.close();
  }, []);

  const models: ModelChoice[] = useMemo(
    () =>
      providers.flatMap(p =>
        p.models
          .filter(m => !m.noToolCalling)
          .map(m => {
            const ref = { providerId: p.id, model: m.name };
            return { ref, label: `${m.name} · ${p.name}`, name: m.name, capability: capabilityOf(providers, ref) };
          }),
      ),
    [providers],
  );

  const conversation = state.conversation;
  const mode: PermissionMode = conversation?.mode ?? draftMode ?? settings.defaultMode;
  // The conversation's live pair, the draft of a new chat, or one made from the settings. A model that is no longer
  // configured falls back to the default model, then to the first one there is.
  const fallback = pickModel(models, settings.defaultModel);
  const made = fallback ? makePair(fallback, settings.reasoning, capabilityOf(providers, fallback)) : null;
  const pair = state.live ?? (!state.conversationId ? draftPair : null) ?? made;
  // A new chat makes its pair once, when the settings and providers are read, and holds it as its draft until the first
  // message, even if another tab changes the defaults meanwhile.
  const settingsRead = useSyncExternalStore(settingsStorage.subscribe, () => settingsStorage.getSnapshot() !== null);
  useEffect(() => {
    if (state.conversationId) setDraftPair(null);
    else if (!draftPair && made && settingsRead && providersRead) setDraftPair(made);
  }, [state.conversationId, draftPair, made, settingsRead, providersRead]);
  const model = pickModel(models, pair?.model, settings.defaultModel);
  const reasoning: ReasoningEffort = pair?.reasoning ?? 'none';
  /** A model or effort chosen in the picker: the conversation's, or the draft's; the latest is the default too. */
  const choose = (next: LivePair) => {
    if (state.conversationId) {
      client?.send({ type: 'set-model', conversationId: state.conversationId, ...next });
      return;
    }
    setDraftPair(next);
    void settingsStorage.set(s => ({ ...s, defaultModel: next.model, reasoning: next.reasoning }));
  };
  const active = isActive(state.status);
  const ratingCard = useRatingCard(state.conversationId, state.startedAt, active, !!whatsNew);
  /** Sends a command the user gave that starts a run; with the rating card showing, it is their Maybe later. */
  const startRun = (command: PanelCommand) => {
    if (ratingCard) ratingMovedOn();
    client?.send(command);
  };
  const history = state.entries.filter(e => e.kind === 'user').map(e => (e as { text: string }).text);

  /**
   * The mode for this conversation, or the next one; the latest choice is the default for new conversations too. The
   * first switch to Auto explains it once.
   */
  const changeMode = (next: PermissionMode) => {
    if (next === 'auto' && !settings.autoNoticeShown) setAutoNotice(true);
    if (state.conversationId) {
      client?.send({ type: 'set-mode', conversationId: state.conversationId, mode: next });
      return;
    }
    setDraftMode(next);
    void settingsStorage.set(s => ({ ...s, defaultMode: next }));
  };
  const keys = useRef({ changeMode, mode });
  keys.current = { changeMode, mode };

  // The panel's keys. Esc stops the run; a focused write card, the launcher, a menu or a dialog takes it first.
  // Ctrl/Cmd+/ focuses the input, and Ctrl/Cmd+Shift+P switches the mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key === '/') {
        e.preventDefault();
        document.querySelector<HTMLTextAreaElement>('#nb-composer-input')?.focus();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        keys.current.changeMode(keys.current.mode === 'ask' ? 'auto' : 'ask');
        return;
      }
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]') || document.activeElement?.closest('[role="menu"]')) return;
      if (isActive(state.status) && state.conversationId && client) {
        client.send({ type: 'stop', conversationId: state.conversationId });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.status, state.conversationId, client]);

  const newChat = (confirmed = false) => {
    if (isActive(state.status) && !confirmed) {
      setConfirmNewChat(true);
      return;
    }
    setConfirmNewChat(false);
    setDraftMode(null);
    setDraftPair(null);
    setPendingTabs([]);
    if (client) client.send({ type: 'new-chat', tabId: client.tabId });
  };

  /**
   * Sends what the composer holds with `text`. A shortcut adds its start page, mode and model; while the agent works,
   * the text joins the queue and the start page is not opened.
   */
  const sendMessage = (
    text: string,
    extra: { mode?: PermissionMode; model?: ModelRef; startUrl?: string; shortcut?: true } = {},
  ): void => {
    if (!client) return;
    // `/compact` compacts the conversation now, or at the next turn boundary of a run.
    if (text.trim() === '/compact') {
      if (state.conversationId) client.send({ type: 'compact', conversationId: state.conversationId });
      return;
    }
    if (text.trim() === '/new') return newChat();
    if (active && state.conversationId) {
      client.send({
        type: 'queue',
        conversationId: state.conversationId,
        id: crypto.randomUUID(),
        text,
        attachments: [],
        context: [],
      });
      return;
    }
    if (held !== text && containsCardNumber(text)) {
      setHeld(text);
      return;
    }
    setHeld(null);
    const chosenModel = extra.model && models.some(m => sameModel(m.ref, extra.model)) ? extra.model : model;
    startRun({
      type: 'send',
      tabId: client.tabId,
      conversationId: state.conversationId,
      text,
      attachments: files.map(f => f.ref),
      context: [
        ...pendingTabs.map(p => ({ kind: 'tab' as const, tabId: p.tabId })),
        ...quotes.map(q => ({ kind: 'selection' as const, ...q })),
      ],
      mode: extra.mode ?? mode,
      model: chosenModel,
      reasoning,
      ...(extra.startUrl ? { startUrl: extra.startUrl } : {}),
      ...(extra.shortcut ? { shortcut: true as const } : {}),
    });
    setPendingTabs([]);
    setQuotes([]);
    clearFiles();
  };

  const runShortcut = (s: SavedShortcut) => {
    if (!model) return;
    if (!active && s.mode === 'auto' && mode !== 'auto' && !settings.autoNoticeShown) setAutoNotice(true);
    sendMessage(s.text, active ? {} : { mode: s.mode, model: s.model, startUrl: s.startUrl, shortcut: true });
  };

  const onLaunch = (item: LauncherItem) => {
    if (item.kind === 'shortcut') runShortcut(item.shortcut);
    else sendMessage(`/${item.command}`);
  };

  if (failure) return <p className="p-4 text-sm text-red-700 dark:text-red-300">{failure}</p>;
  // The quick start above the composer: at most three pinned shortcuts, or the fixed starters.
  const pinned = shortcuts.filter(s => s.pinned).slice(0, 3);
  const starters = pinned.length
    ? pinned.map(s => ({ key: s.id, label: s.description || `/${s.name}`, title: s.text, run: () => runShortcut(s) }))
    : STARTERS.map(s => ({ key: s.label, label: t(s.label), title: t(s.text), run: () => sendMessage(t(s.text)) }));
  const empty = !state.entries.length && !state.streaming;

  return (
    <div className={`flex h-full flex-col${empty && state.loaded ? ' nb-start' : ''}`}>
      {/* The header has no field of its own, so it is part of the panel; a line under it only above a conversation. */}
      <header
        className={`flex items-center gap-1 border-b px-2 py-1.5 ${empty && state.loaded ? 'border-transparent' : 'border-nb-border/60'}`}>
        {/* The mark opens the website in a new tab. */}
        <a
          href={websiteUrl('/', 'side-panel')}
          target="_blank"
          rel="noreferrer"
          title={t('panel.website')}
          aria-label={t('panel.website')}
          className="ml-1 flex shrink-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent">
          <LogoMark size={20} />
        </a>
        {/* The title is for screen readers only; the header shows the mark and three buttons. */}
        <h1 className="sr-only">{conversation?.title || t('panel.newChat')}</h1>
        <span className="flex-1" />
        <IconButton label={t('panel.newChat')} onClick={() => newChat(confirmNewChat)}>
          <NewChatIcon />
        </IconButton>
        {/* Recent tasks opens once the conversation in this tab stops; other tabs' panels are free. */}
        <IconButton
          label={t('history.title')}
          title={active ? t('history.busy') : undefined}
          disabled={active}
          onClick={() => setHistoryOpen(true)}>
          <HistoryIcon />
        </IconButton>
        <IconButton label={t('panel.settings')} onClick={() => void chrome.runtime.openOptionsPage()}>
          <SettingsIcon />
        </IconButton>
      </header>
      {confirmNewChat ? (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <span className="flex-1">{t('panel.newChatRunning')}</span>
          <button type="button" className="underline" onClick={() => newChat(true)}>
            {t('panel.newChatConfirm')}
          </button>
          <button type="button" className="underline" onClick={() => setConfirmNewChat(false)}>
            {t('common.cancel')}
          </button>
        </div>
      ) : null}
      {!empty ? (
        <Transcript
          entries={state.entries}
          streaming={state.streaming}
          live={
            state.status === 'running' || state.status === 'awaiting_user'
              ? { startedAt: state.startedAt, waiting: state.status === 'awaiting_user' }
              : undefined
          }
          actions={
            state.conversationId && client
              ? {
                  idle: !active,
                  edit: (entryId, text) =>
                    startRun({ type: 'edit', conversationId: state.conversationId!, entryId, text }),
                  restart: entryId => startRun({ type: 'restart', conversationId: state.conversationId!, entryId }),
                  retry: () => startRun({ type: 'retry', conversationId: state.conversationId! }),
                }
              : undefined
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            {state.loaded ? <LogoMark size={40} /> : null}
            {state.loaded ? (
              <p className="max-w-xs text-[24px] font-normal leading-tight text-nb-fg">{t('panel.empty')}</p>
            ) : (
              <p className="text-sm text-nb-muted">{t('panel.loading')}</p>
            )}
          </div>
          {/* With no model, the no-model card above the composer takes the quick start's place. */}
          {/* The quick start stays hidden while the What's new card shows. */}
          {state.loaded && models.length && !whatsNew ? (
            <ul className="flex flex-col items-start gap-2 px-3 pb-2" aria-label={t('panel.starters')}>
              {starters.map(s => (
                <li key={s.key} className="max-w-full">
                  <button
                    type="button"
                    title={s.title}
                    disabled={!model}
                    className="max-w-full truncate rounded-full border border-nb-border/60 bg-nb-bg px-4 py-2 text-[15px] text-nb-fg shadow-sm transition-colors hover:bg-nb-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent disabled:opacity-40"
                    onClick={s.run}>
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      <HistoryDrawer
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        items={state.history}
        currentId={state.conversationId}
        onQuery={queryHistory}
        onOpen={id => {
          setHistoryOpen(false);
          if (!client) return;
          // A conversation with tabs in this session is shown in its own tab, not copied here (the worker sets that
          // tab's panel back to it); any other is only shown in this panel until the user takes it up.
          const tabs = state.history.find(item => item.id === id)?.tabs ?? [];
          if (tabs.length && !tabs.includes(client.tabId)) showTab(tabs[0]);
          client.send({ type: 'open', conversationId: id, tabId: client.tabId });
        }}
        onRename={(id, title) => client?.send({ type: 'rename', conversationId: id, title })}
        agentTabsOnEnd={settings.agentTabsOnEnd}
        onExport={id => client?.send({ type: 'export', conversationId: id })}
        onDelete={(id, closeAgentTabs, remember) => {
          if (remember) void settingsStorage.set(s => ({ ...s, agentTabsOnEnd: closeAgentTabs ? 'close' : 'keep' }));
          client?.send({ type: 'delete', conversationId: id, closeAgentTabs });
        }}
      />
      <div role="status" aria-live="polite" className="sr-only">
        {t(`status.${state.status}`)}
      </div>
      <Cards
        prompts={state.prompts}
        answer={(promptId, answer) => client?.send({ type: 'answer', promptId, answer })}
      />
      <RunBar
        status={state.status}
        onContinue={() => state.conversationId && startRun({ type: 'continue', conversationId: state.conversationId })}
        onResume={() => state.conversationId && startRun({ type: 'resume', conversationId: state.conversationId })}
      />
      <QueueList
        items={state.queue}
        onEdit={item => {
          if (!state.conversationId) return;
          client?.send({ type: 'unqueue', conversationId: state.conversationId, id: item.id });
          setDraft(item.text);
        }}
        onDelete={item =>
          state.conversationId && client?.send({ type: 'unqueue', conversationId: state.conversationId, id: item.id })
        }
      />
      <TabBar
        tabs={state.conversationId ? state.tabs : pendingTabs.map(p => ({ ...p, url: '', origin: 'user' as const }))}
        onUnshare={tabId => {
          if (state.conversationId) client?.send({ type: 'unshare-tab', conversationId: state.conversationId, tabId });
          else setPendingTabs(tabs => tabs.filter(p => p.tabId !== tabId));
        }}
      />
      <Composer
        active={active}
        mode={mode}
        model={model}
        models={models}
        noModel={providersRead && !models.length}
        history={history}
        notice={
          <>
            {/* The What's new card comes first; the notices below still show under it. The rating card waits for it (useRatingCard). */}
            {whatsNew ? <WhatsNewCard release={whatsNew} /> : null}
            {ratingCard ? <RatingCard /> : null}
            {attachError ? (
              <p className="text-xs text-amber-700 dark:text-amber-300" role="alert">
                {attachError}
              </p>
            ) : autoNotice ? (
              <AutoNotice onDone={() => setAutoNotice(false)} />
            ) : providersRead && !models.length ? (
              <NoticeCard
                title={t('composer.needModelTitle')}
                action={{
                  label: t('composer.setUpModel'),
                  run: () => void chrome.tabs.create({ url: chrome.runtime.getURL('/options.html#providers') }),
                }}>
                {t('composer.needModel')}
              </NoticeCard>
            ) : held ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {t('composer.cardWarning')}{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    const text = held;
                    setHeld(null);
                    if (client && text)
                      startRun({
                        type: 'send',
                        tabId: client.tabId,
                        conversationId: state.conversationId,
                        text,
                        attachments: [],
                        context: [],
                        mode,
                        model,
                        reasoning,
                      });
                  }}>
                  {t('composer.sendAnyway')}
                </button>
              </p>
            ) : state.error ? (
              <p className="text-xs text-red-700 dark:text-red-300">
                {state.error in en ? t(state.error as MessageKey) : state.error}
              </p>
            ) : null}
          </>
        }
        draft={draft}
        onDraftUsed={() => setDraft('')}
        onSend={sendMessage}
        shortcuts={shortcuts}
        onLaunch={onLaunch}
        files={files}
        quotes={quotes}
        onRemoveQuote={index => setQuotes(current => current.filter((_, i) => i !== index))}
        transcribe={transcribe}
        onOpenSettings={section => void chrome.tabs.create({ url: chrome.runtime.getURL(`/options.html#${section}`) })}
        onAttach={list => void attach(list)}
        onScreenshot={() =>
          client?.send({ type: 'screenshot-tab', tabId: client.tabId, conversationId: state.conversationId })
        }
        onRemoveFile={id => setFiles(current => current.filter(f => f.ref.id !== id))}
        sharedTabs={[client?.tabId ?? -1, ...state.tabs.map(x => x.tabId), ...pendingTabs.map(p => p.tabId)]}
        onShareTab={tab => {
          if (state.conversationId)
            client?.send({ type: 'share-tab', conversationId: state.conversationId, tabId: tab.tabId });
          else setPendingTabs(tabs => [...tabs, tab]);
        }}
        onStop={() => state.conversationId && client?.send({ type: 'stop', conversationId: state.conversationId })}
        onMode={changeMode}
        reasoning={reasoning}
        onModel={next => choose({ model: next, reasoning })}
        onReasoning={next => model && choose({ model, reasoning: next })}
      />
    </div>
  );
}

function IconButton({
  label,
  title,
  disabled,
  onClick,
  children,
}: {
  label: string;
  /** The tooltip, when it says more than the label. */
  title?: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={label}
      disabled={disabled}
      className="flex size-7 items-center justify-center rounded-lg text-nb-muted transition-colors hover:bg-nb-surface hover:text-nb-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-nb-muted"
      onClick={onClick}>
      {children}
    </button>
  );
}
