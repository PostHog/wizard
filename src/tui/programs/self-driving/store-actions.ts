/**
 * Self-driving's screen answers and session writes, made through the store's
 * generic setter so the store names no program. Each one emits a change, so
 * gates re-check.
 */
import type { OutroData } from '@agent/types';
import type { WizardStore } from '@tui/store';
import type { CloudRegion } from '@utils/types';
import { analytics, sessionProperties } from '@utils/analytics';

/**
 * Integration-check answer. `true` → integrate the SDK as part of this run;
 * `false` → PostHog is already set up, go straight to Self-driving. Resolves
 * `store.integrate` from null.
 */
export function setIntegrate(
  store: WizardStore,
  integrate: boolean,
  extra?: { via?: string; path?: string },
): void {
  analytics.wizardCapture('self-driving integration check', {
    self_driving_integrate: integrate,
    ...(extra?.via ? { self_driving_integrate_via: extra.via } : {}),
    ...(extra?.path ? { self_driving_integrate_path: extra.path } : {}),
    ...sessionProperties(store.session),
  });
  store.updateTuiState({ integrate });
}

/**
 * The "no PostHog account" branch of the integration check. The project has
 * no SDK, so we always integrate (`integrate = true`); and since the user has
 * no account, we flip `signup` and record the `email` / `region` collected on
 * the screen so `authenticate` → `getOrAskForProjectData` takes the
 * provisioning path (create account + email a login link) instead of OAuth.
 * The "yes, I have an account" branch uses `setIntegrate(true)` and leaves
 * `signup` false so auth runs the normal OAuth login.
 */
export function chooseProvisionAccount(
  store: WizardStore,
  email: string,
  region: CloudRegion,
): void {
  analytics.wizardCapture('self-driving integration check', {
    self_driving_integrate: true,
    self_driving_has_account: false,
    provision_region: region,
    ...sessionProperties(store.session),
  });
  store.updateTuiState({ integrate: true }, { signup: true, email, region });
}

/**
 * The user acknowledged the post-integration handoff screen, so the
 * Self-driving run can begin. The gate resolves on the change.
 */
export function confirmSelfDrivingHandoff(store: WizardStore): void {
  store.updateTuiState({ selfDrivingHandoffConfirmed: true });
}

/** Whether the PostHog GitHub App is connected, as the poll found it. */
export function setGithubConnected(
  store: WizardStore,
  connected: boolean,
): void {
  store.updateTuiState({ githubConnected: connected });
}

/**
 * GitHub gate declined. Carries the outro the user lands on, since declining
 * ends the flow before the agent runs and there is no abort case to render
 * one.
 */
export function declineGithub(store: WizardStore, outroData: OutroData): void {
  store.updateTuiState({ githubDeclined: true }, { outroData });
}
