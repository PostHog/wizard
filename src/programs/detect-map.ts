import { ErrorCodes, type ErrorCode } from '@shared/errors';
import { PROGRAM_REGISTRY } from './program-registry.js';

/**
 * Every `kind` a program detect step can write into
 * `frameworkContext.detectError`, with its error code. Each program declares
 * its own table as `detectErrorCodes`, typed against its own `DetectError`
 * union, so a new kind fails to compile in that program until it gets a code.
 */
const DETECT_CODES = new Map<string, ErrorCode>(
  PROGRAM_REGISTRY.flatMap((config) =>
    Object.entries(config.detectErrorCodes ?? {}),
  ),
);

/**
 * `kind` arrives as a bare string — `frameworkContext.detectError` is untyped
 * storage — so the lookup can still miss. It falls back to a detect-group code
 * with `retry: 'no'`, never to `InternalUnhandled`: an unrecognized precondition
 * failure is still a precondition failure, and telling a sandbox to retry one
 * costs it the whole budget.
 */
export function detectErrorCode(kind: string): ErrorCode {
  return DETECT_CODES.get(kind) ?? ErrorCodes.DetectUnclassified;
}
