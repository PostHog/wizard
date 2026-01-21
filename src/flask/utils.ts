import { major, minVersion } from 'semver';
import fg from 'fast-glob';
import clack from '../utils/clack';
import type { WizardOptions } from '../utils/types';
import * as fs from 'node:fs';
import * as path from 'node:path';

export enum FlaskProjectType {
  STANDARD = 'standard', // Basic Flask app
  RESTFUL = 'restful', // Flask-RESTful API
  RESTX = 'restx', // Flask-RESTX (Swagger docs)
  SMOREST = 'smorest', // flask-smorest (OpenAPI)
  BLUEPRINT = 'blueprint', // Large app with blueprints
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
  '**/instance/**',
];

/**
 * Get Flask version bucket for analytics
 */
export function getFlaskVersionBucket(version: string | undefined): string {
  if (!version) {
    return 'none';
  }

  try {
    const minVer = minVersion(version);
    if (!minVer) {
      return 'invalid';
    }
    const majorVersion = major(minVer);
    if (majorVersion >= 2) {
      return `${majorVersion}.x`;
    }
    return `<2.0.0`;
  } catch {
    return 'unknown';
  }
}

/**
 * Extract Flask version from requirements files or pyproject.toml
 */
export async function getFlaskVersion(
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

      // Try to extract version from requirements.txt format (Flask==3.0.0 or flask>=2.0)
      const requirementsMatch = content.match(
        /[Ff]lask[=<>~!]+([0-9]+\.[0-9]+(?:\.[0-9]+)?)/,
      );
      if (requirementsMatch) {
        return requirementsMatch[1];
      }

      // Try to extract from pyproject.toml format
      const pyprojectMatch = content.match(
        /[Ff]lask["\s]*[=<>~!]+\s*["']?([0-9]+\.[0-9]+(?:\.[0-9]+)?)/,
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
 * Check if Flask-RESTful is installed
 */
async function hasFlaskRESTful({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<boolean> {
  const requirementsFiles = await fg(
    ['**/requirements*.txt', '**/pyproject.toml', '**/Pipfile'],
    {
      cwd: installDir,
      ignore: IGNORE_PATTERNS,
    },
  );

  for (const reqFile of requirementsFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, reqFile), 'utf-8');
      if (
        content.includes('flask-restful') ||
        content.includes('Flask-RESTful')
      ) {
        return true;
      }
    } catch {
      continue;
    }
  }

  // Also check imports in Python files
  const pyFiles = await fg(['**/*.py'], {
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  for (const pyFile of pyFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, pyFile), 'utf-8');
      if (
        content.includes('from flask_restful import') ||
        content.includes('import flask_restful')
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
 * Check if Flask-RESTX is installed
 */
async function hasFlaskRESTX({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<boolean> {
  const requirementsFiles = await fg(
    ['**/requirements*.txt', '**/pyproject.toml', '**/Pipfile'],
    {
      cwd: installDir,
      ignore: IGNORE_PATTERNS,
    },
  );

  for (const reqFile of requirementsFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, reqFile), 'utf-8');
      if (content.includes('flask-restx') || content.includes('Flask-RESTX')) {
        return true;
      }
    } catch {
      continue;
    }
  }

  // Also check imports in Python files
  const pyFiles = await fg(['**/*.py'], {
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  for (const pyFile of pyFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, pyFile), 'utf-8');
      if (
        content.includes('from flask_restx import') ||
        content.includes('import flask_restx')
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
 * Check if flask-smorest is installed
 */
async function hasFlaskSmorest({
  installDir,
}: Pick<WizardOptions, 'installDir'>): Promise<boolean> {
  const requirementsFiles = await fg(
    ['**/requirements*.txt', '**/pyproject.toml', '**/Pipfile'],
    {
      cwd: installDir,
      ignore: IGNORE_PATTERNS,
    },
  );

  for (const reqFile of requirementsFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, reqFile), 'utf-8');
      if (content.includes('flask-smorest')) {
        return true;
      }
    } catch {
      continue;
    }
  }

  // Also check imports in Python files
  const pyFiles = await fg(['**/*.py'], {
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  for (const pyFile of pyFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, pyFile), 'utf-8');
      if (
        content.includes('from flask_smorest import') ||
        content.includes('import flask_smorest')
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
 * Check if app uses Flask Blueprints
 */
async function hasBlueprints({
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
        content.includes('Blueprint(') ||
        content.includes('register_blueprint(') ||
        content.includes('from flask import Blueprint')
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
 * Detect Flask project type
 */
export async function getFlaskProjectType(
  options: WizardOptions,
): Promise<FlaskProjectType> {
  const { installDir } = options;

  // Check for Flask-RESTX first (most specific - includes Swagger)
  if (await hasFlaskRESTX({ installDir })) {
    clack.log.info('Detected Flask-RESTX project');
    return FlaskProjectType.RESTX;
  }

  // Check for flask-smorest (OpenAPI-first)
  if (await hasFlaskSmorest({ installDir })) {
    clack.log.info('Detected flask-smorest project');
    return FlaskProjectType.SMOREST;
  }

  // Check for Flask-RESTful
  if (await hasFlaskRESTful({ installDir })) {
    clack.log.info('Detected Flask-RESTful project');
    return FlaskProjectType.RESTFUL;
  }

  // Check for Blueprints (large app structure)
  if (await hasBlueprints({ installDir })) {
    clack.log.info('Detected Flask project with Blueprints');
    return FlaskProjectType.BLUEPRINT;
  }

  // Default to standard Flask
  clack.log.info('Detected standard Flask project');
  return FlaskProjectType.STANDARD;
}

/**
 * Get human-readable name for Flask project type
 */
export function getFlaskProjectTypeName(projectType: FlaskProjectType): string {
  switch (projectType) {
    case FlaskProjectType.STANDARD:
      return 'Standard Flask';
    case FlaskProjectType.RESTFUL:
      return 'Flask-RESTful';
    case FlaskProjectType.RESTX:
      return 'Flask-RESTX';
    case FlaskProjectType.SMOREST:
      return 'flask-smorest';
    case FlaskProjectType.BLUEPRINT:
      return 'Flask with Blueprints';
  }
}

/**
 * Find the main Flask app file
 */
export async function findFlaskAppFile(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<string | undefined> {
  const { installDir } = options;

  // Common Flask app file patterns
  const commonPatterns = [
    '**/app.py',
    '**/wsgi.py',
    '**/application.py',
    '**/run.py',
    '**/main.py',
    '**/__init__.py',
  ];

  const appFiles = await fg(commonPatterns, {
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  // Look for files with Flask() instantiation or create_app() factory
  for (const appFile of appFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, appFile), 'utf-8');
      // Check for Flask app instantiation or application factory
      if (
        content.includes('Flask(__name__)') ||
        content.includes('Flask(') ||
        content.includes('def create_app(')
      ) {
        return appFile;
      }
    } catch {
      continue;
    }
  }

  // If no file with Flask() found, check all Python files
  const allPyFiles = await fg(['**/*.py'], {
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  for (const pyFile of allPyFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, pyFile), 'utf-8');
      if (
        content.includes('Flask(__name__)') ||
        content.includes('def create_app(')
      ) {
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
