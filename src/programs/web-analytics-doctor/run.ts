import type { AbortCase } from '@agent/types';
import { ErrorCodes } from '@shared/errors';
import type { SkillProgramOptions } from '@programs/agent-skill/run-definition';

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

const REPORT_FILE = 'posthog-web-analytics-report.md';
const DOCS_URL = 'https://posthog.com/docs/web-analytics';

export const WEB_ANALYTICS_DOCTOR_OPTIONS: SkillProgramOptions = {
  skillId: 'web-analytics-doctor',
  command: 'web-analytics',
  id: 'web-analytics-doctor',
  description: 'Audit and fix your PostHog web analytics setup',
  integrationLabel: 'web-analytics-doctor',
  customPrompt:
    "Run the web-analytics-doctor skill to check this project's PostHog web " +
    'analytics setup. Audit read-only first, then present the findings to the ' +
    'user with a single wizard_ask multi-select and apply only the fixes they ' +
    'choose — editing project code and/or PostHog project settings via the ' +
    'MCP — before writing the report.',
  successMessage:
    'Web analytics check complete! You can view the report at ./posthog-web-analytics-report.md',
  reportFile: REPORT_FILE,
  docsUrl: DOCS_URL,
  spinnerMessage: 'Checking your web analytics setup...',
  estimatedDurationMinutes: 5,
  requires: ['posthog-integration'],
  abortCases: WEB_ANALYTICS_ABORT_CASES,
};
