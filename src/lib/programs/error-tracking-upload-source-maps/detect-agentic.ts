/**
 * Source-maps adapter over the generic agentic detector
 * (`@lib/detection/agentic`). The detector itself is product-knowledge-free;
 * this file supplies the source-maps targets (the automatable skill variants),
 * maps the result back to variants, and classifies each project as
 * instrumentable or not. The screen renders the result and the run step
 * instruments the chosen project.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { IGNORED_DIRS } from '@utils/bounded-fs';
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
  MANUAL_SDK_INSTALL,
  RUST_SDK_CRATE,
  GO_SDK_MODULE,
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

/** Source-map detection targets, ordered by VARIANT_PRECEDENCE. */
export const SOURCE_MAPS_TARGETS: DetectTarget[] = [...AUTOMATABLE_VARIANTS]
  .sort((a, b) => precedenceRank(a) - precedenceRank(b))
  .map((v) => ({ id: v, name: VARIANT_DISPLAY_NAME[v] }));

/** Comment-stripped substring check for the Rust SDK in one manifest. */
function manifestMentionsSdk(manifestPath: string): boolean {
  try {
    return readFileSync(manifestPath, 'utf-8')
      .split('\n')
      .some((line) => {
        const code = line.split('#', 1)[0];
        return code.includes(RUST_SDK_CRATE);
      });
  } catch {
    return false;
  }
}

/**
 * A workspace root is often a virtual manifest (`[workspace]` only, no
 * `[dependencies]`) — the SDK then lives in a member crate's manifest, so a
 * miss on the root must fall through to a bounded walk over nested
 * manifests. Depth 3 covers the common `crates/<name>/` layouts.
 */
function anyNestedManifestMentionsSdk(dir: string, depth: number): boolean {
  if (depth > 3) return false;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    if (IGNORED_DIRS.has(entry.name) || entry.name === 'target') continue;
    const child = join(dir, entry.name);
    if (manifestMentionsSdk(join(child, 'Cargo.toml'))) return true;
    if (anyNestedManifestMentionsSdk(child, depth + 1)) return true;
  }
  return false;
}

/**
 * Checks a project's Cargo manifests for the Rust SDK. The agentic detector
 * reports a single `hasPostHog` boolean for ANY PostHog dependency in the
 * project — for `rust` that could be satisfied by an unrelated JS SDK in the
 * same directory, so the deterministic manifest read is authoritative.
 * Comment-stripped substring matching, not TOML parsing: it still catches
 * renamed (`package = "posthog-rs"`) and workspace-inherited deps, while a
 * commented-out dependency no longer counts. Known miss: selecting a
 * workspace MEMBER whose dep is aliased at the workspace root
 * (`posthog.workspace = true` with the `package = "posthog-rs"` mapping only
 * in the root manifest, which sits above the member) — accepted; resolving
 * that needs full workspace metadata. Exported for testing.
 */
export function rustSdkVerifier(
  installDir: string,
): (projectPath: string) => boolean {
  return (projectPath) => {
    const dir =
      projectPath === '.' ? installDir : join(installDir, projectPath);
    return (
      manifestMentionsSdk(join(dir, 'Cargo.toml')) ||
      anyNestedManifestMentionsSdk(dir, 0)
    );
  };
}

/**
 * Checks a project's go.mod for the Go SDK — the same authoritative override
 * as `rustSdkVerifier`, for the same reason. Comment-stripped (`//`)
 * substring matching; no multi-module walk — unlike Cargo workspaces, a Go
 * module's requirements always live in the selected module's own go.mod.
 * Exported for testing.
 */
export function goSdkVerifier(
  installDir: string,
): (projectPath: string) => boolean {
  return (projectPath) => {
    const dir =
      projectPath === '.' ? installDir : join(installDir, projectPath);
    try {
      return readFileSync(join(dir, 'go.mod'), 'utf-8')
        .split('\n')
        .some((line) => {
          const code = line.split('//', 1)[0];
          return code.includes(GO_SDK_MODULE);
        });
    } catch {
      return false;
    }
  };
}

function isAutomatableVariant(value: string | null): value is SkillVariant {
  return value !== null && AUTOMATABLE_VARIANTS.includes(value as SkillVariant);
}

export const FLUTTER_NO_BUILD_TARGET_REASON =
  'Flutter project has no web, android or ios target — nothing to upload symbols for';

export const BARE_REACT_NATIVE_REASON =
  'Bare React Native (without Expo) is not supported — source-map upload needs the Expo build pipeline';

/**
 * Filesystem probes the classifier needs on top of what the agent reports.
 * Injected so `coerceReport` stays testable without touching disk. A missing
 * probe answers `false`, which blocks the variant it guards.
 */
export type ProjectProbes = {
  /**
   * Flutter: does the project have at least one platform target the wizard can
   * wire uploads into — web (dart2js source maps), android (R8 mapping files)
   * or ios (dSYMs)?
   */
  hasBuildTarget: (path: string) => boolean;
  /** React Native: is the `expo` package installed in the project? */
  isExpoProject: (path: string) => boolean;
  /**
   * Rust: does the project's Cargo manifest tree carry the posthog-rs crate?
   * Unlike the gate probes above, absence means "trust the agent's
   * `hasPostHog`", not `false` — the probe REPLACES the agent's boolean when
   * present, because any unrelated PostHog dependency can satisfy it.
   */
  verifyRustSdk?: (path: string) => boolean;
  /** Go: does the project's go.mod require posthog-go? Same semantics as `verifyRustSdk`. */
  verifyGoSdk?: (path: string) => boolean;
};

const NO_PROBES: ProjectProbes = {
  hasBuildTarget: () => false,
  isExpoProject: () => false,
};

/**
 * True when the Flutter project at `projectPath` has at least one platform
 * target. `flutter create` scaffolds a directory per enabled platform, so their
 * absence means this is a pure Dart package or plugin — it produces no app
 * build, and there is nothing to upload.
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

/** True when the project at `projectPath` has the `expo` package installed. */
function projectHasExpo(installDir: string, projectPath: string): boolean {
  try {
    const pkg = JSON.parse(
      readFileSync(join(installDir, projectPath, 'package.json'), 'utf-8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return (
      pkg.dependencies?.['expo'] != null ||
      pkg.devDependencies?.['expo'] != null
    );
  } catch {
    return false;
  }
}

/** Classify one agent-detected project for source-map upload. */
function classifyProject(
  p: AgenticDetectionReport['projects'][number],
  probes: ProjectProbes,
): DetectedProject {
  // For the native-binary variants the deterministic manifest read overrides
  // the agent's single hasPostHog boolean, which any unrelated PostHog
  // dependency can satisfy.
  const sdkVerifier =
    p.targetId === 'rust'
      ? probes.verifyRustSdk
      : p.targetId === 'go'
      ? probes.verifyGoSdk
      : undefined;
  const hasPostHog = sdkVerifier ? sdkVerifier(p.path) : p.hasPostHog;
  const base = {
    path: p.path,
    framework: p.framework,
    hasPostHog,
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
  if (p.targetId === 'flutter' && !probes.hasBuildTarget(p.path)) {
    return {
      ...base,
      variant: null,
      instrumentable: false,
      reason: FLUTTER_NO_BUILD_TARGET_REASON,
    };
  }

  // Bare React Native (no expo package) is not supported: its Metro pipeline
  // can't inject chunk IDs, so uploads would never resolve.
  if (p.targetId === 'react-native' && !probes.isExpoProject(p.path)) {
    return {
      ...base,
      variant: null,
      instrumentable: false,
      reason: BARE_REACT_NATIVE_REASON,
    };
  }

  if (!hasPostHog) {
    // The wizard's default flow can't install the Go/Rust SDKs, so don't
    // point users at it for those stacks.
    const install =
      MANUAL_SDK_INSTALL[p.targetId] ?? 'run `npx @posthog/wizard` first';
    return {
      ...base,
      variant: p.targetId,
      instrumentable: false,
      reason: `No PostHog SDK installed yet — ${install}`,
    };
  }

  return { ...base, variant: p.targetId, instrumentable: true };
}

/** Map a generic detection report into source-maps projects. */
function toSourceMapsReport(
  report: AgenticDetectionReport,
  probes: ProjectProbes,
): DetectionReport {
  return {
    repoType: report.repoType,
    projects: report.projects.map((p) => classifyProject(p, probes)),
  };
}

/**
 * Validate the agent's raw JSON into a source-maps detection report. Exported
 * for testing — clamps projects the wizard cannot wire up to
 * non-instrumentable. Probes left out of `probes` answer `false`, so every
 * Flutter project is treated as target-less and every React Native project as
 * bare (both blocked).
 */
export function coerceReport(
  parsed: unknown,
  probes: Partial<ProjectProbes> = {},
): DetectionReport {
  return toSourceMapsReport(
    coerceAgenticReport(
      parsed,
      SOURCE_MAPS_TARGETS.map((target) => target.id),
    ),
    { ...NO_PROBES, ...probes },
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
  return toSourceMapsReport(report, {
    hasBuildTarget: (path) => projectHasBuildTarget(session.installDir, path),
    isExpoProject: (path) => projectHasExpo(session.installDir, path),
    verifyRustSdk: rustSdkVerifier(session.installDir),
    verifyGoSdk: goSdkVerifier(session.installDir),
  });
}
