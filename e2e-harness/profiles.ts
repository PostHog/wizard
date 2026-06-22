/**
 * Per-program e2e profiles — the UI choices a headless run makes driving each
 * program's flow. These are product knowledge about the flows, but they live in
 * the test harness (NOT on the program config) so none of this e2e machinery
 * reaches the wizard's production source. Look one up with {@link profileFor}.
 */

import { Program, type ProgramId } from '@lib/programs/program-registry';
import { DEFAULT_E2E_PROFILE, type WizardE2eProfile } from './e2e-profile.js';

/**
 * PostHog integration happy path: confirm the intro, push past any health-check
 * issue, pick the first setup option, skip MCP + Slack, delete installed skills.
 */
const POSTHOG_INTEGRATION_PROFILE: WizardE2eProfile = {
  setup: 'first',
  healthCheck: 'dismiss',
  mcp: 'skip',
  slack: 'skip',
  skills: 'delete',
  ask: 'first',
};

const PROFILES: Partial<Record<ProgramId, WizardE2eProfile>> = {
  [Program.PostHogIntegration]: POSTHOG_INTEGRATION_PROFILE,
};

/** The e2e profile for a program, or the happy-path default if none is set. */
export function profileFor(program: ProgramId): WizardE2eProfile {
  return PROFILES[program] ?? DEFAULT_E2E_PROFILE;
}

/** Whether a program has an explicit (non-default) e2e profile. */
export function hasProfile(program: ProgramId): boolean {
  return program in PROFILES;
}
