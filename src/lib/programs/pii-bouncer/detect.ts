/**
 * PII Bouncer prerequisite detection.
 *
 * Confirms the project is a frontend with `posthog-js` installed. The
 * context-mill skill does the actual form/template enumeration — this
 * file only answers "is it worth running the skill against this project?"
 */

import type { Dirent } from 'fs';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { IGNORED_DIRS } from '@utils/file-utils';
import type { AbortCase } from '@lib/agent/agent-runner';

/**
 * Frontend SDKs whose presence indicates the masking surface this program
 * targets. `posthog-js` covers React, Next, Vue, Svelte, Astro, plain HTML
 * — anywhere DOM session recording runs.
 */
export const FRONTEND_POSTHOG_SDKS = ['posthog-js'];

export interface PiiBouncerDetection {
  hasFrontendPosthog: boolean;
  /** Package.json paths (relative to installDir) where a frontend SDK was found */
  matchingPackagePaths: string[];
}

/** `[ABORT] <reason>` cases the pii-bouncer skill can emit. */
export const PII_BOUNCER_ABORT_CASES: AbortCase[] = [
  {
    match: /^no-posthog-js$/i,
    message: 'PostHog JS is not installed',
    body:
      'The PII Bouncer protects frontend forms and session recordings. ' +
      'It needs `posthog-js` to be installed first — run the main wizard ' +
      'to integrate PostHog, then come back.',
    docsUrl: 'https://posthog.com/docs/libraries/js',
  },
  {
    match: /^no-init-call$/i,
    message: 'Could not find a posthog.init call',
    body:
      'The PII Bouncer needs to find your `posthog.init(...)` call to add ' +
      'session recording mask config. Make sure PostHog is initialised in ' +
      'your project and try again.',
    docsUrl: 'https://posthog.com/docs/libraries/js#initialization',
  },
  {
    match: /^no-frontend-templates$/i,
    message: 'No frontend templates found',
    body:
      'The PII Bouncer scans .jsx / .tsx / .vue / .svelte / .astro / .html ' +
      'files for sensitive inputs. None were found in this project.',
    docsUrl: 'https://posthog.com/docs/session-replay/privacy',
  },
];

interface PackageMatch {
  path: string;
  frontendSdks: string[];
}

function findFrontendPackages(
  installDir: string,
  maxDepth = 3,
): PackageMatch[] {
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
          const frontendSdks = depNames.filter((d) =>
            FRONTEND_POSTHOG_SDKS.includes(d),
          );
          if (frontendSdks.length > 0) {
            matches.push({
              path: relative(installDir, fullPath) || 'package.json',
              frontendSdks,
            });
          }
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
 * Synchronous detection. Returns whether a frontend PostHog SDK is
 * present and where. Callers fold the result into `customPrompt` so the
 * skill agent emits `[ABORT] no-posthog-js` cleanly when missing.
 */
export function detectPiiBouncerPrerequisites(
  installDir: string,
): PiiBouncerDetection {
  const matches = findFrontendPackages(installDir);
  return {
    hasFrontendPosthog: matches.length > 0,
    matchingPackagePaths: matches.map((m) => m.path),
  };
}
