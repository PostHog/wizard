import { relative } from 'path';
import { safeReadFile, walkProjectFiles } from '@utils/file-utils';

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

// O(MAX_PACKAGE_MATCHES) retained regardless of monorepo package count.
const MAX_PACKAGE_MATCHES = 500;

/**
 * Find all package.json files under installDir via the shared bounded walk
 * (depth cap, ignored dirs, symlink-loop protection, per-dir entry cap).
 * Returns matches with detected SDKs.
 */
export function findPackageJsons(
  installDir: string,
  maxDepth = 3,
): PackageMatch[] {
  const matches: PackageMatch[] = [];

  walkProjectFiles(
    installDir,
    (name, fullPath) => {
      if (name !== 'package.json' || matches.length >= MAX_PACKAGE_MATCHES) {
        return;
      }
      const content = safeReadFile(fullPath);
      if (content === null) return;
      try {
        const pkg = JSON.parse(content) as {
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
    },
    maxDepth,
  );

  return matches;
}
