// Model profiles. Each fact comes from the first source that states it: the overrides stored on the model entry (no
// Settings control), what a test or a run learnt (`tested`), what the model's API said (`fromApi`), the catalogue's
// row (src/llm/catalogue.ts), then the endpoint's defaults.
// Detection from a local server then lowers the window.
import { defaults, findRow, isCloudEndpoint, sendRule } from './catalogue';
import type { ReasoningEffort, ReasoningSupport, WireEffort } from './catalogue';
import type { ProviderKind } from './providers';

export interface ModelProfile {
  contextWindow: number;
  maxOutput: number;
  vision: boolean;
  /** Whether the model reasons, and whether None is accepted on the wire. Absent when unknown. */
  reasoning?: ReasoningSupport;
  /** The row's map of efforts to wire values. */
  wire?: Partial<Record<ReasoningEffort, WireEffort>>;
  /**
   * Tokens the provider counts for each token estimated at 4 characters. Measured in evaluation runs: Anthropic counts
   * about 1.3; Gemini, OpenAI and Ollama 1.06 or less. Unset means 1.
   */
  countFactor?: number;
}

/** Facts learnt about a model at its server: from its API, or from a probe or a run. */
export interface LearntFacts {
  contextWindow?: number;
  maxOutput?: number;
  vision?: boolean;
  /** Whether the model takes an effort at all. */
  reasons?: boolean;
  /** Whether None is accepted; absent when this source does not say. */
  acceptsNone?: boolean;
  /** When this record was last written. */
  at: string;
}

export interface ProfileInput {
  kind: ProviderKind;
  modelName: string;
  /** The provider's base URL: the OpenAI-compatible card is a cloud endpoint only at a public host. */
  baseUrl?: string;
  overrides?: { contextWindow?: number; maxOutput?: number; vision?: boolean };
  /** The window a local server reports it loaded. */
  detectedContext?: number;
  /** What the model's API said at the last test. */
  fromApi?: LearntFacts;
  /** What a probe or a run's fallback found; taken over `fromApi`. */
  tested?: LearntFacts;
}

/**
 * The capability made from two facts: "reasons: no" is `none`; "reasons" with None accepted is `optional`; "reasons"
 * with None refused or unknown is `always`; nothing about "reasons" is unknown.
 */
export function capabilityFrom(
  reasons: boolean | undefined,
  acceptsNone: boolean | undefined,
): ReasoningSupport | undefined {
  if (reasons === undefined) return undefined;
  if (!reasons) return 'none';
  return acceptsNone ? 'optional' : 'always';
}

/** Each reasoning fact from the first source that states it, and whether vision was stated. */
function reasoningFacts(input: ProfileInput) {
  const cloud = isCloudEndpoint(input.kind, input.baseUrl);
  const row = findRow(input.kind, input.modelName, undefined, cloud);
  const { tested, fromApi, overrides } = input;
  // A row states both facts; a family row only that the model reasons.
  const rowReasons = row?.reasoning === undefined ? undefined : row.reasoning !== 'none';
  const rowNone =
    row && !row.family && row.reasoning !== 'none' && row.reasoning !== undefined
      ? row.reasoning === 'optional'
      : undefined;
  return {
    cloud,
    row,
    reasons: tested?.reasons ?? fromApi?.reasons ?? rowReasons,
    acceptsNone: tested?.acceptsNone ?? fromApi?.acceptsNone ?? rowNone,
    visionStated:
      overrides?.vision !== undefined ||
      tested?.vision !== undefined ||
      fromApi?.vision !== undefined ||
      (!!row && !row.family),
  };
}

export function resolveProfile(input: ProfileInput): ModelProfile {
  const { cloud, row, reasons, acceptsNone } = reasoningFacts(input);
  const base = row ?? (cloud ? defaults.cloud : defaults.local);
  const { tested, fromApi, overrides } = input;
  const profile: ModelProfile = {
    contextWindow: overrides?.contextWindow || tested?.contextWindow || fromApi?.contextWindow || base.contextWindow,
    maxOutput: overrides?.maxOutput || tested?.maxOutput || fromApi?.maxOutput || base.maxOutput,
    vision: overrides?.vision ?? tested?.vision ?? fromApi?.vision ?? base.vision,
  };
  const reasoning = capabilityFrom(reasons, acceptsNone);
  if (reasoning) profile.reasoning = reasoning;
  if (row?.wire) profile.wire = row.wire;
  // Detection only ever lowers the window.
  if (input.detectedContext && input.detectedContext > 0) {
    profile.contextWindow = Math.min(profile.contextWindow, input.detectedContext);
  }
  profile.maxOutput = Math.min(profile.maxOutput, profile.contextWindow);
  const factor = defaults.countFactor[input.kind];
  if (factor) profile.countFactor = factor;
  return profile;
}

/**
 * What Test models's probes still need to find out: whether None is accepted, for a model that reasons or may, with
 * None's value through the row's map; and whether the model sees images, when that is a guess.
 */
export function probeAsk(input: ProfileInput): {
  reasons?: boolean;
  none: boolean;
  noneWire?: WireEffort;
  image: boolean;
} {
  const { row, reasons, acceptsNone, visionStated } = reasoningFacts(input);
  return {
    ...(reasons !== undefined ? { reasons } : {}),
    none: reasons !== false && acceptsNone === undefined,
    ...(row?.wire?.none ? { noneWire: row.wire.none } : {}),
    image: !visionStated,
  };
}

/** The output limit sent with each request: the profile's, capped so a reply cannot take most of a small window. */
export function requestOutputLimit(profile: ModelProfile): number {
  return Math.max(1024, Math.min(profile.maxOutput, 16_384, Math.floor(profile.contextWindow / 4)));
}

/** What the SDK's `reasoning` option gets for an effort on this model, or undefined for nothing. */
export function wireEffort(profile: ModelProfile, effort: ReasoningEffort): WireEffort | undefined {
  return sendRule(profile.reasoning, effort, profile.wire);
}

/**
 * A live conversation's model and effort, made when none exists: the default model, with the setting's effort for a
 * model known to reason, or None for one that does not or whose capability is unknown.
 */
export function makePair<M>(
  model: M,
  setting: ReasoningEffort,
  capability: ReasoningSupport | undefined,
): { model: M; reasoning: ReasoningEffort } {
  return { model, reasoning: capability === 'optional' || capability === 'always' ? setting : 'none' };
}
