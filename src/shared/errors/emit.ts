import type { ErrorCode } from './codes';

export const PHW_ERROR_PREFIX = 'phw-error:';

export interface WizardErrorLine {
  code: ErrorCode;
  message: string;
  detail?: Record<string, unknown>;
}

export function formatWizardErrorLine(line: WizardErrorLine): string {
  return `${PHW_ERROR_PREFIX} ${JSON.stringify(line)}`;
}

export function emitWizardError(line: WizardErrorLine): void {
  process.stderr.write(`${formatWizardErrorLine(line)}\n`);
}
