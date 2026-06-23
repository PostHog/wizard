/**
 * Source-maps adapter over the generic agentic detector
 * (`@lib/detection/agentic`). The detector itself is product-knowledge-free;
 * this file supplies the source-maps targets (the automatable skill variants),
 * maps the result back to variants, and classifies each project as
 * instrumentable or not. The screen renders the result and the run step
 * instruments the chosen project.
 */

import {
  detectProjectsWithAgent,
  coerceAgenticReport,
  type DetectTarget,
  type AgenticDetectionReport,
  type DetectEvent,
} from '@lib/detection/agentic';
import type { WizardSession } from '@lib/wizard-session';
import {
  VARIANT_DISPLAY_NAME,
  AUTOMATABLE_VARIANTS,
  type SkillVariant,
} from './detect.js';

export type { DetectEvent };

/** One project, classified for source-map upload. */
export type DetectedProject = {
  /** Path relative to the working directory ("." for the repo root). */
  path: string;
  /** Human-readable framework the agent detected (e.g. "Next.js"). */
  framework: string;
  /** A supported source-maps variant when it matches one, else null. */
  variant: SkillVariant | null;
  /** Whether a PostHog SDK is already installed in this project. */
  hasPostHog: boolean;
  /** variant != null && hasPostHog — source-map upload can be wired up here. */
  instrumentable: boolean;
  /** Why the project can't be instrumented (only when !instrumentable). */
  reason?: string;
};

export type DetectionReport = {
  repoType: 'monorepo' | 'single';
  projects: DetectedProject[];
};

/**
 * Variant precedence for the agentic picker (most specific first). The detector
 * keeps the EARLIEST matching target, so this ordering is what makes a React app
 * built with Vite resolve to `vite` (bundler-plugin upload) instead of the
 * generic `react` posthog-cli path. Mirrors `pickJsVariant` in detect.ts:
 * opinionated frameworks → bundlers → bare React → Node → generic web.
 */
const VARIANT_PRECEDENCE: readonly SkillVariant[] = [
  'nextjs',
  'nuxt',
  'angular',
  'vite',
  'webpack',
  'rollup',
  'react',
  'node',
  'web',
];

const precedenceRank = (v: SkillVariant): number => {
  const i = VARIANT_PRECEDENCE.indexOf(v);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

/**
 * Source-maps targets: the variants the wizard can automate, by id → name,
 * ordered by VARIANT_PRECEDENCE so the detector's "earliest match wins"
 * tie-break selects the most specific variant. Derived from AUTOMATABLE_VARIANTS
 * so a newly-automatable variant is never silently dropped (unranked ones sort
 * last). Exported for testing.
 */
export const SOURCE_MAPS_TARGETS: DetectTarget[] = [...AUTOMATABLE_VARIANTS]
  .sort((a, b) => precedenceRank(a) - precedenceRank(b))
  .map((v) => ({ id: v, name: VARIANT_DISPLAY_NAME[v] }));

function classify(
  variant: SkillVariant | null,
  hasPostHog: boolean,
): { instrumentable: boolean; reason?: string } {
  if (variant == null) {
    return {
      instrumentable: false,
      reason: "Source-map upload isn't supported for this stack yet",
    };
  }
  if (!hasPostHog) {
    return {
      instrumentable: false,
      reason: 'No PostHog SDK installed yet — run `npx @posthog/wizard` first',
    };
  }
  return { instrumentable: true };
}

/** Map a generic detection report into source-maps projects. */
function toSourceMapsReport(report: AgenticDetectionReport): DetectionReport {
  return {
    repoType: report.repoType,
    projects: report.projects.map((p) => {
      const variant = (p.targetId as SkillVariant | null) ?? null;
      return {
        path: p.path,
        framework: p.framework,
        variant,
        hasPostHog: p.hasPostHog,
        ...classify(variant, p.hasPostHog),
      };
    }),
  };
}

/**
 * Validate the agent's raw JSON into a source-maps detection report. Exported
 * for testing — clamps variants to the automatable set and classifies
 * instrumentability.
 */
export function coerceReport(parsed: unknown): DetectionReport {
  return toSourceMapsReport(
    coerceAgenticReport(parsed, AUTOMATABLE_VARIANTS as readonly string[]),
  );
}

/** Run the Haiku detector over the repo and classify projects for source maps. */
export async function detectSourceMapsProjects(
  session: WizardSession,
  onEvent?: DetectEvent,
): Promise<DetectionReport> {
  const report = await detectProjectsWithAgent(session, {
    targets: SOURCE_MAPS_TARGETS,
    purpose: 'set up PostHog Error Tracking source-map upload',
    onEvent,
  });
  return toSourceMapsReport(report);
}
