import { describe, expect, it } from 'vitest';
import {
  NO_ANSWER,
  NO_USAGE,
  afterFinishedRun,
  answerRating,
  localDay,
  ratingDue,
  ratingShowsIn,
  ratingUrl,
} from '../rating';
import type { RatingUsage } from '../rating';

const at = (day: string, hour = 12) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`);

/** `n` finished runs on each of the given days, in order. */
function runs(usage: RatingUsage, days: string[], n = 1): RatingUsage {
  for (const day of days) for (let i = 0; i < n; i++) usage = afterFinishedRun(usage, at(day), 'c1');
  return usage;
}

describe('the rating ask', () => {
  it('uses the local date', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('is due after 10 runs on 3 days of the last 7', () => {
    let usage = runs(NO_USAGE, ['2026-10-01'], 8);
    usage = runs(usage, ['2026-10-03']);
    expect(ratingDue(usage, NO_ANSWER, at('2026-10-03'))).toBe(false);
    usage = runs(usage, ['2026-10-07']);
    expect(usage).toMatchObject({ runs: 10, days: ['2026-10-01', '2026-10-03', '2026-10-07'] });
    expect(ratingDue(usage, NO_ANSWER, at('2026-10-07'))).toBe(true);
  });

  it('is not due for 10 runs on one day', () => {
    expect(ratingDue(runs(NO_USAGE, ['2026-10-01'], 12), NO_ANSWER, at('2026-10-01'))).toBe(false);
  });

  it('forgets days older than the last 7', () => {
    const usage = runs(NO_USAGE, ['2026-10-01', '2026-10-02', '2026-10-03'], 4);
    expect(ratingDue(usage, NO_ANSWER, at('2026-10-07'))).toBe(true);
    expect(ratingDue(usage, NO_ANSWER, at('2026-10-09'))).toBe(false);
    expect(runs(usage, ['2026-10-09']).days).toEqual(['2026-10-03', '2026-10-09']);
  });

  it('asks again 30 days after the first Not now, and never after the second', () => {
    let usage = runs(NO_USAGE, ['2026-10-01', '2026-10-02', '2026-10-03'], 4);
    let answer = answerRating(NO_ANSWER, 'later', at('2026-10-03'));
    expect(answer).toMatchObject({ later: 1, done: false, notBefore: '2026-11-02' });
    expect(ratingDue(usage, answer, at('2026-10-03'))).toBe(false);
    usage = runs(usage, ['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(ratingDue(usage, answer, at('2026-11-01'))).toBe(false);
    expect(ratingDue(usage, answer, at('2026-11-02'))).toBe(true);
    answer = answerRating(answer, 'later', at('2026-11-02'));
    expect(answer.done).toBe(true);
    usage = runs(usage, ['2026-12-10', '2026-12-11', '2026-12-12']);
    expect(ratingDue(usage, answer, at('2026-12-12'))).toBe(false);
  });

  it('never asks again after Rate', () => {
    const usage = runs(NO_USAGE, ['2026-10-01', '2026-10-02', '2026-10-03'], 4);
    const answer = answerRating(NO_ANSWER, 'rate', at('2026-10-03'));
    expect(answer.done).toBe(true);
    expect(ratingDue(runs(usage, ['2026-12-10', '2026-12-11', '2026-12-12']), answer, at('2026-12-12'))).toBe(false);
  });

  it('shows only in the panel of the run that just finished, if it was open then', () => {
    const usage = runs(NO_USAGE, ['2026-10-01', '2026-10-02', '2026-10-03'], 4);
    const ended = at('2026-10-03').getTime();
    expect(usage.last).toEqual({ conversationId: 'c1', at: ended });
    const now = at('2026-10-03', 13);
    expect(ratingShowsIn(usage, NO_ANSWER, 'c1', ended - 60_000, now)).toBe(true);
    expect(ratingShowsIn(usage, NO_ANSWER, 'c2', ended - 60_000, now)).toBe(false);
    expect(ratingShowsIn(usage, NO_ANSWER, null, ended - 60_000, now)).toBe(false);
    expect(ratingShowsIn(usage, NO_ANSWER, 'c1', ended + 60_000, now)).toBe(false);
    expect(ratingShowsIn(usage, answerRating(NO_ANSWER, 'later', now), 'c1', ended - 60_000, now)).toBe(false);
  });

  it('shows none after a later run of the conversation began', () => {
    const usage = runs(NO_USAGE, ['2026-10-01', '2026-10-02', '2026-10-03'], 4);
    const ended = at('2026-10-03').getTime();
    expect(ratingShowsIn(usage, NO_ANSWER, 'c1', ended + 1_000, at('2026-10-03', 13))).toBe(false);
  });

  it('shows again after Maybe later only for a run that finished after the answer', () => {
    const usage = runs(NO_USAGE, ['2026-10-01', '2026-10-02', '2026-10-03'], 4);
    const answer = { ...answerRating(NO_ANSWER, 'later', at('2026-10-03', 13)), notBefore: '2020-01-01' };
    expect(ratingShowsIn(usage, answer, 'c1', 0, at('2026-10-03', 14))).toBe(false);
    expect(ratingShowsIn(runs(usage, ['2026-10-04']), answer, 'c1', 0, at('2026-10-04', 13))).toBe(true);
  });

  it("opens Edge's store in Edge and the Chrome Web Store elsewhere", () => {
    const chrome = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    expect(ratingUrl(chrome)).toContain('chromewebstore.google.com/detail/nanobrowser-ai-web-agent/');
    expect(ratingUrl(`${chrome} Edg/141.0.0.0`)).toContain('microsoftedge.microsoft.com/addons/detail/');
  });
});
