// `handle_dialog`: accept or dismiss the JavaScript dialog open on the tab. When the dialog came from a press (of a
// mouse button or a key), the held-back release goes out once it closes, and the result says when that release was
// withheld from the page.
import { LayerError } from '../../protocol/errors';
import type { HandleDialogArgs } from '../../protocol/schemas';
import type { ToolContext, ToolOutcome } from '../controller';
import { withPageState } from './navigate';
import { dialogDetail } from '../text';
import { siteOf } from '../site';
import { confirmGate, assertGatePermission } from '../interaction/gate';
import type { GateResult } from '../interaction/gate';
import { rememberSecret } from '../redact';
import { checkCancelled } from '../controller';
import type { UserStepDetails } from '../../protocol/results';

export async function handleDialog(ctx: ToolContext, args: HandleDialogArgs): Promise<ToolOutcome> {
  const tab = ctx.tab();
  const dialog = tab.dialog;
  // An intercepted file chooser is dismissed here, or answered with `upload`.
  if (!dialog && tab.fileChooser) {
    if (args.accept) {
      throw new LayerError(
        'INVALID_ARGUMENT',
        'A file chooser is open: answer it with upload, or dismiss it with accept false.',
      );
    }
    tab.fileChooser = null;
    tab.pending = tab.pending.filter(m => m.kind !== 'file-chooser');
    return { lines: ['handle_dialog · the file chooser was dismissed; no file was chosen'] };
  }
  if (!dialog) throw new LayerError('INVALID_ARGUMENT', 'No JavaScript dialog is open on this tab');
  // The user answers every page prompt: its message is free text, and what the agent would type goes straight to the
  // page. Dismissing it, and alerts and confirms, stay with the agent.
  let gate: GateResult | undefined;
  const protectedPrompt = ctx.session.handover && args.accept && dialog.type === 'prompt';
  if (protectedPrompt && !ctx.session.allowSensitiveActions()) {
    const tabUrl = (await ctx.controller.host.tabs.get(tab.tabId))?.url ?? '';
    throw new LayerError(
      'USER_STEP',
      `The page asks for an answer in a prompt dialog (${dialogDetail(dialog)}). Answering it is the user's step: nothing was sent.${dialog.hasBrowserHandler ? '' : ' Chrome cannot show this dialog to the user.'}`,
      {
        details: {
          reason: 'prompt',
          target: dialogDetail(dialog),
          site: siteOf(tabUrl),
          hasBrowserHandler: dialog.hasBrowserHandler,
        } satisfies UserStepDetails,
      },
    );
  }
  if (protectedPrompt) {
    if (args.promptText) rememberSecret(tab.secrets, args.promptText);
    const frame = (await (await ctx.attach()).topology.frames()).find(f => f.sessionId === dialog.sessionId);
    if (!frame) throw new LayerError('FRAME_DETACHED', 'The frame holding the prompt is gone.');
    gate = await confirmGate(ctx, {
      action: 'answer prompt',
      mode: 'none',
      frame,
      objectId: '',
      name: '',
      role: 'dialog',
      description: dialogDetail(dialog),
      category: 'prompt',
      reason: 'answering a page prompt',
    });
  }
  const attachment = await ctx.attach();
  if (gate) await assertGatePermission(ctx, gate);
  checkCancelled(ctx);
  if (tab.dialog !== dialog)
    throw new LayerError('TARGET_CHANGED', 'The page dialog changed while the user decided. Nothing was sent.');
  const closed = new Promise<void>(resolve => {
    const off = attachment.cdp.on('Page.javascriptDialogClosed', () => {
      off();
      resolve();
    });
    setTimeout(resolve, 2_000);
  });
  tab.actionSeq++;
  await attachment.cdp.send(dialog.sessionId, 'Page.handleJavaScriptDialog', {
    accept: args.accept,
    ...(args.promptText !== undefined ? { promptText: args.promptText } : {}),
  });
  await closed;
  // The release the dialog held back, if any: the page state is read after it.
  const released = tab.released;
  tab.released = null;
  const withheld = await Promise.race([released, new Promise<undefined>(resolve => setTimeout(resolve, 2_000))]);
  // Let the page run what the dialog was blocking before the page state is read.
  await new Promise(resolve => setTimeout(resolve, 100));
  return withPageState(ctx, args.observe, {
    data: { type: dialog.type, message: dialog.message, accepted: args.accept },
    lines: [`handle_dialog · ${args.accept ? 'accepted' : 'dismissed'} ${dialogDetail(dialog)}`],
    notices: withheld ? [withheld] : [],
  });
}
