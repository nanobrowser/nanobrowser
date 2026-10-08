// Optional Jev policy above the deterministic browser layer. A model decision never replaces browser permission.
import { sanitizeDecisionInput, sanitizeDecisionText } from '@src/llm/jev';
import type { CompletionDecision, DecisionAction, DecisionContext, DecisionEngine, DecisionResult } from '@src/llm/jev';
import type { ToolCallRequest } from '@src/llm';
import type { Result } from '@src/browser-control';
import { buildJevCandidates } from './jev-candidates';
import type { JevObservation } from './jev-candidates';

export interface JevConfirmationRequest {
  taskId: string;
  toolCallId: string;
  action: DecisionAction;
  tabId: number;
  rev: number;
  stateKey: string;
}
export interface JevLoopOptions {
  engine: DecisionEngine;
  task: string;
  experimental?: boolean;
  confirm(request: JevConfirmationRequest, signal: AbortSignal): Promise<boolean>;
  record?(operation: 'action' | 'completion' | 'selection', result: DecisionResult<string>): Promise<void> | void;
}
export interface JevGate {
  allowed: boolean;
  text?: string;
  stop?: string;
}

/** Snapshot revision numbers advance on reads; the document refs, outline and address define meaningful state. */
export async function jevStateKey(page: JevObservation): Promise<string> {
  const state = JSON.stringify([page.tabId, page.url, page.outline]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

function safeAction(action: DecisionAction): DecisionAction {
  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.slice(0, 100).map(redact);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /^(value|text|content|promptText)$/i.test(key) && (typeof item === 'string' || Array.isArray(item))
          ? '[REDACTED]'
          : redact(item),
      ]),
    );
  };
  return { name: action.name, parameters: sanitizeDecisionInput(redact(action.parameters)) as Record<string, unknown> };
}

export class JevRuntime {
  readonly pages = new Map<number, JevObservation>();
  #outcomes: unknown[] = [];
  #reconsiderations = 0;
  #selected = new Set<string>();
  #selectionStreak = 0;
  #task: string;
  #completionAttempts = 0;
  #completionCache?: { key: string; result: CompletionDecision };
  constructor(
    readonly options: JevLoopOptions,
    readonly taskId: string,
    readonly signal: AbortSignal,
  ) {
    this.#task = options.task;
  }
  steer(text: string): void {
    this.#completionCache = undefined;
    this.#completionAttempts = 0;
    this.#task += `\n${text}`;
    this.#reconsiderations = 0;
  }
  observe(result: Result): void {
    const page = result.page;
    if (!result.ok || !page) return;
    const snapshot = page.snapshot ?? (page.changed === 'full' ? result.text : undefined);
    if (snapshot === undefined) {
      this.pages.delete(page.tabId);
      return;
    }
    const outline = snapshot
      .replace(/^.*?<<<page-content[^>]*>>>\s*/s, '')
      .replace(/\s*<<<end-page-content[\s\S]*$/, '');
    this.pages.set(page.tabId, {
      tabId: page.tabId,
      rev: page.rev,
      url: page.url,
      title: page.title,
      outline,
      complete: (result.data as { status?: string } | undefined)?.status !== 'partial',
    });
  }
  execution(call: ToolCallRequest, result?: Result): void {
    if (!result) return;
    this.#completionCache = undefined;
    this.observe(result);
    this.#outcomes.push(
      sanitizeDecisionInput({ tool: call.toolName, ok: result.ok, receipt: result.receipt, text: result.text }),
    );
    this.#outcomes = this.#outcomes.slice(-10);
  }
  context(page?: JevObservation | null, claimedCompletion?: unknown): DecisionContext {
    return {
      taskId: this.taskId,
      task: sanitizeDecisionText(this.#task),
      signal: this.signal,
      ...(page
        ? {
            browser: {
              url: sanitizeDecisionText(page.url),
              title: sanitizeDecisionText(page.title),
              pageText: sanitizeDecisionText(page.outline),
            },
          }
        : {}),
      outcomes: this.#outcomes,
      ...(claimedCompletion === undefined ? {} : { claimedCompletion: sanitizeDecisionInput(claimedCompletion) }),
    };
  }
  async record(operation: 'action' | 'completion' | 'selection', result: DecisionResult<string>): Promise<void> {
    await this.options.record?.(operation, result);
  }
  #blocked(text: string, stop = false): JevGate {
    this.#reconsiderations++;
    return { allowed: false, text, ...(stop || this.#reconsiderations >= 3 ? { stop: text } : {}) };
  }
  async action(
    call: ToolCallRequest,
    page: JevObservation,
    refresh: () => Promise<JevObservation | null>,
  ): Promise<JevGate> {
    const key = await jevStateKey(page);
    const action = safeAction({ name: call.toolName, parameters: (call.input ?? {}) as Record<string, unknown> });
    try {
      const decision = await this.options.engine.evaluateAction(this.context(page), action);
      await this.record('action', decision);
      if (this.signal.aborted) return this.#blocked('Jev action evaluation was cancelled.', true);
      if (decision.outcome === 'reconsider')
        return this.#blocked('Jev asks you to reconsider this action; nothing was dispatched.');
      if (decision.outcome === 'confirm') {
        const approved = await this.options.confirm(
          { taskId: this.taskId, toolCallId: call.toolCallId, action, tabId: page.tabId, rev: page.rev, stateKey: key },
          this.signal,
        );
        if (!approved) return this.#blocked('Jev confirmation was rejected; nothing was dispatched.', true);
      }
      if (this.signal.aborted) return this.#blocked('Jev action evaluation was cancelled.', true);
      const current = await refresh();
      if (!current || key !== (await jevStateKey(current)))
        return this.#blocked('Jev approval expired because the observed page changed; propose a fresh action.');
      if (this.signal.aborted) return this.#blocked('Jev action evaluation was cancelled.', true);
      this.#reconsiderations = 0;
      return { allowed: true };
    } catch {
      return this.#blocked('Jev could not evaluate this action safely; nothing was dispatched.');
    }
  }
  async completion(
    page: JevObservation | null,
    claim: unknown,
    refresh: () => Promise<JevObservation | null>,
  ): Promise<JevGate> {
    const verify = async (current: JevObservation | null) => {
      const key = JSON.stringify([
        this.#task,
        current ? await jevStateKey(current) : null,
        this.#outcomes,
        sanitizeDecisionInput(claim),
      ]);
      if (this.#completionCache?.key === key) return this.#completionCache.result;
      const decision = await this.options.engine.verifyCompletion(this.context(current, claim));
      await this.record('completion', decision);
      this.#completionCache = { key, result: decision };
      return decision;
    };
    try {
      let decision = await verify(page);
      if (decision.outcome === 'needs_verification' && !decision.isHandoff && !this.signal.aborted) {
        const fresh = await refresh();
        if (fresh) decision = await verify(fresh);
      }
      if (this.signal.aborted)
        return {
          allowed: false,
          text: 'Jev completion verification was cancelled.',
          stop: 'Jev completion verification was cancelled.',
        };
      if (decision.outcome === 'complete' && !decision.isHandoff) {
        this.#completionAttempts = 0;
        return { allowed: true };
      }
      this.#completionAttempts++;
      const text = decision.isHandoff
        ? 'Jev found that this task needs user input or sign-in; it is not marked complete.'
        : 'Jev could not verify completion; read the result and continue or report a partial outcome.';
      return {
        allowed: false,
        text,
        ...(decision.isHandoff || decision.outcome === 'needs_verification' || this.#completionAttempts >= 3
          ? { stop: text }
          : {}),
      };
    } catch {
      const text = 'Jev completion verification failed safely; the task is not marked complete.';
      return { allowed: false, text, stop: text };
    }
  }
  async select(page: JevObservation, allowed: ReadonlySet<string>): Promise<DecisionAction | null> {
    if (!this.options.experimental || this.signal.aborted || this.#selectionStreak >= 3) {
      this.#selectionStreak = 0;
      return null;
    }
    const candidates = buildJevCandidates(page).filter(candidate => allowed.has(candidate.action.name));
    if (!candidates.length) return null;
    try {
      const decision = await this.options.engine.selectAction(
        this.context(page),
        candidates.map(candidate => ({
          ...candidate,
          label: sanitizeDecisionText(candidate.label ?? ''),
          action: safeAction(candidate.action),
        })),
      );
      await this.record('selection', decision);
      if (decision.outcome !== 'selected' || this.signal.aborted) {
        this.#selectionStreak = 0;
        return null;
      }
      const candidate = candidates.find(item => item.id === decision.candidateId);
      if (!candidate) return null;
      const key = `${await jevStateKey(page)}:${candidate.id}`;
      if (this.#selected.has(key)) {
        this.#selectionStreak = 0;
        return null;
      }
      this.#selected.add(key);
      this.#selectionStreak++;
      return candidate.action;
    } catch {
      return null;
    }
  }
}
