/**
 * Cross-ecosystem package manager detection.
 *
 * Each FrameworkConfig implements the PackageManagerDetector contract; the
 * helpers here cover the Python, PHP, Swift, Ruby, Rust, Elixir, Go, Flutter,
 * Android and Java ecosystems (Node is in `@utils/package-manager`). The
 * `detect_package_manager` tool delegates to whatever detector the current
 * framework supplies.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  detectNodePackageManagers,
  type DetectedPackageManager,
  type PackageManagerDetector,
  type PackageManagerInfo,
} from '@utils/package-manager';

// The detector contract and the Node detector live in `@utils/package-manager`
// (the agent's tools need them without importing detection); re-exported so
// every framework keeps its import path.
export { detectNodePackageManagers };
export type {
  DetectedPackageManager,
  PackageManagerDetector,
  PackageManagerInfo,
};
import {
  detectPackageManager as detectPythonPM,
  PythonPackageManager,
} from '@frameworks/python/utils';

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
// Rust (Cargo) helper
// ---------------------------------------------------------------------------

const CARGO: DetectedPackageManager = {
  name: 'cargo',
  label: 'Cargo',
  installCommand: 'cargo add',
};

export function cargoPackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [CARGO],
    primary: CARGO,
    recommendation: 'Use Cargo (cargo add).',
  });
}

// ---------------------------------------------------------------------------
// Elixir (Mix) helper
// ---------------------------------------------------------------------------

const MIX: DetectedPackageManager = {
  name: 'mix',
  label: 'Mix',
  installCommand: 'mix deps.get',
};

export function mixPackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [MIX],
    primary: MIX,
    recommendation:
      'Use Mix. Add the dependency to the deps list in mix.exs, then run mix deps.get.',
  });
}

// ---------------------------------------------------------------------------
// Go (modules) helper
// ---------------------------------------------------------------------------

const GO_MODULES: DetectedPackageManager = {
  name: 'go',
  label: 'Go modules',
  installCommand: 'go get',
};

export function goModulesPackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [GO_MODULES],
    primary: GO_MODULES,
    recommendation:
      'Use Go modules (go get). Run go mod tidy after imports change.',
  });
}

// ---------------------------------------------------------------------------
// Flutter (pub) helper
// ---------------------------------------------------------------------------

const PUB: DetectedPackageManager = {
  name: 'pub',
  label: 'pub',
  installCommand: 'flutter pub add',
  runCommand: 'flutter',
};

export function pubPackageManager(): Promise<PackageManagerInfo> {
  return Promise.resolve({
    detected: [PUB],
    primary: PUB,
    recommendation:
      'Use flutter pub add to add dependencies; it updates pubspec.yaml automatically.',
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

// ---------------------------------------------------------------------------
// Java (Maven or Gradle) helper
// ---------------------------------------------------------------------------

const MAVEN: DetectedPackageManager = {
  name: 'maven',
  label: 'Maven',
  installCommand: 'mvn install',
};

/**
 * Java backends split between Maven and Gradle; pom.xml decides.
 * Defaults to Gradle when neither manifest is present.
 */
export function detectJavaPackageManagers(
  installDir: string,
): Promise<PackageManagerInfo> {
  if (fs.existsSync(path.join(installDir, 'pom.xml'))) {
    return Promise.resolve({
      detected: [MAVEN],
      primary: MAVEN,
      recommendation:
        'Use Maven. Add the dependency to pom.xml, then run mvn install to resolve it.',
    });
  }
  return gradlePackageManager();
}
