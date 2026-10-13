import { describe, expect, it } from 'vitest';
import { PromptBroker } from '../prompt-broker';
import type { PanelEventBody } from '@src/ui/protocol';

function broker() {
  const events: Array<[string, PanelEventBody]> = [];
  const waiting: Array<[string, number]> = [];
  const remembered: string[] = [];
  const b = new PromptBroker({
    emit: (c, e) => events.push([c, e]),
    waiting: (c, open) => waiting.push([c, open.length]),
    conversationOf: tabId => (tabId === 7 ? 'c1' : null),
    tabUrl: async () => 'https://www.mail.example.com/inbox',
    remember: async site => void remembered.push(site),
  });
  return { b, events, waiting, remembered };
}

const request = {
  id: 'x',
  tabId: 7,
  category: 'submit' as const,
  action: 'click',
  target: 'button «Send»',
  origin: 'https://mail.example.com',
  site: 'mail.example.com',
  reason: 'it submits its form',
  canRemember: true,
};

describe('PromptBroker', () => {
  it('turns a write confirmation into a card of the tab’s conversation, and stores Allow on this site', async () => {
    const { b, events, waiting, remembered } = broker();
    const pending = b.userPrompt().confirm(request, new AbortController().signal);
    const open = events.find(([, e]) => e.type === 'prompt_open')![1] as Extract<
      PanelEventBody,
      { type: 'prompt_open' }
    >;
    expect(open.prompt).toMatchObject({
      kind: 'write-card',
      conversationId: 'c1',
      tabId: 7,
      data: { site: 'mail.example.com', canRemember: true },
    });
    expect(await b.answer(open.prompt.id, 'approve-remember')).toBe(true);
    expect(await pending).toBe('approve-remember');
    expect(remembered).toEqual(['mail.example.com']);
    expect(waiting).toEqual([
      ['c1', 1],
      ['c1', 0],
    ]);
    // A late answer has no effect.
    expect(await b.answer(open.prompt.id, 'decline')).toBe(false);
  });

  it('withdraws a card when its wait ends, and declines', async () => {
    const { b, events } = broker();
    const abort = new AbortController();
    const pending = b.userPrompt().confirm(request, abort.signal);
    abort.abort();
    expect(await pending).toBe('decline');
    expect(events.some(([, e]) => e.type === 'prompt_closed' && e.outcome === 'withdrawn')).toBe(true);
    expect(b.promptsOf('c1')).toEqual([]);
  });

  it('names the tab’s real site on an ask_user card', async () => {
    const { b, events } = broker();
    void b
      .userPrompt()
      .ask(
        { id: 'a', tabId: 7, kind: 'takeover', message: 'Please solve the CAPTCHA', origin: '' },
        new AbortController().signal,
      );
    await new Promise(r => setTimeout(r, 0));
    const open = events.find(([, e]) => e.type === 'prompt_open')![1] as Extract<
      PanelEventBody,
      { type: 'prompt_open' }
    >;
    expect(open.prompt).toMatchObject({
      kind: 'ask-takeover',
      data: { site: 'mail.example.com', message: 'Please solve the CAPTCHA' },
    });
  });

  it('keeps a card open while its check says the answer cannot be taken yet', async () => {
    const { b } = broker();
    let dialogOpen = true;
    const pending = b.open<string>('c1', 'handover', { reason: 'prompt' }, new AbortController().signal, {
      check: async () => (dialogOpen ? 'dialog-waiting' : null),
    });
    const id = b.promptsOf('c1')[0].id;
    expect(await b.answer(id, 'given-back')).toBe(false);
    expect(b.promptsOf('c1')[0].data.notice).toBe('dialog-waiting');
    dialogOpen = false;
    expect(await b.answer(id, 'given-back')).toBe(true);
    expect(await pending).toBe('given-back');
  });

  it('declines a prompt for a tab no conversation owns', async () => {
    const { b } = broker();
    expect(await b.userPrompt().confirm({ ...request, tabId: 99 }, new AbortController().signal)).toBe('decline');
  });
});
