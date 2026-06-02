import * as fs from 'fs';
import * as path from 'path';
import { withProgress } from '../telemetry';
import { getPackageDotJson, updatePackageDotJson } from './setup-utils';
import type { PackageDotJson } from './package-json';
import { analytics } from './analytics';
import type { WizardOptions } from './types';

type InstallDirOpt = Pick<WizardOptions, 'installDir'>;

export interface PackageManager {
  name: string;
  label: string;
  installCommand: string;
  buildCommand: string;
  /** Command the manager uses to execute a `package.json` script. */
  runScriptCommand: string;
  flags: string;
  forceInstallFlag: string;
  detect: (opts: InstallDirOpt) => boolean;
  addOverride: (
    pkgName: string,
    pkgVersion: string,
    opts: InstallDirOpt,
  ) => Promise<void>;
}

function hasLockfile(installDir: string, file: string): boolean {
  return fs.existsSync(path.join(installDir, file));
}

function lockfileHeaderContains(
  installDir: string,
  file: string,
  needle: string,
): boolean {
  try {
    const head = fs
      .readFileSync(path.join(installDir, file), 'utf-8')
      .slice(0, 500);
    return head.includes(needle);
  } catch {
    return false;
  }
}

type OverrideSlot = 'npm' | 'yarn' | 'pnpm';

async function writeOverride(
  slot: OverrideSlot,
  pkgName: string,
  pkgVersion: string,
  { installDir }: InstallDirOpt,
): Promise<void> {
  const pkg = await getPackageDotJson({ installDir });
  let next: PackageDotJson;
  if (slot === 'yarn') {
    next = {
      ...pkg,
      resolutions: { ...(pkg.resolutions ?? {}), [pkgName]: pkgVersion },
    };
  } else if (slot === 'pnpm') {
    next = {
      ...pkg,
      pnpm: {
        ...(pkg.pnpm ?? {}),
        overrides: { ...(pkg.pnpm?.overrides ?? {}), [pkgName]: pkgVersion },
      },
    };
  } else {
    next = {
      ...pkg,
      overrides: { ...(pkg.overrides ?? {}), [pkgName]: pkgVersion },
    };
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
  forceInstallFlag: '--force',
  detect: ({ installDir }) =>
    hasLockfile(installDir, 'bun.lockb') || hasLockfile(installDir, 'bun.lock'),
  addOverride: (pkgName, pkgVersion, opts) =>
    writeOverride('npm', pkgName, pkgVersion, opts),
};

export const YARN_V1: PackageManager = {
  name: 'yarn',
  label: 'Yarn V1',
  installCommand: 'yarn add',
  buildCommand: 'yarn build',
  runScriptCommand: 'yarn',
  flags: '--ignore-workspace-root-check',
  forceInstallFlag: '--force',
  detect: ({ installDir }) =>
    lockfileHeaderContains(installDir, 'yarn.lock', 'yarn lockfile v1'),
  addOverride: (pkgName, pkgVersion, opts) =>
    writeOverride('yarn', pkgName, pkgVersion, opts),
};

/** YARN V2/3/4 */
export const YARN_V2: PackageManager = {
  name: 'yarn',
  label: 'Yarn V2/3/4',
  installCommand: 'yarn add',
  buildCommand: 'yarn build',
  runScriptCommand: 'yarn',
  flags: '',
  forceInstallFlag: '--force',
  detect: ({ installDir }) =>
    lockfileHeaderContains(installDir, 'yarn.lock', '__metadata'),
  addOverride: (pkgName, pkgVersion, opts) =>
    writeOverride('yarn', pkgName, pkgVersion, opts),
};

export const PNPM: PackageManager = {
  name: 'pnpm',
  label: 'pnpm',
  installCommand: 'pnpm add',
  buildCommand: 'pnpm build',
  runScriptCommand: 'pnpm',
  flags: '--ignore-workspace-root-check',
  forceInstallFlag: '--force',
  detect: ({ installDir }) => hasLockfile(installDir, 'pnpm-lock.yaml'),
  addOverride: (pkgName, pkgVersion, opts) =>
    writeOverride('pnpm', pkgName, pkgVersion, opts),
};

export const NPM: PackageManager = {
  name: 'npm',
  label: 'npm',
  installCommand: 'npm add',
  buildCommand: 'npm run build',
  runScriptCommand: 'npm run',
  flags: '',
  forceInstallFlag: '--force',
  detect: ({ installDir }) => hasLockfile(installDir, 'package-lock.json'),
  addOverride: (pkgName, pkgVersion, opts) =>
    writeOverride('npm', pkgName, pkgVersion, opts),
};

// Expo is selected by upstream config (app.json / app.config.*) rather than
// a lockfile, so its detect always returns false here.
export const EXPO: PackageManager = {
  name: 'expo',
  label: 'Expo',
  installCommand: 'npx expo install',
  buildCommand: 'npx expo build',
  runScriptCommand: 'npx expo run',
  flags: '',
  forceInstallFlag: '--force',
  detect: () => false,
  addOverride: (pkgName, pkgVersion, opts) =>
    writeOverride('npm', pkgName, pkgVersion, opts),
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
}: InstallDirOpt): PackageManager[] {
  return withProgress('detect-package-manager', () => {
    const matches = packageManagers.filter((pm) => pm.detect({ installDir }));
    if (matches.length === 0) {
      analytics.setTag('package-manager', 'not-detected');
    }
    return matches;
  });
}
