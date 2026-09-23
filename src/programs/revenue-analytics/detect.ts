/**
 * Revenue analytics prerequisite detection.
 *
 * Scans the project for PostHog + Stripe SDKs and writes results
 * into frameworkContext for the intro screen to render.
 */

import { existsSync, statSync } from 'fs';
import { findPackageJsons } from '../shared/package-scanning';

export {
  findPackageJsons,
  POSTHOG_SDKS,
  STRIPE_SDKS,
  type PackageMatch,
} from '../shared/package-scanning';

/**
 * Structured detection errors. The screen renders each kind into JSX
 * with proper formatting — keeps error data separate from presentation.
 */
export type RevenueDetectError =
  | {
      kind: 'bad-directory';
      path: string;
      reason: 'missing' | 'not-dir' | 'unreadable';
    }
  | { kind: 'no-package-json' }
  | { kind: 'no-sdks'; scannedCount: number }
  | { kind: 'missing-posthog'; foundStripe: string[] }
  | { kind: 'missing-stripe'; foundPosthog: string[] };

export { REVENUE_ABORT_CASES } from './abort-cases.js';

/**
 * Scan `session.installDir` for PostHog + Stripe SDKs. Writes detection
 * results into frameworkContext via the callback — either the detected
 * SDK lists (for the intro screen) or a `RevenueDetectError` on failure.
 *
 * The skill install happens later in the bootstrap runner, not here.
 */
export function detectRevenuePrerequisites(
  session: { installDir: string },
  setFrameworkContext: (key: string, value: unknown) => void,
): void {
  const fail = (error: RevenueDetectError) =>
    setFrameworkContext('detectError', error);

  const installDir = session.installDir;

  // Verify the install directory exists and is readable
  if (!existsSync(installDir)) {
    fail({ kind: 'bad-directory', path: installDir, reason: 'missing' });
    return;
  }
  try {
    if (!statSync(installDir).isDirectory()) {
      fail({ kind: 'bad-directory', path: installDir, reason: 'not-dir' });
      return;
    }
  } catch {
    fail({ kind: 'bad-directory', path: installDir, reason: 'unreadable' });
    return;
  }

  // Find all package.json files (root + monorepo subpackages)
  const matches = findPackageJsons(installDir);

  if (matches.length === 0) {
    fail({ kind: 'no-package-json' });
    return;
  }

  // Aggregate detected SDKs across all package.json files
  const allPosthogSdks = new Set<string>();
  const allStripeSdks = new Set<string>();
  for (const match of matches) {
    for (const sdk of match.posthogSdks) allPosthogSdks.add(sdk);
    for (const sdk of match.stripeSdks) allStripeSdks.add(sdk);
  }

  const detectedPosthogSdks = [...allPosthogSdks];
  const detectedStripeSdks = [...allStripeSdks];

  if (detectedPosthogSdks.length === 0 && detectedStripeSdks.length === 0) {
    fail({ kind: 'no-sdks', scannedCount: matches.length });
    return;
  }

  if (detectedPosthogSdks.length === 0) {
    fail({ kind: 'missing-posthog', foundStripe: detectedStripeSdks });
    return;
  }

  if (detectedStripeSdks.length === 0) {
    fail({ kind: 'missing-stripe', foundPosthog: detectedPosthogSdks });
    return;
  }

  setFrameworkContext('detectedPosthogSdks', detectedPosthogSdks);
  setFrameworkContext('detectedStripeSdks', detectedStripeSdks);
  setFrameworkContext(
    'detectedPackagePaths',
    matches
      .filter((m) => m.posthogSdks.length > 0 || m.stripeSdks.length > 0)
      .map((m) => m.path),
  );
}
