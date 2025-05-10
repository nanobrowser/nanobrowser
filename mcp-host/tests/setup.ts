// This file contains setup code that will be executed before running tests
import { Readable, Writable } from 'stream';
import { vi } from 'vitest';

// Increase timeout for integration tests
vi.setConfig({ testTimeout: 10000 });

// Define global mock helpers
global.createMockStdio = () => {
  const inputChunks: Buffer[] = [];
  const outputChunks: Buffer[] = [];

  const mockStdin = new Readable({
    read() {
      // This will be called when the consumer wants to read data
      // We don't need to do anything here since we push data manually in tests
    },
  });

  const mockStdout = new Writable({
    write(chunk, encoding, callback) {
      outputChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });

  // Helper to push data into stdin
  const pushToStdin = (data: any) => {
    const jsonStr = JSON.stringify(data);
    const dataBuffer = Buffer.from(jsonStr, 'utf8');
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32LE(dataBuffer.length, 0);

    const messageBuffer = Buffer.concat([lengthBuffer, dataBuffer]);
    inputChunks.push(messageBuffer);
    mockStdin.push(messageBuffer);
  };

  // Helper to read data from stdout
  const readFromStdout = (): any[] => {
    const messages: any[] = [];
    const buffer = Buffer.concat(outputChunks);
    let offset = 0;

    while (offset + 4 <= buffer.length) {
      const length = buffer.readUInt32LE(offset);
      offset += 4;

      if (offset + length > buffer.length) {
        // Incomplete message, break
        break;
      }

      const jsonStr = buffer.subarray(offset, offset + length).toString('utf8');
      try {
        const message = JSON.parse(jsonStr);
        messages.push(message);
      } catch (error) {
        console.error('Error parsing message:', error);
      }

      offset += length;
    }

    // Clear processed chunks
    outputChunks.length = 0;
    if (offset < buffer.length) {
      outputChunks.push(buffer.subarray(offset));
    }

    return messages;
  };

  return {
    stdin: mockStdin,
    stdout: mockStdout,
    pushToStdin,
    readFromStdout,
  };
};

// Add this to the NodeJS global to make TypeScript happy
declare global {
  function createMockStdio(): {
    stdin: Readable;
    stdout: Writable;
    pushToStdin: (data: any) => void;
    readFromStdout: () => any[];
  };
}
