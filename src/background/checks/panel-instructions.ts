// Custom instructions. Typed in Settings → Memory, saved, and sent in the marked section of the system prompt of the
// next request.
import type { DEFAULT_SETTINGS } from '@src/store/settings';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

const options = (op: string, extra: Record<string, unknown> = {}) =>
  chrome.runtime.sendMessage({ nbTest: 'options', op, ...extra }) as Promise<{ ok: boolean; body?: string }>;

defineCheck({
  name: 'panel-instructions',
  title: 'Custom instructions',
  description:
    'Settings → Memory saves the custom instructions, and the next request carries them in the system prompt.',
  async run() {
    await seedFixtureModel();
    const settingsTab = await chrome.tabs.create({ url: chrome.runtime.getURL('/options.html#memory'), active: true });
    await waitForLoad(settingsTab.id!);
    await sleep(800);
    const text = 'My company is Kq7Acme GmbH. Answer briefly.';
    const filled = await options('fill', { label: 'Custom instructions', text });
    await sleep(1200);
    const page = (await options('read')).body ?? '';
    const image = await chrome.tabs.captureVisibleTab(settingsTab.windowId, { format: 'png' });
    await chrome.tabs.remove(settingsTab.id!);
    const stored = (await chrome.storage.local.get('nb.settings'))['nb.settings'] as typeof DEFAULT_SETTINGS;

    const fixture = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
    await waitForLoad(fixture.id!);
    const view = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/sidepanel.html#tab=${fixture.id}`),
      active: true,
    });
    await waitForLoad(view.id!);
    await sleep(600);
    try {
      await scriptReplies([{ text: 'Noted.' }]);
      await panel(fixture.id!, 'type-send', { text: 'Who do I work for?' });
      await waitForText(fixture.id!, 'Noted.');
      const requests = (await (await fetch('http://localhost:8787/__llm/requests')).json()) as Array<{
        messages: Array<{ role: string; content: unknown }>;
      }>;
      const system = JSON.stringify(requests.at(-1)?.messages.filter(m => m.role === 'system') ?? []);
      const report = {
        filled: filled.ok,
        stored: stored?.customInstructions === text,
        counter: page.includes(`${text.length} / 1,500 characters`),
        inSystemPrompt: system.includes(`<custom-instructions>\\n${text}\\n</custom-instructions>`),
        notInUserMessage: !JSON.stringify(requests.at(-1)?.messages.filter(m => m.role === 'user')).includes('Kq7Acme'),
        image,
      };
      if (Object.values(report).includes(false)) {
        throw new Error(JSON.stringify({ ...report, image: undefined, system: system.slice(-600) }));
      }
      return report;
    } finally {
      await chrome.storage.local.set({ 'nb.settings': { ...stored, customInstructions: '' } });
      await chrome.tabs.remove(view.id!).catch(() => undefined);
      await chrome.tabs.remove(fixture.id!).catch(() => undefined);
    }
  },
});
