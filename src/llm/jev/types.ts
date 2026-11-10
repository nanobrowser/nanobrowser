export interface DecisionAction {
  name: string;
  parameters: Record<string, unknown>;
}

export interface DecisionContext {
  taskId: string;
  task: string;
  browser?: { url: string; title?: string; pageText?: string };
  outcomes?: unknown[];
  claimedCompletion?: unknown;
  signal?: AbortSignal;
}

export interface DecisionCandidate {
  id: string;
  action: DecisionAction;
  label?: string;
}

export interface DecisionEngineConfig {
  enabled: boolean;
  apiKey: string;
  model: string;
  timeoutMs: number;
  proceedThreshold: number;
  completionThreshold: number;
  selectionThreshold?: number;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
}

export const DEFAULT_DECISION_CONFIG: DecisionEngineConfig = {
  enabled: false,
  apiKey: '',
  model: 'jev-latest',
  timeoutMs: 10_000,
  proceedThreshold: 0.8,
  completionThreshold: 0.9,
  selectionThreshold: 0.8,
};

export type DecisionReasonCode =
  | 'disabled'
  | 'approved'
  | 'action_reconsideration'
  | 'confirmation_required'
  | 'low_confidence'
  | 'task_complete'
  | 'task_incomplete'
  | 'evidence_insufficient'
  | 'handoff'
  | 'fast_task'
  | 'complex_task'
  | 'planner_required'
  | 'sensitive_task'
  | 'candidate_selected'
  | 'generative_fallback'
  | 'no_candidates';

export interface DecisionMetadata {
  elapsedMs: number;
  apiCalls: number;
  usage?: { inputTokens: number; outputTokens: number };
  /** USD, only when both prices were configured and usage is present. */
  estimatedCost?: number;
}

export interface DecisionResult<Outcome extends string> {
  outcome: Outcome;
  reasonCode: DecisionReasonCode;
  confidence: number;
  probability: number;
  metadata: DecisionMetadata;
}

export type ActionDecision = DecisionResult<'proceed' | 'reconsider' | 'confirm'>;
export interface CompletionDecision extends DecisionResult<'complete' | 'incomplete' | 'needs_verification'> {
  isHandoff: boolean;
}
export type RoutingDecision = DecisionResult<'fast' | 'capable' | 'planner' | 'confirm'>;
export interface SelectionDecision extends DecisionResult<'selected' | 'fallback'> {
  candidateId?: string;
}

export interface DecisionEngine {
  evaluateAction(context: DecisionContext, action: DecisionAction): Promise<ActionDecision>;
  verifyCompletion(context: DecisionContext): Promise<CompletionDecision>;
  routeTask(context: DecisionContext): Promise<RoutingDecision>;
  selectAction(context: DecisionContext, candidates: DecisionCandidate[]): Promise<SelectionDecision>;
}
