// Scenarios: one per row of the fixture sets. Each says what it expects and what happened. The Scenarios tab runs
// them one by one or all at once; the autorun check runs them unattended.
import type { Result, Session } from '@src/browser-control';
import { layer } from '../layer';
import { attach } from '../spike-session';
import { emit, register } from '../rpc';
import { openTab } from '../tabs';
import { approveAll, setResponder } from '../prompts';

export type FixtureSet = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'U';

export interface ScenarioOutcome {
  expected: string;
  actual: string;
  pass: boolean;
  details?: unknown;
}

export interface Scenario {
  id: string;
  set: FixtureSet;
  title: string;
  /** What it checks. */
  covers: string;
  run(ctx: ScenarioContext): Promise<ScenarioOutcome>;
}

export interface ScenarioResult extends ScenarioOutcome {
  id: string;
  set: FixtureSet;
  title: string;
  ms: number;
  error?: string;
}

export interface ScenarioContext {
  session: Session;
  /** Opens a tab, shares it with the session and attaches; closed after the scenario. */
  open(url: string, options?: { attach?: boolean }): Promise<number>;
  call(tool: string, args?: Record<string, unknown>): Promise<Result>;
}

const scenarios = new Map<string, Scenario>();

export function defineScenario(scenario: Scenario): void {
  scenarios.set(scenario.id, scenario);
}

export function listScenarios(): Scenario[] {
  return [...scenarios.values()];
}

/** Compares and describes: the outcome passes when every condition holds. */
export function outcome(expected: string, actual: string, pass: boolean, details?: unknown): ScenarioOutcome {
  return { expected, actual, pass, details };
}

export async function runScenario(id: string): Promise<ScenarioResult> {
  const scenario = scenarios.get(id);
  if (!scenario) throw new Error(`Unknown scenario ${id}`);
  const { session } = await layer();
  const opened: number[] = [];
  const ctx: ScenarioContext = {
    session,
    async open(url, options = {}) {
      const tab = await openTab(url);
      opened.push(tab.id!);
      if (options.attach !== false) await attach(tab.id!);
      return tab.id!;
    },
    call: (tool, args = {}) => session.call(tool, args),
  };
  const start = performance.now();
  // Unless a scenario scripts the user itself, the user approves: scenarios about other behaviour are not blocked
  // by the confirmation gate when their buttons happen to be named "Remove" or "Confirm".
  const previous = setResponder(approveAll);
  try {
    const result = await scenario.run(ctx);
    return { id, set: scenario.set, title: scenario.title, ms: Math.round(performance.now() - start), ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id,
      set: scenario.set,
      title: scenario.title,
      ms: Math.round(performance.now() - start),
      expected: '(scenario completed)',
      actual: `threw: ${message}`,
      pass: false,
      error: error instanceof Error ? error.stack : undefined,
    };
  } finally {
    setResponder(previous);
    for (const tabId of opened) {
      await session.unshareTab(tabId).catch(() => undefined);
      await chrome.tabs.remove(tabId).catch(() => undefined);
    }
  }
}

export async function runAll(sets?: FixtureSet[], ids?: string[]): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of listScenarios()) {
    if (sets && !sets.includes(scenario.set)) continue;
    if (ids && !ids.includes(scenario.id)) continue;
    emit('scenario.started', { id: scenario.id });
    const result = await runScenario(scenario.id);
    results.push(result);
    emit('scenario.finished', result);
  }
  return results;
}

register('scenarios.list', async () =>
  listScenarios().map(({ id, set, title, covers }) => ({ id, set, title, covers })),
);
register('scenarios.run', async params => runScenario((params as { id: string }).id));
register('scenarios.runAll', async params => runAll((params as { sets?: FixtureSet[] } | undefined)?.sets));
