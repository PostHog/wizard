import type { ErrorCode } from './codes';

export const PHW_ERROR_PREFIX = 'phw-error:';

export interface PhwErrorLine {
  code: ErrorCode;
  message: string;
  detail?: Record<string, unknown>;
}

export function formatPhwErrorLine(line: PhwErrorLine): string {
  return `${PHW_ERROR_PREFIX} ${JSON.stringify(line)}`;
}

export function emitPhwError(line: PhwErrorLine): void {
  process.stderr.write(`${formatPhwErrorLine(line)}\n`);
}
