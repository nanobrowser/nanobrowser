import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { McpHostTestEnvironment } from '../McpHostTestEnvironment';

/**
 * Tests for MCP Host process lifecycle
 * Focused on starting up, initialization, and shutdown
 */
describe('MCP Host Process Lifecycle', () => {
  let testEnv: McpHostTestEnvironment;

  beforeAll(async () => {
    // Suppress console.error during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeAll(async () => {
    testEnv = new McpHostTestEnvironment();
    await testEnv.setup();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  test('should properly initialize and run', async () => {
    // Verify host process is running
    expect(testEnv.isHostRunning()).toBe(true);

    // Get the assigned port
    const port = testEnv.getPort();
    expect(port).toBeGreaterThan(0);
  });

  test('should respond to shutdown request and exit cleanly', async () => {
    await testEnv.shutdown();

    // Give process time to exit
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify process has exited
    expect(testEnv.isHostRunning()).toBe(false);
  });
});
