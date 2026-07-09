/**
 * Per-program e2e profiles — the UI choices a headless run makes driving each
 * program's flow.
 *
 * Each program declares its test path as JSON next to it
 * (`src/lib/programs/<program>/test/e2e.json`): a `profile` (the options the run
 * auto-takes) plus a documented `path`. {@link profileFor} loads the `profile`
 * and maps it by program id.
 */

import { Program, type ProgramId } from '@lib/programs/program-registry';
import {
  DEFAULT_E2E_PROFILE,
  DEFAULT_E2E_VARIATION,
  type WizardE2eProfile,
  type WizardE2eVariation,
} from './e2e-profile.js';
import posthogIntegrationE2e from '@lib/programs/posthog-integration/test/e2e.json';

const PROFILES: Partial<Record<ProgramId, WizardE2eProfile>> = {
  [Program.PostHogIntegration]:
    posthogIntegrationE2e.profile as WizardE2eProfile,
};

const VARIATIONS: Partial<Record<ProgramId, WizardE2eVariation[]>> = {
  [Program.PostHogIntegration]:
    posthogIntegrationE2e.variations as WizardE2eVariation[],
};

/** The e2e profile for a program, or the happy-path default if none is set. */
export function profileFor(program: ProgramId): WizardE2eProfile {
  return PROFILES[program] ?? DEFAULT_E2E_PROFILE;
}

/** Whether a program has an explicit (non-default) e2e profile. */
export function hasProfile(program: ProgramId): boolean {
  return program in PROFILES;
}

/**
 * The switchboard variations to snapshot for a program — one run each. Falls
 * back to the single no-override baseline when a program declares none.
 */
export function variationsFor(program: ProgramId): WizardE2eVariation[] {
  return VARIATIONS[program] ?? [DEFAULT_E2E_VARIATION];
}
