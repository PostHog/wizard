/**
 * The repo walk: the project facts discovery reads from disk. One bounded walk
 * for the file tree, each manifest's package names and the lockfile names,
 * plus `.env` key NAMES from `collectProjectEnvKeys`, the scan `check_env_keys`
 * uses. Never file contents or `.env` values.
 */

import path from 'path';
import { safeReadFile, walkProjectFiles } from '@utils/bounded-fs';
import {
  collectProjectEnvKeys,
  ENV_SCAN_MAX_DEPTH,
  isEnvFileName,
  toPromptSafeRelativePath,
} from '@utils/env-scan';
import { MANIFEST_PARSERS } from './manifests';

export type DiscoveredManifest = {
  /** Project-relative POSIX path, e.g. `apps/web/package.json`. */
  path: string;
  /** Package ecosystem: `npm`, `pypi`, `rubygems`, `cargo`, ... */
  ecosystem: string;
  packages: string[];
};

export type RepoFiles = {
  /** The directory walked. */
  dir: string;
  /** Project-relative POSIX paths of the files walked, capped at {@link MAX_TREE_FILES}. */
  files: string[];
  manifests: DiscoveredManifest[];
  lockfiles: string[];
  /** `.env*` key names with the files that define each. Never values. */
  envKeys: Array<{ name: string; files: string[] }>;
};

const MAX_TREE_FILES = 4_000;

const LOCKFILE_NAMES = new Set([
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lockb',
  'bun.lock',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
  'Gemfile.lock',
  'composer.lock',
  'Cargo.lock',
  'go.sum',
  'mix.lock',
  'Podfile.lock',
  'pubspec.lock',
  'Package.resolved',
  'gradle.lockfile',
]);

/** Walk `dir` once. Never throws: a missing or unreadable directory yields an empty walk. */
export function walkRepo(dir: string): RepoFiles {
  const repo: RepoFiles = {
    dir,
    files: [],
    manifests: [],
    lockfiles: [],
    envKeys: [],
  };

  // Symlinks are not followed: one can point outside the project.
  walkProjectFiles(
    dir,
    (name, fullPath) => {
      const relativePath = toPromptSafeRelativePath(dir, fullPath);
      if (repo.files.length < MAX_TREE_FILES) repo.files.push(relativePath);
      if (LOCKFILE_NAMES.has(name)) repo.lockfiles.push(relativePath);
      // Key names come from the env scan below; a value is never read here.
      if (isEnvFileName(name)) return;
      const manifest = MANIFEST_PARSERS[name];
      if (!manifest) return;
      const content = safeReadFile(fullPath);
      if (content === null) return;
      const packages = manifest.parse(content);
      if (packages === null) return;
      repo.manifests.push({
        path: relativePath,
        ecosystem: manifest.ecosystem,
        packages: [...new Set(packages)],
      });
    },
    ENV_SCAN_MAX_DEPTH,
    { followSymlinks: false },
  );

  for (const [name, definitions] of collectProjectEnvKeys(dir)) {
    repo.envKeys.push({ name, files: definitions.map((d) => d.file) });
  }
  return repo;
}

/** Folders that hold a manifest, shallowest first: the candidate apps in a repo. `.` is the root. */
export function manifestDirs(repo: RepoFiles): string[] {
  const dirs = new Set<string>();
  for (const manifest of repo.manifests) {
    let dir = path.posix.dirname(manifest.path);
    // A Gradle version catalog sits in `gradle/`; its project is the parent.
    if (path.posix.basename(dir) === 'gradle') dir = path.posix.dirname(dir);
    dirs.add(dir);
  }
  return [...dirs].sort(
    (a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b),
  );
}

function depthOf(dir: string): number {
  return dir === '.' ? 0 : dir.split('/').length;
}
