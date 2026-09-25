import { major } from 'semver';
import { tryGetPackageJson } from '@utils/setup-utils';
import type { WizardRunOptions } from '@utils/types';
import { boundedGlob, readProjectFile } from '@utils/bounded-fs';
import { getDeclaredVersion } from '@utils/package-json';
import { createVersionBucket } from '@utils/semver';
import * as path from 'node:path';
import * as semver from 'semver';

export enum ReactRouterMode {
  V6 = 'v6',
  V7_FRAMEWORK = 'v7-framework',
  V7_DATA = 'v7-data',
  V7_DECLARATIVE = 'v7-declarative',
}

const EXTRA_IGNORE = ['**/public/**'];

export const getReactRouterVersionBucket = createVersionBucket();

/** Content probes read at most this many files, one in memory at a time. */
const SOURCE_PROBE_LIMIT = 200;

/** Files that set up a React Router — never a blanket source sweep. */
const ROUTER_FILE_GLOBS = [
  '**/routes/**/*.@(ts|tsx|js|jsx)',
  '**/*[Rr]out*.@(ts|tsx|js|jsx)',
  '**/@(main|app|App|index|root).@(ts|tsx|js|jsx)',
];

async function hasReactRouterConfig({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<boolean> {
  const configMatches = await boundedGlob(
    '**/react-router.config.@(ts|js|tsx|jsx)',
    {
      cwd: installDir,
      extraIgnore: EXTRA_IGNORE,
      limit: 1,
    },
  );
  return configMatches.length > 0;
}

async function hasCreateBrowserRouter({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<boolean> {
  const sourceFiles = await boundedGlob(ROUTER_FILE_GLOBS, {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
    limit: SOURCE_PROBE_LIMIT,
  });

  for (const file of sourceFiles) {
    const content = readProjectFile(path.join(installDir, file));
    if (content?.includes('createBrowserRouter')) {
      return true;
    }
  }

  return false;
}

async function hasDeclarativeRouter({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<boolean> {
  const sourceFiles = await boundedGlob(ROUTER_FILE_GLOBS, {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
    limit: SOURCE_PROBE_LIMIT,
  });

  for (const file of sourceFiles) {
    const content = readProjectFile(path.join(installDir, file));
    if (!content) continue;
    if (
      content.includes('<BrowserRouter') ||
      (content.includes('BrowserRouter') &&
        (content.includes('from "react-router-dom"') ||
          content.includes("from 'react-router-dom'")))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Detect React Router mode. Pure — returns null if ambiguous.
 */
export async function getReactRouterMode(
  options: WizardRunOptions,
): Promise<ReactRouterMode | null> {
  const { installDir } = options;

  const packageJson = await tryGetPackageJson(options);
  if (!packageJson) return null;

  const reactRouterVersion =
    getDeclaredVersion('react-router-dom', packageJson) ||
    getDeclaredVersion('react-router', packageJson);

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
