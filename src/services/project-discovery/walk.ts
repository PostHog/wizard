/**
 * The repo walk: the project facts discovery reads from disk, and the only
 * module in the service that reads the repo. One bounded walk for the file
 * tree, each manifest's package names and versions, the lockfile names, the workspace
 * markers and `.env` key NAMES. Never other file contents or `.env` values.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { safeReadFile, walkProjectFiles } from '@utils/bounded-fs';
import {
  ENV_SCAN_MAX_DEPTH,
  MAX_ENV_KEY_SET,
  hasOnlyPromptSafeChars,
  isEnvFileName,
  parseEnvKeyNames,
  sanitizeReportedPath,
  toRelativePosixPath,
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
  MAX_TEMPLATES_READ,
  catalogHostsIn,
  hasScriptTag,
  isTemplateFileName,
} from './script-hosts';

export type DiscoveredManifest = {
  /** Root-relative POSIX path, e.g. `apps/web/package.json`, cleaned for a prompt. Shown, never resolved. */
  path: string;
  /** The real root-relative directory of the manifest's project. Null when a prompt cannot carry its name, so it is no project. */
  dir: string | null;
  /** Package ecosystem: `npm`, `pypi`, `rubygems`, `cargo`, ... */
  ecosystem: string;
  packages: string[];
  /** The version text the manifest declares, by package, for the packages that declare one. */
  versions: Record<string, string>;
};

/** A workspace marker file the walk read. */
export type WorkspaceMarker = MarkerRead & {
  /** Root-relative POSIX path of the marker file, cleaned for a prompt. Shown, never resolved. */
  path: string;
  /** The real root-relative directory the marker makes a workspace root. Null like a manifest's. */
  dir: string | null;
};

/** A catalog script host with one template that loads from it. A host has one match per template, up to {@link MAX_FILES_PER_ENV_KEY}. */
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

/** The walk keeps at most this many files for one `.env` key name, and for one script host. */
const MAX_FILES_PER_ENV_KEY = 20;

/** A marker file larger than this is read for its packages only, never for members. */
const MAX_MARKER_BYTES = 512 * 1024;

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

/** A real path a prompt can carry as it is, or null. A cleaned path can name another directory, so it is never resolved. */
const realPath = (rawPath: string): string | null =>
  hasOnlyPromptSafeChars(rawPath) ? rawPath : null;

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

  // A file counts toward its nearest project: the first ancestor that holds a manifest.
  const dirs = new Set(manifests.map((m) => m.dir));
  const groupOf = (file: string): string => {
    let dir = path.posix.dirname(file);
    while (dir !== '.' && !dirs.has(dir)) {
      const parent = path.posix.dirname(dir);
      if (parent === dir) return '.';
      dir = parent;
    }
    return dir;
  };
  const groupByFile = rest.map(groupOf);
  const taken = new Map<string, number>();
  const share = Math.floor(remaining / new Set(groupByFile).size);
  const chosen = new Set<number>();
  groupByFile.forEach((group, index) => {
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
        if (files.length < MAX_FILES_PER_ENV_KEY && !files.includes(file)) {
          files.push(file);
        }
      } else if (envKeys.size < MAX_ENV_KEY_SET) {
        envKeys.set(key, [file]);
      }
    }
  };

  const collect =
    (into: string[]) =>
    (name: string, fullPath: string): void => {
      // The real path decides structure; only its cleaned copy is recorded for showing.
      const raw = toRelativePosixPath(dir, fullPath);
      into.push(raw);
      const isLockfile = LOCKFILE_NAMES.has(name);
      const isEnvFile = isEnvFileName(name);
      const isTemplate = isTemplateFileName(name);
      const manifest = MANIFEST_PARSERS.get(name);
      const marker = WORKSPACE_MARKERS.get(name);
      if (!isLockfile && !isEnvFile && !isTemplate && !manifest && !marker) {
        return;
      }
      const file = sanitizeReportedPath(raw);
      if (isLockfile) repo.lockfiles.push(file);
      if (isEnvFile) return readEnvKeys(fullPath, file);
      if (isTemplate && templates.length < MAX_TEMPLATES_READ) {
        templates.push({ fullPath, file });
      }
      if (!manifest && !marker) return;
      const content = safeReadFile(fullPath);
      if (content === null) return;
      const read =
        marker && content.length <= MAX_MARKER_BYTES ? marker(content) : null;
      if (read) {
        repo.workspaceMarkers.push({
          ...read,
          path: file,
          dir: realPath(path.posix.dirname(raw)),
        });
      }
      if (!manifest) return;
      const packages = manifest.parse(content);
      // A malformed manifest is the user's file: skipped, with no event.
      if (packages === null) return;
      repo.manifests.push({
        path: file,
        dir: realPath(manifestDir(raw)),
        ecosystem: manifest.ecosystem,
        packages: Object.keys(packages),
        versions: Object.fromEntries(
          Object.entries(packages).filter(
            ([, version]) => typeof version === 'string' && version,
          ),
        ),
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

  repo.files = budgetFiles(first, rest, repo.manifests).map(
    sanitizeReportedPath,
  );
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
  const matches = new Map<string, string[]>();
  let templatesRead = 0;
  for (const template of templates) {
    if (templatesRead >= MAX_TEMPLATE_FILES) break;
    // The size is checked before the read, so a large template is never loaded.
    const content = safeReadFile(template.fullPath, MAX_TEMPLATE_BYTES);
    if (content === null) continue;
    // Checked before the template counts against the budget, so components
    // that load no script cannot use it up.
    if (!hasScriptTag(content)) continue;
    templatesRead += 1;
    for (const host of catalogHostsIn(content, catalogHosts)) {
      const files = matches.get(host);
      if (!files) matches.set(host, [template.file]);
      else if (files.length < MAX_FILES_PER_ENV_KEY) files.push(template.file);
    }
  }
  return [...matches].flatMap(([host, files]) =>
    files.map((file) => ({ host, file })),
  );
}

/** Folders that hold a manifest, shallowest first: the candidate projects in a repo. `.` is the root. */
export function manifestDirs(repo: RepoFiles): string[] {
  const dirs = new Set(
    repo.manifests.flatMap((m) => (m.dir === null ? [] : [m.dir])),
  );
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
    const file = path.join(dir, name);
    // Checked first: a missing marker is the usual case, not a read error to report.
    const content = fs.existsSync(file)
      ? safeReadFile(file, MAX_MARKER_BYTES)
      : null;
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

/** Whether others can write `dir`, such as `/tmp`: a marker there may not be the user's. */
function isSharedDir(dir: string): boolean {
  // Windows reports no permission bits a directory's mode can be read from.
  if (process.platform === 'win32') return false;
  try {
    return (fs.statSync(dir).mode & 0o002) !== 0;
  } catch {
    return true;
  }
}

const holdsManifest = (dir: string): boolean =>
  [...MANIFEST_PARSERS.keys()].some((name) =>
    fs.existsSync(path.join(dir, name)),
  );

const toPosix = (relativePath: string): string =>
  relativePath.split(path.sep).join('/');

/**
 * The project the run starts in, as a path from `rootDir`: the nearest
 * directory from `start` upward that is a workspace member and holds a
 * manifest. A launch inside `apps/web/src` starts in `apps/web`. With no such
 * member it is `start` itself.
 */
function memberHolding(
  workspace: MarkerRead,
  rootDir: string,
  start: string,
): string {
  for (let dir = start; dir !== rootDir; dir = path.dirname(dir)) {
    const relative = toPosix(path.relative(rootDir, dir));
    if (isWorkspaceMember(relative, workspace) && holdsManifest(dir)) {
      return relative;
    }
  }
  return toPosix(path.relative(rootDir, start));
}

/**
 * The workspace root for the run directory, and the project the run starts in
 * as a path from it. A run directory that declares a workspace is its own
 * root. Otherwise this looks up for the nearest workspace marker that holds the
 * run directory, stopping at the git root, below the home directory, and at a
 * directory others can write. With no marker, the run directory is the root and
 * the run project `.`.
 */
export function findWorkspaceRoot(runDir: string): {
  rootDir: string;
  runProject: string;
} {
  const start = path.resolve(runDir);
  const atStart = { rootDir: start, runProject: '.' };
  // Read before any parent, so a workspace nested in another is its own root.
  if (readWorkspaceAt(start)) return atStart;
  const home = path.resolve(os.homedir());
  let dir = start;
  for (let level = 0; level < MAX_LEVELS_UP; level += 1) {
    const parent = path.dirname(dir);
    if (fs.existsSync(path.join(dir, '.git'))) break;
    if (parent === dir || dir === home || parent === home) break;
    dir = parent;
    if (isSharedDir(dir)) break;
    const workspace = readWorkspaceAt(dir);
    if (workspace && workspaceHolds(workspace, dir, start)) {
      const runProject = memberHolding(workspace, dir, start);
      // A path a prompt cannot carry is never a project, so the run stays where it started.
      return hasOnlyPromptSafeChars(runProject)
        ? { rootDir: dir, runProject }
        : atStart;
    }
  }
  return atStart;
}
