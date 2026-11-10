import { JevDecisionEngine, type JevDependencies } from './jev';
import type {
  ActionDecision,
  CompletionDecision,
  DecisionAction,
  DecisionCandidate,
  DecisionContext,
  DecisionEngine,
  DecisionEngineConfig,
  RoutingDecision,
  SelectionDecision,
} from './types';
export * from './types';
export { DecisionError, isDecisionError } from './errors';

const disabled = {
  reasonCode: 'disabled' as const,
  confidence: 1,
  probability: 1,
  metadata: { elapsedMs: 0, apiCalls: 0 },
};

/** Exactly preserves the original execution path when the integration is disabled. */
export class NoopDecisionEngine implements DecisionEngine {
  async evaluateAction(_context: DecisionContext, _action: DecisionAction): Promise<ActionDecision> {
    void _context;
    void _action;
    return { ...disabled, outcome: 'proceed' };
  }

  async verifyCompletion(_context: DecisionContext): Promise<CompletionDecision> {
    void _context;
    return { ...disabled, outcome: 'complete', isHandoff: false };
  }

  async routeTask(_context: DecisionContext): Promise<RoutingDecision> {
    void _context;
    return { ...disabled, outcome: 'planner' };
  }

  async selectAction(_context: DecisionContext, _candidates: DecisionCandidate[]): Promise<SelectionDecision> {
    void _context;
    void _candidates;
    return { ...disabled, outcome: 'fallback' };
  }
}

export function createDecisionEngine(config: DecisionEngineConfig, dependencies?: JevDependencies): DecisionEngine {
  return config.enabled ? new JevDecisionEngine(config, dependencies) : new NoopDecisionEngine();
}
