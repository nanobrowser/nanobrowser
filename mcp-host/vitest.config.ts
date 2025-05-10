import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
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
