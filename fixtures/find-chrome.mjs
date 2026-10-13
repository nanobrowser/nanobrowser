// The Chrome for Testing build the browser scripts launch: CHROME_PATH, or the stable build that pnpm install-chrome
// put in ~/.cache/puppeteer/chrome, never a beta or canary build another project left in the shared cache.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const dir = join(homedir(), '.cache', 'puppeteer', 'chrome');
  let stable;
  try {
    stable = JSON.parse(readFileSync(join(dir, '.metadata'), 'utf8')).aliases?.stable;
  } catch {
    // No metadata: nothing was installed with pnpm install-chrome.
  }
  const builds = stable && existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith(`-${stable}`)) : [];
  for (const build of builds) {
    const mac = join(
      dir,
      build,
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing',
    );
    const macX64 = mac.replace('chrome-mac-arm64', 'chrome-mac-x64');
    const linux = join(dir, build, 'chrome-linux64', 'chrome');
    for (const candidate of [mac, macX64, linux]) if (existsSync(candidate)) return candidate;
  }
  throw new Error('Stable Chrome for Testing not found; run pnpm install-chrome or set CHROME_PATH');
}
