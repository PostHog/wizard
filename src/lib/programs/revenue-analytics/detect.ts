/**
 * Revenue analytics prerequisite detection.
 *
 * Scans the project for PostHog + Stripe SDKs and writes results
 * into frameworkContext for the intro screen to render.
 */

import { existsSync, statSync } from 'fs';
import type { WizardSession } from '@lib/wizard-session';
import type { AbortCase } from '@lib/agent/agent-runner';
import { findPackageJsons } from '@lib/programs/shared/package-scanning';

export {
  findPackageJsons,
  POSTHOG_SDKS,
  STRIPE_SDKS,
  type PackageMatch,
} from '@lib/programs/shared/package-scanning';

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

/** `[ABORT] <reason>` cases the revenue analytics skill can emit. */
export const REVENUE_ABORT_CASES: AbortCase[] = [
  {
    // Skill emits: [ABORT] Could not find a PostHog distinct_id
    match: /^could not find a posthog distinct_id$/i,
    message: 'Could not find a PostHog distinct_id',
    body:
      'The agent could not find PostHog distinct_id usage in your codebase. ' +
      'Your users must be identified in PostHog before they can be tagged in Stripe. ' +
      'Please identify your users and try again.',
    docsUrl: 'https://posthog.com/docs/product-analytics/identify',
  },
  {
    // Skill emits: [ABORT] Could not find a Stripe integration
    match: /^could not find a stripe integration$/i,
    message: 'Could not find a Stripe integration',
    body:
      'The Wizard could not find an existing Stripe customer, charge, ' +
      'subscription, or other Stripe operations. Please run the Revenue ' +
      'Analytics Wizard on a project with an existing Stripe integration.',
    docsUrl: 'https://posthog.com/docs/revenue-analytics',
  },
];

/**
 * Scan `session.installDir` for PostHog + Stripe SDKs. Writes detection
 * results into frameworkContext via the callback — either the detected
 * SDK lists (for the intro screen) or a `RevenueDetectError` on failure.
 *
 * The skill install happens later in the bootstrap runner, not here.
 */
export function detectRevenuePrerequisites(
  session: WizardSession,
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
