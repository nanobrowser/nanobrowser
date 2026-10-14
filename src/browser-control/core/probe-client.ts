// The probe's isolated worlds, one per frame and document, and node resolution into them.
import { LayerError } from '../protocol/errors';
import { PROBE_SOURCE, PROBE_WORLD_NAME } from '../probe';
import type { ProbeApi } from '../probe';
import type { CdpPort, FrameRecord } from './ports';

interface RemoteObject {
  objectId?: string;
  value?: unknown;
  description?: string;
}

interface CallResult {
  result: RemoteObject;
  exceptionDetails?: { text: string; exception?: { description?: string } };
}

type ProbeMethod = Exclude<keyof ProbeApi, 'version'>;

/** A node passed to a probe method by its object ID in the same world. */
export class NodeArg {
  constructor(readonly objectId: string) {}
}

export class ProbeClient {
  /** Execution context of the probe world, by `${frameId}|${loaderId}`. */
  #worlds = new Map<string, Promise<number>>();

  constructor(private readonly cdp: CdpPort) {}

  #key(frame: FrameRecord): string {
    return `${frame.frameId}|${frame.loaderId}`;
  }

  /** The probe world of the frame's current document, created and installed on first use. */
  context(frame: FrameRecord): Promise<number> {
    const key = this.#key(frame);
    let world = this.#worlds.get(key);
    if (!world) {
      world = this.#create(frame);
      this.#worlds.set(key, world);
      world.catch(() => this.#worlds.delete(key));
      // Worlds of earlier documents of this frame are gone with them.
      for (const k of this.#worlds.keys()) if (k.startsWith(`${frame.frameId}|`) && k !== key) this.#worlds.delete(k);
    }
    return world;
  }

  async #create(frame: FrameRecord): Promise<number> {
    const { executionContextId } = await this.cdp.send<{ executionContextId: number }>(
      frame.sessionId,
      'Page.createIsolatedWorld',
      { frameId: frame.frameId, worldName: PROBE_WORLD_NAME, grantUniversalAccess: false },
    );
    const installed = await this.cdp.send<CallResult>(frame.sessionId, 'Runtime.evaluate', {
      expression: PROBE_SOURCE,
      contextId: executionContextId,
      returnByValue: true,
    });
    if (installed.exceptionDetails) throw new Error(`Probe install failed: ${installed.exceptionDetails.text}`);
    return executionContextId;
  }

  /** Brings a node into the probe world. A node that is gone is NODE_DETACHED. */
  async resolve(frame: FrameRecord, backendNodeId: number): Promise<string> {
    const attempt = async () => {
      const executionContextId = await this.context(frame);
      const { object } = await this.cdp.send<{ object: RemoteObject }>(frame.sessionId, 'DOM.resolveNode', {
        backendNodeId,
        executionContextId,
      });
      if (!object.objectId) throw new Error('no object');
      return object.objectId;
    };
    try {
      return await attempt();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/context/i.test(message)) {
        // The world went away (for example a same-loader reload of the context); recreate once.
        this.#worlds.delete(this.#key(frame));
        try {
          return await attempt();
        } catch {
          // fall through
        }
      }
      throw new LayerError('NODE_DETACHED', `The element is no longer in the page (${message})`);
    }
  }

  /** Calls a probe method with the node as its first argument. Arguments wrapped as `{ objectId }` pass nodes. */
  async call<T>(frame: FrameRecord, objectId: string, method: ProbeMethod, ...args: unknown[]): Promise<T> {
    const response = await this.cdp.send<CallResult>(frame.sessionId, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function (...args) { return globalThis.__nbProbe[${JSON.stringify(method)}](this, ...args); }`,
      arguments: args.map(value => (value instanceof NodeArg ? { objectId: value.objectId } : { value })),
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        `Probe ${method} failed: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`,
      );
    }
    return response.result.value as T;
  }

  /** Calls a probe method that returns an element, and gives that element's backend node ID (or null). */
  async callForNode(frame: FrameRecord, objectId: string, method: ProbeMethod): Promise<number | null> {
    const response = await this.cdp.send<CallResult>(frame.sessionId, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function () { return globalThis.__nbProbe[${JSON.stringify(method)}](this); }`,
      returnByValue: false,
    });
    const node = response.result.objectId;
    if (!node) return null;
    try {
      const { node: described } = await this.cdp.send<{ node: { backendNodeId: number } }>(
        frame.sessionId,
        'DOM.describeNode',
        {
          objectId: node,
        },
      );
      return described.backendNodeId;
    } finally {
      await this.release(frame, node);
    }
  }

  /** Calls a probe method that takes no node. */
  async callGlobal<T>(frame: FrameRecord, method: ProbeMethod, ...args: unknown[]): Promise<T> {
    const contextId = await this.context(frame);
    const response = await this.cdp.send<CallResult>(frame.sessionId, 'Runtime.evaluate', {
      expression: `globalThis.__nbProbe[${JSON.stringify(method)}](...${JSON.stringify(args)})`,
      contextId,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) throw new Error(`Probe ${method} failed: ${response.exceptionDetails.text}`);
    return response.result.value as T;
  }

  /** The focused element of the frame's document, when the document has focus and it is not a frame or body. */
  async focusedIn(frame: FrameRecord): Promise<{ objectId: string; backendNodeId: number } | null> {
    const contextId = await this.context(frame);
    const response = await this.cdp.send<CallResult>(frame.sessionId, 'Runtime.evaluate', {
      expression:
        "(() => { if (!document.hasFocus()) return null; const el = globalThis.__nbProbe.focused(); return el && !['IFRAME', 'FRAME', 'BODY', 'HTML'].includes(el.tagName) ? el : null; })()",
      contextId,
      returnByValue: false,
    });
    const objectId = response.result.objectId;
    if (!objectId) return null;
    const { node } = await this.cdp.send<{ node: { backendNodeId: number } }>(frame.sessionId, 'DOM.describeNode', {
      objectId,
    });
    return { objectId, backendNodeId: node.backendNodeId };
  }

  async release(frame: FrameRecord, objectId: string): Promise<void> {
    await this.cdp.send(frame.sessionId, 'Runtime.releaseObject', { objectId }).catch(() => undefined);
  }

  /** Forgets every world (the tab detached). */
  reset(): void {
    this.#worlds.clear();
  }
}
