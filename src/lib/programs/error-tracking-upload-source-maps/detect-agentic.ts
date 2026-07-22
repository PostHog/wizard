/**
 * Source-maps adapter over the generic agentic detector
 * (`@lib/detection/agentic`). The detector itself is product-knowledge-free;
 * this file supplies the source-maps targets (the automatable skill variants),
 * maps the result back to variants, and classifies each project as
 * instrumentable or not. The screen renders the result and the run step
 * instruments the chosen project.
 */

import { existsSync } from 'fs';
import { join } from 'path';
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
 * keeps the EARLIEST matching target. React Native and Flutter both outrank
 * Android and iOS: their repos carry `android/` and `ios/` folders with real
 * Gradle and Xcode manifests inside them, and must not be misclassified as
 * plain native apps. JS ordering mirrors `pickJsVariant` in detect.ts:
 * opinionated frameworks → bundlers → bare React → Node → generic web.
 */
const VARIANT_PRECEDENCE: readonly SkillVariant[] = [
  'react-native',
  'flutter',
  'android',
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

/** Source-map detection targets, ordered by VARIANT_PRECEDENCE. */
export const SOURCE_MAPS_TARGETS: DetectTarget[] = [...AUTOMATABLE_VARIANTS]
  .sort((a, b) => precedenceRank(a) - precedenceRank(b))
  .map((v) => ({ id: v, name: VARIANT_DISPLAY_NAME[v] }));

function isAutomatableVariant(value: string | null): value is SkillVariant {
  return value !== null && AUTOMATABLE_VARIANTS.includes(value as SkillVariant);
}

export const FLUTTER_NO_BUILD_TARGET_REASON =
  'Flutter project has no web, android or ios target — nothing to upload symbols for';

/**
 * True when the Flutter project at `projectPath` has at least one platform
 * target the wizard can wire uploads into: web (dart2js source maps), android
 * (R8 mapping files) or ios (dSYMs). `flutter create` scaffolds a directory per
 * enabled platform, so their absence means this is a pure Dart package or
 * plugin — it produces no app build, and there is nothing to upload.
 */
function projectHasBuildTarget(
  installDir: string,
  projectPath: string,
): boolean {
  const root = join(installDir, projectPath);
  return (
    existsSync(join(root, 'web', 'index.html')) ||
    existsSync(join(root, 'android')) ||
    existsSync(join(root, 'ios'))
  );
}

/** Classify one agent-detected project for source-map upload. */
function classifyProject(
  p: AgenticDetectionReport['projects'][number],
  hasBuildTarget: (path: string) => boolean,
): DetectedProject {
  const base = {
    path: p.path,
    framework: p.framework,
    hasPostHog: p.hasPostHog,
  };

  // A React Native or Flutter labelled project only counts when it resolved to
  // its own target — the nested Gradle and Xcode manifests inside those repos
  // must not claim android or ios.
  const namesForeignNativePlatform =
    (/\b(?:react[\s-]*native|expo)\b/i.test(p.framework) &&
      p.targetId !== 'react-native') ||
    (/\bflutter\b/i.test(p.framework) && p.targetId !== 'flutter');
  if (!isAutomatableVariant(p.targetId) || namesForeignNativePlatform) {
    return {
      ...base,
      variant: null,
      instrumentable: false,
      reason: "Source-map upload isn't supported for this stack yet",
    };
  }

  // A Flutter package or plugin has no platform directories and never produces
  // an app build, so there are no symbols to upload for it.
  if (p.targetId === 'flutter' && !hasBuildTarget(p.path)) {
    return {
      ...base,
      variant: null,
      instrumentable: false,
      reason: FLUTTER_NO_BUILD_TARGET_REASON,
    };
  }

  if (!p.hasPostHog) {
    return {
      ...base,
      variant: p.targetId,
      instrumentable: false,
      reason: 'No PostHog SDK installed yet — run `npx @posthog/wizard` first',
    };
  }

  return { ...base, variant: p.targetId, instrumentable: true };
}

/** Map a generic detection report into source-maps projects. */
function toSourceMapsReport(
  report: AgenticDetectionReport,
  hasBuildTarget: (path: string) => boolean,
): DetectionReport {
  return {
    repoType: report.repoType,
    projects: report.projects.map((p) => classifyProject(p, hasBuildTarget)),
  };
}

/**
 * Validate the agent's raw JSON into a source-maps detection report. Exported
 * for testing — clamps projects the wizard cannot wire up to
 * non-instrumentable. Without a `hasBuildTarget` predicate every Flutter
 * project is treated as target-less (blocked).
 */
export function coerceReport(
  parsed: unknown,
  hasBuildTarget: (path: string) => boolean = () => false,
): DetectionReport {
  return toSourceMapsReport(
    coerceAgenticReport(
      parsed,
      SOURCE_MAPS_TARGETS.map((target) => target.id),
    ),
    hasBuildTarget,
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
  return toSourceMapsReport(report, (path) =>
    projectHasBuildTarget(session.installDir, path),
  );
}
