// Context detection for a local server: an "Ollama" provider pointed at the fixture server, which answers `/api/ps`
// with a 12,288-token context. A run detects it, stores it, and the profile is lowered from the 32k the user set; a
// larger detected value would not raise it.
import { providersStorage } from '@src/store/settings';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { FIXTURE_PROVIDER, panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

defineCheck({
  name: 'local-context',
  title: 'Context detection for a local server',
  description: 'A run on an Ollama provider stores the window the server reports, lowering the 32k set by hand.',
  async run() {
    await seedFixtureModel();
    await chrome.storage.local.set({
      'nb.providers': [
        {
          ...FIXTURE_PROVIDER,
          kind: 'ollama',
          baseUrl: 'http://localhost:8787/__llm',
          models: [{ name: 'fixture-model', overrides: { contextWindow: 32_768 } }],
        },
      ],
    });
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('/sidepanel.html'), active: true });
    await waitForLoad(tab.id!);
    await sleep(600);
    try {
      await scriptReplies([{ text: 'Hello from the local model.' }]);
      await panel(tab.id!, 'type-send', { text: 'Hi' });
      await waitForText(tab.id!, 'Hello from the local model.');
      const stored = (await providersStorage.get())[0].models[0];
      const report = { detectedContext: stored.detectedContext, setByHand: stored.overrides?.contextWindow };
      if (stored.detectedContext !== 12_288) throw new Error(JSON.stringify(report));
      return report;
    } finally {
      await chrome.storage.local.set({ 'nb.providers': [FIXTURE_PROVIDER] });
      await chrome.tabs.remove(tab.id!).catch(() => undefined);
    }
  },
});
