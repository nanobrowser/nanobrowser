import { Readable, Writable } from 'stream';
import { NativeMessaging } from '../../src/messaging';
import { createMockStdio } from '../helpers/mock-stdio';

/**
 * MockExtension simulates a Chrome extension that communicates with the Native Messaging Host
 */
export class MockExtension {
  private messaging: NativeMessaging;
  private handlers: Map<string, (data: any) => Promise<any>> = new Map();
  private recordedActions: Array<{ action: string; params: any }> = [];
  private stdio: {
    stdin: Readable;
    stdout: Writable;
    pushToStdin: (data: any) => void;
    readFromStdout: () => any[];
  };

  constructor() {
    // Create mock stdio for testing
    this.stdio = createMockStdio();

    // Create NativeMessaging instance with mock stdio
    this.messaging = new NativeMessaging(this.stdio.stdin, this.stdio.stdout);

    // Set up default handlers
    this.setupDefaultHandlers();
  }

  /**
   * Set up default message handlers
   */
  private setupDefaultHandlers() {
    this.handlers.set('executeAction', async data => {
      const { action, params } = data;

      // Simulate extension executing actions
      switch (action) {
        case 'navigate':
          return {
            success: true,
            message: `Navigated to ${params.url}`,
            data: { url: params.url },
          };

        case 'click':
          return {
            success: true,
            message: `Clicked on ${params.selector}`,
            data: { selector: params.selector },
          };

        default:
          return {
            success: false,
            message: `Unsupported action: ${action}`,
          };
      }
    });
  }

  /**
   * Register message handlers
   */
  public registerHandlers() {
    // Process messages by manually registering handlers with the NativeMessaging instance
    for (const [type, handler] of this.handlers.entries()) {
      this.messaging.registerHandler(type, async data => {
        try {
          return await handler(data);
        } catch (error) {
          throw error; // Let NativeMessaging handle the error
        }
      });
    }
  }

  /**
   * Send browser state update to the Native Messaging Host
   */
  public async setBrowserState(state: any): Promise<any> {
    // Send message to NativeMessaging
    this.stdio.pushToStdin({
      type: 'setBrowserState',
      state,
    });

    // Wait for and return response
    const responses = await this.waitForResponses();
    return responses.find(r => r.type === 'setBrowserState_result');
  }

  /**
   * Register a custom message handler
   */
  public addHandler(type: string, handler: (data: any) => Promise<any>) {
    this.handlers.set(type, handler);
  }

  /**
   * Wait for messages from NativeMessaging
   */
  private async waitForResponses(timeout = 500): Promise<any[]> {
    await new Promise(resolve => setTimeout(resolve, timeout));
    return this.stdio.readFromStdout();
  }

  /**
   * Send a message to the Native Messaging Host and wait for a response
   */
  public async sendMessageAndWaitForResponse(message: any, timeout = 500): Promise<any> {
    this.stdio.pushToStdin(message);
    const responses = await this.waitForResponses(timeout);
    return responses.find(r => r.type === `${message.type}_result`);
  }

  /**
   * Handle browser actions directly (for MCP server testing)
   */
  public async handleAction(action: string, params: any): Promise<any> {
    // Record the action
    this.recordedActions.push({ action, params });

    // Process different types of actions
    switch (action) {
      case 'navigate_to':
        return {
          success: true,
          message: `Navigated to ${params.url}`,
          data: { url: params.url },
        };

      case 'click_element':
        return {
          success: true,
          message: `Clicked on element with selector: ${params.selector}`,
          data: { selector: params.selector },
        };

      case 'type_text':
        return {
          success: true,
          message: `Typed text into selector: ${params.selector}`,
          data: { selector: params.selector, text: params.text },
        };

      case 'go_back':
        return {
          success: true,
          message: 'Navigated back',
          data: {},
        };

      case 'go_forward':
        return {
          success: true,
          message: 'Navigated forward',
          data: {},
        };

      case 'reload_page':
        return {
          success: true,
          message: 'Reloaded page',
          data: {},
        };

      default:
        return {
          success: false,
          message: `Unsupported action: ${action}`,
          data: {},
        };
    }
  }

  /**
   * Get the recorded actions for verification
   */
  public getActions(): Array<{ action: string; params: any }> {
    return [...this.recordedActions];
  }

  /**
   * Clear recorded actions
   */
  public clearActions(): void {
    this.recordedActions = [];
  }
}
