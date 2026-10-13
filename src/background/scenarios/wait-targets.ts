// Scenarios for waits on semantic targets and cancelled waits. Each reproduces a reported case in Chrome and checks it
// is closed; controller.test.ts covers the cancelled wait with mocked attachments as well.
import type { Result } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineScenario, outcome } from './registry';

const PAGE = `${FIXTURE_ORIGIN}/d-wait-targets.html`;
const err = (r: Result) => (r.ok ? 'ok' : `${r.error?.code}`);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const CONTINUE = { role: 'button', name: 'Continue' };

defineScenario({
  id: 'L6-wait-target-appears',
  set: 'D',
  title: 'wait for a button the page renders 1.2 s after a click, right after a snapshot',
  covers: 'a semantic target that is not there yet is waited for, with a fresh capture each poll',
  async run(ctx) {
    await ctx.open(PAGE);
    const start = await ctx.call('click', { target: { role: 'button', name: 'Start' } });
    // A capture just before the wait: the page then changes without an action, within the 2 s a capture is reused.
    const snap = await ctx.call('snapshot');
    const before = snap.text.includes('"Continue"');
    const t0 = performance.now();
    const appeared = await ctx.call('wait', { target: CONTINUE, timeoutMs: 1_500 });
    const ms = Math.round(performance.now() - t0);
    const never = await ctx.call('wait', { target: { role: 'button', name: 'Never' }, timeoutMs: 400 });
    return outcome(
      '"Continue" not in the snapshot; the wait is met once it renders; a target that never renders is TIMEOUT',
      `click ${err(start)}; in snapshot ${before}; wait ${err(appeared)} after ${ms} ms (${appeared.error?.message ?? appeared.text}); never ${err(never)} (${never.error?.message})`,
      start.ok &&
        !before &&
        appeared.ok &&
        never.error?.code === 'TIMEOUT' &&
        /not in the page/.test(never.error.message),
    );
  },
});

defineScenario({
  id: 'L6-wait-target-absent',
  set: 'D',
  title: 'wait for an absent button to be hidden or detached, and for a button the page removes',
  covers: 'no match is absence, so "hidden" and "detached" are met by a missing target',
  async run(ctx) {
    await ctx.open(PAGE);
    const hidden = await ctx.call('wait', { target: CONTINUE, state: 'hidden', timeoutMs: 1_000 });
    const detached = await ctx.call('wait', { target: CONTINUE, state: 'detached', timeoutMs: 1_000 });
    const start = await ctx.call('click', { target: { role: 'button', name: 'Start' } });
    const gone = await ctx.call('wait', {
      target: { role: 'button', name: 'Old step' },
      state: 'detached',
      timeoutMs: 3_000,
    });
    return outcome(
      'hidden and detached met at once for the absent "Continue"; "Old step" detached once removed',
      `hidden ${err(hidden)}; detached ${err(detached)}; click ${err(start)}; old step ${err(gone)} (${gone.error?.message ?? gone.text})`,
      hidden.ok && detached.ok && start.ok && gone.ok,
    );
  },
});

defineScenario({
  id: 'L6-cancel-wait',
  set: 'D',
  title: 'cancel a wait for a URL and a fixed-time wait 300 ms in',
  covers: 'a cancelled wait ends at once and frees the tab for the next call',
  async run(ctx) {
    await ctx.open(PAGE);
    const polling = new AbortController();
    const t0 = performance.now();
    const first = ctx.session.call('wait', { url: '/never', timeoutMs: 4_000 }, { signal: polling.signal });
    await sleep(300);
    polling.abort();
    // Queued behind the first call on the tab's lock: it runs as soon as the cancelled wait lets go.
    const next = await ctx.call('wait', { text: 'Wait targets', timeoutMs: 1_000 });
    const nextMs = Math.round(performance.now() - t0);
    const polled = await first;
    const timed = new AbortController();
    setTimeout(() => timed.abort(), 300);
    const t1 = performance.now();
    const fixed = await ctx.session.call('wait', { ms: 3_000 }, { signal: timed.signal });
    const fixedMs = Math.round(performance.now() - t1);
    return outcome(
      'both CANCELLED (delivered false) within about half a second; the next call runs at once',
      `url wait ${err(polled)}/${polled.error?.delivered}; next ${err(next)} done ${nextMs} ms in; fixed wait ${err(fixed)}/${fixed.error?.delivered} after ${fixedMs} ms`,
      polled.error?.code === 'CANCELLED' &&
        polled.error.delivered === false &&
        next.ok &&
        nextMs < 1_500 &&
        fixed.error?.code === 'CANCELLED' &&
        fixed.error.delivered === false &&
        fixedMs < 1_000,
    );
  },
});
