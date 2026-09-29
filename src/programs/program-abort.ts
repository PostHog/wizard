import type { ErrorCode } from '@shared/errors';

/**
 * A decided stop, such as an unsupported platform. A program throws it rather
 * than exiting: `runProgram` turns it into a failed outcome, and the CLI turns
 * that into its exit.
 */
export class ProgramAbort extends Error {
  readonly code: ErrorCode;

  constructor(failure: { code: ErrorCode; message: string }) {
    super(failure.message);
    this.name = 'ProgramAbort';
    this.code = failure.code;
  }
}
