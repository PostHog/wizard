import * as fs from 'fs';
import * as path from 'path';
import { readFileHead, readProjectFile } from './bounded-fs';
import { withProgress } from './telemetry';
import { analytics } from './analytics';
import type { WizardRunOptions } from './types';

type InstallDirOpt = Pick<WizardRunOptions, 'installDir'>;

export interface PackageManager {
  name: string;
  label: string;
  installCommand: string;
  buildCommand: string;
  /** Command the manager uses to execute a `package.json` script. */
  runScriptCommand: string;
  flags: string;
  detect: (opts: InstallDirOpt) => boolean;
}

function hasLockfile(installDir: string, file: string): boolean {
  return fs.existsSync(path.join(installDir, file));
}

function lockfileHeaderContains(
  installDir: string,
  file: string,
  needle: string,
): boolean {
  // Reads only the first 500 bytes of the lockfile.
  return (
    readFileHead(path.join(installDir, file), 500)?.includes(needle) ?? false
  );
}

export const BUN: PackageManager = {
  name: 'bun',
  label: 'Bun',
  installCommand: 'bun add',
  buildCommand: 'bun run build',
  runScriptCommand: 'bun run',
  flags: '',
  detect: ({ installDir }) =>
    hasLockfile(installDir, 'bun.lockb') || hasLockfile(installDir, 'bun.lock'),
};

export const YARN_V1: PackageManager = {
  name: 'yarn',
  label: 'Yarn V1',
  installCommand: 'yarn add',
  buildCommand: 'yarn build',
  runScriptCommand: 'yarn',
  flags: '--ignore-workspace-root-check',
  detect: ({ installDir }) =>
    lockfileHeaderContains(installDir, 'yarn.lock', 'yarn lockfile v1'),
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
    lockfileHeaderContains(installDir, 'yarn.lock', '__metadata'),
};

export const PNPM: PackageManager = {
  name: 'pnpm',
  label: 'pnpm',
  installCommand: 'pnpm add',
  buildCommand: 'pnpm build',
  runScriptCommand: 'pnpm',
  flags: '--ignore-workspace-root-check',
  detect: ({ installDir }) => hasLockfile(installDir, 'pnpm-lock.yaml'),
};

export const NPM: PackageManager = {
  name: 'npm',
  label: 'npm',
  installCommand: 'npm add',
  buildCommand: 'npm run build',
  runScriptCommand: 'npm run',
  flags: '',
  detect: ({ installDir }) => hasLockfile(installDir, 'package-lock.json'),
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
  detect: () => false,
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

// ---------------------------------------------------------------------------
// The detector contract the agent's `detect_package_manager` tool calls
// ---------------------------------------------------------------------------

/** Structured package manager info the agent can act on */
export interface DetectedPackageManager {
  name: string;
  label: string;
  installCommand: string;
  runCommand?: string;
}

/** Result returned by every detector */
export interface PackageManagerInfo {
  detected: DetectedPackageManager[];
  primary: DetectedPackageManager | null;
  recommendation: string;
}

/** Signature each framework implements */
export type PackageManagerDetector = (
  installDir: string,
) => Promise<PackageManagerInfo>;

// ---------------------------------------------------------------------------
// Node.js helper
// ---------------------------------------------------------------------------

function serializeNodePM(pm: PackageManager): DetectedPackageManager {
  return {
    name: pm.name,
    label: pm.label,
    installCommand: pm.installCommand,
    runCommand: pm.runScriptCommand,
  };
}

type ManifestSignal =
  | { kind: 'declared'; pm: PackageManager }
  | { kind: 'workspace' }
  | { kind: 'none' };

const DECLARED_MANAGER = /^(npm|pnpm|yarn|bun)@(\d+)\.\d+\.\d+/;

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

function declaredManager(value: unknown): PackageManager | null {
  if (typeof value !== 'string') return null;
  const match = DECLARED_MANAGER.exec(value.trim());
  if (!match) return null;
  const [, name, major] = match;
  if (name === 'yarn') return major === '1' ? YARN_V1 : YARN_V2;
  return { npm: NPM, pnpm: PNPM, bun: BUN }[name] ?? null;
}

function usesWorkspaceProtocol(manifest: Record<string, unknown>): boolean {
  return DEPENDENCY_FIELDS.some((field) => {
    const deps = manifest[field];
    if (!deps || typeof deps !== 'object') return false;
    return Object.values(deps).some(
      (spec) =>
        typeof spec === 'string' &&
        (spec.startsWith('workspace:') || spec.startsWith('catalog:')),
    );
  });
}

/** Reads the local `package.json` for a declared manager or workspace-only specifiers. */
function readManifestSignal(installDir: string): ManifestSignal {
  const raw = readProjectFile(path.join(installDir, 'package.json'));
  if (!raw) return { kind: 'none' };
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return { kind: 'none' };
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { kind: 'none' };
  }
  const record = manifest as Record<string, unknown>;
  const pm = declaredManager(record.packageManager);
  if (pm) return { kind: 'declared', pm };
  if (usesWorkspaceProtocol(record)) return { kind: 'workspace' };
  return { kind: 'none' };
}

/**
 * Detect Node.js package managers via lockfiles, then the local
 * `package.json` when no lockfile is present.
 * Wraps detectAllPackageManagers() above.
 */
export function detectNodePackageManagers(
  installDir: string,
): Promise<PackageManagerInfo> {
  const detected = detectAllPackageManagers({ installDir }).map(
    serializeNodePM,
  );

  if (detected.length === 0) {
    const signal = readManifestSignal(installDir);
    if (signal.kind === 'declared') {
      const primary = serializeNodePM(signal.pm);
      return Promise.resolve({
        detected: [primary],
        primary,
        recommendation: `No lockfile found. Use ${primary.label} (${primary.installCommand}), as declared by the packageManager field in package.json.`,
      });
    }
    if (signal.kind === 'workspace') {
      return Promise.resolve({
        detected: [],
        primary: null,
        recommendation:
          'No lockfile found, and package.json has workspace: or catalog: dependencies. This package is part of a workspace, and npm cannot install it. Do not use npm. Find the package manager that the workspace root uses before you install packages.',
      });
    }
    return Promise.resolve({
      detected: [],
      primary: null,
      recommendation: 'No lockfile found. Default to npm (npm add, npm run).',
    });
  }

  const primary = detected[0];
  return Promise.resolve({
    detected,
    primary,
    recommendation:
      detected.length === 1
        ? `Use ${primary.label} (${primary.installCommand}).`
        : `Multiple package managers detected. Prefer ${primary.label} (${primary.installCommand}).`,
  });
}
