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
 * keeps the EARLIEST matching target. Unsupported native targets are included
 * as guards before iOS so React Native, Flutter, and Android projects with
 * nested Xcode manifests are not misclassified as instrumentable iOS apps.
 * JS ordering mirrors `pickJsVariant` in detect.ts: opinionated frameworks →
 * bundlers → bare React → Node → generic web.
 */
const NON_AUTOMATABLE_NATIVE_VARIANTS: readonly SkillVariant[] = [
  'react-native',
  'flutter',
  'android',
];

const VARIANT_PRECEDENCE: readonly SkillVariant[] = [
  ...NON_AUTOMATABLE_NATIVE_VARIANTS,
  'ios',
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
 * Source-map detection targets, ordered by VARIANT_PRECEDENCE. Unsupported
 * native variants remain in the target list so the detector can identify and
 * block them instead of falling through to iOS or a JS target.
 */
export const SOURCE_MAPS_TARGETS: DetectTarget[] = [
  ...NON_AUTOMATABLE_NATIVE_VARIANTS,
  ...AUTOMATABLE_VARIANTS,
]
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

function isAutomatableVariant(value: string | null): value is SkillVariant {
  return value !== null && AUTOMATABLE_VARIANTS.includes(value as SkillVariant);
}

/** Map a generic detection report into source-maps projects. */
function toSourceMapsReport(report: AgenticDetectionReport): DetectionReport {
  return {
    repoType: report.repoType,
    projects: report.projects.map((p) => {
      const variant =
        isAutomatableVariant(p.targetId) &&
        !/\b(?:react[\s-]*native|expo|flutter|android)\b/i.test(p.framework)
          ? p.targetId
          : null;
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
 * for testing — recognises detection-only native targets, then clamps them to
 * non-instrumentable projects.
 */
export function coerceReport(parsed: unknown): DetectionReport {
  return toSourceMapsReport(
    coerceAgenticReport(
      parsed,
      SOURCE_MAPS_TARGETS.map((target) => target.id),
    ),
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
