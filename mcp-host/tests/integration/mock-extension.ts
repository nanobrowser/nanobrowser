import { Readable, Writable } from 'stream';
import { type RpcHandler } from '../../src/types';
import { NativeMessaging } from '../../src/messaging';
import { createMockStdio } from '../helpers/mock-stdio';

/**
 * MockExtension simulates a Chrome extension that communicates with the Native Messaging Host
 */
export class MockExtension {
  private messaging: NativeMessaging;
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

  public registerRpcMethod(method: string, handler: RpcHandler): void {
    this.messaging.registerRpcMethod(method, handler);
  }
}
