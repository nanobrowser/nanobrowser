// Languages. The interface switches language at runtime, in the panel and the settings page, from the in-app picker;
// the answer language reaches the system prompt; the strings Chrome shows itself come from the extension's locales.
import type { DEFAULT_SETTINGS } from '@src/store/settings';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

const options = (op: string, extra: Record<string, unknown> = {}) =>
  chrome.runtime.sendMessage({ nbTest: 'options', op, ...extra }) as Promise<{ ok: boolean; body?: string }>;

defineCheck({
  name: 'languages',
  title: 'Languages',
  description: 'Switches the interface to Simplified and Traditional Chinese, and sets the answer language.',
  async run() {
    await seedFixtureModel();
    const before = (await chrome.storage.local.get('nb.settings'))['nb.settings'] as typeof DEFAULT_SETTINGS;
    const settingsTab = await chrome.tabs.create({
      url: chrome.runtime.getURL('/options.html#general'),
      active: true,
    });
    await waitForLoad(settingsTab.id!);
    await sleep(800);
    const fixture = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
    await waitForLoad(fixture.id!);
    const view = await chrome.tabs.create({ url: chrome.runtime.getURL(`/sidepanel.html#tab=${fixture.id}`) });
    await waitForLoad(view.id!);
    await sleep(600);
    try {
      const english = (await options('read')).body ?? '';
      // The picker on the settings page; the open panel follows without a reload.
      await options('select', { label: 'UI language', value: 'zh_CN' });
      await sleep(600);
      const settingsCN = (await options('read')).body ?? '';
      const panelCN = await panel(fixture.id!, 'read');
      await options('select', { label: '界面语言', value: 'zh_TW' });
      await sleep(600);
      const settingsTW = (await options('read')).body ?? '';
      const panelTW = await panel(fixture.id!, 'read');
      await chrome.tabs.update(settingsTab.id!, { active: true });
      await sleep(200);
      const image = await chrome.tabs.captureVisibleTab(settingsTab.windowId, { format: 'png' });
      await options('select', { label: '回答語言', value: 'Simplified Chinese' });
      await sleep(300);
      await scriptReplies([{ text: '好的。' }]);
      await panel(fixture.id!, 'type-send', { text: 'Hello' });
      await waitForText(fixture.id!, '好的。');
      const requests = (await (await fetch('http://localhost:8787/__llm/requests')).json()) as Array<{
        messages: Array<{ role: string; content: unknown }>;
      }>;
      const system = JSON.stringify(requests.at(-1)?.messages.filter(m => m.role === 'system') ?? []);
      const report = {
        englishFirst: english.includes('General') && english.includes('UI language'),
        settingsSimplified: settingsCN.includes('通用') && settingsCN.includes('设置'),
        panelSimplified: panelCN.body.includes('新对话') || panelCN.body.includes('有什么可以帮你的？'),
        settingsTraditional: settingsTW.includes('一般') && settingsTW.includes('設定'),
        panelTraditional: panelTW.body.includes('有什麼可以幫你的？'),
        answerLanguage: system.includes('Answer in Simplified Chinese'),
        promptStaysEnglish: system.includes('## Untrusted content'),
        chromeStrings:
          chrome.i18n.getMessage('extName') === 'Nanobrowser' && !!chrome.i18n.getMessage('menuAskAboutSelection'),
        image,
      };
      if (Object.values(report).includes(false)) {
        throw new Error(JSON.stringify({ ...report, image: undefined, english: english.slice(0, 400) }));
      }
      return report;
    } finally {
      await chrome.storage.local.set({ 'nb.settings': before });
      await chrome.tabs.remove(settingsTab.id!).catch(() => undefined);
      await chrome.tabs.remove(view.id!).catch(() => undefined);
      await chrome.tabs.remove(fixture.id!).catch(() => undefined);
    }
  },
});
