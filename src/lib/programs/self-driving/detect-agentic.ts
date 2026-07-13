/**
 * Agentic (Haiku) detection for self-driving's integration phase.
 *
 * Thin adapter over the shared integration-project vocabulary
 * (@lib/detection/integration-projects): the integration-detect screen runs
 * `detectSelfDrivingIntegrationProjects`, shows the project map, and the user
 * picks one — self-driving's chooser is the picker screen, so no
 * recommendation is requested. The screen writes the choice to the session;
 * `prepSelfDrivingIntegration` then gathers the chosen project's framework
 * context before the integration agent runs (the runner scopes the install
 * dir).
 */

import {
  detectIntegrationProjects,
  type DetectEvent,
  type IntegrationDetectionReport,
} from '@lib/detection/integration-projects';
import { gatherFrameworkContext } from '@lib/detection/index';
import type { WizardSession } from '@lib/wizard-session';

export type { DetectEvent };
export {
  toIntegrationReport,
  type IntegrationProject,
  type IntegrationDetectionReport,
} from '@lib/detection/integration-projects';

/** Run the Haiku detector over the repo and classify projects for integration. */
export async function detectSelfDrivingIntegrationProjects(
  session: WizardSession,
  onEvent?: DetectEvent,
): Promise<IntegrationDetectionReport> {
  return detectIntegrationProjects(session, { onEvent });
}

/**
 * Prepare the integration phase after the user picked a project on the
 * integration-detect screen (which set `session.integration`, `frameworkConfig`,
 * and the chosen path). Scopes `installDir` to the chosen project — so a
 * monorepo integrates into the picked sub-app — and gathers that project's
 * framework context, mirroring posthog-integration's `ciPreRun`. Used as the
 * integrate-run step's `onRunPrep`.
 */
export async function prepSelfDrivingIntegration(
  session: WizardSession,
): Promise<void> {
  // `session` is the phase's derived session — its installDir is already the
  // picked project (the integrate-run step's `targetDir`), so just gather that
  // project's framework context.
  const frameworkConfig = session.frameworkConfig;
  if (!frameworkConfig) return;

  const context = await gatherFrameworkContext(frameworkConfig, {
    installDir: session.installDir,
    debug: session.debug,
    default: false,
    signup: session.signup,
    localMcp: session.localMcp,
    ci: session.ci,
    benchmark: session.benchmark,
    yaraReport: session.yaraReport,
  });
  for (const [key, value] of Object.entries(context)) {
    if (!(key in session.frameworkContext)) {
      session.frameworkContext[key] = value;
    }
  }
}
