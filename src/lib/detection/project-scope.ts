/**
 * Non-interactive project scoping — run the agentic detector and pick which
 * project a run should integrate.
 *
 * CI/headless basic-integration runs have no picker screen, so `ciPreRun`'s
 * first phase runs the shared Haiku detector (with the integration framework
 * targets and a recommendation) and auto-chooses the project. The choice
 * re-points `session.installDir` — the same "detection only decides which
 * directory" split self-driving gets via `targetDir` — so the program's
 * deterministic detection runs inside that directory. Gated on the
 * basic-integration-agentic-detection flag; flag off, scan failure, or
 * nothing choosable all leave the session untouched.
 */

import {
  detectProjectsWithAgent,
  resolveProjectDir,
  type AgenticDetectionReport,
  type AgenticProject,
  type DetectEvent,
  type DetectTarget,
} from './agentic.js';
import { authenticate } from '@lib/agent/runner/shared/authenticate';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import { BASIC_INTEGRATION_AGENTIC_DETECTION_FLAG_KEY } from '@lib/constants';
import type { WizardSession } from '@lib/wizard-session';
import { getUI } from '@ui/index';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

/** Integration framework targets for the agentic detector (id → display name). */
const INTEGRATION_TARGETS: DetectTarget[] = Object.entries(
  FRAMEWORK_REGISTRY,
).map(([id, config]) => ({ id, name: config.metadata.name }));

/**
 * Run the agentic detector configured for the wizard's integration
 * frameworks. The single home of the target list and scan purpose — shared
 * by self-driving's picker (which layers its display classification on top)
 * and the non-interactive scoping below.
 */
export async function detectIntegrationProjects(
  session: WizardSession,
  options: { recommend?: boolean; onEvent?: DetectEvent } = {},
): Promise<AgenticDetectionReport> {
  // Spread first: targets and purpose are the two things this function
  // exists to own, so they must win if the options type ever widens.
  return detectProjectsWithAgent(session, {
    ...options,
    targets: INTEGRATION_TARGETS,
    purpose: 'set up a PostHog SDK integration',
  });
}

/**
 * Pick the project a non-interactive run should integrate, from the raw scan
 * report: the recommended project when it matches a supported framework —
 * even if it already has PostHog, since skipping the main app would silently
 * instrument a secondary project and the integration handles existing
 * installs — else the first supported project without PostHog. A pure
 * function so the precedence is unit-testable without a UI.
 */
export function chooseIntegrationProject(
  projects: AgenticProject[],
): AgenticProject | undefined {
  return (
    projects.find((p) => p.recommended === true && p.targetId != null) ??
    projects.find((p) => p.targetId != null && !p.hasPostHog)
  );
}

/**
 * Every run through the phase fires exactly one of these — `wizard: agentic
 * detection` with `outcome` — so funnels can branch on it with no untracked
 * gap (an unfired path here would read as a mysteriously low rollout).
 */
export type AgenticDetectionOutcome =
  | 'flag-off'
  | 'error'
  | 'no-project'
  | 'recommended'
  | 'first-instrumentable';

function captureOutcome(
  outcome: AgenticDetectionOutcome,
  properties: Record<string, unknown> = {},
): void {
  analytics.wizardCapture('agentic detection', { outcome, ...properties });
}

/**
 * Non-interactive monorepo phase (headless + CI), gated on the
 * basic-integration-agentic-detection flag: run the agentic project scan
 * with the wizard's frameworks as targets, auto-choose the recommended
 * project (no user in the loop — self-driving makes the same choice with its
 * picker screen), and re-point `session.installDir` so the deterministic
 * detection that follows runs in that directory.
 */
export async function scopeInstallDirToProject(
  session: WizardSession,
): Promise<void> {
  // The detector needs credentials and the flag must evaluate as the
  // logged-in user; authenticate is idempotent, so bootstrap's later call
  // becomes a no-op instead of a second login.
  await authenticate(session, 'posthog-integration');
  const flags = await analytics.getAllFlagsForWizard();
  if (flags[BASIC_INTEGRATION_AGENTIC_DETECTION_FLAG_KEY] !== 'true') {
    // A failed flag fetch surfaces as an empty map (logged inside
    // getAllFlagsForWizard), so flag-off also covers "flags unavailable".
    captureOutcome('flag-off');
    return;
  }

  getUI().log.info('Scanning the repo for projects...');
  const startedAt = Date.now();
  let report: AgenticDetectionReport;
  try {
    report = await detectIntegrationProjects(session, {
      recommend: true,
      onEvent: (line) => logToFile('[agentic detect]', line),
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    analytics.captureException(error, { step: 'agentic_detection' });
    captureOutcome('error', {
      duration_ms: Date.now() - startedAt,
      error_message: error.message,
    });
    getUI().log.warn(
      `Project scan failed (${error.message}); continuing with the install dir as-is.`,
    );
    return;
  }

  const { projects } = report;
  const scanProperties = {
    duration_ms: Date.now() - startedAt,
    repo_type: report.repoType,
    project_count: projects.length,
    supported_count: projects.filter((p) => p.targetId != null).length,
    has_recommendation: projects.some((p) => p.recommended === true),
  };

  const project = chooseIntegrationProject(projects);
  if (!project) {
    captureOutcome('no-project', scanProperties);
    getUI().log.info(
      'The scan found no supported project; continuing with the install dir as-is.',
    );
    return;
  }

  session.installDir = resolveProjectDir(session.installDir, project.path);
  captureOutcome(project.recommended ? 'recommended' : 'first-instrumentable', {
    ...scanProperties,
    chosen_framework: project.targetId,
    chosen_path: project.path,
  });
  getUI().log.info(`Continuing with ${project.path} (${project.framework}).`);
}
