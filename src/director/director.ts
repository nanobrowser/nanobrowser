import { Ring } from './ring';
import type { NavAction, DirectorState, GateConfig, Verdict } from './types';
import { trigger_fired } from './triggers';

export interface PlannerDecision {
  callPlanner: boolean;
  reason?: string;
  N: number;
}

const DEFAULT_CONFIG: GateConfig = {
  N: 3,
  N_min: 2,
  N_max: 10,
  confidence_threshold: 0.6,
  error_window: 5,
  hard_error_min: 2,
  null_gain_window: 3,
  small_budget_tokens: 800,
  gate_time_s: 12,
};

function clampN(config: GateConfig): GateConfig {
  const { N_min, N_max } = config;
  config.N = Math.max(N_min, Math.min(config.N, N_max));
  return config;
}

function extractSiteKey(url: string, fallback?: string): string | undefined {
  try {
    return new URL(url).hostname || fallback;
  } catch {
    return fallback;
  }
}

export class Director {
  private readonly history: Ring<NavAction>;
  private state: DirectorState;

  constructor(historySize = 64, initialSiteKey?: string, cfg?: Partial<GateConfig>) {
    const mergedConfig = clampN({ ...DEFAULT_CONFIG, ...(cfg ?? {}) });
    this.state = {
      config: mergedConfig,
      historySize,
      siteKey: initialSiteKey,
      stepSincePlanner: 0,
      plannerReviewCount: 0,
    };
    this.history = new Ring<NavAction>(historySize);
  }

  onNavigatorStep(action: NavAction): PlannerDecision {
    this.history.push(action);

    this.handleSiteChange(action);

    if (this.state.plannerReviewCount === 0) {
      this.state.stepSincePlanner = 0;
      this.state.plannerReviewCount += 1;
      return { callPlanner: true, reason: 'initial', N: this.state.config.N };
    }

    const historyArray = this.history.toArray();
    const trigger = trigger_fired(historyArray, this.state.config);
    if (trigger) {
      this.state.stepSincePlanner = 0;
      this.state.plannerReviewCount += 1;
      return { callPlanner: true, reason: trigger.name, N: this.state.config.N };
    }

    this.state.stepSincePlanner += 1;
    if (this.state.stepSincePlanner >= this.state.config.N) {
      this.state.stepSincePlanner = 0;
      this.state.plannerReviewCount += 1;
      return { callPlanner: true, reason: 'budget', N: this.state.config.N };
    }

    return { callPlanner: false, N: this.state.config.N };
  }

  onPlannerReview(_verdict: Verdict): void {
    // Block A keeps N static; adaptation arrives in Block B
  }

  getConfig(): GateConfig {
    return { ...this.state.config };
  }

  setConfig(partial: Partial<GateConfig>): void {
    this.state.config = clampN({ ...this.state.config, ...partial });
  }

  private handleSiteChange(action: NavAction): void {
    const currentSite = extractSiteKey(action.url, this.state.siteKey);
    if (!currentSite) {
      return;
    }

    if (this.state.siteKey && this.state.siteKey !== currentSite) {
      this.state.config.N = 3;
      clampN(this.state.config);
      this.state.stepSincePlanner = 0;
      this.state.plannerReviewCount = 0;
    }

    if (!this.state.siteKey || this.state.siteKey !== currentSite) {
      this.state.siteKey = currentSite;
    }
  }
}
