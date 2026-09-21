import type { ErrorCode } from './codes';

/**
 * A data carrier for a decided failure: message, analytics context and the
 * catalog code. Passed to `wizardAbort()` by the caller that owns the exit;
 * never thrown by the agent.
 */
export class WizardError extends Error {
  readonly code?: ErrorCode;

  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
    code?: ErrorCode,
  ) {
    super(message);
    this.name = 'WizardError';
    this.code = code;
  }
}
