import type { WizardOptions } from '../utils/types';
import { createVersionBucket } from '../utils/semver';
import fg from 'fast-glob';
import * as fs from 'node:fs';
import * as path from 'node:path';

const IGNORE_PATTERNS = ['**/build/**', '**/.gradle/**', '**/node_modules/**'];

/**
 * Extract minSdk from the app-level build.gradle(.kts).
 * Returns the value as a semver-like string (e.g. "24" from minSdk = 24).
 */
export async function getMinSdkVersion(
  options: WizardOptions,
): Promise<string | undefined> {
  const { installDir } = options;

  const buildFiles = await fg(['**/build.gradle', '**/build.gradle.kts'], {
    cwd: installDir,
    ignore: IGNORE_PATTERNS,
  });

  for (const file of buildFiles) {
    try {
      const content = fs.readFileSync(path.join(installDir, file), 'utf-8');
      // Match: minSdk = 24, minSdkVersion 21, minSdkVersion = 21
      const match = content.match(/minSdk(?:Version)?\s*=?\s*(\d+)/);
      if (match) return match[1];
    } catch {
      continue;
    }
  }

  return undefined;
}

export const getKotlinVersionBucket = createVersionBucket();

/**
 * Read the root or app-level build.gradle(.kts) and extract the Kotlin version.
 */
export function getKotlinVersion(options: WizardOptions): string | undefined {
  const { installDir } = options;

  for (const name of [
    'build.gradle',
    'build.gradle.kts',
    'gradle/libs.versions.toml',
  ]) {
    const filePath = path.join(installDir, name);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');

    // build.gradle: kotlinVersion = "2.0.21" or ext.kotlin_version = '1.9.0'
    const match = content.match(/kotlin[_-]?[Vv]ersion\s*=\s*["']([^"']+)["']/);
    if (match) return match[1];

    // libs.versions.toml: kotlin = "2.0.21"
    const tomlMatch = content.match(/^kotlin\s*=\s*["']([^"']+)["']/m);
    if (tomlMatch) return tomlMatch[1];
  }

  return undefined;
}
