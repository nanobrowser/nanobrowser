// The decision service evaluates only the text the agent supplies. It never reads or acts on a page.
import { z } from 'zod';
import { DecisionError, decisionRequestSchema, makeDecision } from '@src/llm/decisions';
import type { DecisionProvider } from '@src/llm/decisions';
import type { AgentTool } from './tools';

const parameters = z.toJSONSchema(decisionRequestSchema);
delete parameters.$schema;

export const DECIDE_TOOL: AgentTool = {
  name: 'decide',
  source: 'agent',
  group: 'working',
  description:
    'Evaluate supplied text with the configured decision model: estimate a predicate probability, choose among declared values, or score against ordered levels. Supply only relevant text already read for this task. Results are advisory: they never authorize browser actions or verify their outcomes. If no decision provider is configured, continue with your own reasoning.',
  parameters,
};

/** Runs an advisory evaluation without reading the browser or changing its permission state. */
export async function runDecision(
  args: Record<string, unknown>,
  config: { provider: DecisionProvider | null; apiKey?: string },
  options: { signal?: AbortSignal } = {},
): Promise<{ text: string; isError: boolean }> {
  if (config.provider !== 'jev' && config.provider !== 'openai') {
    return {
      text: 'error DECISION_UNAVAILABLE\nChoose a decision provider in Settings → Providers, or continue with your own reasoning.',
      isError: true,
    };
  }
  if (!config.apiKey?.trim()) {
    return {
      text: 'error DECISION_UNAVAILABLE\nAdd the selected decision provider’s API key in Settings → Providers, or continue with your own reasoning.',
      isError: true,
    };
  }
  const request = decisionRequestSchema.safeParse(args);
  if (!request.success) {
    return {
      text: 'error INVALID_ARGUMENT\nSupply state text and 1–20 uniquely named predicate, choice or score questions using the decide schema.',
      isError: true,
    };
  }
  const cancelled = { text: 'error DECISION_CANCELLED\nThe decision request was cancelled.', isError: true };
  if (options.signal?.aborted) return cancelled;
  try {
    const result = await makeDecision(
      { provider: config.provider, apiKey: config.apiKey.trim() },
      request.data,
      options,
    );
    return {
      text: `decide · advisory evaluation of supplied text only; answers never authorize browser actions or verify their outcomes.\n${JSON.stringify(result)}`,
      isError: false,
    };
  } catch (error) {
    if (options.signal?.aborted) return cancelled;
    if (error instanceof DecisionError) {
      return {
        text: `error DECISION_FAILED [${error.code}${error.status ? ` · HTTP ${error.status}` : ''}]\n${error.message}`,
        isError: true,
      };
    }
    return {
      text: 'error DECISION_FAILED\nThe decision provider could not complete this evaluation. Check its configuration in Settings → Providers, or continue with your own reasoning.',
      isError: true,
    };
  }
}
