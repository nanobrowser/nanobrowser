// The panel journal. Every event for a conversation gets the next sequence number and goes to the panels subscribed to
// it. A bounded window of recent events (without the streaming text updates) is kept in storage.session, so a panel
// that reconnects with `sinceSeq` gets what it missed; the reply streaming now is kept apart and sent whole. Text
// updates are coalesced to about 50 ms.
import type { PanelEvent, PanelEventBody } from '@src/ui/protocol';

const WINDOW = 300;
const COALESCE_MS = 50;
const PERSIST_MS = 250;

interface ConversationJournal {
  seq: number;
  events: PanelEvent[];
  streaming?: { id: string; text: string };
  pendingUpdate?: ReturnType<typeof setTimeout>;
  persistTimer?: ReturnType<typeof setTimeout>;
  loaded: Promise<void>;
}

export type Sink = (event: PanelEvent) => void;

const sessionStorage = () => globalThis.chrome?.storage?.session;

export class Journal {
  #journals = new Map<string, ConversationJournal>();
  #sinks = new Map<string, Set<Sink>>();

  #journal(conversationId: string): ConversationJournal {
    let journal = this.#journals.get(conversationId);
    if (!journal) {
      const created: ConversationJournal = { seq: 0, events: [], loaded: Promise.resolve() };
      created.loaded = (async () => {
        const key = `nb.journal.${conversationId}`;
        const stored = (await sessionStorage()?.get(key))?.[key] as { seq: number; events: PanelEvent[] } | undefined;
        if (stored && stored.seq > created.seq) {
          created.seq = stored.seq;
          created.events = stored.events;
        }
      })().catch(() => undefined);
      this.#journals.set(conversationId, created);
      journal = created;
    }
    return journal;
  }

  /** Waits until the stored window is loaded, so sequence numbers continue after a worker restart. */
  async ready(conversationId: string): Promise<void> {
    await this.#journal(conversationId).loaded;
  }

  subscribe(conversationId: string, sink: Sink): () => void {
    let sinks = this.#sinks.get(conversationId);
    if (!sinks) this.#sinks.set(conversationId, (sinks = new Set()));
    sinks.add(sink);
    return () => sinks!.delete(sink);
  }

  hasSubscribers(conversationId: string): boolean {
    return (this.#sinks.get(conversationId)?.size ?? 0) > 0;
  }

  currentSeq(conversationId: string): number {
    return this.#journal(conversationId).seq;
  }

  streaming(conversationId: string): { id: string; text: string } | undefined {
    return this.#journal(conversationId).streaming;
  }

  /** The events after `sinceSeq`, or null when the window no longer reaches back that far. */
  since(conversationId: string, sinceSeq: number): PanelEvent[] | null {
    const journal = this.#journal(conversationId);
    if (sinceSeq >= journal.seq) return [];
    const first = journal.events[0]?.seq;
    if (first === undefined || first > sinceSeq + 1) return null;
    return journal.events.filter(e => e.seq > sinceSeq);
  }

  emit(conversationId: string, body: PanelEventBody): void {
    const journal = this.#journal(conversationId);
    if (body.type === 'message_update') {
      journal.streaming = { id: body.id, text: body.text };
      // Coalesced: the latest text goes out at most every 50 ms.
      journal.pendingUpdate ??= setTimeout(() => {
        journal.pendingUpdate = undefined;
        const current = journal.streaming;
        if (current) this.#send(conversationId, { type: 'message_update', id: current.id, text: current.text }, false);
      }, COALESCE_MS);
      return;
    }
    if (body.type === 'message_start') journal.streaming = { id: body.id, text: '' };
    if (body.type === 'message_end' || body.type === 'agent_end') {
      clearTimeout(journal.pendingUpdate);
      journal.pendingUpdate = undefined;
      journal.streaming = undefined;
    }
    this.#send(conversationId, body, body.type !== 'snapshot' && body.type !== 'history' && body.type !== 'export');
  }

  /** Sends to one sink only (a snapshot or a replay for a panel that just subscribed). */
  direct(conversationId: string | null, sink: Sink, body: PanelEventBody): void {
    const seq = conversationId ? this.#journal(conversationId).seq : 0;
    sink({ ...body, seq, conversationId } as PanelEvent);
  }

  #send(conversationId: string, body: PanelEventBody, keep: boolean): void {
    const journal = this.#journal(conversationId);
    const event = { ...body, seq: ++journal.seq, conversationId } as PanelEvent;
    if (keep) {
      journal.events.push(event);
      if (journal.events.length > WINDOW) journal.events.splice(0, journal.events.length - WINDOW);
      journal.persistTimer ??= setTimeout(() => {
        journal.persistTimer = undefined;
        void sessionStorage()
          ?.set({ [`nb.journal.${conversationId}`]: { seq: journal.seq, events: journal.events } })
          .catch(() => undefined);
      }, PERSIST_MS);
    }
    for (const sink of this.#sinks.get(conversationId) ?? []) {
      try {
        sink(event);
      } catch {
        // A panel that closed mid-send.
      }
    }
  }

  forget(conversationId: string): void {
    const journal = this.#journals.get(conversationId);
    clearTimeout(journal?.pendingUpdate);
    clearTimeout(journal?.persistTimer);
    this.#journals.delete(conversationId);
    void sessionStorage()
      ?.remove(`nb.journal.${conversationId}`)
      .catch(() => undefined);
  }
}
