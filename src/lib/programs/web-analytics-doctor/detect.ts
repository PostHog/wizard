import { existsSync, statSync } from 'fs';
import type { WizardSession } from '@lib/wizard-session';
import type { AbortCase } from '@lib/agent/agent-runner';
import { findPackageJsons } from '@lib/programs/revenue-analytics/detect';

export type WebAnalyticsDetectError =
  | {
      kind: 'bad-directory';
      path: string;
      reason: 'missing' | 'not-dir' | 'unreadable';
    }
  | { kind: 'no-package-json' }
  | { kind: 'no-posthog'; scannedCount: number };

export const WEB_ANALYTICS_ABORT_CASES: AbortCase[] = [
  {
    match: /^no web analytics events$/i,
    message: 'No web analytics events',
    body:
      'The doctor found no $pageview events in the last 30 days, so there is ' +
      'nothing to audit yet. Make sure PostHog is initialized and capturing ' +
      'pageviews, then run the doctor again.',
    docsUrl: 'https://posthog.com/docs/web-analytics/getting-started',
  },
  {
    match: /^insufficient permissions$/i,
    message: 'Insufficient permissions',
    body:
      'The doctor could not query your project — the authenticated token is ' +
      'missing query access. Re-run the wizard to sign in again, or use a key ' +
      'with read access to your events.',
    docsUrl: 'https://posthog.com/docs/web-analytics',
  },
  {
    match: /^posthog sdk not installed$/i,
    message: 'PostHog SDK not installed',
    body:
      'The doctor could not find a PostHog SDK in this project. Install and ' +
      'configure PostHog first (run `npx @posthog/wizard`), then run the ' +
      'doctor to check your web analytics setup.',
    docsUrl: 'https://posthog.com/docs/libraries/js',
  },
];

export function detectWebAnalyticsPrerequisites(
  session: WizardSession,
  setFrameworkContext: (key: string, value: unknown) => void,
): void {
  const fail = (error: WebAnalyticsDetectError) =>
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
