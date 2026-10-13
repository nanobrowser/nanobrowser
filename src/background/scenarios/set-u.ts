// Fixture set U: uploads. The layer's `upload` on u-upload.html: bytes into a plain input, several into a multiple
// input, the intercepted file chooser of a button and of a drop zone, the read-back, the write gate, and the sources a
// session accepts.
import type { Result, Session, SessionConfig } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { evaluate, sleep } from '../checks/helpers';
import { layer } from '../layer';
import { setResponder } from '../prompts';
import { defineScenario, outcome } from './registry';
import type { ScenarioContext } from './registry';
import { refOf } from './set-c';
import { lastToolText, refIn, runAgent } from './set-f';
import type { ScriptedCall, ScriptedReply } from '@src/llm';

const PAGE = `${FIXTURE_ORIGIN}/u-upload.html`;

const b64 = (text: string) => btoa(text);
const file = (name: string, text: string, mimeType = 'text/plain') => ({ name, mimeType, base64: b64(text) });

const opened: Session[] = [];

async function uploadSession(ctx: ScenarioContext, config: SessionConfig = {}) {
  const { controller } = await layer();
  const session = controller.createSession({ capabilities: ['files'], confirm: 'never', ...config });
  opened.push(session);
  const tabId = await ctx.open(PAGE, { attach: false });
  session.shareTab(tabId);
  const call = (tool: string, args: Record<string, unknown> = {}) => session.call(tool, { tabId, ...args });
  const text = (id: string) =>
    evaluate<string>(tabId, undefined, `document.getElementById(${JSON.stringify(id)}).textContent`);
  return { session, tabId, call, text, controller };
}

function scenario(
  id: string,
  title: string,
  covers: string,
  run: (ctx: ScenarioContext) => Promise<ReturnType<typeof outcome>>,
) {
  defineScenario({
    id,
    set: 'U',
    title,
    covers,
    async run(ctx) {
      try {
        return await run(ctx);
      } finally {
        const { controller } = await layer();
        for (const s of opened.splice(0)) await controller.closeSession(s);
      }
    },
  });
}

const line = (r: Result) => r.text.split('\n').find(l => l.startsWith('upload')) ?? r.error?.code ?? '';

scenario(
  'U-8.3-bytes',
  'Bytes into a plain file input; the page reads them',
  'probe File and DataTransfer; read-back',
  async ctx => {
    const u = await uploadSession(ctx);
    const r = await u.call('upload', {
      target: { ref: refOf(await u.call('snapshot'), /Document/) },
      attachments: [file('notes.txt', 'Kettle: 49.90 euros')],
    });
    await sleep(200);
    const status = await u.text('doc-status');
    return outcome(
      'ok; the read-back met; the page read the text',
      `${line(r)} | ${r.receipt?.postcondition?.status} ${r.receipt?.postcondition?.detail} | ${status}`,
      r.ok && r.receipt?.postcondition?.status === 'met' && status === 'notes.txt 19: Kettle: 49.90 euros',
    );
  },
);

scenario('U-8.3-multiple', 'Two files into a multiple input; one input refuses two', 'upload', async ctx => {
  const u = await uploadSession(ctx);
  const snap = await u.call('snapshot');
  const two = [file('a.png', 'aaaa', 'image/png'), file('b.png', 'bbbbbb', 'image/png')];
  const many = await u.call('upload', { target: { ref: refOf(snap, /Photos/) }, attachments: two });
  const one = await u.call('upload', { target: { ref: refOf(snap, /Document/) }, attachments: two });
  await sleep(200);
  const status = await u.text('photos-status');
  return outcome(
    'photos: both files; document: INVALID_ARGUMENT',
    `${status} | ${one.error?.code}`,
    many.ok && status === 'a.png 4; b.png 6' && one.error?.code === 'INVALID_ARGUMENT',
  );
});

scenario(
  'U-8.3-chooser',
  'A button opens a hidden input: the chooser is intercepted, and upload fills it',
  'file-chooser modal',
  async ctx => {
    const u = await uploadSession(ctx);
    const click = await u.call('click', { target: { ref: refOf(await u.call('snapshot'), /button "Choose a file"/) } });
    await sleep(300);
    const pendingAfterClick = JSON.stringify(u.controller.tabState(u.tabId).pending);
    const blocked = await u.call('click', { target: { role: 'button', name: 'Drop files here' } });
    const r = await u.call('upload', { attachments: [file('cv.txt', 'Curriculum')] });
    await sleep(200);
    const status = await u.text('hidden-status');
    return outcome(
      'a pending file-chooser modal; other actions MODAL_PENDING; upload without a target fills the hidden input',
      `${click.ok} ${pendingAfterClick} | ${blocked.error?.code} | ${line(r)} | ${status} | pending ${u.controller.tabState(u.tabId).pending.length}`,
      pendingAfterClick.includes('file-chooser') &&
        blocked.error?.code === 'MODAL_PENDING' &&
        r.ok &&
        status === 'cv.txt 10' &&
        u.controller.tabState(u.tabId).pending.length === 0,
    );
  },
);

scenario(
  'U-8.3-dropzone',
  'A drop zone with a hidden input: click, then upload two files',
  'React dropzones',
  async ctx => {
    const u = await uploadSession(ctx);
    await u.call('click', { target: { role: 'button', name: 'Drop files here' } });
    await sleep(300);
    const r = await u.call('upload', {
      attachments: [file('x.csv', 'a,b\n1,2', 'text/csv'), file('y.json', '{}', 'application/json')],
    });
    await sleep(200);
    const status = await u.text('zone-status');
    return outcome('both files in the zone', `${line(r)} | ${status}`, r.ok && status === 'x.csv 7; y.json 2');
  },
);

scenario('U-8.3-dismiss', 'A file chooser is dismissed with handle_dialog', 'modal states', async ctx => {
  const u = await uploadSession(ctx);
  await u.call('click', { target: { role: 'button', name: 'Choose a file' } });
  await sleep(300);
  const accept = await u.call('handle_dialog', { accept: true });
  const dismiss = await u.call('handle_dialog', { accept: false });
  return outcome(
    'accept refused; dismiss clears the modal',
    `${accept.error?.code} | ${dismiss.ok} | pending ${u.controller.tabState(u.tabId).pending.length}`,
    accept.error?.code === 'INVALID_ARGUMENT' && dismiss.ok && u.controller.tabState(u.tabId).pending.length === 0,
  );
});

scenario('U-8.3-not-an-input', 'A button is not a file input', 'upload targets', async ctx => {
  const u = await uploadSession(ctx);
  const r = await u.call('upload', {
    target: { ref: refOf(await u.call('snapshot'), /button "Send document"/) },
    attachments: [file('a.txt', 'a')],
  });
  return outcome(
    'NOT_INTERACTABLE, with the way to do it',
    `${r.error?.code}: ${r.error?.message}`,
    r.error?.code === 'NOT_INTERACTABLE',
  );
});

scenario(
  'U-8.3-sources',
  'A session that takes bytes only refuses paths; a bad path is caught by the read-back',
  'the sources a session accepts',
  async ctx => {
    const bytesOnly = await uploadSession(ctx, { uploadSources: ['attachments'] });
    const refused = await bytesOnly.call('upload', {
      target: { role: 'textbox', name: 'Document' },
      paths: ['/etc/passwd'],
    });
    const both = await uploadSession(ctx);
    const bad = await both.call('upload', {
      target: { ref: refOf(await both.call('snapshot'), /Document/) },
      paths: ['/nonexistent/kq7-file.txt'],
    });
    return outcome(
      'bytes-only: CAPABILITY_DISABLED; a missing path: the read-back is not met',
      `${refused.error?.code} | ${bad.ok} ${bad.receipt?.postcondition?.status} ${bad.receipt?.postcondition?.detail ?? bad.error?.code}`,
      refused.error?.code === 'CAPABILITY_DISABLED' && (!bad.ok || bad.receipt?.postcondition?.status !== 'met'),
    );
  },
);

scenario(
  'U-8.3-write',
  'An upload is a write: asked in Ask mode, declined leaves the input empty',
  'upload is a write',
  async ctx => {
    const cards: string[] = [];
    const previous = setResponder((prompt, answer) => {
      if (prompt.kind === 'confirm') cards.push(`${prompt.request.category}: ${prompt.request.target}`);
      answer(prompt.kind === 'confirm' ? 'decline' : { outcome: 'cancel' });
    });
    try {
      const u = await uploadSession(ctx, {
        handover: true,
        decideWrite: () => ({ decision: 'ask', canRemember: true }),
      });
      const r = await u.call('upload', {
        target: { ref: refOf(await u.call('snapshot'), /Document/) },
        attachments: [file('secret.txt', 'kq7canary')],
      });
      await sleep(200);
      const status = await u.text('doc-status');
      return outcome(
        'one card of category upload; USER_DECLINED; nothing set',
        `${JSON.stringify(cards)} | ${r.error?.code} | ${status}`,
        cards.length === 1 &&
          cards[0].startsWith('upload') &&
          r.error?.code === 'USER_DECLINED' &&
          status === 'No document',
      );
    } finally {
      setResponder(previous);
    }
  },
);

scenario(
  'U-8.3-submit',
  'The site receives the file when the form is sent',
  'what the receipt does not prove',
  async ctx => {
    await fetch('http://localhost:8787/__reset', { method: 'POST' });
    const u = await uploadSession(ctx);
    const snap = await u.call('snapshot');
    await u.call('upload', {
      target: { ref: refOf(snap, /Document/) },
      attachments: [file('report.txt', 'Quarterly numbers')],
    });
    await u.call('click', { target: { ref: refOf(snap, /button "Send document"/) } });
    await sleep(500);
    const { posts } = (await (await fetch('http://localhost:8787/__requests')).json()) as {
      posts: Array<{ body: string }>;
    };
    const body = posts.at(-1)?.body ?? '';
    return outcome(
      'the multipart body holds the file name and its text',
      body.slice(0, 200).replace(/\r?\n/g, ' '),
      /filename="report\.txt"/.test(body) && body.includes('Quarterly numbers'),
    );
  },
);

scenario(
  'U-8.3-interception-off',
  'With interception off, a chooser is not a pending modal',
  'the user’s own file dialog',
  async ctx => {
    const u = await uploadSession(ctx);
    await u.call('snapshot');
    await u.controller.setFileChooserInterception(u.tabId, false);
    await u.call('click', { target: { role: 'button', name: 'Choose a file' } });
    await sleep(300);
    const pending = u.controller.tabState(u.tabId).pending.length;
    await u.controller.setFileChooserInterception(u.tabId, true);
    return outcome('no pending modal', `pending ${pending}`, pending === 0);
  },
);

// --- The agent's `upload` --------------------------------------------------------------------------------------------

const NOTES = { id: 'att-notes', name: 'notes.txt', mimeType: 'text/plain', text: 'Kettle: 49.90 euros' };

/** A session as the agent's: attachments only, and writes decided by the mode or a site rule. */
function agentWrites(decision: 'run' | 'ask', by?: 'site-rule' | 'auto') {
  return { decideWrite: () => ({ decision, by, canRemember: true }) } as const;
}

function uploadScript(attachmentIds: unknown, target = true) {
  return (call: ScriptedCall, i: number): ScriptedReply => {
    if (i === 0) return { toolCalls: [{ name: 'snapshot', input: {}, id: 's' }] };
    if (i === 1) {
      const input: Record<string, unknown> = { attachmentIds };
      if (target) input.target = { ref: refIn(lastToolText(call), /button "Document"/) };
      return { toolCalls: [{ name: 'upload', input, id: 'u' }] };
    }
    return { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Uploaded.' }, id: 'd' }] };
  };
}

async function withCards<T>(answer: 'approve' | 'decline', run: (cards: string[]) => Promise<T>): Promise<T> {
  const cards: string[] = [];
  const previous = setResponder((prompt, reply) => {
    if (prompt.kind === 'confirm') cards.push(`${prompt.request.category}: ${prompt.request.target}`);
    reply(prompt.kind === 'confirm' ? answer : { outcome: 'cancel' });
  });
  try {
    return await run(cards);
  } finally {
    setResponder(previous);
  }
}

for (const [mode, decision, by] of [
  ['Ask', 'ask', undefined],
  ['Auto', 'run', 'auto'],
  ['Allow site', 'run', 'site-rule'],
] as const) {
  scenario(
    `U-8.4-${mode.toLowerCase().replace(' ', '-')}`,
    `The agent uploads an attached file by its id (${mode})`,
    'an upload shows the card in Ask mode, runs in Auto mode and on an Allow site',
    async ctx =>
      withCards('approve', async cards => {
        const run = await runAgent(ctx, PAGE, uploadScript([NOTES.id]), {
          session: agentWrites(decision, by),
          attachments: [NOTES],
          task: 'Upload my notes as the document.',
        });
        const result = run.results.u ?? '';
        return outcome(
          decision === 'ask' ? 'one upload card, allowed; the input holds the file' : `no card; allowed by ${by}`,
          `cards ${JSON.stringify(cards)} | ${result.split('\n')[0]} | ${run.pageText.match(/notes\.txt[^\n]*/)?.[0] ?? 'not set'}`,
          (decision === 'ask' ? cards.length === 1 && cards[0].startsWith('upload') : cards.length === 0) &&
            /«notes\.txt» \(19 B\)|met/.test(result) &&
            run.pageText.includes('notes.txt 19: Kettle: 49.90 euros') &&
            (decision === 'ask' ||
              result.includes(by === 'site-rule' ? "allowed by the site's rule" : 'allowed by Auto mode')),
        );
      }),
  );
}

scenario(
  'U-8.4-no-paths',
  'The agent cannot upload a path: not in its schema, and refused by its session',
  'the agent uploads attached files only',
  async ctx => {
    const run = await runAgent(
      ctx,
      PAGE,
      (call, i) =>
        i === 0
          ? {
              toolCalls: [
                {
                  name: 'upload',
                  input: { target: { role: 'button', name: 'Document' }, paths: ['/etc/passwd'] },
                  id: 'p',
                },
              ],
            }
          : { toolCalls: [{ name: 'done', input: { outcome: 'failed', summary: 'Refused.' }, id: 'd' }] },
      { session: agentWrites('run', 'auto') },
    );
    const { controller } = await layer();
    const { createAgentSession } = await import('@src/extension/agent-session');
    const direct = createAgentSession(controller);
    opened.push(direct);
    const tabId = await ctx.open(PAGE, { attach: false });
    direct.shareTab(tabId);
    const layerRefusal = await direct.call('upload', {
      tabId,
      target: { role: 'button', name: 'Document' },
      paths: ['/etc/passwd'],
    });
    return outcome(
      'the call is refused before the layer; an agent session refuses paths too; the input stays empty',
      `${run.results.p?.split('\n')[0]} | ${layerRefusal.error?.code} | ${run.pageText.includes('No document')}`,
      /^error/.test(run.results.p ?? '') &&
        layerRefusal.error?.code === 'CAPABILITY_DISABLED' &&
        run.pageText.includes('No document'),
    );
  },
);

scenario(
  'U-8.4-unknown-id',
  'An id of no attached file is refused, and nothing is sent',
  'attachment ids',
  async ctx => {
    const run = await runAgent(ctx, PAGE, uploadScript(['att-of-someone-else']), {
      session: agentWrites('run', 'auto'),
    });
    return outcome(
      'NOT_FOUND; the input stays empty',
      `${run.results.u?.split('\n').slice(0, 2).join(' | ')}`,
      /^error NOT_FOUND/.test(run.results.u ?? '') && run.pageText.includes('No document'),
    );
  },
);

scenario(
  'U-8.4-chooser-stops-batch',
  'A pending file chooser stops the batch; upload without a target fills it',
  'a pending modal stops the batch; upload fills the open chooser',
  async ctx => {
    const run = await runAgent(
      ctx,
      PAGE,
      (call, i) => {
        const text = lastToolText(call);
        if (i === 0) return { toolCalls: [{ name: 'snapshot', input: {}, id: 's' }] };
        if (i === 1)
          return {
            toolCalls: [
              { name: 'click', input: { target: { ref: refIn(text, /button "Choose a file"/) } }, id: 'k' },
              { name: 'click', input: { target: { ref: refIn(text, /button "Send document"/) } }, id: 'x' },
            ],
          };
        if (i === 2) return { toolCalls: [{ name: 'upload', input: { attachmentIds: [NOTES.id] }, id: 'u' }] };
        return { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Chosen.' }, id: 'd' }] };
      },
      { session: agentWrites('run', 'auto'), attachments: [NOTES] },
    );
    return outcome(
      'the click shows the pending chooser; the second click is skipped; the upload fills the hidden input',
      `${/pending file-chooser/.test(run.results.k ?? '')} | ${run.results.x?.split('\n')[0]} | ${run.pageText.match(/notes\.txt \d+/)?.[0]}`,
      /pending file-chooser/.test(run.results.k ?? '') &&
        /^skipped/.test(run.results.x ?? '') &&
        run.pageText.includes('notes.txt 19'),
    );
  },
);

// --- The report of page downloads ------------------------------------------------------------------------------------

const DOWNLOADS = `${FIXTURE_ORIGIN}/u-download.html`;

/** Removes what the download scenarios saved, from disk and from Chrome's list. */
async function removeFixtureDownloads(): Promise<void> {
  for (const item of await chrome.downloads.search({ filenameRegex: 'nb-dl-' })) {
    await chrome.downloads.removeFile(item.id).catch(() => undefined);
    await chrome.downloads.erase({ id: item.id }).catch(() => undefined);
  }
}

for (const [label, pattern, name] of [
  ['the download attribute', /link "Download with the attribute"/, 'nb-dl-attribute.txt'],
  ['the server header', /link "Download by the server's header"/, 'nb-dl-header.txt'],
  ['a form post', /button "Download by a form"/, 'nb-dl-form.txt'],
  ['a page-made blob', /button "Download a page-made file"/, 'nb-dl-blob.txt'],
] as const) {
  scenario(
    `U-8.6-${name.replace('nb-dl-', '').replace('.txt', '')}`,
    `A download the page starts by ${label} is in the action's receipt`,
    'reported, not held; Page.downloadWillBegin through chrome.debugger',
    async ctx => {
      try {
        const { controller } = await layer();
        const session = controller.createSession({ confirm: 'never' });
        opened.push(session);
        const tabId = await ctx.open(DOWNLOADS, { attach: false });
        session.shareTab(tabId);
        const snap = await session.call('snapshot', { tabId });
        const r = await session.call('click', { tabId, target: { ref: refOf(snap, pattern) } });
        await sleep(500);
        const [item] = await chrome.downloads.search({ filenameRegex: name.replace('.', '\\.') });
        const signal = r.receipt?.effect.signals.find(s => s.startsWith('download started')) ?? '';
        return outcome(
          `receipt.downloads names ${name}; the signal quotes it; Chrome saved it (not held)`,
          `${JSON.stringify(r.receipt?.downloads)} | ${signal} | ${item?.state ?? 'no download item'}`,
          r.receipt?.downloads?.some(d => d.name === name) === true &&
            signal.includes(`«${name}»`) &&
            signal.includes('not known') &&
            !!item,
        );
      } finally {
        await removeFixtureDownloads();
      }
    },
  );
}
