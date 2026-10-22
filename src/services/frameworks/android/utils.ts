import type { WizardRunOptions } from '@utils/types';
import { createVersionBucket } from '@utils/semver';
import { boundedGlob, readProjectFile } from '@utils/bounded-fs';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Extract minSdk from the app-level build.gradle(.kts).
 * Returns the value as a semver-like string (e.g. "24" from minSdk = 24).
 */
export async function getMinSdkVersion(
  options: WizardRunOptions,
): Promise<string | undefined> {
  const { installDir } = options;

  const buildFiles = await boundedGlob(
    ['**/build.gradle', '**/build.gradle.kts'],
    { cwd: installDir },
  );

  for (const file of buildFiles) {
    const content = readProjectFile(path.join(installDir, file));
    if (!content) continue;
    // Match: minSdk = 24, minSdkVersion 21, minSdkVersion = 21
    const match = content.match(/minSdk(?:Version)?\s*=?\s*(\d+)/);
    if (match) return match[1];
  }

  return undefined;
}

export const getKotlinVersionBucket = createVersionBucket();

/**
 * Read the root or app-level build.gradle(.kts) and extract the Kotlin version.
 */
export function getKotlinVersion(
  options: WizardRunOptions,
): string | undefined {
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
