/** Non-interactive project scoping — scan the repo agentically and pick which project the run integrates. */

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
import {
  AGENTIC_DETECTION_TIMEOUT_MS,
  WIZARD_BASIC_INTEGRATION_AGENTIC_DETECTION_FLAG_KEY,
} from '@lib/constants';
import type { WizardSession } from '@lib/wizard-session';
import { getUI } from '@ui/index';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

/** Integration framework targets for the agentic detector (id → display name). */
const INTEGRATION_TARGETS: DetectTarget[] = Object.entries(
  FRAMEWORK_REGISTRY,
).map(([id, config]) => ({ id, name: config.metadata.name }));

/** Run the agentic detector for the wizard's integration frameworks — the single home of targets + purpose. */
export async function detectIntegrationProjects(
  session: WizardSession,
  options: { recommend?: boolean; onEvent?: DetectEvent } = {},
): Promise<AgenticDetectionReport> {
  // Spread first so the targets and purpose this function owns always win.
  return detectProjectsWithAgent(session, {
    ...options,
    targets: INTEGRATION_TARGETS,
    purpose: 'set up a PostHog SDK integration',
  });
}

/** Pick the recommended-if-supported project (even with PostHog — the main app wins), else the first supported PostHog-free one. */
export function chooseIntegrationProject(
  projects: AgenticProject[],
): AgenticProject | undefined {
  return (
    projects.find((p) => p.recommended === true && p.targetId != null) ??
    projects.find((p) => p.targetId != null && !p.hasPostHog)
  );
}

/** Every run fires exactly one `wizard: agentic detection` event with one of these outcomes — no untracked exits. */
export type AgenticDetectionOutcome =
  | 'flag-off'
  | 'error'
  | 'timeout'
  | 'no-project'
  | 'recommended'
  | 'first-instrumentable';

/** Sentinel for a scan that outran AGENTIC_DETECTION_TIMEOUT_MS. */
const TIMED_OUT = Symbol('timed-out');

function captureOutcome(
  outcome: AgenticDetectionOutcome,
  properties: Record<string, unknown> = {},
): void {
  analytics.wizardCapture('agentic detection', { outcome, ...properties });
}

/** Flag-gated non-interactive monorepo phase: scan, auto-choose the recommended project, re-point session.installDir; every failure leaves the session untouched. */
export async function scopeInstallDirToProject(
  session: WizardSession,
): Promise<void> {
  // Idempotent early auth: the detector needs credentials and the flag must evaluate as the logged-in user.
  await authenticate(session, 'posthog-integration');
  const flags = await analytics.getAllFlagsForWizard();
  if (flags[WIZARD_BASIC_INTEGRATION_AGENTIC_DETECTION_FLAG_KEY] !== 'true') {
    // A failed flag fetch surfaces as an empty map, so flag-off also covers "flags unavailable".
    captureOutcome('flag-off');
    return;
  }

  getUI().log.info('Scanning the repo for projects...');
  const startedAt = Date.now();
  let report: AgenticDetectionReport | typeof TIMED_OUT;
  try {
    report = await Promise.race([
      detectIntegrationProjects(session, {
        recommend: true,
        onEvent: (line) => logToFile('[agentic detect]', line),
      }),
      // The agent has no abort plumbing, so a timed-out scan is abandoned in the
      // background rather than cancelled; the run stops waiting on it either way.
      new Promise<typeof TIMED_OUT>((resolve) =>
        setTimeout(() => resolve(TIMED_OUT), AGENTIC_DETECTION_TIMEOUT_MS),
      ),
    ]);
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

  if (report === TIMED_OUT) {
    captureOutcome('timeout', { duration_ms: Date.now() - startedAt });
    getUI().log.warn(
      `Project scan timed out after ${
        AGENTIC_DETECTION_TIMEOUT_MS / 1000
      }s; continuing with the install dir as-is.`,
    );
    return;
  }

  const { projects } = report;
  const recommended = projects.find((p) => p.recommended === true);
  const scanProperties = {
    duration_ms: Date.now() - startedAt,
    repo_type: report.repoType,
    project_count: projects.length,
    supported_count: projects.filter((p) => p.targetId != null).length,
    has_recommendation: recommended !== undefined,
    recommended_path: recommended?.path ?? null,
    projects,
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
