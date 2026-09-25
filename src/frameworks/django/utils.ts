import { boundedGlob, readProjectFile } from '@utils/bounded-fs';
import { getUI } from '@ui';
import type { WizardRunOptions } from '@utils/types';
import { createVersionBucket } from '@utils/semver';
import * as fs from 'node:fs';
import * as path from 'node:path';

export enum DjangoProjectType {
  STANDARD = 'standard', // Traditional Django project (django-admin startproject)
  DRF = 'drf', // Django REST Framework API
  WAGTAIL = 'wagtail', // Wagtail CMS
  CHANNELS = 'channels', // Django Channels (async/websockets)
}

const EXTRA_IGNORE = ['**/env/**', '**/.env/**', '**/migrations/**'];

/**
 * Get Django version bucket for analytics
 */
export const getDjangoVersionBucket = createVersionBucket();

/**
 * Extract Django version from requirements files or pyproject.toml
 */
export async function getDjangoVersion(
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
  }

  return undefined;
}

/**
 * Check if Django REST Framework is installed
 */
async function hasDRF({
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
    if (content?.includes('djangorestframework')) {
      return true;
    }
  }

  // Also check INSTALLED_APPS in settings
  const settingsFiles = await boundedGlob('**/settings.py', {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
  });

  for (const settingsFile of settingsFiles) {
    const content = readProjectFile(path.join(installDir, settingsFile));
    if (content?.includes('rest_framework')) {
      return true;
    }
  }

  return false;
}

/**
 * Check if Wagtail is installed
 */
async function hasWagtail({
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
    if (content?.includes('wagtail')) {
      return true;
    }
  }

  return false;
}

/**
 * Check if Django Channels is installed
 */
async function hasChannels({
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
    if (content?.includes('channels')) {
      return true;
    }
  }

  return false;
}

/**
 * Detect Django project type
 */
export async function getDjangoProjectType(
  options: WizardRunOptions,
): Promise<DjangoProjectType> {
  const { installDir } = options;

  // Check for Wagtail first (CMS)
  if (await hasWagtail({ installDir })) {
    getUI().setDetectedFramework('Django with Wagtail CMS');
    return DjangoProjectType.WAGTAIL;
  }

  // Check for Django REST Framework
  if (await hasDRF({ installDir })) {
    getUI().setDetectedFramework('Django REST Framework');
    return DjangoProjectType.DRF;
  }

  // Check for Django Channels
  if (await hasChannels({ installDir })) {
    getUI().setDetectedFramework('Django Channels');
    return DjangoProjectType.CHANNELS;
  }

  // Default to standard Django
  getUI().setDetectedFramework('Django');
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
  options: Pick<WizardRunOptions, 'installDir'>,
): Promise<string | undefined> {
  const { installDir } = options;

  // Look for settings.py files
  const settingsFiles = await boundedGlob('**/settings.py', {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
  });

  if (settingsFiles.length === 0) {
    // Try settings/__init__.py for split settings
    const splitSettingsFiles = await boundedGlob('**/settings/__init__.py', {
      cwd: installDir,
      extraIgnore: EXTRA_IGNORE,
      limit: 1,
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
    const content = readProjectFile(path.join(installDir, settingsFile));
    if (content?.includes('ROOT_URLCONF')) {
      return settingsFile;
    }
  }

  // Default to first found
  return settingsFiles[0];
}

/**
 * Find the main Django urls.py file
 */
export async function findDjangoUrlsFile(
  options: Pick<WizardRunOptions, 'installDir'>,
): Promise<string | undefined> {
  const { installDir } = options;

  // First, try to find the root urls.py referenced in settings
  const settingsFile = await findDjangoSettingsFile(options);
  if (settingsFile) {
    const settingsContent = readProjectFile(
      path.join(installDir, settingsFile),
    );
    const urlconfMatch = settingsContent?.match(
      /ROOT_URLCONF\s*=\s*['"]([^'"]+)['"]/,
    );
    if (urlconfMatch) {
      const urlconfPath = urlconfMatch[1].replace(/\./g, '/') + '.py';
      const fullPath = path.join(installDir, urlconfPath);
      if (fs.existsSync(fullPath)) {
        return urlconfPath;
      }
    }
  }

  // Fallback to glob search
  const urlsFiles = await boundedGlob('**/urls.py', {
    cwd: installDir,
    extraIgnore: [...EXTRA_IGNORE, '**/admin/**'],
  });

  if (urlsFiles.length === 0) {
    return undefined;
  }

  // Prefer urls.py files that contain urlpatterns
  for (const urlsFile of urlsFiles) {
    const content = readProjectFile(path.join(installDir, urlsFile));
    if (content?.includes('urlpatterns')) {
      return urlsFile;
    }
  }

  return urlsFiles[0];
}
