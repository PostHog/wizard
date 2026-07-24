import { boundedGlob, readProjectFile } from '@utils/bounded-fs';
import { getUI } from '@ui';
import type { WizardRunOptions } from '@utils/types';
import { createVersionBucket } from '@utils/semver';
import * as path from 'node:path';

export enum FlaskProjectType {
  STANDARD = 'standard', // Basic Flask app
  RESTFUL = 'restful', // Flask-RESTful API
  RESTX = 'restx', // Flask-RESTX (Swagger docs)
  SMOREST = 'smorest', // flask-smorest (OpenAPI)
  BLUEPRINT = 'blueprint', // Large app with blueprints
}

const EXTRA_IGNORE = [
  '**/env/**',
  '**/.env/**',
  '**/migrations/**',
  '**/instance/**',
];

/** Import probes read at most this many files — holding one ≤MAX_PROJECT_FILE_BYTES file in memory at a time. */
const SOURCE_PROBE_LIMIT = 200;

/**
 * Get Flask version bucket for analytics
 */
export const getFlaskVersionBucket = createVersionBucket();

/**
 * Extract Flask version from requirements files or pyproject.toml
 */
export async function getFlaskVersion(
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
  }

  return undefined;
}

/**
 * Check if Flask-RESTful is installed
 */
async function hasFlaskRESTful({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<boolean> {
  const requirementsFiles = await boundedGlob(
    ['**/requirements*.txt', '**/pyproject.toml', '**/Pipfile'],
    {
      cwd: installDir,
      extraIgnore: EXTRA_IGNORE,
    },
  );

  for (const reqFile of requirementsFiles) {
    const content = readProjectFile(path.join(installDir, reqFile));
    if (!content) continue;
    if (
      content.includes('flask-restful') ||
      content.includes('Flask-RESTful')
    ) {
      return true;
    }
  }

  // Also check imports in Python files
  const pyFiles = await boundedGlob(['**/*.py'], {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
    limit: SOURCE_PROBE_LIMIT,
  });

  for (const pyFile of pyFiles) {
    const content = readProjectFile(path.join(installDir, pyFile));
    if (!content) continue;
    if (
      content.includes('from flask_restful import') ||
      content.includes('import flask_restful')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if Flask-RESTX is installed
 */
async function hasFlaskRESTX({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<boolean> {
  const requirementsFiles = await boundedGlob(
    ['**/requirements*.txt', '**/pyproject.toml', '**/Pipfile'],
    {
      cwd: installDir,
      extraIgnore: EXTRA_IGNORE,
    },
  );

  for (const reqFile of requirementsFiles) {
    const content = readProjectFile(path.join(installDir, reqFile));
    if (!content) continue;
    if (content.includes('flask-restx') || content.includes('Flask-RESTX')) {
      return true;
    }
  }

  // Also check imports in Python files
  const pyFiles = await boundedGlob(['**/*.py'], {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
    limit: SOURCE_PROBE_LIMIT,
  });

  for (const pyFile of pyFiles) {
    const content = readProjectFile(path.join(installDir, pyFile));
    if (!content) continue;
    if (
      content.includes('from flask_restx import') ||
      content.includes('import flask_restx')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if flask-smorest is installed
 */
async function hasFlaskSmorest({
  installDir,
}: Pick<WizardRunOptions, 'installDir'>): Promise<boolean> {
  const requirementsFiles = await boundedGlob(
    ['**/requirements*.txt', '**/pyproject.toml', '**/Pipfile'],
    {
      cwd: installDir,
      extraIgnore: EXTRA_IGNORE,
    },
  );

  for (const reqFile of requirementsFiles) {
    const content = readProjectFile(path.join(installDir, reqFile));
    if (!content) continue;
    if (content.includes('flask-smorest')) {
      return true;
    }
  }

  // Also check imports in Python files
  const pyFiles = await boundedGlob(['**/*.py'], {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
    limit: SOURCE_PROBE_LIMIT,
  });

  for (const pyFile of pyFiles) {
    const content = readProjectFile(path.join(installDir, pyFile));
    if (!content) continue;
    if (
      content.includes('from flask_smorest import') ||
      content.includes('import flask_smorest')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if app uses Flask Blueprints
 */
async function hasBlueprints({
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
      content.includes('Blueprint(') ||
      content.includes('register_blueprint(') ||
      content.includes('from flask import Blueprint')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Detect Flask project type
 */
export async function getFlaskProjectType(
  options: WizardRunOptions,
): Promise<FlaskProjectType> {
  const { installDir } = options;

  // Check for Flask-RESTX first (most specific - includes Swagger)
  if (await hasFlaskRESTX({ installDir })) {
    getUI().setDetectedFramework('Flask-RESTX');
    return FlaskProjectType.RESTX;
  }

  // Check for flask-smorest (OpenAPI-first)
  if (await hasFlaskSmorest({ installDir })) {
    getUI().setDetectedFramework('flask-smorest');
    return FlaskProjectType.SMOREST;
  }

  // Check for Flask-RESTful
  if (await hasFlaskRESTful({ installDir })) {
    getUI().setDetectedFramework('Flask-RESTful');
    return FlaskProjectType.RESTFUL;
  }

  // Check for Blueprints (large app structure)
  if (await hasBlueprints({ installDir })) {
    getUI().setDetectedFramework('Flask with Blueprints');
    return FlaskProjectType.BLUEPRINT;
  }

  // Default to standard Flask
  getUI().setDetectedFramework('Flask');
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
  options: Pick<WizardRunOptions, 'installDir'>,
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

  const appFiles = await boundedGlob(commonPatterns, {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
  });

  // Look for files with Flask() instantiation or create_app() factory
  for (const appFile of appFiles) {
    const content = readProjectFile(path.join(installDir, appFile));
    if (!content) continue;
    // Check for Flask app instantiation or application factory
    if (
      content.includes('Flask(__name__)') ||
      content.includes('Flask(') ||
      content.includes('def create_app(')
    ) {
      return appFile;
    }
  }

  // If no file with Flask() found, check all Python files
  const allPyFiles = await boundedGlob(['**/*.py'], {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
    limit: SOURCE_PROBE_LIMIT,
  });

  for (const pyFile of allPyFiles) {
    const content = readProjectFile(path.join(installDir, pyFile));
    if (!content) continue;
    if (
      content.includes('Flask(__name__)') ||
      content.includes('def create_app(')
    ) {
      return pyFile;
    }
  }

  // Return first common pattern file if exists
  if (appFiles.length > 0) {
    return appFiles[0];
  }

  return undefined;
}
