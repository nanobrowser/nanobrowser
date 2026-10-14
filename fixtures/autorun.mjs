// Unattended run of the test extension's checks and scenarios, for development.
//
//   node fixtures/autorun.mjs <check>[,<check>...] [--args '<json>'] [--headful] [--no-build] [--timeout <s>]
//                             [--scale <device scale factor>] [--product-permissions]
//
// It builds the extension into .output/autorun with WXT_AUTORUN_URL set, starts the fixture server with one
// queued job, and starts Chrome for Testing as a plain process with the extension loaded. The extension asks the
// server for the job, runs it in its service worker and posts the reports back. Nothing connects to Chrome over
// CDP: the only CDP client is the extension itself, through chrome.debugger.
//
// The autorun build requires the permissions the product only asks for (tab groups, notifications, downloads), so the
// checks that use them run without a click. --product-permissions builds with the product's lists instead, into
// .output/autorun-product, for the checks of the features without them (`without-permissions`); the checks that need
// the permissions (`panel-tabs`, `panel-save`, ...) are not run with it.
//
// The check `permission-warnings` gets the old Nanobrowser's manifest (fixtures/upgrade/old-manifest.json) in its
// arguments.
//
// Chrome: CHROME_PATH, or the stable Chrome for Testing that pnpm install-chrome put in ~/.cache/puppeteer/chrome.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { autorunEvents, PORT, queueAutorunJob, startServer } from './server.mjs';
import { findChrome } from './find-chrome.mjs';

const root = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const option = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const names = (
  argv.find(a => !a.startsWith('--') && !['--args', '--timeout', '--scale'].includes(argv[argv.indexOf(a) - 1])) ?? ''
)
  .split(',')
  .filter(Boolean);
if (!names.length) {
  console.error('usage: node fixtures/autorun.mjs <check>[,<check>...] [--args <json>] [--headful] [--no-build]');
  process.exit(2);
}
const args = option('--args') ? JSON.parse(option('--args')) : {};
const timeoutMs = Number(option('--timeout') ?? 300) * 1000;
const base = `http://localhost:${PORT}`;
const productPermissions = flag('--product-permissions');
const outDir = join(root, '.output', productPermissions ? 'autorun-product' : 'autorun');

if (!flag('--no-build')) {
  execFileSync('corepack', ['pnpm', 'exec', 'wxt', 'build'], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, WXT_AUTORUN_URL: base, ...(productPermissions ? { WXT_PRODUCT_PERMISSIONS: '1' } : {}) },
  });
}

const server = await startServer();
const argsOf = name =>
  name === 'permission-warnings'
    ? { ...args, oldManifest: JSON.parse(readFileSync(join(root, 'fixtures', 'upgrade', 'old-manifest.json'), 'utf8')) }
    : args;
queueAutorunJob({ checks: names.map(name => ({ name, args: argsOf(name) })) });

const profile = mkdtempSync(join(tmpdir(), 'nb3-autorun-'));
const chromeArgs = [
  `--user-data-dir=${profile}`,
  `--load-extension=${outDir}`,
  `--disable-extensions-except=${outDir}`,
  // Chrome for Testing never touches the real macOS Keychain: it keeps its passwords and cookies' key in a mock one.
  '--use-mock-keychain',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-search-engine-choice-screen',
  '--enable-logging=stderr',
  '--v=0',
  '--window-size=1280,900',
  // A fake microphone (a tone) that is allowed without a prompt, so the voice check can record.
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  // The interface follows the browser's language by default, so checks pin it to English whatever the machine's is.
  '--lang=en-US',
  '--accept-lang=en-US',
  // A display with more than one device pixel per CSS pixel (a Retina display is 2).
  ...(option('--scale') ? [`--force-device-scale-factor=${option('--scale')}`] : []),
  ...(flag('--headful') ? [] : ['--headless=new']),
  // Headless Chrome announces itself in its user agent, and some real sites then serve a block page.
  ...(flag('--real-ua')
    ? [
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
      ]
    : []),
  'about:blank',
];
const chrome = spawn(findChrome(), chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
const consoleLines = [];
chrome.stderr.setEncoding('utf8');
chrome.stderr.on('data', chunk => {
  for (const line of chunk.split('\n')) {
    const m = /:CONSOLE[^\]]*\] "(.*)", source: (.*)$/.exec(line);
    if (m && m[2].startsWith('chrome-extension://')) {
      consoleLines.push(m[1]);
      if (flag('--verbose')) console.log('  [console]', m[1]);
    }
  }
});

autorunEvents.on('progress', report => {
  console.log(`${report.ok ? 'PASS' : 'FAIL'} ${report.name} (${report.durationMs} ms)`);
  if (!report.ok) console.log(report.error);
});

const result = await new Promise(resolveResult => {
  const timer = setTimeout(() => resolveResult({ timedOut: true, reports: [] }), timeoutMs);
  autorunEvents.once('report', body => {
    clearTimeout(timer);
    resolveResult({ timedOut: false, ...body });
  });
  chrome.once('exit', code => {
    clearTimeout(timer);
    resolveResult({ timedOut: false, exited: code, reports: [] });
  });
});

const exited = new Promise(r => (chrome.exitCode !== null ? r() : chrome.once('exit', r)));
chrome.kill();
await exited;
server.close();
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch {
  // A leftover temporary profile is harmless.
}

const resultsDir = join(root, 'fixtures', '.results');
mkdirSync(resultsDir, { recursive: true });
// A long list of checks is named by its first ones and a count, within the file system's 255-byte limit.
const label =
  names.join('+').length <= 120 ? names.join('+') : `${names.slice(0, 3).join('+')}+${names.length - 3}-more`;
const file = join(resultsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.json`);
// Images in reports (data URLs) are written next to the JSON and replaced with their path.
let imageCount = 0;
const extractImages = value => {
  if (typeof value === 'string' && value.startsWith('data:image/png;base64,')) {
    const png = file.replace(/\.json$/, `-${++imageCount}.png`);
    writeFileSync(png, Buffer.from(value.slice('data:image/png;base64,'.length), 'base64'));
    return png;
  }
  if (Array.isArray(value)) return value.map(extractImages);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, extractImages(v)]));
  return value;
};
writeFileSync(file, JSON.stringify(extractImages({ names, args, ...result, console: consoleLines }), null, 2));
console.log(`results: ${file}`);
if (result.timedOut) console.log('TIMEOUT: no report from the extension');
const failed = result.timedOut || !result.reports.length || result.reports.some(r => !r.ok);
process.exit(failed ? 1 : 0);
