import { Readable, Writable } from 'stream';

/**
 * Creates a mock stdio setup for testing with Node.js streams
 * Returns an object with stdin and stdout streams, plus helper methods
 */
export function createMockStdio() {
  const stdoutMessages: any[] = [];

  // Create a mock Readable stream (stdin)
  const stdin = new Readable({
    read() {
      // This is intentionally left empty as we will manually push data
    },
  });

  // Create a mock Writable stream (stdout)
  const stdout = new Writable({
    write(chunk, encoding, callback) {
      try {
        // Parse the message and store it
        const message = JSON.parse(chunk.toString());
        stdoutMessages.push(message);
      } catch (error) {
        console.error('Error parsing stdout message:', error);
      }

      // Call the callback to signal the write completed
      callback();
    },
  });

  // Helper to push data to stdin
  const pushToStdin = (data: any) => {
    const messageBuffer = Buffer.from(JSON.stringify(data));
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32LE(messageBuffer.length, 0);

    // Push the length buffer followed by the message buffer
    stdin.push(lengthBuffer);
    stdin.push(messageBuffer);
  };

  // Helper to read messages from stdout
  const readFromStdout = () => {
    const messages = [...stdoutMessages];
    stdoutMessages.length = 0; // Clear the array
    return messages;
  };

  return {
    stdin,
    stdout,
    pushToStdin,
    readFromStdout,
  };
}

/**
 * Record of actions and their parameters for testing
 */
export interface ActionRecord {
  action: string;
  params: any;
}
