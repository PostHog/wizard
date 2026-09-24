import type { AbortCase } from '@agent/types';
import { ErrorCodes } from '@shared/errors';

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
    errorCode: ErrorCodes.AuthMissingScope,
    message: 'Insufficient permissions',
    body:
      'The doctor could not query your project — the authenticated token is ' +
      'missing query access. Re-run the wizard to sign in again, or use a key ' +
      'with read access to your events.',
    docsUrl: 'https://posthog.com/docs/web-analytics',
  },
  {
    match: /^posthog sdk not installed$/i,
    errorCode: ErrorCodes.DetectNoPosthogSdk,
    message: 'PostHog SDK not installed',
    body:
      'The doctor could not find a PostHog SDK in this project. Install and ' +
      'configure PostHog first (run `npx @posthog/wizard`), then run the ' +
      'doctor to check your web analytics setup.',
    docsUrl: 'https://posthog.com/docs/libraries/js',
  },
];
