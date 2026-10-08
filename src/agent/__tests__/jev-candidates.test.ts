import { expect, it } from 'vitest';
import { buildJevCandidates } from '../jev-candidates';

it('offers only bounded actions on visible observed refs, without new text or URLs', () => {
  const candidates = buildJevCandidates({
    tabId: 1,
    rev: 3,
    url: 'https://example.com/',
    title: 'Example',
    complete: true,
    outline:
      '[e1] button "Continue"\n[e2] link "Details"\n[e3] textbox "Password"\n[e4] button "Disabled" (disabled)\n[e5] button "Hidden" (hidden)',
  });
  expect(candidates.map(candidate => candidate.action)).toEqual([
    { name: 'click', parameters: { tabId: 1, target: { ref: 'e1' } } },
    { name: 'click', parameters: { tabId: 1, target: { ref: 'e2' } } },
  ]);
});

it('uses adapter-compatible candidate IDs and caps candidate enumeration', () => {
  const page = {
    tabId: 1,
    rev: 1,
    url: 'https://example.com/',
    title: '',
    complete: true,
    outline: Array.from({ length: 80 }, (_, index) => `[e${index}] button "Choice ${index}"`).join('\n'),
  };
  const candidates = buildJevCandidates(page);
  expect(candidates).toHaveLength(36);
  expect(candidates.every(candidate => /^[a-zA-Z0-9_-]{1,80}$/.test(candidate.id))).toBe(true);
  expect(buildJevCandidates({ ...page, complete: false })).toEqual([]);
});
