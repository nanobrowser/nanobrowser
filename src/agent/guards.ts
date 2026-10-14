// Guards against loops. A nudge is a note on the tool result that caused it; a stop ends the run with one salvage call.
// Counters belong to the run and are not reset by navigation.
import type { Result } from '@src/browser-control';
import type { GuardState } from '@src/store/types';
import { EMPTY_GUARDS } from '@src/store/types';

export const REPEAT_WINDOW = 6;
export const REPEAT_LIMIT = 3;
export const NO_EFFECT_NUDGE = 2;
export const NO_EFFECT_STOP = 3;
export const ERROR_STOP = 5;

export interface GuardVerdict {
  nudge?: string;
  stop?: string;
  /** Which guard stopped the run. */
  guard?: 'errors' | 'no_effect';
}

const NO_EFFECT_TOOLS = new Set(['click', 'set', 'type', 'press', 'fill_form']);

function targetKey(args: Record<string, unknown>): string | null {
  const target = args.target ?? args.submit;
  return target ? JSON.stringify(target) : null;
}

/** The signature of a call: tool, arguments (the agent's purpose left out) and what came of it. */
export function signature(
  tool: string,
  args: Record<string, unknown>,
  result: Result | undefined,
  isError: boolean,
): string {
  const rest = Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'intent'));
  const outcome = result
    ? result.ok
      ? (result.receipt?.effect.verdict ?? 'ok')
      : (result.error?.code ?? 'error')
    : isError
      ? 'error'
      : 'ok';
  return `${tool} ${JSON.stringify(rest)} → ${outcome}`;
}

export class Guards {
  state: GuardState;

  constructor(state: GuardState = EMPTY_GUARDS) {
    this.state = structuredClone(state);
  }

  /** Records one call's outcome and says whether to nudge or stop. */
  record(tool: string, args: Record<string, unknown>, result: Result | undefined, isError: boolean): GuardVerdict {
    const s = this.state;
    const sig = signature(tool, args, result, isError);
    s.recent = [...s.recent, sig].slice(-REPEAT_WINDOW);
    s.errorsInRow = isError ? s.errorsInRow + 1 : 0;
    if (s.errorsInRow >= ERROR_STOP) return { stop: `${ERROR_STOP} calls in a row failed.`, guard: 'errors' };

    const key = NO_EFFECT_TOOLS.has(tool) ? targetKey(args) : null;
    if (
      key &&
      result?.ok &&
      result.receipt?.effect.verdict === 'none' &&
      result.receipt.postcondition?.status !== 'met'
    ) {
      const count = (s.noEffect[key] ?? 0) + 1;
      s.noEffect[key] = count;
      if (count >= NO_EFFECT_STOP)
        return { stop: `${tool} on the same target had no effect ${count} times.`, guard: 'no_effect' };
      if (count >= NO_EFFECT_NUDGE) {
        const signals = result.receipt.effect.signals.join(' · ') || 'no signal';
        return {
          nudge: `${tool} on this target had no effect ${count} times (${signals}). Try another way, or ask the user.`,
        };
      }
    }
    const repeats = s.recent.filter(r => r === sig).length;
    if (repeats >= REPEAT_LIMIT) {
      return {
        nudge: `you made the same call with the same outcome ${repeats} times in your last ${REPEAT_WINDOW} calls. Try something else, or ask the user.`,
      };
    }
    return {};
  }
}
