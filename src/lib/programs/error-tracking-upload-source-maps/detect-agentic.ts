/**
 * Source-maps adapter over the generic agentic detector
 * (`@lib/detection/agentic`). The detector itself is product-knowledge-free;
 * this file supplies the source-maps targets (the automatable skill variants),
 * maps the result back to variants, and classifies each project as
 * instrumentable or not. The screen renders the result and the run step
 * instruments the chosen project.
 */

import { readFileSync } from 'fs';
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
  MANUAL_SDK_VARIANTS,
  RUST_SDK_CRATE,
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
 * as guards before Android and iOS so React Native and Flutter projects with
 * nested Gradle or Xcode manifests are not misclassified as instrumentable
 * native apps. JS ordering mirrors `pickJsVariant` in detect.ts: opinionated
 * frameworks → bundlers → bare React → Node → generic web.
 */
const NON_AUTOMATABLE_NATIVE_VARIANTS: readonly SkillVariant[] = [
  'react-native',
  'flutter',
];

/**
 * Variants the detector recognises so the picker can name and block them,
 * without a shipped skill behind them yet. Unlike the guards above they rank
 * LOW — a go.mod signal must not shadow a real JS/native target in the same
 * directory, it only needs to beat the generic web fallback.
 */
const DETECTION_ONLY_VARIANTS: readonly SkillVariant[] = ['go'];

const VARIANT_PRECEDENCE: readonly SkillVariant[] = [
  ...NON_AUTOMATABLE_NATIVE_VARIANTS,
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
  // Native binaries: only chosen when no JS target matches the project, but
  // ahead of the generic web fallback so a go.mod / Cargo.toml project
  // resolves to its debug-symbols variant instead of `web`. Deliberate
  // tradeoff for the same-directory mixed case: a Go/Rust project with a
  // tooling-only package.json (common) beats a root-level JS app sharing a
  // directory with go.mod / Cargo.toml (rare — frontends usually live in a
  // subdirectory, which classifies as its own project).
  'go',
  'rust',
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
  ...DETECTION_ONLY_VARIANTS,
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
    // The wizard's default flow can't install the Rust SDK, so don't point
    // users at it for that stack.
    const install = MANUAL_SDK_VARIANTS.includes(variant)
      ? 'add the posthog-rs crate first'
      : 'run `npx @posthog/wizard` first';
    return {
      instrumentable: false,
      reason: `No PostHog SDK installed yet — ${install}`,
    };
  }
  return { instrumentable: true };
}

/**
 * Checks a project's own Cargo.toml for the Rust SDK. The agentic detector
 * reports a single `hasPostHog` boolean for ANY PostHog dependency in the
 * project — for `rust` that could be satisfied by an unrelated JS SDK in the
 * same directory, so the deterministic manifest read is authoritative.
 * Exported for testing.
 */
export function rustSdkVerifier(
  installDir: string,
): (projectPath: string) => boolean {
  return (projectPath) => {
    const dir =
      projectPath === '.' ? installDir : join(installDir, projectPath);
    try {
      return readFileSync(join(dir, 'Cargo.toml'), 'utf-8').includes(
        RUST_SDK_CRATE,
      );
    } catch {
      return false;
    }
  };
}

function isAutomatableVariant(value: string | null): value is SkillVariant {
  return value !== null && AUTOMATABLE_VARIANTS.includes(value as SkillVariant);
}

/** Map a generic detection report into source-maps projects. */
function toSourceMapsReport(
  report: AgenticDetectionReport,
  verifyRustSdk?: (projectPath: string) => boolean,
): DetectionReport {
  return {
    repoType: report.repoType,
    projects: report.projects.map((p) => {
      const variant =
        isAutomatableVariant(p.targetId) &&
        !/\b(?:react[\s-]*native|expo|flutter)\b/i.test(p.framework)
          ? p.targetId
          : null;
      const hasPostHog =
        variant === 'rust' && verifyRustSdk
          ? verifyRustSdk(p.path)
          : p.hasPostHog;
      return {
        path: p.path,
        framework: p.framework,
        variant,
        hasPostHog,
        ...classify(variant, hasPostHog),
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
  return toSourceMapsReport(report, rustSdkVerifier(session.installDir));
}
