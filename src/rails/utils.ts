import fg from 'fast-glob';
import clack from '../utils/clack';
import type { WizardOptions } from '../utils/types';
import { createVersionBucket } from '../utils/semver';
import * as fs from 'node:fs';
import * as path from 'node:path';

export enum RailsProjectType {
  STANDARD = 'standard', // Traditional Rails app (rails new)
  API = 'api', // Rails API-only (rails new --api)
}

const IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/vendor/**',
  '**/vendor/bundle/**',
  '**/tmp/**',
  '**/log/**',
  '**/storage/**',
];

/**
 * Get Rails version bucket for analytics
 */
export const getRailsVersionBucket = createVersionBucket();

/**
 * Read and parse Gemfile contents
 */
function readGemfile(
  options: Pick<WizardOptions, 'installDir'>,
): string | undefined {
  const { installDir } = options;

  const gemfilePath = path.join(installDir, 'Gemfile');
  try {
    return fs.readFileSync(gemfilePath, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Check if a gem is present in the Gemfile
 */
export function hasGem(
  gemName: string,
  options: Pick<WizardOptions, 'installDir'>,
): boolean {
  const content = readGemfile(options);
  if (!content) return false;

  // Match gem declarations like: gem 'rails', gem "rails", gem 'rails', '~> 7.0'
  const gemPattern = new RegExp(`^\\s*gem\\s+['"]${gemName}['"]`, 'im');
  return gemPattern.test(content);
}

/**
 * Extract version for a gem from Gemfile
 */
export function getGemVersion(
  gemName: string,
  options: Pick<WizardOptions, 'installDir'>,
): string | undefined {
  const content = readGemfile(options);
  if (!content) return undefined;

  const versionPattern = new RegExp(
    `^\\s*gem\\s+['"]${gemName}['"]\\s*,\\s*['"][^0-9]*([0-9]+\\.[0-9]+(?:\\.[0-9]+)?)['"]`,
    'im',
  );
  const match = content.match(versionPattern);
  return match?.[1];
}

/**
 * Get Rails version from Gemfile
 */
export function getRailsVersion(
  options: Pick<WizardOptions, 'installDir'>,
): string | undefined {
  return getGemVersion('rails', options);
}

/**
 * Detect Rails project type
 */
export function getRailsProjectType(options: WizardOptions): RailsProjectType {
  const { installDir } = options;

  // Check for API-only mode in config/application.rb
  const appConfigPath = path.join(installDir, 'config/application.rb');
  if (fs.existsSync(appConfigPath)) {
    try {
      const content = fs.readFileSync(appConfigPath, 'utf-8');
      if (content.includes('config.api_only = true')) {
        clack.log.info('Detected Rails API-only project');
        return RailsProjectType.API;
      }
    } catch {
      // Continue to default
    }
  }

  clack.log.info('Detected standard Rails project');
  return RailsProjectType.STANDARD;
}

/**
 * Get human-readable name for Rails project type
 */
export function getRailsProjectTypeName(projectType: RailsProjectType): string {
  switch (projectType) {
    case RailsProjectType.STANDARD:
      return 'Standard Rails';
    case RailsProjectType.API:
      return 'Rails API';
  }
}

/**
 * Find the Rails initializers directory
 */
export function findInitializersDir(
  options: Pick<WizardOptions, 'installDir'>,
): string | undefined {
  const { installDir } = options;

  const initializersDir = path.join(installDir, 'config/initializers');
  if (fs.existsSync(initializersDir)) {
    return 'config/initializers';
  }

  return undefined;
}

/**
 * Detect if the project is a Rails project by looking for typical Rails files
 */
export async function isRailsProject(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<boolean> {
  const { installDir } = options;

  // Check for bin/rails
  const binRailsPath = path.join(installDir, 'bin/rails');
  if (fs.existsSync(binRailsPath)) {
    return true;
  }

  // Check for config/application.rb with Rails reference
  const appConfigPath = path.join(installDir, 'config/application.rb');
  if (fs.existsSync(appConfigPath)) {
    try {
      const content = fs.readFileSync(appConfigPath, 'utf-8');
      if (
        content.includes('Rails::Application') ||
        content.includes('require "rails"') ||
        content.includes("require 'rails'")
      ) {
        return true;
      }
    } catch {
      // Continue to other checks
    }
  }

  // Check Gemfile for rails gem
  if (hasGem('rails', options)) {
    return true;
  }

  // Check for typical Rails directory structure
  const railsStructureFiles = await fg(
    ['config/routes.rb', 'config/environment.rb'],
    { cwd: installDir, ignore: IGNORE_PATTERNS },
  );

  return railsStructureFiles.length >= 2;
}
