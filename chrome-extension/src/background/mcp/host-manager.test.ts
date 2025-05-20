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

  describe('handleMessage', () => {
    it('should update status when receiving status message', () => {
      // Setup
      hostManager.connect();
      hostManager.addStatusListener(mockStatusListener);
      mockStatusListener.mockClear();

      // Mock port onMessage callback
      const messageCallback = mockPort.onMessage.addListener.mock.calls[0][0];

      // Simulate a status message
      const mockStatusData = {
        isConnected: true,
        startTime: 1000,
        version: '1.0.0',
        runMode: 'stdio',
      };
      messageCallback({ type: 'status', data: mockStatusData });

      // Verify status is updated
      expect(hostManager.getStatus()).toMatchObject(mockStatusData);
      expect(mockStatusListener).toHaveBeenCalled();
    });

    it('should update lastHeartbeat when receiving ping_result', () => {
      // Setup
      hostManager.connect();
      hostManager.addStatusListener(mockStatusListener);
      mockStatusListener.mockClear();

      // Mock port onMessage callback
      const messageCallback = mockPort.onMessage.addListener.mock.calls[0][0];

      // Simulate a ping response
      const mockTimestamp = Date.now();
      messageCallback({ type: 'ping_result', timestamp: mockTimestamp });

      // Verify lastHeartbeat is updated
      expect(hostManager.getStatus().lastHeartbeat).toBe(mockTimestamp);
      expect(mockStatusListener).toHaveBeenCalled();
    });

    it('should log error when receiving error message', () => {
      // Setup
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      hostManager.connect();

      // Mock port onMessage callback
      const messageCallback = mockPort.onMessage.addListener.mock.calls[0][0];

      // Simulate an error message
      messageCallback({ type: 'error', error: 'Test error' });

      // Verify error is logged
      expect(consoleSpy).toHaveBeenCalledWith('MCP Host error:', 'Test error');

      // Cleanup
      consoleSpy.mockRestore();
    });

    it('should log unknown message types', () => {
      // Setup
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      hostManager.connect();

      // Mock port onMessage callback
      const messageCallback = mockPort.onMessage.addListener.mock.calls[0][0];

      // Simulate an unknown message
      const mockMessage = { type: 'unknown', data: 'test' };
      messageCallback(mockMessage);

      // Verify message is logged
      expect(consoleSpy).toHaveBeenCalledWith('Unknown message from MCP Host:', mockMessage);

      // Cleanup
      consoleSpy.mockRestore();
    });
  });

  describe('handleDisconnect', () => {
    it('should update status to disconnected when port disconnects', () => {
      // Setup
      hostManager.connect();
      hostManager.addStatusListener(mockStatusListener);
      mockStatusListener.mockClear();

      // Mock port onDisconnect callback
      const disconnectCallback = mockPort.onDisconnect.addListener.mock.calls[0][0];

      // Simulate disconnect
      disconnectCallback();

      // Verify status is updated
      expect(hostManager.getStatus().isConnected).toBe(false);
      expect(mockStatusListener).toHaveBeenCalled();
    });
  });

  describe('heartbeat', () => {
    it('should send ping message on interval', () => {
      // Setup
      hostManager.connect();
      mockPort.postMessage.mockClear();

      // Fast-forward timer to trigger heartbeat
      vi.advanceTimersByTime(10000);

      // Verify ping is sent
      expect(mockPort.postMessage).toHaveBeenCalledWith({ type: 'ping' });
    });

    it('should clear ping timeout when receiving ping response', () => {
      // Setup
      hostManager.connect();

      // Fast-forward timer to trigger heartbeat
      vi.advanceTimersByTime(10000);

      // Mock port onMessage callback
      const messageCallback = mockPort.onMessage.addListener.mock.calls[0][0];

      // Simulate a ping response
      messageCallback({ type: 'ping_result', timestamp: Date.now() });

      // Fast-forward timer beyond what would be the ping timeout
      vi.advanceTimersByTime(20000);

      // Verify we're still connected (timeout was cleared)
      expect(hostManager.getStatus().isConnected).toBe(true);
    });
  });

  describe('startMcpHost', () => {
    it('should send start request and connect on success', async () => {
      // Setup - mock chrome.runtime.sendMessage
      chrome.runtime.sendMessage = vi.fn().mockImplementation((message, callback) => {
        setTimeout(() => callback({ success: true }), 10);
      });

      // Ensure we're not connected
      hostManager.disconnect();

      // Call startMcpHost
      const options = { runMode: 'stdio' };
      const startPromise = hostManager.startMcpHost(options);

      // Fast-forward timers to resolve promise
      vi.advanceTimersByTime(600);

      // Verify
      const result = await startPromise;
      expect(result).toBe(true);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'startMcpHost', options }, expect.any(Function));
    });

    it('should return false if already connected', async () => {
      // Setup - ensure we're connected
      hostManager.connect();

      // Call startMcpHost
      const result = await hostManager.startMcpHost({ runMode: 'stdio' });

      // Verify
      expect(result).toBe(false);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('should return false on startup failure', async () => {
      // Setup - mock chrome.runtime.sendMessage to return failure
      chrome.runtime.sendMessage = vi.fn().mockImplementation((message, callback) => {
        setTimeout(() => callback({ success: false }), 10);
      });

      // Ensure we're not connected
      hostManager.disconnect();

      // Call startMcpHost
      const startPromise = hostManager.startMcpHost({ runMode: 'stdio' });

      // Fast-forward timers to resolve promise
      vi.advanceTimersByTime(100);

      // Verify
      const result = await startPromise;
      expect(result).toBe(false);
    });
  });

  describe('stopMcpHost', () => {
    it('should send shutdown command and resolve on disconnect', async () => {
      // Setup
      hostManager.connect();

      // Setup for promise resolution
      const stopPromise = hostManager.stopMcpHost();

      // Mock disconnection immediately
      const disconnectCallback = mockPort.onDisconnect.addListener.mock.calls[1][0]; // Second call from stopMcpHost
      disconnectCallback();

      // Verify
      const result = await stopPromise;
      expect(result).toBe(true);
      expect(mockPort.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
    });

    it('should resolve after timeout if no disconnect event', async () => {
      // Setup
      hostManager.connect();

      // Call stopMcpHost
      const stopPromise = hostManager.stopMcpHost();

      // Fast-forward past the graceful shutdown timeout
      vi.advanceTimersByTime(1100);

      // Verify
      const result = await stopPromise;
      expect(result).toBe(true);
      expect(mockPort.disconnect).toHaveBeenCalled();
    });

    it('should return false if not connected', async () => {
      // Setup - ensure we're not connected
      hostManager.disconnect();

      // Call stopMcpHost
      const result = await hostManager.stopMcpHost();

      // Verify
      expect(result).toBe(false);
      expect(mockPort.postMessage).not.toHaveBeenCalled();
    });
  });
});
