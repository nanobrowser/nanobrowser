// Onboarding. With no model, the panel's readiness check says a model is needed and links to the welcome page's model
// step. There, "Local" with LM Studio at the fixture server's fake model lists it, tests its tool calling and makes it
// the default; Next waits for that, and Set it later is turned off by it; the tips show; Finish marks onboarding done.
// Cloud providers need keys and the network, so they are not checked here.
import { DEFAULT_SETTINGS } from '@src/store/settings';
import type { ProviderConfig } from '@src/store/settings';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { panel, scriptReplies } from './panel-chat';

const page = (op: string, extra: Record<string, unknown> = {}) =>
  chrome.runtime.sendMessage({ nbTest: 'options', op, ...extra }) as Promise<{
    ok: boolean;
    body?: string;
    disabled?: string[];
  }>;

async function bodyWith(text: string, timeoutMs = 8000): Promise<string> {
  const end = Date.now() + timeoutMs;
  let body = '';
  while (Date.now() < end) {
    body = (await page('read')).body ?? '';
    if (body.includes(text)) return body;
    await sleep(150);
  }
  throw new Error(`"${text}" did not appear: ${body.slice(-600)}`);
}

defineCheck({
  name: 'welcome',
  title: 'Onboarding',
  description: 'The readiness check in the panel, the welcome page and its local-model setup, Finish.',
  async run() {
    await fetch('http://localhost:8787/__llm/reset', { method: 'POST' });
    const before = await chrome.storage.local.get(['nb.providers', 'nb.settings']);
    await chrome.storage.local.set({
      'nb.providers': [],
      'nb.settings': { ...DEFAULT_SETTINGS, ...(before['nb.settings'] ?? {}), defaultModel: null, onboarded: false },
    });
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    const view = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/sidepanel.html#tab=${tab.id}`),
      active: true,
    });
    await waitForLoad(view.id!);
    await sleep(600);
    const readinessRead = await panel(tab.id!, 'read');
    const readiness = readinessRead.body;
    // With no model, nothing can be typed, attached or recorded.
    const locked =
      readinessRead.inputDisabled === true &&
      ['Add', 'Voice input'].every(label => (readinessRead.disabled ?? []).includes(label));
    const readinessImage = await chrome.tabs.captureVisibleTab(view.windowId, { format: 'png' });
    // The card's button opens Settings → Providers, not the welcome page, which opens only on install.
    await panel(tab.id!, 'click', { label: 'Choose a model' });
    await sleep(400);
    const opened = await chrome.tabs.query({ url: chrome.runtime.getURL('/options.html*') });
    const settingsOpened = opened.some(t => t.url?.endsWith('/options.html#providers'));
    for (const t of opened) await chrome.tabs.remove(t.id!);
    await chrome.tabs.remove(view.id!);
    await chrome.tabs.remove(tab.id!);

    const welcome = await chrome.tabs.create({ url: chrome.runtime.getURL('/welcome.html'), active: true });
    await waitForLoad(welcome.id!);
    await sleep(600);
    try {
      const first = await bodyWith('Welcome to Nanobrowser');
      const coachMark = first.includes('Pin Nanobrowser to the toolbar');
      const welcomeImage = await chrome.tabs.captureVisibleTab(welcome.windowId, { format: 'png' });
      await page('click', { label: 'Next' });
      await bodyWith('Pick a model: run one on your computer');
      const offAtStart = (await page('read')).disabled ?? [];
      const nextWaits = offAtStart.includes('Next') && !offAtStart.includes('Set it later');
      await page('click', { label: 'Local' });
      await sleep(200);
      await page('select', { label: 'Server', value: 'lmstudio' });
      await page('fill', { label: 'Server address', text: 'http://localhost:8787/__llm' });
      await sleep(200);
      await page('click', { label: 'Connect' });
      await bodyWith('Test and use this model');
      await scriptReplies([{ toolCalls: [{ name: 'report_status', input: { status: 'ok' } }] }]);
      await page('click', { label: 'Test and use this model' });
      const ready = await bodyWith('works and is now your default model');
      const offWhenReady = (await page('read')).disabled ?? [];
      const laterOff = offWhenReady.includes('Set it later') && !offWhenReady.includes('Next');
      const modelImage = await chrome.tabs.captureVisibleTab(welcome.windowId, { format: 'png' });
      const stored = await chrome.storage.local.get(['nb.providers', 'nb.settings']);
      const providers = (stored['nb.providers'] ?? []) as ProviderConfig[];
      const settings = stored['nb.settings'] as typeof DEFAULT_SETTINGS;
      // Next and Back keep the chosen server and model.
      await page('click', { label: 'Next' });
      await bodyWith('Start with sites you know');
      await page('click', { label: 'Back' });
      const back = await bodyWith('works and is now your default model');
      const kept = back.includes('fixture-model works') && back.includes('Test and use this model');
      await page('click', { label: 'Next' });
      const tips = await bodyWith('Start with sites you know');
      // Chrome allows two captures a second.
      await sleep(600);
      const tipsImage = await chrome.tabs.captureVisibleTab(welcome.windowId, { format: 'png' });
      await page('click', { label: 'Open the panel' });
      await sleep(400);
      const onboarded = ((await chrome.storage.local.get('nb.settings'))['nb.settings'] as typeof DEFAULT_SETTINGS)
        .onboarded;
      const report = {
        settingsOpened,
        locked,
        readinessSaid:
          readiness.includes('Choose a model to start') && readiness.includes('Nanobrowser needs a model to chat.'),
        coachMark,
        nextWaits,
        laterOff,
        kept,
        modelListed: ready.includes('fixture-model'),
        providerSaved:
          providers.length === 1 &&
          providers[0].kind === 'lmstudio' &&
          providers[0].models[0]?.name === 'fixture-model',
        defaultSet: settings.defaultModel?.model === 'fixture-model',
        contextAdvice: ready.includes('16k tokens or more'),
        tipsShown: tips.includes('Use a separate profile') && tips.includes('Skip risky tasks'),
        // The browser features row; this build has the permissions, so it shows no Allow.
        featuresRow: tips.includes('Additional browser permissions') && !/\nAllow\n/.test(tips),
        onboarded,
        welcomeImage,
        modelImage,
        tipsImage,
        readinessImage,
      };
      if (Object.values(report).includes(false)) {
        throw new Error(
          JSON.stringify({
            ...report,
            welcomeImage: undefined,
            modelImage: undefined,
            tipsImage: undefined,
            readinessImage: undefined,
            ready: ready.slice(-500),
          }),
        );
      }
      return report;
    } finally {
      await chrome.tabs.remove(welcome.id!).catch(() => undefined);
      await chrome.storage.local.set({
        'nb.providers': before['nb.providers'] ?? [],
        'nb.settings': before['nb.settings'] ?? DEFAULT_SETTINGS,
      });
    }
  },
});
