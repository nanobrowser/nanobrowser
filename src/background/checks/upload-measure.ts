// The upload measurements: files of 1, 10 and 25 MB through chrome.debugger into the fixture's input, and the widget
// check on three real sites (with `{"sites": true}`). On a real site files are only chosen and read back: nothing is
// submitted, and the sites chosen send nothing when a file is chosen.
import type { Result, Session } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { layer } from '../layer';
import { defineCheck } from './registry';
import { sleep } from './helpers';
import { openTab } from '../tabs';

function base64Of(bytes: number): string {
  // Text bytes, so the page can confirm the size; built in pieces to keep btoa's input small.
  const piece = 'Nanobrowser upload size check. '.repeat(1024);
  const raw = piece.repeat(Math.ceil(bytes / piece.length)).slice(0, bytes);
  let out = '';
  for (let i = 0; i < raw.length; i += 3 * 65536) out += btoa(raw.slice(i, i + 3 * 65536));
  return out;
}

async function session(url: string): Promise<{ s: Session; tabId: number; close: () => Promise<void> }> {
  const { controller } = await layer();
  const s = controller.createSession({ capabilities: ['files'], confirm: 'never' });
  const tab = await openTab(url);
  s.shareTab(tab.id!);
  return {
    s,
    tabId: tab.id!,
    close: async () => {
      await controller.closeSession(s);
      await chrome.tabs.remove(tab.id!).catch(() => undefined);
    },
  };
}

const small = [
  { name: 'nanobrowser-check.txt', mimeType: 'text/plain', base64: btoa('A small file from the upload check.') },
];

/** Tries the outline's likely file inputs, then a drop zone's chooser, found by its text. */
async function uploadSomewhere(
  s: Session,
  tabId: number,
): Promise<{ how: string; result: Result | null; tried: string[] }> {
  await s.call('wait', { tabId, ms: 5_000 }).catch(() => undefined);
  const snap = await s.call('snapshot', { tabId, mode: 'all', window: 'page' });
  const outline = snap.page?.snapshot ?? snap.text;
  const tried: string[] = [];
  if (!/\[\w+\]/.test(outline)) tried.push(`outline: ${outline.slice(0, 300)}`);
  // A file input's accessible name is often its label, or nothing: every button is a candidate, likely ones first.
  const lines = outline.split('\n').filter(l => /\[\w+\] button/.test(l));
  lines.sort((a, b) => Number(/file|upload|choose|browse/i.test(b)) - Number(/file|upload|choose|browse/i.test(a)));
  for (const l of lines.slice(0, 12)) {
    const ref = /\[(\w+)\]/.exec(l)![1];
    const r = await s.call('upload', { tabId, target: { ref }, attachments: small });
    tried.push(`${l.trim().slice(0, 80)} → ${r.ok ? 'ok' : r.error?.code}`);
    if (r.ok) return { how: 'input', result: r, tried };
  }
  // A drop zone: activate the element with its text, then fill the chooser it opens.
  for (const text of ['drop some files', 'drag and drop', "drag 'n' drop", 'drop files']) {
    const found = await s.call('find', { tabId, text, limit: 3 });
    const ref = /\[(\w+)\]/.exec(found.text)?.[1];
    if (!ref) continue;
    await s.call('click', { tabId, target: { ref } });
    await sleep(500);
    const r = await s.call('upload', { tabId, attachments: small });
    tried.push(`find ${JSON.stringify(text)} → click [${ref}], then upload → ${r.ok ? 'ok' : r.error?.code}`);
    if (r.ok) return { how: 'chooser', result: r, tried };
  }
  return { how: 'none', result: null, tried };
}

const SITES = [
  'https://interactive-examples.mdn.mozilla.net/pages/tabbed/input-file.html',
  'https://getbootstrap.com/docs/5.3/forms/form-control/',
  'https://mantine.dev/x/dropzone/',
];

defineCheck({
  name: 'upload-measure',
  title: 'Upload sizes and widgets',
  description:
    'Uploads 1, 10 and 25 MB through chrome.debugger; with {"sites": true}, chooses a file on three real sites.',
  async run(args) {
    const report: Record<string, unknown> = {};
    const fixture = await session(`${FIXTURE_ORIGIN}/u-upload.html`);
    try {
      const snap = await fixture.s.call('snapshot', { tabId: fixture.tabId });
      const ref =
        /\[(\w+)\] button «?"?Document/.exec(snap.page?.snapshot ?? snap.text)?.[1] ??
        /\[(\w+)\][^\n]*Document/.exec(snap.text)?.[1];
      const sizes: Record<string, unknown> = {};
      for (const mb of [1, 10, 25]) {
        const bytes = mb * 1024 * 1024;
        const base64 = base64Of(bytes);
        const start = performance.now();
        const r = await fixture.s.call('upload', {
          tabId: fixture.tabId,
          target: { ref },
          attachments: [{ name: `size-${mb}mb.txt`, mimeType: 'text/plain', base64 }],
        });
        sizes[`${mb} MB`] = {
          ok: r.ok,
          ms: Math.round(performance.now() - start),
          readBack: r.receipt?.postcondition?.status,
          detail: r.receipt?.postcondition?.detail ?? r.error?.message,
        };
      }
      report.sizes = sizes;
    } finally {
      await fixture.close();
    }
    if ((args as { sites?: boolean }).sites) {
      const sites: Record<string, unknown> = {};
      for (const url of SITES) {
        const site = await session(url).catch(error => error as Error);
        if (site instanceof Error) {
          sites[url] = { error: site.message };
          continue;
        }
        try {
          await sleep(1500);
          const { how, result, tried } = await uploadSomewhere(site.s, site.tabId);
          sites[url] = {
            how,
            readBack: result?.receipt?.postcondition?.status ?? null,
            detail: result?.receipt?.postcondition?.detail ?? null,
            effect: result?.receipt?.effect,
            tried,
          };
        } catch (error) {
          sites[url] = { error: String((error as Error)?.message ?? error).slice(0, 300) };
        } finally {
          await site.close();
        }
      }
      report.sites = sites;
    }
    return report;
  },
});
