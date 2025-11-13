import type { NavAction, TriggerHit, GateConfig } from './types';

export function trigger_fired(history: NavAction[], cfg: GateConfig): TriggerHit | null {
  if (history.length === 0) return null;

  const w5 = history.slice(-cfg.error_window);
  const w3 = history.slice(-cfg.null_gain_window);
  const last = history[history.length - 1];

  // 1) Loop detection: same URL + same DOM ≥ 2 in a row without success/new entities
  if (history.length >= 2) {
    const a = history[history.length - 1];
    const b = history[history.length - 2];
    const noProgress = !a.success && a.new_entities.length === 0 && !b.success && b.new_entities.length === 0;
    const sameState = a.url === b.url && a.dom_hash === b.dom_hash;
    if (sameState && noProgress) {
      return { name: 'loop', detail: { a: a.action_id, b: b.action_id } };
    }
  }

  // 2) Hard error rate in last 5
  const hardErrors = w5.filter((x) => x.error_code?.kind === 'hard').length;
  if (hardErrors >= cfg.hard_error_min) {
    return { name: 'hard-error-rate', detail: { hardErrors } };
  }

  // 3) Null-gain: consecutive actions without new entities / state change
  if (w3.length === cfg.null_gain_window && w3.every((x) => x.new_entities.length === 0 && !x.success)) {
    return { name: 'null-gain' };
  }

  // 4) Uncertainty spike
  if (last.confidence < cfg.confidence_threshold) {
    return { name: 'uncertainty', detail: { c: last.confidence } };
  }

  // 5) Cost/latency spike
  if (last.tokens > cfg.small_budget_tokens || last.runtime_ms > cfg.gate_time_s * 1000) {
    return { name: 'cost-latency', detail: { tokens: last.tokens, ms: last.runtime_ms } };
  }

  // 6) Context change
  if (last.context_change) {
    return { name: 'context-change' };
  }

  // 7) Risky action guard
  if (last.risky) {
    return { name: 'risky-action' };
  }

  return null;
}
