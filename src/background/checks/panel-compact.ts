// `/compact` in the panel: an idle conversation is compacted on demand with its model. The notice appears in the
// transcript, the transcript itself keeps every message, and the next request carries the user's messages, the summary
// in its notes block and the ledger.
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { FIXTURE_PROVIDER, panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

defineCheck({
  name: 'panel-compact',
  title: '/compact in the panel',
  description: 'Three long answers, /compact, then a message: the notice, the kept messages and the notes block.',
  async run() {
    await seedFixtureModel();
    // A small window, so three long answers are enough to have an older part. Every run has the full tool list (about
    // 9,000 tokens with the system prompt): in 24k, two answers of about 2,850 tokens stay under the threshold (65%),
    // and three are more than the recent part (30%).
    const settings = (await chrome.storage.local.get('nb.settings'))['nb.settings'] ?? {};
    await chrome.storage.local.set({
      'nb.providers': [
        { ...FIXTURE_PROVIDER, models: [{ name: 'fixture-model', overrides: { contextWindow: 24_576 } }] },
      ],
    });
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('/sidepanel.html'), active: true });
    await waitForLoad(tab.id!);
    await sleep(600);
    const id = tab.id!;
    const long = (n: number) => `Answer ${n}. ` + 'Details of the flat listings. '.repeat(380);
    try {
      for (const n of [1, 2, 3]) {
        await scriptReplies([{ text: long(n) }]);
        await panel(id, 'type-send', { text: `Question ${n} about flats` });
        await waitForText(id, `Answer ${n}.`);
        for (let i = 0; i < 200 && (await panel(id, 'read')).status !== 'Done'; i++) await sleep(150);
      }
      await scriptReplies([{ text: '## Progress\nAnswered three questions about flats.\n## Data gathered\nNone.' }]);
      await panel(id, 'type-send', { text: '/compact' });
      const after = await waitForText(id, 'Earlier steps were compacted');
      const requests = (await (await fetch('http://localhost:8787/__llm/requests')).json()) as Array<{
        tools?: unknown[];
      }>;
      const summaryRequest = requests.at(-1)!;
      await scriptReplies([{ text: 'Still with you.' }]);
      await panel(id, 'type-send', { text: 'Question 4' });
      await waitForText(id, 'Still with you.');
      const next = JSON.stringify(
        ((await (await fetch('http://localhost:8787/__llm/requests')).json()) as unknown[]).at(-1),
      );
      const report = {
        notice: after.transcript.split('\n').find(l => l.includes('Earlier steps were compacted')),
        transcriptKeepsAnswers: after.transcript.includes('Answer 1.'),
        summaryCallHadNoTools: !summaryRequest.tools || summaryRequest.tools.length === 0,
        userMessagesKept:
          [1, 2, 3].every(n => next.includes(`Question ${n} about flats`)) && next.includes('Question 4'),
        summaryInNotes: next.includes('<agent-notes>') && next.includes('Answered three questions about flats'),
        oldAnswerGone: !next.includes('Answer 1. '),
        image: await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }),
      };
      const failed = Object.entries(report).filter(([, v]) => v === false || v === undefined);
      if (failed.length) throw new Error(JSON.stringify({ ...report, image: undefined }));
      return report;
    } finally {
      await chrome.storage.local.set({ 'nb.providers': [FIXTURE_PROVIDER], 'nb.settings': settings });
      await chrome.tabs.remove(id).catch(() => undefined);
    }
  },
});
