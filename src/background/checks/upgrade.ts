// The update from the old Nanobrowser, in a real browser. The old version's storage, a made-up copy, is written into
// chrome.storage.local, which is where an update to the same extension finds it, and the move runs as a worker start
// runs it, twice. Then the panel's What's new card (the quick start hidden under it), Got it, and Settings → Data's
// export and delete of the old conversations. What
// the check wrote is removed at the end, and what was there before is put back.
import old from '../../../fixtures/upgrade/old-storage.json';
import {
  OLD_CHATS_KEY,
  OLD_KEYS,
  UPGRADE_KEY,
  WHATS_NEW_KEY,
  deleteShortcut,
  isOldChatKey,
  listShortcuts,
} from '@src/store';
import type { UpgradeRecord } from '@src/store';
import { upgradeFromOldVersion } from '@src/extension/upgrade';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { panel } from './panel-chat';

const NB_KEYS = ['nb.providers', 'nb.keys', 'nb.settings', 'nb.siteRules', UPGRADE_KEY, WHATS_NEW_KEY];
const CARD = "What's new in Nanobrowser 0.3";
// The quick start's first fixed starter.
const STARTER = 'Summarize this page';

const options = (op: string, extra: Record<string, unknown> = {}) =>
  chrome.runtime.sendMessage({ nbTest: 'options', op, ...extra }) as Promise<{ ok: boolean; body?: string }>;

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 8000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < end) {
    await sleep(150);
    value = await read();
  }
  return value;
}

defineCheck({
  name: 'upgrade',
  title: 'Update from the old Nanobrowser',
  description: "The old version's data moved on a worker start, the panel's card, and the old conversations in Data.",
  async run() {
    // Everything the check touches is put back at the end, the old version's own data included, so it can also run on
    // a profile that was updated for real.
    const touched = (key: string) =>
      NB_KEYS.includes(key) || (OLD_KEYS as readonly string[]).includes(key) || isOldChatKey(key);
    const before = Object.fromEntries(Object.entries(await chrome.storage.local.get(null)).filter(([k]) => touched(k)));
    const shortcutsBefore = new Set((await listShortcuts()).map(s => s.id));
    const opened: number[] = [];
    try {
      await chrome.storage.local.remove(Object.keys(before));
      await chrome.storage.local.set(old);
      await upgradeFromOldVersion();
      const afterFirst = await chrome.storage.local.get(null);
      await upgradeFromOldVersion();
      const afterSecond = await chrome.storage.local.get(null);
      const secondRunChangedNothing = JSON.stringify(afterFirst) === JSON.stringify(afterSecond);
      const oldLeft = OLD_KEYS.filter(k => k in afterSecond);
      const chatsLeft = Object.keys(afterSecond).filter(isOldChatKey).sort();
      const record = afterSecond[UPGRADE_KEY] as UpgradeRecord;
      const shortcuts = (await listShortcuts()).filter(s => !shortcutsBefore.has(s.id)).map(s => s.name);

      // The panel's card.
      const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
      const view = await chrome.tabs.create({
        url: chrome.runtime.getURL(`/sidepanel.html#tab=${tab.id}`),
        active: true,
      });
      opened.push(tab.id!, view.id!);
      await waitForLoad(view.id!);
      // The Allow line shows while any of the optional permissions is missing.
      const allAllowed = await chrome.permissions.contains({
        permissions: ['tabGroups', 'notifications', 'downloads', 'downloads.open'],
      });
      // The line comes once the panel has read the permissions, so it is waited for too.
      const card = await until(
        () => panel(tab.id!, 'read'),
        r => !!r?.body?.includes(CARD) && (allAllowed || !!r.body.includes('Additional browser permissions')),
      );
      await sleep(400);
      const cardImage = await chrome.tabs.captureVisibleTab(view.windowId, { format: 'png' });
      await panel(tab.id!, 'click', { label: 'Got it' });
      const closed = await until(
        () => panel(tab.id!, 'read'),
        r => !r?.body?.includes(CARD) && !!r?.body?.includes(STARTER),
      );
      const dismissed = ((await chrome.storage.local.get(UPGRADE_KEY))[UPGRADE_KEY] as UpgradeRecord).dismissed;

      // Settings → Data.
      const page = await chrome.tabs.create({ url: chrome.runtime.getURL('/options.html#data'), active: true });
      opened.push(page.id!);
      await waitForLoad(page.id!);
      const data = await until(
        () => options('read'),
        r => !!r.body?.includes('Legacy conversations (v0.2)'),
      );
      // The export is an anchor's download, seen and removed again through chrome.downloads. A build without that
      // permission cannot see it, so the export is not clicked there, as the file would stay in Downloads.
      const canSeeDownloads = !!chrome.downloads;
      const exportStarted = Date.now();
      if (canSeeDownloads) await options('click', { label: 'Export as Markdown' });
      const download = canSeeDownloads
        ? await until(
            async () =>
              (await chrome.downloads.search({ filenameRegex: 'nanobrowser-v0.2-conversations-' })).find(
                d => new Date(d.startTime).getTime() >= exportStarted - 1000,
              ),
            d => !!d,
          )
        : undefined;
      await options('click', { label: 'Delete' });
      await sleep(200);
      await options('click', { label: 'Delete them now' });
      const gone = await until(
        async () => Object.keys(await chrome.storage.local.get(null)).filter(isOldChatKey),
        keys => !keys.length,
      );
      const dataAfter = (await options('read')).body ?? '';
      if (download) {
        await chrome.downloads.removeFile(download.id).catch(() => undefined);
        await chrome.downloads.erase({ id: download.id });
      }

      const ok =
        secondRunChangedNothing &&
        oldLeft.length === 0 &&
        chatsLeft.includes(OLD_CHATS_KEY) &&
        record?.favorites === 3 &&
        record.blockedSites === 3 &&
        shortcuts.includes('daily-news-digest') &&
        !!card?.body?.includes('Your saved prompts are already there') &&
        !!card?.body?.includes('Legacy conversations are not supported') &&
        // The sites are moved, but the card does not speak of them.
        !card?.body?.includes('sites') &&
        !!card?.body?.includes('Additional browser permissions') === !allAllowed &&
        !card?.body?.includes(STARTER) &&
        !closed?.body?.includes(CARD) &&
        !!closed?.body?.includes(STARTER) &&
        dismissed === true &&
        !!data.body?.includes('2 conversations') &&
        (!!download || !canSeeDownloads) &&
        gone.length === 0 &&
        !dataAfter.includes('Legacy conversations (v0.2)');
      if (!ok) {
        throw new Error(
          JSON.stringify({
            secondRunChangedNothing,
            oldLeft,
            chatsLeft,
            record,
            shortcuts,
            card: card?.body?.slice(-800),
            closed: !closed?.body?.includes(CARD),
            dismissed,
            data: data.body?.slice(-600),
            download: download?.filename,
            allAllowed,
            gone,
          }),
        );
      }
      return {
        record,
        shortcuts,
        siteRules: Object.keys(afterSecond['nb.siteRules'] as object),
        providers: (afterSecond['nb.providers'] as Array<{ id: string }>).map(p => p.id),
        defaultModel: (afterSecond['nb.settings'] as { defaultModel?: unknown }).defaultModel,
        download: download?.filename ?? (canSeeDownloads ? null : 'not checked without the downloads permission'),
        allowLine: !allAllowed,
        images: { card: cardImage },
      };
    } finally {
      for (const id of opened) await chrome.tabs.remove(id).catch(() => undefined);
      await chrome.storage.local.remove(Object.keys(await chrome.storage.local.get(null)).filter(touched));
      await chrome.storage.local.set(before);
      for (const s of await listShortcuts()) if (!shortcutsBefore.has(s.id)) await deleteShortcut(s.id);
    }
  },
});
