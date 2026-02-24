/**
 * Cross-ecosystem package manager detection.
 *
 * Provides a common interface (PackageManagerDetector) that each FrameworkConfig
 * implements, plus shared helpers for Node.js, Python, PHP, and Swift ecosystems.
 * The MCP tool in wizard-tools.ts delegates to whatever detector the
 * current framework supplies.
 */

import {
  detectAllPackageManagers,
  type PackageManager,
} from '../utils/package-manager';
import {
  detectPackageManager as detectPythonPM,
  PythonPackageManager,
} from '../python/utils';

// ---------------------------------------------------------------------------
// Common types
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

/**
 * Detect Node.js package managers via lockfiles.
 * Wraps the existing detectAllPackageManagers() from utils/package-manager.ts.
 */
export function detectNodePackageManagers(
  installDir: string,
): Promise<PackageManagerInfo> {
  const detected = detectAllPackageManagers({ installDir }).map(
    serializeNodePM,
  );

  if (detected.length === 0) {
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

// ---------------------------------------------------------------------------
// Python helper
// ---------------------------------------------------------------------------

const PYTHON_PM_INFO: Record<PythonPackageManager, DetectedPackageManager> = {
  [PythonPackageManager.UV]: {
    name: 'uv',
    label: 'uv',
    installCommand: 'uv add',
    runCommand: 'uv run',
  },
  [PythonPackageManager.POETRY]: {
    name: 'poetry',
    label: 'Poetry',
    installCommand: 'poetry add',
    runCommand: 'poetry run',
  },
  [PythonPackageManager.PDM]: {
    name: 'pdm',
    label: 'PDM',
    installCommand: 'pdm add',
    runCommand: 'pdm run',
  },
  [PythonPackageManager.HATCH]: {
    name: 'hatch',
    label: 'Hatch',
    installCommand: 'hatch add',
    runCommand: 'hatch run',
  },
  [PythonPackageManager.RYE]: {
    name: 'rye',
    label: 'Rye',
    installCommand: 'rye add',
    runCommand: 'rye run',
  },
  [PythonPackageManager.PIPENV]: {
    name: 'pipenv',
    label: 'Pipenv',
    installCommand: 'pipenv install',
    runCommand: 'pipenv run',
  },
  [PythonPackageManager.CONDA]: {
    name: 'conda',
    label: 'Conda',
    installCommand: 'conda install',
    runCommand: 'conda run',
  },
  [PythonPackageManager.PIP]: {
    name: 'pip',
    label: 'pip',
    installCommand: 'pip install',
  },
  [PythonPackageManager.UNKNOWN]: {
    name: 'pip',
    label: 'pip (default)',
    installCommand: 'pip install',
  },
};

/**
 * Detect Python package managers via lockfiles and config files.
 * Wraps the existing detectPackageManager() from python/utils.ts.
 */
export async function detectPythonPackageManagers(
  installDir: string,
): Promise<PackageManagerInfo> {
  const pm = await detectPythonPM({ installDir } as any);
  const info = PYTHON_PM_INFO[pm];

  return {
    detected: [info],
    primary: info,
    recommendation: `Use ${info.label} (${info.installCommand}).`,
  };
}

// ---------------------------------------------------------------------------
// PHP (Composer) helper
// ---------------------------------------------------------------------------

const COMPOSER: DetectedPackageManager = {
  name: 'composer',
  label: 'Composer',
  installCommand: 'composer require',
};

export function composerPackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [COMPOSER],
    primary: COMPOSER,
    recommendation: 'Use Composer (composer require).',
  });
}

// ---------------------------------------------------------------------------
// Swift (SPM) helper
// ---------------------------------------------------------------------------

const SPM: DetectedPackageManager = {
  name: 'spm',
  label: 'Swift Package Manager',
  installCommand: 'swift package add-dependency',
};

export function swiftPackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [SPM],
    primary: SPM,
    recommendation:
      'Use Swift Package Manager. Add the dependency to Package.swift or via Xcode.',
  });
}

// ---------------------------------------------------------------------------
// Ruby (Bundler) helper
// ---------------------------------------------------------------------------

const BUNDLER: DetectedPackageManager = {
  name: 'bundler',
  label: 'Bundler',
  installCommand: 'bundle add',
  runCommand: 'bundle exec',
};

export function bundlerPackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [BUNDLER],
    primary: BUNDLER,
    recommendation: 'Use Bundler (bundle add). Run commands with bundle exec.',
  });
}

// ---------------------------------------------------------------------------
// Android (Gradle) helper
// ---------------------------------------------------------------------------

const GRADLE: DetectedPackageManager = {
  name: 'gradle',
  label: 'Gradle',
  installCommand: 'implementation',
};

export function gradlePackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [GRADLE],
    primary: GRADLE,
    recommendation:
      'Add dependencies to build.gradle(.kts) using implementation().',
  });
}
