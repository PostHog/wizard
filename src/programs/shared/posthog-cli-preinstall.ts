/**
 * Machine-global posthog-cli pre-install, shared by the programs whose symbol
 * upload shells out to it (error-tracking and error-tracking-upload-source-maps).
 *
 * The agent cannot install a global package — warlock blocks `npm install -g`
 * — so the wizard does it in-process, at most once per process. Warn, don't
 * fail: the run still instruments capture, and only the release build's upload
 * needs the CLI.
 */

import type { RunnerContext } from '@programs/runner-context';
import { installOrUpdatePostHogCli } from '@steps/install-cli-steering';
import { analytics } from '@utils/analytics';

let attempted = false;

export function preinstallPostHogCliOnce(
  failureEvent: string,
  properties: Record<string, string>,
  log: RunnerContext['log'],
): void {
  if (attempted) return;
  attempted = true;

  const result = installOrUpdatePostHogCli();
  if (result.success) return;

  // No npm, or no permission for a global install, is the user's environment,
  // not a wizard bug: an event, never captureException, which would mint an
  // error-tracking issue per machine.
  analytics.wizardCapture(failureEvent, {
    ...properties,
    error: String(result.error).slice(0, 500),
  });
  log.warn(
    `Could not pre-install posthog-cli (${result.error}). Your release build ` +
      `will fail to upload debug symbols until it's installed: npm install -g @posthog/cli@latest`,
  );
}

/** Test seam: forget that the install was attempted. */
export function resetPostHogCliPreinstallForTests(): void {
  attempted = false;
}
