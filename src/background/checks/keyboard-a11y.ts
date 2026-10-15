// Keyboard, accessibility and the last settings. The panel's keys (Ctrl/Cmd+/, Ctrl/Cmd+Shift+P with the one-time Auto
// notice, Esc), the live status region, reflow at 200% zoom in a narrow window for the panel and the settings page, the
// reduced-motion rule, Settings → About, and deleting everything through the worker.
import { listConversations } from '@src/store/conversations';
import { listShortcuts, saveShortcut } from '@src/store/shortcuts';
import { DEFAULT_SETTINGS } from '@src/store/settings';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

interface Layout {
  scrollWidth: number;
  clientWidth: number;
  innerWidth: number;
  reducedMotion: boolean;
  live: string | null;
  mode: string | null;
}

const options = (op: string, extra: Record<string, unknown> = {}) =>
  chrome.runtime.sendMessage({ nbTest: 'options', op, ...extra }) as Promise<{ ok: boolean; body?: string } & Layout>;
const panelLayout = (tabId: number) =>
  chrome.runtime.sendMessage({ nbTest: 'panel', tabId, op: 'layout' }) as Promise<Layout>;
const key = (tabId: number, k: Record<string, unknown>) =>
  chrome.runtime.sendMessage({ nbTest: 'panel', tabId, op: 'key', ...k }) as Promise<{ focused: string }>;
const settingsNow = async () =>
  (await chrome.storage.local.get('nb.settings'))['nb.settings'] as typeof DEFAULT_SETTINGS | undefined;

async function statusIs(tabId: number, status: string, timeoutMs = 8000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if ((await panel(tabId, 'read')).status === status) return true;
    await sleep(150);
  }
  return false;
}

defineCheck({
  name: 'keyboard-a11y',
  title: 'Keyboard, accessibility, Data and About',
  description: 'The panel keys, the live region, reflow at 200% zoom, reduced motion, About, and deleting data.',
  async run() {
    await seedFixtureModel();
    const fixture = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
    await waitForLoad(fixture.id!);
    const id = fixture.id!;
    // A narrow window, as a side panel is, at 200% zoom.
    const win = (await chrome.windows.create({
      url: chrome.runtime.getURL(`/sidepanel.html#tab=${id}`),
      width: 420,
      height: 800,
      focused: true,
    }))!;
    // Headless Chrome may open the window at its default size; ask again.
    await chrome.windows.update(win.id!, { width: 420, height: 800 });
    const view = win.tabs![0];
    await waitForLoad(view.id!);
    await sleep(600);
    try {
      await scriptReplies([{ text: 'A long answer: '.repeat(30) + 'https://example.com/a/very/long/address/' }]);
      await panel(id, 'type-send', { text: 'Explain this page in detail, please.' });
      await waitForText(id, 'A long answer');
      const focused = (await key(id, { key: '/', ctrl: true })).focused;
      await statusIs(id, 'Done');
      const live = (await panelLayout(id)).live;

      // Ctrl+Shift+P: Auto, with its notice once, then back to Ask; each choice is the default for new conversations.
      await key(id, { key: 'P', ctrl: true, shift: true });
      await sleep(300);
      const toAuto = await panelLayout(id);
      const notice = (await panel(id, 'read')).body.includes('In Auto mode, the agent submits');
      await panel(id, 'click', { label: 'Got it' });
      await sleep(200);
      const noticeStored = (await settingsNow())?.autoNoticeShown === true;
      const autoIsDefault = (await settingsNow())?.defaultMode === 'auto';
      await key(id, { key: 'P', ctrl: true, shift: true });
      await sleep(300);
      const backToAsk = (await panelLayout(id)).mode;
      const askIsDefault = (await settingsNow())?.defaultMode === 'ask';

      // Esc stops a run.
      await scriptReplies([{ text: 'too late', delayMs: 5000 }]);
      await panel(id, 'type-send', { text: 'Take your time.' });
      const started = await statusIs(id, 'Working', 4000);
      await key(id, { key: 'Escape' });
      const stopped = await statusIs(id, 'Stopped');

      // Headless windows are at least 500 pixels wide: 250% gives the 200 CSS pixels of a 400-pixel panel at 200%.
      await chrome.tabs.setZoom(view.id!, 2.5);
      await sleep(500);
      const panelZoomed = await panelLayout(id);
      const panelImage = await chrome.tabs.captureVisibleTab(win.id!, { format: 'png' });

      await chrome.tabs.update(view.id!, { url: chrome.runtime.getURL('/options.html#about') });
      await waitForLoad(view.id!);
      await sleep(800);
      const optionsZoomed = await options('layout');
      const about = (await options('read')).body ?? '';
      const optionsImage = await chrome.tabs.captureVisibleTab(win.id!, { format: 'png' });
      await chrome.tabs.setZoom(view.id!, 1);

      // Everything from Settings → Data.
      await saveShortcut({ name: 'to-be-deleted', description: '', text: 'x' });
      await chrome.tabs.update(view.id!, { url: chrome.runtime.getURL('/options.html#data') });
      await waitForLoad(view.id!);
      await sleep(800);
      const dataPage = (await options('read')).body ?? '';
      await options('click', { label: 'Delete everything' });
      await sleep(100);
      await options('click', { label: 'Delete everything now' });
      await sleep(1500);
      const afterAll = {
        conversations: (await listConversations()).length,
        shortcuts: (await listShortcuts()).length,
        settings: await settingsNow(),
        providers: (await chrome.storage.local.get('nb.providers'))['nb.providers'],
      };
      const report = {
        focusInput: focused === 'nb-composer-input',
        liveRegion: live === 'Done',
        modeSwitched: toAuto.mode === 'auto',
        autoNotice: notice,
        noticeStored,
        modeBack: backToAsk === 'ask',
        modeIsDefault: autoIsDefault && askIsDefault,
        escStops: started && stopped,
        panelReflows: panelZoomed.scrollWidth <= panelZoomed.clientWidth + 1 && panelZoomed.innerWidth <= 210,
        optionsReflow: optionsZoomed.scrollWidth <= optionsZoomed.clientWidth + 1,
        reducedMotion: panelZoomed.reducedMotion,
        about:
          about.includes(`Version ${chrome.runtime.getManifest().version}`) &&
          about.includes('puppeteer-core') &&
          about.includes('Apache-2.0'),
        dataPage: dataPage.includes('Storage used'),
        deletedAll:
          afterAll.conversations === 0 &&
          afterAll.shortcuts === 0 &&
          // Only the two Privacy switches stay; every other setting is back to its default.
          (Object.keys(DEFAULT_SETTINGS) as Array<keyof typeof DEFAULT_SETTINGS>).every(
            k =>
              k === 'analyticsPing' ||
              k === 'analyticsStats' ||
              JSON.stringify(afterAll.settings?.[k]) === JSON.stringify(DEFAULT_SETTINGS[k]),
          ) &&
          afterAll.providers === undefined,
        panelImage,
        optionsImage,
      };
      if (Object.values(report).includes(false)) {
        throw new Error(
          JSON.stringify({
            ...report,
            panelImage: undefined,
            settingsAfter: afterAll.settings,
            optionsImage: undefined,
            live,
            panelZoomed,
            optionsZoomed,
          }),
        );
      }
      return report;
    } finally {
      await chrome.windows.remove(win.id!).catch(() => undefined);
      await chrome.tabs.remove(fixture.id!).catch(() => undefined);
      await seedFixtureModel();
    }
  },
});
