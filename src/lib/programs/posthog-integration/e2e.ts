/**
 * E2E test definition for the PostHog integration flow — the UI choices
 * `wizard-ci --e2e` makes when driving this program headlessly.
 *
 * Lives next to the program (not in the test harness) because the choices are
 * product knowledge about this flow. The harness reads it via
 * `ProgramConfig.e2e` and asks `decideE2eAction` what to commit on each screen.
 */

import type { WizardE2eProfile } from '@lib/ci-driver/e2e-profile';

/**
 * Happy path: confirm the intro, push past any health-check issue, pick the
 * first setup option, skip MCP + Slack, and delete the installed skills.
 */
export const POSTHOG_INTEGRATION_E2E_PROFILE: WizardE2eProfile = {
  setup: 'first',
  healthCheck: 'dismiss',
  mcp: 'skip',
  slack: 'skip',
  skills: 'delete',
  ask: 'first',
};
