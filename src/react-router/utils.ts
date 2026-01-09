import { major, minVersion } from 'semver';
import fg from 'fast-glob';
import { abortIfCancelled, getPackageDotJson } from '../utils/clack-utils';
import clack from '../utils/clack';
import type { WizardOptions } from '../utils/types';
import { Integration } from '../lib/constants';
import { getPackageVersion } from '../utils/package-json';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as semver from 'semver';

export enum ReactRouterMode {
  V6 = 'v6', // React Router v6
  V7_FRAMEWORK = 'v7-framework', // React Router v7 with react-router.config.ts
  V7_DATA = 'v7-data', // React Router v7 with createBrowserRouter
  V7_DECLARATIVE = 'v7-declarative', // React Router v7 with BrowserRouter
}

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/public/**',
  '**/.next/**',
];

/**
 * Get React Router version bucket for analytics
 */
export function getReactRouterVersionBucket(
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
    if (majorVersion >= 6) {
      return `${majorVersion}.x`;
    }
    return `<6.0.0`;
  } catch {
    return 'unknown';
  }
}

/**
 * Check if react-router.config.ts exists (indicates framework mode - React Router v7)
 */
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

/**
 * Search for createBrowserRouter usage in source files
 */
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

      // Check for createBrowserRouter import or usage
      if (content.includes('createBrowserRouter')) {
        return true;
      }
    } catch {
      // Skip files that can't be read
      continue;
    }
  }

  return false;
}

/**
 * Search for declarative BrowserRouter usage
 */
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

      // Check for BrowserRouter usage (JSX or import)
      if (
        content.includes('<BrowserRouter') ||
        (content.includes('BrowserRouter') &&
          (content.includes('from "react-router-dom"') ||
            content.includes("from 'react-router-dom'")))
      ) {
        return true;
      }
    } catch {
      // Skip files that can't be read
      continue;
    }
  }

  return false;
}

/**
 * Detect React Router mode
 */
export async function getReactRouterMode(
  options: WizardOptions,
): Promise<ReactRouterMode> {
  const { installDir } = options;

  // First, get the React Router version
  const packageJson = await getPackageDotJson(options);
  const reactRouterVersion =
    getPackageVersion('react-router-dom', packageJson) ||
    getPackageVersion('react-router', packageJson);

  if (!reactRouterVersion) {
    // If we can't detect version, ask the user
    clack.log.info(
      `Learn more about React Router modes: ${chalk.cyan(
        'https://reactrouter.com/start/modes',
      )}`,
    );
    const result: ReactRouterMode = await abortIfCancelled(
      clack.select({
        message: 'What React Router version and mode are you using?',
        options: [
          {
            label: 'React Router v6',
            value: ReactRouterMode.V6,
          },
          {
            label: 'React Router v7 - Framework mode',
            value: ReactRouterMode.V7_FRAMEWORK,
          },
          {
            label: 'React Router v7 - Data mode',
            value: ReactRouterMode.V7_DATA,
          },
          {
            label: 'React Router v7 - Declarative mode',
            value: ReactRouterMode.V7_DECLARATIVE,
          },
        ],
      }),
      Integration.reactRouter,
    );
    return result;
  }

  const coercedVersion = semver.coerce(reactRouterVersion);
  const majorVersion = coercedVersion ? major(coercedVersion) : null;

  // If v6, return V6
  if (majorVersion === 6) {
    clack.log.info('Detected React Router v6');
    return ReactRouterMode.V6;
  }

  // If v7, detect the mode
  if (majorVersion === 7) {
    // First check for framework mode (react-router.config.ts)
    const hasConfig = await hasReactRouterConfig({ installDir });
    if (hasConfig) {
      clack.log.info('Detected React Router v7 - Framework mode');
      return ReactRouterMode.V7_FRAMEWORK;
    }

    // Check for data mode (createBrowserRouter)
    const hasDataMode = await hasCreateBrowserRouter({ installDir });
    if (hasDataMode) {
      clack.log.info('Detected React Router v7 - Data mode');
      return ReactRouterMode.V7_DATA;
    }

    // Check for declarative mode (BrowserRouter)
    const hasDeclarative = await hasDeclarativeRouter({ installDir });
    if (hasDeclarative) {
      clack.log.info('Detected React Router v7 - Declarative mode');
      return ReactRouterMode.V7_DECLARATIVE;
    }

    // If v7 but can't detect mode, ask the user
    clack.log.info(
      `Learn more about React Router modes: ${chalk.cyan(
        'https://reactrouter.com/start/modes',
      )}`,
    );
    const result: ReactRouterMode = await abortIfCancelled(
      clack.select({
        message: 'What React Router v7 mode are you using?',
        options: [
          {
            label: 'Framework mode',
            value: ReactRouterMode.V7_FRAMEWORK,
          },
          {
            label: 'Data mode',
            value: ReactRouterMode.V7_DATA,
          },
          {
            label: 'Declarative mode',
            value: ReactRouterMode.V7_DECLARATIVE,
          },
        ],
      }),
      Integration.reactRouter,
    );
    return result;
  }

  // If version is not 6 or 7, default to asking
  clack.log.info(
    `Learn more about React Router modes: ${chalk.cyan(
      'https://reactrouter.com/start/modes',
    )}`,
  );
  const result: ReactRouterMode = await abortIfCancelled(
    clack.select({
      message: 'What React Router version and mode are you using?',
      options: [
        {
          label: 'React Router v6',
          value: ReactRouterMode.V6,
        },
        {
          label: 'React Router v7 - Framework mode',
          value: ReactRouterMode.V7_FRAMEWORK,
        },
        {
          label: 'React Router v7 - Data mode',
          value: ReactRouterMode.V7_DATA,
        },
        {
          label: 'React Router v7 - Declarative mode',
          value: ReactRouterMode.V7_DECLARATIVE,
        },
      ],
    }),
    Integration.reactRouter,
  );
  return result;
}

/**
 * Get human-readable name for React Router mode
 */
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
