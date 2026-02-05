import { major, minVersion } from 'semver';
import fg from 'fast-glob';
import clack from '../utils/clack';
import type { WizardOptions } from '../utils/types';
import * as fs from 'node:fs';
import * as path from 'node:path';

export enum FastAPIProjectType {
  STANDARD = 'standard', // Basic FastAPI app
  ROUTER = 'router', // FastAPI with APIRouter
  FULLSTACK = 'fullstack', // FastAPI with templates (Jinja2)
}

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/venv/**',
  '**/.venv/**',
  '**/env/**',
  '**/.env/**',
  '**/__pycache__/**',
  '**/migrations/**',
];

/**
 * Get FastAPI version bucket for analytics
 */
export function getFastAPIVersionBucket(version: string | undefined): string {
  if (!version) {
    return 'none';
  }

  try {
    const minVer = minVersion(version);
    if (!minVer) {
      return 'invalid';
    }
    const majorVersion = major(minVer);
    // FastAPI 0.x is still the common version range
    if (majorVersion === 0) {
      return '0.x';
    }
    return `${majorVersion}.x`;
  } catch {
    return 'unknown';
  }
}

/**
 * Extract FastAPI version from requirements files or pyproject.toml
 */
export async function getFastAPIVersion(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<string | undefined> {
  const { installDir } = options;

  // Check requirements files
  const requirementsFiles = await fg(
    ['**/requirements*.txt', '**/pyproject.toml', '**/setup.py', '**/Pipfile'],
    {
      cwd: installDir,
      ignore: IGNORE_PATTERNS,
    },
  );

  for (const reqFile of requirementsFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, reqFile), 'utf-8');

      // Try to extract version from requirements.txt format (fastapi==0.109.0 or fastapi>=0.100)
      const requirementsMatch = content.match(
        /[Ff]ast[Aa][Pp][Ii][=<>~!]+([0-9]+\.[0-9]+(?:\.[0-9]+)?)/,
      );
      if (requirementsMatch) {
        return requirementsMatch[1];
      }

      // Try to extract from pyproject.toml format
      const pyprojectMatch = content.match(
        /[Ff]ast[Aa][Pp][Ii]["\s]*[=<>~!]+\s*["']?([0-9]+\.[0-9]+(?:\.[0-9]+)?)/,
      );
      if (pyprojectMatch) {
        return pyprojectMatch[1];
      }
    } catch {
      // Skip files that can't be read
      continue;
    }
  }

  return undefined;
}

/**
 * Check if app uses FastAPI APIRouter
 */
async function hasAPIRouter({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<boolean> {
  const pyFiles = await fg(['**/*.py'], {
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  for (const pyFile of pyFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, pyFile), 'utf-8');
      if (
        content.includes('APIRouter(') ||
        content.includes('include_router(') ||
        content.includes('from fastapi import APIRouter')
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
 * Check if app uses Jinja2 templates (fullstack pattern)
 */
async function hasTemplates({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<boolean> {
  // Check for Jinja2Templates usage in Python files
  const pyFiles = await fg(['**/*.py'], {
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  for (const pyFile of pyFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, pyFile), 'utf-8');
      if (
        content.includes('Jinja2Templates') ||
        content.includes('from fastapi.templating import')
      ) {
        return true;
      }
    } catch {
      continue;
    }
  }

  // Check for templates directory
  const templateDirs = await fg(['**/templates'], {
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
    onlyDirectories: true,
  });

  return templateDirs.length > 0;
}

/**
 * Detect FastAPI project type
 */
export async function getFastAPIProjectType(
  options: WizardOptions,
): Promise<FastAPIProjectType> {
  const { installDir } = options;

  // Check for fullstack pattern (templates)
  if (await hasTemplates({ installDir })) {
    clack.log.info('Detected FastAPI fullstack project with templates');
    return FastAPIProjectType.FULLSTACK;
  }

  // Check for APIRouter (modular structure)
  if (await hasAPIRouter({ installDir })) {
    clack.log.info('Detected FastAPI project with APIRouter');
    return FastAPIProjectType.ROUTER;
  }

  // Default to standard FastAPI
  clack.log.info('Detected standard FastAPI project');
  return FastAPIProjectType.STANDARD;
}

/**
 * Get human-readable name for FastAPI project type
 */
export function getFastAPIProjectTypeName(
  projectType: FastAPIProjectType,
): string {
  switch (projectType) {
    case FastAPIProjectType.STANDARD:
      return 'Standard FastAPI';
    case FastAPIProjectType.ROUTER:
      return 'FastAPI with APIRouter';
    case FastAPIProjectType.FULLSTACK:
      return 'FastAPI Fullstack';
  }
}

/**
 * Find the main FastAPI app file
 */
export async function findFastAPIAppFile(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<string | undefined> {
  const { installDir } = options;

  // Common FastAPI app file patterns
  const commonPatterns = [
    '**/main.py',
    '**/app.py',
    '**/application.py',
    '**/api.py',
    '**/__init__.py',
  ];

  const appFiles = await fg(commonPatterns, {
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  // Look for files with FastAPI() instantiation
  for (const appFile of appFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, appFile), 'utf-8');
      // Check for FastAPI app instantiation
      if (
        content.includes('FastAPI(') ||
        content.includes('from fastapi import FastAPI')
      ) {
        return appFile;
      }
    } catch {
      continue;
    }
  }

  // If no file with FastAPI() found, check all Python files
  const allPyFiles = await fg(['**/*.py'], {
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  for (const pyFile of allPyFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, pyFile), 'utf-8');
      if (content.includes('FastAPI(')) {
        return pyFile;
      }
    } catch {
      continue;
    }
  }

  // Return first common pattern file if exists
  if (appFiles.length > 0) {
    return appFiles[0];
  }

  return undefined;
}
