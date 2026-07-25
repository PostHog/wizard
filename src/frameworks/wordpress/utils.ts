import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WizardRunOptions } from '@utils/types';

/**
 * What kind of WordPress tree the wizard is pointed at. The three cases need
 * different advice: a full site owns wp-config.php, a plugin or theme is a
 * single directory that gets dropped into one.
 */
export enum WordPressProjectType {
  SITE = 'site',
  PLUGIN = 'plugin',
  THEME = 'theme',
}

export function getWordPressProjectTypeName(
  projectType: WordPressProjectType,
): string {
  switch (projectType) {
    case WordPressProjectType.SITE:
      return 'WordPress site';
    case WordPressProjectType.PLUGIN:
      return 'WordPress plugin';
    case WordPressProjectType.THEME:
      return 'WordPress theme';
  }
}

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
 * package in composer.json.
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
        name === 'roots/bedrock-autoloader' ||
        name.startsWith('wpackagist-'),
    );
  } catch {
    return false;
  }
}

/**
 * A plugin declares itself with a `Plugin Name:` header in a PHP file at the
 * root of its own directory. Only root-level files are read — the header is a
 * plugin's entry point by definition, and globbing a whole site is expensive.
 */
export function findPluginHeaderFile(installDir: string): string | undefined {
  let entries: string[];
  try {
    entries = fs.readdirSync(installDir);
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.php')) {
      continue;
    }

    try {
      const head = fs
        .readFileSync(path.join(installDir, entry), 'utf-8')
        .slice(0, 8192);
      if (/^\s*\*?\s*Plugin Name:\s*\S/im.test(head)) {
        return entry;
      }
    } catch {
      // Unreadable file — keep looking.
    }
  }

  return undefined;
}

/** A theme declares itself with a `Theme Name:` header in style.css. */
export function hasThemeHeader(installDir: string): boolean {
  const stylePath = path.join(installDir, 'style.css');
  if (!fs.existsSync(stylePath)) {
    return false;
  }

  try {
    const head = fs.readFileSync(stylePath, 'utf-8').slice(0, 8192);
    return /^\s*\*?\s*Theme Name:\s*\S/im.test(head);
  } catch {
    return false;
  }
}

export function getWordPressProjectType(
  options: Pick<WizardRunOptions, 'installDir'>,
): WordPressProjectType {
  const { installDir } = options;

  if (hasWordPressCore(installDir) || hasComposerWordPress(installDir)) {
    return WordPressProjectType.SITE;
  }

  if (findPluginHeaderFile(installDir)) {
    return WordPressProjectType.PLUGIN;
  }

  return WordPressProjectType.THEME;
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
 * Whether the plugins directory is writable — the wizard writes a plugin, and
 * a managed host with a read-only filesystem needs different advice.
 */
export function findPluginsDir(installDir: string): string | undefined {
  const candidates = [
    path.join('wp-content', 'plugins'),
    path.join('web', 'app', 'plugins'), // Bedrock
    path.join('public', 'wp-content', 'plugins'),
  ];

  return candidates.find((rel) => fs.existsSync(path.join(installDir, rel)));
}
