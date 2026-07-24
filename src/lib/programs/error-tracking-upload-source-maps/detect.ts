/**
 * Source maps upload prerequisite detection.
 *
 * Scans the project for signals that identify the platform and build system,
 * then maps to one of the context-mill `error-tracking-upload-source-maps-*`
 * skill variants. Results are written to frameworkContext for the intro
 * screen to render and for the agent prompt to consume.
 */

import type { Dirent } from 'fs';
import { readdirSync, existsSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  IGNORED_DIRS,
  MAX_DIR_ENTRIES,
  MAX_WALK_FILES,
  safeReadFile,
} from '@utils/file-utils';
import type { WizardSession } from '@lib/wizard-session';
import type { AbortCase } from '@lib/agent/agent-runner';

/**
 * Skill variants published under the `error-tracking-upload-source-maps`
 * category in context-mill. The agent loads
 * `error-tracking-upload-source-maps-<variant>`.
 */
export type SkillVariant =
  | 'web'
  | 'nextjs'
  | 'node'
  | 'react'
  | 'angular'
  | 'nuxt'
  | 'react-native'
  | 'android'
  | 'flutter'
  | 'ios'
  | 'vite'
  | 'webpack'
  | 'rollup';

const DISPLAY_NAME: Record<SkillVariant, string> = {
  web: 'Web (JavaScript)',
  nextjs: 'Next.js',
  node: 'Node.js',
  react: 'React',
  angular: 'Angular',
  nuxt: 'Nuxt',
  'react-native': 'React Native',
  android: 'Android',
  flutter: 'Flutter',
  ios: 'iOS',
  vite: 'Vite',
  webpack: 'Webpack',
  rollup: 'Rollup',
};

/**
 * Variants the wizard can wire up source-map upload for automatically. The
 * native variants (react-native, flutter) are recognised but not yet
 * automatable, so the agentic picker treats them as non-instrumentable.
 */
export const AUTOMATABLE_VARIANTS: readonly SkillVariant[] = [
  'android',
  'ios',
  'web',
  'nextjs',
  'node',
  'react',
  'angular',
  'nuxt',
  'vite',
  'webpack',
  'rollup',
];

/**
 * Variants the wizard pre-installs a machine-global `posthog-cli` for — their
 * build shells out to it with no npx / local-dep fallback. JS variants stay out.
 */
export const VARIANTS_REQUIRING_POSTHOG_CLI: ReadonlySet<SkillVariant> =
  new Set(['ios', 'android']);

const POSTHOG_SDKS = new Set([
  'posthog-js',
  'posthog-node',
  'posthog-react-native',
  'posthog-android',
  'posthog-ios',
]);

const GRADLE_FILES = new Set([
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
]);

/**
 * Structured detection errors. The screen renders each kind into JSX
 * with proper formatting — keeps error data separate from presentation.
 */
export type SourceMapsDetectError =
  | {
      kind: 'bad-directory';
      path: string;
      reason: 'missing' | 'not-dir' | 'unreadable';
    }
  | { kind: 'no-project-files' }
  | { kind: 'unsupported-platform'; detected: string }
  | { kind: 'no-posthog-sdk'; platform: SkillVariant };

/** `[ABORT] <reason>` cases the source maps skill can emit. */
export const SOURCE_MAPS_ABORT_CASES: AbortCase[] = [
  {
    match: /^no posthog sdk detected$/i,
    message: 'No PostHog SDK detected',
    body:
      'The agent could not find a PostHog SDK in your project. ' +
      'Source map upload requires the SDK to already be installed so it can ' +
      'report errors. Run `npx @posthog/wizard` first to install the SDK.',
    docsUrl: 'https://posthog.com/docs/error-tracking',
  },
  {
    match: /^build command not found$/i,
    message: 'Build command not found',
    body:
      'The agent could not identify how to build your project. Source map ' +
      'upload runs as part of the production build. Add a build script to ' +
      'your project and run this wizard again.',
    docsUrl: 'https://posthog.com/docs/error-tracking/upload-source-maps',
  },
];

// ── File / dependency probes ─────────────────────────────────────────

interface ProjectSignals {
  packageJsons: Array<{ path: string; deps: Set<string> }>;
  hasXcodeProject: boolean;
  hasPodfile: boolean;
  hasSwiftPackage: boolean;
  hasGradle: boolean;
  hasPubspec: boolean;
  scannedFileCount: number;
}

function collectSignals(installDir: string, maxDepth = 3): ProjectSignals {
  const signals: ProjectSignals = {
    packageJsons: [],
    hasXcodeProject: false,
    hasPodfile: false,
    hasSwiftPackage: false,
    hasGradle: false,
    hasPubspec: false,
    scannedFileCount: 0,
  };

  // Explicit stack — no call-stack recursion.
  const stack: Array<{ dir: string; depth: number }> = [
    { dir: installDir, depth: 0 },
  ];

  while (stack.length > 0 && signals.scannedFileCount < MAX_WALK_FILES) {
    const { dir, depth } = stack.pop()!;

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    // A directory contributes at most MAX_DIR_ENTRIES entries.
    if (entries.length > MAX_DIR_ENTRIES) entries.length = MAX_DIR_ENTRIES;

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isFile()) {
        signals.scannedFileCount += 1;
        if (entry.name === 'package.json') {
          const content = safeReadFile(fullPath);
          if (content === null) continue;
          try {
            const pkg = JSON.parse(content) as {
              dependencies?: Record<string, string>;
              devDependencies?: Record<string, string>;
            };
            const deps = new Set([
              ...Object.keys(pkg.dependencies ?? {}),
              ...Object.keys(pkg.devDependencies ?? {}),
            ]);
            signals.packageJsons.push({
              path: relative(installDir, fullPath) || 'package.json',
              deps,
            });
          } catch {
            // skip malformed package.json
          }
        } else if (entry.name === 'Podfile') {
          signals.hasPodfile = true;
        } else if (entry.name === 'Package.swift') {
          signals.hasSwiftPackage = true;
        } else if (entry.name === 'pubspec.yaml') {
          signals.hasPubspec = true;
        } else if (GRADLE_FILES.has(entry.name)) {
          signals.hasGradle = true;
        }
      } else if (entry.isDirectory()) {
        if (entry.name.endsWith('.xcodeproj')) {
          signals.hasXcodeProject = true;
        } else if (depth < maxDepth) {
          stack.push({ dir: fullPath, depth: depth + 1 });
        }
      }
    }
  }

  return signals;
}

// ── Skill selection ──────────────────────────────────────────────────

function pickJsVariant(deps: Set<string>): SkillVariant {
  // Opinionated full-stack frameworks first — they own their build pipeline
  // and have dedicated skill variants, so bundler detection underneath
  // them is irrelevant.
  if (deps.has('react-native')) return 'react-native';
  if (deps.has('nuxt')) return 'nuxt';
  if (deps.has('next')) return 'nextjs';
  if (deps.has('@angular/core')) return 'angular';
  // Bundlers next — prefer these over the bare `react` variant because
  // their skills are simpler (one bundler-plugin config) than wiring
  // posthog-cli into an arbitrary React setup.
  if (deps.has('vite')) return 'vite';
  if (deps.has('webpack')) return 'webpack';
  if (deps.has('rollup')) return 'rollup';
  // Plain React with no recognised bundler.
  if (deps.has('react')) return 'react';
  // Server-only Node project
  if (deps.has('posthog-node')) return 'node';
  // Fallback: generic web
  return 'web';
}

function selectVariant(signals: ProjectSignals): SkillVariant | null {
  // Mobile / native first — they don't coexist with JS bundlers in the
  // detection signals we look at.
  if (signals.hasPubspec) return 'flutter';
  if (signals.hasXcodeProject || signals.hasPodfile || signals.hasSwiftPackage)
    return 'ios';
  if (signals.hasGradle) return 'android';

  if (signals.packageJsons.length > 0) {
    // Union all deps across package.json files (covers monorepos)
    const allDeps = new Set<string>();
    for (const pkg of signals.packageJsons) {
      for (const dep of pkg.deps) allDeps.add(dep);
    }
    return pickJsVariant(allDeps);
  }

  return null;
}

function hasPostHogSdk(signals: ProjectSignals): boolean {
  for (const pkg of signals.packageJsons) {
    for (const sdk of POSTHOG_SDKS) {
      if (pkg.deps.has(sdk)) return true;
    }
  }
  // For native platforms the PostHog SDK lives outside package.json and
  // is detected by the agent during the skill run. Assume present here.
  return (
    signals.hasXcodeProject ||
    signals.hasPodfile ||
    signals.hasSwiftPackage ||
    signals.hasGradle ||
    signals.hasPubspec
  );
}

// ── Entry point ──────────────────────────────────────────────────────

export const SOURCE_MAPS_CONTEXT_KEYS = {
  skillVariant: 'sourceMapsSkillVariant',
  displayName: 'sourceMapsDisplayName',
  packagePaths: 'sourceMapsPackagePaths',
  detectError: 'detectError',
  // Set by the agentic picker once the user chooses a project to instrument.
  selectedVariant: 'sourceMapsSelectedVariant',
  selectedDisplayName: 'sourceMapsSelectedDisplayName',
  selectedPath: 'sourceMapsSelectedPath',
} as const;

/**
 * Scan `session.installDir` for platform / build-system signals. Writes
 * detection results into frameworkContext via the callback — either the
 * picked skill variant + display name, or a `SourceMapsDetectError`.
 *
 * The skill install happens later in the agent run, not here. This step
 * only picks which variant the prompt should ask the agent to load.
 */
export function detectSourceMapsPrerequisites(
  session: WizardSession,
  setFrameworkContext: (key: string, value: unknown) => void,
): void {
  const fail = (error: SourceMapsDetectError) =>
    setFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.detectError, error);

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

  const signals = collectSignals(installDir);
  const variant = selectVariant(signals);

  // The legacy filesystem detector does not automate native platforms. The
  // live source-map picker uses detectSourceMapsProjects instead.
  if (
    variant &&
    ['react-native', 'flutter', 'ios', 'android'].includes(variant)
  ) {
    fail({ kind: 'unsupported-platform', detected: variant });
    return;
  }

  if (!variant) {
    if (signals.scannedFileCount === 0) {
      fail({ kind: 'no-project-files' });
    } else {
      fail({ kind: 'unsupported-platform', detected: 'unknown' });
    }
    return;
  }

  if (!hasPostHogSdk(signals)) {
    fail({ kind: 'no-posthog-sdk', platform: variant });
    return;
  }

  setFrameworkContext(SOURCE_MAPS_CONTEXT_KEYS.skillVariant, variant);
  setFrameworkContext(
    SOURCE_MAPS_CONTEXT_KEYS.displayName,
    DISPLAY_NAME[variant],
  );
  setFrameworkContext(
    SOURCE_MAPS_CONTEXT_KEYS.packagePaths,
    signals.packageJsons.map((p) => p.path),
  );
}

export { DISPLAY_NAME as VARIANT_DISPLAY_NAME };
