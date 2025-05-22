import { resolve } from 'path';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

const rootDir = resolve(__dirname);
const srcDir = resolve(rootDir, 'src');
const outDir = resolve(rootDir, 'dist');

export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  plugins: [
    tsconfigPaths(),
    // VitePluginNode has compatibility issues with the current Vite version
  ],
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: 'node16',

    // Build for ESM
    lib: {
      entry: {
        index: resolve(srcDir, 'index.ts'),
      },
      formats: ['es'],
      fileName: (format, entryName) => `${entryName}.js`,
    },

    rollupOptions: {
      external: [
        'express',
        'zod',
        'async_hooks',
        'string_decoder',
        'crypto',
        'os',
        'fs',
        'path',
        'http',
        'url',
        'buffer',
        'node:crypto',
        '@modelcontextprotocol/sdk',
      ],
    },
  },
  optimizeDeps: {
    exclude: ['fsevents'],
  },
  server: {
    port: 8765,
    host: 'localhost',
  },
});
