// Records tier 1 captures of fixture pages as unit test payloads.
import { captureTier1 } from '@src/browser-control';
import { FIXTURE_ORIGIN } from '../fixtures-config';
import { attach } from '../spike-session';
import { defineCheck } from './registry';
import { sleep, withTab } from './helpers';

defineCheck({
  name: 'record-ax',
  title: 'Record AX captures',
  description:
    'Captures fixture pages with the tier 1 capture and returns the payloads, for src/browser-control/core/__tests__/payloads. Arguments: {"pages": ["/form.html", ...]}.',
  async run(args) {
    const pages = (args.pages as string[] | undefined) ?? ['/form.html', '/frames-nested.html', '/shadow-closed.html'];
    const out: Record<string, unknown> = {};
    for (const page of pages) {
      out[page] = await withTab(FIXTURE_ORIGIN + page, async tab => {
        const a = await attach(tab.tabId);
        await sleep(800);
        return captureTier1(tab.tabId, a.cdp, a.topology, { enabledSessions: new Set() });
      });
    }
    return out;
  },
});
