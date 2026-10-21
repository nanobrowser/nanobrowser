// The optional decision APIs: opt in explicitly, keep keys as drafts until saved, and isolate each provider's key.
import { DECISION_KEY_IDS } from '@src/llm/decisions';
import { defineCheck } from './registry';
import { assert, sleep, waitForLoad } from './helpers';

interface OptionsReply {
  ok: boolean;
  type?: string;
  readOnly?: boolean;
  value?: string;
  body?: string;
}

const options = (op: string, extra: Record<string, unknown> = {}) =>
  chrome.runtime.sendMessage({ nbTest: 'options', op, ...extra }) as Promise<OptionsReply>;
const storageNames = ['nb.settings', 'nb.keys', 'nb.providers'];
const storedKeys = async () =>
  ((await chrome.storage.local.get('nb.keys'))['nb.keys'] as Record<string, string> | undefined) ?? {};
const storedProvider = async () =>
  ((await chrome.storage.local.get('nb.settings'))['nb.settings'] as { decisionProvider?: string | null })
    .decisionProvider;

defineCheck({
  name: 'decision-settings',
  title: 'Decision providers and isolated API keys',
  description:
    'Starts with older settings and confirms decision APIs are off. Selects Jev and OpenAI Decisions, checks that key drafts are hidden and saved only explicitly, that switching providers drops drafts, and that saving or clearing either key preserves the other keys. Confirms Off survives a reload and captures both configured providers. No API calls are made.',
  async run() {
    const previous = await chrome.storage.local.get(storageNames);
    await chrome.storage.local.set({
      'nb.settings': { uiLanguage: 'en', onboarded: true },
      'nb.providers': [],
      'nb.keys': { 'ordinary-provider': 'ordinary-test-key' },
    });
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('/options.html#providers'), active: true });
    try {
      await waitForLoad(tab.id!);
      await chrome.tabs.setZoom(tab.id!, 0.75);
      await sleep(800);
      const keyField = () => options('field', { label: 'Decision API key' });
      const choose = async (value: string) => {
        assert(
          (await options('select', { label: 'Decision provider', value })).ok,
          'decision provider selector exists',
        );
        await sleep(200);
        assert((await storedProvider()) === (value || null), 'the decision provider selection is saved');
      };
      const fillKey = async (text: string) => {
        assert((await options('fill', { label: 'Decision API key', text })).ok, 'the decision API key field exists');
        await sleep(100);
        assert((await keyField()).type === 'password', 'the key draft is hidden');
      };
      const saveKey = async () => {
        assert((await options('click', { label: 'Save decision key', scroll: true })).ok, 'the Save key button exists');
        await sleep(300);
        const field = await keyField();
        assert(field.readOnly && field.type === 'password', 'a saved decision key is hidden and read-only');
        assert(!field.value?.includes('test-key'), 'the saved field contains a mask rather than the key');
      };
      const clearKey = async () => {
        assert((await options('click', { label: 'Clear decision key' })).ok, 'the Clear key button exists');
        await sleep(200);
      };

      const body = (await options('read')).body ?? '';
      assert(body.includes('Decision models'), 'the decision settings card is shown');
      assert(
        body.includes('Jev (TypeSafe)') && body.includes('OpenAI Decisions'),
        'both decision providers are offered',
      );
      assert(!(await keyField()).ok, 'decision APIs default to Off for older settings');

      await choose('jev');
      await fillKey('discarded-test-key');
      assert(!(DECISION_KEY_IDS.jev in (await storedKeys())), 'a Jev draft is not stored');
      await choose('openai');
      assert((await keyField()).value === '', 'switching provider discards the key draft');
      assert(!(DECISION_KEY_IDS.jev in (await storedKeys())), 'switching provider does not save the old draft');

      await choose('jev');
      await fillKey('jev-test-key');
      await saveKey();
      assert((await storedKeys())[DECISION_KEY_IDS.jev] === 'jev-test-key', 'the Jev key is saved under its own ID');
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

      await choose('openai');
      assert((await keyField()).value === '', 'OpenAI Decisions does not reuse the Jev key');
      await fillKey('openai-test-key');
      assert(!(DECISION_KEY_IDS.openai in (await storedKeys())), 'an OpenAI Decisions draft is not stored');
      await saveKey();
      const bothKeys = await storedKeys();
      assert(
        bothKeys[DECISION_KEY_IDS.openai] === 'openai-test-key',
        'the OpenAI Decisions key is saved under its own ID',
      );
      assert(bothKeys[DECISION_KEY_IDS.jev] === 'jev-test-key', 'saving OpenAI Decisions preserves the Jev key');
      assert(bothKeys['ordinary-provider'] === 'ordinary-test-key', 'decision keys preserve normal provider keys');
      const openaiImage = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

      await clearKey();
      assert(!(DECISION_KEY_IDS.openai in (await storedKeys())), 'clearing OpenAI Decisions removes its key');
      assert((await storedKeys())[DECISION_KEY_IDS.jev] === 'jev-test-key', 'clearing OpenAI Decisions preserves Jev');
      await choose('jev');
      assert((await keyField()).readOnly, 'the saved Jev key survives switching providers');
      await clearKey();
      const clearedKeys = await storedKeys();
      assert(!(DECISION_KEY_IDS.jev in clearedKeys), 'clearing Jev removes its key');
      assert(clearedKeys['ordinary-provider'] === 'ordinary-test-key', 'clearing decision keys preserves other keys');
      await choose('');
      assert(!(await keyField()).ok, 'Off hides the decision key field');
      await chrome.tabs.reload(tab.id!);
      await waitForLoad(tab.id!);
      await sleep(300);
      assert((await storedProvider()) === null && !(await keyField()).ok, 'Off survives a reload');

      return {
        image,
        openaiImage,
        providers: ['jev', 'openai'],
        draftIsolation: true,
        keyIsolation: true,
        persistedOff: true,
      };
    } finally {
      await chrome.tabs.remove(tab.id!);
      await chrome.storage.local.remove(storageNames);
      await chrome.storage.local.set(previous);
    }
  },
});
