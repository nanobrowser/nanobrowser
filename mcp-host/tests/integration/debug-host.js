import { spawn } from 'child_process';
import http from 'http';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { URL } from 'url';

// Debug port for the MCP host
const port = 3334;

// Start the MCP host process
console.log(`Starting MCP host process on port ${port}...`);
const hostProcess = spawn('node', ['./dist/index.js'], {
  stdio: 'inherit', // Directly pipe to the parent process for visibility
  env: {
    ...process.env,
    LOG_LEVEL: 'debug',
    PORT: port.toString(),
    DEBUG: 'true',
  },
});

// Handle process events
hostProcess.on('error', err => {
  console.error('Failed to start MCP host process:', err);
  process.exit(1);
});

// Function to check if the HTTP server is up
function checkServer() {
  return new Promise(resolve => {
    setTimeout(() => {
      console.log(`Checking if server is up on port ${port}...`);

      const baseURL = 'http://localhost:' + port + '/mcp';
      const client = new Client({
        name: 'mcp-test-client',
        version: '1.0.0',
      });

      const transport = new StreamableHTTPClientTransport(new URL(baseURL));

      // Connect and initialize
      client.connect(transport);
      console.log('Connected using Streamable HTTP transport');
    }, 1000); // Wait 1 second before making the request
  });
}

// Main function
async function main() {
  console.log('Waiting for server to start...');

  // Try to connect multiple times
  let serverUp = false;
  for (let i = 0; i < 10; i++) {
    serverUp = await checkServer();
    if (serverUp) {
      console.log('Server is up!');
      break;
    }
    console.log(`Attempt ${i + 1} failed, retrying...`);
  }

  if (!serverUp) {
    console.error('Server failed to start after multiple attempts');
    hostProcess.kill();
    process.exit(1);
  }

  // Keep the process running for manual testing
  console.log('Press Ctrl+C to stop');
}

// Handle cleanup
process.on('SIGINT', () => {
  console.log('Shutting down...');
  hostProcess.kill();
  process.exit(0);
});

// Run the main function
main().catch(err => {
  console.error('Error in main function:', err);
  hostProcess.kill();
  process.exit(1);
});
