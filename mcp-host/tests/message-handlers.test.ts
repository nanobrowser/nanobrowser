/**
 * Tests for MCP Host message handlers
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll, MockInstance } from 'vitest';
import { StatusHandler, PingHandler, ShutdownHandler, CleanupFunction } from '../src/message-handlers';

// Mock dependencies
vi.mock('../src/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('Message Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock process.exit to prevent tests from exiting
    vi.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`Process exit was called with code: ${code}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('StatusHandler', () => {
    let statusHandler: StatusHandler;
    let mockStartTime: number;
    let mockVersion: string;
    let mockRunMode: string;

    beforeEach(() => {
      mockStartTime = Date.now();
      mockVersion = '1.0.0';
      mockRunMode = 'stdio';

      // Create handler with mock values
      statusHandler = new StatusHandler({
        startTime: mockStartTime,
        version: mockVersion,
        runMode: mockRunMode,
      });
    });

    it('should return correct status information', async () => {
      // Act
      const result = await statusHandler.handle({});

      // Assert
      expect(result).toEqual({
        data: {
          isConnected: true,
          startTime: mockStartTime,
          version: mockVersion,
          runMode: mockRunMode,
        },
      });
    });
  });

  describe('PingHandler', () => {
    let pingHandler: PingHandler;
    let onPingCallback: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      pingHandler = new PingHandler();
      onPingCallback = vi.fn();
      pingHandler.onPing = onPingCallback;

      // Mock Date.now for consistent tests
      vi.spyOn(Date, 'now').mockReturnValue(1234567890);
    });

    it('should return the current timestamp', async () => {
      // Act
      const result = await pingHandler.handle({});

      // Assert
      expect(result).toEqual({
        timestamp: 1234567890,
      });
    });

    it('should call onPing callback if registered', async () => {
      // Act
      await pingHandler.handle({});

      // Assert
      expect(onPingCallback).toHaveBeenCalledTimes(1);
      expect(onPingCallback).toHaveBeenCalledWith(1234567890);
    });

    it('should not error if onPing callback is not registered', async () => {
      // Arrange
      pingHandler.onPing = undefined;

      // Act & Assert - should not throw
      await expect(pingHandler.handle({})).resolves.toEqual({
        timestamp: 1234567890,
      });
    });
  });

  describe('ShutdownHandler', () => {
    let shutdownHandler: ShutdownHandler;
    let mockCleanupFn: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Create a function that returns a promise resolving to void
      const cleanupFunction = () => Promise.resolve();
      mockCleanupFn = vi.fn().mockImplementation(cleanupFunction);
      shutdownHandler = new ShutdownHandler(mockCleanupFn as unknown as CleanupFunction);
    });

    it('should call cleanup function and set exit timeout', async () => {
      // Mock setTimeout
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      // Act
      const result = await shutdownHandler.handle({});

      // Assert
      expect(result).toEqual({ success: true });
      expect(mockCleanupFn).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500);

      // Advance timers to trigger the timeout - should call process.exit(0)
      // We need to wrap this in an expect.toThrow because our mocked process.exit throws an error
      expect(() => {
        vi.runAllTimers();
      }).toThrow('Process exit was called with code: 0');
      expect(process.exit).toHaveBeenCalledWith(0);

      // Restore timers
      vi.useRealTimers();
    });

    it('should handle cleanup failure gracefully', async () => {
      // Arrange
      mockCleanupFn.mockRejectedValue(new Error('Cleanup failed'));

      // Act
      const result = await shutdownHandler.handle({});

      // Assert
      expect(result).toEqual({ success: false, error: 'Cleanup failed' });
      expect(mockCleanupFn).toHaveBeenCalledTimes(1);
      expect(process.exit).not.toHaveBeenCalled();
    });
  });
});
