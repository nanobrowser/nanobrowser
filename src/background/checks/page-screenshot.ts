// Renders one of the extension's pages in a tab and captures it, so the product's UI can be looked at in
// unattended runs. Storage can be seeded first (settings, providers, the theme).
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';

defineCheck({
  name: 'page-screenshot',
  title: 'Page screenshot',
  description:
    'Opens an extension page (args.path, e.g. "options.html#providers") in a tab, after seeding chrome.storage.local with args.storage, and captures it as PNG. Seed `nb.settings` with `theme: "dark"` for the dark theme; args.width and args.height size the window, args.zoom (e.g. 0.75) zooms the page to show more of it, and args.click names a button to press first. An extension page also reports its scroll and client widths, to catch sideways overflow.',
  async run(args) {
    const path = String(args.path ?? 'sidepanel.html');
    if (args.storage) await chrome.storage.local.set(args.storage as Record<string, unknown>);
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(`/${path}`), active: true });
    try {
      if (args.width || args.height) {
        await chrome.windows.update(tab.windowId, {
          width: Number(args.width ?? 1280),
          height: Number(args.height ?? 900),
        });
      }
      await waitForLoad(tab.id!);
      if (args.zoom) await chrome.tabs.setZoom(tab.id!, Number(args.zoom));
      await sleep(Number(args.waitMs ?? 800));
      const hook = (op: string, extra: Record<string, unknown> = {}) =>
        chrome.runtime
          .sendMessage({ nbTest: path.startsWith('options') ? 'options' : 'panel', op, ...extra })
          .catch(() => null) as Promise<{ ok: boolean; scrollWidth?: number; clientWidth?: number } | null>;
      if (args.click) {
        await hook('click', { label: String(args.click) });
        await sleep(300);
      }
      const layout = await hook('layout');
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return { image, scrollWidth: layout?.scrollWidth, clientWidth: layout?.clientWidth };
    } finally {
      await chrome.tabs.remove(tab.id!);
      if (args.storage) await chrome.storage.local.remove(Object.keys(args.storage as object));
    }
  },
});
