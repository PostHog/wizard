import * as fs from 'fs';
import * as path from 'path';
import { withProgress } from '../telemetry';
import { getPackageDotJson, updatePackageDotJson } from './setup-utils';
import type { PackageDotJson } from './package-json';
import { analytics } from './analytics';
import type { WizardOptions } from './types';

export interface PackageManager {
  name: string;
  label: string;
  installCommand: string;
  buildCommand: string;
  /* The command that the package manager uses to run a script from package.json */
  runScriptCommand: string;
  flags: string;
  detect: ({ installDir }: Pick<WizardOptions, 'installDir'>) => boolean;
  addOverride: (
    pkgName: string,
    pkgVersion: string,
    { installDir }: Pick<WizardOptions, 'installDir'>,
  ) => Promise<void>;
}

type InstallDir = Pick<WizardOptions, 'installDir'>;

function lockExists(installDir: string, fileName: string): boolean {
  return fs.existsSync(path.join(installDir, fileName));
}

function lockMatches(
  installDir: string,
  fileName: string,
  needle: string,
): boolean {
  try {
    const head = fs
      .readFileSync(path.join(installDir, fileName), 'utf-8')
      .slice(0, 500);
    return head.includes(needle);
  } catch {
    return false;
  }
}

type OverrideTarget = 'overrides' | 'resolutions' | 'pnpm.overrides';

async function applyOverride(
  target: OverrideTarget,
  pkgName: string,
  pkgVersion: string,
  { installDir }: InstallDir,
): Promise<void> {
  const pkg = await getPackageDotJson({ installDir });
  const next: PackageDotJson = { ...pkg };

  switch (target) {
    case 'overrides': {
      next.overrides = { ...(pkg.overrides ?? {}), [pkgName]: pkgVersion };
      break;
    }
    case 'resolutions': {
      next.resolutions = { ...(pkg.resolutions ?? {}), [pkgName]: pkgVersion };
      break;
    }
    case 'pnpm.overrides': {
      next.pnpm = {
        ...(pkg.pnpm ?? {}),
        overrides: { ...(pkg.pnpm?.overrides ?? {}), [pkgName]: pkgVersion },
      };
      break;
    }
  }

  await updatePackageDotJson(next, { installDir });
}

export const BUN: PackageManager = {
  name: 'bun',
  label: 'Bun',
  installCommand: 'bun add',
  buildCommand: 'bun run build',
  runScriptCommand: 'bun run',
  flags: '',
  detect: ({ installDir }) =>
    lockExists(installDir, 'bun.lockb') || lockExists(installDir, 'bun.lock'),
  addOverride: (pkgName, pkgVersion, opts) =>
    applyOverride('overrides', pkgName, pkgVersion, opts),
};

export const YARN_V1: PackageManager = {
  name: 'yarn',
  label: 'Yarn V1',
  installCommand: 'yarn add',
  buildCommand: 'yarn build',
  runScriptCommand: 'yarn',
  flags: '--ignore-workspace-root-check',
  detect: ({ installDir }) =>
    lockMatches(installDir, 'yarn.lock', 'yarn lockfile v1'),
  addOverride: (pkgName, pkgVersion, opts) =>
    applyOverride('resolutions', pkgName, pkgVersion, opts),
};

/** YARN V2/3/4 */
export const YARN_V2: PackageManager = {
  name: 'yarn',
  label: 'Yarn V2/3/4',
  installCommand: 'yarn add',
  buildCommand: 'yarn build',
  runScriptCommand: 'yarn',
  flags: '',
  detect: ({ installDir }) =>
    lockMatches(installDir, 'yarn.lock', '__metadata'),
  addOverride: (pkgName, pkgVersion, opts) =>
    applyOverride('resolutions', pkgName, pkgVersion, opts),
};

export const PNPM: PackageManager = {
  name: 'pnpm',
  label: 'pnpm',
  installCommand: 'pnpm add',
  buildCommand: 'pnpm build',
  runScriptCommand: 'pnpm',
  flags: '--ignore-workspace-root-check',
  detect: ({ installDir }) => lockExists(installDir, 'pnpm-lock.yaml'),
  addOverride: (pkgName, pkgVersion, opts) =>
    applyOverride('pnpm.overrides', pkgName, pkgVersion, opts),
};

export const NPM: PackageManager = {
  name: 'npm',
  label: 'npm',
  installCommand: 'npm add',
  buildCommand: 'npm run build',
  runScriptCommand: 'npm run',
  flags: '',
  detect: ({ installDir }) => lockExists(installDir, 'package-lock.json'),
  addOverride: (pkgName, pkgVersion, opts) =>
    applyOverride('overrides', pkgName, pkgVersion, opts),
};

export const EXPO: PackageManager = {
  name: 'expo',
  label: 'Expo',
  installCommand: 'npx expo install',
  buildCommand: 'npx expo build',
  runScriptCommand: 'npx expo run',
  flags: '',
  detect: () => false,
  addOverride: (pkgName, pkgVersion, opts) =>
    applyOverride('overrides', pkgName, pkgVersion, opts),
};

export const packageManagers: PackageManager[] = [
  BUN,
  YARN_V1,
  YARN_V2,
  PNPM,
  NPM,
  EXPO,
];

export function detectAllPackageManagers({
  installDir,
}: InstallDir): PackageManager[] {
  return withProgress('detect-package-manager', () => {
    const detected = packageManagers.filter((pm) => pm.detect({ installDir }));

    if (detected.length === 0) {
      analytics.setTag('package-manager', 'not-detected');
    }

    return detected;
  });
}
