import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { permissionLists } from './src/ui/manifest-permissions';

// The autorun build (fixtures/autorun.mjs) keeps the optional permissions required, unless it is asked to build with the
// product's lists (WXT_PRODUCT_PERMISSIONS), to check the features without them.
const autorun = !!process.env.WXT_AUTORUN_URL;
const productPermissions = !autorun || !!process.env.WXT_PRODUCT_PERMISSIONS;

export default defineConfig({
  imports: false,
  // Unattended development builds (fixtures/autorun.mjs) go elsewhere, so dist/ stays a normal build.
  outDir: !autorun ? 'dist' : productPermissions ? '.output/autorun-product' : '.output/autorun',
  outDirTemplate: '',
  alias: {
    '@src': 'src',
  },
  manifest: {
    // The name, description and the strings Chrome shows itself follow Chrome's language (public/_locales).
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    minimum_chrome_version: '125',
    host_permissions: ['<all_urls>'],
    ...permissionLists(productPermissions ? 'product' : 'autorun'),
    action: { default_icon: 'icon-32.png', default_title: '__MSG_actionTitle__' },
    icons: { 128: 'icon-128.png' },
    commands: {
      'open-panel': { suggested_key: { default: 'Alt+Shift+N' }, description: '__MSG_commandOpenPanel__' },
      'open-test-panel': { description: 'Open the browser control test panel (developers)' },
    },
  },
  // `pnpm zip` packs dist/ into dist-zip/, outside the folder Chrome loads.
  zip: {
    artifactTemplate: '../dist-zip/{{name}}-{{version}}.zip',
    exclude: ['**/*.map'],
  },
  hooks: {
    'zip:extension:start': () => mkdir('dist-zip', { recursive: true }).then(() => {}),
    'config:resolved': wxt => {
      // WXT 0.21.4 still installs Unimport's Vite plugin with imports: false; clear its presets.
      wxt.config.imports.presets = [];
      wxt.config.imports.imports = [];
    },
    'build:manifestGenerated': (_wxt, manifest) => {
      if (manifest.background) (manifest.background as { type?: string }).type = 'module';
      // No panel by default: the worker enables it per tab with a path.
      delete (manifest as { side_panel?: unknown }).side_panel;
    },
  },
  vite: env => ({
    plugins: [react()],
    resolve: {
      alias: {
        // puppeteer-core 25 imports @puppeteer/browsers for the `channel` option, which is never used here.
        '@puppeteer/browsers': resolve(import.meta.dirname, 'src/browser-control/host/puppeteer-browsers-stub.ts'),
      },
      conditions: ['browser', 'module', 'import', 'default'],
      mainFields: ['browser', 'module', 'main'],
    },
    css: {
      postcss: {
        plugins: [tailwindcss({ config: resolve(import.meta.dirname, 'tailwind.config.ts') }), autoprefixer()],
      },
    },
    build: {
      sourcemap: env.mode === 'development',
      minify: env.mode === 'production',
    },
  }),
});
