import { Readable, Writable } from 'stream';
import { createLogger } from './logger.js';
import { v4 as uuidv4 } from 'uuid';
import { RpcRequest, RpcResponse, RpcRequestOptions, RpcHandler, MessageHandler } from './types.js';

export interface Message {
  type: string;
  [key: string]: any;
}

export class NativeMessaging {
  private logger = createLogger('messaging');
  private stdin: Readable;
  private stdout: Writable;
  private buffer: Buffer = Buffer.alloc(0);
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private rpcMethodHandlers: Map<string, RpcHandler> = new Map();
  private pendingRequests = new Map<
    string,
    { resolve: (value: any) => void; reject: (reason?: any) => void; timeoutId: NodeJS.Timeout }
  >();

  constructor(stdin: Readable = process.stdin, stdout: Writable = process.stdout) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.setupMessageHandling();
    this.registerRpcResponseHandler();
    this.registerRpcRequestHandler();
  }

  private setupMessageHandling() {
    // Chrome uses length-prefixed JSON messages
    this.stdin.on('readable', () => {
      let chunk: Buffer | null;
      while ((chunk = this.stdin.read() as Buffer | null) !== null) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        this.processBuffer();
      }
    });

    this.stdin.on('end', () => {
      this.logger.info('Native messaging host: stdin ended');
      process.exit(0);
    });
  }

  private processBuffer() {
    // Message format: 4-byte length prefix + JSON
    if (this.buffer.length < 4) return;

    const messageLength = this.buffer.readUInt32LE(0);
    if (this.buffer.length < messageLength + 4) return;

    const messageJson = this.buffer.subarray(4, messageLength + 4).toString('utf8');
    this.buffer = this.buffer.subarray(messageLength + 4);

    try {
      const message = JSON.parse(messageJson);
      this.logger.debug('Received message:', message);
      this.handleMessage(message).catch(error => {
        this.logger.error('Error handling message:', error);
      });
    } catch (error) {
      this.logger.error('Error parsing message:', error);
    }

    // Process additional messages if any
    if (this.buffer.length >= 4) {
      this.processBuffer();
    }
  }

  private async handleMessage(message: Message) {
    const { type, ...data } = message;
    const handler = this.messageHandlers.get(type);

    if (!handler) {
      this.logger.warn(`No handler registered for message type: ${type}`);
      this.sendMessage({ type: 'error', error: `Unknown message type: ${type}` });
      return;
    }

    try {
      this.logger.debug(`Handling message type: ${type}`);
      await handler(data);
    } catch (error) {
      this.logger.error(`Error handling message type ${type}:`, error);
      this.sendMessage({
        type: 'error',
        originalType: type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public registerHandler(type: string, handler: MessageHandler) {
    this.logger.debug(`Registering handler for message type: ${type}`);
    this.messageHandlers.set(type, handler);
  }

  public sendMessage(message: any) {
    this.logger.debug(`Sending message:`, { type: message.type });
    const messageJson = JSON.stringify(message);
    const messageBuffer = Buffer.from(messageJson, 'utf8');
    const length = messageBuffer.length;

    const buffer = Buffer.alloc(4 + length);
    buffer.writeUInt32LE(length, 0);
    messageBuffer.copy(buffer, 4);

    this.stdout.write(buffer);
  }

  public rpcRequest(rpc: RpcRequest, options: RpcRequestOptions = {}): Promise<RpcResponse> {
    const id = rpc.id ?? uuidv4();
    const method = rpc.method;
    const params = rpc.params;

    const { timeout = 5000 } = options;

    this.logger.debug(`Sending RPC request: ${method} (id: ${id})`);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC request timeout: ${method} (id: ${id})`));
      }, timeout);

      this.pendingRequests.set(id, { resolve, reject, timeoutId });

      this.sendMessage({
        type: 'rpc_request',
        id,
        method,
        params,
      });
    });
  }

  private registerRpcResponseHandler() {
    this.registerHandler('rpc_response', async (data: any) => {
      const id = data.id;

      this.logger.debug(`Received RPC response for ID: ${id}`);

      const handler = this.pendingRequests.get(id);

      if (!handler) {
        this.logger.warn(`No pending request found for RPC response ID: ${id}`);
        return;
      }

      clearTimeout(handler.timeoutId);
      this.pendingRequests.delete(id);

      if (data.error) {
        handler.reject(data.error);
      } else {
        handler.resolve(data.result || {});
      }

      return;
    });
  }

  private registerRpcRequestHandler() {
    this.registerHandler('rpc_request', async (data: any) => {
      const { method, id } = data;
      this.logger.debug(`Handling incoming RPC request: ${method}`);

      const handler = this.rpcMethodHandlers.get(method);

      if (!handler) {
        this.logger.warn(`No handler registered for RPC method: ${method}`);
        return;
      }

      try {
        await handler(data);
      } catch (error) {
        this.logger.error(`Error in handler for method ${method}:`, error);
      }
    });
  }

  public registerRpcMethod(method: string, handler: RpcHandler): void {
    this.logger.debug(`Registering RPC handler for method: ${method}`);
    this.rpcMethodHandlers.set(method, handler);
  }
}
