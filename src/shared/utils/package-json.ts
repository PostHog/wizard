import { readFileSync } from 'fs';
import path from 'path';

export type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string | undefined>;
  version?: string;
  overrides?: Record<string, string>;
  resolutions?: Record<string, string>;
  pnpm?: {
    overrides?: Record<string, string>;
  };
};

/**
 * Parses package.json text the way npm does: a leading byte order mark is
 * ignored. Returns null for malformed JSON or a root that is not an object.
 */
export function parsePackageJson(content: string): PackageJson | null {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as PackageJson;
  } catch {
    return null;
  }
}

type InstalledPackage = {
  name: string;
  version: string;
};

/**
 * Returns the raw version spec for `packageName` as written in
 * `package.json` (range, pinned version, workspace ref, URL, etc.).
 * `dependencies` wins over `devDependencies`. An empty-string value in
 * either slot falls through, matching the previous behaviour.
 */
export function getDeclaredVersion(
  packageName: string,
  packageJson: PackageJson,
): string | undefined {
  const fromDeps = packageJson?.dependencies?.[packageName];
  if (fromDeps) return fromDeps;
  const fromDevDeps = packageJson?.devDependencies?.[packageName];
  if (fromDevDeps) return fromDevDeps;
  return undefined;
}

export function hasDeclaredDependency(
  packageName: string,
  packageJson: PackageJson,
): boolean {
  return getDeclaredVersion(packageName, packageJson) !== undefined;
}

export function findDeclaredPackage(
  packageNamesList: string[],
  packageJson: PackageJson,
): InstalledPackage | undefined {
  for (const name of packageNamesList) {
    const version = getDeclaredVersion(name, packageJson);
    if (version) {
      return { name, version };
    }
  }
  return undefined;
}

/**
 * Returns the resolved version from `node_modules/<pkg>/package.json`,
 * not the range declared in the project's `package.json`. Use this when
 * you need to know what npm actually installed.
 */
export function getInstalledPackageVersion(
  packageName: string,
  installDir: string,
): string | undefined {
  try {
    const manifestPath = path.join(
      installDir,
      'node_modules',
      packageName,
      'package.json',
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      version?: string;
    };
    return manifest.version;
  } catch {
    return undefined;
  }
}
