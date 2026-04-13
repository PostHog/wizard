/**
 * Revenue analytics workflow.
 *
 * Launched via `wizard revenue`. The detect step checks for PostHog + Stripe
 * SDKs and downloads the skill. Auth and run follow.
 *
 * Detection runs via detectRevenuePrerequisites() called from bin.ts AFTER
 * the session is assigned (onInit fires during store construction, before
 * session is set, so it can't be used for session-dependent detection).
 */

import type { Workflow } from '../workflow-step.js';
import type { WizardSession } from '../wizard-session.js';
import { RunPhase } from '../wizard-session.js';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fetchSkillMenu, downloadSkill } from '../wizard-tools.js';
import { logToFile } from '../../utils/debug.js';
import { IGNORED_DIRS } from '../../utils/file-utils.js';

const POSTHOG_SDKS = [
  'posthog-js',
  'posthog-node',
  'posthog-react-native',
  'posthog-android',
  'posthog-ios',
];

const STRIPE_SDKS = ['stripe', '@stripe/stripe-js', '@stripe/react-stripe-js'];

const SKILL_ID = 'revenue-analytics-setup';

interface PackageMatch {
  /** Path to the package.json relative to installDir */
  path: string;
  posthogSdks: string[];
  stripeSdks: string[];
}

/**
 * Recursively find all package.json files under installDir (max depth 5),
 * skipping common ignored directories. Returns matches with detected SDKs.
 */
function findPackageJsons(installDir: string, maxDepth = 3): PackageMatch[] {
  const matches: PackageMatch[] = [];

  function scan(dir: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries: import('fs').Dirent[];
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
          const pkg = JSON.parse(readFileSync(fullPath, 'utf-8'));
          const allDeps = {
            ...pkg.dependencies,
            ...pkg.devDependencies,
          };
          const depNames = Object.keys(allDeps);
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
 * Check prerequisites and download the revenue analytics skill.
 * Stores `skillPath` or `detectError` in session.frameworkContext.
 *
 * Must be called AFTER the session is assigned to the store,
 * so it reads the correct installDir.
 */
export async function detectRevenuePrerequisites(
  session: WizardSession,
  setFrameworkContext: (key: string, value: unknown) => void,
): Promise<void> {
  const installDir = session.installDir;

  // Verify the install directory exists
  if (!existsSync(installDir)) {
    setFrameworkContext(
      'detectError',
      `Directory does not exist:\n  ${installDir}`,
    );
    return;
  }

  try {
    if (!statSync(installDir).isDirectory()) {
      setFrameworkContext('detectError', `Not a directory:\n  ${installDir}`);
      return;
    }
  } catch {
    setFrameworkContext(
      'detectError',
      `Could not access directory:\n  ${installDir}`,
    );
    return;
  }

  // Find all package.json files (root + monorepo subpackages)
  const matches = findPackageJsons(installDir);

  if (matches.length === 0) {
    setFrameworkContext(
      'detectError',
      'No package.json found in this directory.\n' +
        'Revenue analytics is currently supported for Node.js / TypeScript projects.\n' +
        'Run this command from your project root.',
    );
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
    setFrameworkContext(
      'detectError',
      `Neither PostHog nor Stripe SDKs detected.\n` +
        `Scanned ${matches.length} package.json file(s).\n\n` +
        `Revenue analytics requires:\n` +
        `  • A PostHog SDK (${POSTHOG_SDKS.slice(0, 3).join(', ')}, ...)\n` +
        `  • A Stripe SDK (${STRIPE_SDKS.join(', ')})\n\n` +
        `Install Stripe and run \`npx @posthog/wizard\` first to set up PostHog.`,
    );
    return;
  }

  if (detectedPosthogSdks.length === 0) {
    setFrameworkContext(
      'detectError',
      `No PostHog SDK detected.\n` +
        `Found Stripe (${detectedStripeSdks.join(
          ', ',
        )}) but no PostHog SDK.\n\n` +
        `Run \`npx @posthog/wizard\` first to set up the base PostHog integration.`,
    );
    return;
  }

  if (detectedStripeSdks.length === 0) {
    setFrameworkContext(
      'detectError',
      `No Stripe SDK detected.\n` +
        `Found PostHog (${detectedPosthogSdks.join(
          ', ',
        )}) but no Stripe SDK.\n\n` +
        `Revenue analytics currently supports Stripe only.\n` +
        `Install one of: ${STRIPE_SDKS.join(', ')}`,
    );
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

  // Both found — download the skill
  const skillsBaseUrl = session.localMcp
    ? 'http://localhost:8765'
    : 'https://github.com/PostHog/context-mill/releases/latest/download';

  logToFile(
    `[revenue-detect] prerequisites met, fetching skill menu from ${skillsBaseUrl}`,
  );

  try {
    const menu = await fetchSkillMenu(skillsBaseUrl);
    if (!menu) {
      setFrameworkContext(
        'detectError',
        'Could not fetch the skill menu.\nPlease check your network connection and try again.',
      );
      return;
    }

    const allSkills = Object.values(menu.categories).flat();
    const skill = allSkills.find((s) => s.id === SKILL_ID);
    if (!skill) {
      setFrameworkContext(
        'detectError',
        `Could not find the "${SKILL_ID}" skill.\nPlease try again.`,
      );
      return;
    }

    const installResult = downloadSkill(skill, installDir);
    if (!installResult.success) {
      setFrameworkContext(
        'detectError',
        `Failed to install skill: ${installResult.error}\nPlease try again.`,
      );
      return;
    }

    const skillPath = `.claude/skills/${SKILL_ID}`;
    logToFile(`[revenue-detect] skill installed at ${skillPath}`);
    setFrameworkContext('skillPath', skillPath);
  } catch (err: any) {
    setFrameworkContext('detectError', `Skill download failed: ${err.message}`);
  }
}

export const REVENUE_ANALYTICS_WORKFLOW: Workflow = [
  {
    id: 'detect',
    label: 'Detecting prerequisites',
    // No screen — headless step. Gate blocks bin.ts until detection is done.
    // Detection is triggered by bin.ts calling detectRevenuePrerequisites()
    // after the session is assigned to the store.
    gate: (s) =>
      s.frameworkContext.skillPath != null ||
      s.frameworkContext.detectError != null,
  },
  {
    id: 'intro',
    label: 'Welcome',
    screen: 'revenue-intro',
    gate: (s) => s.setupConfirmed,
    isComplete: (s) => s.setupConfirmed,
  },
  {
    id: 'auth',
    label: 'Authentication',
    screen: 'auth',
    isComplete: (s) => s.credentials !== null,
  },
  {
    id: 'run',
    label: 'Revenue analytics',
    screen: 'run',
    isComplete: (s) =>
      s.runPhase === RunPhase.Completed || s.runPhase === RunPhase.Error,
  },
  {
    id: 'outro',
    label: 'Done',
    screen: 'outro',
    isComplete: (s) => s.outroDismissed,
  },
];
