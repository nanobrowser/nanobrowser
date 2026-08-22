/**
 * WebMCP bridge.
 *
 * Runs in the MAIN world of every page at document_start so it is installed before any page
 * script gets a chance to call `navigator.modelContext`. It does two things:
 *
 *  1. Provides a `navigator.modelContext` implementation (the WebMCP / Web Model Context API)
 *     when the browser has none, or transparently wraps a native one when it does. Either way
 *     every tool a page declares is mirrored into a local registry.
 *  2. Exposes that registry to the extension on `window.__nanobrowserWebMCP__`, which the
 *     background service worker reads through the Puppeteer/CDP connection it already holds
 *     for the tab.
 *
 * Everything crossing the bridge is JSON-safe: tool descriptors go out as plain objects and
 * tool results are cloned defensively, because the page controls both.
 *
 * Spec: https://github.com/webmachinelearning/webmcp
 */
(() => {
  const BRIDGE_KEY = '__nanobrowserWebMCP__';
  const BRIDGE_VERSION = 1;
  const DEFAULT_CALL_TIMEOUT_MS = 30000;

  const existing = window[BRIDGE_KEY];
  if (existing && existing.version >= BRIDGE_VERSION) {
    // Already installed (e.g. the background re-injected us into a live tab).
    return;
  }

  /** @type {Map<string, {descriptor: object, execute: Function|null, declarative: boolean}>} */
  const tools = new Map();

  /**
   * Turn an arbitrary value into something structured-clone/JSON safe.
   * Falls back to a string so a page can never break the bridge with an exotic return value.
   */
  const safeClone = value => {
    if (value === undefined) return null;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      try {
        return String(value);
      } catch {
        return null;
      }
    }
  };

  /**
   * Validate a tool declaration and split it into a serializable descriptor plus its executor.
   * Returns null when the declaration is unusable.
   */
  const parseTool = tool => {
    if (!tool || typeof tool !== 'object') return null;

    const name = typeof tool.name === 'string' ? tool.name.trim() : '';
    if (!name) return null;

    const descriptor = { name };
    if (typeof tool.description === 'string') {
      descriptor.description = tool.description;
    }
    if (tool.inputSchema && typeof tool.inputSchema === 'object') {
      descriptor.inputSchema = safeClone(tool.inputSchema);
    }
    // Some drafts of the proposal use `params` instead of `inputSchema`.
    if (!descriptor.inputSchema && tool.params && typeof tool.params === 'object') {
      descriptor.inputSchema = safeClone(tool.params);
    }
    if (tool.annotations && typeof tool.annotations === 'object') {
      descriptor.annotations = safeClone(tool.annotations);
    }

    return {
      descriptor,
      execute: typeof tool.execute === 'function' ? tool.execute : null,
      declarative: false,
    };
  };

  const addTool = (tool, declarative) => {
    const parsed = parseTool(tool);
    if (!parsed) return null;
    parsed.declarative = declarative;
    tools.set(parsed.descriptor.name, parsed);
    return parsed.descriptor.name;
  };

  const removeTool = name => tools.delete(name);

  const nativeModelContext = (() => {
    try {
      return navigator.modelContext || null;
    } catch {
      return null;
    }
  })();

  const callNative = (method, ...args) => {
    if (!nativeModelContext || typeof nativeModelContext[method] !== 'function') return undefined;
    try {
      return nativeModelContext[method].apply(nativeModelContext, args);
    } catch (err) {
      // A native implementation rejecting a declaration must not break our mirror.
      return undefined;
    }
  };

  const modelContext = {
    /**
     * Declarative form: replaces the full set of page-provided tools.
     * @param {{tools?: Array<object>}} context
     */
    provideContext(context) {
      for (const [name, entry] of tools) {
        if (entry.declarative) tools.delete(name);
      }
      const declared = context && Array.isArray(context.tools) ? context.tools : [];
      for (const tool of declared) {
        addTool(tool, true);
      }
      return callNative('provideContext', context);
    },

    /**
     * Incremental form: adds a single tool and hands back a handle to remove it again.
     * @param {object} tool
     */
    registerTool(tool) {
      const name = addTool(tool, false);
      const nativeHandle = callNative('registerTool', tool);
      return {
        unregister() {
          if (name) removeTool(name);
          if (nativeHandle && typeof nativeHandle.unregister === 'function') {
            try {
              nativeHandle.unregister();
            } catch {
              /* ignore */
            }
          }
        },
      };
    },

    unregisterTool(name) {
      removeTool(name);
      return callNative('unregisterTool', name);
    },

    get availableTools() {
      return Array.from(tools.values()).map(entry => safeClone(entry.descriptor));
    },
  };

  try {
    Object.defineProperty(navigator, 'modelContext', {
      value: modelContext,
      configurable: true,
      writable: false,
      enumerable: false,
    });
  } catch (err) {
    // If the property cannot be redefined we still expose the bridge below; the extension
    // simply won't see any tools for this page.
  }

  const withTimeout = (promise, timeoutMs) =>
    new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: `Page tool timed out after ${timeoutMs}ms` });
      }, timeoutMs);

      Promise.resolve(promise).then(
        value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ ok: true, result: safeClone(value) });
        },
        error => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
        },
      );
    });

  window[BRIDGE_KEY] = {
    version: BRIDGE_VERSION,

    /**
     * @returns {Array<object>} JSON-safe descriptors of every tool the page currently declares.
     */
    listTools() {
      return Array.from(tools.values()).map(entry => safeClone(entry.descriptor));
    },

    /**
     * Invoke a page tool by name.
     * @param {string} name
     * @param {string} argsJson JSON object string with the tool arguments
     * @param {number} [timeoutMs]
     * @returns {Promise<{ok: true, result: unknown}|{ok: false, error: string}>}
     */
    callTool(name, argsJson, timeoutMs) {
      const entry = tools.get(name);
      if (!entry) {
        return Promise.resolve({ ok: false, error: `Page tool "${name}" is not declared by this page` });
      }
      if (!entry.execute) {
        return Promise.resolve({ ok: false, error: `Page tool "${name}" has no execute function` });
      }

      let args = {};
      if (typeof argsJson === 'string' && argsJson.trim() !== '') {
        try {
          args = JSON.parse(argsJson);
        } catch (err) {
          return Promise.resolve({ ok: false, error: `Tool arguments are not valid JSON: ${String(err)}` });
        }
      }

      try {
        return withTimeout(entry.execute(args), timeoutMs > 0 ? timeoutMs : DEFAULT_CALL_TIMEOUT_MS);
      } catch (err) {
        return Promise.resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
})();
