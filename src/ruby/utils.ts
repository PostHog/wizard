import fg from 'fast-glob';
import type { WizardOptions } from '../utils/types';
import { createVersionBucket } from '../utils/semver';
import * as fs from 'node:fs';
import * as path from 'node:path';

export enum RubyPackageManager {
  BUNDLER = 'bundler',
  MANUAL = 'manual',
}

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/vendor/**',
  '**/vendor/bundle/**',
  '**/tmp/**',
  '**/log/**',
];

/**
 * Get Ruby version bucket for analytics
 */
export const getRubyVersionBucket = createVersionBucket();

/**
 * Detect Ruby package manager
 */
export function detectPackageManager(
  options: Pick<WizardOptions, 'installDir'>,
): RubyPackageManager {
  const { installDir } = options;

  const gemfilePath = path.join(installDir, 'Gemfile');
  if (fs.existsSync(gemfilePath)) {
    return RubyPackageManager.BUNDLER;
  }

  return RubyPackageManager.MANUAL;
}

/**
 * Get human-readable name for package manager
 */
export function getPackageManagerName(
  packageManager: RubyPackageManager,
): string {
  switch (packageManager) {
    case RubyPackageManager.BUNDLER:
      return 'Bundler';
    case RubyPackageManager.MANUAL:
      return 'gem install';
  }
}

/**
 * Get Ruby version from .ruby-version file or Gemfile
 */
export function getRubyVersion(
  options: Pick<WizardOptions, 'installDir'>,
): string | undefined {
  const { installDir } = options;

  // Check .ruby-version file
  const rubyVersionPath = path.join(installDir, '.ruby-version');
  try {
    const content = fs.readFileSync(rubyVersionPath, 'utf-8').trim();
    // Remove "ruby-" prefix if present
    const version = content.replace(/^ruby-/, '');
    if (/^[0-9]+\.[0-9]+/.test(version)) {
      return version;
    }
  } catch {
    // Continue to other checks
  }

  // Check Gemfile for ruby version declaration
  const gemfilePath = path.join(installDir, 'Gemfile');
  try {
    const content = fs.readFileSync(gemfilePath, 'utf-8');
    const match = content.match(/ruby\s+['"]([0-9]+\.[0-9]+(?:\.[0-9]+)?)['"]/);
    if (match) {
      return match[1];
    }
  } catch {
    // No Gemfile
  }

  return undefined;
}

/**
 * Check if the project is a Ruby project (but not Rails)
 */
export async function isRubyProject(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<boolean> {
  const { installDir } = options;

  // Check for Gemfile
  const gemfilePath = path.join(installDir, 'Gemfile');
  if (fs.existsSync(gemfilePath)) {
    // Make sure this isn't a Rails project (Rails should be detected first)
    try {
      const content = fs.readFileSync(gemfilePath, 'utf-8');
      if (/^\s*gem\s+['"]rails['"]/im.test(content)) {
        return false; // Rails project, use rails agent instead
      }
    } catch {
      // Continue checking
    }
    return true;
  }

  // Check for .ruby-version file
  const rubyVersionPath = path.join(installDir, '.ruby-version');
  if (fs.existsSync(rubyVersionPath)) {
    return true;
  }

  // Check for *.gemspec files
  const gemspecFiles = await fg('*.gemspec', {
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  if (gemspecFiles.length > 0) {
    return true;
  }

  // Check for Ruby source files in the root
  const rubyFiles = await fg(['*.rb', 'lib/**/*.rb', 'bin/**/*.rb'], {
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  return rubyFiles.length > 0;
}
