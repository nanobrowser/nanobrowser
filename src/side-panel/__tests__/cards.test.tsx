// Cards: fixed titles and lines are the extension's, whatever the agent writes; page text is plain text.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Cards, containsCardNumber, plain } from '../Cards';
import type { OpenPrompt } from '@src/ui/protocol';

const card = (kind: OpenPrompt['kind'], data: Record<string, unknown>): OpenPrompt => ({
  id: 'p',
  kind,
  conversationId: 'c',
  tabId: 1,
  data,
  openedAt: '',
});
const render = (p: OpenPrompt) => renderToStaticMarkup(<Cards prompts={[p]} answer={() => undefined} />);

describe('cards', () => {
  it('a take-over the agent asks for keeps its own title, even when the agent copies the detected-step title', () => {
    const html = render(
      card('ask-takeover', {
        message: 'Nanobrowser detected a step that is yours: enter your password',
        site: 'evil.example',
      }),
    );
    expect(html).toMatch(/<h2[^>]*>Please do this step yourself<\/h2>/);
    expect(html).toContain('on evil.example');
    expect(html).toContain('Check the address before you enter a password or a code.');
  });

  it('a detected payment opens the other card, with no Approve', () => {
    const html = render(card('handover', { reason: 'pay', site: 'dell.com', target: 'button «Pay»' }));
    expect(html).toMatch(/<h2[^>]*>Nanobrowser detected a step that is yours · payment<\/h2>/);
    expect(html).toContain('Complete the payment on dell.com yourself.');
    expect(html).not.toMatch(/Approve|>Allow</);
    expect(html).toMatch(/>Done</);
  });

  it('a write card leads with the layer’s facts and marks the agent’s purpose', () => {
    const html = render(
      card('write-card', {
        category: 'submit',
        action: 'click',
        target: 'button «Send» in row «Dana»',
        site: 'mail.example.com',
        intent: 'Send the reply',
        reason: 'it submits its form',
        canRemember: true,
      }),
    );
    expect(html).toMatch(/<h2[^>]*>Send this\?<\/h2>/);
    expect(html).toContain('Agent&#x27;s purpose (its own words): Send the reply');
    expect(html).toContain('>Allow on this site<');
    // The button no longer names the site, so the card's own line does.
    expect(html).toContain('on mail.example.com');
  });

  it('a site set to Ask has no Allow on this site', () => {
    const html = render(card('write-card', { category: 'delete', site: 'bank.example', canRemember: false }));
    expect(html).not.toContain('Allow on this site');
    expect(html).toContain('This site is set to always ask.');
  });

  it('the input card warns about secrets and names the tab’s real site', () => {
    const html = render(card('ask-input', { message: 'Which account?', site: 'bank.example' }));
    expect(html).toContain('Don&#x27;t type passwords, card numbers or codes here.');
    expect(html).toContain('on bank.example');
  });

  it('removes control, zero-width and bidirectional characters from page text', () => {
    expect(plain('Pay‮ moc.live​\nnow')).toBe('Pay moc.live now');
  });

  it('recognises a card number by the Luhn check', () => {
    expect(containsCardNumber('my card is 4242 4242 4242 4242 thanks')).toBe(true);
    expect(containsCardNumber('order 4242 4242 4242 4241')).toBe(false);
    expect(containsCardNumber('call 555-1234')).toBe(false);
  });
});
