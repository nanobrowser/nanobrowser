import { describe, expect, it, vi } from 'vitest';
import { Controller } from '../controller';
import { LayerError } from '../../protocol/errors';
import type { CdpPort, TabAttachment, TabHost } from '../ports';

/** An attachment whose CDP answers every command with an empty result; `close` is observed. */
function fakeAttachment(tabId: number): TabAttachment & { close: ReturnType<typeof vi.fn> } {
  return {
    tabId,
    cdp: { tabId, send: vi.fn(async () => ({})) as unknown as CdpPort['send'], on: vi.fn(() => () => undefined) },
    topology: { mainFrameId: () => 'main', frames: async () => [], onFrameEvent: vi.fn(() => () => undefined) },
    page: {} as TabAttachment['page'],
    detached: null,
    onDetach: vi.fn(() => () => undefined),
    close: vi.fn(async () => undefined),
  };
}

const tabs = {
  onRemoved: () => () => undefined,
  onNavigationTarget: () => () => undefined,
} as unknown as TabHost;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

describe('release while attaching (an unshared tab is left detached)', () => {
  it('closes an attachment that completes after the tab was released', async () => {
    const pending = deferred<TabAttachment>();
    const attachment = fakeAttachment(7);
    const attacher = { attach: vi.fn(() => pending.promise) };
    const controller = await Controller.create({
      attacher,
      tabs,
      epochStore: { read: async () => null, write: async () => undefined },
    });
    const session = controller.createSession();
    session.shareTab(7);
    const attaching = controller.attach(7);
    await session.unshareTab(7);
    pending.resolve(attachment);
    await expect(attaching).rejects.toMatchObject({ code: 'DEBUGGER_DETACHED' });
    expect(attachment.close).toHaveBeenCalledTimes(1);
    // The released tab's state holds nothing: a new share attaches afresh.
    expect(controller.tabState(7).attachment).toBeNull();
  });

  it('keeps an attachment that completes while the tab is still shared', async () => {
    const attachment = fakeAttachment(8);
    const controller = await Controller.create({
      attacher: { attach: vi.fn(async () => attachment) },
      tabs,
      epochStore: { read: async () => null, write: async () => undefined },
    });
    controller.createSession().shareTab(8);
    await expect(controller.attach(8)).resolves.toBe(attachment);
    expect(attachment.close).not.toHaveBeenCalled();
  });
});

describe('navigate from a page the debugger cannot attach to', () => {
  /** A tab on chrome://extensions; `lands` is where a load through chrome.tabs ends, after any redirects. */
  async function restricted(lands?: string) {
    const calls: string[] = [];
    const attachment = fakeAttachment(9);
    let loaded: string | null = null;
    const attacher = {
      attach: vi.fn(async () => {
        calls.push('attach');
        if (!loaded) throw new LayerError('PAGE_NOT_SUPPORTED', 'chrome://extensions cannot be controlled');
        return attachment;
      }),
    };
    const controller = await Controller.create({
      attacher,
      tabs: {
        ...tabs,
        get: async () => ({ tabId: 9, url: loaded ?? 'chrome://extensions/', title: '' }),
        load: vi.fn(async (_tabId: number, url: string) => {
          calls.push(`load ${url}`);
          loaded = lands ?? url;
        }),
      } as unknown as TabHost,
      epochStore: { read: async () => null, write: async () => undefined },
    });
    const session = controller.createSession({
      urlPolicy: { allow: [], deny: [], blocked: ['blocked.test'] },
      observeDefault: 'none',
    });
    session.shareTab(9);
    return { session, calls, attachment };
  }

  it('loads the URL through chrome.tabs, then attaches', async () => {
    const { session, calls } = await restricted();
    const result = await session.call('navigate', { url: 'https://example.com/', tabId: 9 });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ url: 'https://example.com/', readiness: 'load' });
    expect(calls).toEqual(['attach', 'load https://example.com/', 'attach']);
  });

  it('checks where the load ended: a blocked site reached by a redirect is reported and left', async () => {
    const { session, attachment } = await restricted('https://blocked.test/');
    const result = await session.call('navigate', { url: 'https://example.com/', tabId: 9 });
    expect(result.error).toMatchObject({ code: 'URL_NOT_ALLOWED', delivered: true });
    expect(attachment.cdp.send).toHaveBeenCalledWith(undefined, 'Page.navigate', { url: 'about:blank' });
  });

  it('does not leave the page for a refused URL, or for back, forward and reload', async () => {
    const { session, calls } = await restricted();
    const refused = await session.call('navigate', { url: 'https://blocked.test/', tabId: 9 });
    expect(refused.error?.code).toBe('URL_NOT_ALLOWED');
    const back = await session.call('navigate', { action: 'back', tabId: 9 });
    expect(back.error?.code).toBe('PAGE_NOT_SUPPORTED');
    expect(calls.some(c => c.startsWith('load'))).toBe(false);
  });
});

describe('navigate removes its readiness listener', () => {
  it('removes it when the navigation fails', async () => {
    const attachment = {
      ...fakeAttachment(9),
      page: {
        goto: vi.fn(async () => {
          throw new Error('net::ERR_NAME_NOT_RESOLVED');
        }),
      } as unknown as TabAttachment['page'],
    };
    const offs: Array<ReturnType<typeof vi.fn>> = [];
    attachment.cdp.on = vi.fn(() => {
      const off = vi.fn();
      offs.push(off);
      return off;
    }) as unknown as CdpPort['on'];
    const controller = await Controller.create({
      attacher: { attach: vi.fn(async () => attachment) },
      tabs: { ...tabs, get: async () => ({ tabId: 9, url: 'about:blank', title: '' }) } as unknown as TabHost,
      epochStore: { read: async () => null, write: async () => undefined },
    });
    const session = controller.createSession();
    session.shareTab(9);
    const before = (attachment.cdp.on as ReturnType<typeof vi.fn>).mock.calls.length;
    for (let i = 0; i < 3; i++) {
      const result = await session.call('navigate', { url: 'http://unresolvable.test/', tabId: 9 });
      expect(result.ok).toBe(false);
      // A failure in the network is not a fault of the layer.
      expect(result.error).toMatchObject({ code: 'NAVIGATION_FAILED', delivered: 'unknown' });
      expect(result.error?.message).toContain('net::ERR_NAME_NOT_RESOLVED');
    }
    const lifecycle = (attachment.cdp.on as ReturnType<typeof vi.fn>).mock.calls
      .map((c, i) => [c[0], offs[i]] as const)
      .slice(before)
      .filter(([method]) => method === 'Page.lifecycleEvent');
    expect(lifecycle).toHaveLength(3);
    for (const [, off] of lifecycle) expect(off).toHaveBeenCalledTimes(1);
  });
});

describe('a ref of a tab the session no longer holds', () => {
  it('is refused before anything attaches to the tab again', async () => {
    const opened: Array<ReturnType<typeof fakeAttachment>> = [];
    const attacher = {
      attach: vi.fn(async (tabId: number) => {
        const attachment = fakeAttachment(tabId);
        opened.push(attachment);
        return attachment;
      }),
    };
    const controller = await Controller.create({
      attacher,
      tabs,
      epochStore: { read: async () => null, write: async () => undefined },
    });
    const session = controller.createSession();
    session.shareTab(11);
    await controller.attach(11);
    const { ref } = controller.registry.assign(
      { tabId: 11, sessionId: undefined, frameId: 'main', loaderId: 'l1', backendNodeId: 5 },
      'ax',
      { role: 'button', name: 'Pay', tag: '', text: '', nth: null, context: null },
    );
    await session.unshareTab(11);
    const codes: Array<string | undefined> = [];
    for (const [tool, args] of [
      ['screenshot', { ref }],
      ['click', { target: { ref } }],
      ['read', { ref }],
      ['snapshot', { scope: ref }],
    ] as const) {
      codes.push((await session.call(tool, args)).error?.code);
    }
    // One attachment, made while the tab was shared, and closed when it was unshared; none since.
    expect(attacher.attach).toHaveBeenCalledTimes(1);
    expect(opened.every(a => a.close.mock.calls.length === 1)).toBe(true);
    expect(controller.tabState(11).attachment).toBeNull();
    expect(codes).toEqual(Array(4).fill('TAB_NOT_IN_SESSION'));
  });
});

describe('a call in progress when its tab is unshared', () => {
  it('does not attach to the tab again', async () => {
    const opened: Array<ReturnType<typeof fakeAttachment>> = [];
    const attacher = {
      attach: vi.fn(async (tabId: number) => {
        const attachment = fakeAttachment(tabId);
        opened.push(attachment);
        return attachment;
      }),
    };
    const controller = await Controller.create({
      attacher,
      tabs: {
        ...tabs,
        get: async () => ({ tabId: 12, url: 'http://site.test/start', title: '' }),
      } as unknown as TabHost,
      epochStore: { read: async () => null, write: async () => undefined },
    });
    const session = controller.createSession();
    session.shareTab(12);
    // The URL never matches: the wait polls until its budget runs out, or until it fails.
    const waiting = session.call('wait', { url: '/done', timeoutMs: 800 });
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    await new Promise(resolve => setTimeout(resolve, 20));
    await session.unshareTab(12);
    const result = await waiting;
    // One attachment, made while the tab was shared, and closed when it was unshared; none since.
    expect(attacher.attach).toHaveBeenCalledTimes(1);
    expect(opened.every(a => a.close.mock.calls.length === 1)).toBe(true);
    expect(result.error?.code).toBe('TAB_NOT_IN_SESSION');
  });

  it('refuses a direct attach of a tab no session holds', async () => {
    const attacher = { attach: vi.fn(async (tabId: number) => fakeAttachment(tabId)) };
    const controller = await Controller.create({
      attacher,
      tabs,
      epochStore: { read: async () => null, write: async () => undefined },
    });
    await expect(controller.attach(13)).rejects.toMatchObject({ code: 'TAB_NOT_IN_SESSION' });
    expect(attacher.attach).not.toHaveBeenCalled();
  });
});

describe('timeoutMs must be positive', () => {
  it('refuses timeoutMs 0, which would remove the navigation deadline', async () => {
    const goto = vi.fn(async () => undefined);
    const attachment = { ...fakeAttachment(14), page: { goto } as unknown as TabAttachment['page'] };
    const controller = await Controller.create({
      attacher: { attach: vi.fn(async () => attachment) },
      tabs: { ...tabs, get: async () => ({ tabId: 14, url: 'about:blank', title: '' }) } as unknown as TabHost,
      epochStore: { read: async () => null, write: async () => undefined },
    });
    const session = controller.createSession();
    session.shareTab(14);
    const codes: Array<string | undefined> = [];
    for (const [tool, args] of [
      ['navigate', { url: 'http://site.test/', timeoutMs: 0 }],
      ['wait', { text: 'x', timeoutMs: 0 }],
      ['click', { target: { role: 'button', name: 'Go' }, timeoutMs: 0 }],
    ] as const) {
      codes.push((await session.call(tool, args)).error?.code);
    }
    expect(goto).not.toHaveBeenCalled();
    expect(codes).toEqual(Array(3).fill('INVALID_ARGUMENT'));
  });
});

describe('a cancelled wait ends at once', () => {
  it('stops polling and a fixed-time wait, and frees the tab for the next call', async () => {
    const controller = await Controller.create({
      attacher: { attach: vi.fn(async (tabId: number) => fakeAttachment(tabId)) },
      tabs: {
        ...tabs,
        get: async () => ({ tabId: 15, url: 'http://site.test/start', title: '' }),
      } as unknown as TabHost,
      epochStore: { read: async () => null, write: async () => undefined },
    });
    const session = controller.createSession();
    session.shareTab(15);
    const cancelSoon = () => {
      const abort = new AbortController();
      setTimeout(() => abort.abort(), 50);
      return abort.signal;
    };
    let start = performance.now();
    const polling = session.call('wait', { url: '/done', timeoutMs: 5_000 }, { signal: cancelSoon() });
    // Queued behind the polling wait on the tab's lock.
    const next = session.call('wait', { url: '/start', timeoutMs: 1_000 });
    const [polled, after] = await Promise.all([polling, next]);
    expect(polled.error).toMatchObject({ code: 'CANCELLED', delivered: false });
    expect(after.ok).toBe(true);
    expect(performance.now() - start).toBeLessThan(1_000);
    start = performance.now();
    const fixed = await session.call('wait', { ms: 5_000 }, { signal: cancelSoon() });
    expect(fixed.error).toMatchObject({ code: 'CANCELLED', delivered: false });
    expect(performance.now() - start).toBeLessThan(1_000);
  }, 15_000);
});

describe('tabs close releases the tab', () => {
  it('detaches a tab the session closed, also when the tab stays open', async () => {
    const attachment = fakeAttachment(21);
    // The page asked "Leave site?" and the user stayed: the close call returns and the tab is still there.
    const close = vi.fn(async () => undefined);
    const controller = await Controller.create({
      attacher: { attach: vi.fn(async () => attachment) },
      tabs: { ...tabs, close, get: async () => ({ tabId: 21, url: 'about:blank', title: '' }) } as unknown as TabHost,
      epochStore: { read: async () => null, write: async () => undefined },
    });
    const session = controller.createSession();
    session.shareTab(21);
    await controller.attach(21);
    const result = await session.call('tabs', { action: 'close', tabId: 21 });
    expect(result.ok).toBe(true);
    expect(close).toHaveBeenCalledWith(21);
    expect(session.hasTab(21)).toBe(false);
    expect(attachment.close).toHaveBeenCalledTimes(1);
    expect(controller.tabState(21).attachment).toBeNull();
  });
});
