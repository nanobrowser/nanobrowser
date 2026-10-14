import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@src': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
  },
});
