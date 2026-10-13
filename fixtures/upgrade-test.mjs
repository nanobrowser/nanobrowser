// The update from the old Nanobrowser, by hand, on the real update path.
//
//   pnpm upgrade-test [--old <path to the old Nanobrowser>] [--no-build]
//
// It builds the old version (../nanobrowser by default) and this one, copies the old build into
// .output/upgrade/ext and opens Chrome for Testing in a window, with a profile of its own and the extension loaded from
// that folder. Set up the old version there: a provider, a few saved prompts, a blocked site, one or two conversations
// with a real model. Then press Enter: the script replaces the folder's contents with this version's build. Click
// Reload on Nanobrowser in chrome://extensions. An unpacked extension's ID comes from its folder, so Chrome keeps the
// ID and the storage and reports an update, as the store's update would. Chrome must stay open in between: an
// extension loaded from the command line is loaded again as a new install when Chrome starts.
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { findChrome } from './find-chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const oldRoot = resolve(root, option('--old') ?? '../nanobrowser');
const build = !argv.includes('--no-build');
const work = join(root, '.output', 'upgrade');
const ext = join(work, 'ext');
const profile = join(work, 'profile');

if (!existsSync(join(oldRoot, 'package.json'))) {
  console.error(`The old Nanobrowser was not found at ${oldRoot}; pass --old <path>.`);
  process.exit(1);
}
if (build) {
  console.log(`Building the old version in ${oldRoot}…`);
  execFileSync('pnpm', ['build'], { cwd: oldRoot, stdio: 'inherit' });
  console.log('Building this version…');
  execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' });
}

// A fresh profile and folder each time, so the old version starts as a new install.
rmSync(work, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
cpSync(join(oldRoot, 'dist'), ext, { recursive: true });

const chrome = spawn(
  findChrome(),
  [
    `--user-data-dir=${profile}`,
    `--load-extension=${ext}`,
    // Chrome for Testing must never reach the real macOS Keychain.
    '--use-mock-keychain',
    '--no-first-run',
    '--no-default-browser-check',
    'chrome://extensions',
  ],
  { stdio: 'ignore' },
);

const ask = createInterface({ input: process.stdin, output: process.stdout });
console.log(`
The old version is loaded from ${ext}.
Set it up: a provider and its key, a few saved prompts, a site on the firewall's deny list, and one or two
conversations with a real model. To record the old storage for the fixture, run this in the old options page's
console and save it, with keys, the user id and the conversations' text replaced by made-up ones:
  copy(JSON.stringify(await chrome.storage.local.get(null), null, 2))`);
await ask.question('\nPress Enter to replace it with this version (keep Chrome open)… ');

rmSync(ext, { recursive: true, force: true });
cpSync(join(root, 'dist'), ext, { recursive: true });
console.log(`
This version is in ${ext}. In chrome://extensions, click Reload on Nanobrowser, then check:
  - the service worker's console says "[install] updated from 0.2.0", and no welcome page opened;
  - the side panel shows "Welcome to the new Nanobrowser", and Got it closes it;
  - the saved prompts are shortcuts (type /), and the default model is the old navigator's;
  - Settings → Permissions has the blocked sites; Settings → Data exports and deletes the old conversations;
  - the toolbar button still opens the panel;
  - no old key is left but the conversations: chrome.storage.local.get(null) in the options page's console.`);
await ask.question('\nPress Enter to close Chrome… ');
ask.close();
chrome.kill();
