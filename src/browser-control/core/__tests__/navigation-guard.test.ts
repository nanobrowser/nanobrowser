import { describe, expect, it } from 'vitest';
import { NavigationGuard, SAFE_URL } from '../navigation-guard';
import type { CdpPort, FrameEvent, TabAttachment, TopologyPort } from '../ports';
import { combinePolicies } from '../url-policy';

function fakeTab() {
  const sent: Array<{ method: string; params?: object }> = [];
  const handlers = new Map<string, (params: unknown) => void>();
  let frameHandler: ((e: FrameEvent) => void) | null = null;
  const cdp: CdpPort = {
    tabId: 1,
    async send<T>(_s: string | undefined, method: string, params?: object) {
      sent.push({ method, params });
      return {} as T;
    },
    on(method, handler) {
      handlers.set(method, p => handler(p, undefined));
      return () => handlers.delete(method);
    },
  };
  const topology: TopologyPort = {
    mainFrameId: () => 'MAIN',
    frames: async () => [],
    onFrameEvent(handler) {
      frameHandler = handler;
      return () => (frameHandler = null);
    },
  };
  const attachment = { tabId: 1, cdp, topology } as unknown as TabAttachment;
  return {
    attachment,
    sent,
    pause: (url: string, frameId = 'MAIN', resourceType = 'Document') =>
      handlers.get('Fetch.requestPaused')!({
        requestId: `r-${url}`,
        request: { url, method: 'GET' },
        frameId,
        resourceType,
      }),
    commit: (url: string) => frameHandler!({ type: 'navigated', frameId: 'MAIN', url }),
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const denyCross = combinePolicies([{ allow: [], deny: ['denied.test'] }]);

describe('NavigationGuard', () => {
  it('enables document interception only while a list is configured', async () => {
    const tab = fakeTab();
    let lists = false;
    const guard = new NavigationGuard(tab.attachment, denyCross, () => lists);
    await guard.sync();
    expect(tab.sent).toEqual([]);
    lists = true;
    await guard.sync();
    expect(tab.sent[0]).toEqual({
      method: 'Fetch.enable',
      params: { patterns: [{ resourceType: 'Document', requestStage: 'Request' }] },
    });
    lists = false;
    await guard.sync();
    expect(tab.sent[1].method).toBe('Fetch.disable');
  });

  it('fails a denied main-frame document request with Aborted, so the page stays, and continues the rest', async () => {
    const tab = fakeTab();
    const guard = new NavigationGuard(tab.attachment, denyCross, () => true);
    tab.pause('https://ok.test/');
    tab.pause('https://denied.test/x');
    tab.pause('https://denied.test/frame', 'CHILD');
    await flush();
    expect(tab.sent.map(s => s.method)).toEqual([
      'Fetch.continueRequest',
      'Fetch.failRequest',
      'Fetch.continueRequest',
    ]);
    expect(tab.sent[1].params).toEqual({ requestId: 'r-https://denied.test/x', errorReason: 'Aborted' });
    expect(guard.drain().map(e => [e.layer, e.url])).toEqual([[3, 'https://denied.test/x']]);
    expect(guard.drain()).toEqual([]);
  });

  it('fails closed when the policy check throws', async () => {
    const tab = fakeTab();
    new NavigationGuard(
      tab.attachment,
      () => {
        throw new Error('broken');
      },
      () => true,
    );
    tab.pause('https://ok.test/');
    await flush();
    expect(tab.sent.map(s => s.method)).toEqual(['Fetch.failRequest']);
  });

  it('replaces a committed disallowed page with about:blank and reports it (layer 4)', async () => {
    const tab = fakeTab();
    const guard = new NavigationGuard(tab.attachment, denyCross, () => false);
    tab.commit('https://ok.test/');
    tab.commit('https://denied.test/restored-from-cache');
    await flush();
    expect(tab.sent).toEqual([{ method: 'Page.navigate', params: { url: SAFE_URL } }]);
    const [event] = guard.drain();
    expect(event.layer).toBe(4);
    expect(event.detail).toContain('was loaded although it is not allowed');
  });
});
