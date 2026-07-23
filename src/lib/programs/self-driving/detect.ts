/**
 * Self-driving prerequisite detection + abort vocabulary.
 *
 * The only thing worth verifying before auth is local and cheap: that
 * `session.installDir` is a real, readable directory. We deliberately do
 * NOT require the base posthog-integration report to be present — it is a
 * report many users never commit, and `requires: ['posthog-integration']`
 * is metadata, not a hard runtime gate.
 *
 * Self-driving is now in OPEN beta — available to every team — so STEP 1
 * no longer probes the Signals API as an access gate; it completes
 * instantly so the run opens with a fast first checkmark. The
 * `self-driving is not available for this project` abort below is kept
 * only as a safety net: if the Signals API genuinely can't be reached
 * during the run (a hard error that is unexpected in open beta), the skill
 * emits it and the wizard renders a friendly "try again" screen — now with
 * open-beta wording, not the old closed, per-team "join the beta" copy. The
 * PostHog-side flags (`product-autonomy`, `signals-scout`) are unchanged by
 * the wizard-side "self-driving" rename.
 */

import {
  existsSync,
  statSync,
  readFileSync,
  readdirSync,
  type Dirent,
} from 'fs';
import { join } from 'path';
import type { WizardSession } from '@lib/wizard-session';
import type { AbortCase } from '@lib/agent/agent-runner';

/** frameworkContext key holding the deterministic PostHog-presence result. */
export const POSTHOG_PRESENT_KEY = 'postHogPresent';

/**
 * frameworkContext key holding the repo-relative path of the project the user
 * picked on the integration-detect screen ("." for the repo root). The
 * integrate-run phase scopes its install dir to this so a monorepo integrates
 * into the chosen sub-app, not the root.
 */
export const SELF_DRIVING_INTEGRATE_PATH_KEY = 'selfDrivingIntegratePath';

// Matches `posthog` at a dependency boundary (line start, or after "'/=:.@ or
// whitespace): catches `com.posthog:posthog-android` and `@posthog/ai`, skips
// substrings inside other words.
const POSTHOG_PACKAGE_RE = /(^|["'\s/=:.@])posthog/im;

// Manifests grepped for a posthog dependency. Distinct from PROJECT_MANIFESTS
// in @lib/detection/agentic (project-root discovery); keep the two in sync
// (a test asserts the shared ecosystem names appear in both). Exported for it.
export const POSTHOG_MANIFESTS = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'setup.py',
  'Gemfile',
  'go.mod',
  'composer.json',
  'pubspec.yaml',
  // Apple: SPM manifest, CocoaPods (+ lockfile), XcodeGen spec.
  'Package.swift',
  'Podfile',
  'Podfile.lock',
  'project.yml',
  // Android / JVM (libs.versions.toml holds gradle coordinates).
  'build.gradle',
  'build.gradle.kts',
  'gradle/libs.versions.toml',
  'pom.xml',
  // Elixir / Rust.
  'mix.exs',
  'Cargo.toml',
];

// Named sub-app dirs always checked (ios/android: RN/Flutter native shells).
// scanDirs unions these with a bounded depth-2 walk of the install dir.
const POSTHOG_DIRS = [
  '.',
  'app',
  'frontend',
  'backend',
  'ios',
  'android',
  'android/app',
];

// Heavy or vendored trees the shallow walk never descends into — they hold
// dependencies, not a project's own manifest, and would false-positive on a
// bundled posthog package.
const WALK_SKIP_DIRS = new Set([
  'node_modules',
  'Pods',
  'Carthage',
  'DerivedData',
  '.build',
  'build',
  'dist',
  'out',
  '.next',
  'coverage',
  'vendor',
  '.venv',
  'site-packages',
  'target',
  '.git',
]);

// How deep below the install dir the shallow walk goes. 2 covers the common
// monorepo shape (apps/<name>, packages/<name>) without a full tree walk.
const WALK_MAX_DEPTH = 2;

/**
 * The install dir plus every directory within WALK_MAX_DEPTH levels (skipping
 * heavy/vendored trees and dotdirs), unioned with the explicit POSTHOG_DIRS. A
 * full shallow walk on top of the named dirs, so a monorepo's nested apps
 * (e.g. `apps/mobile`) are seen without hardcoding the path.
 */
function scanDirs(installDir: string): string[] {
  const rels = new Set<string>(POSTHOG_DIRS);
  const walk = (rel: string, depth: number): void => {
    rels.add(rel);
    if (depth >= WALK_MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(join(installDir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.') || WALK_SKIP_DIRS.has(e.name)) continue;
      // .xcodeproj/.xcworkspace are inspected via projectFileHasPostHog at the
      // parent dir — descending into the wrapper finds nothing useful.
      if (e.name.endsWith('.xcodeproj') || e.name.endsWith('.xcworkspace')) {
        continue;
      }
      walk(rel === '.' ? e.name : `${rel}/${e.name}`, depth + 1);
    }
  };
  walk('.', 0);
  return [...rels];
}

/**
 * True if a `*.xcodeproj/project.pbxproj` or `*.csproj`/`*.fsproj` in
 * `dirPath` references PostHog.
 */
function projectFileHasPostHog(dirPath: string): boolean {
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return false;
  }
  for (const entry of entries) {
    const target = entry.endsWith('.xcodeproj')
      ? join(dirPath, entry, 'project.pbxproj')
      : entry.endsWith('.csproj') || entry.endsWith('.fsproj')
      ? join(dirPath, entry)
      : null;
    if (!target || !existsSync(target)) continue;
    try {
      if (POSTHOG_PACKAGE_RE.test(readFileSync(target, 'utf8'))) return true;
    } catch {
      /* unreadable — ignore */
    }
  }
  return false;
}

/**
 * Deterministic, offline check: does the project already have a PostHog SDK?
 * Scans the common dependency manifests at the install dir for a `posthog`
 * package — the same signal the agentic detector reports as `hasPostHog`, but
 * instant and credential-free. Drives whether self-driving asks to integrate
 * first ("not found") or proceeds straight to setup ("found").
 */
export function detectPostHogPresent(installDir: string): boolean {
  for (const dir of scanDirs(installDir)) {
    const dirPath = join(installDir, dir);
    for (const name of POSTHOG_MANIFESTS) {
      const path = join(dirPath, name);
      if (!existsSync(path)) continue;
      try {
        if (POSTHOG_PACKAGE_RE.test(readFileSync(path, 'utf8'))) return true;
      } catch {
        /* unreadable — ignore */
      }
    }
    // Variably-named project files (.xcodeproj, .csproj/.fsproj).
    if (projectFileHasPostHog(dirPath)) return true;
  }
  return false;
}

/**
 * Structured detection errors. The intro screen renders each kind into
 * JSX — keeps error data separate from presentation.
 */
export type SelfDrivingDetectError = {
  kind: 'bad-directory';
  path: string;
  reason: 'missing' | 'not-dir' | 'unreadable';
};

/**
 * `[ABORT] <reason>` cases the self-driving skill can emit. The
 * reason strings are part of the skill contract — the context-mill
 * `self-driving-setup` skill emits these exact strings.
 */
export const SELF_DRIVING_ABORT_CASES: AbortCase[] = [
  {
    // Skill emits: [ABORT] self-driving is not available for this project
    match: /^self-driving is not available for this project$/i,
    message: 'PostHog Self-driving is not available for this project',
    body:
      'Self-driving is in open beta and available to every team, so this ' +
      'is unexpected — the PostHog Signals API could not be reached for ' +
      'this project. Nothing was changed. Try again in a moment, and if it ' +
      'keeps happening reach out to wizard@posthog.com.',
  },
  {
    // Skill emits: [ABORT] github connection declined
    match: /^github connection declined$/i,
    message: 'GitHub connection required',
    body:
      'Self-driving needs GitHub access to research issues in your code and ' +
      'open fixes, so setup cannot finish without it. Nothing was left ' +
      'half-configured. When you are ready to install the PostHog GitHub ' +
      'App, run the wizard again.',
    // The user chose not to connect GitHub — an expected cancellation, not an
    // error. The friendly outro above already explains next steps; don't file
    // an error-tracking exception for it.
    expected: true,
  },
  {
    // Skill emits: [ABORT] requires-interactive-mode
    match: /^requires-interactive-mode$/i,
    message: 'Interactive terminal required',
    body:
      'Self-driving setup asks questions along the way (GitHub and ' +
      'issue trackers), so it needs an interactive terminal. Run ' +
      'the wizard outside CI / non-interactive mode.',
    // Running in a non-interactive environment is an expected precondition
    // failure, not an exception to triage.
    expected: true,
  },
  {
    // The wizard_ask tool's own error texts (non-interactive host, ask cap
    // reached) instruct the agent to emit this reason — cover it so those
    // paths render a friendly screen instead of the generic abort outro.
    match: /^requirements-incomplete$/i,
    message: 'Setup needs your input',
    body:
      'The wizard could not collect the answers this setup needs (the ' +
      'environment was non-interactive, or the question budget ran out). ' +
      'Nothing was left half-configured. Run the wizard again in an ' +
      'interactive terminal.',
    // Couldn't collect the required answers (non-interactive / budget) — a
    // benign, expected outcome rather than an error.
    expected: true,
  },
];

/**
 * Verify `session.installDir` is a readable directory. Writes a
 * `SelfDrivingDetectError` to frameworkContext on failure — the intro
 * screen renders it and blocks.
 */
export function detectSelfDrivingPrerequisites(
  session: WizardSession,
  setFrameworkContext: (key: string, value: unknown) => void,
): void {
  const fail = (error: SelfDrivingDetectError) =>
    setFrameworkContext('detectError', error);

  const installDir = session.installDir;

  if (!existsSync(installDir)) {
    fail({ kind: 'bad-directory', path: installDir, reason: 'missing' });
    return;
  }
  try {
    if (!statSync(installDir).isDirectory()) {
      fail({ kind: 'bad-directory', path: installDir, reason: 'not-dir' });
      return;
    }
  } catch {
    fail({ kind: 'bad-directory', path: installDir, reason: 'unreadable' });
    return;
  }

  // Deterministic PostHog-presence check — drives the integration-check
  // screen: found → skip straight to self-driving; not found → ask to set up
  // PostHog first.
  setFrameworkContext(POSTHOG_PRESENT_KEY, detectPostHogPresent(installDir));
}
