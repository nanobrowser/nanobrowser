// Scenarios for a wait on a tab the user unshares and for the deadline of a navigation. Each reproduces a reported
// case in Chrome and checks it is closed; the unit tests in controller.test.ts cover the same two cases with mocked
// attachments.
import type { Result } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineScenario, outcome } from './registry';

const PAGE = `${FIXTURE_ORIGIN}/d-wait-and-navigate-deadlines.html`;
const err = (r: Result | 'pending') => (r === 'pending' ? 'still running' : r.ok ? 'ok' : `${r.error?.code}`);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** The call's result, or 'pending' when it has not finished within `ms`. */
const within = (call: Promise<Result>, ms: number) => Promise.race([call, sleep(ms).then(() => 'pending' as const)]);

/** Whether a debugger (this extension's) is attached to the tab. */
async function debuggerAttached(tabId: number): Promise<boolean> {
  const targets = await chrome.debugger.getTargets();
  return targets.some(t => t.tabId === tabId && t.attached);
}

defineScenario({
  id: 'L5-unshare-during-wait',
  set: 'D',
  title: 'unshare the tab while a wait for a URL polls it',
  covers: 'a call in progress does not attach again to a tab the user unshared',
  async run(ctx) {
    const tabId = await ctx.open(PAGE);
    const waiting = ctx.call('wait', { url: '/never', timeoutMs: 2_000 });
    await sleep(400);
    await ctx.session.unshareTab(tabId);
    const r = await waiting;
    const attached = await debuggerAttached(tabId);
    return outcome(
      'the wait fails with TAB_NOT_IN_SESSION; no debugger on the tab',
      `wait ${err(r)}; debugger ${attached ? 'attached' : 'detached'}`,
      !r.ok && r.error?.code === 'TAB_NOT_IN_SESSION' && !attached,
    );
  },
});

defineScenario({
  id: 'L5-navigate-deadline',
  set: 'D',
  title: 'navigate with timeoutMs 0, then 2000, to a page whose script opens an alert before DOMContentLoaded',
  covers: 'a navigation always has a deadline, so the dialog it waits behind can be handled',
  async run(ctx) {
    const tabId = await ctx.open(PAGE);
    const zero = await within(ctx.call('navigate', { url: `${PAGE}?alert`, timeoutMs: 0 }), 6_000);
    if (zero === 'pending') {
      return outcome(
        'timeoutMs 0 refused',
        'navigate with timeoutMs 0 still running after 6 s, behind the alert',
        false,
      );
    }
    const stayed = (await chrome.tabs.get(tabId)).url === PAGE;
    const timed = await within(ctx.call('navigate', { url: `${PAGE}?alert`, timeoutMs: 2_000 }), 6_000);
    const dialog = timed !== 'pending' && !!timed.pending?.some(p => p.kind === 'dialog');
    const handled = await ctx.call('handle_dialog', { accept: true });
    const loaded = await ctx.call('wait', { text: 'Loaded after the script', timeoutMs: 3_000 });
    return outcome(
      'timeoutMs 0 refused (nothing sent); timeoutMs 2000 times out with the dialog pending; handled; page loads',
      `0: ${err(zero)}, ${stayed ? 'stayed' : 'moved'}; 2000: ${err(timed)}, dialog ${dialog ? 'pending' : 'none'}; handle_dialog ${err(handled)}; wait ${err(loaded)}`,
      zero.error?.code === 'INVALID_ARGUMENT' &&
        stayed &&
        timed !== 'pending' &&
        timed.error?.code === 'TIMEOUT' &&
        dialog &&
        handled.ok &&
        loaded.ok,
    );
  },
});
