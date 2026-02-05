import fg from 'fast-glob';
import clack from '../utils/clack';
import type { WizardOptions } from '../utils/types';
import { createVersionBucket } from '../utils/semver';
import * as fs from 'node:fs';
import * as path from 'node:path';

export enum DjangoProjectType {
  STANDARD = 'standard', // Traditional Django project (django-admin startproject)
  DRF = 'drf', // Django REST Framework API
  WAGTAIL = 'wagtail', // Wagtail CMS
  CHANNELS = 'channels', // Django Channels (async/websockets)
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
 * Get Django version bucket for analytics
 */
export const getDjangoVersionBucket = createVersionBucket();

/**
 * Extract Django version from requirements files or pyproject.toml
 */
export async function getDjangoVersion(
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

      // Try to extract version from requirements.txt format (Django==4.2.0 or Django>=4.0)
      const requirementsMatch = content.match(
        /[Dd]jango[=<>~!]+([0-9]+\.[0-9]+(?:\.[0-9]+)?)/,
      );
      if (requirementsMatch) {
        return requirementsMatch[1];
      }

      // Try to extract from pyproject.toml format
      const pyprojectMatch = content.match(
        /[Dd]jango["\s]*[=<>~!]+\s*["']?([0-9]+\.[0-9]+(?:\.[0-9]+)?)/,
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
 * Check if Django REST Framework is installed
 */
async function hasDRF({
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
      if (content.includes('djangorestframework')) {
        return true;
      }
    } catch {
      continue;
    }
  }

  // Also check INSTALLED_APPS in settings
  const settingsFiles = await fg('**/settings.py', {
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  for (const settingsFile of settingsFiles) {
    try {
      const content = fs.readFileSync(
        path.join(installDir, settingsFile),
        'utf-8',
      );
      if (content.includes('rest_framework')) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

/**
 * Check if Wagtail is installed
 */
async function hasWagtail({
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
      if (content.includes('wagtail')) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

/**
 * Check if Django Channels is installed
 */
async function hasChannels({
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
      if (content.includes('channels')) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

/**
 * Detect Django project type
 */
export async function getDjangoProjectType(
  options: WizardOptions,
): Promise<DjangoProjectType> {
  const { installDir } = options;

  // Check for Wagtail first (CMS)
  if (await hasWagtail({ installDir })) {
    clack.log.info('Detected Django with Wagtail CMS');
    return DjangoProjectType.WAGTAIL;
  }

  // Check for Django REST Framework
  if (await hasDRF({ installDir })) {
    clack.log.info('Detected Django REST Framework project');
    return DjangoProjectType.DRF;
  }

  // Check for Django Channels
  if (await hasChannels({ installDir })) {
    clack.log.info('Detected Django Channels project');
    return DjangoProjectType.CHANNELS;
  }

  // Default to standard Django
  clack.log.info('Detected standard Django project');
  return DjangoProjectType.STANDARD;
}

/**
 * Get human-readable name for Django project type
 */
export function getDjangoProjectTypeName(
  projectType: DjangoProjectType,
): string {
  switch (projectType) {
    case DjangoProjectType.STANDARD:
      return 'Standard Django';
    case DjangoProjectType.DRF:
      return 'Django REST Framework';
    case DjangoProjectType.WAGTAIL:
      return 'Wagtail CMS';
    case DjangoProjectType.CHANNELS:
      return 'Django Channels';
  }
}

/**
 * Find the main Django settings file
 */
export async function findDjangoSettingsFile(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<string | undefined> {
  const { installDir } = options;

  // Look for settings.py files
  const settingsFiles = await fg('**/settings.py', {
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  if (settingsFiles.length === 0) {
    // Try settings/__init__.py for split settings
    const splitSettingsFiles = await fg('**/settings/__init__.py', {
      cwd: installDir,
      ignore: IGNORE_PATTERNS,
    });

    if (splitSettingsFiles.length > 0) {
      return splitSettingsFiles[0];
    }

    return undefined;
  }

  // If multiple settings files, prefer the one next to manage.py or in root
  if (settingsFiles.length === 1) {
    return settingsFiles[0];
  }

  // Try to find the main settings file by looking for ROOT_URLCONF
  for (const settingsFile of settingsFiles) {
    try {
      const content = fs.readFileSync(
        path.join(installDir, settingsFile),
        'utf-8',
      );
      if (content.includes('ROOT_URLCONF')) {
        return settingsFile;
      }
    } catch {
      continue;
    }
  }

  // Default to first found
  return settingsFiles[0];
}

/**
 * Find the main Django urls.py file
 */
export async function findDjangoUrlsFile(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<string | undefined> {
  const { installDir } = options;

  // First, try to find the root urls.py referenced in settings
  const settingsFile = await findDjangoSettingsFile(options);
  if (settingsFile) {
    try {
      const settingsContent = fs.readFileSync(
        path.join(installDir, settingsFile),
        'utf-8',
      );
      const urlconfMatch = settingsContent.match(
        /ROOT_URLCONF\s*=\s*['"]([^'"]+)['"]/,
      );
      if (urlconfMatch) {
        const urlconfPath = urlconfMatch[1].replace(/\./g, '/') + '.py';
        const fullPath = path.join(installDir, urlconfPath);
        if (fs.existsSync(fullPath)) {
          return urlconfPath;
        }
      }
    } catch {
      // Fall through to glob search
    }
  }

  // Fallback to glob search
  const urlsFiles = await fg('**/urls.py', {
    cwd: installDir,
    ignore: [...IGNORE_PATTERNS, '**/admin/**'],
  });

  if (urlsFiles.length === 0) {
    return undefined;
  }

  // Prefer urls.py files that contain urlpatterns
  for (const urlsFile of urlsFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, urlsFile), 'utf-8');
      if (content.includes('urlpatterns')) {
        return urlsFile;
      }
    } catch {
      continue;
    }
  }

  return urlsFiles[0];
}
