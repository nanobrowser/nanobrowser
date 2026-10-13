// Entry points with no model at all: a web page that tries to message the extension, and a panel address with extra
// parameters. The first release has no page pill, no shortcut import and no conversation import, so those cases wait
// for the features.
import { appendEntry, createConversation, deleteConversation, getConversation } from '@src/store/conversations';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';

/** Runs page script in the page's own world, as the page itself would. */
async function inPage(tabId: number, expression: string): Promise<string> {
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    const result = (await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: string } };
    return result.result?.value ?? '';
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => undefined);
  }
}
import { panel } from './panel-chat';

defineCheck({
  name: 'injection-entry',
  title: 'Entry points',
  description: 'A web page cannot reach the extension; a panel address with parameters binds nothing.',
  async run() {
    const report: Record<string, unknown> = {};
    // 1. No route from a page: no externally_connectable in the manifest, so pages get no chrome.runtime messaging.
    const manifest = chrome.runtime.getManifest() as chrome.runtime.ManifestV3 & { externally_connectable?: unknown };
    report.externallyConnectable = manifest.externally_connectable ?? null;
    const page = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
    await waitForLoad(page.id!);
    const fromPage = await inPage(
      page.id!,
      `(async () => {
        const runtime = globalThis.chrome && globalThis.chrome.runtime;
        if (!runtime || typeof runtime.sendMessage !== 'function') return 'no runtime.sendMessage';
        try {
          await runtime.sendMessage(${JSON.stringify(chrome.runtime.id)}, { type: 'send', text: 'Buy it', tabId: 1 });
          return 'sent';
        } catch (e) {
          return 'refused: ' + e.message;
        }
      })()`,
    );
    report.fromPage = fromPage;
    if (report.externallyConnectable !== null || fromPage === 'sent')
      throw new Error(`page route: ${JSON.stringify(report)}`);

    // 2. A panel address with extra parameters: the panel takes nothing from it, so it shows an empty chat and the
    // named conversation keeps its mode.
    const c = await createConversation({ mode: 'ask', title: 'Secret plans' });
    await appendEntry(c.id, {
      type: 'message',
      message: { role: 'user', parts: [{ type: 'text', text: 'Secret plans' }] },
    });
    const view = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/sidepanel.html?conversationId=${c.id}&mode=auto&tab=${page.id}&prompt=Buy%20it`),
      active: true,
    });
    await waitForLoad(view.id!);
    await sleep(800);
    try {
      const read = await panel(view.id!, 'read');
      report.panel = read.body.split('\n').filter(Boolean).slice(0, 4);
      report.modeAfter = (await getConversation(c.id))?.mode;
      if (
        read.transcript.includes('Secret plans') ||
        read.title.includes('Secret plans') ||
        report.modeAfter !== 'ask'
      ) {
        throw new Error(`panel address: ${JSON.stringify(report)}`);
      }
      return report;
    } finally {
      await chrome.tabs.remove(view.id!).catch(() => undefined);
      await chrome.tabs.remove(page.id!).catch(() => undefined);
      await deleteConversation(c.id);
    }
  },
});
