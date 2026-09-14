import { ErrorCodes, isErrorCode, type ErrorCode } from './codes';

export interface RunFailure {
  code: ErrorCode;
  message: string;
  /** True when the error carried its own code: a decision, not a crash. */
  coded: boolean;
}

/**
 * How a run's terminal error is reported. A coded WizardError (a mint refusal,
 * say) keeps its own message and code; anything else is unhandled and gets the
 * generic framing. Duck-typed on `code` so callers need not load wizard-abort.
 */
export function classifyRunFailure(err: unknown): RunFailure {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    err instanceof Error ? (err as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && isErrorCode(code)) {
    return { code, message, coded: true };
  }
  return { code: ErrorCodes.InternalUnhandled, message, coded: false };
}
