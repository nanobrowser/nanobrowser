import { Resource, BrowserState } from '../types.js';
import { NativeMessaging } from '../messaging.js';
import { createLogger } from '../logger.js';

/**
 * Class-based implementation of the Current Browser State resource
 */
export class CurrentStateResource implements Resource {
  public readonly uri = 'browser://current/state';
  public readonly name = 'Current Browser State';
  public readonly mimeType = 'application/json';
  public readonly description = 'Complete state of the current active page and all tabs';

  private messaging: NativeMessaging;
  private logger = createLogger('current-state-resource');

  /**
   * Creates an instance of CurrentStateResource
   * @param messaging - The NativeMessaging instance for communication
   */
  constructor(messaging: NativeMessaging) {
    this.messaging = messaging;
    this.logger.debug('CurrentStateResource initialized');
  }

  /**
   * Reads the current browser state
   * @returns Promise resolving to resource contents
   */
  public async read() {
    const resp = await this.messaging.rpcRequest({
      method: 'get_browser_state',
    });

    this.logger.debug('RPC get_browser_state:', resp);

    const state = resp as BrowserState;
    if (!state) {
      this.logger.error('Browser state not available');
      throw new Error('Browser state not available');
    }

    this.logger.debug('Reading current browser state');

    return {
      contents: [
        {
          uri: this.uri,
          mimeType: this.mimeType,
          text: JSON.stringify(state, null, 2),
        },
      ],
    };
  }

  /**
   * Sends a notification through NativeMessaging when state is updated
   * @param newState - The updated browser state
   */
  public notifyStateChange(newState: any) {
    this.logger.debug('State change notification');
    this.messaging.sendMessage({
      type: 'resource_updated',
      uri: this.uri,
      timestamp: Date.now(),
    });
  }
}
