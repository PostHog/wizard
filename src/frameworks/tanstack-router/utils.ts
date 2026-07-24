import type { WizardRunOptions } from '@utils/types';
import { boundedGlob, readProjectFile } from '@utils/bounded-fs';
import { hasDeclaredDependency } from '@utils/package-json';
import { createVersionBucket } from '@utils/semver';
import * as fs from 'node:fs';
import * as path from 'node:path';

export enum TanStackRouterMode {
  FILE_BASED = 'file-based',
  CODE_BASED = 'code-based',
}

const EXTRA_IGNORE = ['**/public/**', '**/.vinxi/**', '**/.output/**'];

export const getTanStackRouterVersionBucket = createVersionBucket();

/** Route-mode probes read at most this many source files — holding one ≤MAX_PROJECT_FILE_BYTES file in memory at a time. */
const SOURCE_PROBE_LIMIT = 200;

async function hasFileBasedRouting({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<boolean> {
  const generatedFiles = await boundedGlob(
    '**/routeTree.gen.@(ts|tsx|js|jsx)',
    {
      cwd: installDir,
      extraIgnore: EXTRA_IGNORE,
      limit: 1,
    },
  );

  if (generatedFiles.length > 0) {
    return true;
  }

  try {
    const packageJsonPath = path.join(installDir, 'package.json');
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content) as Record<string, unknown>;

    if (
      hasDeclaredDependency('@tanstack/router-plugin', packageJson) ||
      hasDeclaredDependency('@tanstack/router-vite-plugin', packageJson)
    ) {
      return true;
    }
  } catch {
    // package.json not found or unreadable
  }

  const sourceFiles = await boundedGlob('**/*.@(ts|tsx|js|jsx)', {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
    limit: SOURCE_PROBE_LIMIT,
  });

  for (const file of sourceFiles) {
    const content = readProjectFile(path.join(installDir, file));
    if (content?.includes('createFileRoute')) {
      return true;
    }
  }

  return false;
}

async function hasCodeBasedRouting({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<boolean> {
  const sourceFiles = await boundedGlob('**/*.@(ts|tsx|js|jsx)', {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
    limit: SOURCE_PROBE_LIMIT,
  });

  let hasCreateRoute = false;
  let hasCreateFileRoute = false;

  for (const file of sourceFiles) {
    const content = readProjectFile(path.join(installDir, file));
    if (!content) continue;

    if (content.includes('createRoute(')) {
      hasCreateRoute = true;
    }
    if (content.includes('createFileRoute')) {
      hasCreateFileRoute = true;
    }
  }

  return hasCreateRoute && !hasCreateFileRoute;
}

/**
 * Detect TanStack Router mode. Pure — returns null if ambiguous.
 */
export async function getTanStackRouterMode(
  options: WizardRunOptions,
): Promise<TanStackRouterMode | null> {
  const { installDir } = options;

  const isFileBased = await hasFileBasedRouting({ installDir });
  if (isFileBased) {
    return TanStackRouterMode.FILE_BASED;
  }

  const isCodeBased = await hasCodeBasedRouting({ installDir });
  if (isCodeBased) {
    return TanStackRouterMode.CODE_BASED;
  }

  return null;
}

export function getTanStackRouterModeName(mode: TanStackRouterMode): string {
  switch (mode) {
    case TanStackRouterMode.FILE_BASED:
      return 'File-based routing';
    case TanStackRouterMode.CODE_BASED:
      return 'Code-based routing';
  }
}
