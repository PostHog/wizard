/**
 * Error-tracking adapter over the shared integration scan: classifies each
 * project for the post-login picker and scopes the run to the picked one.
 *
 * Self-driving classifies the same scan (`toIntegrationCandidates`) with a
 * different rule, so each program keeps its own:
 * - A project that already has PostHog is a setup target here. Self-driving
 *   offers it as "continue with existing" instead.
 * - KMP is not offered here (see `ERROR_TRACKING_UNSUPPORTED`).
 * - The scan asks for a recommended project, and the picker lists it first.
 * - The scan bills to error-tracking.
 */

import { Integration } from '@shared/constants';
import {
  resolveProjectDir,
  type AgenticDetectionReport,
  type DetectEvent,
} from '@lib/detection/agentic';
import { gatherFrameworkContext } from '@lib/detection/index';
import {
  detectIntegrationProjects,
  toIntegrationCandidates,
} from '@lib/detection/project-scope';
import type { WizardSession } from '@lib/wizard-session';

/** frameworkContext key for the picked project's path, relative to the repo root. */
export const ERROR_TRACKING_PROJECT_PATH_KEY = 'errorTrackingProjectPath';

/** KMP skill variants carry no `framework` tag, so orchestrator preflight aborts every KMP run. */
export const ERROR_TRACKING_UNSUPPORTED: ReadonlySet<Integration> = new Set([
  Integration.kmp,
]);

/** One project, classified for the picker. */
export type ErrorTrackingProject = {
  /** Path relative to the repo root ("." for the root). */
  path: string;
  /** Human-readable framework the agent detected (e.g. "Next.js"). */
  framework: string;
  /** A wizard framework when the project matches one, else null. */
  integration: Integration | null;
  /** The flow can run here. PostHog does not have to be installed yet. */
  instrumentable: boolean;
};

export type ErrorTrackingDetectionReport = {
  repoType: 'monorepo' | 'single';
  projects: ErrorTrackingProject[];
};

/** Classify the scan for the picker, recommended project first (exported for tests). */
export function toErrorTrackingReport(
  report: AgenticDetectionReport,
): ErrorTrackingDetectionReport {
  const candidates = toIntegrationCandidates(report).sort(
    (a, b) => Number(b.recommended) - Number(a.recommended),
  );
  return {
    repoType: report.repoType,
    projects: candidates.map((p) => ({
      path: p.path,
      framework: p.framework,
      integration: p.integration,
      instrumentable:
        p.integration != null && !ERROR_TRACKING_UNSUPPORTED.has(p.integration),
    })),
  };
}

/** Scan the repo for projects, billed to error tracking. */
export async function detectErrorTrackingProjects(
  session: WizardSession,
  onEvent?: DetectEvent,
): Promise<ErrorTrackingDetectionReport> {
  const report = await detectIntegrationProjects(session, {
    programId: 'error-tracking',
    recommend: true,
    onEvent,
  });
  return toErrorTrackingReport(report);
}

/** The run's working directory: the picked project, else the repo root. */
export function errorTrackingProjectDir(session: WizardSession): string {
  return resolveProjectDir(
    session.installDir,
    session.frameworkContext[ERROR_TRACKING_PROJECT_PATH_KEY],
  );
}

/** Gather framework context for `session.installDir`, keeping keys already set. */
export async function gatherErrorTrackingContext(
  session: WizardSession,
): Promise<void> {
  const frameworkConfig = session.frameworkConfig;
  if (!frameworkConfig) return;
  const context = await gatherFrameworkContext(frameworkConfig, {
    installDir: session.installDir,
    debug: session.debug,
    signup: session.signup,
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
