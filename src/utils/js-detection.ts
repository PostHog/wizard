import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PackageDotJson } from './package-json';

const LOCKFILES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
];

/** Check whether a JS project has a lockfile or real dependencies. */
export function hasLockfileOrDeps(
  installDir: string,
  packageJson: PackageDotJson,
): boolean {
  const hasLockfile = LOCKFILES.some((lockfile) =>
    fs.existsSync(path.join(installDir, lockfile)),
  );

  if (hasLockfile) {
    return true;
  }

  const hasDeps =
    (packageJson.dependencies &&
      Object.keys(packageJson.dependencies).length > 0) ||
    (packageJson.devDependencies &&
      Object.keys(packageJson.devDependencies).length > 0);

  return !!hasDeps;
}
