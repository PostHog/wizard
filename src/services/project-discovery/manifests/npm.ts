import type { PackageJson } from '@utils/package-json';

/** Dependency and devDependency names from a `package.json`; null when it does not parse. */
export function parsePackageJson(content: string): string[] | null {
  try {
    const pkg = JSON.parse(content) as PackageJson;
    return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  } catch {
    return null;
  }
}
