import fg from 'fast-glob';
import type { WizardRunOptions } from '@utils/types';
import { hasDeclaredDependency } from '@utils/package-json';
import { createVersionBucket } from '@utils/semver';
import * as fs from 'node:fs';
import * as path from 'node:path';

export enum TanStackRouterMode {
  FILE_BASED = 'file-based',
  CODE_BASED = 'code-based',
}

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/public/**',
  '**/.vinxi/**',
  '**/.output/**',
];

export const getTanStackRouterVersionBucket = createVersionBucket();

async function hasFileBasedRouting({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<boolean> {
  const generatedFiles = await fg('**/routeTree.gen.@(ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

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

async function hasCodeBasedRouting({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<boolean> {
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
