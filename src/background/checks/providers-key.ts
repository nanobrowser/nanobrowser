// Settings → Providers: editing a saved API key or provider name. The edit stays a draft, with a check to save it and a
// cross to drop it, until one of them is pressed; storage changes only on save.
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';

const PROVIDER = { id: 'key-check', kind: 'anthropic', name: 'Anthropic', models: [{ name: 'claude-haiku-5-5' }] };

const options = (op: string, extra: Record<string, unknown> = {}) =>
  chrome.runtime.sendMessage({ nbTest: 'options', op, ...extra }) as Promise<{ ok: boolean }>;
const storedKey = async () =>
  ((await chrome.storage.local.get('nb.keys'))['nb.keys'] as Record<string, string> | undefined)?.[PROVIDER.id];

defineCheck({
  name: 'providers-key',
  title: 'Saving or dropping an API key or name edit',
  description:
    "Seeds a provider with a key, types a new one, and checks that the key is stored only after the check is pressed, and that the cross drops an edit; then the same for the provider name; then the Add a provider menu's order, and that it opens above its button at the bottom of the window. Captures the key field with its two buttons, and the open menu.",
  async run() {
    await chrome.storage.local.set({ 'nb.providers': [PROVIDER], 'nb.keys': { [PROVIDER.id]: 'old-key' } });
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('/options.html#providers'), active: true });
    try {
      await waitForLoad(tab.id!);
      // Zoomed out so the key field is in the capture.
      await chrome.tabs.setZoom(tab.id!, 0.6);
      await sleep(800);
      const failures: string[] = [];
      if ((await options('click', { label: 'Save key' })).ok) failures.push('Save key shown before any edit');

      await options('fill', { label: 'API key', text: 'new-key' });
      await sleep(200);
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      if ((await storedKey()) !== 'old-key') failures.push('the key was stored while still a draft');
      if (!(await options('click', { label: 'Save key' })).ok) failures.push('no Save key button after an edit');
      await sleep(200);
      if ((await storedKey()) !== 'new-key') failures.push('Save key did not store the new key');
      if ((await options('click', { label: 'Save key' })).ok) failures.push('Save key still shown after saving');

      await options('fill', { label: 'API key', text: 'dropped-key' });
      await sleep(200);
      if (!(await options('click', { label: 'Cancel' })).ok) failures.push('no Cancel button after an edit');
      await sleep(200);
      if ((await storedKey()) !== 'new-key') failures.push('Cancel changed the stored key');
      if ((await options('click', { label: 'Save key' })).ok) failures.push('Save key still shown after Cancel');

      const storedName = async () =>
        ((await chrome.storage.local.get('nb.providers'))['nb.providers'] as Array<{ name: string }>)[0]?.name;
      await options('fill', { label: 'Name', text: 'My Claude' });
      await sleep(200);
      if ((await storedName()) !== 'Anthropic') failures.push('the name was stored while still a draft');
      if (!(await options('click', { label: 'Save name' })).ok) failures.push('no Save name button after an edit');
      await sleep(200);
      if ((await storedName()) !== 'My Claude') failures.push('Save name did not store the new name');
      await options('fill', { label: 'Name', text: 'Dropped' });
      await sleep(200);
      await options('click', { label: 'Cancel' });
      await sleep(200);
      if ((await storedName()) !== 'My Claude') failures.push('Cancel changed the stored name');

      // The Add a provider menu: OpenAI, Anthropic and Google Gemini first, and opened above its button when the
      // button is at the bottom of the window, so the whole menu shows.
      await chrome.tabs.setZoom(tab.id!, 1);
      await sleep(300);
      if (!(await options('click', { label: 'Add a provider: OpenAI', scroll: true })).ok)
        failures.push('no Add a provider menu');
      await sleep(200);
      const read = (await options('read')) as unknown as {
        body: string;
        menu: { top: number; bottom: number; height: number } | null;
      };
      if (!read.body.includes('OpenAI\nAnthropic\nGoogle Gemini\nxAI Grok')) failures.push('the menu order is wrong');
      if (!read.menu || read.menu.top < 0 || read.menu.bottom > read.menu.height)
        failures.push(`the menu does not fit the window: ${JSON.stringify(read.menu)}`);
      const menuImage = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

      if (failures.length) throw new Error(failures.join('; '));
      return { image, menuImage };
    } finally {
      await chrome.tabs.remove(tab.id!);
      await chrome.storage.local.remove(['nb.providers', 'nb.keys']);
    }
  },
});
