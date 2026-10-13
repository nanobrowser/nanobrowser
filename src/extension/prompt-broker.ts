// The PromptBroker: the layer's prompts (write cards, ask_user) and the loop's hand-overs become cards in the
// conversation's panels. A card has no time limit unless the layer gives one; it is withdrawn when its wait ends, and a
// late answer has no effect.
import { siteOf } from '@src/browser-control';
import type { AskAnswer, AskRequest, ConfirmAnswer, ConfirmRequest, UserPrompt } from '@src/browser-control';
import { newId } from '@src/store/conversations';
import type { OpenPrompt, PanelEventBody } from '@src/ui/protocol';

interface Waiting {
  prompt: OpenPrompt;
  resolve: (answer: unknown) => void;
  /** Says why an answer cannot be taken yet (a prompt dialog still open), or null. */
  check?: (answer: unknown) => Promise<string | null>;
}

export interface BrokerHooks {
  emit(conversationId: string, body: PanelEventBody): void;
  /** A card opened or closed: the run waits for the user while any is open. */
  waiting(conversationId: string, open: OpenPrompt[]): void;
  /** The conversation that owns a tab, for the layer's prompts. */
  conversationOf(tabId: number): string | null;
  /** The tab's address, for the site a card names (read by the extension, never from page text). */
  tabUrl(tabId: number): Promise<string>;
  /** "Allow on this site" was chosen on a write card. */
  remember(site: string): Promise<void>;
}

export class PromptBroker {
  #open = new Map<string, Waiting>();

  constructor(readonly hooks: BrokerHooks) {}

  promptsOf(conversationId: string): OpenPrompt[] {
    return [...this.#open.values()].filter(w => w.prompt.conversationId === conversationId).map(w => w.prompt);
  }

  /** Opens a card and waits for its answer, or until `signal` ends the wait. */
  open<T>(
    conversationId: string,
    kind: OpenPrompt['kind'],
    data: Record<string, unknown>,
    signal: AbortSignal,
    options: { tabId?: number; check?: (answer: unknown) => Promise<string | null> } = {},
  ): Promise<T | 'withdrawn'> {
    const prompt: OpenPrompt = {
      id: newId(),
      kind,
      conversationId,
      tabId: options.tabId,
      data,
      openedAt: new Date().toISOString(),
    };
    return new Promise(resolve => {
      if (signal.aborted) return resolve('withdrawn');
      this.#open.set(prompt.id, { prompt, resolve: a => resolve(a as T), check: options.check });
      this.hooks.emit(conversationId, { type: 'prompt_open', prompt });
      this.hooks.waiting(conversationId, this.promptsOf(conversationId));
      signal.addEventListener('abort', () => {
        if (this.#close(prompt.id, 'withdrawn')) resolve('withdrawn');
      });
    });
  }

  /** An answer from a panel. False when the card is no longer open (answered, or withdrawn). */
  async answer(promptId: string, answer: unknown): Promise<boolean> {
    const waiting = this.#open.get(promptId);
    if (!waiting) return false;
    const notYet = await waiting.check?.(answer);
    if (notYet) {
      // The card stays open and says why (a page's prompt dialog is still waiting).
      waiting.prompt = { ...waiting.prompt, data: { ...waiting.prompt.data, notice: notYet } };
      this.hooks.emit(waiting.prompt.conversationId, { type: 'prompt_open', prompt: waiting.prompt });
      return false;
    }
    if (
      !this.#close(
        promptId,
        typeof answer === 'string' ? answer : ((answer as { outcome?: string })?.outcome ?? 'answered'),
      )
    ) {
      return false;
    }
    waiting.resolve(answer);
    return true;
  }

  #close(promptId: string, outcome: string): boolean {
    const waiting = this.#open.get(promptId);
    if (!waiting) return false;
    this.#open.delete(promptId);
    const conversationId = waiting.prompt.conversationId;
    this.hooks.emit(conversationId, { type: 'prompt_closed', id: promptId, outcome });
    this.hooks.waiting(conversationId, this.promptsOf(conversationId));
    return true;
  }

  /** Withdraws every card of a conversation (Stop, delete). */
  withdrawAll(conversationId: string): void {
    for (const w of [...this.#open.values()]) {
      if (w.prompt.conversationId !== conversationId) continue;
      if (this.#close(w.prompt.id, 'withdrawn')) w.resolve('withdrawn');
    }
  }

  /** The layer's prompts for tabs the product's sessions hold (src/extension/layer.ts routes them here). */
  userPrompt(): UserPrompt {
    return {
      confirm: async (request: ConfirmRequest, signal: AbortSignal): Promise<ConfirmAnswer> => {
        const conversationId = this.hooks.conversationOf(request.tabId);
        if (!conversationId) return 'decline';
        const answer = await this.open<ConfirmAnswer>(
          conversationId,
          'write-card',
          {
            category: request.category,
            action: request.action,
            target: request.target,
            site: request.site,
            frameHost: request.frameHost,
            destinationHost: request.destinationHost,
            intent: request.intent,
            reason: request.reason,
            canRemember: request.canRemember,
          },
          signal,
          { tabId: request.tabId },
        );
        if (answer === 'withdrawn') return 'decline';
        if (answer === 'approve-remember' && request.canRemember && request.site)
          await this.hooks.remember(request.site);
        return answer === 'approve' || answer === 'approve-remember' ? answer : 'decline';
      },
      ask: async (request: AskRequest, signal: AbortSignal): Promise<AskAnswer> => {
        const conversationId = this.hooks.conversationOf(request.tabId);
        if (!conversationId) return { outcome: 'cancel' };
        const site = siteOf(await this.hooks.tabUrl(request.tabId));
        const answer = await this.open<AskAnswer>(
          conversationId,
          request.kind === 'takeover' ? 'ask-takeover' : 'ask-input',
          { message: request.message, site },
          signal,
          { tabId: request.tabId },
        );
        return answer === 'withdrawn' ? { outcome: 'cancel' } : answer;
      },
    };
  }
}
