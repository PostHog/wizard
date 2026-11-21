/**
 * The repo walk: the project facts discovery reads from disk, and the only
 * module in the service that reads the repo. One bounded walk for the file
 * tree, each manifest's package names, the lockfile names, the workspace
 * markers and `.env` key NAMES. Never other file contents or `.env` values.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { analytics } from '@utils/analytics';
import { safeReadFile, walkProjectFiles } from '@utils/bounded-fs';
import {
  ENV_SCAN_MAX_DEPTH,
  MAX_ENV_KEY_SET,
  isEnvFileName,
  parseEnvKeyNames,
  toPromptSafeRelativePath,
} from '@utils/env-scan';
import { MANIFEST_PARSERS } from './manifests';
import {
  WORKSPACE_MARKERS,
  isWorkspaceMember,
  mergeMarkers,
  type MarkerRead,
} from './markers';
import {
  MAX_TEMPLATE_BYTES,
  MAX_TEMPLATE_FILES,
  catalogHostsIn,
  hasScriptTag,
  isTemplateFileName,
} from './script-hosts';

export type DiscoveredManifest = {
  /** Root-relative POSIX path, e.g. `apps/web/package.json`. */
  path: string;
  /** Package ecosystem: `npm`, `pypi`, `rubygems`, `cargo`, ... */
  ecosystem: string;
  packages: string[];
};

/** A workspace marker file the walk read. */
export type WorkspaceMarker = MarkerRead & {
  /** Root-relative POSIX path of the marker file. */
  path: string;
};

/** A catalog script host a template loads from, with the first template found for it. */
export type ScriptHostMatch = { host: string; file: string };

export type RepoFiles = {
  /** The directory walked. */
  dir: string;
  /** Root-relative POSIX paths of the files walked, capped at {@link MAX_TREE_FILES}. */
  files: string[];
  /** Every manifest read, in walk order. */
  manifests: DiscoveredManifest[];
  lockfiles: string[];
  /** `.env*` key names with the files that define each, in walk order. Never values. */
  envKeys: Array<{ name: string; files: string[] }>;
  workspaceMarkers: WorkspaceMarker[];
  /** Empty until {@link readScriptHosts} matches the templates against a catalog. */
  scriptHosts: ScriptHostMatch[];
  /** False when the walk stopped at a cap or skipped a directory it could not read. */
  complete: boolean;
  /** True when the walk saw more files than `files` keeps. */
  truncated: boolean;
};

/** A template the walk passed, kept so {@link readScriptHosts} can read it once a catalog arrives. */
export type TemplateFile = { fullPath: string; file: string };

export type RepoWalk = {
  files: RepoFiles;
  templates: TemplateFile[];
  durationMs: number;
};

export type WalkOptions = {
  /** Root-relative path of the project the run started in. Its subtree is walked first. */
  runProject?: string;
};

export const MAX_TREE_FILES = 4_000;

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

const isUnder = (dir: string, file: string): boolean =>
  dir === '.' || file === dir || file.startsWith(`${dir}/`);

/** The manifest's directory; a Gradle version catalog sits in `gradle/`, so its project is the parent. */
function manifestDir(manifestPath: string): string {
  const dir = path.posix.dirname(manifestPath);
  return path.posix.basename(dir) === 'gradle' ? path.posix.dirname(dir) : dir;
}

/**
 * Keep at most {@link MAX_TREE_FILES} paths: the run project's first, then an
 * even share for each other manifest directory, in walk order.
 */
function budgetFiles(
  first: string[],
  rest: string[],
  manifests: readonly DiscoveredManifest[],
): string[] {
  const kept = first.slice(0, MAX_TREE_FILES);
  const remaining = MAX_TREE_FILES - kept.length;
  if (rest.length <= remaining) return [...kept, ...rest];
  if (remaining === 0) return kept;

  // Deepest first, so a file counts toward its nearest project.
  const dirs = [...new Set(manifests.map((m) => manifestDir(m.path)))].sort(
    (a, b) => b.length - a.length,
  );
  const groupOf = (file: string): string =>
    dirs.find((dir) => dir !== '.' && isUnder(dir, file)) ?? '.';
  const taken = new Map<string, number>();
  const groups = new Set(rest.map(groupOf));
  const share = Math.floor(remaining / groups.size);
  const chosen = new Set<number>();
  rest.forEach((file, index) => {
    const group = groupOf(file);
    const count = taken.get(group) ?? 0;
    if (count >= share) return;
    taken.set(group, count + 1);
    chosen.add(index);
  });
  // A group smaller than its share leaves room: fill it in walk order.
  for (let i = 0; i < rest.length && chosen.size < remaining; i += 1) {
    chosen.add(i);
  }
  return [...kept, ...rest.filter((_, index) => chosen.has(index))];
}

/** A walk of `dir` that found nothing. */
export function emptyRepoFiles(dir: string): RepoFiles {
  return {
    dir,
    files: [],
    manifests: [],
    lockfiles: [],
    envKeys: [],
    workspaceMarkers: [],
    scriptHosts: [],
    complete: true,
    truncated: false,
  };
}

/**
 * Walk `dir` once, the run project's subtree first. Never throws: a missing or
 * unreadable directory yields an empty walk.
 */
export function walkRepoFiles(
  dir: string,
  options: WalkOptions = {},
): RepoWalk {
  const startedAt = Date.now();
  const runProject = options.runProject ?? '.';
  const repo = emptyRepoFiles(dir);
  const templates: TemplateFile[] = [];
  const envKeys = new Map<string, string[]>();

  const readEnvKeys = (fullPath: string, file: string): void => {
    // null when unreadable or oversized, such as a `.env` that is a directory.
    const content = safeReadFile(fullPath);
    if (content === null) return;
    for (const key of parseEnvKeyNames(content)) {
      const files = envKeys.get(key);
      if (files) {
        if (!files.includes(file)) files.push(file);
      } else if (envKeys.size < MAX_ENV_KEY_SET) {
        envKeys.set(key, [file]);
      }
    }
  };

  const collect =
    (into: string[]) =>
    (name: string, fullPath: string): void => {
      const file = toPromptSafeRelativePath(dir, fullPath);
      into.push(file);
      if (LOCKFILE_NAMES.has(name)) repo.lockfiles.push(file);
      if (isEnvFileName(name)) return readEnvKeys(fullPath, file);
      if (isTemplateFileName(name)) templates.push({ fullPath, file });
      const manifest = MANIFEST_PARSERS.get(name);
      const marker = WORKSPACE_MARKERS.get(name);
      if (!manifest && !marker) return;
      const content = safeReadFile(fullPath);
      if (content === null) return;
      const read = marker?.(content);
      if (read) repo.workspaceMarkers.push({ ...read, path: file });
      if (!manifest) return;
      const packages = manifest.parse(content);
      if (packages === null) {
        // Malformed: skipped, but recorded that the walk hit it.
        analytics.captureException(new Error(`Malformed ${name}`), {
          step: 'detectWarehouseSources.parsePackageJson',
        });
        return;
      }
      repo.manifests.push({
        path: file,
        ecosystem: manifest.ecosystem,
        packages: [...new Set(packages)],
      });
    };

  // Symlinks are not followed: one can point outside the project, and what
  // the walk reads is reported to PostHog.
  const first: string[] = [];
  const rest: string[] = [];
  const runDir = path.resolve(dir, runProject);
  repo.complete = walkProjectFiles(runDir, collect(first), ENV_SCAN_MAX_DEPTH, {
    followSymlinks: false,
  });
  if (runDir !== path.resolve(dir)) {
    const complete = walkProjectFiles(dir, collect(rest), ENV_SCAN_MAX_DEPTH, {
      followSymlinks: false,
      skipDir: (fullPath) => path.resolve(fullPath) === runDir,
    });
    repo.complete = repo.complete && complete;
  }

  repo.files = budgetFiles(first, rest, repo.manifests);
  repo.truncated = repo.files.length < first.length + rest.length;
  repo.envKeys = [...envKeys].map(([name, files]) => ({ name, files }));
  return { files: repo, templates, durationMs: Date.now() - startedAt };
}

/** {@link walkRepoFiles} for a caller that matches no script hosts. */
export function walkRepo(dir: string, options: WalkOptions = {}): RepoFiles {
  return walkRepoFiles(dir, options).files;
}

/**
 * The catalog script hosts the walked templates load from, reading at most
 * {@link MAX_TEMPLATE_FILES} templates that hold a `<script` tag.
 */
export function readScriptHosts(
  templates: readonly TemplateFile[],
  catalogHosts: readonly string[],
): ScriptHostMatch[] {
  if (catalogHosts.length === 0) return [];
  const matches = new Map<string, string>();
  let templatesRead = 0;
  for (const template of templates) {
    if (templatesRead >= MAX_TEMPLATE_FILES) break;
    const content = safeReadFile(template.fullPath);
    if (content === null || content.length > MAX_TEMPLATE_BYTES) continue;
    // Checked before the template counts against the budget, so components
    // that load no script cannot use it up.
    if (!hasScriptTag(content)) continue;
    templatesRead += 1;
    for (const host of catalogHostsIn(content, catalogHosts)) {
      if (!matches.has(host)) matches.set(host, template.file);
    }
  }
  return [...matches].map(([host, file]) => ({ host, file }));
}

/** Folders that hold a manifest, shallowest first: the candidate projects in a repo. `.` is the root. */
export function manifestDirs(repo: RepoFiles): string[] {
  const dirs = new Set(repo.manifests.map((m) => manifestDir(m.path)));
  return [...dirs].sort(
    (a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b),
  );
}

function depthOf(dir: string): number {
  return dir === '.' ? 0 : dir.split('/').length;
}

/** How many directories above the run directory the workspace lookup reads. */
const MAX_LEVELS_UP = 8;

/** The workspace the markers in `dir` declare, or null when it holds none. */
function readWorkspaceAt(dir: string): MarkerRead | null {
  const reads: MarkerRead[] = [];
  for (const [name, parse] of WORKSPACE_MARKERS) {
    const content = safeReadFile(path.join(dir, name));
    const read = content === null ? null : parse(content);
    if (read) reads.push(read);
  }
  return mergeMarkers(reads);
}

/** Whether the workspace at `rootDir` holds `runDir` in one of its members. */
function workspaceHolds(
  workspace: MarkerRead,
  rootDir: string,
  runDir: string,
): boolean {
  const segments = path.relative(rootDir, runDir).split(path.sep);
  return segments.some((_, index) =>
    isWorkspaceMember(segments.slice(0, index + 1).join('/'), workspace),
  );
}

/**
 * The workspace root above the run directory, and the run directory as a path
 * from it. Looks up for the nearest workspace marker that holds the run
 * directory, stopping at the git root, or at the home directory when there is
 * none. With no marker, the run directory is the root and the run project `.`.
 */
export function findWorkspaceRoot(runDir: string): {
  rootDir: string;
  runProject: string;
} {
  const start = path.resolve(runDir);
  const home = path.resolve(os.homedir());
  let dir = start;
  for (let level = 0; level < MAX_LEVELS_UP; level += 1) {
    const parent = path.dirname(dir);
    if (fs.existsSync(path.join(dir, '.git'))) break;
    if (parent === dir || parent === home) break;
    dir = parent;
    const workspace = readWorkspaceAt(dir);
    if (workspace && workspaceHolds(workspace, dir, start)) {
      return {
        rootDir: dir,
        runProject: path.relative(dir, start).split(path.sep).join('/'),
      };
    }
  }
  return { rootDir: start, runProject: '.' };
}
