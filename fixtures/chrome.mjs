// Housekeeping for the Chrome for Testing that pnpm autorun starts, in Puppeteer's cache (~/.cache/puppeteer).
//
//   node fixtures/chrome.mjs install [--yes]   install the current stable release, then remove every other build
//   node fixtures/chrome.mjs clean [--yes]     remove the whole cache (every browser Puppeteer downloaded)
//
// pnpm install-chrome runs install and pnpm clean-chrome runs clean. Both ask before deleting anything; --yes
// answers for them, and without a terminal nothing is deleted. The cache is shared with other projects that use
// Puppeteer; any of them downloads its browser again when needed.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { createInterface } from 'node:readline';

// The version of @puppeteer/browsers that puppeteer-core depends on, run without adding a dependency.
const browsersCli = '@puppeteer/browsers@3.2.3';
const cacheDir = join(homedir(), '.cache', 'puppeteer');
const chromeDir = join(cacheDir, 'chrome');
const [command, ...flags] = process.argv.slice(2);
const yes = flags.includes('--yes');

function confirm(question) {
  if (yes) return Promise.resolve(true);
  if (!process.stdin.isTTY) {
    console.log('No terminal to ask in; nothing removed (pass --yes to remove).');
    return Promise.resolve(false);
  }
  // End of input (Ctrl-D) and Ctrl-C close the prompt and count as no.
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answer = '';
    rl.on('SIGINT', () => rl.close());
    rl.on('close', () => resolve(/^y(es)?$/i.test(answer.trim())));
    rl.question(`${question} [y/N] `, line => {
      answer = line;
      rl.close();
    });
  });
}

// pnpm dlx through the pnpm that runs this script (npm_execpath), so corepack pnpm works without a global pnpm.
function dlx(args) {
  const execPath = process.env.npm_execpath;
  const [cmd, cmdArgs] = /\.[cm]?js$/.test(execPath ?? '')
    ? [process.execPath, [execPath, 'dlx', ...args]]
    : ['pnpm', ['dlx', ...args]];
  const result = spawnSync(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? '');
    throw new Error(`${browsersCli} install failed${result.error ? `: ${result.error.message}` : ''}`);
  }
  return result.stdout;
}

if (command === 'install') {
  const out = dlx([browsersCli, 'install', 'chrome@stable', '--path', cacheDir, '--format', '{{buildId}} {{path}}']);
  // The last line is the formatted result; pnpm's own progress comes before it.
  const [buildId, ...pathParts] = out.trim().split('\n').pop().split(' ');
  const executable = pathParts.join(' ');
  const installed = relative(chromeDir, executable).split(sep)[0];
  if (!installed || installed.startsWith('..') || !existsSync(join(chromeDir, installed))) {
    throw new Error(`Unexpected install output, nothing removed: ${out.trim()}`);
  }
  console.log(`Chrome for Testing ${buildId}: ${executable}`);
  // Keep exactly the build just installed, whatever its platform or channel; files such as .metadata (the stable
  // alias of @puppeteer/browsers) are kept too.
  const others = readdirSync(chromeDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== installed)
    .map(d => d.name);
  if (others.length > 0) {
    console.log(`Other builds in ${chromeDir}:`);
    for (const build of others) console.log(`  ${build}`);
    if (await confirm(`Remove these ${others.length} builds and keep only ${installed}?`)) {
      for (const build of others) rmSync(join(chromeDir, build), { recursive: true, force: true });
      console.log('Removed.');
    }
  }
} else if (command === 'clean') {
  const entries = existsSync(cacheDir) ? readdirSync(cacheDir) : [];
  if (entries.length === 0) {
    console.log(`${cacheDir} is already empty.`);
  } else {
    console.log(`${cacheDir} holds:`);
    for (const entry of readdirSync(cacheDir, { withFileTypes: true }).filter(d => d.isDirectory())) {
      const builds = readdirSync(join(cacheDir, entry.name), { withFileTypes: true }).filter(d => d.isDirectory());
      console.log(`  ${entry.name}: ${builds.map(d => d.name).join(', ') || '(empty)'}`);
    }
    if (await confirm(`Remove all of ${cacheDir}? Other projects that use Puppeteer download their browser again.`)) {
      rmSync(cacheDir, { recursive: true, force: true });
      console.log('Removed. Run pnpm install-chrome before pnpm autorun.');
    }
  }
} else {
  console.error('Usage: node fixtures/chrome.mjs install|clean [--yes]');
  process.exit(1);
}
