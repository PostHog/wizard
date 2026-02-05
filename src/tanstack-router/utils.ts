import { major, minVersion } from 'semver';
import fg from 'fast-glob';
import { abortIfCancelled } from '../utils/clack-utils';
import clack from '../utils/clack';
import type { WizardOptions } from '../utils/types';
import { Integration } from '../lib/constants';
import { hasPackageInstalled } from '../utils/package-json';
import * as fs from 'node:fs';
import * as path from 'node:path';

export enum TanStackRouterMode {
  FILE_BASED = 'file-based', // Uses @tanstack/router-plugin with file-based route generation
  CODE_BASED = 'code-based', // Manually defines routes with createRoute/createRootRoute
}

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/public/**',
  '**/.vinxi/**',
  '**/.output/**',
];

/**
 * Get TanStack Router version bucket for analytics
 */
export function getTanStackRouterVersionBucket(
  version: string | undefined,
): string {
  if (!version) {
    return 'none';
  }

  try {
    const minVer = minVersion(version);
    if (!minVer) {
      return 'invalid';
    }
    const majorVersion = major(minVer);
    return `${majorVersion}.x`;
  } catch {
    return 'unknown';
  }
}

/**
 * Check if the project uses file-based routing.
 *
 * Detection signals (in order of reliability):
 * 1. Generated route tree file exists (routeTree.gen.ts) - definitive
 * 2. Router plugin in package.json (@tanstack/router-plugin or @tanstack/router-vite-plugin)
 * 3. createFileRoute usage in source files
 */
async function hasFileBasedRouting({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<boolean> {
  // 1. Check for generated route tree file (most definitive signal)
  const generatedFiles = await fg('**/routeTree.gen.@(ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  if (generatedFiles.length > 0) {
    return true;
  }

  // 2. Check package.json for the router plugin
  try {
    const packageJsonPath = path.join(installDir, 'package.json');
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content) as Record<string, unknown>;

    if (
      hasPackageInstalled('@tanstack/router-plugin', packageJson) ||
      hasPackageInstalled('@tanstack/router-vite-plugin', packageJson)
    ) {
      return true;
    }
  } catch {
    // package.json not found or unreadable
  }

  // 3. Check for createFileRoute usage in source files
  const sourceFiles = await fg('**/*.@(ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  for (const file of sourceFiles) {
    try {
      const filePath = path.join(installDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes('createFileRoute')) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

/**
 * Check if the project uses code-based routing.
 *
 * Code-based routing uses createRoute() to manually define routes,
 * as opposed to file-based routing which uses createFileRoute().
 */
async function hasCodeBasedRouting({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<boolean> {
  const sourceFiles = await fg('**/*.@(ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  let hasCreateRoute = false;
  let hasCreateFileRoute = false;

  for (const file of sourceFiles) {
    try {
      const filePath = path.join(installDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      if (content.includes('createRoute(')) {
        hasCreateRoute = true;
      }
      if (content.includes('createFileRoute')) {
        hasCreateFileRoute = true;
      }
    } catch {
      continue;
    }
  }

  // Code-based if createRoute is used without createFileRoute
  return hasCreateRoute && !hasCreateFileRoute;
}

/**
 * Detect TanStack Router mode (file-based vs code-based routing)
 */
export async function getTanStackRouterMode(
  options: WizardOptions,
): Promise<TanStackRouterMode> {
  const { installDir } = options;

  const isFileBased = await hasFileBasedRouting({ installDir });
  if (isFileBased) {
    clack.log.info('Detected TanStack Router file-based routing');
    return TanStackRouterMode.FILE_BASED;
  }

  const isCodeBased = await hasCodeBasedRouting({ installDir });
  if (isCodeBased) {
    clack.log.info('Detected TanStack Router code-based routing');
    return TanStackRouterMode.CODE_BASED;
  }

  // If we can't detect, ask the user
  const result: TanStackRouterMode = await abortIfCancelled(
    clack.select({
      message: 'What TanStack Router routing mode are you using?',
      options: [
        {
          label: 'File-based routing',
          value: TanStackRouterMode.FILE_BASED,
        },
        {
          label: 'Code-based routing',
          value: TanStackRouterMode.CODE_BASED,
        },
      ],
    }),
    Integration.tanstackRouter,
  );
  return result;
}

/**
 * Get human-readable name for TanStack Router mode
 */
export function getTanStackRouterModeName(mode: TanStackRouterMode): string {
  switch (mode) {
    case TanStackRouterMode.FILE_BASED:
      return 'File-based routing';
    case TanStackRouterMode.CODE_BASED:
      return 'Code-based routing';
  }
}
