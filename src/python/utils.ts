import { execSync } from 'node:child_process';
import type { WizardOptions } from '../utils/types';

export enum PythonPackageManager {
  UV = 'uv',
  POETRY = 'poetry',
  PDM = 'pdm',
  HATCH = 'hatch',
  RYE = 'rye',
  PIPENV = 'pipenv',
  CONDA = 'conda',
  PIP = 'pip',
  UNKNOWN = 'unknown',
}

/**
 * Get the installed Python version
 */
export async function getPythonVersion(
  options: WizardOptions,
): Promise<string | undefined> {
  try {
    const version = execSync('python --version || python3 --version', {
      cwd: options.installDir,
      encoding: 'utf-8',
    })
      .trim()
      .replace('Python ', '');
    return version;
  } catch {
    return undefined;
  }
}

/**
 * Bucket Python version for analytics (e.g., "3.11.x" -> "3.11")
 */
export function getPythonVersionBucket(version: string): string {
  const match = version.match(/^(\d+\.\d+)/);
  return match ? match[1] : version;
}

/**
 * Detect which package manager the project uses
 */
export async function detectPackageManager(
  options: WizardOptions,
): Promise<PythonPackageManager> {
  const { installDir } = options;
  const fs = await import('node:fs');
  const path = await import('node:path');

  // Check for uv (uv.lock)
  if (fs.existsSync(path.join(installDir, 'uv.lock'))) {
    return PythonPackageManager.UV;
  }

  // Check pyproject.toml for various tools
  if (fs.existsSync(path.join(installDir, 'pyproject.toml'))) {
    try {
      const content = fs.readFileSync(
        path.join(installDir, 'pyproject.toml'),
        'utf-8',
      );

      // Check for Poetry
      if (content.includes('[tool.poetry]')) {
        return PythonPackageManager.POETRY;
      }

      // Check for PDM
      if (content.includes('[tool.pdm]')) {
        return PythonPackageManager.PDM;
      }

      // Check for Hatch
      if (content.includes('[tool.hatch]')) {
        return PythonPackageManager.HATCH;
      }

      // Check for Rye
      if (content.includes('[tool.rye]')) {
        return PythonPackageManager.RYE;
      }
    } catch {
      // Continue checking
    }
  }

  // Check for Poetry lock file
  if (fs.existsSync(path.join(installDir, 'poetry.lock'))) {
    return PythonPackageManager.POETRY;
  }

  // Check for PDM lock file
  if (fs.existsSync(path.join(installDir, 'pdm.lock'))) {
    return PythonPackageManager.PDM;
  }

  // Check for Pipenv (Pipfile or Pipfile.lock)
  if (
    fs.existsSync(path.join(installDir, 'Pipfile')) ||
    fs.existsSync(path.join(installDir, 'Pipfile.lock'))
  ) {
    return PythonPackageManager.PIPENV;
  }

  // Check for Conda (environment.yml or environment.yaml)
  if (
    fs.existsSync(path.join(installDir, 'environment.yml')) ||
    fs.existsSync(path.join(installDir, 'environment.yaml'))
  ) {
    return PythonPackageManager.CONDA;
  }

  // Check for pip (requirements.txt, setup.py, setup.cfg, or pyproject.toml)
  if (
    fs.existsSync(path.join(installDir, 'requirements.txt')) ||
    fs.existsSync(path.join(installDir, 'setup.py')) ||
    fs.existsSync(path.join(installDir, 'setup.cfg')) ||
    fs.existsSync(path.join(installDir, 'pyproject.toml'))
  ) {
    return PythonPackageManager.PIP;
  }

  // Check for requirements directory
  try {
    const requirementsDir = path.join(installDir, 'requirements');
    if (
      fs.existsSync(requirementsDir) &&
      fs.statSync(requirementsDir).isDirectory()
    ) {
      const files = fs.readdirSync(requirementsDir);
      if (files.some((f) => f.endsWith('.txt'))) {
        return PythonPackageManager.PIP;
      }
    }
  } catch {
    // Continue
  }

  return PythonPackageManager.UNKNOWN;
}

/**
 * Get package manager display name
 */
export function getPackageManagerName(
  packageManager: PythonPackageManager,
): string {
  switch (packageManager) {
    case PythonPackageManager.UV:
      return 'uv';
    case PythonPackageManager.POETRY:
      return 'Poetry';
    case PythonPackageManager.PDM:
      return 'PDM';
    case PythonPackageManager.HATCH:
      return 'Hatch';
    case PythonPackageManager.RYE:
      return 'Rye';
    case PythonPackageManager.PIPENV:
      return 'Pipenv';
    case PythonPackageManager.CONDA:
      return 'Conda';
    case PythonPackageManager.PIP:
      return 'pip';
    case PythonPackageManager.UNKNOWN:
      return 'unknown';
  }
}
