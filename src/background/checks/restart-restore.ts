// Restarts: stored state as a stopped worker leaves it, then the restore that runs at worker start. Four cases: a run
// cut off mid-batch, whose queued message stays stored until a panel has it; a hand-over that fill_form met after
// setting two fields; the same with the tab gone; a run stored as paused by the Take over the panel once had, with a
// panel that subscribed before the restore.
import { runManager } from '@src/extension/index';
import type { PanelConnection } from '@src/extension/run-manager';
import type { PanelEvent } from '@src/ui/protocol';
import {
  activeBranch,
  appendEntry,
  createConversation,
  getConversation,
  getRun,
  putRun,
} from '@src/store/conversations';
import type { Entry, RunRecord } from '@src/store/types';
import { EMPTY_GUARDS, ZERO_USAGE } from '@src/store/types';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { defineCheck } from './registry';
import { sleep, waitForLoad } from './helpers';
import { scriptReplies, seedFixtureModel } from './panel-chat';

function record(conversationId: string, patch: Partial<RunRecord>): RunRecord {
  const now = new Date().toISOString();
  return {
    conversationId,
    runId: 'before-restart',
    leafEntryId: null,
    status: 'running',
    steering: [],
    turns: 1,
    usage: ZERO_USAGE,
    debt: [],
    guards: EMPTY_GUARDS,
    tabs: [],
    startedAt: now,
    updatedAt: now,
    ...patch,
  };
}

const results = (branch: Entry[]) =>
  Object.fromEntries(
    branch.flatMap(e =>
      e.type === 'message' && e.message.role === 'tool'
        ? e.message.parts.flatMap(p => (p.type === 'tool-result' ? [[p.toolCallId, p.text]] : []))
        : [],
    ),
  ) as Record<string, string>;

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string): Promise<T> {
  for (let i = 0; i < 80; i++) {
    const v = await read();
    if (ok(v)) return v;
    await sleep(150);
  }
  throw new Error(`${what}: ${JSON.stringify(await read())}`);
}

async function handoverCase(tabId: number) {
  const c = await createConversation({
    mode: 'ask',
    title: 'Pay',
  });
  await runManager.scope.add(c.id, tabId, 'start').catch(() => undefined);
  await appendEntry(c.id, {
    type: 'message',
    message: { role: 'user', parts: [{ type: 'text', text: 'Fill in and pay' }] },
  });
  await appendEntry(c.id, {
    type: 'message',
    message: {
      role: 'assistant',
      parts: [
        { type: 'tool-call', toolCallId: 'f', toolName: 'fill_form', input: { fields: [] } },
        { type: 'tool-call', toolCallId: 'g', toolName: 'click', input: {} },
      ],
    },
  });
  await appendEntry(c.id, { type: 'intent', toolCallId: 'f', tool: 'fill_form', args: {} });
  await putRun(
    record(c.id, {
      status: 'awaiting_user',
      tabs: [tabId],
      pendingPrompt: {
        kind: 'handover',
        request: { details: { reason: 'pay', target: 'button «Place order»', site: 'localhost:8787' }, tabId },
        openedAt: new Date().toISOString(),
        answers: { toolCallId: 'f', partialResult: { ok: false, data: { receipts: [{}, {}], submitted: false } } },
      },
    }),
  );
  return c.id;
}

defineCheck({
  name: 'restart-restore',
  title: 'Restarts',
  description:
    'Restores stored runs as a worker start does: an interrupted batch, a hand-over after fill_form, the same with the tab gone.',
  async run() {
    await seedFixtureModel();
    const report: Record<string, unknown> = {};

    // 1. A run cut off mid-batch.
    const a = await createConversation({ mode: 'ask', title: 'Cut off' });
    await appendEntry(a.id, { type: 'message', message: { role: 'user', parts: [{ type: 'text', text: 'Do it' }] } });
    await appendEntry(a.id, {
      type: 'message',
      message: {
        role: 'assistant',
        parts: [
          { type: 'tool-call', toolCallId: 'r', toolName: 'read', input: {} },
          { type: 'tool-call', toolCallId: 'm', toolName: 'click', input: { target: { ref: 'a1' } } },
          { type: 'tool-call', toolCallId: 'n', toolName: 'click', input: { target: { ref: 'a2' } } },
        ],
      },
    });
    await appendEntry(a.id, { type: 'intent', toolCallId: 'r', tool: 'read', args: {} });
    await appendEntry(a.id, { type: 'intent', toolCallId: 'm', tool: 'click', args: {} });
    await putRun(
      record(a.id, {
        status: 'running',
        steering: [{ id: 'q', text: 'queued before the restart', attachments: [], at: '' }],
      }),
    );

    // 2. A hand-over that fill_form met after setting two fields.
    const page = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/g-handover.html`, active: false });
    await waitForLoad(page.id!);
    const b = await handoverCase(page.id!);
    // 3. The same with the tab gone.
    const gone = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/g-handover.html`, active: false });
    await waitForLoad(gone.id!);
    const c = await handoverCase(gone.id!);
    await chrome.tabs.remove(gone.id!);

    // 4. A run stored as paused by an older build, with a message queued, and a panel already open on it.
    const d = await createConversation({ mode: 'ask', title: 'Taken over' });
    await appendEntry(d.id, { type: 'message', message: { role: 'user', parts: [{ type: 'text', text: 'Go' }] } });
    await putRun(
      record(d.id, {
        status: 'paused' as RunRecord['status'],
        reason: 'take-over',
        steering: [{ id: 'p', text: 'queued while taken over', attachments: [], at: '' }],
      }),
    );
    const seen: PanelEvent[] = [];
    const early: PanelConnection = { tabId: null, conversationId: null, sink: event => void seen.push(event) };
    runManager.connections.add(early);
    await runManager.handle(early, { type: 'subscribe', tabId: page.id!, conversationId: d.id });

    await scriptReplies([
      { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Paid by the user.' } }] },
    ]);
    await runManager.restore();

    // Case 4: the open panel learns the restored status and gets the queued message; the record then lets it go.
    runManager.connections.delete(early);
    early.unsubscribe?.();
    const status = seen.filter(e => e.type === 'run_status').at(-1);
    const handed = seen.find(e => e.type === 'queue' && e.returned?.length);
    report.takenOver = { status: status?.type === 'run_status' ? status.status : null, handed: !!handed };
    if (status?.type !== 'run_status' || status.status !== 'stopped') throw new Error('case 4: no stopped status sent');
    if (handed?.type !== 'queue' || handed.returned?.[0]?.text !== 'queued while taken over')
      throw new Error('case 4: the queued message did not reach the open panel');
    await until(
      async () => (await getRun(d.id))?.steering.length,
      n => n === 0,
      'case 4: the record still holds the delivered message',
    );
    if ((await getRun(d.id))?.status !== 'stopped') throw new Error('case 4: not stored as stopped');

    // Case 1's queued message waits in the record while no panel is open, so another restart keeps it.
    report.cutOffKept = (await getRun(a.id))?.steering.map(q => q.text);
    if ((await getRun(a.id))?.steering[0]?.text !== 'queued before the restart')
      throw new Error('case 1: the queued message is not kept until a panel has it');

    const ra = results(await activeBranch(a.id));
    report.cutOff = { status: (await getRun(a.id))?.status, ...ra };
    if ((await getRun(a.id))?.status !== 'interrupted') throw new Error('case 1: not interrupted');
    if (
      !/^error INTERRUPTED \(nothing dispatched/.test(ra.r) ||
      !/delivery unknown/.test(ra.m) ||
      !/^skipped: the extension restarted/.test(ra.n)
    ) {
      throw new Error(`case 1 results: ${JSON.stringify(ra)}`);
    }

    // Only the cards open again, with "If you already did this, press Done".
    const cardB = await until(
      async () => runManager.broker.promptsOf(b)[0],
      p => !!p,
      'case 2 card',
    );
    const cardC = await until(
      async () => runManager.broker.promptsOf(c)[0],
      p => !!p,
      'case 3 card',
    );
    report.cards = [cardB.data.restarted, cardC.data.restarted];
    if (!cardB.data.restarted) throw new Error('case 2: the card does not say it reopened');
    await runManager.broker.answer(cardB.id, 'given-back');
    await runManager.broker.answer(cardC.id, 'given-back');
    const rb = await until(
      async () => results(await activeBranch(b)),
      r => !!r.f,
      'case 2 result',
    );
    report.handover = rb.f.split('\n').slice(0, 2);
    if (
      !/fill_form: 2 fields were set before the step\./.test(rb.f) ||
      !/hand-over: the user did the step \(pay\)/.test(rb.f)
    ) {
      throw new Error(`case 2 result: ${rb.f}`);
    }
    // Nothing was set again: the fresh observation shows the card's fields as they were (empty here).
    const nameLine = rb.f.split('\n').find(l => /textbox "Name on card"/.test(l)) ?? '';
    report.nameField = nameLine.trim();
    if (/ = /.test(nameLine)) throw new Error(`case 2: a field was set again: ${nameLine}`);
    // The run continues after Done: the fake model's done ends it.
    await until(
      async () => (await getConversation(b))?.status,
      s => s === 'done' || s === 'failed',
      'case 2 run continues',
    );
    if ((await getConversation(b))?.status !== 'done') {
      const notice = (await activeBranch(b))
        .filter(e => e.type === 'ui')
        .map(e => JSON.stringify(e.type === 'ui' && e.data));
      throw new Error(`case 2 run failed: ${notice.join(' | ')}`);
    }
    const rc = await until(
      async () => results(await activeBranch(c)),
      r => !!r.f,
      'case 3 result',
    );
    report.tabGone = rc.f;
    if (!/outcome unknown: the tab is gone/.test(rc.f) || (await getRun(c))?.status !== 'interrupted') {
      throw new Error(`case 3: ${rc.f} ${(await getRun(c))?.status}`);
    }
    await chrome.tabs.remove(page.id!).catch(() => undefined);
    return report;
  },
});
