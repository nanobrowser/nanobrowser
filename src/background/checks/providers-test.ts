// Settings → Providers: a model is tested when it is added. On a local endpoint (the fixture server is at localhost)
// adding reads only the model's API, with no chat request; Test connection then runs the probes. What the API said is
// stored as `fromApi`.
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { FIXTURE_PROVIDER } from './panel-chat';
import { FIXTURE_ORIGIN } from '../fixtures-config';

const options = (op: string, extra: Record<string, unknown> = {}) =>
  chrome.runtime.sendMessage({ nbTest: 'options', op, ...extra }) as Promise<{ ok: boolean }>;
const LLM = `${FIXTURE_ORIGIN}/__llm`;

interface StoredModel {
  name: string;
  fromApi?: { contextWindow?: number; vision?: boolean; reasons?: boolean };
  noToolCalling?: boolean;
}

const model = async (name: string) =>
  (
    (await chrome.storage.local.get('nb.providers'))['nb.providers'] as Array<{ models: StoredModel[] }>
  )[0]?.models.find(m => m.name === name);
const chatRequests = async () => ((await (await fetch(`${LLM}/requests`)).json()) as unknown[]).length;

async function until(test: () => Promise<boolean>, ms = 5000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await test()) return true;
  return false;
}

defineCheck({
  name: 'providers-test',
  title: 'A model tested when it is added',
  description:
    "Adds a model on a local endpoint and checks that its API's facts are stored with no chat request, then presses Test connection and checks that the probes ran.",
  async run() {
    await fetch(`${LLM}/reset`, { method: 'POST' }).catch(() => undefined);
    await chrome.storage.local.set({ 'nb.providers': [{ ...FIXTURE_PROVIDER, models: [] }] });
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('/options.html#providers'), active: true });
    const report: Record<string, unknown> = {};
    try {
      await waitForLoad(tab.id!);
      await sleep(600);
      const before = await chatRequests();
      await options('fill', { label: 'Add a model', text: 'fixture-model-info' });
      await options('click', { label: 'Add' });
      report.apiRead = await until(async () => (await model('fixture-model-info'))?.fromApi?.contextWindow === 65536);
      const added = await model('fixture-model-info');
      report.fromApi = added?.fromApi;
      report.noChatOnAdd = (await chatRequests()) === before;
      await options('click', { label: 'Test connection' });
      report.probed = await until(async () => (await model('fixture-model-info'))?.noToolCalling !== undefined, 10_000);
      report.chatOnTest = (await chatRequests()) > before;
    } finally {
      await chrome.tabs.remove(tab.id!).catch(() => undefined);
      await chrome.storage.local.remove('nb.providers');
    }
    const fromApi = report.fromApi as StoredModel['fromApi'];
    const ok =
      report.apiRead === true &&
      fromApi?.vision === true &&
      fromApi.reasons === true &&
      report.noChatOnAdd === true &&
      report.probed === true &&
      report.chatOnTest === true;
    if (!ok) throw new Error(`providers-test: ${JSON.stringify(report)}`);
    return report;
  },
});
