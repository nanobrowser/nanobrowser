// The canary sweep: every tool, and the error paths that print page text, run against a page that puts the canary in
// every place a page controls. Every occurrence of the canary in a result's text must be inside a page-content
// boundary or a «…» quote; one anywhere else fails the check and names the call and the line.
import type { Result, Session } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { layer } from '../layer';
import { openTab } from '../tabs';
import { approveAll, setResponder } from '../prompts';
import { ledgerLines, renderLedger, turnsOf, unitsOf } from '@src/agent/compaction';
import { storedResult } from '@src/agent/records';
import type { EntryOf } from '@src/store/types';
import { defineCheck } from './registry';
import { sleep } from './helpers';

export const CANARY = /kq7canary/i;

/** The lines of a text where the canary stands outside every boundary and every quote. */
export function canaryLeaks(text: string): string[] {
  const outside = text
    .replace(/<<<page-content ([0-9a-f]+)[^\n]*>>>[\s\S]*?<<<end-page-content \1>>>/g, '')
    .replace(/«[^«»\n]*»/g, '');
  return outside.split('\n').filter(line => CANARY.test(line));
}

function refOf(text: string, pattern: RegExp): string {
  const line = text.split('\n').find(l => pattern.test(l));
  const ref = line && /\[(\w+)\]/.exec(line)?.[1];
  if (!ref) throw new Error(`no ref for ${pattern} in:\n${text.slice(0, 3000)}`);
  return ref;
}

interface Swept {
  call: string;
  code: string;
  leaks: string[];
  /** For the ledger: the call and its stored result. */
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
}

export async function sweep(session: Session, tabId: number): Promise<Swept[]> {
  const out: Swept[] = [];
  const run = async (label: string, tool: string, args: Record<string, unknown> = {}): Promise<Result> => {
    const result = await session.call(tool, { tabId, ...args });
    out.push({
      call: label,
      code: result.ok ? 'ok' : (result.error?.code ?? 'error'),
      leaks: canaryLeaks(result.text),
      tool,
      args: { tabId, ...args },
      result: storedResult(result),
    });
    return result;
  };
  const page = `${FIXTURE_ORIGIN}/h-canary.html`;
  const snap = async () => {
    const r = await session.call('snapshot', { tabId, window: 'page' });
    return r.page?.snapshot ?? r.text;
  };

  await run('snapshot', 'snapshot', { mode: 'all' });
  let outline = await snap();
  if (!outline.includes('Kq7Canary button')) outline = await snap();
  await run('find', 'find', { name: 'Kq7Canary' });
  await run('read', 'read', {});
  await run('screenshot', 'screenshot', {});
  await run('tabs list', 'tabs', { action: 'list' });
  await run('click with effect and an unmet expectation', 'click', {
    target: { ref: refOf(outline, /button "Kq7Canary button"/) },
    observe: 'diff',
    expect: { text: 'Kq7Canary never shown' },
  });
  outline = await snap();
  await run('set with a read-back', 'set', {
    target: { ref: refOf(outline, /textbox "Kq7Canary field"/) },
    value: 'Kq7Canary typed value',
    expect: { value: 'something else' },
  });
  await run('type', 'type', { target: { ref: refOf(outline, /textbox "Kq7Canary field"/) }, text: ' more Kq7Canary' });
  await run('set a missing option', 'set', {
    target: { ref: refOf(outline, /combobox "Kq7Canary select"/) },
    value: 'Kq7Canary missing option',
  });
  await run('set an option', 'set', {
    target: { ref: refOf(outline, /combobox "Kq7Canary select"/) },
    value: 'Kq7Canary option two',
  });
  await run('click a disabled button', 'click', {
    target: { role: 'button', name: 'Kq7Canary disabled' },
    timeoutMs: 400,
  });
  await run('click a covered button', 'click', {
    target: { role: 'button', name: 'Kq7Canary covered' },
    timeoutMs: 400,
  });
  await run('no match', 'click', { target: { role: 'button', name: 'Kq7Canary nothing' } });
  await run('ambiguous', 'click', { target: { role: 'button' } });
  await run('hover', 'hover', { target: { ref: refOf(outline, /button "Kq7Canary button"/) }, observe: 'diff' });
  await run('scroll', 'scroll', { to: 'bottom', observe: 'diff' });
  await run('wait for missing text', 'wait', { text: 'Kq7Canary never', timeoutMs: 400 });
  await run('wait for text to go', 'wait', { textGone: 'Kq7Canary heading', timeoutMs: 400 });
  await run('invalid key', 'press', { keys: 'Kq7CanaryKey' });
  await run('fill_form', 'fill_form', {
    fields: [
      { target: { ref: refOf(outline, /textbox "Kq7Canary field"/) }, value: 'Kq7Canary filled' },
      { target: { ref: refOf(outline, /textbox "Kq7Canary number"/) }, value: 'Kq7Canary' },
    ],
    observe: 'diff',
  });
  outline = await snap();
  await run('rename a button', 'click', { target: { ref: refOf(outline, /button "Rename me"/) }, observe: 'diff' });
  await run('click it again by its old ref', 'click', { target: { ref: refOf(outline, /button "Rename me"/) } });

  // Dialogs: the message is page text in pending modals, signals, errors and handle_dialog.
  outline = await snap();
  await run('open an alert', 'click', { target: { ref: refOf(outline, /button "Open alert"/) }, observe: 'diff' });
  await run('read while the dialog is open', 'snapshot', {});
  await run('accept the alert', 'handle_dialog', { accept: true });
  outline = await snap();
  await run('open a confirm', 'click', { target: { ref: refOf(outline, /button "Open confirm"/) } });
  await run('dismiss the confirm', 'handle_dialog', { accept: false });

  // Navigation: addresses and titles.
  outline = await snap();
  await run('follow a link', 'click', { target: { ref: refOf(outline, /link "Kq7Canary link"/) }, observe: 'diff' });
  await run('back', 'navigate', { action: 'back', observe: 'diff' });
  outline = await snap();
  await run('a link to a blocked site', 'click', { target: { ref: refOf(outline, /link "Kq7Canary blocked link"/) } });
  outline = await snap();
  const newTab = await run('open a tab from the page', 'click', {
    target: { ref: refOf(outline, /link "Kq7Canary new tab"/) },
  });
  await sleep(500);
  await run('tabs list with two tabs', 'tabs', { action: 'list' });
  if (newTab.receipt?.newTab) await run('close it', 'tabs', { action: 'close', tabId: newTab.receipt.newTab.tabId });
  await run('navigate to an address with the canary', 'navigate', {
    url: `${FIXTURE_ORIGIN}/h-canary-2.html?x=Kq7Canary#Kq7Canary`,
    observe: 'diff',
  });
  await run('navigation that fails', 'navigate', { url: 'http://kq7canary.invalid/' });
  await run('a refused address', 'navigate', { url: 'chrome://kq7canary/' });
  await run('back to the page', 'navigate', { url: page });
  const opened = await run('tabs open', 'tabs', { action: 'open', url: `${FIXTURE_ORIGIN}/h-canary-2.html?Kq7Canary` });
  const openedId = (opened.data as { tabs?: Array<{ tabId: number }>; activeTabId?: number })?.activeTabId;
  if (openedId && openedId !== tabId) {
    await run('tabs list after open', 'tabs', { action: 'list' });
    await session.call('tabs', { action: 'close', tabId: openedId });
  }
  await run('tabs open refused', 'tabs', { action: 'open', url: 'javascript:Kq7Canary' });

  // A download the page starts: its suggested file name is page text in the receipt.
  outline = await snap();
  await run('click a download link', 'click', { target: { ref: refOf(outline, /link "Get the report file"/) } });
  for (const item of await chrome.downloads.search({ filenameRegex: 'Kq7Canary' })) {
    await chrome.downloads.removeFile(item.id).catch(() => undefined);
    await chrome.downloads.erase({ id: item.id }).catch(() => undefined);
  }

  // A form submission: classified, confirmed by the scripted user, and the destination address in the receipt.
  outline = await snap();
  await run('set the query', 'set', { target: { ref: refOf(outline, /textbox "Kq7Canary query"/) }, value: 'x' });
  await run('submit with Enter', 'press', {
    target: { ref: refOf(outline, /textbox "Kq7Canary query"/) },
    keys: 'Enter',
    observe: 'diff',
  });
  return out;
}

/** The ledger the extension would write from these calls, rendered as the note the model reads. */
function ledgerOf(calls: Swept[]): string {
  const entries = calls.flatMap((c, i): Array<EntryOf<'message'>> => {
    const base = { type: 'message' as const, parentId: null, conversationId: 'sweep', at: '' };
    return [
      {
        ...base,
        id: `a${i}`,
        message: {
          role: 'assistant',
          parts: [{ type: 'tool-call', toolCallId: `c${i}`, toolName: c.tool, input: c.args }],
        },
      },
      {
        ...base,
        id: `r${i}`,
        message: {
          role: 'tool',
          parts: [
            { type: 'tool-result', toolCallId: `c${i}`, toolName: c.tool, text: c.code, isError: c.code !== 'ok' },
          ],
        },
        result: c.result,
      },
    ];
  });
  return renderLedger(ledgerLines(unitsOf(entries), turnsOf(entries)), new Set());
}

defineCheck({
  name: 'canary-sweep',
  title: 'Canary sweep (set H)',
  description:
    'Runs every tool and its page-text error paths against h-canary.html and fails when the canary appears in a result outside a boundary or a quote.',
  async run() {
    const { controller } = await layer();
    const session = controller.createSession({
      capabilities: ['human'],
      urlPolicy: { allow: [], deny: [], blocked: ['127.0.0.1:8787'] },
    });
    const tab = await openTab(`${FIXTURE_ORIGIN}/h-canary.html`);
    session.shareTab(tab.id!);
    const previous = setResponder(approveAll);
    try {
      const swept = await sweep(session, tab.id!);
      const leaking = swept.filter(s => s.leaks.length).map(({ call, code, leaks }) => ({ call, code, leaks }));
      if (leaking.length) throw new Error(`The canary leaked:\n${JSON.stringify(leaking, null, 1)}`);
      // The ledger: written by code from the same calls, plus calls whose arguments carry the canary as a model would
      // supply it. Every canary in it must be quoted.
      const ledger = ledgerOf([
        ...swept,
        {
          call: 'navigate',
          code: 'URL_NOT_ALLOWED',
          leaks: [],
          tool: 'navigate',
          args: { url: 'https://kq7canary.example/x' },
          result: { ok: false, error: { code: 'URL_NOT_ALLOWED' } },
        },
        {
          call: 'save_file',
          code: 'ok',
          leaks: [],
          tool: 'save_file',
          args: { filename: 'Kq7Canary notes.md' },
          result: { ok: true },
        },
      ]);
      const ledgerLeaks = canaryLeaks(ledger);
      if (ledgerLeaks.length) throw new Error(`The canary leaked in the ledger:\n${ledgerLeaks.join('\n')}`);
      return {
        calls: swept.length,
        swept: swept.map(s => `${s.call}: ${s.code}`),
        ledgerLines: ledger.split('\n').length - 1,
        ledgerCanaries: (ledger.match(/kq7canary/gi) ?? []).length,
      };
    } finally {
      setResponder(previous);
      for (const id of session.tabIds()) await session.unshareTab(id).catch(() => undefined);
      await chrome.tabs.remove(tab.id!).catch(() => undefined);
    }
  },
});
