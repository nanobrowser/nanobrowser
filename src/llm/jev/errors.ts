export type DecisionErrorCode = 'authentication' | 'configuration' | 'timeout' | 'cancelled' | 'network' | 'response';

const messages: Record<DecisionErrorCode, string> = {
  authentication: 'Jev authentication failed. Check your TypeSafe API key.',
  configuration: 'Jev configuration or request was rejected. Check your settings.',
  timeout: 'Jev decision timed out.',
  cancelled: 'Jev decision was cancelled.',
  network: 'Jev is temporarily unavailable. Please retry the task.',
  response: 'Jev returned an invalid decision response.',
};

/** Never attach API response bodies, browser data or original network error messages. */
export class DecisionError extends Error {
  constructor(
    public readonly code: DecisionErrorCode,
    public readonly status?: number,
  ) {
    super(messages[code]);
    this.name = 'DecisionError';
  }
}

export function isDecisionError(error: unknown): error is DecisionError {
  return error instanceof DecisionError;
}
