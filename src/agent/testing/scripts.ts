// Scripted-model helpers for the agent's tests: the summary call of compaction has no tools, so a script tells it apart
// from the agent's turns and numbers only the agent's turns.
import type { ScriptedCall, ScriptedReply } from '@src/llm';

export const SCRIPTED_SUMMARY =
  '## Progress\nRead the pages.\n## Data gathered\nNone.\n## Key decisions\nNone.\n## Next steps\nContinue.';

export function isSummaryCall(call: ScriptedCall): boolean {
  return call.tools.length === 0;
}

/** Answers summary calls with `summary` and passes the agent's turns to `script`, counted from 0. */
export function withSummaries(
  script: (call: ScriptedCall, turn: number) => ScriptedReply,
  summary: string | ((call: ScriptedCall) => ScriptedReply) = SCRIPTED_SUMMARY,
): (call: ScriptedCall) => ScriptedReply {
  let turn = 0;
  return call => {
    if (isSummaryCall(call)) return typeof summary === 'string' ? { text: summary } : summary(call);
    return script(call, turn++);
  };
}
