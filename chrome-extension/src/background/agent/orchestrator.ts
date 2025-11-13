import { stepControl, DEFAULT_CONTROL_STATE } from './control';
import type { ControlState, Defaults, LLMSettings, Telemetry } from './control';
import { directorMap, constraintTuner } from './director';

const DEFAULTS: Defaults = {
  planner: { temperature: 0.4, top_p: 1, frequency_penalty: 0, presence_penalty: 0, top_k: 50, max_tokens: 512 },
  navigator: { temperature: 0.1, top_p: 0.2, frequency_penalty: 0, presence_penalty: 0, top_k: 50, max_tokens: 384 },
};

interface OrchestratorEnv {
  performPlanner: (opts: { settings: LLMSettings; constraints: ReturnType<typeof constraintTuner> }) => Promise<{
    ok: boolean;
    notes?: string;
  }>;
  performNavigator: (opts: {
    settings: LLMSettings;
    constraints: ReturnType<typeof constraintTuner>;
  }) => Promise<{
    ok: boolean;
    notes?: string;
  }>;
  telemetry: () => Telemetry & { supportsTopK?: boolean };
  log: (msg: string, meta?: unknown) => void;
}

export async function runAdaptiveLoop(env: OrchestratorEnv): Promise<void> {
  let ctrl: ControlState = { ...DEFAULT_CONTROL_STATE };

  // eslint-disable-next-line no-constant-condition
  for (;;) {
    const t = env.telemetry();
    const ctx = {
      inputTokens: t.inputTokens,
      contextWindow: t.contextWindow,
      supportsTopK: t.supportsTopK ?? true,
    };

    ctrl = stepControl(ctrl, t);

    const constraints = constraintTuner(ctrl.g);
    const planSet = directorMap('planner', ctrl.e, ctrl.g, DEFAULTS, ctx);
    const navSet = directorMap('navigator', ctrl.e, ctrl.g, DEFAULTS, ctx);

    env.log('director', {
      e: ctrl.e,
      g: ctrl.g,
      planner: planSet,
      navigator: navSet,
      constraints,
    });

    const plannerOutcome = await env.performPlanner({ settings: planSet, constraints });
    const navigatorOutcome = plannerOutcome.ok
      ? await env.performNavigator({ settings: navSet, constraints })
      : { ok: false, notes: 'planner failed' };

    env.log('outcome', { planner: plannerOutcome, navigator: navigatorOutcome });
  }
}

export { DEFAULTS };
