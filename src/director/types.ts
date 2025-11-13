export type Verdict = 'good' | 'medium' | 'bad';

export interface NavAction {
  action_id: string;
  url: string;
  dom_hash: string;
  success: boolean;
  confidence: number;
  tokens: number;
  runtime_ms: number;
  new_entities: string[];
  error_code: null | { code: number; kind: 'hard' | 'soft' };
  context_change?: boolean;
  risky?: boolean;
}

export interface TriggerHit {
  name:
    | 'loop'
    | 'hard-error-rate'
    | 'null-gain'
    | 'uncertainty'
    | 'cost-latency'
    | 'context-change'
    | 'risky-action';
  detail?: any;
}

export interface GateConfig {
  N: number;
  N_min: number;
  N_max: number;
  confidence_threshold: number;
  error_window: number;
  hard_error_min: number;
  null_gain_window: number;
  small_budget_tokens: number;
  gate_time_s: number;
}

export interface DirectorState {
  config: GateConfig;
  historySize: number;
  siteKey?: string;
  stepSincePlanner: number;
  plannerReviewCount: number;
}
