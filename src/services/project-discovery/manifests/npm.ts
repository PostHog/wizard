import { parsePackageJson as parsePackageJsonText } from '@utils/package-json';

/** Dependency and devDependency ranges from a `package.json`, by name; null when it does not parse. */
export function parsePackageJson(
  content: string,
): Record<string, string> | null {
  const pkg = parsePackageJsonText(content);
  return pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : null;
}
