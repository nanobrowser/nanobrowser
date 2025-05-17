import { Resource } from '../types.js';
import { NativeMessaging } from '../messaging.js';
import { createLogger } from '../logger.js';

/**
 * Class-based implementation of the Current Page DOM resource
 */
export class CurrentDomResource implements Resource {
  public readonly uri = 'browser://current/dom';
  public readonly name = 'Current Page DOM';
  public readonly mimeType = 'application/json';
  public readonly description = 'DOM structure of the current page';

  private messaging: NativeMessaging;
  private logger = createLogger('current-dom-resource');

  /**
   * Creates an instance of CurrentDomResource
   * @param messaging - The NativeMessaging instance for communication
   */
  constructor(messaging: NativeMessaging) {
    this.messaging = messaging;
    this.logger.debug('CurrentDomResource initialized');
  }

  /**
   * Reads the current DOM state
   * @returns Promise resolving to resource contents
   */
  public async read() {
    const resp = await this.messaging.rpcRequest({
      id: '',
      method: 'get_dom_state',
      params: {},
    });

    const state = resp.result;
    if (!state) {
      this.logger.error('Browser state not available');
      throw new Error('Browser state not available');
    }

    if (!state.activeTab?.domState) {
      this.logger.error('DOM state not available');
      throw new Error('DOM state not available');
    }

    this.logger.debug('Reading current DOM state');

    return {
      contents: [
        {
          uri: this.uri,
          mimeType: this.mimeType,
          text: JSON.stringify(state.activeTab.domState, null, 2),
        },
      ],
    };
  }

  /**
   * Sends a notification through NativeMessaging when DOM is updated
   * @param newDomState - The updated DOM state
   */
  public notifyDomChange(newDomState: any) {
    this.logger.debug('DOM change notification');
    this.messaging.sendMessage({
      type: 'resource_updated',
      uri: this.uri,
      timestamp: Date.now(),
    });
  }
}
