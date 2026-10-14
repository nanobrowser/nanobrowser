// The agent's tools: the layer's catalogue as it is, plus the agent's own. One list for every model; `screenshot` is
// offered to vision models only, and page script, devtools and uploads from a path are not in the list at all.
import { argsJsonSchema, isReadOnly, TOOL_SPECS } from '@src/browser-control';
import type { ToolDefinition } from '@src/llm';
import { READ_ATTACHMENT_TOOL } from './attachments';
import { SAVE_FILE_TOOL } from './save-file';

export type ToolKind = 'read' | 'wait' | 'mutate' | 'control' | 'state';

export interface AgentTool extends ToolDefinition {
  name: string;
  /** Where it comes from: the layer runs it, or the agent itself. */
  source: 'layer' | 'agent';
  /** The group the tool belongs to. */
  group: 'reading' | 'acting' | 'files' | 'working';
  /** `snapshot` and `done`: a run always has them, even with `disabled`. */
  required?: boolean;
}

/** Tools of the layer the agent never gets: page script, devtools, coordinates and selectors. */
const NOT_OFFERED = new Set(['eval', 'devtools']);

const GROUPS: Record<string, AgentTool['group']> = {
  snapshot: 'reading',
  find: 'reading',
  read: 'reading',
  screenshot: 'reading',
  wait: 'reading',
  click: 'acting',
  set: 'acting',
  type: 'acting',
  press: 'acting',
  navigate: 'acting',
  handle_dialog: 'acting',
  fill_form: 'acting',
  hover: 'acting',
  scroll: 'acting',
  tabs: 'acting',
  ask_user: 'working',
  upload: 'files',
};

/** Parameters the wrapper sets or the session decides, removed from what the model sees. */
const HIDDEN: Record<string, string[]> = {
  '*': ['observe'],
  ask_user: ['timeoutMs'],
  // The agent names attached files by id; the wrapper turns them into bytes.
  upload: ['paths', 'attachments'],
};

/** What the model gives `upload` in place of paths or bytes: the ids of files the user attached. */
const ATTACHMENT_IDS = {
  type: 'array',
  items: { type: 'string' },
  minItems: 1,
  maxItems: 20,
  description: 'Ids of files the user attached to this conversation, as the note about the attached files lists them',
};

function withAttachmentIds(schema: unknown): unknown {
  const s = schema as { properties?: Record<string, unknown>; required?: string[] };
  return {
    ...s,
    properties: { ...s.properties, attachmentIds: ATTACHMENT_IDS },
    required: [...(s.required ?? []), 'attachmentIds'],
  };
}

function schemaWithout(schema: unknown, hidden: string[]): unknown {
  const s = { ...(schema as Record<string, unknown>) };
  delete s.$schema;
  if (s.properties && typeof s.properties === 'object') {
    const props = { ...(s.properties as Record<string, unknown>) };
    for (const h of hidden) delete props[h];
    s.properties = props;
    if (Array.isArray(s.required)) s.required = (s.required as string[]).filter(r => !hidden.includes(r));
  }
  return s;
}

export const DONE_TOOL: AgentTool = {
  name: 'done',
  source: 'agent',
  group: 'working',
  required: true,
  description:
    'Finish the task and report to the user. outcome "success" only when you have seen the result of every action you took; otherwise "partial" or "failed". The summary is your final answer to the user.',
  parameters: {
    type: 'object',
    properties: {
      outcome: { type: 'string', enum: ['success', 'partial', 'failed'] },
      summary: { type: 'string', description: 'The answer for the user, in Markdown' },
    },
    required: ['outcome', 'summary'],
    additionalProperties: false,
  },
};

/** Every tool the agent can have, before switches and capabilities. */
export function allTools(agentTools: AgentTool[] = []): AgentTool[] {
  const layer = TOOL_SPECS.filter(spec => spec.available && !NOT_OFFERED.has(spec.name) && GROUPS[spec.name]).map(
    spec =>
      ({
        name: spec.name,
        source: 'layer',
        group: GROUPS[spec.name],
        required: spec.name === 'snapshot',
        description: spec.description,
        parameters: ((p: unknown) => (spec.name === 'upload' ? withAttachmentIds(p) : p))(
          schemaWithout(argsJsonSchema(spec), [...HIDDEN['*'], ...(HIDDEN[spec.name] ?? [])]),
        ),
      }) satisfies AgentTool,
  );
  return [...layer, DONE_TOOL, READ_ATTACHMENT_TOOL, SAVE_FILE_TOOL, ...agentTools];
}

/**
 * The tools a run gets: every tool the model can use. The run keeps this list from start to end, so its prompt prefix
 * stays cached; it is checked again at dispatch. `disabled` is for the unit tests and scenario sets, which test that
 * check and keep requests small; the product never passes it.
 */
export function toolsForRun(options: {
  disabled?: readonly string[];
  vision: boolean;
  agentTools?: AgentTool[];
}): AgentTool[] {
  return allTools(options.agentTools).filter(
    t => (t.required || !options.disabled?.includes(t.name)) && (t.name !== 'screenshot' || options.vision),
  );
}

/** The kind of a call, for the execution policy. `tabs select` is ordered as a mutation. */
export function kindOf(tool: string, args: Record<string, unknown>): ToolKind {
  if (tool === 'done' || tool === 'ask_user') return 'control';
  if (tool === 'wait') return 'wait';
  if (tool === 'save_file') return 'state';
  if (tool === 'read_attachment') return 'read';
  if (tool === 'tabs') return args.action === 'list' ? 'read' : 'mutate';
  const spec = TOOL_SPECS.find(s => s.name === tool);
  if (!spec) return 'mutate';
  return isReadOnly(spec, args) ? 'read' : 'mutate';
}

/** Page actions that create verification debt. */
export const PAGE_ACTIONS = new Set([
  'click',
  'set',
  'fill_form',
  'type',
  'press',
  'hover',
  'scroll',
  'navigate',
  'handle_dialog',
  'upload',
]);
