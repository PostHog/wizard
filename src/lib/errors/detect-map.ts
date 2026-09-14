import { ErrorCodes, type ErrorCode } from './codes';
import type { RevenueDetectError } from '@lib/programs/revenue-analytics/detect';
import type { SelfDrivingDetectError } from '@lib/programs/self-driving/detect';
import type { SourceMapsDetectError } from '@lib/programs/error-tracking-upload-source-maps/detect';
import type { WarehouseDetectError } from '@lib/programs/warehouse-source/detect';
import type { WebAnalyticsDetectError } from '@lib/programs/web-analytics-doctor/detect';

/**
 * Every `kind` a program detect step can write into
 * `frameworkContext.detectError`, assembled from the programs' own unions.
 * Type-only imports, so this adds no runtime edge from the catalog to the
 * programs (same shape as `skill-map.ts` keying on `InstallSkillResult`).
 *
 * The point is the compile error: add a kind to any program's `DetectError`
 * and `DETECT_CODES` stops type-checking until it gets a code.
 */
export type DetectErrorKind =
  | RevenueDetectError['kind']
  | SelfDrivingDetectError['kind']
  | SourceMapsDetectError['kind']
  | WarehouseDetectError['kind']
  | WebAnalyticsDetectError['kind'];

const DETECT_CODES: Record<DetectErrorKind, ErrorCode> = {
  'bad-directory': ErrorCodes.DetectBadDirectory,
  'unsupported-platform': ErrorCodes.DetectUnsupportedPlatform,
  'no-project-files': ErrorCodes.DetectNoProjectFiles,
  'no-sources': ErrorCodes.DetectNoSources,
  'no-package-json': ErrorCodes.DetectNoPackageJson,
  'no-sdks': ErrorCodes.DetectNoSdks,
  'missing-stripe': ErrorCodes.DetectMissingStripe,
  // Three kinds, one failure class: the program needs a PostHog SDK and the
  // project has none. Hosts that care which program asked read `detail.kind`.
  'no-posthog-sdk': ErrorCodes.DetectNoPosthogSdk,
  'no-posthog': ErrorCodes.DetectNoPosthogSdk,
  'missing-posthog': ErrorCodes.DetectNoPosthogSdk,
};

/**
 * `kind` arrives as a bare string — `frameworkContext.detectError` is untyped
 * storage — so the lookup can still miss. It falls back to a detect-group code
 * with `retry: 'no'`, never to `InternalUnhandled`: an unrecognized precondition
 * failure is still a precondition failure, and telling a sandbox to retry one
 * costs it the whole budget.
 */
export function detectErrorCode(kind: string): ErrorCode {
  return DETECT_CODES[kind as DetectErrorKind] ?? ErrorCodes.DetectUnclassified;
}
