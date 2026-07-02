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
import { DEFAULT_E2E_PROFILE, type WizardE2eProfile } from './e2e-profile.js';
import posthogIntegrationE2e from '@lib/programs/posthog-integration/test/e2e.json';
import selfDrivingE2e from '@lib/programs/self-driving/test/e2e.json';
import sourceMapsE2e from '@lib/programs/error-tracking-upload-source-maps/test/e2e.json';

const PROFILES: Partial<Record<ProgramId, WizardE2eProfile>> = {
  [Program.PostHogIntegration]:
    posthogIntegrationE2e.profile as WizardE2eProfile,
  [Program.SelfDriving]: selfDrivingE2e.profile as WizardE2eProfile,
  [Program.ErrorTrackingUploadSourceMaps]:
    sourceMapsE2e.profile as WizardE2eProfile,
};

/** The e2e profile for a program, or the happy-path default if none is set. */
export function profileFor(program: ProgramId): WizardE2eProfile {
  return PROFILES[program] ?? DEFAULT_E2E_PROFILE;
}

/** Whether a program has an explicit (non-default) e2e profile. */
export function hasProfile(program: ProgramId): boolean {
  return program in PROFILES;
}
