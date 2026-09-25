/**
 * Assembles the Jev classifier state for a project: a truncated file tree,
 * manifest heads, README head, and lockfile names. Everything flows through
 * the bounded-fs primitives; budgets keep the worst case near ~70KB (~17k
 * tokens), inside Jev's 32k-token state window. Never sends .env or source
 * file bodies — tree paths and manifest/README heads only.
 */

import path from 'path';
import {
  walkProjectFiles,
  readFileHead,
  readProjectFile,
} from '@utils/bounded-fs';
import { PROJECT_MANIFESTS } from '../agentic.js';

export type JevProjectState = {
  file_tree: string;
  manifests: Record<string, string>;
  lockfiles: string[];
  readme_head?: string;
};

const MAX_TREE_DEPTH = 4;
const MAX_TREE_FILES = 4_000;
const MAX_ENTRIES_PER_DIR = 25;
const MAX_TREE_LINES = 500;
const MAX_MANIFEST_FILES = 20;
const MANIFEST_HEAD_BYTES = 3_000;
const MANIFEST_TOTAL_BYTES = 48_000;
const README_HEAD_BYTES = 1_500;

const MANIFEST_BASENAMES = new Set(
  PROJECT_MANIFESTS.filter((m) => !m.includes('/') && !m.startsWith('*')),
);

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
  'gradle.lockfile',
]);

function isManifest(relPath: string, name: string): boolean {
  return (
    MANIFEST_BASENAMES.has(name) ||
    name.endsWith('.csproj') ||
    relPath.endsWith('gradle/libs.versions.toml')
  );
}

type TreeNode = { files: string[]; dirs: Map<string, TreeNode> };

function insertPath(root: TreeNode, relPath: string): void {
  const segments = relPath.split('/');
  let node = root;
  for (const segment of segments.slice(0, -1)) {
    let child = node.dirs.get(segment);
    if (!child) {
      child = { files: [], dirs: new Map() };
      node.dirs.set(segment, child);
    }
    node = child;
  }
  node.files.push(segments[segments.length - 1]);
}

/**
 * Render relative file paths as an indented tree with per-directory and
 * total-line caps, truncating legibly. Pure — exported for testing.
 */
export function renderFileTree(
  relPaths: readonly string[],
  opts: { maxEntriesPerDir?: number; maxLines?: number } = {},
): string {
  const maxEntries = opts.maxEntriesPerDir ?? MAX_ENTRIES_PER_DIR;
  const maxLines = opts.maxLines ?? MAX_TREE_LINES;
  const root: TreeNode = { files: [], dirs: new Map() };
  for (const relPath of relPaths) insertPath(root, relPath);

  const lines: string[] = [];
  let truncated = false;
  const render = (node: TreeNode, indent: string): void => {
    if (truncated) return;
    const files = [...node.files].sort();
    for (const [i, file] of files.entries()) {
      if (lines.length >= maxLines) {
        truncated = true;
        return;
      }
      if (i >= maxEntries) {
        lines.push(`${indent}… +${files.length - maxEntries} more files`);
        break;
      }
      lines.push(`${indent}${file}`);
    }
    const dirs = [...node.dirs.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    for (const [i, [name, child]] of dirs.entries()) {
      if (lines.length >= maxLines) {
        truncated = true;
        return;
      }
      if (i >= maxEntries) {
        lines.push(`${indent}… +${dirs.length - maxEntries} more directories`);
        break;
      }
      lines.push(`${indent}${name}/`);
      render(child, `${indent}  `);
    }
  };
  render(root, '');
  if (truncated) lines.push('… (tree truncated)');
  return lines.join('\n');
}

/** Trim a package.json to its classification-relevant fields; head on parse failure. */
function manifestContent(fullPath: string, name: string): string | null {
  if (name === 'package.json') {
    const raw = readProjectFile(fullPath);
    if (raw) {
      try {
        const pkg = JSON.parse(raw) as Record<string, unknown>;
        return JSON.stringify({
          name: pkg.name,
          workspaces: pkg.workspaces,
          scripts: pkg.scripts,
          dependencies: pkg.dependencies,
          devDependencies: pkg.devDependencies,
        });
      } catch {
        // fall through to head
      }
    }
  }
  return readFileHead(fullPath, MANIFEST_HEAD_BYTES);
}

/** Subdirectory candidates for monorepo descent, capped. */
const MAX_SUBPROJECTS = 12;

export type ScannedProject = {
  state: JevProjectState;
  /** Repo-relative dirs holding a manifest, shallowest first, root excluded. */
  subprojectDirs: string[];
};

/** Walk the project once and assemble the classifier state. */
export function assembleProjectState(installDir: string): JevProjectState {
  return scanProject(installDir).state;
}

/** Walk once, returning both the state and monorepo descent candidates. */
export function scanProject(installDir: string): ScannedProject {
  const relPaths: string[] = [];
  const manifestPaths: string[] = [];
  const lockfiles: string[] = [];
  let readmePath: string | null = null;

  walkProjectFiles(
    installDir,
    (name, fullPath) => {
      const relPath = path
        .relative(installDir, fullPath)
        .split(path.sep)
        .join('/');
      // Only the rendered tree shares this cap — manifests, lockfiles, and
      // the README keep collecting for the rest of the (bounded) walk, so
      // huge repos don't lose descent candidates to tree truncation.
      if (relPaths.length < MAX_TREE_FILES) relPaths.push(relPath);
      if (isManifest(relPath, name)) manifestPaths.push(relPath);
      if (LOCKFILE_NAMES.has(name)) lockfiles.push(relPath);
      if (!readmePath && relPath.toLowerCase() === 'readme.md') {
        readmePath = relPath;
      }
    },
    MAX_TREE_DEPTH,
  );

  // Shallowest manifests carry the most signal; deep ones drop first.
  manifestPaths.sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  );

  const manifests: Record<string, string> = {};
  let manifestBytes = 0;
  for (const relPath of manifestPaths.slice(0, MAX_MANIFEST_FILES)) {
    const content = manifestContent(
      path.join(installDir, relPath),
      path.basename(relPath),
    );
    if (!content) continue;
    if (manifestBytes + content.length > MANIFEST_TOTAL_BYTES) break;
    manifests[relPath] = content;
    manifestBytes += content.length;
  }

  const readmeHead = readmePath
    ? readFileHead(path.join(installDir, readmePath), README_HEAD_BYTES)
    : null;

  // A dir owning a manifest is a descent candidate (agentic.ts's project
  // rule). Xcode wrappers and gradle catalogs resolve to their parent.
  const subprojectDirs: string[] = [];
  const seen = new Set<string>();
  for (const relPath of manifestPaths) {
    let dir = path.posix.dirname(relPath);
    if (dir.endsWith('.xcodeproj') || path.posix.basename(dir) === 'gradle') {
      dir = path.posix.dirname(dir);
    }
    if (dir === '.' || seen.has(dir)) continue;
    seen.add(dir);
    subprojectDirs.push(dir);
    if (subprojectDirs.length >= MAX_SUBPROJECTS) break;
  }

  return {
    state: {
      file_tree: renderFileTree(relPaths),
      manifests,
      lockfiles,
      ...(readmeHead ? { readme_head: readmeHead } : {}),
    },
    subprojectDirs,
  };
}
