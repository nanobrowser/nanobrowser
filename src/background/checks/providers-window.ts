// Settings → Providers: the default model's context window. The field reads "Auto" with the window the model runs at;
// a number typed and submitted is stored on the model's entry and stays there when another model becomes the default;
// a number out of range is not stored and the field says so; an emptied field returns to Auto.
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';

const PROVIDER = {
  id: 'window-check',
  kind: 'anthropic',
  name: 'Anthropic',
  models: [{ name: 'claude-sonnet-5-5' }, { name: 'claude-haiku-5-5' }],
};
const LABEL = 'Context window';

const options = (op: string, extra: Record<string, unknown> = {}) =>
  chrome.runtime.sendMessage({ nbTest: 'options', op, ...extra }) as Promise<{ ok: boolean }>;
const stored = async (name: string) =>
  (
    (await chrome.storage.local.get('nb.providers'))['nb.providers'] as Array<{
      models: Array<{ name: string; overrides?: { contextWindow?: number } }>;
    }>
  )[0].models.find(m => m.name === name)?.overrides?.contextWindow;
const setDefault = async (model: string) => {
  const settings = (await chrome.storage.local.get('nb.settings'))['nb.settings'] ?? {};
  await chrome.storage.local.set({ 'nb.settings': { ...settings, defaultModel: { providerId: PROVIDER.id, model } } });
};

defineCheck({
  name: 'providers-window',
  title: "The default model's context window",
  description:
    "Seeds two Claude models with the first as the default; checks that the Context window field reads Auto with the catalogue's window, stores 200,000 on the model's entry, keeps it when the other model becomes the default, refuses 16,383 without storing it, and returns to Auto when emptied. Captures the card.",
  async run() {
    const saved = await chrome.storage.local.get(['nb.providers', 'nb.settings']);
    await chrome.storage.local.set({ 'nb.providers': [PROVIDER] });
    await setDefault('claude-sonnet-5-5');
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('/options.html#providers'), active: true });
    try {
      await waitForLoad(tab.id!);
      await sleep(800);
      const failures: string[] = [];
      const field = async () =>
        (await options('field', { label: LABEL })) as unknown as { ok: boolean; value: string; placeholder: string };
      const submit = async (text: string) => {
        await options('fill', { label: LABEL, text, submit: true });
        await sleep(300);
      };

      const auto = await field();
      if (!auto.ok) failures.push('no Context window field');
      if (auto.value !== '' || !/^Auto \(1.?000.?000\)$/.test(auto.placeholder))
        failures.push(`the field does not read Auto with the window: ${JSON.stringify(auto)}`);

      await submit('200,000');
      if ((await stored('claude-sonnet-5-5')) !== 200_000) failures.push('200,000 was not stored on the entry');
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

      await setDefault('claude-haiku-5-5');
      await sleep(400);
      if ((await stored('claude-sonnet-5-5')) !== 200_000) failures.push('the number went when the default changed');
      if ((await field()).value !== '') failures.push('the other model shows the first model’s number');
      await setDefault('claude-sonnet-5-5');
      await sleep(400);

      await submit('16383');
      if ((await stored('claude-sonnet-5-5')) !== 200_000) failures.push('16,383 changed the stored number');
      const read = (await options('read')) as unknown as { body: string };
      if (!read.body.includes('Enter a whole number of tokens from 16,384 to 2,000,000'))
        failures.push('the field did not say the number is out of range');

      await submit('');
      if ((await stored('claude-sonnet-5-5')) !== undefined) failures.push('an emptied field did not return to Auto');
      if (!/^Auto/.test((await field()).placeholder)) failures.push('the field does not read Auto after emptying');

      if (failures.length) throw new Error(failures.join('; '));
      return { image };
    } finally {
      await chrome.tabs.remove(tab.id!);
      await chrome.storage.local.remove(['nb.providers', 'nb.settings']);
      await chrome.storage.local.set(saved);
    }
  },
});
