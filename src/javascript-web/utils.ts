import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectAllPackageManagers } from '../utils/package-manager';
import type { WizardOptions } from '../utils/types';

export type JavaScriptContext = {
  packageManagerName?: string;
  hasTypeScript?: boolean;
  hasBundler?: string;
};

const INDEX_HTML_MAX_DEPTH = 6;
const INDEX_HTML_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.turbo',
  '.cache',
]);

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

/**
 * Heuristic: check if there is an index.html anywhere in the project,
 * ignoring common build and dependency directories.
 */
export function hasIndexHtml(
  options: Pick<WizardOptions, 'installDir'>,
): boolean {
  const root = options.installDir;

  function search(dir: string, depth: number): boolean {
    if (depth > INDEX_HTML_MAX_DEPTH) {
      return false;
    }

    const base = path.basename(dir);
    if (INDEX_HTML_IGNORE_DIRS.has(base)) {
      return false;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === 'index.html') {
        return true;
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (search(path.join(dir, entry.name), depth + 1)) {
          return true;
        }
      }
    }

    return false;
  }

  return search(root, 0);
}
