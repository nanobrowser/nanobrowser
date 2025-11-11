import { describe, expect, it } from 'vitest';

import { resolvePlannerInterval } from '../executor';
import { DEFAULT_AGENT_OPTIONS, type AgentContext } from '../types';

function createContext(overrides: Partial<AgentContext> = {}): AgentContext {
  const options = overrides.options ?? { ...DEFAULT_AGENT_OPTIONS };

  return {
    controller: new AbortController(),
    taskId: 'task-id',
    browserContext: {} as any,
    messageManager: {} as any,
    eventManager: {} as any,
    options,
    paused: false,
    stopped: false,
    consecutiveFailures: 0,
    nSteps: 0,
    stepInfo: null,
    actionResults: [],
    stateMessageAdded: false,
    history: {} as any,
    finalAnswer: null,
    currentPlannerInterval: options.planningInterval,
    lastPlannerAdjustmentStep: -1,
    ...overrides,
    options: overrides.options ?? options,
  } as AgentContext;
}

describe('resolvePlannerInterval', () => {
  it('records the current step when the planner interval changes', () => {
    const context = createContext({
      nSteps: 4,
      currentPlannerInterval: 3,
      lastPlannerAdjustmentStep: 1,
      options: { ...DEFAULT_AGENT_OPTIONS, planningInterval: 5 },
    });

    const cadence = resolvePlannerInterval(context);

    expect(cadence.interval).toBe(5);
    expect(cadence.lastAdjustmentStep).toBe(4);
  });

  it('returns sanitized cadence values when initialization is required', () => {
    const context = createContext({
      nSteps: 0,
      currentPlannerInterval: 2,
      lastPlannerAdjustmentStep: -1,
      options: { ...DEFAULT_AGENT_OPTIONS, planningInterval: 2.6 },
    });

    const cadence = resolvePlannerInterval(context);

    expect(cadence.interval).toBe(3);
    expect(cadence.lastAdjustmentStep).toBe(0);
  });

  it('preserves existing cadence metadata when the options value is invalid', () => {
    const context = createContext({
      nSteps: 6,
      currentPlannerInterval: 4,
      lastPlannerAdjustmentStep: 2,
      options: { ...DEFAULT_AGENT_OPTIONS, planningInterval: Number.NaN },
    });

    const cadence = resolvePlannerInterval(context);

    expect(cadence.interval).toBe(4);
    expect(cadence.lastAdjustmentStep).toBe(2);
  });
});
