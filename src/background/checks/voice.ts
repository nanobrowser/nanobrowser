// Voice input in headless Chrome, with Chrome's fake microphone (a tone, allowed without a prompt) and the fixture
// server's fake OpenAI voice model. With no voice model chosen, the microphone button says to choose one in Settings;
// Settings → Providers → Voice input offers the OpenAI provider's voice model once it has a key; a recording then
// reaches the voice model as WAV and its text lands in the message box. The microphone page renders. Speaking in two
// languages to a real voice model is checked by hand.
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { FIXTURE_PROVIDER, openPanelTab, panel, seedFixtureModel } from './panel-chat';

const FIXTURES = 'http://localhost:8787';
const VOICE_PROVIDER = {
  id: 'voice-fixture',
  kind: 'openai',
  name: 'OpenAI',
  baseUrl: `${FIXTURES}/__llm/v1`,
  models: [],
};
const SENTENCE = 'Book a table for two at seven.';

const options = (op: string, extra: Record<string, unknown> = {}) =>
  chrome.runtime.sendMessage({ nbTest: 'options', op, ...extra }) as Promise<{ ok: boolean; body?: string }>;

async function waitForInput(tabId: number, text: string, timeoutMs = 15_000): Promise<string> {
  const end = Date.now() + timeoutMs;
  let input = '';
  while (Date.now() < end) {
    input = (await panel(tabId, 'read')).input;
    if (input.includes(text)) return input;
    await sleep(200);
  }
  return input;
}

defineCheck({
  name: 'voice',
  title: 'Voice input in headless Chrome',
  description:
    'The microphone button without a voice model, Settings → Providers → Voice input, a recording from the fake microphone transcribed by the fake voice model into the message box, and the microphone page.',
  async run() {
    await seedFixtureModel();
    const stored = (await chrome.storage.local.get('nb.settings'))['nb.settings'] ?? {};
    await chrome.storage.local.set({
      'nb.providers': [FIXTURE_PROVIDER, VOICE_PROVIDER],
      'nb.keys': {},
      'nb.settings': { ...stored, voiceModel: null, dictationLanguage: 'auto' },
    });
    const report: Record<string, unknown> = {};

    // No voice model: the button is there and says where to choose one.
    let view = await openPanelTab();
    report.micButton = ((await panel(view.id!, 'read')).buttons ?? []).includes('Voice input');
    await panel(view.id!, 'click', { label: 'Voice input' });
    await sleep(300);
    report.needsModel = /choose a voice model in Settings/.test((await panel(view.id!, 'read')).body);
    report.openSettingsLink = (await panel(view.id!, 'read')).body.includes('Open Settings');
    report.noModelImage = await chrome.tabs.captureVisibleTab(view.windowId, { format: 'png' });
    await chrome.tabs.remove(view.id!);

    // Settings: without a key nothing can be chosen; with one, the OpenAI provider's voice model is offered.
    const settings = await chrome.tabs.create({ url: chrome.runtime.getURL('/options.html#providers'), active: true });
    await waitForLoad(settings.id!);
    await sleep(1200);
    let page = (await options('read')).body ?? '';
    report.voiceCard = /Voice input/.test(page) && /Voice model/.test(page) && /Detect automatically/.test(page);
    report.needsKeyHint = /Add an OpenAI or Google Gemini provider/.test(page);
    await chrome.storage.local.set({ 'nb.keys': { [VOICE_PROVIDER.id]: 'sk-fixture' } });
    await sleep(600);
    page = (await options('read')).body ?? '';
    report.offered = page.includes('OpenAI · GPT Transcribe');
    report.chosen = (
      await options('select', { label: 'Voice model', value: `${VOICE_PROVIDER.id}\u0000gpt-transcribe` })
    ).ok;
    await options('select', { label: 'Language', value: 'en-US' });
    await sleep(400);
    report.image = await chrome.tabs.captureVisibleTab(settings.windowId, { format: 'png' });
    await chrome.tabs.remove(settings.id!);
    const saved = (await chrome.storage.local.get('nb.settings'))['nb.settings'] as Record<string, unknown> & {
      voiceModel?: { model?: string } | null;
      dictationLanguage?: string;
    };
    report.savedModel = saved?.voiceModel?.model === 'gpt-transcribe' && saved?.dictationLanguage === 'en-US';

    // Record from the fake microphone, stop, and the fake voice model's text lands in the message box.
    await fetch(`${FIXTURES}/__llm/reset`, { method: 'POST' });
    view = await openPanelTab();
    await panel(view.id!, 'fill', { label: 'Ask anything…', text: 'Please' });
    await panel(view.id!, 'click', { label: 'Voice input' });
    // Recording starts once Chrome opens the microphone; then a second of the fake microphone's tone is recorded.
    let recording = await panel(view.id!, 'read');
    for (let i = 0; i < 50 && !(recording.buttons ?? []).includes('Stop recording'); i++) {
      await sleep(100);
      recording = await panel(view.id!, 'read');
    }
    report.recording = (recording.buttons ?? []).includes('Stop recording');
    if (!report.recording) report.afterPress = recording.body.slice(-400);
    await sleep(1000);
    await panel(view.id!, 'click', { label: 'Stop recording' });
    const input = await waitForInput(view.id!, SENTENCE);
    report.input = input;
    report.transcribed = input.endsWith(SENTENCE);
    const [sent] = (await (await fetch(`${FIXTURES}/__llm/transcriptions`)).json()) as Array<Record<string, unknown>>;
    report.request = sent ?? null;
    report.wavSent =
      sent?.model === 'gpt-transcribe' &&
      sent?.language === 'en' &&
      sent?.responseFormat === 'json' &&
      sent?.timestamps === false &&
      sent?.wav === true &&
      Number(sent?.seconds) >= 0.5;
    await chrome.tabs.remove(view.id!);

    const mic = await chrome.tabs.create({ url: chrome.runtime.getURL('/permission.html'), active: true });
    await waitForLoad(mic.id!);
    await sleep(600);
    const [title] = await chrome.tabs.query({ active: true, currentWindow: true });
    report.micPage = title?.title === 'Microphone for Nanobrowser';
    await chrome.tabs.remove(mic.id!);

    await chrome.storage.local.set({
      'nb.keys': {},
      'nb.settings': { ...saved, voiceModel: null, dictationLanguage: 'auto' },
    });
    const failed = Object.entries(report).filter(([, v]) => v === false);
    if (failed.length)
      throw new Error(
        JSON.stringify({ ...report, image: undefined, noModelImage: undefined, page: page.slice(0, 600) }),
      );
    return report;
  },
});
