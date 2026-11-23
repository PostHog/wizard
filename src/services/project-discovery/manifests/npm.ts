import { parsePackageJson as parsePackageJsonText } from '@utils/package-json';

/** Dependency and devDependency names from a `package.json`; null when it does not parse. */
export function parsePackageJson(content: string): string[] | null {
  const pkg = parsePackageJsonText(content);
  return pkg
    ? Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    : null;
}
