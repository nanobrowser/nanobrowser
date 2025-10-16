import { resolve } from 'node:path';
import { copyFileSync, existsSync } from 'node:fs';
import { zipBundle } from './lib/zip-bundle';

// If a preconfigured settings file is provided (env PRECONFIG_SETTINGS) or exists at repo root
// copy it into the chrome-extension public folder so it is included in the zip.
try {
  const root = resolve(__dirname, '../../..');
  const preconfigEnv = process.env.PRECONFIG_SETTINGS;
  const preconfigCandidate = resolve(root, 'preconfigured-settings.json');
  const extPublicSettings = resolve(root, 'chrome-extension', 'public', 'default-settings.json');
  const src = preconfigEnv ? resolve(preconfigEnv) : existsSync(preconfigCandidate) ? preconfigCandidate : null;
  if (src && existsSync(src)) {
    console.log(`zipper: copying preconfigured settings from ${src} to ${extPublicSettings}`);
    copyFileSync(src, extPublicSettings);
  }
} catch (err) {
  console.warn('zipper: failed to copy preconfigured settings:', err);
}

const YYYYMMDD = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const HHmmss = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const fileName = `extension-${YYYYMMDD}-${HHmmss}`;

// package the root dist file
zipBundle({
  distDirectory: resolve(__dirname, '../../dist'),
  buildDirectory: resolve(__dirname, '../../dist-zip'),
  archiveName: process.env.__FIREFOX__ ? `${fileName}.xpi` : `${fileName}.zip`,
});
