// The RunManager: one run per active conversation, the panel commands, run records and statuses. The worker owns the
// run; panels are views that can close and reopen.
import { AgentLoop, REASONING_DROPPED, STOPPED_BY_USER, STOPPED_NOTE } from '@src/agent/loop';
import type { LoopEnd } from '@src/agent/loop';
import type { HostPort } from '@src/agent/ports';
import type { Session, UserStepDetails } from '@src/browser-control';
import { agentSystemPrompt } from '@src/agent/prompt';
import { toolsForRun } from '@src/agent/tools';
import { toDisplay } from '@src/agent/display';
import {
  activeBranch,
  appendEntry,
  createConversation,
  deleteConversation,
  deleteEverything,
  getConversation,
  listConversations,
  getRun,
  listRuns,
  newId,
  putRun,
  setLeaf,
  getBlob,
  listBlobs,
  putBlob,
  titleFrom,
  updateConversation,
} from '@src/store/conversations';
import { DEFAULT_SETTINGS, getLive, removeLive, setLive, settingsStorage } from '@src/store/settings';
import { NOTE_LABEL, RunWriter } from '@src/agent/records';
import { planRestore, RESTART_NOTE, takenOver } from '@src/agent/restore';
import { runCompaction } from '@src/agent/compaction';
import { attachmentKind, MAX_CONVERSATION, MAX_FILE } from '@src/agent/attachments';
import { toModelMessages } from '@src/agent/context';
import type {
  Conversation,
  EntryOf,
  LivePair,
  MessagePart,
  QueuedMessage,
  RunRecord,
  RunStatus,
} from '@src/store/types';
import { EMPTY_GUARDS, UNFINISHED, ZERO_USAGE, addUsage } from '@src/store/types';
import type { AttachmentRef, PanelCommand, PanelEventBody } from '@src/ui/protocol';
import { createAgentSession, layerPort } from './agent-session';
import { TabScope } from './bindings';
import { PageBorder, injectBorder, listenForBorder } from './border';
import { addPromptRoute, controllerReady } from './layer';
import { Permissions } from './permissions';
import { PromptBroker } from './prompt-broker';
import { notifyFinished, notifyNeeds } from './notify';
import { thumbnail } from './thumbnail';
import { isNumberedCopy, saveText } from './downloads';
import { checkSave } from '@src/agent/save-file';
import { conversationMarkdown, exportName } from '@src/agent/export';
import { isBlockedSite, quote } from '@src/browser-control';
import { clearShortcuts, isStartUrl } from '@src/store/shortcuts';
import { OLD_KEYS, UPGRADE_KEY, deleteOldChats } from '@src/store/legacy';
import { upgradeFromOldVersion } from './upgrade';
import { WHATS_NEW_KEY } from '@src/store/whats-new';
import { RATING_ANSWER_KEY, RATING_KEY, afterFinishedRun, ratingStorage } from '@src/store/rating';
import type { ToolCallRequest } from '@src/llm';
import type { DebtEntry } from '@src/agent/completion';
import { Journal } from './journal';
import type { Sink } from './journal';
import { livePair, ModelUnavailable, resolveModel } from './models';
import { count, deleteKeepingChoices, noteActivity, observe, runEnded, runModel, runStarted } from './analytics';
import { endOf } from './analytics-payload';

export interface PanelConnection {
  tabId: number | null;
  conversationId: string | null;
  sink: Sink;
  unsubscribe?: () => void;
}

interface ActiveRun {
  runId: string;
  controller: AbortController;
  done: Promise<void>;
  /** Set once the loop exists: `/compact` asks it for compaction at the next turn boundary. */
  loop?: AgentLoop;
}

export class RunManager {
  readonly journal = new Journal();
  readonly permissions = new Permissions();
  readonly broker: PromptBroker;
  #runs = new Map<string, ActiveRun>();
  #sessions = new Map<string, Session>();
  /** The mode of a conversation with a run, read by the page header each turn (the user may change it). */
  #modes = new Map<string, Conversation['mode']>();
  #records = new Map<string, RunRecord>();
  readonly scope: TabScope;
  /** The glow on the pages a working run acts on. */
  readonly border: PageBorder;
  /** Messages typed while the agent works: one queue per conversation, in the worker. */
  #queues = new Map<string, QueuedMessage[]>();
  /** The open panels, for what goes to one tab's panel only (a selection). */
  readonly connections = new Set<PanelConnection>();
  /** Selections for a tab whose panel is not open yet, delivered when it subscribes. */
  #selections = new Map<number, Array<{ text: string; url: string; title: string }>>();
  /**
   * Queued messages of runs restored after a restart: they go back to the composer. The stored record keeps them too
   * until a panel has them, so a second restart before that does not lose them.
   */
  #returned = new Map<string, QueuedMessage[]>();

  constructor() {
    this.scope = new TabScope({
      blocked: () => this.permissions.blockedSites(),
      changed: (conversationId, added, removed) => void this.#scopeChanged(conversationId, added, removed),
    });
    this.border = new PageBorder({
      conversationOf: tabId => this.scope.conversationOf(tabId),
      tabsOf: conversationId => this.scope.tabsOf(conversationId),
      scopedTabs: () => this.scope.scopedTabs(),
      enabled: async () => ((await settingsStorage.get()) ?? DEFAULT_SETTINGS).pageBorder,
      inject: injectBorder,
    });
    listenForBorder(this.border);
    // A worker that stopped during a run leaves its pages with a border, and the extension id they check is still
    // there: no run works at worker start, so every scoped tab loses it.
    void this.border.start().catch(() => undefined);
    this.broker = new PromptBroker({
      emit: (conversationId, body) => this.emit(conversationId, body),
      waiting: (conversationId, open) => void this.#waiting(conversationId, open.length > 0),
      conversationOf: tabId => this.#conversationOfSessionTab(tabId),
      tabUrl: async tabId => (await chrome.tabs.get(tabId).catch(() => null))?.url ?? '',
      remember: site => this.permissions.allow(site),
    });
    // The layer's prompts for tabs a conversation's session holds come to the broker.
    addPromptRoute({ owns: tabId => this.#conversationOfSessionTab(tabId) !== null, prompt: this.broker.userPrompt() });
    // Cancel on Chrome's debugger bar is Stop.
    chrome.debugger.onDetach.addListener((source, reason) => {
      if (reason !== 'canceled_by_user' || source.tabId === undefined) return;
      const conversationId = this.#conversationOfSessionTab(source.tabId);
      if (conversationId) this.#stop(conversationId);
    });
    // A site the user blocks is refused in every open session at once.
    this.permissions.onBlockedChange(() => {
      for (const session of this.#sessions.values()) {
        void session.setUrlPolicy({ allow: [], deny: [], blocked: this.permissions.blockedSites() });
      }
    });
  }

  /** The scope changed: the panels get the new list, and a session in a run gains or loses the tab. */
  async #scopeChanged(conversationId: string, added: number[], removed: number[]): Promise<void> {
    void this.border.tabsChanged(added, removed).catch(() => undefined);
    const session = this.#sessions.get(conversationId);
    if (session) {
      for (const tabId of added) if (!session.hasTab(tabId)) await session.share(tabId).catch(() => undefined);
      for (const tabId of removed) if (session.hasTab(tabId)) await session.unshareTab(tabId).catch(() => undefined);
    }
    this.emit(conversationId, { type: 'tabs', tabs: await this.scope.scopeTabs(conversationId) });
    // A tab that joined, by @ or by a drag, brings its open panel along: the panel shows the tab's conversation,
    // whichever it showed before.
    for (const connection of this.connections) {
      if (connection.tabId !== null && added.includes(connection.tabId) && connection.conversationId !== conversationId)
        await this.#subscribe(connection, connection.tabId, conversationId);
    }
  }

  /** A panel of the conversation is open and the user is on one of its tabs. */
  async #inView(conversationId: string): Promise<boolean> {
    return this.journal.hasSubscribers(conversationId) && (await this.scope.watching(conversationId));
  }

  #queueWrites: Promise<void> = Promise.resolve();

  #emitQueue(conversationId: string, returned?: QueuedMessage[]): void {
    // The queue is kept in the run record too, so a worker restart hands it back to the composer.
    const items = [...(this.#queues.get(conversationId) ?? [])];
    this.#queueWrites = this.#queueWrites
      .then(async () => {
        const run = await getRun(conversationId);
        if (run && UNFINISHED.has(run.status)) await putRun({ ...run, steering: items });
      })
      .catch(() => undefined);
    this.emit(conversationId, {
      type: 'queue',
      items: [...(this.#queues.get(conversationId) ?? [])],
      ...(returned ? { returned } : {}),
    });
  }

  /**
   * Stop: the run aborts; queued messages go back to the composer rather than being sent. It is also how the user takes
   * the page back: there is no Take over, and a message afterwards carries the task on.
   */
  #stop(conversationId: string): void {
    this.#runs.get(conversationId)?.controller.abort();
    this.broker.withdrawAll(conversationId);
    const returned = this.#queues.get(conversationId)?.splice(0) ?? [];
    this.#emitQueue(conversationId, returned);
  }

  #conversationOfSessionTab(tabId: number): string | null {
    for (const [conversationId, session] of this.#sessions) if (session.hasTab(tabId)) return conversationId;
    return null;
  }

  /** A card opened or closed: the run waits for the user while one is open. */
  async #waiting(conversationId: string, open: boolean): Promise<void> {
    const record = this.#records.get(conversationId);
    if (!record || !this.#runs.has(conversationId)) return;
    // The card a run waits on is kept in its record, so a restart knows what to open again. The hand-over's own record,
    // with the call's partial result, is written by the loop.
    const newest = this.broker.promptsOf(conversationId).at(-1);
    const stored = await getRun(conversationId);
    if (stored && stored.runId === record.runId && stored.pendingPrompt?.kind !== 'handover') {
      const pendingPrompt =
        newest?.kind === 'write-card'
          ? { kind: 'write-card' as const, request: newest.data, openedAt: newest.openedAt }
          : newest?.kind === 'ask-takeover' || newest?.kind === 'ask-input'
            ? {
                kind: 'ask-user' as const,
                request: {
                  kind: newest.kind === 'ask-takeover' ? 'takeover' : 'input',
                  ...newest.data,
                  tabId: newest.tabId,
                },
                openedAt: newest.openedAt,
              }
            : undefined;
      await putRun({ ...stored, pendingPrompt });
    }
    const status: RunStatus = open ? 'awaiting_user' : 'running';
    if (record.status !== status && (record.status === 'running' || record.status === 'awaiting_user')) {
      await this.#setStatus(record, status);
      // Out of view, the user hears about it.
      const prompt = this.broker.promptsOf(conversationId).at(-1);
      if (open && prompt && !(await this.#inView(conversationId))) {
        await notifyNeeds(prompt, (await this.scope.tabsOf(conversationId))[0]);
      }
    }
  }

  /** The loop's hand-over, as a card. A page prompt must be answered before Done is taken. */
  #host(conversationId: string, session: Session): HostPort {
    return {
      handover: async (request, signal) => {
        const details: UserStepDetails = request.details;
        // While the user holds the tab, a file chooser they open is Chrome's own dialog.
        await session.controller.setFileChooserInterception(request.tabId, false);
        try {
          const answer = await this.broker.open<'given-back' | 'cancelled'>(
            conversationId,
            'handover',
            { ...details, tabId: request.tabId },
            signal,
            {
              tabId: request.tabId,
              check: async a => {
                if (a !== 'given-back' || details.reason !== 'prompt') return null;
                const pending = session.controller.tabState(request.tabId).pending;
                return pending.some(p => p.kind === 'dialog') ? 'dialog-waiting' : null;
              },
            },
          );
          return answer === 'given-back' ? 'given-back' : 'cancelled';
        } finally {
          await session.controller.setFileChooserInterception(request.tabId, true);
        }
      },
    };
  }

  /** The conversation's layer session for a run, holding the tabs bound to it. */
  async #openSession(conversationId: string): Promise<Session> {
    const controller = await controllerReady;
    await this.permissions.ready();
    const session = createAgentSession(controller, {
      decideWrite: question => this.permissions.decide(this.#modes.get(conversationId) ?? 'ask', question),
      urlPolicy: { allow: [], deny: [], blocked: this.permissions.blockedSites() },
      // The watching rule: a tab becomes visible only while the user is on the conversation's tabs.
      reveal: () => this.scope.watching(conversationId),
      onTabJoined: (tabId, how) => {
        if (how === 'shared') return;
        void (async () => {
          const watching = await this.scope.watching(conversationId);
          await this.scope.add(conversationId, tabId, 'agent');
          // Chrome brings a page-opened tab forward; out of view, the user's tab goes back on top.
          if (how === 'page-opened' && !watching) await this.scope.restoreView(tabId);
        })();
      },
    });
    this.#sessions.set(conversationId, session);
    for (const tabId of await this.scope.tabsOf(conversationId)) {
      // A tab on a blocked site stays out; the run says so through the layer's refusals.
      await session.share(tabId).catch(() => undefined);
    }
    return session;
  }

  async #closeSession(conversationId: string): Promise<void> {
    const session = this.#sessions.get(conversationId);
    this.#sessions.delete(conversationId);
    if (session) await (await controllerReady).closeSession(session);
  }

  isRunning(conversationId: string): boolean {
    return this.#runs.has(conversationId);
  }

  emit(conversationId: string, body: PanelEventBody): void {
    this.journal.emit(conversationId, body);
    observe(body);
  }

  /**
   * Worker start: every run that has not finished is restored by the restore table. The worker calls no model and runs
   * no tool on its own; a card that was open opens again with a new ID, and the run continues only when the user
   * answers it, or presses Resume.
   */
  async restore(): Promise<void> {
    for (const run of await listRuns()) {
      if (this.#runs.has(run.conversationId)) continue;
      if (!(UNFINISHED.has(run.status) || takenOver(run))) {
        // Restored before, and its queued messages have not reached a panel yet.
        if (run.steering.length) this.#returned.set(run.conversationId, run.steering);
        continue;
      }
      const conversationId = run.conversationId;
      const branch = await activeBranch(conversationId);
      const plan = planRestore(run, branch);
      const writer = new RunWriter(conversationId, run.runId);
      for (const r of plan.results) {
        const delivered = r.text.includes('delivery unknown') ? 'unknown' : false;
        await writer.toolResult(r.toolCallId, r.toolName, r.text, true, {
          ok: false,
          error: { code: 'INTERRUPTED', message: r.text, delivered, hint: '' },
        });
      }
      // One note per restart, not one per wake-up of the worker: an interrupted run can wait a long time.
      const last = [...branch].reverse().find(e => e.type === 'message');
      const noted =
        last?.type === 'message' &&
        !!last.appOwned &&
        last.message.parts.some(p => p.type === 'text' && p.text === `${NOTE_LABEL} ${RESTART_NOTE}]`);
      if (!noted && (plan.results.length > 0 || plan.reopen || run.status === 'running'))
        await writer.appNote(plan.note);
      if (run.steering.length) this.#returned.set(conversationId, run.steering);
      const record: RunRecord = {
        ...run,
        status: plan.status,
        reason: plan.reason,
        pendingPrompt: plan.reopen ? run.pendingPrompt : undefined,
      };
      await putRun(record);
      // A run the restart ended is counted once, as interrupted; one already interrupted was counted before.
      if (plan.status === 'interrupted' && run.status !== 'interrupted') runEnded(record, {});
      await updateConversation(conversationId, { status: plan.status });
      await this.scope.status(conversationId, plan.status, (await getConversation(conversationId))?.title ?? '');
      // A panel that subscribed before the restore got the stored status; it gets the restored one, and the queued
      // messages, now.
      this.emit(conversationId, {
        type: 'run_status',
        status: plan.status,
        reason: plan.reason,
        startedAt: run.startedAt,
      });
      this.#handBack(
        conversationId,
        [...this.connections].find(c => c.conversationId === conversationId),
      );
      if (plan.reopen) void this.#reopen(conversationId, record, plan.reopen);
    }
    await this.#watchdog();
  }

  /** One alarm, while any run is unfinished, wakes the worker so an interrupted run is found. */
  async #watchdog(): Promise<void> {
    if (!globalThis.chrome?.alarms) return;
    const unfinished = this.#runs.size > 0 || (await listRuns()).some(r => UNFINISHED.has(r.status));
    if (unfinished) await chrome.alarms.create('nb-watchdog', { periodInMinutes: 0.5 });
    else await chrome.alarms.clear('nb-watchdog');
  }

  /** A card that was open when the worker stopped opens again; its answer continues the run. */
  async #reopen(
    conversationId: string,
    record: RunRecord,
    prompt: NonNullable<RunRecord['pendingPrompt']> & { toolCallId?: string },
  ): Promise<void> {
    const writer = new RunWriter(conversationId, record.runId);
    const request = (prompt.request ?? {}) as Record<string, unknown>;
    const tabId = request.tabId as number | undefined;
    const toolCallId = prompt.toolCallId!;
    // The result answers the call that met the step, under that call's own tool name.
    const branch = await activeBranch(conversationId);
    let toolName = prompt.kind === 'ask-user' ? 'ask_user' : 'fill_form';
    for (const e of branch) {
      if (e.type !== 'message' || e.message.role !== 'assistant') continue;
      for (const p of e.message.parts) if (p.type === 'tool-call' && p.toolCallId === toolCallId) toolName = p.toolName;
    }
    if (prompt.kind === 'handover') {
      const details = (request.details ?? {}) as Record<string, unknown>;
      const answer = await this.broker.open<string>(
        conversationId,
        'handover',
        { ...details, tabId, restarted: true },
        new AbortController().signal,
        { tabId },
      );
      // The call that met the step is answered by the hand-over and never sent again: its partial result, the
      // outcome, and on Done a fresh observation.
      const partial = prompt.answers?.partialResult;
      const fields = (partial as { data?: { receipts?: unknown[] } } | undefined)?.data?.receipts?.length;
      const before = fields ? `fill_form: ${fields} fields were set before the step.` : '';
      const tab = tabId !== undefined ? await chrome.tabs.get(tabId).catch(() => null) : null;
      if (!tab) {
        await writer.toolResult(
          toolCallId,
          toolName,
          [
            before,
            'outcome unknown: the tab is gone, and the step may have been completed; do not repeat it; ask the user.',
          ]
            .filter(Boolean)
            .join('\n'),
          true,
          partial,
        );
        await this.#setStatus(
          { ...record, pendingPrompt: undefined },
          'interrupted',
          'The tab of the hand-over is gone.',
        );
        return;
      }
      let text: string;
      if (answer === 'given-back') {
        const controller = await controllerReady;
        const session = createAgentSession(controller, {
          urlPolicy: { allow: [], deny: [], blocked: this.permissions.blockedSites() },
        });
        session.shareTab(tab.id!);
        const seen = await session.call('snapshot', { tabId: tab.id });
        await controller.closeSession(session);
        text = [
          before,
          `hand-over: the user did the step (${String(details.reason)}) and gave the tab back.`,
          seen.text,
        ]
          .filter(Boolean)
          .join('\n');
      } else {
        text = [
          before,
          'hand-over: the user cancelled the step. Do not try to do it another way: ask the user, or finish.',
        ]
          .filter(Boolean)
          .join('\n');
      }
      await writer.toolResult(toolCallId, toolName, text, answer !== 'given-back', partial);
      await putRun({ ...record, pendingPrompt: undefined });
      if (answer === 'given-back' || answer === 'cancelled') this.#launch(conversationId, record);
      return;
    }
    if (prompt.kind === 'ask-user') {
      const kind = request.kind === 'takeover' ? 'ask-takeover' : 'ask-input';
      const answer = await this.broker.open<{ outcome: string; data?: string }>(
        conversationId,
        kind,
        { message: request.message, site: request.site },
        new AbortController().signal,
        { tabId },
      );
      const continued = answer !== 'withdrawn' && answer.outcome === 'continue';
      const text = continued
        ? ['ask_user · the user continued', ...(answer.data !== undefined ? [`answer: ${answer.data}`] : [])].join('\n')
        : 'error USER_DECLINED (nothing dispatched)\nThe user cancelled the step.';
      await writer.toolResult(toolCallId, toolName, text, !continued);
      await putRun({ ...record, pendingPrompt: undefined });
      if (answer !== 'withdrawn') this.#launch(conversationId, record);
    }
  }

  async handle(connection: PanelConnection, command: PanelCommand): Promise<void> {
    switch (command.type) {
      case 'subscribe':
        return this.#subscribe(connection, command.tabId, command.conversationId, command.sinceSeq);
      case 'send':
        return this.#send(connection, command);
      case 'stop':
        this.#stop(command.conversationId);
        return;
      case 'queue': {
        const queue = this.#queues.get(command.conversationId) ?? [];
        queue.push({ id: command.id, text: command.text, attachments: [], at: new Date().toISOString() });
        this.#queues.set(command.conversationId, queue);
        this.#emitQueue(command.conversationId);
        return;
      }
      case 'unqueue': {
        const queue = this.#queues.get(command.conversationId) ?? [];
        this.#queues.set(
          command.conversationId,
          queue.filter(q => q.id !== command.id),
        );
        this.#emitQueue(command.conversationId);
        return;
      }
      case 'continue':
        if (!(await this.#takeUp(connection, command.conversationId))) return;
        return this.#continue(command.conversationId, 'capped', 'the user pressed Continue; go on with the task.');
      case 'resume':
        if (!(await this.#takeUp(connection, command.conversationId))) return;
        return this.#continue(
          command.conversationId,
          'interrupted',
          'the user resumed the run; observe before acting.',
        );
      case 'answer':
        await this.broker.answer(command.promptId, command.answer);
        return;
      case 'compact':
        return this.#compact(command.conversationId);
      case 'export': {
        const conversation = await getConversation(command.conversationId);
        if (!conversation) return;
        this.journal.direct(command.conversationId, connection.sink, {
          type: 'export',
          conversationId: command.conversationId,
          filename: exportName(conversation),
          markdown: conversationMarkdown(conversation, await activeBranch(command.conversationId)),
        });
        return;
      }
      case 'screenshot-tab':
        return this.#screenshotTab(connection, command.tabId, command.conversationId);
      case 'edit':
      case 'restart':
        return this.#rebranch(connection, command.conversationId, command.type, command.entryId, command.text);
      case 'retry':
        return this.#rebranch(connection, command.conversationId, 'retry');
      case 'new-chat': {
        // The panel asks first when its own conversation works; a panel that shows another one, opened from Recent
        // tasks, cannot know, so the worker refuses while the tab's conversation works in it.
        const owner = await this.scope.conversationOf(command.tabId);
        if (owner && owner !== connection.conversationId && this.#runs.has(owner)) {
          this.journal.direct(connection.conversationId, connection.sink, {
            type: 'error',
            message: 'scope.ownerRunning',
          });
          return;
        }
        await this.scope.detach(command.tabId);
        return this.#subscribe(connection, command.tabId, null);
      }
      case 'set-mode':
        // A mode chosen in the composer is the default for new conversations too.
        if (!(await getConversation(command.conversationId))) return;
        await this.#setMode(command.conversationId, command.mode);
        await settingsStorage.set(s => ({ ...s, defaultMode: command.mode }));
        return;
      case 'set-model':
        await this.#setModel(command.conversationId, { model: command.model, reasoning: command.reasoning });
        return;
      case 'history':
        return this.#history(connection, command.query);
      case 'rename': {
        const title = command.title.replace(/\s+/g, ' ').trim();
        if (!title) return;
        const updated = await updateConversation(command.conversationId, { title, titleByUser: true });
        if (updated) this.emit(command.conversationId, { type: 'conversation', conversation: updated });
        return this.#history(connection);
      }
      case 'delete':
        await this.#delete(command.conversationId, !!command.closeAgentTabs);
        return this.#history(connection);
      case 'share-tab':
        await this.#shareTab(connection, command.conversationId, command.tabId, 'user');
        return;
      case 'unshare-tab':
        await this.scope.remove(command.conversationId, command.tabId);
        return;
      case 'open': {
        // A conversation with tabs of its own is shown there: the panel brings its first tab to the front, and a panel
        // on that tab that shows another conversation goes back to it. This panel stays as it is.
        const own = await this.scope.tabsOf(command.conversationId);
        if (own.length && !own.includes(command.tabId)) {
          for (const other of [...this.connections]) {
            if (other.tabId === own[0] && other.conversationId !== command.conversationId)
              await this.#subscribe(other, own[0], command.conversationId);
          }
          return;
        }
        // Otherwise Recent tasks shows the conversation in this panel and leaves the tab, its group and its panel as
        // they are. The panel keeps Recent tasks closed while the tab's own conversation works; this is the worker's
        // side of that rule.
        const owner = await this.scope.conversationOf(command.tabId);
        if (owner && owner !== command.conversationId && this.#runs.has(owner)) {
          this.journal.direct(connection.conversationId, connection.sink, {
            type: 'error',
            message: 'scope.ownerRunning',
          });
          return;
        }
        return this.#subscribe(connection, command.tabId, command.conversationId);
      }
      default:
        this.journal.direct(connection.conversationId, connection.sink, {
          type: 'error',
          message: `The command ${(command as { type: string }).type} is not available.`,
        });
    }
  }

  /**
   * A conversation opened from Recent tasks is only shown until the user takes it up in this panel: then the tab moves
   * to it from the conversation it belonged to, keeping its panel, and the run has this tab. The tab stays where it is
   * while that conversation works in it, or when it is on a blocked site. Returns whether the command may go on.
   */
  async #takeUp(connection: PanelConnection, conversationId: string): Promise<boolean> {
    const tabId = connection.tabId;
    if (tabId === null || connection.conversationId !== conversationId) return true;
    const owner = await this.scope.conversationOf(tabId);
    if (owner === conversationId) return true;
    if (owner && this.#runs.has(owner)) {
      this.journal.direct(conversationId, connection.sink, { type: 'error', message: 'scope.ownerRunning' });
      return false;
    }
    const result = await this.scope.add(conversationId, tabId, 'start', { move: true });
    if (!result.ok) {
      // A tab on a blocked site stays out, and the run does not start without it.
      this.journal.direct(conversationId, connection.sink, {
        type: 'error',
        message: result.reason === 'blocked' ? 'scope.blocked' : 'scope.gone',
      });
      return false;
    }
    return true;
  }

  async #subscribe(
    connection: PanelConnection,
    tabId: number,
    requested?: string | null,
    sinceSeq?: number,
  ): Promise<void> {
    connection.tabId = tabId;
    const conversationId =
      requested !== undefined && requested !== null ? requested : await this.scope.conversationOf(tabId);
    connection.unsubscribe?.();
    connection.unsubscribe = undefined;
    connection.conversationId = conversationId;
    if (!conversationId || !(await getConversation(conversationId))) {
      connection.conversationId = null;
      this.journal.direct(null, connection.sink, { type: 'bound', conversationId: null });
      this.journal.direct(null, connection.sink, {
        type: 'snapshot',
        conversation: null,
        entries: [],
        status: 'idle',
        queue: [],
        prompts: [],
      });
      this.#deliverSelections(connection, tabId);
      return;
    }
    await this.journal.ready(conversationId);
    // A later subscribe of the same panel, made while this one waited, has the last word.
    if (connection.conversationId !== conversationId) return;
    // Another subscribe to the same conversation may have finished meanwhile; its subscription goes.
    // (Read through a second reference: the compiler keeps the `undefined` it saw before the await.)
    const current: PanelConnection = connection;
    current.unsubscribe?.();
    connection.unsubscribe = this.journal.subscribe(conversationId, connection.sink);
    const missed = sinceSeq !== undefined ? this.journal.since(conversationId, sinceSeq) : null;
    if (missed) {
      for (const event of missed) connection.sink(event);
      const streaming = this.journal.streaming(conversationId);
      if (streaming) this.journal.direct(conversationId, connection.sink, { type: 'message_update', ...streaming });
      return;
    }
    this.journal.direct(conversationId, connection.sink, { type: 'bound', conversationId });
    this.journal.direct(conversationId, connection.sink, await this.snapshot(conversationId));
    this.journal.direct(conversationId, connection.sink, {
      type: 'tabs',
      tabs: await this.scope.scopeTabs(conversationId),
    });
    this.#deliverSelections(connection, tabId);
    this.#handBack(conversationId, connection);
  }

  /**
   * The queued messages of a restored run go back to one panel's composer, and then out of the stored record, so a
   * later restart does not hand them back again.
   */
  #handBack(conversationId: string, connection: PanelConnection | undefined): void {
    const returned = this.#returned.get(conversationId);
    if (!returned?.length || !connection) return;
    this.#returned.delete(conversationId);
    this.journal.direct(conversationId, connection.sink, { type: 'queue', items: [], returned });
    this.#queueWrites = this.#queueWrites
      .then(async () => {
        const run = await getRun(conversationId);
        if (run?.steering.length && !this.#runs.has(conversationId)) await putRun({ ...run, steering: [] });
      })
      .catch(() => undefined);
  }

  async #history(connection: PanelConnection, query?: string): Promise<void> {
    const items = (await listConversations(query)).map(c => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      status: c.status,
      agentTabs: 0,
      tabs: [] as number[],
    }));
    for (const item of items) {
      item.agentTabs = await this.scope.agentTabCount(item.id);
      item.tabs = await this.scope.tabsOf(item.id);
    }
    this.journal.direct(connection.conversationId, connection.sink, { type: 'history', items });
  }

  /**
   * Settings → Data → Delete everything: every conversation as above, then the stores, the shortcuts, and the settings,
   * models, keys and site rules, and whatever the old Nanobrowser left. The layer's own state is not the user's data and
   * stays.
   */
  async deleteAll(): Promise<void> {
    // A move from the old Nanobrowser that is still running would write its data back after the deletion.
    await upgradeFromOldVersion().catch(() => undefined);
    // Analytics keeps the user's two switches through it, and clears its own keys.
    await deleteKeepingChoices(async () => {
      for (const c of await listConversations()) await this.#delete(c.id, false);
      await deleteEverything();
      await clearShortcuts();
      // The old conversations go first: with them still there and the upgrade record gone, a worker start in between
      // would run the move again.
      await deleteOldChats();
      await chrome.storage.local.remove([
        'nb.settings',
        'nb.providers',
        'nb.keys',
        'nb.siteRules',
        UPGRADE_KEY,
        WHATS_NEW_KEY,
        RATING_KEY,
        RATING_ANSWER_KEY,
        ...OLD_KEYS,
      ]);
    });
  }

  /**
   * Deletes a conversation: its run stops and its tabs are unbound. Its panels go back to an empty chat, and a panel
   * that only showed it, opened from Recent tasks, goes back to its tab's own conversation.
   */
  async #delete(conversationId: string, closeAgentTabs: boolean): Promise<void> {
    const run = this.#runs.get(conversationId);
    if (run) {
      run.controller.abort();
      await run.done.catch(() => undefined);
    }
    const showing = [...this.connections].filter(c => c.conversationId === conversationId);
    await this.scope.release(conversationId, closeAgentTabs);
    await deleteConversation(conversationId);
    await removeLive(conversationId);
    for (const connection of showing) {
      if (connection.tabId !== null) await this.#subscribe(connection, connection.tabId, null);
    }
    this.emit(conversationId, { type: 'bound', conversationId: null });
    this.emit(conversationId, {
      type: 'snapshot',
      conversation: null,
      entries: [],
      status: 'idle',
      queue: [],
      prompts: [],
    });
    this.journal.forget(conversationId);
  }

  async snapshot(conversationId: string): Promise<PanelEventBody> {
    const conversation = (await getConversation(conversationId)) ?? null;
    const live = await getLive(conversationId);
    const branch = await activeBranch(conversationId);
    const run = await getRun(conversationId);
    return {
      type: 'snapshot',
      conversation,
      entries: toDisplay(branch),
      status: run?.status ?? 'idle',
      reason: run?.reason,
      ...(run ? { startedAt: run.startedAt } : {}),
      queue: this.#queues.get(conversationId) ?? [],
      prompts: this.broker.promptsOf(conversationId),
      streaming: this.journal.streaming(conversationId),
      ...(live ? { live } : {}),
    };
  }

  async #send(connection: PanelConnection, command: Extract<PanelCommand, { type: 'send' }>): Promise<void> {
    const text = command.text.trim();
    if (!text && !command.attachments.length && !command.context.some(c => c.kind === 'selection')) return;
    // A shortcut's start page is a web address on a site the user has not blocked.
    const startUrl = command.startUrl;
    if (startUrl) {
      await this.permissions.ready();
      if (!isStartUrl(startUrl) || isBlockedSite(startUrl, this.permissions.blockedSites())) {
        this.journal.direct(command.conversationId, connection.sink, { type: 'error', message: 'shortcut.blocked' });
        return;
      }
    }
    let conversation: Conversation | undefined;
    if (command.conversationId) {
      conversation = await getConversation(command.conversationId);
      if (conversation && !(await this.#takeUp(connection, conversation.id))) return;
    }
    if (!conversation) {
      conversation = await createConversation({ mode: command.mode, tabs: [command.tabId] });
      // The live pair is written before the conversation's state is published.
      if (command.model) await setLive(conversation.id, { model: command.model, reasoning: command.reasoning });
      await this.#subscribe(connection, command.tabId, conversation.id);
      await this.scope.add(conversation.id, command.tabId, 'start', { move: true });
    }
    const conversationId = conversation.id;
    // Every send writes the live pair it carries; a run started now uses it, a run going on keeps its own (5.2).
    if (command.model) await this.#writeLive(conversationId, { model: command.model, reasoning: command.reasoning });
    // Tabs picked with @ before the first message join now.
    for (const c of command.context) {
      if (c.kind === 'tab' && c.tabId !== command.tabId)
        await this.#shareTab(connection, conversationId, c.tabId, 'user');
    }
    if (this.#runs.has(conversationId)) {
      // A message sent while the agent works joins the queue.
      return this.handle(connection, {
        type: 'queue',
        conversationId,
        id: newId(),
        text,
        attachments: [],
        context: [],
      });
    }
    if (command.mode !== conversation.mode) await this.#setMode(conversationId, command.mode);
    const { files, warnings } = await this.#takeAttachments(conversationId, conversation, command.attachments);
    // Quotes from "Ask Nanobrowser about this" go with the message, as page text.
    const quotes = command.context.flatMap(c =>
      c.kind === 'selection'
        ? [{ type: 'selection' as const, text: c.text.slice(0, 20_000), url: c.url, title: c.title }]
        : [],
    );
    if (!text && !files.length && !quotes.length) return;
    const entry = await appendEntry(conversationId, {
      type: 'message',
      message: { role: 'user', parts: [...(text ? [{ type: 'text' as const, text }] : []), ...quotes, ...files] },
    });
    if (!conversation.title && !conversation.titleByUser) {
      const updated = await updateConversation(conversationId, {
        title: titleFrom(text || quotes[0]?.text || files[0]?.name || 'Conversation'),
      });
      if (updated) this.emit(conversationId, { type: 'conversation', conversation: updated });
    }
    this.emit(conversationId, {
      type: 'message_end',
      entry: {
        kind: 'user',
        id: entry.id,
        text,
        ...(files.length
          ? { attachments: files.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size })) }
          : {}),
        ...(quotes.length ? { quotes: quotes.map(q => ({ text: q.text, url: q.url, title: q.title })) } : {}),
        at: entry.at,
      },
    });
    // What happened to the files is said after the message they came with.
    for (const warning of warnings) await this.#notice(conversationId, warning, 'warn');
    if (startUrl) await openStartPage(command.tabId, startUrl);
    // The run takes the pair this message carried, whatever was chosen since.
    this.#launch(
      conversationId,
      undefined,
      command.model ? { model: command.model, reasoning: command.reasoning } : undefined,
    );
  }

  /**
   * The files sent with a message. The panel wrote each one to the blob store; here each is checked again (it exists,
   * belongs to no other conversation, is an image or a text file, 25 MB at most, 100 MB at most for the conversation)
   * and moved to the conversation. A refused file gets a notice and is left out.
   */
  async #takeAttachments(
    conversationId: string,
    conversation: Conversation,
    refs: AttachmentRef[],
  ): Promise<{ files: Array<Extract<MessagePart, { type: 'attachment' }>>; warnings: string[] }> {
    const warnings: string[] = [];
    if (!refs.length) return { files: [], warnings };
    const out: Array<Extract<MessagePart, { type: 'attachment' }>> = [];
    let total = (await listBlobs(conversationId)).reduce((n, b) => n + b.size, 0);
    const vision = await resolveModel(await livePair(conversationId))
      .then(m => m.profile.vision)
      .catch(() => true);
    for (const ref of refs) {
      const blob = await getBlob(ref.id);
      if (!blob || (blob.conversationId && blob.conversationId !== conversationId)) continue;
      const kind = attachmentKind(blob.name, blob.mimeType);
      if ('refused' in kind) {
        warnings.push(`${blob.name}: ${kind.refused}`);
        continue;
      }
      if (blob.size > MAX_FILE) {
        warnings.push(`${blob.name} is larger than 25 MB and was not attached.`);
        continue;
      }
      if (blob.conversationId !== conversationId) {
        if (total + blob.size > MAX_CONVERSATION) {
          warnings.push(`${blob.name} was not attached: a conversation holds at most 100 MB of files.`);
          continue;
        }
        total += blob.size;
        await putBlob({ ...blob, conversationId });
      }
      if (kind.kind === 'image' && !vision) {
        warnings.push(`This model cannot see images: ${blob.name} is kept with the conversation but not sent.`);
      }
      out.push({ type: 'attachment', id: blob.id, name: blob.name, mimeType: blob.mimeType, size: blob.size });
    }
    return { files: out, warnings };
  }

  /**
   * Edit, Restart from here and Retry: a new branch from a user message, run with the conversation's mode and model.
   * The old branch stays in the tree.
   */
  async #rebranch(
    connection: PanelConnection,
    conversationId: string,
    kind: 'edit' | 'restart' | 'retry',
    entryId?: string,
    text?: string,
  ): Promise<void> {
    if (this.#runs.has(conversationId)) {
      this.journal.direct(conversationId, connection.sink, { type: 'error', message: 'run.stopFirst' });
      return;
    }
    if (!(await this.#takeUp(connection, conversationId))) return;
    const branch = await activeBranch(conversationId);
    const userMessages = branch.filter(
      (e): e is EntryOf<'message'> => e.type === 'message' && e.message.role === 'user' && !e.appOwned,
    );
    if (kind === 'edit') {
      const entry = userMessages.find(e => e.id === entryId);
      const edited = text?.trim();
      if (!entry || !edited) return;
      await setLeaf(conversationId, entry.parentId);
      // The edited message keeps its files; they are added again at the start of the run.
      const files = entry.message.parts.flatMap(p => (p.type === 'attachment' ? [{ ...p, inlined: false }] : []));
      await appendEntry(conversationId, {
        type: 'message',
        message: { role: 'user', parts: [{ type: 'text', text: edited }, ...files] },
      });
    } else {
      // Restart answers the given user message again, dropping what came after it; Retry, the last one.
      const user = kind === 'restart' ? userMessages.find(e => e.id === entryId) : userMessages.at(-1);
      if (!user) return;
      await setLeaf(conversationId, user.id);
    }
    this.emit(conversationId, await this.snapshot(conversationId));
    this.#launch(conversationId);
  }

  #deliverSelections(connection: PanelConnection, tabId: number): void {
    const selections = this.#selections.get(tabId);
    if (!selections?.length) return;
    this.#selections.delete(tabId);
    for (const s of selections)
      this.journal.direct(connection.conversationId, connection.sink, { type: 'selection', ...s });
  }

  /** "Ask Nanobrowser about this": the selection becomes a quote chip in the tab's panel. */
  addSelection(tabId: number, selection: { text: string; url: string; title: string }): void {
    const open = [...this.connections].filter(c => c.tabId === tabId);
    if (!open.length) {
      this.#selections.set(tabId, [...(this.#selections.get(tabId) ?? []), selection]);
      return;
    }
    for (const c of open) this.journal.direct(c.conversationId, c.sink, { type: 'selection', ...selection });
  }

  /**
   * The agent tools the worker runs: `save_file`. It follows the mode: in Ask mode the Save file card asks; in Auto
   * mode the file is saved. Either way an existing file is never overwritten. Saving needs Chrome's downloads
   * permission, which only a user's click can allow: until it is allowed, the card asks in Auto mode too, and the file
   * is never saved without it.
   */
  async #agentTool(
    conversationId: string,
    call: ToolCallRequest,
    signal: AbortSignal,
  ): Promise<{ text: string; isError: boolean }> {
    if (call.toolName !== 'save_file') return { text: `error: ${call.toolName} is not available.`, isError: true };
    const args = (call.input ?? {}) as Record<string, unknown>;
    const check = checkSave(args);
    if (!check.ok) return { text: `error INVALID_ARGUMENT (nothing saved)\n${check.reason}`, isError: true };
    const content = String(args.content);
    let saveAs = false;
    const canSave = () => chrome.permissions.contains({ permissions: ['downloads'] }).catch(() => false);
    if ((this.#modes.get(conversationId) ?? 'ask') === 'ask' || !(await canSave())) {
      const answer = await this.broker.open<'save' | 'save-as' | 'discard'>(
        conversationId,
        'save-file',
        {
          filename: check.filename,
          mimeType: check.mimeType,
          bytes: check.bytes,
          preview: content.split('\n').slice(0, 8).join('\n').slice(0, 800),
        },
        signal,
      );
      if (answer !== 'save' && answer !== 'save-as') {
        return { text: 'save_file · the user discarded the file; nothing was saved.', isError: true };
      }
      saveAs = answer === 'save-as';
    }
    if (!(await canSave())) {
      return {
        text: "error SAVE_FAILED (not saved)\nSaving files needs Chrome's downloads permission, which the user has not allowed.",
        isError: true,
      };
    }
    const saved = await saveText({ filename: check.filename, content, mimeType: check.mimeType }, saveAs).catch(
      (error: Error) => ({ state: 'interrupted' as const, error: error.message, name: check.filename, downloadId: -1 }),
    );
    if (saved.state !== 'complete') {
      return {
        text: `error SAVE_FAILED (not saved)\nThe download did not complete: ${saved.error ?? 'interrupted'}.`,
        isError: true,
      };
    }
    const entry = await appendEntry(conversationId, {
      type: 'ui',
      kind: 'download',
      data: { name: saved.name, downloadId: saved.downloadId, bytes: check.bytes },
    });
    this.emit(conversationId, {
      type: 'message_end',
      entry: {
        kind: 'download',
        id: entry.id,
        name: saved.name,
        downloadId: saved.downloadId,
        bytes: check.bytes,
        at: entry.at,
      },
    });
    // The name can differ for other reasons too: the user chose another in Save as…, or Chrome changed it.
    const note =
      saved.name === check.filename
        ? ''
        : isNumberedCopy(saved.name, check.filename)
          ? `; a file named ${quote(check.filename, 120)} was already there, so a number was added`
          : `; it was saved under that name instead of ${quote(check.filename, 120)}`;
    return {
      text: `save_file · saved ${quote(saved.name, 120)} (${check.bytes} bytes)${saveAs ? '' : ' in the Downloads folder'}${note}.`,
      isError: false,
    };
  }

  /**
   * "Screenshot of this tab": taken through the layer's `screenshot`, so its masking applies, in a session of its own
   * that ends with the capture. It becomes an image attachment for the next message. A tab a working run holds is not
   * captured.
   */
  async #screenshotTab(connection: PanelConnection, tabId: number, conversationId: string | null): Promise<void> {
    const say = (message: string) => this.journal.direct(conversationId, connection.sink, { type: 'error', message });
    const owner = await this.scope.conversationOf(tabId);
    if ((owner && this.#runs.has(owner)) || (conversationId && this.#runs.has(conversationId))) {
      return say('The agent is working in this tab. Stop it first, or wait until it finishes.');
    }
    const controller = await controllerReady;
    await this.permissions.ready();
    const session = createAgentSession(controller, {
      urlPolicy: { allow: [], deny: [], blocked: this.permissions.blockedSites() },
    });
    let result;
    try {
      session.shareTab(tabId);
      result = await session.call('screenshot', { tabId });
    } catch (error) {
      result = { ok: false, text: String((error as Error)?.message ?? error) };
    } finally {
      await controller.closeSession(session);
    }
    const data = result.ok ? (result as { data?: { base64?: string; mimeType?: string } }).data : undefined;
    if (!data?.base64) return say('This tab cannot be captured: Chrome does not let extensions capture its own pages.');
    const mimeType = data.mimeType ?? 'image/png';
    const bytes = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const ref = { id: newId(), name: `screenshot-${stamp}.png`, mimeType, size: bytes.length };
    await putBlob({
      ...ref,
      conversationId: '',
      data: new Blob([bytes], { type: mimeType }),
      createdAt: new Date().toISOString(),
    });
    this.journal.direct(conversationId, connection.sink, {
      type: 'attached',
      ref,
      preview: await thumbnail(data.base64, mimeType),
    });
  }

  /**
   * `/compact`: during a run, compaction at the next turn boundary; otherwise now, with the conversation's model and
   * the settings a run would use.
   */
  async #compact(conversationId: string): Promise<void> {
    const run = this.#runs.get(conversationId);
    if (run) {
      run.loop?.requestCompaction();
      return;
    }
    const conversation = await getConversation(conversationId);
    if (!conversation) return;
    try {
      const model = await resolveModel(await livePair(conversationId));
      const settings = (await settingsStorage.get()) ?? DEFAULT_SETTINGS;
      const tools = toolsForRun({ vision: model.profile.vision });
      const system = agentSystemPrompt({
        responseLanguage: settings.responseLanguage,
        tools: tools.map(t => t.name),
        customInstructions: settings.customInstructions,
      });
      const unverified = new Set(((await getRun(conversationId))?.debt ?? []).map(d => d.toolCallId));
      const result = await runCompaction({
        conversationId,
        model,
        fixedChars: system.length + JSON.stringify(tools.map(t => [t.name, t.description, t.parameters])).length,
        unverified,
        messages: branch => toModelMessages(branch, { vision: model.profile.vision, unverified }),
      });
      if (model.reasoningDropped) await this.#notice(conversationId, REASONING_DROPPED, 'info');
      if (!result) {
        await this.#notice(conversationId, 'Nothing to compact yet: the conversation is still short.', 'info');
        return;
      }
      this.emit(conversationId, {
        type: 'compacted',
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
      });
      for (const n of result.notices)
        this.emit(conversationId, { type: 'message_end', entry: { kind: 'notice', ...n } });
    } catch (error) {
      const message = error instanceof ModelUnavailable ? error.message : String((error as Error)?.message ?? error);
      await this.#notice(conversationId, message, 'error');
    }
  }

  async #setMode(conversationId: string, mode: Conversation['mode']): Promise<void> {
    const conversation = await getConversation(conversationId);
    if (!conversation || conversation.mode === mode) return;
    const updated = await updateConversation(conversationId, { mode });
    if (this.#modes.has(conversationId)) this.#modes.set(conversationId, mode);
    await appendEntry(conversationId, { type: 'mode_change', mode });
    if (updated) this.emit(conversationId, { type: 'conversation', conversation: updated });
  }

  /**
   * A model or effort chosen in a picker: the conversation's live pair, and the settings, so the latest choice is the
   * default for new conversations. A run going on keeps its own; the next run takes it.
   */
  async #setModel(conversationId: string, pair: LivePair): Promise<void> {
    if (!(await getConversation(conversationId))) return;
    await this.#writeLive(conversationId, pair);
    await settingsStorage.set(s => ({ ...s, defaultModel: pair.model, reasoning: pair.reasoning }));
  }

  /** Writes a live pair to `storage.session` and tells the conversation's panels. */
  async #writeLive(conversationId: string, pair: LivePair): Promise<void> {
    const pairOf = (p: LivePair): LivePair => ({
      model: { providerId: p.model.providerId, model: p.model.model },
      reasoning: p.reasoning,
    });
    const next = pairOf(pair);
    const stored = await getLive(conversationId);
    if (stored && JSON.stringify(pairOf(stored)) === JSON.stringify(next)) return;
    await setLive(conversationId, next);
    this.emit(conversationId, { type: 'live', pair: next });
  }

  /**
   * Shares a tab the user chose (@, Continue here) with a conversation. A tab another conversation holds is moved only
   * after the user agrees; a tab on a blocked site stays out, and the panel says why.
   */
  async #shareTab(
    connection: PanelConnection,
    conversationId: string,
    tabId: number,
    origin: 'user',
  ): Promise<boolean> {
    let result = await this.scope.add(conversationId, tabId, origin);
    if (!result.ok && result.reason === 'owned') {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      const answer = await this.broker.open<string>(
        conversationId,
        'confirm',
        { question: 'move-tab', title: tab?.title ?? '' },
        new AbortController().signal,
        { tabId },
      );
      if (answer !== 'yes') return false;
      if (result.owner && this.#runs.has(result.owner)) {
        this.journal.direct(conversationId, connection.sink, { type: 'error', message: 'scope.ownerRunning' });
        return false;
      }
      result = await this.scope.add(conversationId, tabId, origin, { move: true });
    }
    if (!result.ok) {
      this.journal.direct(conversationId, connection.sink, {
        type: 'error',
        message: result.reason === 'blocked' ? 'scope.blocked' : 'scope.gone',
      });
      return false;
    }
    return true;
  }

  async #setStatus(record: RunRecord, status: RunStatus, reason?: string): Promise<void> {
    record.status = status;
    record.reason = reason;
    await putRun(record);
    const conversation = await updateConversation(record.conversationId, { status });
    this.emit(record.conversationId, { type: 'run_status', status, reason, startedAt: record.startedAt });
    await this.scope.status(record.conversationId, status, conversation?.title ?? '');
    void this.border.status(record.conversationId, status).catch(() => undefined);
  }

  /** Continue and Resume: a new run on the same context, opened by a note. */
  async #continue(conversationId: string, from: RunStatus, note: string): Promise<void> {
    if (this.#runs.has(conversationId)) return;
    const previous = await getRun(conversationId);
    if (previous?.status !== from) return;
    await this.#start(conversationId, { note, restore: previous });
  }

  async #start(conversationId: string, options: { note?: string; restore?: RunRecord } = {}): Promise<void> {
    if (options.note) await new RunWriter(conversationId, 'note').appNote(options.note);
    this.#launch(conversationId, options.restore);
  }

  /**
   * Starts a run. Its model and effort are the pair given (the message's), or the live pair read now, before anything
   * awaits, so a choice made while the run starts applies to the next run.
   */
  #launch(conversationId: string, restore?: RunRecord, pair?: LivePair): void {
    const starting = pair ? Promise.resolve(pair) : livePair(conversationId);
    starting.catch(() => undefined);
    const controller = new AbortController();
    const runId = newId();
    let loopRef: AgentLoop | undefined;
    const done = (async () => {
      const conversation = (await getConversation(conversationId))!;
      const now = new Date().toISOString();
      const record: RunRecord = {
        conversationId,
        runId,
        leafEntryId: conversation.leafId,
        status: 'running',
        steering: [],
        turns: 0,
        usage: ZERO_USAGE,
        debt: restore?.debt ?? [],
        guards: restore?.guards ?? EMPTY_GUARDS,
        tabs: conversation.tabs,
        startedAt: now,
        updatedAt: now,
      };
      this.#records.set(conversationId, record);
      noteActivity('run');
      // Counted here, before the model resolves, since every run that starts is counted when it ends.
      void count('runs.started');
      await this.#setStatus(record, 'running');
      let end: LoopEnd | undefined;
      try {
        const model = await resolveModel(await starting);
        const settings = (await settingsStorage.get()) ?? DEFAULT_SETTINGS;
        record.model = await runModel(model.ref);
        if (record.model) {
          // Written now, so a run the restart cuts still counts its model's outcome.
          await putRun(record);
          void runStarted(record.model, model.reasoning, conversation.mode, model.profile.vision, this.#runs.size > 1);
        }
        this.#modes.set(conversationId, conversation.mode);
        const session = await this.#openSession(conversationId);
        record.tabs = session.tabIds();
        const tools = toolsForRun({ vision: model.profile.vision });
        const loop = new AgentLoop({
          conversationId,
          runId,
          startedAt: record.startedAt,
          model,
          system: agentSystemPrompt({
            responseLanguage: settings.responseLanguage,
            tools: tools.map(t => t.name),
            customInstructions: settings.customInstructions,
          }),
          tools,
          mode: () => this.#modes.get(conversationId) ?? conversation.mode,
          layer: layerPort(session, this.border),
          host: this.#host(conversationId, session),
          signal: controller.signal,
          emit: event => this.emit(conversationId, event),
          turnCap: settings.turnCap,
          thumbnail,
          agentTool: (call, signal) => this.#agentTool(conversationId, call, signal),
          restore: restore ? { debt: restore.debt as DebtEntry[], guards: restore.guards } : undefined,
          takeSteering: () => {
            const queue = this.#queues.get(conversationId)?.splice(0) ?? [];
            if (queue.length) this.#emitQueue(conversationId);
            return queue.map(q => q.text);
          },
        });
        const active = this.#runs.get(conversationId);
        if (active?.runId === runId) active.loop = loop;
        loopRef = loop;
        loop.hasSteering = () => (this.#queues.get(conversationId)?.length ?? 0) > 0;
        end = await loop.run();
        record.turns += end.turns;
        record.usage = addUsage(record.usage, end.usage);
        record.outcome = end.outcome;
        record.debt = loop.debt;
        record.guards = loop.guards.state;
        if (end.status === 'failed' && end.reason) await this.#notice(conversationId, end.reason, 'error');
        if (end.status === 'stopped') {
          await this.#notice(conversationId, STOPPED_BY_USER, 'info');
          await new RunWriter(conversationId, runId).appNote(STOPPED_NOTE);
        }
        await this.#setStatus(record, end.status, end.reason);
        if (end.status !== 'stopped' && !(await this.#inView(conversationId))) {
          await notifyFinished(conversationId, end.outcome === 'success', (await this.scope.tabsOf(conversationId))[0]);
        }
      } catch (error) {
        const message = error instanceof ModelUnavailable ? error.message : `The run failed: ${String(error)}`;
        await this.#notice(conversationId, message, 'error');
        record.outcome = 'failed';
        await this.#setStatus(record, 'failed', message);
      } finally {
        runEnded(record, end ?? {});
        // A run that finished well counts towards the card that asks for a store rating.
        if (endOf(record.status, record.outcome) === 'success') {
          void ratingStorage.set(u => afterFinishedRun(u, new Date(), conversationId)).catch(() => undefined);
        }
        this.#runs.delete(conversationId);
        this.#records.delete(conversationId);
        this.broker.withdrawAll(conversationId);
        // When a run ends the debugger is detached; the next run attaches again and starts fresh.
        await this.#closeSession(conversationId);
        // A message queued as the run was ending is sent now, as the next message. Stop gave the queue back already.
        if (!controller.signal.aborted) await this.#sendQueued(conversationId);
        // `/compact` that reached the run after its last turn is done now.
        if (loopRef?.compactionPending && !this.#runs.has(conversationId)) await this.#compact(conversationId);
      }
    })();
    this.#runs.set(conversationId, { runId, controller, done });
    void this.#watchdog();
    void done.then(() => this.#watchdog());
  }

  async #sendQueued(conversationId: string): Promise<void> {
    const left = this.#queues.get(conversationId)?.splice(0) ?? [];
    if (!left.length || this.#runs.has(conversationId) || !(await getConversation(conversationId))) return;
    this.#emitQueue(conversationId);
    for (const item of left) {
      const entry = await appendEntry(conversationId, {
        type: 'message',
        message: { role: 'user', parts: [{ type: 'text', text: item.text }] },
      });
      this.emit(conversationId, {
        type: 'message_end',
        entry: { kind: 'user', id: entry.id, text: item.text, at: entry.at },
      });
    }
    this.#launch(conversationId);
  }

  async #notice(conversationId: string, text: string, tone: 'info' | 'warn' | 'error'): Promise<void> {
    const entry = await appendEntry(conversationId, { type: 'ui', kind: 'notice', data: { text, tone } });
    this.emit(conversationId, {
      type: 'message_end',
      entry: { kind: 'notice', id: entry.id, text, tone, at: entry.at },
    });
  }
}

export function isUnfinished(status: RunStatus): boolean {
  return UNFINISHED.has(status);
}

/** Opens a shortcut's start page in the tab and waits for it to load, at most 15 seconds. */
async function openStartPage(tabId: number, url: string): Promise<void> {
  await new Promise<void>(resolve => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, 15_000);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch(done);
  });
}
