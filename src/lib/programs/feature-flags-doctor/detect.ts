import { existsSync, statSync } from 'fs';
import type { WizardSession } from '@lib/wizard-session';
import type { AbortCase } from '@lib/agent/agent-runner';
import { findPackageJsons } from '@lib/programs/shared/package-scanning';

export type FeatureFlagsDetectError =
  | {
      kind: 'bad-directory';
      path: string;
      reason: 'missing' | 'not-dir' | 'unreadable';
    }
  | { kind: 'no-package-json' }
  | { kind: 'no-posthog'; scannedCount: number };

export const FEATURE_FLAGS_ABORT_CASES: AbortCase[] = [
  {
    match: /^no feature flag usage$/i,
    message: 'No feature flag usage',
    body:
      'The doctor found no feature flag call sites in this project, so there ' +
      'is nothing to check yet. Add a flag with `isFeatureEnabled` or ' +
      '`getFeatureFlag`, then run the doctor again.',
    docsUrl: 'https://posthog.com/docs/feature-flags/installation',
  },
  {
    match: /^insufficient permissions$/i,
    message: 'Insufficient permissions',
    body:
      'The doctor could not read your feature flags — the authenticated ' +
      'token is missing flag access. Re-run the wizard to sign in again, or ' +
      'use a key with read access to feature flags.',
    docsUrl: 'https://posthog.com/docs/feature-flags',
  },
  {
    match: /^posthog sdk not installed$/i,
    message: 'PostHog SDK not installed',
    body:
      'The doctor could not find a PostHog SDK in this project. Install and ' +
      'configure PostHog first (run `npx @posthog/wizard`), then run the ' +
      'doctor to check your feature flags.',
    docsUrl: 'https://posthog.com/docs/libraries/js',
  },
];

export function detectFeatureFlagsPrerequisites(
  session: WizardSession,
  setFrameworkContext: (key: string, value: unknown) => void,
): void {
  const fail = (error: FeatureFlagsDetectError) =>
    setFrameworkContext('detectError', error);

  const installDir = session.installDir;

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

  const matches = findPackageJsons(installDir);

  if (matches.length === 0) {
    fail({ kind: 'no-package-json' });
    return;
  }

  const sdks = [...new Set(matches.flatMap((m) => m.posthogSdks))];

  if (sdks.length === 0) {
    fail({ kind: 'no-posthog', scannedCount: matches.length });
    return;
  }

  setFrameworkContext('detectedPosthogSdks', sdks);
}
