import type { ErrorCode } from './codes';

/**
 * Structured error data for analytics and the machine-readable error line.
 *
 * A data carrier: the agent returns it inside a failure and the legacy adapter
 * hands it to `wizardAbort()`, which captures it. Never thrown by the wizard.
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
