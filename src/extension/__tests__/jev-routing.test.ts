import { describe, expect, it, vi } from 'vitest';
import type { DecisionEngine, RoutingDecision } from '@src/llm/jev';
import type { JevSettings } from '@src/store/jev';
import type { LivePair } from '@src/store/types';
import { routeJevModel } from '../jev-routing';

const settings: JevSettings = {
  enabled: true,
  model: 'jev-latest',
  timeoutMs: 10_000,
  proceedThreshold: 0.8,
  completionThreshold: 0.9,
  selectionThreshold: 0.8,
  routingEnabled: true,
  system1Enabled: false,
  fastModel: { providerId: 'p', model: 'fast' },
  capableModel: { providerId: 'p', model: 'capable' },
};
const current: LivePair = { model: { providerId: 'p', model: 'chosen' }, reasoning: 'medium' };
const providers = [
  {
    id: 'p',
    kind: 'openai-compatible' as const,
    name: 'Local',
    models: ['chosen', 'fast', 'capable'].map(name => ({ name })),
  },
];
const decision = (outcome: RoutingDecision['outcome']): RoutingDecision => ({
  outcome,
  reasonCode: 'fast_task',
  confidence: 0.9,
  probability: 0.9,
  metadata: { elapsedMs: 3, apiCalls: 1 },
});

describe('Jev task-start model routing', () => {
  it('applies the saved effort for each routed model while leaving the chosen pair unchanged', async () => {
    const config = { ...settings, fastReasoning: 'none' as const, capableReasoning: 'high' as const };
    for (const [outcome, effort] of [
      ['fast', 'none'],
      ['capable', 'high'],
    ] as const) {
      const engine = { routeTask: async () => decision(outcome) } as unknown as DecisionEngine;
      const result = await routeJevModel(current, config, providers, engine, { taskId: 'r', task: 'Read' });
      expect(result.pair?.reasoning).toBe(effort);
    }
    expect(current.reasoning).toBe('medium');
  });
  it('uses the capable model for planner outcomes without creating a second agent', async () => {
    const routeTask = vi.fn(async () => decision('planner'));
    const result = await routeJevModel(current, settings, providers, { routeTask } as unknown as DecisionEngine, {
      taskId: 'r',
      task: 'Compare reports',
    });
    expect(result.pair?.model).toEqual(settings.capableModel);
    expect(routeTask).toHaveBeenCalledTimes(1);
  });
  it('retains the chosen model when a routed reference is missing or cannot call tools', async () => {
    const engine = { routeTask: async () => decision('fast') } as unknown as DecisionEngine;
    for (const configured of [[], [{ ...providers[0], models: [{ name: 'fast', noToolCalling: true }] }]]) {
      const result = await routeJevModel(current, settings, configured, engine, { taskId: 'r', task: 'Read' });
      expect(result.pair).toBe(current);
    }
  });
  it('chooses the configured fast model once while preserving the run effort', async () => {
    const routeTask = vi.fn(async () => decision('fast'));
    const result = await routeJevModel(current, settings, providers, { routeTask } as unknown as DecisionEngine, {
      taskId: 'r',
      task: 'Read a heading',
    });
    expect(result.pair).toEqual({ model: settings.fastModel, reasoning: 'medium' });
    expect(result.rejected).toBe(false);
    expect(routeTask).toHaveBeenCalledTimes(1);
    expect(current.model.model).toBe('chosen');
  });
  it('keeps the exact chosen pair and makes no decision call while routing is disabled', async () => {
    const routeTask = vi.fn(async () => decision('fast'));
    for (const config of [
      { ...settings, enabled: false },
      { ...settings, routingEnabled: false },
    ]) {
      const result = await routeJevModel(current, config, providers, { routeTask } as unknown as DecisionEngine, {
        taskId: 'r',
        task: 'Read',
      });
      expect(result).toEqual({ pair: current, rejected: false });
    }
    expect(routeTask).not.toHaveBeenCalled();
  });
  it('requires a fresh explicit approval for confirm and never treats resume as approval', async () => {
    const engine = { routeTask: async () => decision('confirm') } as unknown as DecisionEngine;
    const reject = vi.fn(async () => false);
    expect(
      await routeJevModel(current, settings, providers, engine, { taskId: 'r', task: 'Send' }, reject),
    ).toMatchObject({ pair: current, rejected: true });
    expect(reject).toHaveBeenCalledTimes(1);
    expect(await routeJevModel(current, settings, providers, engine, { taskId: 'r', task: 'Send' })).toMatchObject({
      rejected: true,
    });
    const approve = vi.fn(async () => true);
    expect(
      await routeJevModel(current, settings, providers, engine, { taskId: 'r', task: 'Send' }, approve),
    ).toMatchObject({ pair: { model: settings.capableModel }, rejected: false });
    expect(approve).toHaveBeenCalledTimes(1);
  });
  it('falls back to the chosen model on service failure without reflecting private provider errors', async () => {
    const engine = {
      routeTask: async () => {
        throw new Error('private-key private-task');
      },
    } as unknown as DecisionEngine;
    expect(await routeJevModel(current, settings, providers, engine, { taskId: 'r', task: 'Read' })).toEqual({
      pair: current,
      rejected: false,
      unavailable: true,
    });
  });
  it('stops routing on cancellation instead of falling through to a model request', async () => {
    const controller = new AbortController();
    controller.abort(new Error('private cancellation reason'));
    const routeTask = vi.fn(async () => decision('fast'));
    await expect(
      routeJevModel(current, settings, providers, { routeTask } as unknown as DecisionEngine, {
        taskId: 'r',
        task: 'Read',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(routeTask).not.toHaveBeenCalled();
  });
  it('treats Stop while an approval is pending as cancellation, not a declined task', async () => {
    const controller = new AbortController();
    const engine = { routeTask: async () => decision('confirm') } as unknown as DecisionEngine;
    await expect(
      routeJevModel(
        current,
        settings,
        providers,
        engine,
        { taskId: 'r', task: 'Send', signal: controller.signal },
        async () => {
          controller.abort();
          return false;
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
