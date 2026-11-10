// Optional routing chooses one model for this run; every choice uses the same agent and browser policies.
import type { DecisionContext, DecisionEngine, RoutingDecision } from '@src/llm/jev';
import type { JevSettings } from '@src/store/jev';
import type { ProviderConfig } from '@src/store/settings';
import type { LivePair } from '@src/store/types';

export interface JevRoute {
  pair: LivePair | null;
  decision?: RoutingDecision;
  rejected: boolean;
  unavailable?: boolean;
}

export async function routeJevModel(
  current: LivePair | null,
  settings: JevSettings,
  providers: ProviderConfig[],
  engine: DecisionEngine,
  context: DecisionContext,
  confirm?: () => Promise<boolean>,
): Promise<JevRoute> {
  const checkStopped = () => {
    if (context.signal?.aborted) throw new DOMException('Jev routing was cancelled.', 'AbortError');
  };
  checkStopped();
  if (!settings.enabled || !settings.routingEnabled) return { pair: current, rejected: false };
  let decision: RoutingDecision;
  try {
    decision = await engine.routeTask(context);
  } catch {
    checkStopped();
    return { pair: current, rejected: false, unavailable: true };
  }
  checkStopped();
  if (decision.outcome === 'confirm') {
    const approved = await confirm?.();
    checkStopped();
    if (!approved) return { pair: current, decision, rejected: true };
  }
  checkStopped();
  const wanted = decision.outcome === 'fast' ? settings.fastModel : settings.capableModel;
  const effort = decision.outcome === 'fast' ? settings.fastReasoning : settings.capableReasoning;
  const found = providers
    .find(p => p.id === wanted?.providerId)
    ?.models.find(m => m.name === wanted?.model && !m.noToolCalling);
  return {
    pair: wanted && found ? { model: wanted, reasoning: effort ?? current?.reasoning ?? 'medium' } : current,
    decision,
    rejected: false,
  };
}
