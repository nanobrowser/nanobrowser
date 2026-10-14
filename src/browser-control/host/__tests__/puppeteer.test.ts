import { beforeEach, describe, expect, it, vi } from 'vitest';

// Puppeteer's browser build is replaced: the test controls what connect and pages do, and sees the transport closed.
const transport = { close: vi.fn() };
const browser = { pages: vi.fn(), disconnect: vi.fn() };
const connect = vi.fn();
vi.mock('puppeteer-core/internal/puppeteer-core-browser.js', () => ({
  connect: (...args: unknown[]) => connect(...args),
  ExtensionTransport: { connectTab: vi.fn(async () => transport) },
}));
vi.mock('puppeteer-core/internal/common/USKeyboardLayout.js', () => ({ _keyDefinitions: {} }));

const { connectTab } = await import('../puppeteer');

describe('connectTab (a failed attach leaves the debugger detached)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browser.disconnect.mockResolvedValue(undefined);
  });

  it('closes the transport when Puppeteer cannot connect', async () => {
    connect.mockRejectedValue(new Error('Target.setDiscoverTargets timed out'));
    await expect(connectTab(7)).rejects.toThrow('timed out');
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it('disconnects the browser when listing its pages fails', async () => {
    connect.mockResolvedValue(browser);
    browser.pages.mockRejectedValue(new Error('Protocol error'));
    await expect(connectTab(7)).rejects.toThrow('Protocol error');
    expect(browser.disconnect).toHaveBeenCalledTimes(1);
    expect(transport.close).not.toHaveBeenCalled();
  });

  it('closes the transport itself when disconnecting fails', async () => {
    connect.mockResolvedValue(browser);
    browser.pages.mockResolvedValue([]);
    browser.disconnect.mockRejectedValue(new Error('already closed'));
    await expect(connectTab(7)).rejects.toThrow('No page target');
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it('keeps the connection when it succeeds', async () => {
    const page = {};
    connect.mockResolvedValue(browser);
    browser.pages.mockResolvedValue([page]);
    await expect(connectTab(7)).resolves.toMatchObject({ tabId: 7, page });
    expect(browser.disconnect).not.toHaveBeenCalled();
    expect(transport.close).not.toHaveBeenCalled();
  });
});
