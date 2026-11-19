import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../controller';
import { assertGatePermission, confirmGate } from '../interaction/gate';
import type { GateInput } from '../interaction/gate';
import type { WriteDecision } from '../ports';

function setup(category: 'pay' | 'grant' | 'secret' | 'prompt', enabled = true) {
  const current = { enabled, decision: 'run' as WriteDecision['decision'], url: 'https://shop.example/cart' };
  const confirm = vi.fn(async () => 'approve');
  const decideWrite = vi.fn(async () => ({ decision: current.decision, canRemember: true, by: 'auto' }));
  const tab = { tabId: 1, secrets: new Set<string>(), pending: [] };
  const ctx = {
    session: {
      id: 'test',
      handover: true,
      allowSensitiveActions: () => current.enabled,
      confirmPolicy: 'sensitive',
      decideWrite,
      config: { confirmTimeoutMs: Infinity },
      checkTabSite: vi.fn(async () => {}),
    },
    tab: () => tab,
    controller: { host: { tabs: { get: async () => ({ url: current.url }) }, prompt: { confirm } }, audit: vi.fn() },
  } as unknown as ToolContext;
  const input = {
    action: 'test',
    mode: 'none',
    frame: { url: current.url },
    objectId: '',
    name: 'target',
    role: 'button',
    description: 'target',
    category,
  } as GateInput;
  return { ctx, input, current, confirm, decideWrite };
}

describe('opted-in protected actions', () => {
  for (const category of ['pay', 'grant', 'secret', 'prompt'] as const) {
    it(`${category}: off hands over before the write policy`, async () => {
      const { ctx, input, decideWrite } = setup(category, false);
      await expect(confirmGate(ctx, input)).rejects.toMatchObject({ code: 'USER_STEP', delivered: false });
      expect(decideWrite).not.toHaveBeenCalled();
    });
    it(`${category}: Auto runs and Ask confirms`, async () => {
      const { ctx, input, current, confirm } = setup(category);
      expect(await confirmGate(ctx, input)).toMatchObject({ category, allowedBy: 'auto', prompted: false });
      expect(confirm).not.toHaveBeenCalled();
      current.decision = 'ask';
      expect(await confirmGate(ctx, input)).toMatchObject({ category, allowedBy: 'user', prompted: true });
      expect(confirm).toHaveBeenCalledOnce();
    });
  }
  it('revoking opt-in while approval is pending invalidates the approval', async () => {
    const { ctx, input, current, confirm } = setup('pay');
    current.decision = 'ask';
    confirm.mockImplementation(async () => {
      current.enabled = false;
      return 'approve';
    });
    await expect(confirmGate(ctx, input)).rejects.toMatchObject({ code: 'USER_STEP' });
  });
  it('rechecks opt-in and changed write policy before dispatch', async () => {
    const { ctx, input, current } = setup('pay');
    const gate = await confirmGate(ctx, input);
    current.decision = 'ask';
    await expect(assertGatePermission(ctx, gate)).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
    current.enabled = false;
    await expect(assertGatePermission(ctx, gate)).rejects.toMatchObject({ code: 'USER_STEP' });
  });
  it('does not transfer approval to a different site', async () => {
    const { ctx, input, current } = setup('prompt');
    const gate = await confirmGate(ctx, input);
    current.url = 'https://other.example/';
    await expect(assertGatePermission(ctx, gate)).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
  });
});
