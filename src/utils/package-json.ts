import { readFileSync } from 'fs';
import path from 'path';

export type PackageDotJson = {
  version?: string;
  scripts?: Record<string, string | undefined>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  resolutions?: Record<string, string>;
  overrides?: Record<string, string>;
  pnpm?: {
    overrides?: Record<string, string>;
  };
};

type NpmPackage = {
  name: string;
  version: string;
};

/**
 * Checks if @param packageJson has any of the @param packageNamesList package names
 * listed as a dependency or devDependency.
 * If so, it returns the first package name that is found, including the
 * version (range) specified in the package.json.
 */
export function findInstalledPackageFromList(
  packageNamesList: string[],
  packageJson: PackageDotJson,
): NpmPackage | undefined {
  return packageNamesList
    .map((packageName) => ({
      name: packageName,
      version: getPackageVersion(packageName, packageJson),
    }))
    .find((sdkPackage): sdkPackage is NpmPackage => !!sdkPackage.version);
}

export function hasPackageInstalled(
  packageName: string,
  packageJson: PackageDotJson,
): boolean {
  return getPackageVersion(packageName, packageJson) !== undefined;
}

/**
 * Read the actual installed version from node_modules/[packageName]/package.json.
 * Returns the real semver (e.g. "15.5.9"), not the range from the project's package.json.
 */
export function getInstalledPackageVersion(
  packageName: string,
  installDir: string,
): string | undefined {
  try {
    const pkgPath = path.join(
      installDir,
      'node_modules',
      packageName,
      'package.json',
    );
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return undefined;
  }
}

export function getPackageVersion(
  packageName: string,
  packageJson: PackageDotJson,
): string | undefined {
  return (
    packageJson?.dependencies?.[packageName] ||
    packageJson?.devDependencies?.[packageName]
  );
}
