// The probe in its isolated world, per frame and document, with nodes resolved into it.
import type { ProbeState, Result } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { layer } from '../layer';
import { attach } from '../spike-session';
import { defineCheck } from './registry';
import { assert, evaluate, sleep, waitForLoad, withTab } from './helpers';

function refOf(r: Result, pattern: RegExp): string {
  const line = r.page?.snapshot?.split('\n').find(l => pattern.test(l));
  const ref = line && /\[(\w+)\]/.exec(line)?.[1];
  if (!ref) throw new Error(`no line matching ${pattern}`);
  return ref;
}

async function stateOf(tabId: number, ref: string): Promise<ProbeState> {
  const { controller } = await layer();
  const record = controller.registry.get(ref)!;
  const tab = controller.tabState(tabId);
  const frames = await tab.attachment!.topology.frames();
  const frame = frames.find(f => f.frameId === record.frameId)!;
  const objectId = await tab.probe!.resolve(frame, record.backendNodeId);
  try {
    return await tab.probe!.call<ProbeState>(frame, objectId, 'state');
  } finally {
    await tab.probe!.release(frame, objectId);
  }
}

defineCheck({
  name: 'probe',
  title: 'Probe',
  description:
    'Probe state for refs on the form page, in a closed shadow root and in a cross-site frame; the page cannot see the probe; the world is reused per document and replaced after a reload.',
  async run() {
    const { session, controller } = await layer();
    const out: Record<string, unknown> = {};
    await withTab(`${FIXTURE_ORIGIN}/form.html`, async tab => {
      await attach(tab.tabId);
      const snap = await session.call('snapshot');
      const s = async (p: RegExp) => stateOf(tab.tabId, refOf(snap, p));
      const save = await s(/button "Save"/);
      const name = await s(/textbox "Full name"/);
      const email = await s(/textbox "Email"/);
      const overdue = await s(/checkbox "Overdue only"/);
      const rich = await s(/textbox "Rich editor"/);
      const sw = await s(/switch "Notifications"/);
      const coupon = await s(/textbox "Coupon"/);
      out.form = { save, name, email, overdue, rich, sw, coupon };
      assert(!save.enabled && save.tag === 'button', 'Save is disabled');
      assert(name.editable && name.value === 'Ada Lovelace', 'Full name is editable with its value');
      assert(!email.editable && email.enabled, 'Email is read-only');
      assert(overdue.checked === true && overdue.type === 'checkbox', 'Overdue only is checked');
      assert(rich.editable && rich.contentEditable, 'the rich editor is editable');
      assert(sw.checked === true && sw.role === 'switch', 'the switch reports aria-checked');
      assert(coupon.editable, 'a field in the same-process frame resolves in that frame’s world');
      const pageSees = await evaluate(tab.tabId, undefined, `typeof globalThis.__nbProbe`);
      assert(pageSees === 'undefined', `the page sees the probe: ${pageSees}`);

      const state = controller.tabState(tab.tabId);
      const frames = await state.attachment!.topology.frames();
      const first = await state.probe!.context(frames[0]);
      const again = await state.probe!.context(frames[0]);
      assert(first === again, 'the world is reused for the same document');
      const load = waitForLoad(tab.tabId);
      await chrome.tabs.reload(tab.tabId);
      await load;
      await sleep(200);
      const after = await state.probe!.context((await state.attachment!.topology.frames())[0]);
      assert(after !== first, 'a new document gets a new world');
      out.worlds = { first, again, after };
    });

    await withTab(`${FIXTURE_ORIGIN}/shadow-closed.html`, async tab => {
      await attach(tab.tabId);
      const snap = await session.call('snapshot');
      const button = await stateOf(tab.tabId, refOf(snap, /button "Shadow button"/));
      assert(button.inShadow && button.enabled && button.visible, 'closed shadow root button resolves');
      out.shadow = button;
    });

    await withTab(`${FIXTURE_ORIGIN}/frames-nested.html`, async tab => {
      await attach(tab.tabId);
      await sleep(600);
      const snap = await session.call('snapshot');
      const button = await stateOf(tab.tabId, refOf(snap, /button "Grandchild button"/));
      assert(button.enabled && button.visible && button.tag === 'button', 'cross-site grandchild resolves');
      out.grandchild = button;
    });
    return out;
  },
});
