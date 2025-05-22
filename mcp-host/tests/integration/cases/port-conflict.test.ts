import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { ChildProcess, spawn } from 'child_process';
import * as net from 'net';
import { createLogger } from '../../../src/logger';

/**
 * Tests for MCP Host port conflict handling
 * Verifies the host fails to start when the specified port is already in use
 */
describe('MCP Host Port Conflict', () => {
  let blockingServer: net.Server;
  let blockedPort: number;
  let logger = createLogger('port-conflict-test');

  beforeAll(async () => {
    // Create a server to block a specific port
    blockingServer = await createBlockingServer();
    blockedPort = (blockingServer.address() as net.AddressInfo).port;
    logger.info(`Created blocking server on port ${blockedPort}`);
  });

  afterAll(async () => {
    // Clean up resources
    if (blockingServer) {
      await new Promise<void>(resolve => blockingServer.close(() => resolve()));
    }
  });

  test('should fail to start when port is already in use', async () => {
    let hostProcess: ChildProcess | null = null;

    try {
      // Start the MCP host process with the blocked port
      hostProcess = spawn('node', ['./dist/index.js'], {
        stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout and stderr
        env: {
          ...process.env,
          LOG_LEVEL: 'DEBUG',
          PORT: blockedPort.toString(),
        },
      });

      // Collect both stdout and stderr output
      let stderr = '';
      let stdout = '';

      hostProcess.stderr?.on('data', data => {
        const str = data.toString();
        stderr += str;
        logger.info(`STDERR: ${str}`);
      });

      hostProcess.stdout?.on('data', data => {
        const str = data.toString();
        stdout += str;
        logger.info(`STDOUT: ${str}`);
      });

      // Wait for process exit or timeout
      const exitCode = await Promise.race([
        new Promise<number>(resolve => {
          hostProcess?.on('exit', code => resolve(code ?? -1));
        }),
        new Promise<number>(resolve => {
          // If process doesn't exit on its own, consider it a test failure
          setTimeout(() => resolve(-2), 5000);
        }),
      ]);

      // Check exit conditions
      if (exitCode === -2) {
        // Force kill the process if it didn't exit on its own
        hostProcess.kill();
        throw new Error('Process did not exit within timeout period');
      }

      // Process should exit or log error due to port conflict
      logger.info(`Process exited with code: ${exitCode}`);
      logger.info(`Process stderr length: ${stderr.length}`);
      logger.info(`Process stdout length: ${stdout.length}`);

      // Check for port conflict error messages in either stdout or stderr
      const portConflictPatterns = [
        'EADDRINUSE',
        'address already in use',
        'port is already in use',
        'port.*already.*use',
        'address.*in use',
        'Cannot start server on port',
        'Error.*listening',
        'Failed to start',
        'Failed to auto-start', // Additional pattern based on error handling in index.ts
        'Exception during .* server .* start', // Additional pattern based on error handling in index.ts
      ];

      const combinedOutput = stdout + stderr;

      // Log the full output for debugging
      logger.info('Full process output:');
      logger.info(combinedOutput);

      const hasPortConflictError = portConflictPatterns.some(pattern => new RegExp(pattern, 'i').test(combinedOutput));

      if (!hasPortConflictError) {
        logger.info('ERROR: Could not find any port conflict messages in output');
        logger.info('Checking for these patterns:', portConflictPatterns);
        logger.info('Full output again for verification:');
        logger.info(stdout);
        logger.info(stderr);
      }

      // The actual test: The MCP Host either:
      // 1. Has port conflict messages in output (even if exit code is 0), OR
      // 2. Exits with a non-zero code
      expect(hasPortConflictError).toBe(true);
    } finally {
      // Always clean up resources
      if (hostProcess && !hostProcess.killed) {
        hostProcess.kill();
      }
    }
  });

  // Helper function to create a server blocking a port
  async function createBlockingServer(): Promise<net.Server> {
    return new Promise(resolve => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        resolve(server);
      });
    });
  }
});
