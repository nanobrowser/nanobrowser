// The look of the extension's pages in the light and the dark theme: the empty panel, the panel with a write card
// open, Recent tasks, Settings and the welcome page. Headless Chrome keeps its window size, so the panel is captured at
// the window's width; keyboard-a11y checks the narrow layout. The check returns the images for a person to look at; it
// asserts that the card appeared and that the composer is as high after a message is sent as when the panel opened,
// wide and narrow.
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { panel, scriptReplies, seedFixtureModel } from './panel-chat';

type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['light', 'dark'];

async function setTheme(theme: Theme | 'system'): Promise<void> {
  const stored = (await chrome.storage.local.get('nb.settings'))['nb.settings'] ?? {};
  await chrome.storage.local.set({ 'nb.settings': { ...stored, theme } });
  await sleep(400);
}

async function capture(windowId: number): Promise<string> {
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

defineCheck({
  name: 'appearance',
  title: 'The brand in light and dark',
  description: 'Screenshots of the panel, a write card, Recent tasks, Settings and the welcome page in both themes.',
  async run() {
    const stored = (await chrome.storage.local.get('nb.settings'))['nb.settings'] as { theme?: Theme } | undefined;
    const before = stored?.theme ?? 'system';
    await seedFixtureModel();
    await scriptReplies([
      {
        toolCalls: [
          { name: 'click', input: { target: { role: 'button', name: 'Send' }, intent: 'Send the reply to Dana' } },
        ],
      },
    ]);
    const images: Record<string, string | number[]> = {};
    const composerHeight = async () =>
      Math.round(((await panel(page.id!, 'layout')) as unknown as { composerHeight: number }).composerHeight);
    // The composer at the window's width and at a side panel's width (about 220 CSS pixels, by zoom, as in
    // panel-tabs).
    const wideAndNarrow = async () => {
      const wide = await composerHeight();
      const { innerWidth } = (await panel(page.id!, 'layout')) as unknown as { innerWidth: number };
      await chrome.tabs.setZoom(view.id!, Math.max(1, innerWidth / 220));
      await sleep(400);
      const narrow = await composerHeight();
      await chrome.tabs.setZoom(view.id!, 0);
      await sleep(400);
      return [wide, narrow];
    };
    const page = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/g-writes.html`, active: false });
    await waitForLoad(page.id!);
    const view = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/sidepanel.html#tab=${page.id}`),
      active: true,
    });
    try {
      await waitForLoad(view.id!);
      await sleep(600);
      for (const theme of THEMES) {
        await setTheme(theme);
        images[`panelEmpty-${theme}`] = await capture(view.windowId);
      }
      await setTheme('light');
      const opened = await wideAndNarrow();
      await panel(page.id!, 'type-send', { text: 'Send the reply' });
      let body = '';
      for (let i = 0; i < 50 && !body.includes('Send this?'); i++) {
        await sleep(200);
        body = (await panel(page.id!, 'read')).body;
      }
      if (!body.includes('Send this?')) throw new Error(`no write card:\n${body}`);
      const sent = await wideAndNarrow();
      images.composerHeights = [...opened, ...sent];
      if (opened.join() !== sent.join()) {
        throw new Error(`the composer changes height after a message is sent (wide, narrow): ${opened} then ${sent}`);
      }
      for (const theme of THEMES) {
        await setTheme(theme);
        images[`panelCard-${theme}`] = await capture(view.windowId);
      }
      await panel(page.id!, 'click', { label: 'Deny' });
      await sleep(300);
      await panel(page.id!, 'click', { label: 'History' });
      await sleep(400);
      for (const theme of THEMES) {
        await setTheme(theme);
        images[`history-${theme}`] = await capture(view.windowId);
      }
      await panel(page.id!, 'key', { key: 'Escape' });
    } finally {
      await chrome.tabs.remove(view.id!).catch(() => undefined);
      await chrome.tabs.remove(page.id!).catch(() => undefined);
    }

    const pages: Array<[string, string]> = [
      ['settings', '/options.html#general'],
      ['welcome', '/welcome.html'],
    ];
    for (const [name, path] of pages) {
      const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(path), active: true });
      try {
        await waitForLoad(tab.id!);
        await sleep(800);
        for (const theme of THEMES) {
          await setTheme(theme);
          images[`${name}-${theme}`] = await capture(tab.windowId);
        }
      } finally {
        await chrome.tabs.remove(tab.id!).catch(() => undefined);
      }
    }
    await setTheme(before);
    return images;
  },
});
