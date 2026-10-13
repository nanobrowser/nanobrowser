// The reasoning effort end to end: the panel sends through the worker to the fixture server's fake model, and the
// recorded requests show what reached the wire. A two-step task at Low sends `reasoning_effort: 'low'` on every turn,
// each request begins with the one before and ends with a header; an unknown model at None sends nothing; a server that
// refuses the field gets the same request without it, one notice, nothing stored, and the option again on the next run;
// a reply that is all reasoning ends the turn with its message; the model picker writes the live pair and the settings.
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { FIXTURE_PROVIDER, panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

const LLM = 'http://localhost:8787/__llm';

interface Recorded {
  reasoning_effort?: string;
  messages: Array<{ role: string; content: unknown }>;
}

async function requests(): Promise<Recorded[]> {
  return (await (await fetch(`${LLM}/requests`)).json()) as Recorded[];
}

async function reset(): Promise<void> {
  await fetch(`${LLM}/reset`, { method: 'POST' });
}

/** The text of a recorded message, for the header check. */
function text(message: Recorded['messages'][number] | undefined): string {
  if (!message) return '';
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
}

async function until(read: () => Promise<string>, ok: (v: string) => boolean, what: string): Promise<string> {
  for (let i = 0; i < 80; i++) {
    const v = await read();
    if (ok(v)) return v;
    await sleep(150);
  }
  throw new Error(`${what}: ${await read()}`);
}

/** A fixture page with its panel view, the model entry seeded with what a test learnt. */
async function openPanel(reasoningSupport?: 'optional') {
  await seedFixtureModel();
  const settings = (await chrome.storage.local.get('nb.settings'))['nb.settings'] ?? {};
  await chrome.storage.local.set({
    'nb.providers': [
      {
        ...FIXTURE_PROVIDER,
        models: [
          {
            ...FIXTURE_PROVIDER.models[0],
            ...(reasoningSupport ? { tested: { reasons: true, acceptsNone: true, at: '' } } : {}),
          },
          { name: 'fixture-model-2', overrides: { contextWindow: 32768 } },
        ],
      },
    ],
    'nb.settings': { ...settings, reasoning: 'low' },
  });
  const page = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/c-text.html`, active: false });
  await waitForLoad(page.id!);
  const view = await chrome.tabs.create({ url: chrome.runtime.getURL(`/sidepanel.html#tab=${page.id}`), active: true });
  await waitForLoad(view.id!);
  await sleep(600);
  const id = page.id!;
  const status = () =>
    until(
      async () => (await panel(id, 'read')).status,
      s => /Done|Failed|Stopped/.test(s),
      'end',
    );
  const conversationId = async () => {
    const scope = (await chrome.storage.session.get('nb.scope'))['nb.scope'] as
      { tabs: Record<string, { conversationId: string }> } | undefined;
    return scope?.tabs[id]?.conversationId ?? '';
  };
  const close = async () => {
    await chrome.tabs.remove(view.id!).catch(() => undefined);
    await chrome.tabs.remove(page.id!).catch(() => undefined);
  };
  return { id, status, conversationId, close };
}

defineCheck({
  name: 'model-config',
  title: 'The reasoning effort on the wire',
  description:
    'Low on every turn with an append-only request, None for an unknown model, the fallback, an all-reasoning reply, and the picker writing the pair and the settings.',
  async run() {
    const report: Record<string, unknown> = {};

    // 1. A two-step task at Low on a model the probe found to reason.
    {
      const p = await openPanel('optional');
      try {
        await scriptReplies([{ toolCalls: [{ name: 'read', input: {} }] }, { text: 'Finished at Low.' }]);
        await panel(p.id, 'type-send', { text: 'Read the page' });
        await waitForText(p.id, 'Finished at Low.');
        await p.status();
        const sent = await requests();
        report.lowOnEveryTurn = sent.length === 2 && sent.every(r => r.reasoning_effort === 'low');
        report.appendOnly = sent.slice(1).every((r, i) => {
          const before = sent[i].messages;
          return JSON.stringify(r.messages.slice(0, before.length)) === JSON.stringify(before);
        });
        report.endsWithHeader = sent.every(r => text(r.messages.at(-1)).includes('<browser-state>'));
        const key = `nb.live.${await p.conversationId()}`;
        report.keyWritten = (await chrome.storage.session.get(key))[key];
        // The picker: a model chosen in a conversation is its own and the default.
        await panel(p.id, 'select', { label: 'Model', value: 'fixture:fixture-model-2' });
        await sleep(400);
        const live = (await chrome.storage.session.get(key))[key] as { model: { model: string }; reasoning: string };
        const settings = (await chrome.storage.local.get('nb.settings'))['nb.settings'] as {
          defaultModel: { model: string };
          reasoning: string;
        };
        report.pickerWritesPair = live.model.model === 'fixture-model-2' && live.reasoning === 'low';
        report.pickerWritesSettings = settings.defaultModel.model === 'fixture-model-2' && settings.reasoning === 'low';
      } finally {
        await p.close();
      }
    }

    // 1b. A new chat holds the pair it made: defaults changed elsewhere before its first message do not reach it.
    {
      const p = await openPanel('optional');
      try {
        const settings = (await chrome.storage.local.get('nb.settings'))['nb.settings'] ?? {};
        await chrome.storage.local.set({ 'nb.settings': { ...settings, reasoning: 'high' } });
        await sleep(300);
        await scriptReplies([{ text: 'Held the draft.' }]);
        await panel(p.id, 'type-send', { text: 'Which effort?' });
        await waitForText(p.id, 'Held the draft.');
        await p.status();
        report.draftHeld = (await requests())[0]?.reasoning_effort === 'low';
      } finally {
        await p.close();
      }
    }

    // 2. An unknown model at None (the pair made from the settings): nothing is sent.
    {
      const p = await openPanel();
      try {
        await scriptReplies([{ text: 'Finished at None.' }]);
        await panel(p.id, 'type-send', { text: 'Say hello' });
        await waitForText(p.id, 'Finished at None.');
        await p.status();
        const sent = await requests();
        report.unknownSendsNothing = sent.length === 1 && sent[0].reasoning_effort === undefined;
      } finally {
        await p.close();
      }
    }

    // 3. A server that refuses the field.
    {
      const p = await openPanel('optional');
      try {
        await fetch(`${LLM}/script`, {
          method: 'POST',
          body: JSON.stringify({ replies: [{ text: 'Finished without it.' }], rejectReasoning: true }),
        });
        await panel(p.id, 'type-send', { text: 'First run' });
        await waitForText(p.id, 'Finished without it.');
        await p.status();
        const first = await requests();
        report.retriedWithout =
          first.length === 2 && first[0].reasoning_effort === 'low' && first[1].reasoning_effort === undefined;
        report.sameRequest = JSON.stringify(first[0].messages) === JSON.stringify(first[1]?.messages ?? null);
        report.notice = (await panel(p.id, 'read')).transcript.includes(
          'This model did not take the reasoning setting; continuing without it.',
        );
        const providers = (await chrome.storage.local.get('nb.providers'))['nb.providers'] as Array<{
          models: Array<{ name: string; tested?: { reasons?: boolean; acceptsNone?: boolean } }>;
        }>;
        // A refused level is not stored.
        const tested = providers[0].models[0].tested;
        report.nothingStored = tested?.reasons === true && tested.acceptsNone === true;
        await reset();
        await scriptReplies([{ text: 'Second run.' }]);
        await panel(p.id, 'type-send', { text: 'Second run' });
        await waitForText(p.id, 'Second run.');
        await p.status();
        report.sentAgainNextRun = (await requests())[0]?.reasoning_effort === 'low';
      } finally {
        await p.close();
      }
    }

    // 4. A reply that is all reasoning.
    {
      const p = await openPanel('optional');
      try {
        await scriptReplies([{ text: '', finish: 'length', reasoningTokens: 400 }]);
        await panel(p.id, 'type-send', { text: 'Think hard' });
        await waitForText(p.id, "The model's reply was cut before it said anything");
        report.allReasoningStatus = await p.status();
      } finally {
        await p.close();
      }
    }

    const failed = Object.entries(report).filter(([k, v]) =>
      k === 'keyWritten' ? !v : k === 'allReasoningStatus' ? v !== 'Failed' : v !== true,
    );
    if (failed.length) throw new Error(`model-config: ${JSON.stringify(report)}`);
    return report;
  },
});
