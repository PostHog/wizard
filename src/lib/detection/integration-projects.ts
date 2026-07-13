/**
 * Integration project detection — the shared vocabulary for monorepo-aware
 * integration flows.
 *
 * Layers the generic agentic detector (./agentic) with the wizard's
 * integration knowledge: scan a repo, classify every project against
 * FRAMEWORK_REGISTRY, optionally have the agent flag one `recommended`
 * project (the main client/frontend/mobile app), and resolve a chosen
 * project's path into a safe run directory.
 *
 * Deliberately chooser-agnostic so every flow consumes the same report and
 * differs only in who chooses: self-driving puts a picker screen in front of
 * it (the user chooses), headless basic-integration auto-chooses via
 * `chooseProject`, and a future interactive basic-integration picker would
 * take the same report with `recommended` as its default selection.
 */

import { resolve, sep } from 'path';
import { Integration } from '@lib/constants';
import { FRAMEWORK_REGISTRY } from '@lib/registry';
import type { WizardSession } from '@lib/wizard-session';
import {
  detectProjectsWithAgent,
  type AgenticDetectionReport,
  type DetectEvent,
  type DetectTarget,
} from './agentic.js';

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
  /** integration != null && !hasPostHog — PostHog can be set up here. */
  instrumentable: boolean;
  /** hasPostHog: skip integration and continue straight to Self-driving. */
  continuable: boolean;
  /**
   * True on the single project the agent flagged as the main user-facing
   * app. Only present when the scan asked for it (`recommend: true`).
   */
  recommended?: boolean;
  /** Why the project can't be set up (only when !instrumentable). */
  reason?: string;
};

export type IntegrationDetectionReport = {
  repoType: 'monorepo' | 'single';
  projects: IntegrationProject[];
};

function classify(
  integration: Integration | null,
  hasPostHog: boolean,
): { instrumentable: boolean; reason?: string } {
  if (integration == null) {
    return {
      instrumentable: false,
      reason: 'Not a framework the wizard can set up yet',
    };
  }
  if (hasPostHog) {
    return { instrumentable: false, reason: 'Already has the PostHog SDK' };
  }
  return { instrumentable: true };
}

/** Map a detection report into classified projects (exported for tests). */
export function toIntegrationReport(
  report: AgenticDetectionReport,
): IntegrationDetectionReport {
  return {
    repoType: report.repoType,
    projects: report.projects.map((p) => {
      const integration =
        p.targetId && INTEGRATION_IDS.has(p.targetId)
          ? (p.targetId as Integration)
          : null;
      return {
        path: p.path,
        framework: p.framework,
        integration,
        hasPostHog: p.hasPostHog,
        continuable: p.hasPostHog,
        recommended: p.recommended,
        ...classify(integration, p.hasPostHog),
      };
    }),
  };
}

/** Run the agentic detector over the repo and classify projects for integration. */
export async function detectIntegrationProjects(
  session: WizardSession,
  options: { recommend?: boolean; onEvent?: DetectEvent } = {},
): Promise<IntegrationDetectionReport> {
  const report = await detectProjectsWithAgent(session, {
    targets: INTEGRATION_TARGETS,
    purpose: 'set up a PostHog SDK integration',
    recommend: options.recommend,
    onEvent: options.onEvent,
  });
  return toIntegrationReport(report);
}

/**
 * Auto-choose the project an unattended run should integrate: the
 * recommended project when it's a supported framework — even if it already
 * has PostHog, since disqualifying the main app would silently instrument a
 * secondary project and the integration handles existing installs — else the
 * first instrumentable project, else null (caller keeps its directory as-is).
 * Interactive flows make this same choice with a user in the loop instead.
 */
export function chooseProject(
  report: IntegrationDetectionReport,
): IntegrationProject | null {
  const recommended = report.projects.find(
    (p) => p.recommended === true && p.integration != null,
  );
  if (recommended) return recommended;
  return report.projects.find((p) => p.instrumentable) ?? null;
}

/**
 * Absolute dir for a chosen project path. The path is LLM output; if it
 * resolves outside the repo (defense-in-depth on top of the coerce-layer
 * clamp), fall back to the root rather than run the agent elsewhere.
 */
export function resolveProjectDir(installDir: string, rel: unknown): string {
  if (typeof rel !== 'string' || rel === '.') return installDir;
  const root = resolve(installDir);
  const dir = resolve(root, rel);
  return dir === root || dir.startsWith(root + sep) ? dir : root;
}
