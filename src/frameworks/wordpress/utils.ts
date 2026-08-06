import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WizardRunOptions } from '@utils/types';

/** wp-config.php, or the sample that ships before a site is installed. */
export function hasWordPressCore(installDir: string): boolean {
  return [
    'wp-config.php',
    'wp-config-sample.php',
    'wp-load.php',
    'wp-settings.php',
    path.join('wp-includes', 'version.php'),
  ].some((rel) => fs.existsSync(path.join(installDir, rel)));
}

/**
 * Composer-managed WordPress (Bedrock and friends) keeps core out of the
 * project root, so the files above are absent — the giveaway is the core
 * package in composer.json. Only core packages count: wpackagist plugin/theme
 * dependencies also appear in standalone plugin projects, which are not sites.
 */
export function hasComposerWordPress(installDir: string): boolean {
  const composerPath = path.join(installDir, 'composer.json');
  if (!fs.existsSync(composerPath)) {
    return false;
  }

  try {
    const composer = JSON.parse(fs.readFileSync(composerPath, 'utf-8')) as {
      require?: Record<string, string>;
      'require-dev'?: Record<string, string>;
    };
    const deps = { ...composer.require, ...composer['require-dev'] };
    return Object.keys(deps).some(
      (name) =>
        name === 'johnpbloch/wordpress' ||
        name === 'johnpbloch/wordpress-core' ||
        name === 'roots/wordpress' ||
        name === 'roots/bedrock-autoloader',
    );
  } catch {
    return false;
  }
}

/** Reads `$wp_version` out of wp-includes/version.php. */
export function getWordPressVersion(
  options: Pick<WizardRunOptions, 'installDir'>,
): string | undefined {
  const versionPath = path.join(
    options.installDir,
    'wp-includes',
    'version.php',
  );

  if (!fs.existsSync(versionPath)) {
    return undefined;
  }

  try {
    const content = fs.readFileSync(versionPath, 'utf-8');
    return /\$wp_version\s*=\s*'([^']+)'/.exec(content)?.[1];
  } catch {
    return undefined;
  }
}

/** "6.4.2" → "6.4.x", for analytics grouping. */
export function getWordPressVersionBucket(version: string): string {
  const [major, minor] = version.split('.');
  return major && minor ? `${major}.${minor}.x` : version;
}

/**
 * The plugins directory the wizard's plugin will be written into — classic
 * root, Bedrock, and public/ layouts each keep it somewhere different.
 */
export function findPluginsDir(installDir: string): string | undefined {
  const candidates = [
    path.join('wp-content', 'plugins'),
    path.join('web', 'app', 'plugins'), // Bedrock
    path.join('public', 'wp-content', 'plugins'),
  ];

  return candidates.find((rel) => fs.existsSync(path.join(installDir, rel)));
}
