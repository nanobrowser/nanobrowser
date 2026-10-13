// Chrome permissions on update and the features without the optional ones. Two checks:
// - `permission-warnings`: the warnings Chrome would show for this build's manifest with the product's permission
//   lists, against those of the old Nanobrowser's manifest (passed in the arguments by fixtures/autorun.mjs). An update
//   that adds a warning is turned off by Chrome until the user accepts it, so any warning the old version did not have
//   fails the check. Run it before every release.
// - `without-permissions`: run in the build with the product's lists (`pnpm autorun --product-permissions`), where
//   nothing grants the optional permissions, since a grant needs a click. The agent's tabs are still grouped and the
//   group is found again; a notification is skipped without an error; the Save file card shows in Auto mode, and Save,
//   clicked without a user's gesture, is refused by Chrome and leaves the card open; a saved file shows no Open and no
//   Show in folder; Settings → Permissions and the welcome page's last step offer Allow.
import { notifyFinished, notifyNeeds } from '@src/extension/notify';
import { appendEntry } from '@src/store/conversations';
import { permissionLists } from '@src/ui/manifest-permissions';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

// The Allow button right after the card's last feature, or right after the welcome row's line. A bare "Allow" also
// matches the site list's heading further down the page, so the text before it is part of the match.
const CARD_ALLOW = /to your Downloads folder\.\s*\nAllow\n/;
const ROW_ALLOW = /later in Settings\.\s*\nAllow\n/;

function warnings(manifest: object): Promise<string[]> {
  return chrome.management.getPermissionWarningsByManifest(JSON.stringify(manifest));
}

defineCheck({
  name: 'permission-warnings',
  title: 'No new install warning on update',
  description: 'The product manifest’s permission warnings against the old version’s; fails on any new warning.',
  async run(args) {
    const old = args.oldManifest as object | undefined;
    if (!old) throw new Error('no oldManifest in the arguments (fixtures/autorun.mjs passes it)');
    // This build's manifest with the product's lists. The name and description are plain text, since Chrome reads
    // the manifest without the extension's _locales.
    const own = chrome.runtime.getManifest() as unknown as Record<string, unknown>;
    const product: Record<string, unknown> = {
      ...own,
      name: 'Nanobrowser',
      description: 'Nanobrowser',
      ...permissionLists('product'),
    };
    delete product.default_locale;
    delete product.key;
    const before = await warnings(old);
    const after = await warnings(product);
    const added = after.filter(w => !before.includes(w));
    // A control: with the four required, as in the autorun build, Chrome must report new warnings, or the check is blind.
    const control = (await warnings({ ...product, ...permissionLists('autorun') })).filter(w => !before.includes(w));
    if (!control.length) throw new Error('the four optional permissions give no new warning when required');
    const report = {
      old: before,
      product: after,
      added,
      addedIfRequired: control,
      same: added.length === 0 && after.length === before.length,
      optional: product.optional_permissions,
      permissions: product.permissions,
    };
    if (added.length) throw new Error(JSON.stringify(report));
    return report;
  },
});

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string, tries = 60): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await read();
    if (ok(v)) return v;
    await sleep(150);
  }
  throw new Error(`${what}: ${JSON.stringify(await read())}`);
}

const options = (op: string, extra: Record<string, unknown> = {}) =>
  chrome.runtime.sendMessage({ nbTest: 'options', op, ...extra }) as Promise<{ ok: boolean; body?: string }>;

async function conversationOf(tabId: number): Promise<string | undefined> {
  const scope = (await chrome.storage.session.get('nb.scope'))['nb.scope'] as
    { tabs: Record<string, { conversationId: string }> } | undefined;
  return scope?.tabs[tabId]?.conversationId;
}

defineCheck({
  name: 'without-permissions',
  title: 'Features without the optional permissions',
  description:
    'Tab group without tabGroups, no notification, the Save card in Auto mode refused without a click, no Open on a saved file.',
  async run() {
    const held = await chrome.permissions.contains({ permissions: ['downloads'] });
    if (held || chrome.tabGroups || chrome.notifications) {
      throw new Error('the optional permissions are granted: run this check with pnpm autorun --product-permissions');
    }
    const errors: string[] = [];
    const onError = (e: ErrorEvent) => errors.push(String(e.message));
    const onRejection = (e: PromiseRejectionEvent) => errors.push(String(e.reason?.message ?? e.reason));
    self.addEventListener('error', onError);
    self.addEventListener('unhandledrejection', onRejection);

    await seedFixtureModel();
    const start = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
    await waitForLoad(start.id!);
    const view = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/sidepanel.html#tab=${start.id}`),
      active: true,
    });
    await waitForLoad(view.id!);
    await sleep(600);
    const id = start.id!;
    const report: Record<string, unknown> = {};
    let settings: chrome.tabs.Tab | undefined;
    try {
      // Tab groups: the agent's tab joins the start tab's group, and a second tab finds the same group again.
      const open = (path: string, summary: string) => [
        { toolCalls: [{ name: 'tabs', input: { action: 'open', url: `${FIXTURE_ORIGIN}/${path}` } }] },
        { toolCalls: [{ name: 'done', input: { outcome: 'success', summary } }] },
      ];
      await scriptReplies(open('c-effects.html', 'Opened the effects page.'));
      await panel(id, 'type-send', { text: 'Open the effects page' });
      await waitForText(id, 'Opened the effects page.');
      const groupId = (await chrome.tabs.get(id)).groupId;
      const first = await chrome.tabs.query({ groupId });
      report.grouped = groupId !== -1 && first.some(t => t.url?.includes('c-effects'));
      await scriptReplies(open('c-states.html', 'Opened the states page.'));
      await panel(id, 'type-send', { text: 'Open the states page' });
      await waitForText(id, 'Opened the states page.');
      const again = await until(
        () => chrome.tabs.query({ groupId }),
        tabs => tabs.some(t => t.url?.includes('c-states')),
        'the second agent tab joins the same group',
      );
      report.groupFoundAgain = again.length === 3;

      // Notifications: nothing is shown and nothing throws.
      const conversationId = await conversationOf(id);
      if (!conversationId) throw new Error('the start tab has no conversation');
      await notifyFinished(conversationId, true, id);
      await notifyNeeds(
        { id: 'nb-check', kind: 'save-file', conversationId, tabId: id, data: {}, openedAt: new Date().toISOString() },
        id,
      );
      report.notificationSkipped = true;

      // Saving in Auto mode: the card still asks, and Save without a click is refused and leaves it open.
      await panel(id, 'select', { label: 'Mode', value: 'auto' }).catch(() => undefined);
      await scriptReplies([
        {
          toolCalls: [
            {
              name: 'save_file',
              input: { filename: 'nb-check-optional.csv', content: 'name,price\nkettle,49.90\n', mimeType: 'text/csv' },
            },
          ],
        },
        { text: 'Could not save the file.' },
      ]);
      await panel(id, 'type-send', { text: 'Save the prices as CSV' });
      const card = await until(
        async () => (await panel(id, 'read')).body,
        b => b.includes('Save this file?'),
        'the Save card in Auto mode',
      );
      report.cardInAuto = card.includes('nb-check-optional.csv');
      report.askFirstShown = card.includes('Chrome asks you first to let Nanobrowser save files.');
      await panel(id, 'click', { label: 'Save' });
      const refused = await until(
        async () => (await panel(id, 'read')).body,
        b => b.includes('Saving needs your permission in Chrome.'),
        'the refusal line',
      );
      report.refusedCardOpen = refused.includes('Save this file?');
      report.image = await chrome.tabs.captureVisibleTab(view.windowId, { format: 'png' });
      await panel(id, 'click', { label: 'Skip' });
      const after = await waitForText(id, 'Could not save the file.');
      report.cardClosedOnSkip = !after.body.includes('Save this file?');

      // A saved file, written into the conversation here (nothing can be saved in this build): no Open, no Show.
      await appendEntry(conversationId, {
        type: 'ui',
        kind: 'download',
        data: { name: 'nb-check-saved.csv', downloadId: 1, bytes: 26 },
      });
      // The panel is opened again, so it reads the conversation from the store.
      await chrome.tabs.update(view.id!, { url: 'about:blank' });
      await waitForLoad(view.id!);
      await chrome.tabs.update(view.id!, { url: chrome.runtime.getURL(`/sidepanel.html#tab=${id}`) });
      await waitForLoad(view.id!);
      await sleep(600);
      const saved = await waitForText(id, 'Saved nb-check-saved.csv');
      const line = saved.transcript.split('\n').findIndex(l => l.includes('Saved nb-check-saved.csv'));
      const near = saved.transcript
        .split('\n')
        .slice(line, line + 4)
        .join('\n');
      report.savedFileShown = line >= 0;
      report.noOpenOrShow = !/\bOpen\b|Show in folder/.test(near);

      // Settings → Permissions: the additional browser permissions card with Allow.
      settings = await chrome.tabs.create({ url: chrome.runtime.getURL('/options.html#permissions'), active: true });
      await waitForLoad(settings.id!);
      const page = await until(
        async () => (await options('read')).body ?? '',
        b => CARD_ALLOW.test(b),
        'the additional browser permissions card with Allow',
      );
      report.settingsCard =
        page.includes('Tab groups') &&
        page.includes('Notifications') &&
        page.includes('Saving files') &&
        CARD_ALLOW.test(page);
      await sleep(600);
      report.settingsImage = await chrome.tabs.captureVisibleTab(settings.windowId, { format: 'png' });
      await chrome.tabs.remove(settings.id!);

      // The welcome page's last step: the additional browser permissions row with Allow (the fixture model is set, so Next goes on).
      settings = await chrome.tabs.create({ url: chrome.runtime.getURL('/welcome.html'), active: true });
      await waitForLoad(settings.id!);
      await until(
        async () => (await options('read')).body ?? '',
        b => b.includes('Welcome to Nanobrowser'),
        'the welcome page',
      );
      await options('click', { label: 'Next' });
      await sleep(200);
      await options('click', { label: 'Next' });
      const tips = await until(
        async () => (await options('read')).body ?? '',
        // The row shows Allow once it has read the permissions.
        b => ROW_ALLOW.test(b),
        'the welcome row with Allow',
      );
      report.welcomeRow = ROW_ALLOW.test(tips) && tips.includes('Open the panel');
      await sleep(600);
      report.welcomeImage = await chrome.tabs.captureVisibleTab(settings.windowId, { format: 'png' });
      // Only errors from the optional APIs count; the layer's own (a debugger detached as a tab closes) are listed.
      const missing = errors.filter(e => /tabGroups|notifications|downloads|permission/i.test(e));
      report.errors = missing;
      report.otherErrors = errors.filter(e => !missing.includes(e));
      const failed = Object.entries(report).filter(([, v]) => v === false);
      if (failed.length || missing.length)
        throw new Error(
          JSON.stringify({ ...report, image: undefined, settingsImage: undefined, welcomeImage: undefined }),
        );
      return report;
    } finally {
      self.removeEventListener('error', onError);
      self.removeEventListener('unhandledrejection', onRejection);
      for (const tab of await chrome.tabs.query({ url: `${FIXTURE_ORIGIN}/*` })) {
        await chrome.tabs.remove(tab.id!).catch(() => undefined);
      }
      for (const t of [view.id, settings?.id]) if (t !== undefined) await chrome.tabs.remove(t).catch(() => undefined);
    }
  },
});
