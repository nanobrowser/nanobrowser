// The tool catalogue as data: name, description, argument schema, read-only flag, capability.
// A tool is listed only once it is built and its checks exist (plan step 1.6); `available` records that.
import { z } from 'zod';
import {
  AskUserArgsSchema,
  ClickArgsSchema,
  FillFormArgsSchema,
  FindArgsSchema,
  HandleDialogArgsSchema,
  UploadArgsSchema,
  HoverArgsSchema,
  NavigateArgsSchema,
  PressArgsSchema,
  ReadArgsSchema,
  ScreenshotArgsSchema,
  ScrollArgsSchema,
  SetArgsSchema,
  SnapshotArgsSchema,
  TabsArgsSchema,
  TypeArgsSchema,
  WaitArgsSchema,
} from './schemas';

export const CAPABILITIES = ['vision', 'selector', 'files', 'eval', 'devtools', 'human', 'batch'] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface ToolSpec {
  name: string;
  description: string;
  args: z.ZodType;
  /** Read-only tools do not change the page. `tabs` depends on its action. */
  readOnly: boolean | ((args: Record<string, unknown>) => boolean);
  /** 'core' tools are always available; others need the capability enabled for the session. */
  capability: 'core' | Capability;
  /** Built and covered by checks. Tools that are not available are not listed. */
  available: boolean;
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'snapshot',
    description:
      'Observe the page: an outline of its elements with roles, names, states and values. Actionable elements carry a ref such as [e12] that other tools take as a target.',
    args: SnapshotArgsSchema,
    readOnly: true,
    capability: 'core',
    available: true,
  },
  {
    name: 'find',
    description:
      'Find elements by role, name or text in the latest observation, without a model. Returns refs and their lines.',
    args: FindArgsSchema,
    readOnly: true,
    capability: 'core',
    available: true,
  },
  {
    name: 'read',
    description: 'Read the content of the page or of one element as Markdown or plain text.',
    args: ReadArgsSchema,
    readOnly: true,
    capability: 'core',
    available: true,
  },
  {
    name: 'screenshot',
    description: 'Capture the visible page, the full page or one element as PNG, optionally with ref labels.',
    args: ScreenshotArgsSchema,
    readOnly: true,
    capability: 'core',
    available: true,
  },
  {
    name: 'click',
    description:
      'Click an element with trusted input after checking that it is visible, stable, enabled and not covered.',
    args: ClickArgsSchema,
    readOnly: false,
    capability: 'core',
    available: true,
  },
  {
    name: 'set',
    description:
      'Give a control a value: text for fields, true or false for checkboxes, radios and switches, an option for selects. The value is read back.',
    args: SetArgsSchema,
    readOnly: false,
    capability: 'core',
    available: true,
  },
  {
    name: 'fill_form',
    description: 'Set several fields in order, stopping at the first error, then optionally activate a submit control.',
    args: FillFormArgsSchema,
    readOnly: false,
    capability: 'core',
    available: true,
  },
  {
    name: 'type',
    description: 'Type text key by key into the focused element or a target, for widgets that listen to keys.',
    args: TypeArgsSchema,
    readOnly: false,
    capability: 'core',
    available: true,
  },
  {
    name: 'press',
    description: 'Press a key or chord, such as Enter, Escape or Control+A, optionally on a target.',
    args: PressArgsSchema,
    readOnly: false,
    capability: 'core',
    available: true,
  },
  {
    name: 'hover',
    description: 'Move the pointer over an element.',
    args: HoverArgsSchema,
    readOnly: false,
    capability: 'core',
    available: true,
  },
  {
    name: 'scroll',
    description: 'Scroll the page or a container by pages or pixels, to the top or bottom, or to an element.',
    args: ScrollArgsSchema,
    readOnly: false,
    capability: 'core',
    available: true,
  },
  {
    name: 'wait',
    description: 'Wait for text to appear or disappear, an element state, a URL, or a fixed time.',
    args: WaitArgsSchema,
    readOnly: true,
    capability: 'core',
    available: true,
  },
  {
    name: 'navigate',
    description: 'Go to a URL, or back, forward or reload. The navigation policy applies.',
    args: NavigateArgsSchema,
    readOnly: false,
    capability: 'core',
    available: true,
  },
  {
    name: 'tabs',
    description: "List, open, select or close the session's tabs.",
    args: TabsArgsSchema,
    readOnly: args => args.action === 'list' || args.action === 'select',
    capability: 'core',
    available: true,
  },
  {
    name: 'upload',
    description:
      'Put files into a file input, or into the input of the pending file chooser (leave out target). The receipt reads back the files the input holds.',
    args: UploadArgsSchema,
    readOnly: false,
    capability: 'files',
    available: true,
  },
  {
    name: 'handle_dialog',
    description: 'Accept or dismiss the JavaScript dialog open on the tab.',
    args: HandleDialogArgsSchema,
    readOnly: false,
    capability: 'core',
    available: true,
  },
  {
    name: 'ask_user',
    description:
      'Hand a step to the user (a login, a CAPTCHA, a one-time code) and wait until they continue or cancel. "input" asks for a short typed answer.',
    args: AskUserArgsSchema,
    readOnly: false,
    capability: 'human',
    available: true,
  },
];

const byName = new Map(TOOL_SPECS.map(spec => [spec.name, spec]));

export function toolSpec(name: string): ToolSpec | undefined {
  return byName.get(name);
}

/** The catalogue a client sees: available tools whose capability is enabled. */
export function listTools(enabled: ReadonlySet<Capability>): ToolSpec[] {
  return TOOL_SPECS.filter(spec => spec.available && (spec.capability === 'core' || enabled.has(spec.capability)));
}

export function isReadOnly(spec: ToolSpec, args: Record<string, unknown>): boolean {
  return typeof spec.readOnly === 'function' ? spec.readOnly(args) : spec.readOnly;
}

/** JSON Schema of a tool's arguments, for generated forms and tool definitions. */
export function argsJsonSchema(spec: ToolSpec): unknown {
  return z.toJSONSchema(spec.args, { unrepresentable: 'any' });
}
