import type { AreaSlide } from './shared.js';

export const ErrorTrackingSlide: AreaSlide = {
  area: 'Error Tracking',
  intro: [
    "We're checking that exceptions are captured through PostHog's `captureException` and that source maps are uploaded so stack traces are readable.",
    'Without both, errors land in your project as unsymbolicated noise and the issue list becomes hard to triage.',
  ],
  docsUrl: 'https://posthog.com/docs/error-tracking',
};
