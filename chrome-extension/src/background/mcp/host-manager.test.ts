import { McpHostManager } from './host-manager';
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';

/**
 * Test setup: robustly mock chrome.runtime and Port for all tests.
 */
const mockPort = {
  onMessage: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  onDisconnect: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  postMessage: vi.fn(),
  disconnect: vi.fn(),
};
// Ensure chrome.runtime.connectNative always returns mockPort
beforeAll(() => {
  // Ensure chrome.runtime.connectNative is a vi.fn()
  chrome.runtime.connectNative = vi.fn();
  (chrome.runtime.connectNative as ReturnType<typeof vi.fn>).mockReturnValue(mockPort);
});
afterAll(() => {
  vi.clearAllMocks();
});

describe('McpHostManager', () => {
  let hostManager: McpHostManager;
  let mockStatusListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // connectNative mock is set globally in beforeAll
    hostManager = new McpHostManager();
    mockStatusListener = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('connect', () => {
    it('should establish connection to MCP Host', () => {
      const result = hostManager.connect();

      expect(result).toBe(true);
      expect(chrome.runtime.connectNative).toHaveBeenCalledWith('mcp_host');
      expect(mockPort.onMessage.addListener).toHaveBeenCalled();
      expect(mockPort.onDisconnect.addListener).toHaveBeenCalled();
    });

    it('should not reconnect if already connected', () => {
      // First connection
      hostManager.connect();

      // Clear mocks
      vi.clearAllMocks();

      // Try to connect again
      const result = hostManager.connect();

      expect(result).toBe(false);
      expect(chrome.runtime.connectNative).not.toHaveBeenCalled();
    });

    it('should handle connection error', () => {
      // Mock connection error
      chrome.runtime.lastError = { message: 'Connection failed' } as chrome.runtime.LastError;
      (chrome.runtime.connectNative as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('Connection failed');
      });

      const result = hostManager.connect();

      expect(result).toBe(false);
      expect(chrome.runtime.connectNative).toHaveBeenCalledWith('mcp_host');

      // Reset the mock
      chrome.runtime.lastError = null as unknown as chrome.runtime.LastError;
    });
  });

  describe('disconnect', () => {
    it('should disconnect and update status', () => {
      // 先建立连接
      hostManager.connect();
      // 调用 disconnect
      hostManager.disconnect();

      // port.disconnect 被调用
      expect(mockPort.disconnect).toHaveBeenCalled();

      // port 置为 null
      // 通过再次 disconnect 验证不会报错
      expect(() => hostManager.disconnect()).not.toThrow();

      // 状态更新为未连接
      expect(hostManager.getStatus().isConnected).toBe(false);
    });

    it('should do nothing if not connected', () => {
      // 未连接时调用 disconnect 不应报错
      expect(() => hostManager.disconnect()).not.toThrow();
      // port.disconnect 不应被调用
      expect(mockPort.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('should return initial status', () => {
      const status = hostManager.getStatus();
      expect(status.isConnected).toBe(false);
      expect(status.startTime).toBeNull();
      expect(status.lastHeartbeat).toBeNull();
      expect(status.version).toBeNull();
      expect(status.runMode).toBeNull();
    });

    it('should reflect connected status after connect', () => {
      hostManager.connect();
      const status = hostManager.getStatus();
      expect(status.isConnected).toBe(true);
    });

    it('should reflect disconnected status after disconnect', () => {
      hostManager.connect();
      hostManager.disconnect();
      const status = hostManager.getStatus();
      expect(status.isConnected).toBe(false);
    });
  });

  describe('addStatusListener & removeStatusListener', () => {
    it('should call listener on status change', () => {
      const listener = vi.fn();
      hostManager.addStatusListener(listener);
      hostManager.connect();
      expect(listener).toHaveBeenCalled();
      // listener 参数为 status 对象
      expect(listener.mock.calls[0][0].isConnected).toBe(true);
    });

    it('should not call removed listener', () => {
      const listener = vi.fn();
      hostManager.addStatusListener(listener);
      hostManager.removeStatusListener(listener);
      hostManager.connect();
      expect(listener).not.toHaveBeenCalled();
    });

    it('should support multiple listeners and remove one', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      hostManager.addStatusListener(listener1);
      hostManager.addStatusListener(listener2);
      hostManager.connect();
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();

      // 移除 listener1，再断开连接
      listener1.mockClear();
      listener2.mockClear();
      hostManager.removeStatusListener(listener1);
      hostManager.disconnect();
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });
});
