import { ErrorCodes, type ErrorCode } from './codes';

const DETECT_CODES: Record<string, ErrorCode> = {
  'bad-directory': ErrorCodes.DetectBadDirectory,
  'unsupported-platform': ErrorCodes.DetectUnsupportedPlatform,
  'no-posthog-sdk': ErrorCodes.DetectNoPosthogSdk,
  'no-project-files': ErrorCodes.DetectNoProjectFiles,
  'no-sources': ErrorCodes.DetectNoSources,
};

export function detectErrorCode(kind: string): ErrorCode {
  return DETECT_CODES[kind] ?? ErrorCodes.InternalUnhandled;
}
