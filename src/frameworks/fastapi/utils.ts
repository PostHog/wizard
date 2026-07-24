import { major, minVersion } from 'semver';
import { boundedGlob, readProjectFile } from '@utils/bounded-fs';
import { getUI } from '@ui';
import type { WizardRunOptions } from '@utils/types';
import * as path from 'node:path';

export enum FastAPIProjectType {
  STANDARD = 'standard', // Basic FastAPI app
  ROUTER = 'router', // FastAPI with APIRouter
  FULLSTACK = 'fullstack', // FastAPI with templates (Jinja2)
}

const EXTRA_IGNORE = ['**/env/**', '**/.env/**', '**/migrations/**'];

/** Import probes read at most this many files — holding one ≤MAX_PROJECT_FILE_BYTES file in memory at a time. */
const SOURCE_PROBE_LIMIT = 200;

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
  options: Pick<WizardRunOptions, 'installDir'>,
): Promise<string | undefined> {
  const { installDir } = options;

  // Check requirements files
  const requirementsFiles = await boundedGlob(
    ['**/requirements*.txt', '**/pyproject.toml', '**/setup.py', '**/Pipfile'],
    {
      cwd: installDir,
      extraIgnore: EXTRA_IGNORE,
    },
  );

  for (const reqFile of requirementsFiles) {
    const content = readProjectFile(path.join(installDir, reqFile));
    if (!content) continue;

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
  }

  return undefined;
}

/**
 * Check if app uses FastAPI APIRouter
 */
async function hasAPIRouter({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<boolean> {
  const pyFiles = await boundedGlob(['**/*.py'], {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
    limit: SOURCE_PROBE_LIMIT,
  });

  for (const pyFile of pyFiles) {
    const content = readProjectFile(path.join(installDir, pyFile));
    if (!content) continue;
    if (
      content.includes('APIRouter(') ||
      content.includes('include_router(') ||
      content.includes('from fastapi import APIRouter')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if app uses Jinja2 templates (fullstack pattern)
 */
async function hasTemplates({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<boolean> {
  // Check for Jinja2Templates usage in Python files
  const pyFiles = await boundedGlob(['**/*.py'], {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
    limit: SOURCE_PROBE_LIMIT,
  });

  for (const pyFile of pyFiles) {
    const content = readProjectFile(path.join(installDir, pyFile));
    if (!content) continue;
    if (
      content.includes('Jinja2Templates') ||
      content.includes('from fastapi.templating import')
    ) {
      return true;
    }
  }

  // Check for templates directory
  const templateFiles = await boundedGlob(['**/templates/**'], {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
    limit: 1,
  });

  return templateFiles.length > 0;
}

/**
 * Detect FastAPI project type
 */
export async function getFastAPIProjectType(
  options: WizardRunOptions,
): Promise<FastAPIProjectType> {
  const { installDir } = options;

  // Check for fullstack pattern (templates)
  if (await hasTemplates({ installDir })) {
    getUI().setDetectedFramework('FastAPI fullstack with templates');
    return FastAPIProjectType.FULLSTACK;
  }

  // Check for APIRouter (modular structure)
  if (await hasAPIRouter({ installDir })) {
    getUI().setDetectedFramework('FastAPI with APIRouter');
    return FastAPIProjectType.ROUTER;
  }

  // Default to standard FastAPI
  getUI().setDetectedFramework('FastAPI');
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
  options: Pick<WizardRunOptions, 'installDir'>,
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

  const appFiles = await boundedGlob(commonPatterns, {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
  });

  // Look for files with FastAPI() instantiation
  for (const appFile of appFiles) {
    const content = readProjectFile(path.join(installDir, appFile));
    if (!content) continue;
    // Check for FastAPI app instantiation
    if (
      content.includes('FastAPI(') ||
      content.includes('from fastapi import FastAPI')
    ) {
      return appFile;
    }
  }

  // If no file with FastAPI() found, check all Python files
  const allPyFiles = await boundedGlob(['**/*.py'], {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
    limit: SOURCE_PROBE_LIMIT,
  });

  for (const pyFile of allPyFiles) {
    const content = readProjectFile(path.join(installDir, pyFile));
    if (content?.includes('FastAPI(')) {
      return pyFile;
    }
  }

  // Return first common pattern file if exists
  if (appFiles.length > 0) {
    return appFiles[0];
  }

  return undefined;
}
