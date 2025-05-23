import { resolve } from 'path';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

const rootDir = resolve(__dirname);
const srcDir = resolve(rootDir, 'src');
const outDir = resolve(rootDir, 'dist');

export default defineConfig({
  // Resolve TypeScript path aliases (ensure 'paths' is properly configured in tsconfig.json)
  plugins: [
    tsconfigPaths({
      // Allow resolving path aliases in non-TypeScript files (like Vue templates) [[1]]
      strict: false,
    }),
  ],

  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    target: 'node16', // Specify Node.js version [[8]]

    // Output as CommonJS format (recommended for Node.js)
    lib: {
      entry: {
        index: resolve(srcDir, 'index.ts'),
      },
      formats: ['cjs'], // Use CommonJS format [[2]]
      fileName: (format, entryName) => `${entryName}.cjs`, // Adapt file extension
    },

    rollupOptions: {
      // Exclude all Node.js built-in modules (to avoid bundling errors) [[9]]
      external: [
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
        'net', // Added: Exclude browser-incompatible built-in modules
        'querystring',
        'stream',
        'util',
        'zlib',
        'iconv2',
      ],
      output: {
        // Ensure all dynamically imported modules are inlined into a single file [[3]]
        inlineDynamicImports: true,
        format: 'cjs', // Output format consistent with lib.formats
      },
    },
  },
  optimizeDeps: {
    exclude: ['fsevents'], // Exclude native modules
  },
});
