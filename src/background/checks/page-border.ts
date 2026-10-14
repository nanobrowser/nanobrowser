// The page border: while a run works, its page has the border, and no other tab does; it goes when the run is done;
// the model's screenshot shows the page without it; a new document gets it; a page restored with Back after Stop has
// none; the Settings switch takes it away and brings it back.
import { sendRaw } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { FIXTURE_PROVIDER, panel, scriptReplies, seedFixtureModel } from './panel-chat';

const FIXTURES = 'http://localhost:8787';

/** Whether the tab's page has the border element. */
async function hasBorder(tabId: number): Promise<boolean> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => !!document.querySelector('[data-nanobrowser-border]'),
  });
  return result?.result === true;
}

async function until(read: () => Promise<boolean>, want: boolean, ms = 6000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await read()) === want) return true;
    await sleep(100);
  }
  return false;
}

/** Goes back or forward in the tab's history; true when it lands on `page` with the border as wanted. */
async function go(tabId: number, way: 'back' | 'forward', page: string, border: boolean): Promise<boolean> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (w: string) => (w === 'back' ? history.back() : history.forward()),
    args: [way],
  });
  if (!(await until(async () => (await chrome.tabs.get(tabId)).url!.includes(page), true))) return false;
  await waitForLoad(tabId);
  if (!border) await sleep(500);
  return until(() => hasBorder(tabId), border);
}

/** How blue the image's left edge is, halfway down: the border is blue and violet over a white page. */
async function edgeBlue(base64: string): Promise<number> {
  const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  const [r, , b] = context.getImageData(2, Math.floor(bitmap.height / 2), 1, 1).data;
  return b - r;
}

/** The last image the fake model received. */
async function lastImageSent(): Promise<string | null> {
  const requests = JSON.stringify(await (await fetch(`${FIXTURES}/__llm/requests`)).json());
  const all = [...requests.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)];
  return all.at(-1)?.[1] ?? null;
}

defineCheck({
  name: 'page-border',
  title: 'The page border',
  description:
    'Shown on the run’s page only while it works, gone from the model’s screenshot, on a new document, not after Back, and following the Settings switch.',
  async run() {
    await seedFixtureModel();
    // A vision model, so the model's own screenshot is sent to it.
    await chrome.storage.local.set({
      'nb.providers': [
        { ...FIXTURE_PROVIDER, models: [{ name: 'fixture-model', overrides: { contextWindow: 32768, vision: true } }] },
      ],
    });
    const settings = (await chrome.storage.local.get('nb.settings'))['nb.settings'] ?? {};
    const page = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
    const other = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
    await waitForLoad(page.id!);
    await waitForLoad(other.id!);
    const view = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/sidepanel.html#tab=${page.id}`),
      active: true,
    });
    await waitForLoad(view.id!);
    await sleep(600);
    const id = page.id!;
    const status = async () => (await panel(id, 'read')).status;
    const report: Record<string, unknown> = {};
    try {
      // 1. While the run works: the border on its page, none on the other tab; the model's screenshot without it,
      // while a capture taken at the same time shows it.
      await scriptReplies([
        { toolCalls: [{ name: 'read', input: {} }], delayMs: 2500 },
        { toolCalls: [{ name: 'screenshot', input: {} }] },
        { text: 'Looked.', delayMs: 1500 },
      ]);
      await panel(id, 'type-send', { text: 'Look at the page' });
      report.shownWhileWorking = await until(() => hasBorder(id), true);
      report.notOnOtherTab = !(await hasBorder(other.id!));
      await sleep(400);
      const { data } = await sendRaw<{ data: string }>(id, undefined, 'Page.captureScreenshot', { format: 'png' });
      const withBorder = await edgeBlue(data);
      report.controlShowsBorder = withBorder > 30;
      report.image = `data:image/png;base64,${data}`;
      report.goneWhenDone = await until(
        async () => (await status()) === 'Done' && !(await hasBorder(id)),
        true,
        10_000,
      );
      const sent = await lastImageSent();
      const inImage = sent ? await edgeBlue(sent) : null;
      report.screenshotWithout = inImage !== null && inImage < 15;
      report.edges = { withBorder, inImage };

      // 2. A new document gets it; after Stop, Back to the earlier page shows none.
      await scriptReplies([
        { toolCalls: [{ name: 'navigate', input: { url: `${FIXTURE_ORIGIN}/c-states.html` } }] },
        { text: 'Waiting.', delayMs: 30_000 },
      ]);
      await panel(id, 'type-send', { text: 'Go to the states page' });
      report.onNewDocument = await until(
        async () => (await chrome.tabs.get(id)).url!.includes('c-states') && (await hasBorder(id)),
        true,
      );
      // 3. The Settings switch takes it away and brings it back while the run works.
      await chrome.storage.local.set({ 'nb.settings': { ...settings, pageBorder: false } });
      report.switchOff = await until(() => hasBorder(id), false);
      await chrome.storage.local.set({ 'nb.settings': { ...settings, pageBorder: true } });
      report.switchOn = await until(() => hasBorder(id), true);
      // Back and Forward while the run works: each page, restored or loaded, has the border.
      report.onBackWhileWorking = await go(id, 'back', 'c-text', true);
      report.onForwardWhileWorking = await go(id, 'forward', 'c-states', true);
      if (!report.onForwardWhileWorking)
        report.forwardState = {
          url: (await chrome.tabs.get(id)).url,
          status: await status(),
          border: await hasBorder(id),
        };
      await panel(id, 'click', { label: 'Stop' });
      await until(async () => (await status()) === 'Stopped', true);
      report.goneAfterStop = await until(() => hasBorder(id), false);
      report.noneAfterBack = await go(id, 'back', 'c-text', false);

      const failed = Object.entries(report).filter(([k, v]) => !['edges', 'forwardState', 'image'].includes(k) && !v);
      if (failed.length) throw new Error(`failed: ${JSON.stringify(report)}`);
      return report;
    } finally {
      await chrome.storage.local.set({ 'nb.settings': { ...settings, pageBorder: true } });
      for (const tab of [view, page, other]) await chrome.tabs.remove(tab.id!).catch(() => undefined);
    }
  },
});
