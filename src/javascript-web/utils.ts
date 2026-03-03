import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectAllPackageManagers } from '../utils/package-manager';
import type { WizardOptions } from '../utils/types';

export type JavaScriptContext = {
  packageManagerName?: string;
  hasTypeScript?: boolean;
  hasBundler?: string;
};

/**
 * Packages that indicate a specific framework integration exists.
 * If any of these are in package.json, we should NOT match as generic JavaScript.
 *
 * When adding a new JS framework integration to the wizard,
 * add its detection package here too.
 */
export const FRAMEWORK_PACKAGES = [
  'next',
  'nuxt',
  'vue',
  'react-router',
  '@tanstack/react-start',
  '@tanstack/react-router',
  'react-native',
  '@angular/core',
  'astro',
  '@sveltejs/kit',
] as const;

/**
 * Detect the JS package manager for the project by checking lockfiles.
 * Reuses the existing package manager detection infrastructure.
 */
export function detectJsPackageManager(
  options: Pick<WizardOptions, 'installDir'>,
): string {
  const detected = detectAllPackageManagers(options);
  if (detected.length > 0) {
    return detected[0].label;
  }
  return 'unknown';
}

/**
 * Detect the bundler used in the project by checking package.json dependencies.
 */
export function detectBundler(
  options: Pick<WizardOptions, 'installDir'>,
): string | undefined {
  try {
    const content = fs.readFileSync(
      path.join(options.installDir, 'package.json'),
      'utf-8',
    );
    const pkg = JSON.parse(content);
    const allDeps: Record<string, string> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    if (allDeps['vite']) return 'vite';
    if (allDeps['webpack']) return 'webpack';
    if (allDeps['esbuild']) return 'esbuild';
    if (allDeps['parcel']) return 'parcel';
    if (allDeps['rollup']) return 'rollup';
    return undefined;
  } catch {
    return undefined;
  }
}
