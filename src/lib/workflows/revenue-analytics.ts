/**
 * Revenue analytics workflow.
 *
 * The detect step checks for PostHog + Stripe SDKs. The skill install
 * and agent run live in the bootstrap runner (see skill-runner.ts).
 */

import type { Workflow } from '../workflow-step.js';
import type { WizardSession } from '../wizard-session.js';
import { RunPhase } from '../wizard-session.js';
import type { Dirent } from 'fs';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, relative } from 'path';
import { IGNORED_DIRS } from '../../utils/file-utils.js';

export const POSTHOG_SDKS = [
  'posthog-js',
  'posthog-node',
  'posthog-react-native',
  'posthog-android',
  'posthog-ios',
];

export const STRIPE_SDKS = [
  'stripe',
  '@stripe/stripe-js',
  '@stripe/react-stripe-js',
];

interface PackageMatch {
  /** Path to the package.json relative to installDir */
  path: string;
  posthogSdks: string[];
  stripeSdks: string[];
}

/**
 * Structured detection errors. The screen renders each kind into JSX
 * with proper formatting — keeps error data separate from presentation.
 */
export type RevenueDetectError =
  | {
      kind: 'bad-directory';
      path: string;
      reason: 'missing' | 'not-dir' | 'unreadable';
    }
  | { kind: 'no-package-json' }
  | { kind: 'no-sdks'; scannedCount: number }
  | { kind: 'missing-posthog'; foundStripe: string[] }
  | { kind: 'missing-stripe'; foundPosthog: string[] };

/**
 * Recursively find all package.json files under installDir (max depth 3),
 * skipping common ignored directories. Returns matches with detected SDKs.
 */
function findPackageJsons(installDir: string, maxDepth = 3): PackageMatch[] {
  const matches: PackageMatch[] = [];

  function scan(dir: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isFile() && entry.name === 'package.json') {
        try {
          const pkg = JSON.parse(readFileSync(fullPath, 'utf-8')) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
          };
          const depNames = [
            ...Object.keys(pkg.dependencies ?? {}),
            ...Object.keys(pkg.devDependencies ?? {}),
          ];
          const posthogSdks = depNames.filter((d) => POSTHOG_SDKS.includes(d));
          const stripeSdks = depNames.filter((d) => STRIPE_SDKS.includes(d));
          matches.push({
            path: relative(installDir, fullPath) || 'package.json',
            posthogSdks,
            stripeSdks,
          });
        } catch {
          // Skip malformed package.json
        }
      } else if (entry.isDirectory()) {
        scan(fullPath, depth + 1);
      }
    }
  }

  scan(installDir, 0);
  return matches;
}

/**
 * Scan `session.installDir` for PostHog + Stripe SDKs. Writes detection
 * results into frameworkContext via the callback — either the detected
 * SDK lists (for the intro screen) or a `RevenueDetectError` on failure.
 *
 * The skill install happens later in the bootstrap runner, not here.
 */
export function detectRevenuePrerequisites(
  session: WizardSession,
  setFrameworkContext: (key: string, value: unknown) => void,
): void {
  const fail = (error: RevenueDetectError) =>
    setFrameworkContext('detectError', error);

  const installDir = session.installDir;

  // Verify the install directory exists and is readable
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

  // Find all package.json files (root + monorepo subpackages)
  const matches = findPackageJsons(installDir);

  if (matches.length === 0) {
    fail({ kind: 'no-package-json' });
    return;
  }

  // Aggregate detected SDKs across all package.json files
  const allPosthogSdks = new Set<string>();
  const allStripeSdks = new Set<string>();
  for (const match of matches) {
    for (const sdk of match.posthogSdks) allPosthogSdks.add(sdk);
    for (const sdk of match.stripeSdks) allStripeSdks.add(sdk);
  }

  const detectedPosthogSdks = [...allPosthogSdks];
  const detectedStripeSdks = [...allStripeSdks];

  if (detectedPosthogSdks.length === 0 && detectedStripeSdks.length === 0) {
    fail({ kind: 'no-sdks', scannedCount: matches.length });
    return;
  }

  if (detectedPosthogSdks.length === 0) {
    fail({ kind: 'missing-posthog', foundStripe: detectedStripeSdks });
    return;
  }

  if (detectedStripeSdks.length === 0) {
    fail({ kind: 'missing-stripe', foundPosthog: detectedPosthogSdks });
    return;
  }

  setFrameworkContext('detectedPosthogSdks', detectedPosthogSdks);
  setFrameworkContext('detectedStripeSdks', detectedStripeSdks);
  setFrameworkContext(
    'detectedPackagePaths',
    matches
      .filter((m) => m.posthogSdks.length > 0 || m.stripeSdks.length > 0)
      .map((m) => m.path),
  );
}

export const REVENUE_ANALYTICS_WORKFLOW: Workflow = [
  {
    id: 'detect',
    label: 'Detecting prerequisites',
    // Headless step: no screen, no gate. onReady fires after bin.ts
    // assigns the session — the hook scans for PostHog + Stripe SDKs
    // and writes the results (or a detectError) to frameworkContext
    // for the intro screen to render.
    onReady: (ctx) =>
      detectRevenuePrerequisites(ctx.session, ctx.setFrameworkContext),
  },
  {
    id: 'intro',
    label: 'Welcome',
    screen: 'revenue-intro',
    gate: (session) => session.setupConfirmed,
  },
  {
    id: 'auth',
    label: 'Authentication',
    screen: 'auth',
    isComplete: (session) => session.credentials !== null,
  },
  {
    id: 'run',
    label: 'Revenue analytics',
    screen: 'run',
    isComplete: (session) =>
      session.runPhase === RunPhase.Completed ||
      session.runPhase === RunPhase.Error,
  },
  {
    id: 'outro',
    label: 'Done',
    screen: 'outro',
    isComplete: (session) => session.outroDismissed,
  },
];
