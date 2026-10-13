// The model picker with its effort row, and the effort beside the default model on Settings → Providers. The row
// follows the chosen model's capability, a pill writes the pair and the settings, choosing a model keeps the effort,
// the button names the effort of a model that reasons, the line under the row shows during a run, and the select on
// Providers writes the setting. Captures the open menu.
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { FIXTURE_PROVIDER, panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

const LLM = 'http://localhost:8787/__llm';
const options = (op: string, extra: Record<string, unknown> = {}) =>
  chrome.runtime.sendMessage({ nbTest: 'options', op, ...extra }) as Promise<{ ok: boolean }>;
const settings = async () =>
  (await chrome.storage.local.get('nb.settings'))['nb.settings'] as {
    reasoning: string;
    defaultModel: { model: string };
  };
const value = (model: string) => `fixture:${model}`;

defineCheck({
  name: 'model-picker',
  title: 'The model picker and the effort row',
  description:
    'The effort row per capability, a pill and a model writing the pair and the settings, the button, the line during a run, and the effort on Settings → Providers.',
  async run() {
    await seedFixtureModel();
    const stored = (await chrome.storage.local.get('nb.settings'))['nb.settings'] ?? {};
    await chrome.storage.local.set({
      'nb.providers': [
        {
          ...FIXTURE_PROVIDER,
          models: [
            { ...FIXTURE_PROVIDER.models[0], tested: { reasons: true, acceptsNone: true, at: '' } },
            { name: 'o3', overrides: { contextWindow: 32768 } },
            { name: 'gpt-4o', overrides: { contextWindow: 32768 } },
          ],
        },
      ],
      'nb.settings': { ...stored, reasoning: 'low' },
    });
    const page = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
    await waitForLoad(page.id!);
    const view = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/sidepanel.html#tab=${page.id}`),
      active: true,
    });
    await waitForLoad(view.id!);
    await sleep(600);
    const id = page.id!;
    const report: Record<string, unknown> = {};
    const button = async () => (await panel(id, 'read')).buttons?.find(b => b?.startsWith('Model: ')) ?? '';
    const pick = (v: string) => panel(id, 'select', { label: 'Model', value: v });
    const pills = async () => {
      await pick('open'); // opens the menu; no item has this value
      await sleep(100);
      return ((await panel(id, 'read')) as unknown as { pills: string[] }).pills;
    };
    let image = '';
    try {
      // A new chat: the pair made from the settings, Low for a model that reasons.
      report.button = await button();
      report.optionalPills = (await pills()).join(' ');
      image = await chrome.tabs.captureVisibleTab(view.windowId, { format: 'png' });
      await pick('high');
      await sleep(300);
      report.pillWritesSettings = (await settings()).reasoning === 'high';
      report.buttonHigh = await button();
      // Choosing a model keeps the effort; the row follows the model.
      await pick(value('o3'));
      await sleep(300);
      report.alwaysPills = (await pills()).join(' ');
      report.buttonO3 = await button();
      await pick(value('gpt-4o'));
      await sleep(300);
      report.nonePills = (await pills()).join(' ');
      report.buttonGpt4o = await button();
      report.modelWritesSettings = (await settings()).defaultModel.model === 'gpt-4o';
      // On a model that cannot stop, a stored None shows as Low; pressing Low stores Low.
      await pick(value('fixture-model'));
      await sleep(300);
      await pick('none');
      await sleep(200);
      await pick(value('o3')); // keeps None, shown as Low
      await sleep(300);
      await pick('low');
      await sleep(300);
      report.lowOnAlwaysStored = (await settings()).reasoning === 'low';
      // A narrow panel: the open menu and its pills stay inside it, at about 200 CSS px (a panel at 200% zoom).
      const wide = (await chrome.tabs.get(view.id!)).width ?? 1280;
      await chrome.tabs.setZoom(view.id!, Math.max(1, wide / 200));
      await sleep(400);
      await pick('open');
      await sleep(150);
      const box = ((await panel(id, 'read')) as unknown as { menu: { left: number; right: number; width: number } })
        .menu;
      report.narrowFits = !!box && box.left >= 0 && box.right <= box.width;
      await chrome.tabs.setZoom(view.id!, 1);
      await sleep(300);
      await pick(value('fixture-model'));
      await sleep(300);
      await pick('none');
      await sleep(300);
      // The first message carries the draft pair: None on a model that takes it is sent as none.
      await fetch(`${LLM}/reset`, { method: 'POST' });
      await scriptReplies([{ text: 'At None.' }]);
      await panel(id, 'type-send', { text: 'Hello' });
      await waitForText(id, 'At None.');
      const sent = (await (await fetch(`${LLM}/requests`)).json()) as Array<{ reasoning_effort?: string }>;
      report.firstSendNone = sent[0]?.reasoning_effort === 'none';
      // In a conversation a pill writes the live pair and the settings.
      await sleep(500);
      await pick('medium');
      await sleep(400);
      const scope = (await chrome.storage.session.get('nb.scope'))['nb.scope'] as
        { tabs: Record<string, { conversationId: string }> } | undefined;
      const key = `nb.live.${scope?.tabs[id]?.conversationId}`;
      const live = (await chrome.storage.session.get(key))[key] as { reasoning: string } | undefined;
      report.pillWritesPair = live?.reasoning === 'medium' && (await settings()).reasoning === 'medium';
      // Escape stops a run when the focus is outside a menu, even with the + menu left open.
      await scriptReplies([{ text: 'Never shown.', delayMs: 4000 }]);
      await panel(id, 'type-send', { text: 'Long task' });
      await sleep(400);
      await panel(id, 'click', { label: 'Add' });
      await sleep(150);
      await panel(id, 'key', { key: '/', ctrl: true }); // focuses the input
      await panel(id, 'key', { key: 'Escape' });
      report.escapeStops = /Stopped/.test(
        await (async () => {
          for (let i = 0; i < 30; i++) {
            const s = (await panel(id, 'read')).status;
            if (/Stopped|Done/.test(s)) return s;
            await sleep(150);
          }
          return '';
        })(),
      );
      // During a run the row says when a change applies.
      await scriptReplies([{ text: 'Slow.', delayMs: 2500 }]);
      await panel(id, 'type-send', { text: 'Take your time' });
      await sleep(500);
      await pick('open');
      await sleep(150);
      report.nextRunLine = (await panel(id, 'read')).body.includes('Applies when the next run starts');
      await waitForText(id, 'Slow.');
    } finally {
      await chrome.tabs.remove(view.id!).catch(() => undefined);
      await chrome.tabs.remove(page.id!).catch(() => undefined);
    }

    // Settings → Providers: the effort beside the default model writes the setting, only for a model that takes one.
    const providersTab = await chrome.tabs.create({
      url: chrome.runtime.getURL('/options.html#providers'),
      active: true,
    });
    try {
      await waitForLoad(providersTab.id!);
      await sleep(600);
      const defaultModel = (model: string) =>
        options('select', { label: 'Default model', value: `${FIXTURE_PROVIDER.id}\u0000${model}` });
      await defaultModel('fixture-model');
      await sleep(300);
      const set = await options('select', { label: 'Reasoning effort', value: 'medium' });
      await sleep(300);
      report.providersRow = set.ok && (await settings()).reasoning === 'medium';
      await defaultModel('gpt-4o');
      await sleep(300);
      report.providersRowHidden = !(await options('select', { label: 'Reasoning effort', value: 'low' })).ok;
    } finally {
      await chrome.tabs.remove(providersTab.id!).catch(() => undefined);
    }

    const expected: Record<string, unknown> = {
      button: 'Model: fixture-model · Low',
      optionalPills: 'none low* medium high',
      pillWritesSettings: true,
      buttonHigh: 'Model: fixture-model · High',
      alwaysPills: 'low medium high*',
      buttonO3: 'Model: o3 · High',
      nonePills: '',
      buttonGpt4o: 'Model: gpt-4o',
      modelWritesSettings: true,
      firstSendNone: true,
      pillWritesPair: true,
      nextRunLine: true,
      providersRow: true,
      providersRowHidden: true,
      lowOnAlwaysStored: true,
      escapeStops: true,
      narrowFits: true,
    };
    const wrong = Object.entries(expected).filter(([k, v]) => report[k] !== v);
    if (wrong.length) throw new Error(`model-picker: ${JSON.stringify(report)}`);
    return { ...report, image };
  },
});
