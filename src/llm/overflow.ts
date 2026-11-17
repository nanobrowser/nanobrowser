// Context-overflow detection. The patterns follow pi-ai's `isContextOverflow` (packages/ai/src/utils/overflow.ts),
// written here for the providers and local servers this extension supports.
import { MAX_CONTEXT_WINDOW } from './catalogue';
import { errorText, getApiCallStatusCode } from './errors';

const OVERFLOW_PATTERNS: RegExp[] = [
  /prompt is too long/i, // Anthropic
  /input is too long/i, // Anthropic (bytes), Bedrock
  /exceeds the context window/i, // OpenAI
  /maximum context length is \d+/i, // OpenAI chat completions, OpenRouter, vLLM
  /context[_ ]length[_ ]exceeded/i, // OpenAI error code
  /input token count.*exceeds the maximum/i, // Gemini
  /exceeds the maximum number of tokens/i, // Gemini
  /maximum prompt length is \d+/i, // xAI
  /reduce the length of the messages/i, // Groq, OpenAI
  /exceeds the available context size/i, // llama.cpp
  /greater than the context length/i, // LM Studio
  /context (window|length) (exceeds|exceeded)/i, // generic
  /prompt too long/i, // Ollama
  /exceeded max context length/i, // Ollama
  /too many tokens/i,
  /token limit (exceeded|reached)/i,
  /request too large/i,
  /exceeds the limit of \d+ tokens/i,
  /exceeds? (the )?context limit/i, // a server that counts the output limit in the context
];

/** Whether a provider's error says the request was too large for the model's context. */
export function isContextOverflow(error: unknown): boolean {
  const status = getApiCallStatusCode(error);
  if (status === 413) return true;
  const text = errorText(error);
  return OVERFLOW_PATTERNS.some(pattern => pattern.test(text));
}

/** A silent overflow: the server reported more input than the window holds, and truncated it (pi-ai). */
export function isSilentOverflow(reportedInput: number | undefined, contextWindow: number): boolean {
  return reportedInput !== undefined && contextWindow > 0 && reportedInput > contextWindow;
}

/**
 * The wordings of a refusal for size that state the model's context limit, recorded from the providers: chat completions
 * and the servers that follow it, and xAI. Only these name the context limit, so a rate limit's number is never read.
 */
const STATED_LIMIT: RegExp[] = [/maximum context length is (\d+)/i, /maximum prompt length is (\d+)/i];

/** The context limit a refusal for size states, when it is one of the recorded wordings and a plausible window. */
export function statedContextLimit(text: string): number | undefined {
  for (const pattern of STATED_LIMIT) {
    const n = Number(pattern.exec(text)?.[1]);
    if (Number.isInteger(n) && n >= 1000 && n <= MAX_CONTEXT_WINDOW) return n;
  }
  return undefined;
}
