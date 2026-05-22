import { readFileSync } from 'fs';
import path from 'path';

export type PackageDotJson = {
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

type InstalledPackageRef = {
  name: string;
  version: string;
};

export function getPackageVersion(
  packageName: string,
  packageJson: PackageDotJson,
): string | undefined {
  const sources = [
    packageJson?.dependencies,
    packageJson?.devDependencies,
  ] as const;

  for (const source of sources) {
    const value = source?.[packageName];
    if (value) return value;
  }

  return undefined;
}

export const hasPackageInstalled = (
  packageName: string,
  packageJson: PackageDotJson,
): boolean => getPackageVersion(packageName, packageJson) !== undefined;

export function findInstalledPackageFromList(
  packageNamesList: string[],
  packageJson: PackageDotJson,
): InstalledPackageRef | undefined {
  for (const name of packageNamesList) {
    const version = getPackageVersion(name, packageJson);
    if (version) return { name, version };
  }
  return undefined;
}

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
