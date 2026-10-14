// Analytics in a real worker, against the fixture server's fake PostHog endpoint (an autorun build sends only there):
// the ping once a day, nothing while a switch is off, turning usage counts off clears them, a failed send tried again
// and dropped after three, a real install's week, Delete everything keeping the switches, an old version's "off"
// applied and a switch turned off before the first panel open. What the check changes is put back at the end.
import {
  ANALYTICS_COUNTS_KEY,
  ANALYTICS_KEY,
  ANALYTICS_KEYS,
  DEFAULT_SETTINGS,
  UPGRADE_KEY,
  settingsStorage,
} from '@src/store';
import type { AnalyticsState, SentEvent, Settings } from '@src/store';
import {
  count,
  deleteKeepingChoices,
  recordInstall,
  restartAnalytics,
  sendDue,
  analyticsReady,
} from '@src/extension/analytics';
import { dayOf, isoWeek } from '@src/extension/analytics-payload';
import { defineCheck } from './registry';
import { sleep } from './helpers';

const FAKE = 'http://localhost:8787/__posthog';
const KEYS = [...ANALYTICS_KEYS, 'nb.settings', UPGRADE_KEY];

const received = async () => (await (await fetch(`${FAKE}/events`)).json()) as Array<SentEvent & { api_key: string }>;
const reset = (fail = 0) => fetch(`${FAKE}/reset`, { method: 'POST', body: JSON.stringify({ fail }) });
const state = async () => (await chrome.storage.local.get(ANALYTICS_KEY))[ANALYTICS_KEY] as AnalyticsState | undefined;
const setSwitches = (analyticsPing: boolean, analyticsStats: boolean) =>
  settingsStorage.set(s => ({ ...s, analyticsPing, analyticsStats }));
const named = <T extends SentEvent>(events: T[], name: string) => events.filter(e => e.event === name);
const yesterday = () => dayOf(new Date(Date.now() - 86_400_000));

defineCheck({
  name: 'analytics',
  title: 'Analytics',
  description: 'The ping, the usage counts, retries, the start-up step and Delete everything.',
  async run() {
    const before = await chrome.storage.local.get(KEYS);
    try {
      await chrome.storage.local.remove(KEYS);
      restartAnalytics();
      await analyticsReady();
      await reset();

      // A real install: this week, and the first ping says it is new. A second trigger the same day sends nothing.
      await recordInstall();
      await sendDue('panel');
      await sendDue('run');
      const first = await received();
      const ping = named(first, 'active_day')[0];
      const pingOnce = named(first, 'active_day').length === 1;
      const installWeek = ping?.properties.install_week === isoWeek(new Date()) && ping.properties.new_install === true;
      const personless =
        ping?.properties.$process_person_profile === false &&
        ping.properties.$geoip_disable === true &&
        ping.api_key === 'autorun';

      // Usage counts: on by default, so today's run is counted; yesterday's counts go out as one day.
      await count('runs.started');
      const countedByDefault =
        (
          (await chrome.storage.local.get(ANALYTICS_COUNTS_KEY))[ANALYTICS_COUNTS_KEY] as
            Record<string, Record<string, number>> | undefined
        )?.[dayOf(new Date())]?.['runs.started'] === 1;
      await chrome.storage.local.set({ [ANALYTICS_COUNTS_KEY]: { [yesterday()]: { 'runs.started': 2 } } });
      await reset();
      await sendDue('panel');
      const usage = named(await received(), 'usage_day');
      const usageSent = usage.length === 1 && usage[0].properties['runs.started'] === 2;

      // Turning usage counts off clears what was counted.
      await count('runs.started');
      const countedToday = !!(await chrome.storage.local.get(ANALYTICS_COUNTS_KEY))[ANALYTICS_COUNTS_KEY];
      await setSwitches(true, false);
      await sleep(300);
      const cleared = !(await chrome.storage.local.get(ANALYTICS_COUNTS_KEY))[ANALYTICS_COUNTS_KEY];

      // The ping off: nothing is sent, even on a new day.
      await setSwitches(false, false);
      await chrome.storage.local.set({ [ANALYTICS_KEY]: { ...(await state()), lastPing: yesterday() } });
      await reset();
      await sendDue('panel');
      const nothingWhenOff = (await received()).length === 0;

      // A failed send is tried at the next trigger, and dropped after three tries.
      await setSwitches(true, false);
      await reset(2);
      await sendDue('panel');
      await sendDue('panel');
      await sendDue('panel');
      const retried = named(await received(), 'active_day').length === 1;
      await chrome.storage.local.set({ [ANALYTICS_KEY]: { ...(await state()), lastPing: yesterday() } });
      await reset(3);
      for (let i = 0; i < 4; i++) await sendDue('panel');
      const dropped = (await received()).length === 0;

      // Delete everything keeps the switches, and the install week becomes unknown.
      await setSwitches(false, true);
      await deleteKeepingChoices(() => chrome.storage.local.remove('nb.settings'));
      const kept = (await settingsStorage.get()) as Settings;
      const afterDelete = await state();
      const keptSwitches = kept.analyticsPing === false && kept.analyticsStats === true;
      const unknownWeek = afterDelete?.installWeek === 'unknown' && !afterDelete.newInstall;

      // An update from v0.2 with its switch off: both off, nothing sent.
      await chrome.storage.local.remove([...ANALYTICS_KEYS, 'nb.settings']);
      await chrome.storage.local.set({
        [UPGRADE_KEY]: { at: '', favorites: 0, blockedSites: 0, skippedSites: 0, allowList: 0, analytics: false },
      });
      restartAnalytics();
      await analyticsReady();
      const v02 = (await settingsStorage.get()) as Settings;
      await reset();
      await sendDue('panel');
      const v02Off = !v02.analyticsPing && !v02.analyticsStats && (await received()).length === 0;
      const v02Week = (await state())?.installWeek === 'v0.2';

      // A switch the user turned off before the first panel open stays off at the next worker start.
      await setSwitches(false, false);
      await chrome.storage.local.set({
        [UPGRADE_KEY]: { ...((await chrome.storage.local.get(UPGRADE_KEY))[UPGRADE_KEY] as object), analytics: true },
      });
      restartAnalytics();
      await analyticsReady();
      const stayedOff = !((await settingsStorage.get()) as Settings).analyticsPing;

      const result = {
        pingOnce,
        installWeek,
        personless,
        countedByDefault,
        usageSent,
        countedToday,
        cleared,
        nothingWhenOff,
        retried,
        dropped,
        keptSwitches,
        unknownWeek,
        v02Off,
        v02Week,
        stayedOff,
      };
      if (Object.values(result).includes(false)) throw new Error(JSON.stringify(result));
      // What `navigator.userAgentData` gave the worker, for the record.
      return {
        ...result,
        browser: ping?.properties.browser,
        brands: (navigator as unknown as { userAgentData?: { brands: unknown } }).userAgentData?.brands,
      };
    } finally {
      await chrome.storage.local.remove(KEYS);
      await chrome.storage.local.set({ ...before, 'nb.settings': before['nb.settings'] ?? DEFAULT_SETTINGS });
      restartAnalytics();
      await reset();
    }
  },
});
