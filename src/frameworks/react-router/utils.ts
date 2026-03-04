import { major } from 'semver';
import fg from 'fast-glob';
import { getPackageDotJson } from '../../utils/setup-utils';
import type { WizardOptions } from '../../utils/types';
import { getPackageVersion } from '../../utils/package-json';
import { createVersionBucket } from '../../utils/semver';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as semver from 'semver';

export enum ReactRouterMode {
  V6 = 'v6',
  V7_FRAMEWORK = 'v7-framework',
  V7_DATA = 'v7-data',
  V7_DECLARATIVE = 'v7-declarative',
}

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/public/**',
  '**/.next/**',
];

export const getReactRouterVersionBucket = createVersionBucket();

async function hasReactRouterConfig({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<boolean> {
  const configMatches = await fg('**/react-router.config.@(ts|js|tsx|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });
  return configMatches.length > 0;
}

async function hasCreateBrowserRouter({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<boolean> {
  const sourceFiles = await fg('**/*.@(ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  for (const file of sourceFiles) {
    try {
      const filePath = path.join(installDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.includes('createBrowserRouter')) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

async function hasDeclarativeRouter({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<boolean> {
  const sourceFiles = await fg('**/*.@(ts|tsx|js|jsx)', {
    dot: true,
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  for (const file of sourceFiles) {
    try {
      const filePath = path.join(installDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      if (
        content.includes('<BrowserRouter') ||
        (content.includes('BrowserRouter') &&
          (content.includes('from "react-router-dom"') ||
            content.includes("from 'react-router-dom'")))
      ) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

/**
 * Detect React Router mode. Pure — returns null if ambiguous.
 */
export async function getReactRouterMode(
  options: WizardOptions,
): Promise<ReactRouterMode | null> {
  const { installDir } = options;

  const packageJson = await getPackageDotJson(options);
  const reactRouterVersion =
    getPackageVersion('react-router-dom', packageJson) ||
    getPackageVersion('react-router', packageJson);

  if (!reactRouterVersion) {
    return null;
  }

  const coercedVersion = semver.coerce(reactRouterVersion);
  const majorVersion = coercedVersion ? major(coercedVersion) : null;

  if (majorVersion === 6) {
    return ReactRouterMode.V6;
  }

  if (majorVersion === 7) {
    const hasConfig = await hasReactRouterConfig({ installDir });
    if (hasConfig) return ReactRouterMode.V7_FRAMEWORK;

    const hasDataMode = await hasCreateBrowserRouter({ installDir });
    if (hasDataMode) return ReactRouterMode.V7_DATA;

    const hasDeclarative = await hasDeclarativeRouter({ installDir });
    if (hasDeclarative) return ReactRouterMode.V7_DECLARATIVE;

    // v7 but can't detect mode
    return null;
  }

  return null;
}

export function getReactRouterModeName(mode: ReactRouterMode): string {
  switch (mode) {
    case ReactRouterMode.V6:
      return 'v6';
    case ReactRouterMode.V7_FRAMEWORK:
      return 'v7 Framework mode';
    case ReactRouterMode.V7_DATA:
      return 'v7 Data mode';
    case ReactRouterMode.V7_DECLARATIVE:
      return 'v7 Declarative mode';
  }
}
