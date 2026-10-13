// Saving files. Two checks:
// - `downloads-measure`: whether chrome.downloads takes the offscreen document's blob: URLs from the worker, against
//   data: URLs, with files of 1 KB, 5 MB and 50 MB;
// - `panel-save`: the agent's save_file in Ask mode (the Save card, then Save) and in Auto mode (no card, a second
//   file of the same name gets a number rather than overwrite).
// Every file a check saves is removed from disk afterwards.
import { blobUrl } from '@src/extension/downloads';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

async function finish(id: number): Promise<chrome.downloads.DownloadItem | undefined> {
  for (let i = 0; i < 300; i++) {
    const [item] = await chrome.downloads.search({ id });
    if (item && item.state !== 'in_progress') return item;
    await sleep(100);
  }
  return (await chrome.downloads.search({ id }))[0];
}

async function remove(id: number): Promise<void> {
  await chrome.downloads.removeFile(id).catch(() => undefined);
  await chrome.downloads.erase({ id }).catch(() => undefined);
}

function text(bytes: number): string {
  const line = 'Nanobrowser save check, a line of text to fill the file.\n';
  return line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes);
}

defineCheck({
  name: 'downloads-measure',
  title: 'blob: and data: URLs for chrome.downloads',
  description: 'Downloads files of 1 KB, 5 MB and 50 MB from blob: and data: URLs, then removes them.',
  async run() {
    const report: Record<string, unknown> = {};
    for (const [label, bytes] of [
      ['1 KB', 1024],
      ['5 MB', 5 * 1024 * 1024],
      ['50 MB', 50 * 1024 * 1024],
    ] as const) {
      const content = text(bytes);
      for (const kind of ['blob', 'data'] as const) {
        const start = performance.now();
        try {
          const url =
            kind === 'blob' ? await blobUrl(content, 'text/plain') : `data:text/plain;base64,${btoa(content)}`;
          const id = await chrome.downloads.download({
            url,
            filename: `nb-check-${kind}-${label.replace(' ', '')}.txt`,
            conflictAction: 'uniquify',
          });
          const item = await finish(id);
          report[`${kind} ${label}`] = {
            state: item?.state,
            bytes: item?.fileSize,
            ms: Math.round(performance.now() - start),
            error: item?.error,
          };
          await remove(id);
        } catch (error) {
          report[`${kind} ${label}`] = { error: String((error as Error)?.message ?? error).slice(0, 200) };
        }
      }
    }
    return report;
  },
});

defineCheck({
  name: 'panel-save',
  title: 'save_file in Ask and Auto mode',
  description: 'The Save card in Ask mode; no card in Auto mode; a second file of the same name gets a number.',
  async run() {
    await seedFixtureModel();
    const page = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
    await waitForLoad(page.id!);
    const view = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/sidepanel.html#tab=${page.id}`),
      active: true,
    });
    await waitForLoad(view.id!);
    await sleep(600);
    const id = page.id!;
    const saved: number[] = [];
    const listener = (item: chrome.downloads.DownloadItem) => saved.push(item.id);
    chrome.downloads.onCreated.addListener(listener);
    const save = (name: string) => ({
      toolCalls: [
        { name: 'save_file', input: { filename: name, content: 'name,price\nkettle,49.90\n', mimeType: 'text/csv' } },
      ],
    });
    try {
      // Ask mode: the card shows the file, and Save saves it.
      await scriptReplies([save('nb-check-prices.csv'), { text: 'Saved the prices.' }]);
      await panel(id, 'type-send', { text: 'Save the prices as CSV' });
      let card = '';
      for (let i = 0; i < 40 && !card.includes('Save this file?'); i++) {
        await sleep(150);
        card = (await panel(id, 'read')).body;
      }
      const image = await chrome.tabs.captureVisibleTab(view.windowId, { format: 'png' });
      await panel(id, 'click', { label: 'Save' });
      const ask = await waitForText(id, 'Saved the prices.');
      // Auto mode: no card; the same name again gets a number.
      await panel(id, 'select', { label: 'Mode', value: 'auto' }).catch(() => undefined);
      await scriptReplies([save('nb-check-prices.csv'), { text: 'Saved again.' }]);
      await panel(id, 'type-send', { text: 'Save them again' });
      const auto = await waitForText(id, 'Saved again.');
      const modeButton = (await panel(id, 'read')).buttons ?? [];
      const items = await Promise.all(saved.map(async d => (await chrome.downloads.search({ id: d }))[0]));
      const names = items.map(i => i?.filename.split(/[/\\]/).pop());
      const report = {
        cardShown:
          card.includes('Save this file?') && card.includes('nb-check-prices.csv') && card.includes('kettle,49.90'),
        savedInAsk: /Saved nb-check-prices\.csv/.test(ask.transcript),
        noCardInAuto: !/Save this file\?/.test(auto.body),
        numbered:
          names.length === 2 &&
          names[0] === 'nb-check-prices.csv' &&
          /^nb-check-prices \(\d+\)\.csv$/.test(names[1] ?? ''),
        names,
        modeShown: modeButton.includes('Mode: Auto (Make changes on its own)'),
        image,
      };
      const failed = Object.entries(report).filter(([, v]) => v === false);
      if (failed.length) throw new Error(JSON.stringify({ ...report, image: undefined, card: card.slice(0, 500) }));
      return report;
    } finally {
      chrome.downloads.onCreated.removeListener(listener);
      for (const d of saved) await remove(d);
      await chrome.tabs.remove(view.id!).catch(() => undefined);
      await chrome.tabs.remove(page.id!).catch(() => undefined);
    }
  },
});
