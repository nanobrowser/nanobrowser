// The read-only tools through the controller, as an agent would call them.
import type { FindMatch, Result, ScreenshotData, SnapshotData } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { layer } from '../layer';
import { attach } from '../spike-session';
import { defineCheck } from './registry';
import { assert, sleep, waitForLoad, withTab } from './helpers';

const SECRETS = ['hunter2', '4111 1111', '654321'];

function refFor(result: Result, pattern: RegExp): string {
  const line = result.page?.snapshot?.split('\n').find(l => pattern.test(l));
  const ref = line && /\[([a-zA-Z]+\d+)\]/.exec(line)?.[1];
  if (!ref) throw new Error(`no line matching ${pattern}`);
  return ref;
}

defineCheck({
  name: 'observe-tools',
  title: 'Read-only tools',
  description:
    'snapshot, find, read, screenshot and tabs on the fixtures through the controller: outline and boundary, masking, find matches, read content, element and labelled screenshots (also inside a cross-site frame), typed errors, stale refs after a reload, two tabs sharing no label.',
  async run() {
    const { session } = await layer();
    const out: Record<string, unknown> = {};

    await withTab(`${FIXTURE_ORIGIN}/form.html`, async formTab => {
      await attach(formTab.tabId);
      const snap = await session.call('snapshot', {});
      assert(snap.ok, `snapshot failed: ${snap.text}`);
      const data = snap.data as SnapshotData;
      assert(data.refs >= 30, `expected at least 30 refs, got ${data.refs}`);
      assert(/<<<page-content [0-9a-f]{12}>>>/.test(snap.text), 'page text sits inside the boundary');
      for (const s of SECRETS) assert(!JSON.stringify(snap).includes(s), `secret "${s}" leaked into the snapshot`);
      out.snapshot = {
        refs: data.refs,
        frames: data.frames,
        notices: data.notices,
        captureMs: data.captureMs,
        chars: snap.page?.snapshot?.length,
      };

      const deletes = await session.call('find', { role: 'button', name: 'delete' });
      assert((deletes.data as FindMatch[]).length === 2, `find Delete: ${deletes.text}`);
      const byValue = await session.call('find', { text: 'lovelace' });
      assert((byValue.data as FindMatch[])[0]?.line.includes('Full name'), `find by value: ${byValue.text}`);
      const masked = await session.call('find', { text: '4111' });
      assert((masked.data as FindMatch[]).length === 0, 'find must not match masked values');

      const content = await session.call('read', {});
      const md = (content.data as { content: string }).content;
      assert(
        md.includes('# Observation form') && md.includes('| INV-1042 Acme Corp Delete |'),
        `read: ${md.slice(0, 300)}`,
      );
      for (const s of SECRETS) assert(!md.includes(s), `secret "${s}" leaked into read`);
      const embedded = refFor(snap, /iframe "Embedded"/);
      const inner = await session.call('read', { ref: embedded, format: 'text' });
      assert((inner.data as { content: string }).content.includes('Coupon: SPRING'), `read ref: ${inner.text}`);
      out.read = md.slice(0, 400);

      const viewport = await session.call('screenshot', {});
      const element = await session.call('screenshot', { ref: refFor(snap, /button "Delete"/) });
      const labelled = await session.call('screenshot', { labels: true });
      const full = await session.call('screenshot', { fullPage: true });
      for (const r of [viewport, element, labelled, full]) assert(r.ok, `screenshot: ${r.text}`);
      const e = element.data as ScreenshotData;
      assert(e.width < 200 && e.height < 60, `element screenshot is ${e.width}×${e.height}`);
      out.screenshots = [viewport, element, labelled, full].map(r => r.text);
      out.labelledImage = `data:image/png;base64,${(labelled.data as ScreenshotData).base64}`;
      out.elementImage = `data:image/png;base64,${e.base64}`;

      const errors: Record<string, string | undefined> = {};
      errors.unknownRef = (await session.call('read', { ref: 'zz999' })).error?.code;
      errors.badArgs = (await session.call('snapshot', { mode: 'everything' })).error?.code;
      errors.unavailable = (await session.call('fill_form', { fields: [{ target: { ref: 'e1' }, value: 'x' }] })).error
        ?.code;
      errors.capability = (await session.call('ask_user', { message: 'hi', kind: 'takeover' })).error?.code;
      errors.notInSession = (await session.call('snapshot', { tabId: 999999 })).error?.code;
      assert(errors.unknownRef === 'REF_UNKNOWN', `unknown ref: ${errors.unknownRef}`);
      assert(errors.badArgs === 'INVALID_ARGUMENT', `bad args: ${errors.badArgs}`);
      assert(errors.unavailable === 'INVALID_ARGUMENT', `unavailable tool: ${errors.unavailable}`);
      assert(errors.notInSession === 'TAB_NOT_IN_SESSION', `tab not in session: ${errors.notInSession}`);
      out.errors = errors;

      // A new document makes earlier refs stale (a navigation in the middle of a sequence).
      const apply = refFor(snap, /button "Apply"/);
      const load = waitForLoad(formTab.tabId);
      await chrome.tabs.reload(formTab.tabId);
      await load;
      await sleep(300);
      const stale = await session.call('read', { ref: apply });
      assert(stale.error?.code === 'STALE_DOCUMENT', `old ref after reload: ${stale.error?.code}`);
      out.staleAfterReload = stale.error?.code;

      // Two tabs in one session share no label.
      await withTab(`${FIXTURE_ORIGIN}/frames-nested.html`, async nestedTab => {
        await attach(nestedTab.tabId);
        await sleep(800);
        const a = await session.call('snapshot', { tabId: formTab.tabId });
        const b = await session.call('snapshot', { tabId: nestedTab.tabId });
        const refs = (r: Result) =>
          new Set([...(r.page?.snapshot ?? '').matchAll(/\[([a-zA-Z]+\d+)\]/g)].map(m => m[1]));
        const shared = [...refs(a)].filter(r => refs(b).has(r));
        assert(shared.length === 0, `tabs share labels: ${shared.join(', ')}`);
        const gc = refFor(b, /button "Grandchild button"/);
        const shot = await session.call('screenshot', { ref: gc });
        assert(shot.ok, `screenshot in cross-site frame: ${shot.text}`);
        const s = shot.data as ScreenshotData;
        assert(s.width > 50 && s.width < 300, `grandchild button screenshot is ${s.width}×${s.height}`);
        out.oopifElementImage = `data:image/png;base64,${s.base64}`;
        out.nestedSnapshot = b.page?.snapshot;
        const list = await session.call('tabs', { action: 'list' });
        assert(list.ok && list.text.includes(`tab ${nestedTab.tabId}`), `tabs list: ${list.text}`);
        const select = await session.call('tabs', { action: 'select', tabId: formTab.tabId });
        assert(select.ok && session.activeTabId === formTab.tabId, `tabs select: ${select.text}`);
        out.tabs = select.text;
      });
      out.snapshotText = snap.text.slice(0, 1500);
    });
    return out;
  },
});
