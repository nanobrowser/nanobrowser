/**
 * Types and limits for WebMCP (Web Model Context API) support.
 *
 * A page declares tools through `navigator.modelContext`; the bridge script injected into the
 * page's MAIN world mirrors those declarations so the background can list and invoke them.
 *
 * Spec: https://github.com/webmachinelearning/webmcp
 */

/** Global the bridge script exposes in the page's MAIN world. */
export const WEBMCP_BRIDGE_GLOBAL = '__nanobrowserWebMCP__';

/** Bridge script file, copied verbatim from `public/` into the extension root. */
export const WEBMCP_BRIDGE_SCRIPT = 'webmcpBridge.js';

/** Id used when (un)registering the bridge as a dynamic content script. */
export const WEBMCP_CONTENT_SCRIPT_ID = 'nanobrowser-webmcp-bridge';

/** How long a single page tool call may run before it is abandoned. */
export const WEBMCP_CALL_TIMEOUT_MS = 30_000;

/** Upper bound on how many page tools are surfaced to the model in one step. */
export const WEBMCP_MAX_TOOLS = 30;

/** Page-controlled strings are truncated before they reach the prompt. */
export const WEBMCP_MAX_NAME_LENGTH = 64;
export const WEBMCP_MAX_DESCRIPTION_LENGTH = 400;
export const WEBMCP_MAX_SCHEMA_LENGTH = 600;
export const WEBMCP_MAX_RESULT_LENGTH = 4000;

/** Tool names are restricted so a page cannot smuggle prompt syntax through the name. */
export const WEBMCP_NAME_PATTERN = /^[A-Za-z0-9_.:-]+$/;

/**
 * A tool declared by the current page, normalized and truncated for prompt use.
 */
export interface WebMCPTool {
  name: string;
  description: string;
  /** JSON schema of the tool arguments, serialized. Empty when the page declared none. */
  inputSchema: string;
}

/**
 * Outcome of invoking a page tool. The bridge never throws across the boundary; failures come
 * back as `{ ok: false }` so the agent can report them as a normal action error.
 */
export type WebMCPCallOutcome = { ok: true; result: unknown } | { ok: false; error: string };
