import type { AbortCase } from '../../agent/agent-runner.js';

/** `[ABORT] <reason>` cases the audit skill can emit. Reason strings are
 *  defined in the skill's `Abort statuses` section. */
export const AUDIT_ABORT_CASES: AbortCase[] = [
  {
    match: /^no posthog sdk found$/i,
    message: 'No PostHog SDK found',
    body:
      'The audit needs an existing PostHog integration to review. No PostHog ' +
      'SDK appears in this project’s dependency manifests. Run the basic ' +
      'integration workflow to install PostHog first, then re-run the audit.',
    docsUrl: 'https://posthog.com/docs/getting-started/install',
  },
];
