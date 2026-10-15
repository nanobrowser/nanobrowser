// The chat, end to end: the panel page (opened in a tab, since a side panel needs a user gesture) talks to the worker
// over the panel protocol, the worker calls the fixture server's fake OpenAI-compatible model through the real provider
// path, and the conversation survives the panel closing, also mid-reply.
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';

const FIXTURES = 'http://localhost:8787';

export const FIXTURE_PROVIDER = {
  id: 'fixture',
  kind: 'openai-compatible',
  name: 'Fixture model',
  baseUrl: `${FIXTURES}/__llm/v1`,
  models: [{ name: 'fixture-model', overrides: { contextWindow: 32768 } }],
};

/** The fixture model as the default, and Ask as the default mode, which a check that chose Auto may have left. */
export async function seedFixtureModel(): Promise<void> {
  await fetch(`${FIXTURES}/__llm/reset`, { method: 'POST' });
  const stored = (await chrome.storage.local.get('nb.settings'))['nb.settings'] ?? {};
  await chrome.storage.local.set({
    'nb.providers': [FIXTURE_PROVIDER],
    'nb.settings': { ...stored, defaultMode: 'ask', defaultModel: { providerId: 'fixture', model: 'fixture-model' } },
  });
}

export async function scriptReplies(replies: unknown[]): Promise<void> {
  await fetch(`${FIXTURES}/__llm/script`, { method: 'POST', body: JSON.stringify({ replies }) });
}

interface PanelRead {
  ok: boolean;
  title: string;
  transcript: string;
  status: string;
  body: string;
  dialog: string;
  input: string;
  /** Whether the message box is disabled (no model). */
  inputDisabled?: boolean | null;
  activityImages?: number;
  chipImages?: number;
  buttons?: string[];
  /** The labels of the icon buttons that are disabled. */
  disabled?: string[];
}

export async function panel(tabId: number, op: string, extra: Record<string, unknown> = {}): Promise<PanelRead> {
  return chrome.runtime.sendMessage({ nbTest: 'panel', tabId, op, ...extra });
}

export async function openPanelTab(): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('/sidepanel.html'), active: true });
  await waitForLoad(tab.id!);
  await sleep(600);
  return tab;
}

/** Closes the panel document and opens it again on the same tab, so the tab keeps its binding. */
export async function reopenPanel(tabId: number): Promise<void> {
  await chrome.tabs.update(tabId, { url: 'about:blank' });
  await waitForLoad(tabId);
  await chrome.tabs.update(tabId, { url: chrome.runtime.getURL('/sidepanel.html') });
  await waitForLoad(tabId);
  await sleep(600);
}

export async function waitForText(tabId: number, text: string, timeoutMs = 10_000): Promise<PanelRead> {
  const end = Date.now() + timeoutMs;
  let last: PanelRead | undefined;
  while (Date.now() < end) {
    last = await panel(tabId, 'read');
    if (last?.transcript.includes(text)) return last;
    await sleep(150);
  }
  throw new Error(`"${text}" did not appear. Panel: ${JSON.stringify(last)}`);
}

defineCheck({
  name: 'panel-chat',
  title: 'Panel chat',
  description:
    'Sends a message from the panel to the fake model, checks the streamed answer, closes and reopens the panel (also mid-reply) and checks that the conversation is still there.',
  async run() {
    await seedFixtureModel();
    const tab = await openPanelTab();
    try {
      await panel(tab.id!, 'type-send', { text: 'Hello there' });
      const first = await waitForText(tab.id!, 'You said: Hello there');
      if (!first.title.startsWith('Hello there')) throw new Error(`title: ${first.title}`);

      await reopenPanel(tab.id!);
      const reopened = await waitForText(tab.id!, 'You said: Hello there');

      // Closed while the reply streams: the run carries on in the worker.
      await scriptReplies([{ text: 'A slow answer that arrives while the panel is closed.', delayMs: 1500 }]);
      await panel(tab.id!, 'type-send', { text: 'Second question' });
      await sleep(300);
      await reopenPanel(tab.id!);
      const after = await waitForText(tab.id!, 'A slow answer that arrives while the panel is closed.');
      if (!after.transcript.includes('Second question')) throw new Error('the second question is missing');

      const requests = (await (await fetch(`${FIXTURES}/__llm/requests`)).json()) as Array<{
        messages: Array<{ role: string }>;
      }>;
      const roles = requests.at(-1)?.messages.map(m => m.role);
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return { reopened: reopened.transcript, lastRequestRoles: roles, requests: requests.length, image };
    } finally {
      await chrome.tabs.remove(tab.id!).catch(() => undefined);
    }
  },
});
