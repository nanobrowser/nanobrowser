import { expect, vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock Chrome API for tests

interface ChromeMock {
  runtime: {
    connectNative: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    lastError: chrome.runtime.LastError | null;
    getURL: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    onMessage: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
    onConnect: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
  tabs: {
    query: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  storage: {
    local: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
    };
    sync: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
    };
  };
}

// Create properly typed mock
const chromeMock: ChromeMock = {
  runtime: {
    connectNative: vi.fn(),
    sendMessage: vi.fn(),
    lastError: null,
    getURL: vi.fn(),
    connect: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onConnect: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    },
    sync: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    },
  },
};

// Add extension methods to mocks
Object.defineProperties(chromeMock.runtime.connectNative, {
  mockReturnValue: {
    value: function (val: any) {
      return vi.fn().mockReturnValue(val);
    },
  },
  mockImplementation: {
    value: function (fn: any) {
      return vi.fn().mockImplementation(fn);
    },
  },
  mockImplementationOnce: {
    value: function (fn: any) {
      return vi.fn().mockImplementationOnce(fn);
    },
  },
});

// Replace the basic mock with a simpler implementation
chromeMock.runtime.sendMessage = vi.fn((message, callback) => {
  if (callback) callback({ success: true });
});

// Assign to global
(global as any).chrome = chromeMock;

// Add missing window.setInterval and window.setTimeout from jsdom
global.window.setInterval = vi.fn() as any;
global.window.setTimeout = vi.fn() as any;
global.window.clearInterval = vi.fn() as any;
global.window.clearTimeout = vi.fn() as any;

// Add fetch mock
global.fetch = vi.fn();
