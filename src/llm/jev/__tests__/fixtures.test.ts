import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createDecisionEngine, DEFAULT_DECISION_CONFIG, JEV_ENDPOINT } from '../index';
import type { DecisionAction, DecisionCandidate, DecisionContext, DecisionEngine } from '../index';

interface Fixture {
  id: string;
  kind: 'action' | 'completion' | 'routing' | 'selection';
  task: { en: string; zh: string };
  browser: NonNullable<DecisionContext['browser']>;
  action?: DecisionAction;
  candidates?: DecisionCandidate[];
  claimedCompletion?: string;
  choice: string;
  confidence: number;
  expected: string;
  handoff?: boolean;
  acceptance: string;
}

const fixtures: Fixture[] = JSON.parse(
  readFileSync(new URL('../../../../docs/evaluation/jev-fixtures.json', import.meta.url), 'utf8'),
);

it('retains 20 uniquely identified bilingual offline task fixtures', () => {
  expect(fixtures).toHaveLength(20);
  expect(new Set(fixtures.map(fixture => fixture.id)).size).toBe(20);
  for (const fixture of fixtures) {
    expect(fixture.task.en.trim()).not.toBe('');
    expect(fixture.task.zh.trim()).not.toBe('');
  }
});

function mockResponse(fixture: Fixture): Response {
  const question = { action: 'action', completion: 'completion', routing: 'route', selection: 'selection' }[
    fixture.kind
  ];
  const choices = {
    action: ['proceed', 'reconsider', 'confirm'],
    completion: ['complete', 'incomplete', 'needs_verification'],
    routing: ['fast', 'capable', 'planner', 'confirm'],
    selection: [...(fixture.candidates ?? []).map(candidate => candidate.id), '__fallback__'],
  }[fixture.kind];
  const otherProbability = (1 - fixture.confidence) / Math.max(1, choices.length - 1);
  const probabilities = Object.fromEntries(
    choices.map(choice => [choice, choice === fixture.choice ? fixture.confidence : otherProbability]),
  );
  return new Response(
    JSON.stringify({
      model: 'jev-offline-fixture',
      answers: {
        [question]: { type: 'choice', choice: fixture.choice, probabilities, confidence: fixture.confidence },
        ...(fixture.kind === 'completion' ? { handoff: { type: 'noul', noul: fixture.handoff ? 0.99 : 0.01 } } : {}),
      },
      usage: { input_tokens: 100, output_tokens: 10 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

async function evaluate(engine: DecisionEngine, fixture: Fixture, language: 'en' | 'zh') {
  const context: DecisionContext = {
    taskId: `${fixture.id}-${language}`,
    task: fixture.task[language],
    browser: fixture.browser,
    claimedCompletion: fixture.claimedCompletion,
  };
  switch (fixture.kind) {
    case 'action':
      if (!fixture.action) throw new Error(`Missing action for ${fixture.id}`);
      return engine.evaluateAction(context, fixture.action);
    case 'completion':
      return engine.verifyCompletion(context);
    case 'routing':
      return engine.routeTask(context);
    case 'selection':
      return engine.selectAction(context, fixture.candidates ?? []);
  }
}

const cases = fixtures.flatMap(fixture =>
  (['en', 'zh'] as const).map(language => ({ id: fixture.id, fixture, language })),
);

// These are supplied decision responses. No browser action, model prediction, live latency or real cost is measured.
describe('offline mocked decision controls', () => {
  it.each(cases)('$id ($language): disabled and supplied-response paths', async ({ fixture, language }) => {
    const disabledFetch = vi.fn<typeof globalThis.fetch>();
    const disabled = createDecisionEngine(DEFAULT_DECISION_CONFIG, { fetch: disabledFetch });
    const baseline = await evaluate(disabled, fixture, language);
    expect(baseline).toMatchObject({
      outcome: { action: 'proceed', completion: 'complete', routing: 'planner', selection: 'fallback' }[fixture.kind],
      reasonCode: 'disabled',
      metadata: { elapsedMs: 0, apiCalls: 0 },
    });
    expect(disabledFetch).not.toHaveBeenCalled();

    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => mockResponse(fixture));
    const enhanced = createDecisionEngine(
      {
        ...DEFAULT_DECISION_CONFIG,
        enabled: true,
        apiKey: 'offline-fixture-key',
        model: 'jev-offline-fixture',
      },
      { fetch },
    );
    const decision = await evaluate(enhanced, fixture, language);
    expect(decision.outcome).toBe(fixture.expected);
    if ('isHandoff' in decision) expect(decision.isHandoff).toBe(Boolean(fixture.handoff));
    if (fixture.expected === 'selected') expect(decision).toHaveProperty('candidateId', fixture.choice);
    expect(decision.metadata).toMatchObject({ apiCalls: 1, usage: { inputTokens: 100, outputTokens: 10 } });
    expect(decision.metadata.estimatedCost).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [endpoint, options] = fetch.mock.calls[0];
    expect(endpoint).toBe(JEV_ENDPOINT);
    const request = JSON.parse(options?.body as string);
    expect(request.model).toBe('jev-offline-fixture');
    expect(request.state.task).toBe(fixture.task[language]);
    expect(request.state.taskId).toBeUndefined();
  });
});
