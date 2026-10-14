// Runs the scenarios unattended (the Scenarios tab's "run all"); fails when any scenario fails.
import { runAll } from '../scenarios/registry';
import type { FixtureSet } from '../scenarios/registry';
import { defineCheck } from './registry';
import { setBackgroundMode } from '../tabs';

defineCheck({
  name: 'scenarios',
  title: 'Scenarios: run all',
  description:
    'Runs every scenario, or those of the given sets or IDs. Arguments: {"sets": ["A", "B"]} or {"ids": ["D-3.5-fill-stops"]}.',
  async run(args) {
    // {"background": true}: every fixture tab opens behind a tab the user stays on.
    if (args.background) await setBackgroundMode(true);
    let results;
    try {
      results = await runAll(args.sets as FixtureSet[] | undefined, args.ids as string[] | undefined);
    } finally {
      if (args.background) await setBackgroundMode(false);
    }
    const failed = results.filter(r => !r.pass);
    const summary = results.map(r => `${r.pass ? 'PASS' : 'FAIL'} ${r.id} (${r.ms} ms): ${r.actual}`);
    if (failed.length)
      throw new Error(`${failed.length} of ${results.length} scenarios failed:\n${summary.join('\n')}`);
    return { summary, results };
  },
});
