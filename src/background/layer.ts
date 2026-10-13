// The browser control layer in the test extension: one controller, one session for the test panel.
import { argsJsonSchema } from '@src/browser-control';
import { controllerReady, setFallbackPrompt } from '@src/extension/layer';
import type { AuditEntry, Capability, ConfirmPolicy, Controller, Session, UrlPolicy } from '@src/browser-control';
import { emit, register } from './rpc';
import { panelPrompt } from './prompts';

export interface LayerState {
  epoch: { prefix: string; persisted: boolean };
  sessionId: string;
  tabs: number[];
  activeTabId: number | null;
  urlPolicy: UrlPolicy;
  confirmPolicy: ConfirmPolicy;
  capabilities: Capability[];
  promptAvailable: boolean;
}

let controller: Controller;
let session: Session;
const audit: AuditEntry[] = [];

setFallbackPrompt(panelPrompt);

export const ready: Promise<void> = controllerReady.then(c => {
  controller = c;
  session = c.createSession();
  void chrome.storage.local.get('testPanel.urlPolicy').then(stored => {
    const policy = stored['testPanel.urlPolicy'] as UrlPolicy | undefined;
    if (policy) void session.setUrlPolicy(policy);
  });
  void chrome.storage.local.get(['testPanel.confirmPolicy', 'testPanel.capabilities']).then(stored => {
    const confirm = stored['testPanel.confirmPolicy'] as ConfirmPolicy | undefined;
    if (confirm) session.setConfirmPolicy(confirm);
    const capabilities = stored['testPanel.capabilities'] as Capability[] | undefined;
    if (capabilities) session.setCapabilities(capabilities);
  });
  c.onAudit(entry => {
    audit.push(entry);
    if (audit.length > 500) audit.shift();
    emit('audit', entry);
  });
});

export async function layer(): Promise<{ controller: Controller; session: Session }> {
  await ready;
  return { controller, session };
}

export function state(): LayerState {
  return {
    epoch: controller.epoch,
    sessionId: session.id,
    tabs: session.tabIds(),
    activeTabId: session.activeTabId,
    urlPolicy: session.urlPolicy,
    confirmPolicy: session.confirmPolicy,
    capabilities: [...session.capabilities],
    promptAvailable: !!controller.host.prompt,
  };
}

register('layer.call', async params => {
  const { session } = await layer();
  const { tool, args } = params as { tool: string; args?: unknown };
  return session.call(tool, args ?? {});
});

register('layer.tools', async () => {
  const { session } = await layer();
  return session.listTools().map(spec => ({
    name: spec.name,
    description: spec.description,
    capability: spec.capability,
    readOnly: typeof spec.readOnly === 'boolean' ? spec.readOnly : 'depends',
    schema: argsJsonSchema(spec),
  }));
});

register('layer.state', async () => {
  await ready;
  return state();
});

// The user's allow and deny lists (Session tab). Not a protocol tool: the agent cannot change the policy.
register('layer.setPolicy', async params => {
  const { session } = await layer();
  await session.setUrlPolicy(params as UrlPolicy);
  await chrome.storage.local.set({ 'testPanel.urlPolicy': session.urlPolicy });
  return state();
});

// The user's confirmation policy and capabilities (Session tab); the agent cannot change them.
register('layer.setConfirmPolicy', async params => {
  const { session } = await layer();
  session.setConfirmPolicy((params as { policy: ConfirmPolicy }).policy);
  await chrome.storage.local.set({ 'testPanel.confirmPolicy': session.confirmPolicy });
  return state();
});

register('layer.setCapabilities', async params => {
  const { session } = await layer();
  session.setCapabilities((params as { capabilities: Capability[] }).capabilities);
  await chrome.storage.local.set({ 'testPanel.capabilities': [...session.capabilities] });
  return state();
});

register('layer.audit', async () => {
  await ready;
  return audit;
});
