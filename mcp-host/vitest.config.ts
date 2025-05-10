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
