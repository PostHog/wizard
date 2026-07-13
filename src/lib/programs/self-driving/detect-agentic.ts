/**
 * Agentic (Haiku) detection for self-driving's integration phase.
 *
 * Mirrors source-maps: the integration-detect screen runs `detectSelfDriving-
 * IntegrationProjects` (the shared Haiku detector with the integration framework
 * targets), shows a project map, and the user picks one. This file supplies the
 * targets, maps the result back to `Integration`s, and classifies each project
 * as instrumentable (a framework the wizard supports that doesn't already have
 * PostHog). The screen writes the choice to the session; `prepSelfDriving-
 * Integration` then gathers the chosen project's framework context before the
 * integration agent runs (the runner scopes the install dir).
 */

import {
  detectProjectsWithAgent,
  type DetectTarget,
  type AgenticDetectionReport,
  type DetectEvent,
} from '@lib/detection/agentic';
import { gatherFrameworkContext } from '@lib/detection/index';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import { Integration } from '@lib/constants';
import type { WizardSession } from '@lib/wizard-session';

export type { DetectEvent };

/** Integration framework targets for the agentic detector (id → display name). */
const INTEGRATION_TARGETS: DetectTarget[] = Object.entries(
  FRAMEWORK_REGISTRY,
).map(([id, config]) => ({ id, name: config.metadata.name }));

const INTEGRATION_IDS = new Set<string>(Object.values(Integration));

/** One project, classified for a PostHog SDK integration. */
export type IntegrationProject = {
  /** Path relative to the repo root ("." for the root). */
  path: string;
  /** Human-readable framework the agent detected (e.g. "Next.js"). */
  framework: string;
  /** A supported framework when it matches one, else null. */
  integration: Integration | null;
  /** Whether a PostHog SDK is already installed in this project. */
  hasPostHog: boolean;
  /** Supported framework without PostHog — or with it, when the
   * events-check path asked for existing installs to be instrumentable. */
  instrumentable: boolean;
  /** hasPostHog and not picked as an instrument target: skip integration
   * and continue straight to Self-driving. */
  continuable: boolean;
  /** Why the project can't be set up (only when !instrumentable). */
  reason?: string;
};

export type IntegrationDetectionReport = {
  repoType: 'monorepo' | 'single';
  projects: IntegrationProject[];
};

export type IntegrationDetectOptions = {
  /**
   * Treat projects that already have the PostHog SDK as instrumentable
   * (a supported framework is still required). Used by the events-check
   * path: the user accepted a product analytics setup for a project whose
   * SDK is already installed, so "already has PostHog" is the point, not a
   * disqualifier. Such projects stop being offered as continue-with-existing
   * so they don't appear in the picker twice.
   */
  instrumentExisting?: boolean;
};

function classify(
  integration: Integration | null,
  hasPostHog: boolean,
  instrumentExisting: boolean,
): { instrumentable: boolean; reason?: string } {
  if (integration == null) {
    return {
      instrumentable: false,
      reason: 'Not a framework the wizard can set up yet',
    };
  }
  if (hasPostHog && !instrumentExisting) {
    return { instrumentable: false, reason: 'Already has the PostHog SDK' };
  }
  return { instrumentable: true };
}

/** Map a detection report into classified projects (exported for tests). */
export function toIntegrationReport(
  report: AgenticDetectionReport,
  options: IntegrationDetectOptions = {},
): IntegrationDetectionReport {
  const instrumentExisting = options.instrumentExisting === true;
  return {
    repoType: report.repoType,
    projects: report.projects.map((p) => {
      const integration =
        p.targetId && INTEGRATION_IDS.has(p.targetId)
          ? (p.targetId as Integration)
          : null;
      const classified = classify(
        integration,
        p.hasPostHog,
        instrumentExisting,
      );
      return {
        path: p.path,
        framework: p.framework,
        integration,
        hasPostHog: p.hasPostHog,
        // Instrumentable-with-PostHog (events-check mode) projects are picker
        // targets, not continue-with-existing rows.
        continuable: p.hasPostHog && !classified.instrumentable,
        ...classified,
      };
    }),
  };
}

/** Run the Haiku detector over the repo and classify projects for integration. */
export async function detectSelfDrivingIntegrationProjects(
  session: WizardSession,
  onEvent?: DetectEvent,
  options?: IntegrationDetectOptions,
): Promise<IntegrationDetectionReport> {
  const report = await detectProjectsWithAgent(session, {
    targets: INTEGRATION_TARGETS,
    purpose: 'set up a PostHog SDK integration',
    onEvent,
  });
  return toIntegrationReport(report, options);
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
