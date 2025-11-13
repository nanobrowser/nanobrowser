import { Defaults, LLMSettings } from './control';

const MAX_TEMP_PLANNER = 1.1;
const MAX_TEMP_NAV = 0.8;
const MAX_TOPK = 220;
const MAX_PRESENCE = 0.9;
const MAX_FREQUENCY = 0.8;
const MIN_TOPP_NAV = 0.2;
const MAX_TOPP_NAV = 0.9;

interface Ctx {
  inputTokens: number;
  contextWindow: number;
  supportsTopK: boolean;
}

const ease = (x: number, gamma = 0.85) => Math.pow(x, gamma);

export function directorMap(
  role: 'planner' | 'navigator',
  e: number,
  g: number,
  defaults: Defaults,
  ctx: Ctx,
): LLMSettings {
  const base = role === 'planner' ? defaults.planner : defaults.navigator;
  const out: LLMSettings = { ...base };
  const intensity = ease(e);
  const navIntensity = ease(e, 0.9);
  const glide = ease(g, 0.9);

  // 1) Temperature: main creativity lever
  if (role === 'planner') {
    out.temperature = clamp(base.temperature + 0.7 * intensity, 0, MAX_TEMP_PLANNER);
  } else {
    out.temperature = clamp(base.temperature + 0.7 * navIntensity, 0, MAX_TEMP_NAV);
  }

  // 2) top_p: keep Planner at 1.0 (already wide), open Navigator smoothly
  if (role === 'planner') {
    out.top_p = clamp(base.top_p, 0.6, 1);
  } else {
    out.top_p = clamp(MIN_TOPP_NAV + (MAX_TOPP_NAV - MIN_TOPP_NAV) * ease(Math.max(e, g), 0.8), 0.1, 0.99);
  }

  // 3) top_k: widen candidate set as e rises
  if (ctx.supportsTopK) {
    const headroom = MAX_TOPK - (base.top_k ?? 50);
    const k = (base.top_k ?? 50) + Math.round(headroom * intensity);
    out.top_k = clamp(k, 20, MAX_TOPK);
  }

  // 4) Novelty penalties (encourage new paths as e rises)
  const penaltyLift = 0.6 * intensity + 0.4 * glide;
  out.presence_penalty = clamp(base.presence_penalty + 0.8 * penaltyLift, 0, MAX_PRESENCE);
  out.frequency_penalty = clamp(base.frequency_penalty + 0.6 * penaltyLift, 0, MAX_FREQUENCY);

  // 5) Response budget: allow longer thoughts when exploring
  const hardCap = Math.max(64, ctx.contextWindow - ctx.inputTokens - 64);
  const budgetBoost = Math.round(256 * Math.max(intensity, glide));
  out.max_tokens = clamp(Math.min(base.max_tokens + budgetBoost, hardCap), 128, hardCap);

  return out;
}

export function constraintTuner(g: number) {
  // Human-readable toggles; the planner reads these to relax constraints smoothly
  // g≈0 → strict; g→1 → permissive
  return {
    allowCrossSite: g > 0.35,
    acceptPartial: g > 0.45, // emit partials with provenance
    relaxFormat: g > 0.6, // loosen non-critical formatting
    widenSemantics: g > 0.5, // accept semantically equivalent sources
    logDeviations: g > 0.3, // require rationale when deviating
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
