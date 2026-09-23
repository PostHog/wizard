/** Non-interactive project scoping — scan the repo agentically and pick which project the run integrates. */

import {
  detectProjectsWithAgent,
  AgenticDetectionTimeoutError,
  resolveProjectDir,
  type AgenticDetectionReport,
  type AgenticProject,
  type DetectEvent,
  type DetectTarget,
} from './agentic.js';
import { authenticate } from '@lib/programs/authenticate';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import {
  Integration,
  WIZARD_BASIC_INTEGRATION_AGENTIC_DETECTION_FLAG_KEY,
} from '@shared/constants';
import type { WizardSession } from '@lib/wizard-session';
import { getUI } from '@ui/index';
import { analytics } from '@utils/analytics';
import { logToFile } from '@utils/debug';

/** Integration framework targets for the agentic detector (id → display name). */
const INTEGRATION_TARGETS: DetectTarget[] = Object.entries(
  FRAMEWORK_REGISTRY,
).map(([id, config]) => ({ id, name: config.metadata.name }));

const INTEGRATION_IDS = new Set<string>(Object.values(Integration));

/** A scanned project matched to a wizard framework. Each program classifies it with its own rule. */
export type IntegrationCandidate = {
  /** Path relative to the repo root ("." for the root). */
  path: string;
  /** Human-readable framework the agent detected (e.g. "Next.js"). */
  framework: string;
  /** The wizard framework the project matches, else null. */
  integration: Integration | null;
  /** Whether a PostHog SDK is already installed in this project. */
  hasPostHog: boolean;
  /** The scan's pick for the main app. Always false unless the scan set `recommend`. */
  recommended: boolean;
};

/** Match each project of an integration scan to a wizard framework. */
export function toIntegrationCandidates(
  report: AgenticDetectionReport,
): IntegrationCandidate[] {
  return report.projects.map((p) => ({
    path: p.path,
    framework: p.framework,
    integration:
      p.targetId && INTEGRATION_IDS.has(p.targetId)
        ? (p.targetId as Integration)
        : null,
    hasPostHog: p.hasPostHog,
    recommended: p.recommended === true,
  }));
}

/** Run the agentic detector for the wizard's integration frameworks — the single home of targets + purpose. */
export async function detectIntegrationProjects(
  session: WizardSession,
  options: {
    /** Program the scan bills to. Required so no caller can go unattributed. */
    programId: string;
    recommend?: boolean;
    onEvent?: DetectEvent;
  },
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
  let report: AgenticDetectionReport;
  try {
    report = await detectIntegrationProjects(session, {
      // Literal, like the `authenticate` call above: importing the program
      // registry here would cycle.
      programId: 'posthog-integration',
      recommend: true,
      onEvent: (line) => logToFile('[agentic detect]', line),
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (error instanceof AgenticDetectionTimeoutError) {
      captureOutcome('timeout', { duration_ms: Date.now() - startedAt });
      getUI().log.warn(
        `${error.message}; continuing with the install dir as-is.`,
      );
      return;
    }
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
  const recommended = projects.find((p) => p.recommended === true);
  // The event carries at most this many projects; project_count is the true total.
  const MAX_PROJECTS_CAPTURED = 25;
  const scanProperties = {
    duration_ms: Date.now() - startedAt,
    repo_type: report.repoType,
    project_count: projects.length,
    supported_count: projects.filter((p) => p.targetId != null).length,
    has_recommendation: recommended !== undefined,
    recommended_path: recommended?.path ?? null,
    projects: projects.slice(0, MAX_PROJECTS_CAPTURED),
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
