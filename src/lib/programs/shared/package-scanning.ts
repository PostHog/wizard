import type { Dirent } from 'fs';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { IGNORED_DIRS } from '@utils/file-utils';
import { analytics } from '@utils/analytics';

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

export interface PackageMatch {
  /** Path to the package.json relative to installDir */
  path: string;
  posthogSdks: string[];
  stripeSdks: string[];
}

/**
 * Recursively find all package.json files under installDir (max depth 3),
 * skipping common ignored directories. Returns matches with detected SDKs.
 */
export function findPackageJsons(
  installDir: string,
  maxDepth = 3,
): PackageMatch[] {
  const matches: PackageMatch[] = [];

  function scan(dir: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      analytics.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { step: 'package_scanning_scan' },
      );
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
        } catch (err) {
          analytics.captureException(
            err instanceof Error ? err : new Error(String(err)),
            { step: 'package_scanning_scan' },
          );
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
