import { Director } from '../src/director/director';
import type { NavAction } from '../src/director/types';

function act(id: number, partial: Partial<NavAction>): NavAction {
  return {
    action_id: `a${id}`,
    url: partial.url ?? 'https://example.com/page',
    dom_hash: partial.dom_hash ?? 'h1',
    success: partial.success ?? false,
    confidence: partial.confidence ?? 0.7,
    tokens: partial.tokens ?? 200,
    runtime_ms: partial.runtime_ms ?? 300,
    new_entities: partial.new_entities ?? [],
    error_code: partial.error_code ?? null,
    context_change: partial.context_change ?? false,
    risky: partial.risky ?? false,
  };
}

async function run() {
  const director = new Director(16);

  const sequence: NavAction[] = [
    act(1, { success: false, new_entities: [], confidence: 0.9 }),
    act(2, { success: false, new_entities: [], confidence: 0.9 }),
    act(3, { success: false, new_entities: [], confidence: 0.9 }),
    act(4, { success: false, new_entities: ['lead'], error_code: { code: 500, kind: 'hard' } }),
    act(5, { success: false, error_code: { code: 504, kind: 'hard' } }),
    act(6, { success: false, confidence: 0.3 }),
    act(7, { context_change: true }),
    act(8, { risky: true }),
  ];

  sequence.forEach((action, index) => {
    const gate = director.onNavigatorStep(action);
    console.log(`[${index + 1}] step=${action.action_id} gate=`, gate);
    if (gate.callPlanner) {
      director.onPlannerReview('medium');
    }
  });
}

run().catch((error) => {
  console.error('Simulation error', error);
  process.exitCode = 1;
});
