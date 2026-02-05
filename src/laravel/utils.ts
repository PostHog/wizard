import fg from 'fast-glob';
import clack from '../utils/clack';
import type { WizardOptions } from '../utils/types';
import { createVersionBucket } from '../utils/semver';
import * as fs from 'node:fs';
import * as path from 'node:path';

export enum LaravelProjectType {
  STANDARD = 'standard', // Basic Laravel app
  INERTIA = 'inertia', // Inertia.js (Vue/React SPA) - may need JS SDK too
  LIVEWIRE = 'livewire', // Livewire (reactive components, includes Filament)
}

/**
 * Ignore patterns for Laravel projects
 */
const LARAVEL_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/vendor/**',
  '**/storage/**',
  '**/bootstrap/cache/**',
  '**/.phpunit.cache/**',
  '**/public/build/**',
  '**/public/hot/**',
];

/**
 * Get Laravel version bucket for analytics
 */
export const getLaravelVersionBucket = createVersionBucket();

/**
 * Read and parse composer.json
 */
export function getComposerJson(
  options: Pick<WizardOptions, 'installDir'>,
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
  options: Pick<WizardOptions, 'installDir'>,
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
  options: Pick<WizardOptions, 'installDir'>,
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
  options: Pick<WizardOptions, 'installDir'>,
  filePatterns: string[] = ['**/*.php'],
): Promise<boolean> {
  const { installDir } = options;

  const phpFiles = await fg(filePatterns, {
    cwd: installDir,
    ignore: LARAVEL_IGNORE_PATTERNS,
  });

  const searchPattern =
    typeof pattern === 'string' ? new RegExp(pattern) : pattern;

  for (const phpFile of phpFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, phpFile), 'utf-8');
      if (searchPattern.test(content)) return true;
    } catch {
      continue;
    }
  }

  return false;
}

/**
 * Get Laravel version from composer.json
 */
export function getLaravelVersion(
  options: Pick<WizardOptions, 'installDir'>,
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
  options: Pick<WizardOptions, 'installDir'>,
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
  options: Pick<WizardOptions, 'installDir'>,
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
  options: WizardOptions,
): Promise<LaravelProjectType> {
  // Check for SPA/Reactive frameworks (important to detect - affects SDK needs)
  if (await hasInertia(options)) {
    clack.log.info('Detected Laravel with Inertia.js');
    return LaravelProjectType.INERTIA;
  }
  if (await hasLivewire(options)) {
    clack.log.info('Detected Laravel with Livewire');
    return LaravelProjectType.LIVEWIRE;
  }

  // Default to standard
  clack.log.info('Detected standard Laravel project');
  return LaravelProjectType.STANDARD;
}

/**
 * Find the main service provider file
 */
export async function findLaravelServiceProvider(
  options: Pick<WizardOptions, 'installDir'>,
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
  const providers = await fg(['**/app/Providers/*ServiceProvider.php'], {
    cwd: installDir,
    ignore: LARAVEL_IGNORE_PATTERNS,
  });

  return providers[0];
}

/**
 * Find the bootstrap file (differs between Laravel versions)
 */
export function findLaravelBootstrapFile(
  options: Pick<WizardOptions, 'installDir'>,
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
  options: Pick<WizardOptions, 'installDir'>,
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
