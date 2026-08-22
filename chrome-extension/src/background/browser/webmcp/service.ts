/**
 * Pure helpers for turning page-declared WebMCP tools into prompt text and back.
 *
 * Everything here operates on values that originate from the page, so every function is
 * defensive: unknown shapes are dropped rather than trusted, and every string that can reach
 * the model is length-capped.
 */

import {
  WEBMCP_MAX_DESCRIPTION_LENGTH,
  WEBMCP_MAX_NAME_LENGTH,
  WEBMCP_MAX_RESULT_LENGTH,
  WEBMCP_MAX_SCHEMA_LENGTH,
  WEBMCP_MAX_TOOLS,
  WEBMCP_NAME_PATTERN,
  type WebMCPCallOutcome,
  type WebMCPTool,
} from './types';

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}... [truncated]`;
}

/** Collapse whitespace so a page cannot use newlines to fake prompt structure. */
function flatten(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stringifySchema(schema: unknown): string {
  if (schema === null || schema === undefined) return '';
  if (typeof schema === 'string') return truncate(flatten(schema), WEBMCP_MAX_SCHEMA_LENGTH);
  try {
    return truncate(JSON.stringify(schema), WEBMCP_MAX_SCHEMA_LENGTH);
  } catch {
    return '';
  }
}

/**
 * Normalize the raw descriptor list read from the page bridge.
 *
 * Drops anything without a usable name, rejects names that do not match
 * {@link WEBMCP_NAME_PATTERN}, de-duplicates, and caps the list at {@link WEBMCP_MAX_TOOLS}.
 */
export function normalizeTools(raw: unknown): WebMCPTool[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const tools: WebMCPTool[] = [];

  for (const entry of raw) {
    if (tools.length >= WEBMCP_MAX_TOOLS) break;
    if (!entry || typeof entry !== 'object') continue;

    const candidate = entry as Record<string, unknown>;
    const rawName = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    if (!rawName || rawName.length > WEBMCP_MAX_NAME_LENGTH) continue;
    if (!WEBMCP_NAME_PATTERN.test(rawName)) continue;
    if (seen.has(rawName)) continue;
    seen.add(rawName);

    const description = typeof candidate.description === 'string' ? candidate.description : '';

    tools.push({
      name: rawName,
      description: truncate(flatten(description), WEBMCP_MAX_DESCRIPTION_LENGTH),
      inputSchema: stringifySchema(candidate.inputSchema),
    });
  }

  return tools;
}

/**
 * Render the tool list for the browser state message.
 * Returns an empty string when the page declares no tools, so callers can skip the section.
 */
export function formatToolsForPrompt(tools: WebMCPTool[]): string {
  if (tools.length === 0) return '';

  return tools
    .map(tool => {
      const description = tool.description || 'no description provided';
      const schema = tool.inputSchema ? ` args_schema: ${tool.inputSchema}` : ' args_schema: {}';
      return `- ${tool.name}: ${description}${schema}`;
    })
    .join('\n');
}

/** Extract the text of an MCP-style `{ content: [{ type: 'text', text }] }` payload. */
function extractMcpContent(result: Record<string, unknown>): string | null {
  if (!Array.isArray(result.content)) return null;

  const parts: string[] = [];
  for (const item of result.content) {
    if (!item || typeof item !== 'object') continue;
    const part = item as Record<string, unknown>;
    if (typeof part.text === 'string') {
      parts.push(part.text);
    } else if (typeof part.type === 'string') {
      parts.push(`[${part.type} content]`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Turn a tool result into the text handed back to the model.
 * @returns `isError` is true when the tool reported a failure, either by rejecting or by
 * setting the MCP `isError` flag.
 */
export function formatToolResult(outcome: WebMCPCallOutcome): { text: string; isError: boolean } {
  if (!outcome.ok) {
    return { text: truncate(outcome.error, WEBMCP_MAX_RESULT_LENGTH), isError: true };
  }

  const { result } = outcome;

  if (result === null || result === undefined) {
    return { text: 'Tool returned no content', isError: false };
  }

  if (typeof result === 'string') {
    return { text: truncate(result, WEBMCP_MAX_RESULT_LENGTH) || 'Tool returned no content', isError: false };
  }

  if (typeof result === 'object') {
    const record = result as Record<string, unknown>;
    const isError = record.isError === true;
    const content = extractMcpContent(record);
    if (content !== null) {
      return { text: truncate(content, WEBMCP_MAX_RESULT_LENGTH), isError };
    }
    try {
      return { text: truncate(JSON.stringify(result), WEBMCP_MAX_RESULT_LENGTH), isError };
    } catch {
      return { text: 'Tool returned a value that could not be serialized', isError: true };
    }
  }

  return { text: truncate(String(result), WEBMCP_MAX_RESULT_LENGTH), isError: false };
}

/**
 * Parse the JSON object string the model supplies as tool arguments.
 *
 * Arguments travel as a string rather than a free-form object because several providers
 * reject open-ended object schemas in structured output.
 */
export function parseToolArguments(rawArgs: string | undefined | null): { ok: true; args: string } | { ok: false } {
  if (rawArgs === undefined || rawArgs === null || rawArgs.trim() === '') {
    return { ok: true, args: '{}' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch {
    return { ok: false };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false };
  }

  return { ok: true, args: JSON.stringify(parsed) };
}
