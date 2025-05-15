import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Run integration tests in a single process to avoid serialization issues
    // with complex objects like axios instances
    pool: process.env.TEST_POOL || 'forks',
    poolOptions: {
      threads: {
        singleThread: process.env.TEST_TYPE === 'integration',
      },
      forks: {
        singleFork: process.env.TEST_TYPE === 'integration',
      },
    },
    // For integration tests, run sequentially with increased timeouts
    sequence: process.env.TEST_TYPE === 'integration' ? { shuffle: false } : undefined,
    // Prevent token limit issues with integration tests
    testTimeout: process.env.TEST_TYPE === 'integration' ? 30000 : 5000,
    // Run only files matching the pattern sequentially
    fileParallelism: process.env.TEST_TYPE === 'integration' ? false : true,
    // Give more time for file watching operations to avoid reload conflicts
    chaiConfig: {
      includeStack: true,
    },
    deps: {
      // Disable module dependency tracking so Jest imports can work
      interopDefault: true,
      inline: [/@jest\/globals/],
    },
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
