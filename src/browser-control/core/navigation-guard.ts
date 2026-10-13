// Layers 3 and 4 of the navigation policy, per attached tab.
//  3. Block at the network: with a list configured, Fetch pauses every document request of the main frame at the
//     request stage, redirect hops included; a disallowed one is failed with `Aborted` before it is sent, so the page
//     stays (BlockedByClient would commit an error page).
//  4. Detect afterwards: a committed main-frame URL that is not allowed (a back-forward cache restore issues no
//     request) is replaced with about:blank and reported.
import type { TabAttachment } from './ports';
import { quote } from './text';

export const SAFE_URL = 'about:blank';

export interface PolicyEvent {
  /** 2: a tab the page opened for a disallowed URL; 3: blocked at the network; 4: detected after commit. */
  layer: 2 | 3 | 4;
  url: string;
  at: number;
  detail: string;
}

interface RequestPaused {
  requestId: string;
  request: { url: string; method: string };
  frameId: string;
  resourceType: string;
}

export class NavigationGuard {
  #events: PolicyEvent[] = [];
  #intercepting = false;
  #offs: Array<() => void> = [];

  constructor(
    private readonly attachment: TabAttachment,
    /** Whether a URL is allowed for the main frame of this tab, under every session that holds it. */
    private readonly allowed: (url: string) => boolean,
    /** Whether layer 3 must run: a list is configured in a session that holds the tab. */
    private readonly listsConfigured: () => boolean,
  ) {
    const { cdp, topology } = attachment;
    this.#offs.push(
      cdp.on('Fetch.requestPaused', params => void this.#onPaused(params as RequestPaused), { sessionId: undefined }),
      topology.onFrameEvent(event => {
        if (event.type === 'navigated' && event.frameId === topology.mainFrameId()) void this.#onCommitted(event.url);
      }),
    );
  }

  get intercepting(): boolean {
    return this.#intercepting;
  }

  /** Switches layer 3 on or off to match the policy. */
  async sync(): Promise<void> {
    const want = this.listsConfigured();
    if (want === this.#intercepting) return;
    if (want) {
      await this.attachment.cdp.send(undefined, 'Fetch.enable', {
        patterns: [{ resourceType: 'Document', requestStage: 'Request' }],
      });
    } else {
      await this.attachment.cdp.send(undefined, 'Fetch.disable').catch(() => undefined);
    }
    this.#intercepting = want;
  }

  /** Records an event found elsewhere (a tab the page opened), reported with the others. */
  report(event: PolicyEvent): void {
    this.#events.push(event);
  }

  /** Events since the last drain, oldest first. */
  drain(): PolicyEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  dispose(): void {
    this.#offs.forEach(off => off());
  }

  async #onPaused(event: RequestPaused): Promise<void> {
    const { cdp, topology } = this.attachment;
    const mainFrame = event.frameId === topology.mainFrameId();
    let allow = true;
    try {
      allow = !mainFrame || event.resourceType !== 'Document' || this.allowed(event.request.url);
    } catch {
      allow = false; // fail closed
    }
    try {
      if (allow) {
        await cdp.send(undefined, 'Fetch.continueRequest', { requestId: event.requestId });
      } else {
        this.#events.push({
          layer: 3,
          url: event.request.url,
          at: Date.now(),
          detail: `The request to ${quote(event.request.url)} was stopped before it was sent.`,
        });
        await cdp.send(undefined, 'Fetch.failRequest', { requestId: event.requestId, errorReason: 'Aborted' });
      }
    } catch {
      // The request went away (navigation replaced, tab closed); nothing to answer.
    }
  }

  async #onCommitted(url: string): Promise<void> {
    if (!url || url === SAFE_URL || this.allowed(url)) return;
    this.#events.push({
      layer: 4,
      url,
      at: Date.now(),
      detail: `${quote(url)} was loaded although it is not allowed; the tab was sent to ${SAFE_URL}.`,
    });
    await this.attachment.cdp.send(undefined, 'Page.navigate', { url: SAFE_URL }).catch(() => undefined);
  }
}
