import { boundedGlob, readProjectFile } from '@utils/bounded-fs';
import { getUI } from '@ui';
import type { WizardRunOptions } from '@utils/types';
import { createVersionBucket } from '@utils/semver';
import * as fs from 'node:fs';
import * as path from 'node:path';

export enum LaravelProjectType {
  STANDARD = 'standard', // Basic Laravel app
  INERTIA = 'inertia', // Inertia.js (Vue/React SPA) - may need JS SDK too
  LIVEWIRE = 'livewire', // Livewire (reactive components, includes Filament)
}

const EXTRA_IGNORE = [
  '**/storage/**',
  '**/bootstrap/cache/**',
  '**/.phpunit.cache/**',
  '**/public/build/**',
  '**/public/hot/**',
];

/** Import probes read at most this many files — holding one ≤MAX_PROJECT_FILE_BYTES file in memory at a time. */
const SOURCE_PROBE_LIMIT = 200;

/**
 * Get Laravel version bucket for analytics
 */
export const getLaravelVersionBucket = createVersionBucket();

/**
 * Read and parse composer.json
 */
export function getComposerJson(
  options: Pick<WizardRunOptions, 'installDir'>,
): Record<string, any> | undefined {
  const { installDir } = options;

  const composerPath = path.join(installDir, 'composer.json');
  try {
    const content = fs.readFileSync(composerPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/**
 * Check if a package is installed (present in composer.json)
 */
function hasComposerPackage(
  packageName: string,
  options: Pick<WizardRunOptions, 'installDir'>,
): boolean {
  const composer = getComposerJson(options);
  if (!composer) return false;

  return !!(
    composer.require?.[packageName] || composer['require-dev']?.[packageName]
  );
}

/**
 * Extract version for a package from composer.json
 */
function getComposerPackageVersion(
  packageName: string,
  options: Pick<WizardRunOptions, 'installDir'>,
): string | undefined {
  const composer = getComposerJson(options);
  if (!composer) return undefined;

  const version =
    composer.require?.[packageName] || composer['require-dev']?.[packageName];
  if (version) {
    // Clean version string (remove ^, ~, >=, etc.)
    return version.replace(/^[\^~>=<]+/, '');
  }

  return undefined;
}

/**
 * Check if a pattern exists in PHP source files
 */
async function hasLaravelCodePattern(
  pattern: RegExp | string,
  options: Pick<WizardRunOptions, 'installDir'>,
  filePatterns: string[] = ['**/*.php'],
): Promise<boolean> {
  const { installDir } = options;

  const phpFiles = await boundedGlob(filePatterns, {
    cwd: installDir,
    extraIgnore: EXTRA_IGNORE,
    limit: SOURCE_PROBE_LIMIT,
  });

  const searchPattern =
    typeof pattern === 'string' ? new RegExp(pattern) : pattern;

  for (const phpFile of phpFiles) {
    const content = readProjectFile(path.join(installDir, phpFile));
    if (!content) continue;
    if (searchPattern.test(content)) return true;
  }

  return false;
}

/**
 * Get Laravel version from composer.json
 */
export function getLaravelVersion(
  options: Pick<WizardRunOptions, 'installDir'>,
): string | undefined {
  return getComposerPackageVersion('laravel/framework', options);
}

/**
 * Get human-readable name for Laravel project type
 */
export function getLaravelProjectTypeName(
  projectType: LaravelProjectType,
): string {
  switch (projectType) {
    case LaravelProjectType.STANDARD:
      return 'Standard Laravel';
    case LaravelProjectType.INERTIA:
      return 'Laravel with Inertia.js';
    case LaravelProjectType.LIVEWIRE:
      return 'Laravel with Livewire';
    default:
      return 'Laravel';
  }
}

/**
 * Check for Inertia.js
 */
async function hasInertia(
  options: Pick<WizardRunOptions, 'installDir'>,
): Promise<boolean> {
  return (
    hasComposerPackage('inertiajs/inertia-laravel', options) ||
    (await hasLaravelCodePattern(/Inertia::render|inertia\(/, options))
  );
}

/**
 * Check for Livewire
 */
async function hasLivewire(
  options: Pick<WizardRunOptions, 'installDir'>,
): Promise<boolean> {
  return (
    hasComposerPackage('livewire/livewire', options) ||
    (await hasLaravelCodePattern(/extends\s+Component|@livewire/, options))
  );
}

/**
 * Detect Laravel project type
 */
export async function getLaravelProjectType(
  options: WizardRunOptions,
): Promise<LaravelProjectType> {
  // Check for SPA/Reactive frameworks (important to detect - affects SDK needs)
  if (await hasInertia(options)) {
    getUI().setDetectedFramework('Laravel with Inertia.js');
    return LaravelProjectType.INERTIA;
  }
  if (await hasLivewire(options)) {
    getUI().setDetectedFramework('Laravel with Livewire');
    return LaravelProjectType.LIVEWIRE;
  }

  // Default to standard
  getUI().setDetectedFramework('Laravel');
  return LaravelProjectType.STANDARD;
}

/**
 * Find the main service provider file
 */
export async function findLaravelServiceProvider(
  options: Pick<WizardRunOptions, 'installDir'>,
): Promise<string | undefined> {
  const { installDir } = options;

  // Look for AppServiceProvider first (most common place for setup)
  const appServiceProvider = path.join(
    installDir,
    'app/Providers/AppServiceProvider.php',
  );

  if (fs.existsSync(appServiceProvider)) {
    return 'app/Providers/AppServiceProvider.php';
  }

  // Fall back to searching for any service provider
  const providers = await boundedGlob(
    ['**/app/Providers/*ServiceProvider.php'],
    {
      cwd: installDir,
      extraIgnore: EXTRA_IGNORE,
      limit: 1,
    },
  );

  return providers[0];
}

/**
 * Find the bootstrap file (differs between Laravel versions)
 */
export function findLaravelBootstrapFile(
  options: Pick<WizardRunOptions, 'installDir'>,
): string | undefined {
  const { installDir } = options;

  // Laravel 11+ uses bootstrap/app.php with new structure
  const bootstrapApp = path.join(installDir, 'bootstrap/app.php');
  if (fs.existsSync(bootstrapApp)) {
    return 'bootstrap/app.php';
  }

  // Older Laravel uses app/Http/Kernel.php
  const httpKernel = path.join(installDir, 'app/Http/Kernel.php');
  if (fs.existsSync(httpKernel)) {
    return 'app/Http/Kernel.php';
  }

  return undefined;
}

/**
 * Detect Laravel version structure for configuration guidance
 */
export function detectLaravelStructure(
  options: Pick<WizardRunOptions, 'installDir'>,
): 'legacy' | 'modern' | 'latest' {
  const version = getLaravelVersion(options);
  if (!version) return 'modern';

  try {
    const majorVersion = parseInt(version.split('.')[0], 10);
    if (majorVersion >= 11) return 'latest'; // Laravel 11+ (new structure)
    if (majorVersion >= 9) return 'modern'; // Laravel 9-10
    return 'legacy'; // Laravel 8 and below
  } catch {
    return 'modern';
  }
}
