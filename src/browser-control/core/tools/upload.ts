// `upload`: files into a file input, from local paths through `DOM.setFileInputFiles` or as bytes the probe turns into
// `File` objects and sets through a DataTransfer, with input and change dispatched. Without a target it fills the input
// of the pending file chooser, which the controller intercepts. An upload is a write. The receipt reads back the
// input's file list: CDP attaches a 0-byte file for a bad path, and the read-back says whether the files are there, not
// whether the site accepted them.
import { LayerError } from '../../protocol/errors';
import type { UploadArgs } from '../../protocol/schemas';
import type { ActionReceipt } from '../../protocol/results';
import type { FileInfo, FileInputFacts } from '../../probe';
import type { ToolContext, ToolOutcome } from '../controller';
import type { FrameRecord } from '../ports';
import { resolveTarget } from '../interaction/resolve';
import type { ResolvedTarget } from '../interaction/resolve';
import { withEvidence } from '../interaction/evidence';
import { confirmGate, gateTarget } from '../interaction/gate';
import type { GateResult } from '../interaction/gate';
import { quote } from '../text';
import { sensitivity } from './act';
import { withPageState } from './navigate';

/** Base64 goes to the page in pieces: one CDP message per piece keeps a 25 MB file within message limits. */
const CHUNK = 4 * 1024 * 1024;

interface Input {
  frame: FrameRecord;
  objectId: string;
  /** For the receipt and the card. */
  description: string;
  /** The ref, when the input was named by one. */
  ref?: string;
  resolved?: ResolvedTarget;
}

function sizeOf(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function describeFiles(files: FileInfo[]): string {
  return files.map(f => `${quote(f.name, 120)} (${sizeOf(f.size)})`).join(', ');
}

/** The input of the pending file chooser, resolved in the probe's world. */
async function chooserInput(ctx: ToolContext): Promise<Input> {
  const chooser = ctx.tab().fileChooser;
  if (!chooser) {
    throw new LayerError(
      'INVALID_ARGUMENT',
      'No file chooser is open on this tab. Give the file input as the target, or activate the control that opens the chooser first.',
    );
  }
  const frames = await (await ctx.attach()).topology.frames();
  const frame = frames.find(f => f.frameId === chooser.frameId);
  if (!frame) throw new LayerError('FRAME_DETACHED', 'The frame of the file chooser is gone.');
  const probe = ctx.tab().probe!;
  const objectId = await probe.resolve(frame, chooser.backendNodeId);
  const name = await probe.call<string>(frame, objectId, 'approximateName').catch(() => '');
  return { frame, objectId, description: `the file chooser of ${name ? `file input ${quote(name)}` : 'a file input'}` };
}

export async function upload(ctx: ToolContext, args: UploadArgs): Promise<ToolOutcome> {
  const sources = ctx.session.config.uploadSources;
  if (!!args.paths === !!args.attachments) {
    throw new LayerError('INVALID_ARGUMENT', 'Give the files as paths or as attachments: one of them.');
  }
  if (args.paths && !sources.includes('paths')) {
    throw new LayerError('CAPABILITY_DISABLED', 'This session does not take files from paths.');
  }
  if (args.attachments && !sources.includes('attachments')) {
    throw new LayerError('CAPABILITY_DISABLED', 'This session does not take files as bytes.');
  }
  const tab = ctx.tab();
  // Only a file chooser may be pending: it is what `upload` resolves.
  const blocking = tab.pending.find(m => m.kind !== 'file-chooser');
  if (blocking) throw new LayerError('MODAL_PENDING', `A ${blocking.kind} is open on this tab: ${blocking.detail}`);
  const count = (args.paths ?? args.attachments ?? []).length;

  let input: Input;
  let gate: GateResult;
  if (args.target) {
    let resolved = await resolveTarget(ctx, args.target);
    const check = async (t: ResolvedTarget) => {
      const facts = await tab.probe!.call<FileInputFacts>(t.frame, t.objectId, 'fileInputFacts');
      if (!facts.isFileInput) {
        throw new LayerError(
          'NOT_INTERACTABLE',
          `${t.description} is not a file input. Activate the control that opens the file chooser, then call upload without a target.`,
        );
      }
      if (facts.disabled) throw new LayerError('DISABLED', `${t.description} is disabled.`);
      if (count > 1 && !facts.multiple) {
        throw new LayerError('INVALID_ARGUMENT', `${t.description} takes one file; ${count} were given.`);
      }
      return { target: t };
    };
    const gated = await gateTarget(
      ctx,
      await check(resolved),
      { action: 'upload', mode: 'none', intent: args.intent, category: 'upload' },
      check,
    );
    resolved = gated.state.target;
    gate = gated.gate;
    input = {
      frame: resolved.frame,
      objectId: resolved.objectId,
      description: resolved.description,
      ref: resolved.record.ref,
      resolved,
    };
  } else {
    input = await chooserInput(ctx);
    if (count > 1 && tab.fileChooser?.mode !== 'selectMultiple') {
      throw new LayerError('INVALID_ARGUMENT', `${input.description} takes one file; ${count} were given.`);
    }
    gate = await confirmGate(ctx, {
      action: 'upload',
      mode: 'none',
      frame: input.frame,
      objectId: input.objectId,
      name: input.description,
      role: 'file input',
      description: input.description,
      intent: args.intent,
      category: 'upload',
    });
    // The page may have closed its chooser while the user was asked.
    if (gate.prompted && !tab.fileChooser)
      throw new LayerError('TARGET_CHANGED', 'The file chooser closed before the upload.');
  }

  const probe = tab.probe!;
  try {
    const { evidence } = await withEvidence(ctx, input.resolved ?? null, args.expect, {}, async () => {
      if (args.paths) {
        await (
          await ctx.attach()
        ).cdp.send(input.frame.sessionId, 'DOM.setFileInputFiles', {
          files: args.paths,
          objectId: input.objectId,
        });
      } else {
        const specs = args.attachments!.map((a, i) => ({
          key: `f${tab.actionSeq}-${i}`,
          name: a.name,
          mimeType: a.mimeType,
        }));
        for (const [i, a] of args.attachments!.entries()) {
          for (let at = 0; at < a.base64.length || at === 0; at += CHUNK) {
            await probe.call<number>(
              input.frame,
              input.objectId,
              'fileChunk',
              specs[i].key,
              a.base64.slice(at, at + CHUNK),
            );
          }
        }
        await probe.call<FileInfo[]>(input.frame, input.objectId, 'setFiles', specs);
      }
      tab.actionSeq++;
      return {};
    });
    // The chooser is answered.
    if (!args.target) {
      tab.fileChooser = null;
      tab.pending = tab.pending.filter(m => m.kind !== 'file-chooser');
    }
    // Read back after settle: a change handler may clear or replace the files.
    const held = await probe.call<FileInfo[]>(input.frame, input.objectId, 'fileList').catch(() => null);
    const wanted = args.attachments
      ? args.attachments.map(a => ({ name: a.name, size: Math.floor((a.base64.replace(/=+$/, '').length * 3) / 4) }))
      : null;
    const empty = held?.filter(f => f.size === 0) ?? [];
    const readBack: ActionReceipt['postcondition'] =
      held === null
        ? { status: 'not_checked', detail: 'the file input could not be read back' }
        : held.length !== count ||
            empty.length ||
            (wanted && wanted.some((w, i) => held[i]?.name !== w.name || held[i]?.size !== w.size))
          ? {
              status: 'unmet',
              detail: `the input holds ${held.length ? describeFiles(held) : 'no file'}${empty.length ? ': a file of 0 bytes means it could not be read' : ''}`,
            }
          : { status: 'met', detail: `the input holds ${describeFiles(held)}` };
    const receipt: ActionReceipt = {
      action: 'upload',
      target: input.ref ? `[${input.ref}] ${input.description}` : input.description,
      mechanism: 'file-input',
      dispatched: true,
      effect: evidence.effect,
      ...(evidence.navigation ? { navigation: evidence.navigation } : {}),
      ...(evidence.downloads ? { downloads: evidence.downloads } : {}),
      postcondition: args.expect && evidence.postcondition ? evidence.postcondition : readBack,
      ...sensitivity(gate),
    };
    return withPageState(ctx, args.observe, { receipt });
  } finally {
    await probe.release(input.frame, input.objectId).catch(() => undefined);
  }
}
