import { Readable, Writable } from 'stream';

export interface Message {
  type: string;
  [key: string]: any;
}

export class NativeMessaging {
  private stdin: Readable;
  private stdout: Writable;
  private buffer: Buffer = Buffer.alloc(0);
  private messageHandlers: Map<string, (data: any) => Promise<any>> = new Map();

  constructor(stdin: Readable = process.stdin, stdout: Writable = process.stdout) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.setupMessageHandling();
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
      console.error('Native messaging host: stdin ended');
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
      this.handleMessage(message).catch(error => {
        console.error('Error handling message:', error);
      });
    } catch (error) {
      console.error('Error parsing message:', error);
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
      console.error(`No handler registered for message type: ${type}`);
      this.sendMessage({ type: 'error', error: `Unknown message type: ${type}` });
      return;
    }

    try {
      const result = await handler(data);
      this.sendMessage({ type: `${type}_result`, ...result });
    } catch (error) {
      console.error(`Error handling message type ${type}:`, error);
      this.sendMessage({
        type: 'error',
        originalType: type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public registerHandler(type: string, handler: (data: any) => Promise<any>) {
    this.messageHandlers.set(type, handler);
  }

  public sendMessage(message: any) {
    const messageJson = JSON.stringify(message);
    const messageBuffer = Buffer.from(messageJson, 'utf8');
    const length = messageBuffer.length;

    const buffer = Buffer.alloc(4 + length);
    buffer.writeUInt32LE(length, 0);
    messageBuffer.copy(buffer, 4);

    this.stdout.write(buffer);
  }
}
