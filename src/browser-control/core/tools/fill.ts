// `fill_form`: set several fields in order, one receipt per field, stopping at the first error;
// then optionally activate a submit control. Each field goes through `set`, so its mechanism, read-back and the
// confirmation gate are the same as for a single `set`. An expectation is checked after the last action (the submit
// control's click, or else the last field's `set`) and reported in that action's receipt.
import { hintFor, isLayerError, LayerError } from '../../protocol/errors';
import type { FillFormArgs } from '../../protocol/schemas';
import type { ActionReceipt } from '../../protocol/results';
import type { ToolContext, ToolOutcome } from '../controller';
import { receiptLines } from '../text';
import { click } from './act';
import { withPageState } from './navigate';
import { set } from './text';

export interface FillData {
  receipts: ActionReceipt[];
  /** Index of the field that failed, when one did. */
  failedAt?: number;
  submitted: boolean;
}

export async function fillForm(ctx: ToolContext, args: FillFormArgs): Promise<ToolOutcome> {
  const receipts: ActionReceipt[] = [];
  const lines = () => receipts.flatMap((r, i) => receiptLines(r).map((l, k) => (k ? `   ${l}` : `${i + 1}. ${l}`)));
  for (let i = 0; i < args.fields.length; i++) {
    const field = args.fields[i];
    try {
      const outcome = await set(ctx, {
        target: field.target,
        value: field.value,
        intent: args.intent,
        // The call's expectation is checked after its last action: the submit control, or else the last field.
        expect: !args.submit && i === args.fields.length - 1 ? args.expect : undefined,
        observe: 'none',
        timeoutMs: args.timeoutMs,
      });
      if (outcome.receipt) receipts.push(outcome.receipt);
    } catch (error) {
      const set = receipts.some(r => r.dispatched !== false);
      const delivered = set ? true : isLayerError(error) ? error.delivered : 'unknown';
      const code = isLayerError(error) ? error.code : 'INTERNAL';
      const message = error instanceof Error ? error.message : String(error);
      // The hint is for the whole call. The failed field's own hint may say a retry is safe, which is true
      // of that field alone; once an earlier field was set, repeating the call would set it again.
      const hint = set
        ? `${i === 1 ? 'Field 1 is' : `Fields 1 to ${i} are`} already set, so do not repeat the whole call: take a new snapshot and continue from field ${i + 1}. ${hintFor(code, true)}`
        : isLayerError(error)
          ? error.hint
          : undefined;
      throw new LayerError(
        code,
        `Field ${i + 1} of ${args.fields.length} failed: ${message} Fields 1 to ${i} were set; the fields after it were not touched${args.submit ? ' and the submit control was not activated' : ''}.`,
        {
          delivered,
          hint,
          details: isLayerError(error) ? error.details : undefined,
          partial: { data: { receipts, failedAt: i, submitted: false } satisfies FillData, lines: lines() },
        },
      );
    }
  }
  let submitted = false;
  if (args.submit) {
    const outcome = await click(ctx, {
      target: args.submit,
      intent: args.intent,
      expect: args.expect,
      observe: 'none',
      timeoutMs: args.timeoutMs,
    }).catch((error: unknown) => {
      const code = isLayerError(error) ? error.code : 'INTERNAL';
      throw new LayerError(
        code,
        `Every field was set, but the submit control failed: ${error instanceof Error ? error.message : error}`,
        {
          delivered: true,
          hint: `Every field is already set, so do not repeat the whole call: take a new snapshot and deal with the submit control by itself. ${hintFor(code, true)}`,
          details: isLayerError(error) ? error.details : undefined,
          partial: { data: { receipts, submitted: false } satisfies FillData, lines: lines() },
        },
      );
    });
    if (outcome.receipt) receipts.push(outcome.receipt);
    submitted = true;
  }
  return withPageState(ctx, args.observe, {
    data: { receipts, submitted } satisfies FillData,
    lines: [`fill_form · ${args.fields.length} fields${submitted ? ' · submitted' : ''}`, ...lines()],
  });
}
