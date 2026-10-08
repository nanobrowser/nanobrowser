// Configure Jev entirely through the options page. Fake credentials and model choices never reach an API.
import { DEFAULT_JEV_SETTINGS, JEV_KEY_ID } from '@src/store/jev';
import type { JevSettings } from '@src/store/jev';
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
const storageNames = ['nb.settings', 'nb.jev', 'nb.keys', 'nb.providers'];
const settings = async () => (await chrome.storage.local.get('nb.jev'))['nb.jev'] as JevSettings | undefined;
const keys = async () => ((await chrome.storage.local.get('nb.keys'))['nb.keys'] ?? {}) as Record<string, string>;

defineCheck({
  name: 'jev-settings',
  title: 'Jev settings, key isolation and routing choices',
  description:
    'Checks disabled defaults, hidden key drafts, separate key saving and clearing, confidence and timeout settings, optional fast/capable routing and quick proposals, persistence after reload, and switching Jev off. Uses fake credentials and configured model names without API calls.',
  async run() {
    const previous = await chrome.storage.local.get(storageNames);
    await chrome.storage.local.remove('nb.jev');
    await chrome.storage.local.set({
      'nb.settings': { uiLanguage: 'en', onboarded: true },
      'nb.keys': { 'ordinary-provider': 'ordinary-test-key' },
      'nb.providers': [
        {
          id: 'jev-fixture',
          kind: 'openai-compatible',
          name: 'Fixture',
          baseUrl: 'http://localhost:8787/__llm/v1',
          models: [{ name: 'fast-fixture' }, { name: 'capable-fixture' }],
        },
      ],
    });
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('/options.html#providers'), active: true });
    try {
      await waitForLoad(tab.id!);
      await chrome.tabs.setZoom(tab.id!, 0.65);
      await sleep(800);
      const field = (label: string) => options('field', { label });
      const fill = async (label: string, text: string) => {
        assert((await options('fill', { label, text })).ok, `${label} exists`);
        await sleep(100);
      };
      const click = async (label: string, scroll = false) => {
        assert((await options('click', { label, scroll })).ok, `${label} exists`);
        await sleep(200);
      };
      const choose = async (label: string, value: string) => {
        assert((await options('select', { label, value })).ok, `${label} exists`);
        await sleep(100);
      };
      assert(DEFAULT_JEV_SETTINGS.enabled === false && !(await settings()), 'Jev starts disabled without saved config');
      assert((await field('Jev model')).value === 'jev-latest', 'the default Jev model is shown');
      assert((await field('Jev timeout (ms)')).value === '10000', 'the preserved default timeout is shown');
      assert((await field('Proceed confidence')).value === '0.8', 'the default proceed threshold is shown');
      assert((await field('Completion confidence')).value === '0.9', 'the default completion threshold is shown');
      assert((await field('Selection confidence')).value === '0.8', 'the default selection threshold is shown');

      await fill('Jev API key', 'jev-test-key');
      assert((await field('Jev API key')).type === 'password', 'the Jev key draft is hidden');
      assert(!(JEV_KEY_ID in (await keys())), 'a Jev key draft is not stored');
      await click('Save Jev key');
      assert((await keys())[JEV_KEY_ID] === 'jev-test-key', 'the key is stored separately');
      const savedKey = await field('Jev API key');
      assert(savedKey.readOnly && !savedKey.value?.includes('jev-test-key'), 'a saved key is a read-only mask');
      assert((await keys())['ordinary-provider'] === 'ordinary-test-key', 'saving Jev preserves normal provider keys');

      await click('Enable Jev');
      await fill('Jev model', 'jev-fixture-model');
      await fill('Jev timeout (ms)', '20000');
      await fill('Proceed confidence', '0.7');
      await fill('Completion confidence', '0.95');
      await fill('Selection confidence', '0.85');
      await click('Route tasks with Jev');
      await choose('Fast conversation model', 'jev-fixture\u0000fast-fixture');
      await choose('Capable conversation model', 'jev-fixture\u0000capable-fixture');
      await choose('Fast model reasoning', 'low');
      await choose('Capable model reasoning', 'high');
      await click('Quick action proposals');
      assert(!(await settings()), 'configuration changes stay drafts until Save');
      await click('Save Jev settings', true);
      const saved = await settings();
      assert(saved?.enabled && saved.routingEnabled && saved.system1Enabled, 'all Jev opt-in flags are saved');
      assert(saved.model === 'jev-fixture-model' && saved.timeoutMs === 20_000, 'the model and timeout are saved');
      assert(
        saved.proceedThreshold === 0.7 && saved.completionThreshold === 0.95 && saved.selectionThreshold === 0.85,
        'all confidence thresholds are saved',
      );
      assert(
        saved.fastModel?.providerId === 'jev-fixture' && saved.fastModel.model === 'fast-fixture',
        'the fast model uses a v0.3 reference',
      );
      assert(saved.capableModel?.model === 'capable-fixture', 'the capable model is saved');
      assert(saved.fastReasoning === 'low' && saved.capableReasoning === 'high', 'routed reasoning choices are saved');
      assert(!JSON.stringify(saved).includes('jev-test-key'), 'configuration contains no API key');
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

      await chrome.tabs.reload(tab.id!);
      await waitForLoad(tab.id!);
      await sleep(300);
      assert((await field('Jev model')).value === 'jev-fixture-model', 'the Jev model survives reload');
      assert((await field('Jev timeout (ms)')).value === '20000', 'the timeout survives reload');
      assert((await field('Jev API key')).readOnly, 'the saved key remains masked after reload');
      const reloaded = await settings();
      assert(
        reloaded?.fastReasoning === 'low' && reloaded.capableReasoning === 'high',
        'routed reasoning choices survive reload',
      );
      await click('Enable Jev');
      await click('Save Jev settings', true);
      assert((await settings())?.enabled === false, 'Jev can be switched off');
      await click('Clear Jev key');
      const cleared = await keys();
      assert(
        !(JEV_KEY_ID in cleared) && cleared['ordinary-provider'] === 'ordinary-test-key',
        'clearing Jev preserves normal keys',
      );
      return {
        image,
        defaultsDisabled: true,
        keyIsolation: true,
        routingSaved: true,
        proposalsSaved: true,
        persisted: true,
      };
    } finally {
      await chrome.tabs.remove(tab.id!);
      await chrome.storage.local.remove(storageNames);
      await chrome.storage.local.set(previous);
    }
  },
});
