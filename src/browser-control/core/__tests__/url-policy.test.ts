import { describe, expect, it } from 'vitest';
import {
  allows,
  combinePolicies,
  hasLists,
  isBlockedSite,
  isUrlAllowed,
  normalizePolicy,
  siteKey,
} from '../url-policy';

describe('isUrlAllowed (Nanobrowser rules)', () => {
  it('always blocks dangerous schemes and the Web Store, even with empty lists', () => {
    for (const url of [
      'chrome://settings',
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'https://chromewebstore.google.com/x',
      'wss://x',
    ]) {
      expect(isUrlAllowed(url, [], [])).toBe(false);
    }
    expect(isUrlAllowed('', [], [])).toBe(false);
    expect(isUrlAllowed('https://example.com', [], [])).toBe(true);
  });

  it('applies the deny list to a domain and its subdomains', () => {
    expect(isUrlAllowed('https://evil.test/x', [], ['evil.test'])).toBe(false);
    expect(isUrlAllowed('https://a.evil.test/x', [], ['evil.test'])).toBe(false);
    expect(isUrlAllowed('https://notevil.test/x', [], ['evil.test'])).toBe(true);
  });

  it('reads a host written with a trailing dot as the same host', () => {
    expect(isUrlAllowed('https://evil.test./x', [], ['evil.test'])).toBe(false);
    expect(isUrlAllowed('https://a.evil.test./x', [], ['evil.test'])).toBe(false);
    expect(isUrlAllowed('https://good.test./a', ['good.test'], [])).toBe(true);
    // The same for an entry the user wrote with the dot.
    const dotted = normalizePolicy({ allow: [], deny: ['https://evil.test./'] });
    expect(dotted.deny).toEqual(['evil.test']);
    expect(isUrlAllowed('https://evil.test./checkout', dotted.allow, dotted.deny)).toBe(false);
    expect(isUrlAllowed('https://evil.test/checkout', dotted.allow, dotted.deny)).toBe(false);
  });

  it('allows only listed domains once an allow list exists', () => {
    expect(isUrlAllowed('https://good.test/a', ['good.test'], [])).toBe(true);
    expect(isUrlAllowed('https://other.test/a', ['good.test'], [])).toBe(false);
    expect(isUrlAllowed('about:blank', ['good.test'], [])).toBe(true);
  });

  it('matches exact URLs before domains', () => {
    expect(isUrlAllowed('https://good.test/blocked', ['good.test'], ['good.test/blocked'])).toBe(false);
    // An exact URL entry is checked before domain entries, so it wins over a domain deny.
    expect(isUrlAllowed('https://bad.test/ok', ['bad.test/ok'], ['bad.test'])).toBe(true);
  });

  it('judges a blob: URL by the origin that created it', () => {
    expect(isUrlAllowed('blob:https://evil.test/1234-uuid', [], ['evil.test'])).toBe(false);
    expect(isUrlAllowed('blob:https://good.test/1234-uuid', ['good.test'], [])).toBe(true);
  });

  it('handles the fixture hosts, ports included', () => {
    expect(isUrlAllowed('http://127.0.0.1:8787/x', [], ['127.0.0.1'])).toBe(false);
    expect(isUrlAllowed('http://localhost:8787/x', [], ['127.0.0.1'])).toBe(true);
  });
});

describe('policy helpers', () => {
  it('normalises entries', () => {
    expect(normalizePolicy({ allow: [' HTTPS://Example.com/ ', ''], deny: ['a.test', 'a.test'] })).toEqual({
      allow: ['example.com'],
      deny: ['a.test'],
      blocked: [],
    });
  });

  it('combines policies most restrictively', () => {
    const allowed = combinePolicies([
      { allow: [], deny: ['a.test'] },
      { allow: ['a.test', 'b.test'], deny: [] },
    ]);
    expect([allowed('https://a.test'), allowed('https://b.test'), allowed('https://c.test')]).toEqual([
      false,
      true,
      false,
    ]);
  });
});

describe('blocked sites', () => {
  const policy = normalizePolicy({
    allow: [],
    deny: [],
    blocked: ['Example.com', 'https://www.shop.example/', 'localhost:3000'],
  });

  it('keys each row with siteOf', () => {
    expect(policy.blocked).toEqual(['example.com', 'shop.example', 'localhost:3000']);
  });

  it.each([
    ['https://example.com/x', false],
    ['http://www.example.com./y', false],
    ['https://mail.example.com/', true],
    ['https://shop.example/cart?x=1', false],
    ['http://localhost:3000/path', false],
    ['http://localhost:8080/path', true],
    ['blob:https://example.com/uuid', false],
  ])('%s allowed: %s', (url, allowed) => {
    expect(allows(policy, url)).toBe(allowed);
    expect(isBlockedSite(url, policy.blocked)).toBe(!allowed);
  });

  it('counts as a list for layer 3', () => {
    expect(hasLists(policy)).toBe(true);
    expect(siteKey('  WWW.Example.COM ')).toBe('example.com');
  });
});
