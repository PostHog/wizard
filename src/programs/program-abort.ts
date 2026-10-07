import type { ErrorCode } from '@shared/errors';
import type { OutroData } from '@shared/outro';

/**
 * A decided stop, such as an unsupported platform. A program throws it rather
 * than exiting: `runProgram` settles it as an aborted outcome from detection
 * and a failed one from a run definition, and the CLI turns that into its exit.
 * `outroData` is the structured outro for hosts that render one; `message` is
 * the plain text for every other host.
 */
export class ProgramAbort extends Error {
  readonly code: ErrorCode;
  readonly outroData?: OutroData;

  constructor(failure: {
    code: ErrorCode;
    message: string;
    outroData?: OutroData;
  }) {
    super(failure.message);
    this.name = 'ProgramAbort';
    this.code = failure.code;
    this.outroData = failure.outroData;
  }
}
