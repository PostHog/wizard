/**
 * The decisions scan: the project facts the Decisions judgment service sends.
 * One bounded walk for the file tree, each manifest's package names and the
 * lockfile names, plus `.env` key NAMES from `collectProjectEnvKeys`, the scan
 * `check_env_keys` uses. Never file contents or `.env` values.
 *
 * Separate from the codebase scan (`@services/codebase-scan`), which matches
 * PostHog's tool catalog and reports tools. This one only reads the manifest
 * parsers both share.
 */

import path from 'path';
import { safeReadFile, walkProjectFiles } from '@utils/bounded-fs';
import {
  collectProjectEnvKeys,
  ENV_SCAN_MAX_DEPTH,
  isEnvFileName,
  toPromptSafeRelativePath,
} from '@utils/env-scan';
import type { PackageJson } from '@utils/package-json';
import type { ProgramSession } from '@programs/program-contract';
import {
  parseCargoToml,
  parseComposerJson,
  parseGoMod,
  parseGradleBuild,
  parseGradleVersionCatalog,
  parseMixExs,
  parsePackageSwift,
  parsePodfile,
  parsePomXml,
  parsePubspecYaml,
} from '../../warehouse-sources/manifests';
import { parseGemfile } from '../../warehouse-sources/detect';
import {
  parsePipfile,
  parsePyprojectToml,
  parseRequirementsTxt,
} from '../features';

export type ScannedManifest = {
  /** Project-relative POSIX path, e.g. `apps/web/package.json`. */
  path: string;
  /** Package ecosystem: `npm`, `pypi`, `rubygems`, `cargo`, ... */
  ecosystem: string;
  packages: string[];
};

export type DecisionsScan = {
  /** The directory walked. */
  dir: string;
  /** Project-relative POSIX paths of the files walked, capped at {@link MAX_TREE_FILES}. */
  files: string[];
  manifests: ScannedManifest[];
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

/** `parse` returns null for a file it can't read as that manifest; the scan skips it. */
type ManifestParser = {
  ecosystem: string;
  parse: (content: string) => string[] | null;
};

const MANIFEST_PARSERS: Readonly<Record<string, ManifestParser>> = {
  'package.json': { ecosystem: 'npm', parse: parsePackageJson },
  'requirements.txt': { ecosystem: 'pypi', parse: parseRequirementsTxt },
  'pyproject.toml': { ecosystem: 'pypi', parse: parsePyprojectToml },
  Pipfile: { ecosystem: 'pypi', parse: parsePipfile },
  Gemfile: { ecosystem: 'rubygems', parse: parseGemfile },
  'Cargo.toml': { ecosystem: 'cargo', parse: parseCargoToml },
  Podfile: { ecosystem: 'cocoapods', parse: parsePodfile },
  'composer.json': { ecosystem: 'composer', parse: parseComposerJson },
  'go.mod': { ecosystem: 'go', parse: parseGoMod },
  'mix.exs': { ecosystem: 'hex', parse: parseMixExs },
  'build.gradle': { ecosystem: 'maven', parse: parseGradleBuild },
  'build.gradle.kts': { ecosystem: 'maven', parse: parseGradleBuild },
  'libs.versions.toml': {
    ecosystem: 'maven',
    parse: parseGradleVersionCatalog,
  },
  'pom.xml': { ecosystem: 'maven', parse: parsePomXml },
  'pubspec.yaml': { ecosystem: 'pub', parse: parsePubspecYaml },
  'Package.swift': { ecosystem: 'swiftpm', parse: parsePackageSwift },
};

function parsePackageJson(content: string): string[] | null {
  try {
    const pkg = JSON.parse(content) as PackageJson;
    return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  } catch {
    return null;
  }
}

/** Walk `dir` once. Never throws: a missing or unreadable directory yields an empty scan. */
export function collectDecisionsScan(dir: string): DecisionsScan {
  const scan: DecisionsScan = {
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
      if (scan.files.length < MAX_TREE_FILES) scan.files.push(relativePath);
      if (LOCKFILE_NAMES.has(name)) scan.lockfiles.push(relativePath);
      // Key names come from the env scan below; a value is never read here.
      if (isEnvFileName(name)) return;
      const manifest = MANIFEST_PARSERS[name];
      if (!manifest) return;
      const content = safeReadFile(fullPath);
      if (content === null) return;
      const packages = manifest.parse(content);
      if (packages === null) return;
      scan.manifests.push({
        path: relativePath,
        ecosystem: manifest.ecosystem,
        packages: [...new Set(packages)],
      });
    },
    ENV_SCAN_MAX_DEPTH,
    { followSymlinks: false },
  );

  for (const [name, definitions] of collectProjectEnvKeys(dir)) {
    scan.envKeys.push({ name, files: definitions.map((d) => d.file) });
  }
  return scan;
}

/** frameworkContext key caching the run's decisions scan. Local only: never reported. */
const DECISIONS_SCAN_KEY = 'decisionsScan';

/** The run's decisions scan of `session.installDir`, walked once and cached. */
export function getDecisionsScan(
  session: ProgramSession,
  setFrameworkContext?: (key: string, value: unknown) => void,
): DecisionsScan {
  const kept = session.frameworkContext[DECISIONS_SCAN_KEY] as
    | DecisionsScan
    | undefined;
  if (kept?.dir === session.installDir) return kept;
  const scan = collectDecisionsScan(session.installDir);
  setFrameworkContext?.(DECISIONS_SCAN_KEY, scan);
  return scan;
}

/** Folders that hold a manifest, shallowest first: the candidate apps in a repo. `.` is the root. */
export function manifestDirs(scan: DecisionsScan): string[] {
  const dirs = new Set<string>();
  for (const manifest of scan.manifests) {
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
